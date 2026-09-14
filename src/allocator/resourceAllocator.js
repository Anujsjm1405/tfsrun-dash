const pool = require("../db/mysql");

/**
 * ResourceAllocator
 *
 * Responsible for:
 * - Checking node capacity
 * - Selecting a suitable node
 * - Reserving resources
 * - Releasing resources
 *
 * It does NOT create or delete Proxmox VMs.
 */
class ResourceAllocator {

    /**
     * Get current resource availability for a node.
     */
    async getNodeResources(
        nodeId,
        connection = pool
    ) {

        const [nodeRows] =
            await connection.execute(
                `
                SELECT
                    id,
                    name,
                    total_cpu,
                    reserved_cpu,
                    total_ram_mb,
                    reserved_ram_mb,
                    total_local_storage_gb,
                    total_ssd_storage_gb,
                    enabled
                FROM nodes
                WHERE id = ?
                LIMIT 1
                `,
                [nodeId]
            );


        if (nodeRows.length === 0) {

            throw new Error(
                `Node ${nodeId} not found`
            );
        }


        const node =
            nodeRows[0];


        const [allocationRows] =
            await connection.execute(
                `
                SELECT

                    COALESCE(
                        SUM(cpu),
                        0
                    ) AS allocated_cpu,

                    COALESCE(
                        SUM(ram_mb),
                        0
                    ) AS allocated_ram_mb,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN storage_type = 'local'
                                THEN storage_gb
                                ELSE 0
                            END
                        ),
                        0
                    ) AS allocated_local_storage_gb,

                    COALESCE(
                        SUM(
                            CASE
                                WHEN storage_type = 'ssd'
                                THEN storage_gb
                                ELSE 0
                            END
                        ),
                        0
                    ) AS allocated_ssd_storage_gb

                FROM allocations

                WHERE node_id = ?
                  AND status = 'active'
                `,
                [nodeId]
            );


        const allocation =
            allocationRows[0] || {};


        return {

            nodeId:
                Number(node.id),

            nodeName:
                node.name,

            enabled:
                Boolean(node.enabled),

            cpu: {

                total:
                    Number(node.total_cpu),

                reserved:
                    Number(node.reserved_cpu),

                allocated:
                    Number(
                        allocation.allocated_cpu || 0
                    ),

                available:
                    Number(node.total_cpu) -
                    Number(node.reserved_cpu) -
                    Number(
                        allocation.allocated_cpu || 0
                    )
            },

            ramMb: {

                total:
                    Number(node.total_ram_mb),

                reserved:
                    Number(node.reserved_ram_mb),

                allocated:
                    Number(
                        allocation.allocated_ram_mb || 0
                    ),

                available:
                    Number(node.total_ram_mb) -
                    Number(node.reserved_ram_mb) -
                    Number(
                        allocation.allocated_ram_mb || 0
                    )
            },

            localStorageGb: {

                total:
                    Number(
                        node.total_local_storage_gb
                    ),

                allocated:
                    Number(
                        allocation
                            .allocated_local_storage_gb || 0
                    ),

                available:
                    Number(
                        node.total_local_storage_gb
                    ) -
                    Number(
                        allocation
                            .allocated_local_storage_gb || 0
                    )
            },

            ssdStorageGb: {

                total:
                    Number(
                        node.total_ssd_storage_gb
                    ),

                allocated:
                    Number(
                        allocation
                            .allocated_ssd_storage_gb || 0
                    ),

                available:
                    Number(
                        node.total_ssd_storage_gb
                    ) -
                    Number(
                        allocation
                            .allocated_ssd_storage_gb || 0
                    )
            }
        };
    }


    /**
     * Check whether a node can satisfy
     * a resource request.
     */
    hasCapacity(
        resources,
        request
    ) {

        const cpu =
            Number(
                request.cpu || 0
            );

        const ramMb =
            Number(
                request.ramMb || 0
            );

        const storageGb =
            Number(
                request.storageGb || 0
            );

        const storageType =
            request.storageType ||
            "local";


        if (
            resources.cpu.available <
            cpu
        ) {

            return false;
        }


        if (
            resources.ramMb.available <
            ramMb
        ) {

            return false;
        }


        if (
            storageType === "local"
        ) {

            return (
                resources
                    .localStorageGb
                    .available >=
                storageGb
            );
        }


        if (
            storageType === "ssd"
        ) {

            return (
                resources
                    .ssdStorageGb
                    .available >=
                storageGb
            );
        }


        throw new Error(
            `Unsupported storage type: ${storageType}`
        );
    }


