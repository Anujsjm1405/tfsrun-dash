const pool = require("../db/mysql");

const proxmoxConfig =
    require("../config/proxmox");

const ProxmoxClient =
    require("../proxmox/proxmoxClient");

const resourceAllocator =
    require("./resourceAllocator");


class ServiceManager {

    constructor() {

        this.clients = {
            node1:
                new ProxmoxClient(
                    proxmoxConfig.node1
                ),

            node2:
                new ProxmoxClient(
                    proxmoxConfig.node2
                ),

            node3:
                new ProxmoxClient(
                    proxmoxConfig.node3
                )
        };

    }


    getClient(nodeName) {

        const client =
            this.clients[nodeName];

        if (!client) {
            throw new Error(
                `No Proxmox client configured for ${nodeName}`
            );
        }

        return client;
    }


    async getTemplate(serviceType) {

        const [rows] =
            await pool.execute(
                `
                SELECT
                    t.id,
                    t.service_type,
                    t.node_id,
                    t.vmid,
                    t.name,
                    t.storage_gb
                FROM templates t
                WHERE t.service_type = ?
                  AND t.enabled = TRUE
                ORDER BY t.id
                LIMIT 1
                `,
                [serviceType]
            );

        if (!rows.length) {
            throw new Error(
                `No enabled ${serviceType} template found`
            );
        }

        return rows[0];
    }


    async createService({
        serviceType,
        name,
        cpu,
        ramMb,
        storageGb = 32,
        ownerId = null
    }) {

        if (!serviceType) {
            throw new Error(
                "serviceType is required"
            );
        }

        if (!["compute", "database"].includes(serviceType)) {
            throw new Error(
                "Invalid serviceType"
            );
        }

        if (!name) {
            throw new Error(
                "Service name is required"
            );
        }

        if (!Number.isInteger(cpu) || cpu <= 0) {
            throw new Error(
                "CPU must be a positive integer"
            );
        }

        if (!Number.isInteger(ramMb) || ramMb <= 0) {
            throw new Error(
                "RAM must be a positive integer"
            );
        }

        if (!Number.isFinite(storageGb) || storageGb <= 0) {
            throw new Error(
                "Storage must be greater than zero"
            );
        }


        const template =
            await this.getTemplate(
                serviceType
            );


        let preferredNodeId = null;

        if (serviceType === "database") {
            preferredNodeId =
                Number(template.node_id);
        }


        const selectedNode =
            await resourceAllocator.findNode({
                cpu,
                ramMb,
                storageGb,
                storageType: "local",
                preferredNodeId
            });


        if (!selectedNode) {
            throw new Error(
                "No node has sufficient resources"
            );
        }


        console.log(
            `Selected node: ${selectedNode.name}`
        );


        const templateNodeId =
            Number(template.node_id);

        const templateNode =
            await this.getNodeById(
                templateNodeId
            );

        const templateNodeName =
            templateNode.name;

        const destinationNodeName =
            selectedNode.name;


        const templateClient =
            this.getClient(
                templateNodeName
            );

        const destinationClient =
            this.getClient(
                destinationNodeName
            );


        const connection =
            await pool.getConnection();

        let serviceId = null;
        let allocationId = null;
        let vmid = null;

        let resourceCreated = false;
        let resourceNodeName = null;


        try {

            await connection.beginTransaction();


            const [lockedNodes] =
                await connection.execute(
                    `
                    SELECT id
                    FROM nodes
                    WHERE id = ?
                      AND enabled = TRUE
                    FOR UPDATE
                    `,
                    [selectedNode.id]
                );


            if (!lockedNodes.length) {
                throw new Error(
                    "Selected node is unavailable"
                );
            }


            const resources =
                await resourceAllocator.getNodeResources(
                    selectedNode.id,
                    connection
                );


            if (resources.cpu.available < cpu) {
                throw new Error(
                    "Insufficient CPU"
                );
            }


            if (resources.ram.available < ramMb) {
                throw new Error(
                    "Insufficient RAM"
                );
            }


            if (storageGb > 0) {

                const availableStorage =
                    resources.storage.total -
                    resources.storage.reserved -
                    resources.storage.localAllocated;


                if (availableStorage < storageGb) {
                    throw new Error(
                        "Insufficient local storage"
                    );
                }

            }


            const [serviceResult] =
                await connection.execute(
                    `
                    INSERT INTO services (
                        service_type,
                        name,
                        owner_id,
                        node_id,
                        status
                    )
                    VALUES (?, ?, ?, ?, 'provisioning')
                    `,
                    [
                        serviceType,
                        name,
                        ownerId,
                        selectedNode.id
                    ]
                );


            serviceId =
                serviceResult.insertId;


            const [allocationResult] =
                await connection.execute(
                    `
                    INSERT INTO allocations (
                        service_id,
                        node_id,
                        cpu,
                        ram_mb,
                        storage_gb,
                        storage_type,
                        allocation_type,
                        status
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, 'local',
                        'service',
                        'active'
                    )
                    `,
                    [
                        serviceId,
                        selectedNode.id,
                        cpu,
                        ramMb,
                        storageGb
                    ]
                );


            allocationId =
                allocationResult.insertId;


            await connection.commit();


        } catch (error) {

            await connection.rollback();

            connection.release();

            throw error;
        }


        connection.release();


        try {

            console.log(
                `Template: ${templateNodeName} / VMID ${template.vmid}`
            );


            /*
             * --------------------------------------------------
             * COMPUTE SERVICE
             * --------------------------------------------------
             */

            if (serviceType === "compute") {

                const version =
                    await templateClient.getVersion();

                console.log(
                    `Proxmox ${templateNodeName}:`,
                    version
                );


                vmid =
                    await templateClient.getNextVMID();


                console.log(
                    `Proxmox allocated VMID ${vmid}`
                );


                /*
                 * Clone template 111 on node1.
                 *
                 * The template disk is stored on NFS.
                 */

                console.log(
                    `Cloning VM ${template.vmid} on ${templateNodeName}`
                );

                const cloneTask =
                    await templateClient.cloneVM(
                        templateNodeName,
                        template.vmid,
                        vmid,
                        name
                    );


                console.log(
                    `Clone task started: ${cloneTask}`
                );


                await templateClient.waitForTask(
                    templateNodeName,
                    cloneTask
                );


                resourceCreated = true;
                resourceNodeName =
                    templateNodeName;


                console.log(
                    `VM ${vmid} successfully cloned on ${templateNodeName}`
                );


                /*
                 * Migrate the VM to the node selected
                 * by the resource allocator.
                 */

                if (
                    destinationNodeName !==
                    templateNodeName
                ) {

                    console.log(
                        `Migrating VM ${vmid} from ${templateNodeName} to ${destinationNodeName}`
                    );


                    const migrationTask =
                        await templateClient.migrateVM(
                            templateNodeName,
                            vmid,
                            destinationNodeName,
                            "nfs-template"
                        );


                    console.log(
                        `Migration task started: ${migrationTask}`
                    );


                    await templateClient.waitForTask(
                        templateNodeName,
                        migrationTask
                    );


                    resourceNodeName =
                        destinationNodeName;


                    console.log(
                        `VM ${vmid} migrated to ${destinationNodeName}`
                    );

                }


                /*
                 * Move the OS disk from NFS to the
                 * selected node's local-lvm.
                 *
                 * This is the final storage location
                 * for the user's VM.
                 */

                const destinationClientForDisk =
                    this.getClient(
                        resourceNodeName
                    );


                console.log(
                    `Moving VM ${vmid} OS disk to local-lvm`
                );


                const moveTask =
                    await destinationClientForDisk.moveVMDisk(
                        resourceNodeName,
                        vmid,
                        "scsi0",
                        "local-lvm",
                        true
                    );


                console.log(
                    `Disk move task started: ${moveTask}`
                );


                await destinationClientForDisk.waitForTask(
                    resourceNodeName,
                    moveTask
                );


                console.log(
                    `VM ${vmid} OS disk moved to local-lvm`
                );


                /*
                 * Configure CPU and RAM.
                 */

                console.log(
                    `Configuring VM ${vmid}: ${cpu} CPU / ${ramMb} MB RAM`
                );


                await destinationClientForDisk.setVMResources(
                    resourceNodeName,
                    vmid,
                    {
                        cores: cpu,
                        memory: ramMb
                    }
                );


                /*
                 * Start VM.
                 */

                console.log(
                    `Starting VM ${vmid}`
                );


                const startTask =
                    await destinationClientForDisk.startVM(
                        resourceNodeName,
                        vmid
                    );


                if (startTask) {

                    await destinationClientForDisk.waitForTask(
                        resourceNodeName,
                        startTask
                    );

                }


                console.log(
                    `VM ${vmid} started`
                );


                /*
                 * Wait for Guest Agent IP.
                 */

                console.log(
                    `Waiting for IP address of VM ${vmid}`
                );


                const ipAddress =
                    await destinationClientForDisk.waitForVMIPv4(
                        resourceNodeName,
                        vmid
                    );


                console.log(
                    `VM ${vmid} IP address: ${ipAddress}`
                );


                await pool.execute(
                    `
                    UPDATE services
                    SET
                        vmid = ?,
                        ip_address = ?,
                        status = 'active'
                    WHERE id = ?
                    `,
                    [
                        vmid,
                        ipAddress,
                        serviceId
                    ]
                );


                console.log(
                    `Service ${serviceId} marked active`
                );


                return {
                    serviceId,
                    vmid,
                    nodeId: selectedNode.id,
                    nodeName: selectedNode.name,
                    allocationId,
                    status: "active",
                    ipAddress
                };

            }


            /*
             * --------------------------------------------------
             * DATABASE SERVICE
             * --------------------------------------------------
             */

            if (serviceType === "database") {

                if (
                    destinationNodeName !==
                    templateNodeName
                ) {

                    throw new Error(
                        "Database template must remain on its template node"
                    );

                }


                vmid =
                    await templateClient.getNextVMID();


                console.log(
                    `Proxmox allocated CTID ${vmid}`
                );


                console.log(
                    `Cloning CT ${template.vmid} on ${templateNodeName}`
                );


                const cloneTask =
                    await templateClient.cloneContainer(
                        templateNodeName,
                        template.vmid,
                        vmid
                    );


                console.log(
                    `Clone task started: ${cloneTask}`
                );


                await templateClient.waitForTask(
                    templateNodeName,
                    cloneTask
                );


                resourceCreated = true;
                resourceNodeName =
                    templateNodeName;


                console.log(
                    `CT ${vmid} successfully cloned`
                );


                console.log(
                    `Configuring CT ${vmid}: ${cpu} CPU / ${ramMb} MB RAM`
                );


                await templateClient.setContainerResources(
                    templateNodeName,
                    vmid,
                    {
                        cores: cpu,
                        memory: ramMb
                    }
                );


                console.log(
                    `Starting CT ${vmid}`
                );


                const startTask =
                    await templateClient.startContainer(
                        templateNodeName,
                        vmid
                    );


                if (startTask) {

                    await templateClient.waitForTask(
                        templateNodeName,
                        startTask
                    );

                }


                console.log(
                    `CT ${vmid} started`
                );


                await pool.execute(
                    `
                    UPDATE services
                    SET
                        vmid = ?,
                        status = 'active'
                    WHERE id = ?
                    `,
                    [
                        vmid,
                        serviceId
                    ]
                );


                console.log(
                    `Service ${serviceId} marked active`
                );


                return {
                    serviceId,
                    vmid,
                    nodeId: selectedNode.id,
                    nodeName: selectedNode.name,
                    allocationId,
                    status: "active",
                    ipAddress: null
                };

            }


            throw new Error(
                `Unsupported service type: ${serviceType}`
            );


        } catch (error) {

            console.error(
                `Service ${serviceId} provisioning failed:`,
                error.message
            );


            /*
             * Cleanup Proxmox resource if it was created.
             */

            if (
                resourceCreated &&
                vmid &&
                resourceNodeName
            ) {

                try {

                    const cleanupClient =
                        this.getClient(
                            resourceNodeName
                        );


                    if (serviceType === "compute") {

                        try {

                            const stopTask =
                                await cleanupClient.stopVM(
                                    resourceNodeName,
                                    vmid
                                );


                            if (stopTask) {

                                await cleanupClient.waitForTask(
                                    resourceNodeName,
                                    stopTask
                                );

                            }

                        } catch (stopError) {

                            console.error(
                                `Cleanup stop failed for VM ${vmid}:`,
                                stopError.message
                            );

                        }


                        try {

                            const deleteTask =
                                await cleanupClient.deleteVM(
                                    resourceNodeName,
                                    vmid
                                );


                            if (deleteTask) {

                                await cleanupClient.waitForTask(
                                    resourceNodeName,
                                    deleteTask
                                );

                            }

                        } catch (deleteError) {

                            console.error(
                                `Cleanup delete failed for VM ${vmid}:`,
                                deleteError.message
                            );

                        }

                    }


                    if (serviceType === "database") {

                        try {

                            const deleteTask =
                                await cleanupClient.deleteContainer(
                                    resourceNodeName,
                                    vmid
                                );


                            if (deleteTask) {

                                await cleanupClient.waitForTask(
                                    resourceNodeName,
                                    deleteTask
                                );

                            }

                        } catch (deleteError) {

                            console.error(
                                `Cleanup delete failed for CT ${vmid}:`,
                                deleteError.message
                            );

                        }

                    }

                } catch (cleanupError) {

                    console.error(
                        "Cleanup initialization failed:",
                        cleanupError.message
                    );

                }

            }


            /*
             * Release TFSrun allocation.
             */

            if (serviceId) {

                try {

                    await resourceAllocator.release(
                        serviceId
                    );

                } catch (releaseError) {

                    console.error(
                        "Allocation release failed:",
                        releaseError.message
                    );

                }

            }


            /*
             * Mark service failed.
             */

            if (serviceId) {

                try {

                    await pool.execute(
                        `
                        UPDATE services
                        SET status = 'failed'
                        WHERE id = ?
                        `,
                        [serviceId]
                    );

                } catch (statusError) {

                    console.error(
                        "Failed to mark service failed:",
                        statusError.message
                    );

                }

            }


            throw error;
        }
    }