    /**
     * Find an enabled node that can
     * satisfy the request.
     */
    async findNode(
        request,
        connection = pool
    ) {

        const serviceType =
            request.serviceType;


        const [nodes] =
            await connection.execute(
                `
                SELECT
                    n.id,
                    n.name
                FROM nodes n
                WHERE n.enabled = TRUE
                ORDER BY n.id ASC
                `
            );


        for (
            const node of nodes
        ) {

            if (
                serviceType ===
                "compute"
            ) {

                const [templates] =
                    await connection.execute(
                        `
                        SELECT id
                        FROM templates
                        WHERE node_id = ?
                          AND service_type = 'compute'
                          AND enabled = TRUE
                        LIMIT 1
                        `,
                        [node.id]
                    );


                if (
                    templates.length === 0
                ) {

                    continue;
                }
            }


            const resources =
                await this.getNodeResources(
                    node.id,
                    connection
                );


            if (
                this.hasCapacity(
                    resources,
                    request
                )
            ) {

                return {

                    nodeId:
                        Number(node.id),

                    nodeName:
                        node.name,

                    resources
                };
            }
        }


        return null;
    }


    /**
     * Allocate resources.
     *
     * Supports both:
     *
     * allocate({
     *     serviceId,
     *     ...
     * })
     *
     * and:
     *
     * allocate(
     *     connection,
     *     {
     *         serviceId,
     *         ...
     *     }
     * )
     *
     * This keeps the allocator compatible with
     * the current ServiceManager transaction.
     */
    async allocate(
        firstArgument,
        secondArgument = null
    ) {

        let options;
        let connection = null;


        /*
         * Current ServiceManager format:
         *
         * allocate(connection, options)
         */
        if (
            firstArgument &&
            typeof firstArgument.execute ===
                "function" &&
            secondArgument &&
            typeof secondArgument ===
                "object"
        ) {

            connection =
                firstArgument;

            options =
                secondArgument;

        } else {

            /*
             * Original format:
             *
             * allocate(options)
             */
            options =
                firstArgument;
        }


        if (
            !options ||
            typeof options !== "object"
        ) {

            throw new Error(
                "Resource allocation request is invalid"
            );
        }


        const {

            serviceId,

            serviceType,

            cpu = 0,

            ramMb = 0,

            storageGb = 0,

            storageType = "local",

            preferredNodeId = null,

            description = null

        } = options;


        const externalConnection =
            Boolean(connection);


        if (!connection) {

            connection =
                await pool.getConnection();
        }


        try {

            if (!externalConnection) {

                await connection.beginTransaction();
            }


            let node = null;


            /*
             * Preferred node.
             */
            if (
                preferredNodeId !== null &&
                preferredNodeId !== undefined
            ) {

                const [rows] =
                    await connection.execute(
                        `
                        SELECT
                            id,
                            name
                        FROM nodes
                        WHERE id = ?
                          AND enabled = TRUE
                        FOR UPDATE
                        `,
                        [preferredNodeId]
                    );


                if (
                    rows.length === 0
                ) {

                    throw new Error(
                        `Preferred node ${preferredNodeId} is unavailable`
                    );
                }


                node =
                    rows[0];


                if (
                    serviceType ===
                    "compute"
                ) {

                    const [templates] =
                        await connection.execute(
                            `
                            SELECT id
                            FROM templates
                            WHERE node_id = ?
                              AND service_type = 'compute'
                              AND enabled = TRUE
                            LIMIT 1
                            `,
                            [node.id]
                        );


                    if (
                        templates.length === 0
                    ) {

                        throw new Error(
                            `No compute template available on node ${node.name}`
                        );
                    }
                }

            } else {

                /*
                 * Select and lock enabled nodes.
                 */
                const [nodes] =
                    await connection.execute(
                        `
                        SELECT
                            id,
                            name
                        FROM nodes
                        WHERE enabled = TRUE
                        ORDER BY id ASC
                        FOR UPDATE
                        `
                    );


                for (
                    const candidate of nodes
                ) {

                    if (
                        serviceType ===
                        "compute"
                    ) {

                        const [templates] =
                            await connection.execute(
                                `
                                SELECT id
                                FROM templates
                                WHERE node_id = ?
                                  AND service_type = 'compute'
                                  AND enabled = TRUE
                                LIMIT 1
                                `,
                                [candidate.id]
                            );


                        if (
                            templates.length === 0
                        ) {

                            continue;
                        }
                    }


                    const resources =
                        await this.getNodeResources(
                            candidate.id,
                            connection
                        );


                    if (
                        this.hasCapacity(
                            resources,
                            {

                                cpu,

                                ramMb,

                                storageGb,

                                storageType
                            }
                        )
                    ) {

                        node =
                            candidate;

                        break;
                    }
                }
            }


            if (!node) {

                throw new Error(
                    "No node has sufficient resources for this request"
                );
            }


            /*
             * Final capacity check.
             */
            const resources =
                await this.getNodeResources(
                    node.id,
                    connection
                );


            if (
                !this.hasCapacity(
                    resources,
                    {

                        cpu,

                        ramMb,

                        storageGb,

                        storageType
                    }
                )
            ) {

                throw new Error(
                    `Insufficient resources on node ${node.name}`
                );
            }


            /*
             * Create allocation.
             */
            const [result] =
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

                        description,

                        status

                    )
                    VALUES (

                        ?,

                        ?,

                        ?,

                        ?,

                        ?,

                        ?,

                        'service',

                        ?,

                        'active'
                    )
                    `,
                    [

                        serviceId,

                        node.id,

                        Number(cpu),

                        Number(ramMb),

                        Number(storageGb),

                        storageType,

                        description
                    ]
                );


            /*
             * Make service point to
             * selected node.
             */
            await connection.execute(
                `
                UPDATE services

                SET node_id = ?

                WHERE id = ?
                `,
                [

                    node.id,

                    serviceId
                ]
            );


            if (!externalConnection) {

                await connection.commit();
            }


            return {

                allocationId:
                    result.insertId,

                serviceId,

                nodeId:
                    Number(node.id),

                nodeName:
                    node.name,

                cpu:
                    Number(cpu),

                ramMb:
                    Number(ramMb),

                storageGb:
                    Number(storageGb),

                storageType
            };


        } catch (error) {

            if (
                !externalConnection
            ) {

                try {

                    await connection.rollback();

                } catch (
                    rollbackError
                ) {

                    console.error(
                        "Allocator rollback failed:",
                        rollbackError
                    );
                }
            }


            throw error;


        } finally {

            if (
                !externalConnection
            ) {

                connection.release();
            }
        }
    }


    /**
     * Release all active allocations
     * belonging to a service.
     */
    async releaseService(
        serviceId
    ) {

        const connection =
            await pool.getConnection();


        try {

            await connection.beginTransaction();


            const [result] =
                await connection.execute(
                    `
                    UPDATE allocations

                    SET

                        status =
                            'released',

                        released_at =
                            CURRENT_TIMESTAMP

                    WHERE

                        service_id = ?

                        AND status =
                            'active'
                    `,
                    [
                        serviceId
                    ]
                );


            await connection.commit();


            return {

                serviceId,

                released:
                    result.affectedRows
            };


        } catch (error) {

            try {

                await connection.rollback();

            } catch (
                rollbackError
            ) {

                console.error(
                    "Release rollback failed:",
                    rollbackError
                );
            }


            throw error;


        } finally {

            connection.release();
        }
    }


    /**
     * Get all node resource snapshots.
     */
    async getResourceSnapshot() {

        const [nodes] =
            await pool.execute(
                `
                SELECT
                    id
                FROM nodes
                ORDER BY id ASC
                `
            );


        const resources = [];


        for (
            const node of nodes
        ) {

            resources.push(
                await this.getNodeResources(
                    node.id
                )
            );
        }


        return resources;
    }
}


module.exports =
    new ResourceAllocator();