    async getNodeById(nodeId) {

        const [rows] =
            await pool.execute(
                `
                SELECT
                    id,
                    name,
                    host,
                    port
                FROM nodes
                WHERE id = ?
                  AND enabled = TRUE
                `,
                [nodeId]
            );


        if (!rows.length) {

            throw new Error(
                `Node ${nodeId} not found`
            );

        }


        return rows[0];
    }


    async deleteService(serviceId) {

        const [services] =
            await pool.execute(
                `
                SELECT
                    id,
                    service_type,
                    node_id,
                    vmid,
                    status
                FROM services
                WHERE id = ?
                `,
                [serviceId]
            );


        if (!services.length) {

            throw new Error(
                `Service ${serviceId} not found`
            );

        }


        const service =
            services[0];


        if (service.status === "deleted") {

            return {
                serviceId,
                status: "deleted"
            };

        }


        await pool.execute(
            `
            UPDATE services
            SET status = 'deleting'
            WHERE id = ?
            `,
            [serviceId]
        );


        const node =
            await this.getNodeById(
                service.node_id
            );


        const client =
            this.getClient(
                node.name
            );


        try {

            if (service.vmid) {

                if (
                    service.service_type ===
                    "compute"
                ) {

                    /*
                     * Try to stop the VM.
                     *
                     * We intentionally do not call
                     * getVMStatus(), because that method
                     * does not exist in ProxmoxClient.
                     */

                    try {

                        const stopTask =
                            await client.stopVM(
                                node.name,
                                service.vmid
                            );


                        if (stopTask) {

                            await client.waitForTask(
                                node.name,
                                stopTask
                            );

                        }

                    } catch (stopError) {

                        console.error(
                            `Stop VM failed: ${stopError.message}`
                        );

                    }


                    /*
                     * Destroy the VM after the stop attempt.
                     */

                    const deleteTask =
                        await client.deleteVM(
                            node.name,
                            service.vmid
                        );


                    if (deleteTask) {

                        await client.waitForTask(
                            node.name,
                            deleteTask
                        );

                    }

                }


                if (
                    service.service_type ===
                    "database"
                ) {

                    const deleteTask =
                        await client.deleteContainer(
                            node.name,
                            service.vmid
                        );


                    if (deleteTask) {

                        await client.waitForTask(
                            node.name,
                            deleteTask
                        );

                    }

                }

            }


            /*
             * Release resources only after the
             * Proxmox resource was successfully deleted.
             */

            await resourceAllocator.release(
                serviceId
            );


            await pool.execute(
                `
                UPDATE services
                SET status = 'deleted'
                WHERE id = ?
                `,
                [serviceId]
            );


            return {
                serviceId,
                status: "deleted"
            };


        } catch (error) {

            /*
             * The Proxmox resource was not successfully
             * deleted, therefore do NOT release its
             * allocation.
             */

            await pool.execute(
                `
                UPDATE services
                SET status = 'failed'
                WHERE id = ?
                `,
                [serviceId]
            );


            throw error;
        }
    }
}


module.exports =
    new ServiceManager();
