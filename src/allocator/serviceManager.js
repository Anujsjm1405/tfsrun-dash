const pool = require("../db/mysql");

const {
    getProxmoxClient
} = require("../proxmox");

const resourceAllocator =
    require("./resourceAllocator");


/* =========================================================
   COMPUTE LIMITS
========================================================= */

const ALLOWED_CPU = [
    1,
    2,
    4
];

const ALLOWED_RAM_MB = [
    2048,
    4096,
    6144
];

const ALLOWED_STORAGE_GB = [
    32,
    64,
    128
];


/* =========================================================
   VALIDATE COMPUTE REQUEST
========================================================= */

function validateComputeRequest(
    data
) {

    const {

        name,

        ramMb,

        ram,

        cpu,

        storageGb,

        storage,

        storageType,

        username,

        password

    } = data;


    const cpuValue =
        Number(cpu);


    let ramValue;


    if (
        ramMb !== undefined &&
        ramMb !== null
    ) {

        ramValue =
            Number(ramMb);

    } else {

        ramValue =
            Number(ram) * 1024;
    }


    const storageValue =
        Number(

            storageGb !== undefined &&
            storageGb !== null

                ? storageGb

                : storage
        );


    if (
        !name ||
        typeof name !== "string" ||
        name.trim().length < 1 ||
        name.trim().length > 100
    ) {

        throw new Error(
            "Invalid VM name"
        );
    }


    if (
        !ALLOWED_CPU.includes(
            cpuValue
        )
    ) {

        throw new Error(
            "CPU must be 1, 2, or 4 cores"
        );
    }


    if (
        !ALLOWED_RAM_MB.includes(
            ramValue
        )
    ) {

        throw new Error(
            "RAM must be 2, 4, or 6 GB"
        );
    }


    if (
        !ALLOWED_STORAGE_GB.includes(
            storageValue
        )
    ) {

        throw new Error(
            "Storage must be 32, 64, or 128 GB"
        );
    }


    const normalizedStorageType =
        storageType ||
        "local";


    if (
        normalizedStorageType !==
            "local" &&

        normalizedStorageType !==
            "ssd"
    ) {

        throw new Error(
            "Invalid storage type"
        );
    }


    if (
        !username ||
        typeof username !== "string" ||
        username.trim().length < 1
    ) {

        throw new Error(
            "Username is required"
        );
    }


    if (
        !password ||
        typeof password !== "string" ||
        password.length < 4
    ) {

        throw new Error(
            "Password must contain at least 4 characters"
        );
    }


    return {

        name:
            name.trim(),

        cpu:
            cpuValue,

        ramMb:
            ramValue,

        storageGb:
            storageValue,

        storageType:
            normalizedStorageType,

        username:
            username.trim(),

        password
    };
}


/* =========================================================
   VM NAME SANITIZATION
========================================================= */

function sanitizeVMName(
    name
) {

    return name

        .trim()

        .replace(
            /[^a-zA-Z0-9._-]/g,
            "-"
        )

        .replace(
            /-+/g,
            "-"
        )

        .substring(
            0,
            80
        );
}


/* =========================================================
   GET SINGLE SERVICE
========================================================= */

async function getService(
    serviceId
) {

    const [rows] =
        await pool.execute(

            `
            SELECT

                s.id,

                s.service_type,

                s.name,

                s.owner_id,

                s.node_id,

                s.vmid,

                s.ip_address,

                s.status,

                s.created_at,

                s.updated_at,

                n.name AS node_name,

                n.host AS node_host,

                COALESCE(
                    (
                        SELECT
                            a.cpu
                        FROM allocations a
                        WHERE
                            a.service_id =
                                s.id
                            AND a.status =
                                'active'
                        ORDER BY
                            a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS cpu,

                COALESCE(
                    (
                        SELECT
                            a.ram_mb
                        FROM allocations a
                        WHERE
                            a.service_id =
                                s.id
                            AND a.status =
                                'active'
                        ORDER BY
                            a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS ram_mb,

                COALESCE(
                    (
                        SELECT
                            a.storage_gb
                        FROM allocations a
                        WHERE
                            a.service_id =
                                s.id
                            AND a.status =
                                'active'
                        ORDER BY
                            a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS storage_gb,

                (
                    SELECT
                        a.storage_type
                    FROM allocations a
                    WHERE
                        a.service_id =
                            s.id
                    ORDER BY
                        a.id DESC
                    LIMIT 1
                ) AS storage_type

            FROM services s

            INNER JOIN nodes n

                ON n.id =
                    s.node_id

            WHERE
                s.id = ?

            LIMIT 1
            `,

            [
                serviceId
            ]
        );


    return (
        rows[0] ||
        null
    );
}


/* =========================================================
   GET ACTIVE SERVICES
========================================================= */

async function getServices(
    ownerId = null
) {

    let sql = `

        SELECT

            s.id,

            s.service_type,

            s.name,

            s.owner_id,

            s.node_id,

            s.vmid,

            s.ip_address,

            s.status,

            s.created_at,

            s.updated_at,

            n.name AS node_name,

            COALESCE(
                (
                    SELECT
                        a.cpu
                    FROM allocations a
                    WHERE
                        a.service_id =
                            s.id
                        AND a.status =
                            'active'
                    ORDER BY
                        a.id DESC
                    LIMIT 1
                ),
                0
            ) AS cpu,

            COALESCE(
                (
                    SELECT
                        a.ram_mb
                    FROM allocations a
                    WHERE
                        a.service_id =
                            s.id
                        AND a.status =
                            'active'
                    ORDER BY
                        a.id DESC
                    LIMIT 1
                ),
                0
            ) AS ram_mb,

            COALESCE(
                (
                    SELECT
                        a.storage_gb
                    FROM allocations a
                    WHERE
                        a.service_id =
                            s.id
                        AND a.status =
                            'active'
                    ORDER BY
                        a.id DESC
                    LIMIT 1
                ),
                0
            ) AS storage_gb,

            (
                SELECT
                    a.storage_type
                FROM allocations a
                WHERE
                    a.service_id =
                        s.id
                ORDER BY
                    a.id DESC
                LIMIT 1
            ) AS storage_type

        FROM services s

        INNER JOIN nodes n

            ON n.id =
                s.node_id

        WHERE
            s.status <>
                'deleted'
    `;


    const params = [];


    if (
        ownerId !== null
    ) {

        sql += `

            AND s.owner_id = ?

        `;

        params.push(
            ownerId
        );
    }


    sql += `

        ORDER BY
            s.created_at DESC

    `;


    const [rows] =
        await pool.execute(
            sql,
            params
        );


    return rows;
}


/* =========================================================
   GET SERVICE HISTORY
========================================================= */

async function getServiceHistory(
    ownerId = null
) {

    let sql = `

        SELECT

            s.id,

            s.service_type,

            s.name,

            s.owner_id,

            s.node_id,

            s.vmid,

            s.ip_address,

            s.status,

            s.created_at,

            s.updated_at,

            n.name AS node_name,

            COALESCE(
                (
                    SELECT
                        a.cpu
                    FROM allocations a
                    WHERE
                        a.service_id =
                            s.id
                    ORDER BY
                        a.id DESC
                    LIMIT 1
                ),
                0
            ) AS cpu,

            COALESCE(
                (
                    SELECT
                        a.ram_mb
                    FROM allocations a
                    WHERE
                        a.service_id =
                            s.id
                    ORDER BY
                        a.id DESC
                    LIMIT 1
                ),
                0
            ) AS ram_mb,

            COALESCE(
                (
                    SELECT
                        a.storage_gb
                    FROM allocations a
                    WHERE
                        a.service_id =
                            s.id
                    ORDER BY
                        a.id DESC
                    LIMIT 1
                ),
                0
            ) AS storage_gb,

            (
                SELECT
                    a.storage_type
                FROM allocations a
                WHERE
                    a.service_id =
                        s.id
                ORDER BY
                    a.id DESC
                LIMIT 1
            ) AS storage_type

        FROM services s

        INNER JOIN nodes n

            ON n.id =
                s.node_id

        WHERE
            s.status =
                'deleted'
    `;


    const params = [];


    if (
        ownerId !== null
    ) {

        sql += `

            AND s.owner_id = ?

        `;

        params.push(
            ownerId
        );
    }


    sql += `

        ORDER BY
            s.updated_at DESC,
            s.id DESC

    `;


    const [rows] =
        await pool.execute(
            sql,
            params
        );


    return rows;
}


/* =========================================================
   GET NODE
========================================================= */

async function getNodeById(
    connection,
    nodeId
) {

    const [rows] =
        await connection.execute(

            `
            SELECT *

            FROM nodes

            WHERE id = ?

            LIMIT 1
            `,

            [
                nodeId
            ]
        );


    return (
        rows[0] ||
        null
    );
}


/* =========================================================
   CREATE COMPUTE SERVICE
========================================================= */

async function createComputeService(
    data,
    ownerId
) {

    const effectiveOwnerId =

        ownerId !== undefined &&
        ownerId !== null

            ? ownerId

            : data.ownerId;


    if (
        effectiveOwnerId ===
            undefined ||

        effectiveOwnerId ===
            null
    ) {

        throw new Error(
            "Owner ID is required"
        );
    }


    const request =
        validateComputeRequest(
            data
        );


    let connection =
        null;

    let serviceId =
        null;

    let vmid =
        null;

    let node =
        null;


    try {

        connection =
            await pool.getConnection();


        await connection.beginTransaction();


        /*
         * Create the service first.
         *
         * The allocator will select the
         * actual suitable node.
         */

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

                VALUES (

                    'compute',

                    ?,

                    ?,

                    1,

                    'provisioning'
                )
                `,

                [

                    request.name,

                    effectiveOwnerId
                ]
            );


        serviceId =
            serviceResult.insertId;


        /*
         * IMPORTANT FIX:
         *
         * ResourceAllocator expects the
         * connection and allocation options.
         */

        const allocation =
            await resourceAllocator.allocate(

                connection,

                {

                    serviceId,

                    serviceType:
                        "compute",

                    cpu:
                        request.cpu,

                    ramMb:
                        request.ramMb,

                    storageGb:
                        request.storageGb,

                    storageType:
                        request.storageType,

                    description:
                        `Compute VM ${request.name}`
                }
            );


        /*
         * Get actual selected node.
         */

        node =
            await getNodeById(

                connection,

                allocation.nodeId
            );


        if (!node) {

            throw new Error(
                "Allocated node could not be found"
            );
        }


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


        /*
         * Commit database allocation.
         */

        await connection.commit();


        connection.release();

        connection =
            null;


        /* =================================================
           PROXMOX
        ================================================= */

        const proxmox =
            getProxmoxClient(
                node.name
            );


        /*
         * Find node-local compute template.
         */

        const [templates] =
            await pool.execute(

                `
                SELECT

                    vmid,

                    storage_gb

                FROM templates

                WHERE

                    node_id = ?

                    AND service_type =
                        'compute'

                    AND enabled =
                        TRUE

                ORDER BY
                    id ASC

                LIMIT 1
                `,

                [
                    node.id
                ]
            );


        if (
            templates.length === 0
        ) {

            throw new Error(
                `No compute template configured for ${node.name}`
            );
        }


        const template =
            templates[0];


        /*
         * Get new VM ID.
         */

        vmid =
            await proxmox.getNextVMID();


        const vmName =
            sanitizeVMName(

                `${request.name}-${serviceId}`
            );


        /*
         * Clone template.
         */

        const cloneTask =
            await proxmox.cloneVM(

                template.vmid,

                vmid,

                vmName
            );


        if (cloneTask) {

            await proxmox.waitForTask(
                cloneTask
            );
        }


        /*
         * Configure VM.
         */

        await proxmox.configureVM(

            vmid,

            {

                cores:
                    request.cpu,

                memoryMb:
                    request.ramMb,

                username:
                    request.username,

                password:
                    request.password
            }
        );


        /*
         * Resize disk if required.
         */

        const templateStorage =
            Number(
                template.storage_gb || 32
            );


        const additionalStorage =

            request.storageGb -
            templateStorage;


        if (
            additionalStorage > 0
        ) {

            await proxmox.resizeDisk(

                vmid,

                "scsi0",

                additionalStorage
            );
        }


        /*
         * Store VM ID.
         */

        await pool.execute(

            `
            UPDATE services

            SET vmid = ?

            WHERE id = ?
            `,

            [

                vmid,

                serviceId
            ]
        );


        /*
         * Start VM.
         */

        const startTask =
            await proxmox.startVM(
                vmid
            );


        if (startTask) {

            await proxmox.waitForTask(
                startTask
            );
        }


        /*
         * Wait for Guest Agent.
         */

        await proxmox.waitForGuestAgent(
            vmid
        );


        /*
         * Get IPv4.
         */

        const ip =
            await proxmox.waitForVMIPv4(
                vmid
            );


        /*
         * Mark active.
         */

        await pool.execute(

            `
            UPDATE services

            SET

                ip_address = ?,

                status =
                    'active'

            WHERE id = ?
            `,

            [

                ip,

                serviceId
            ]
        );


        return await getService(
            serviceId
        );


    } catch (error) {

        /*
         * Roll back open DB transaction.
         */

        if (connection) {

            try {

                await connection.rollback();

            } catch (_) {}


            connection.release();

            connection =
                null;
        }


        console.error(

            `Compute provisioning failed for service ` +
            `${serviceId || "unknown"}:`,

            error.message
        );


        /*
         * Remove partially-created Proxmox VM.
         */

        if (
            vmid &&
            node
        ) {

            try {

                const proxmox =
                    getProxmoxClient(
                        node.name
                    );


                try {

                    const status =
                        await proxmox.getVMStatus(
                            vmid
                        );


                    if (
                        status ===
                        "running"
                    ) {

                        const stopTask =
                            await proxmox.stopVM(
                                vmid
                            );


                        if (stopTask) {

                            await proxmox.waitForTask(
                                stopTask
                            );
                        }
                    }

                } catch (_) {}


                try {

                    await proxmox.deleteVM(
                        vmid
                    );

                } catch (_) {}

            } catch (_) {}
        }


        /*
         * Release allocation and mark
         * service failed.
         */

        if (
            serviceId
        ) {

            try {

                const cleanupConnection =
                    await pool.getConnection();


                try {

                    await cleanupConnection
                        .beginTransaction();


                    await cleanupConnection.execute(

                        `
                        UPDATE allocations

                        SET

                            status =
                                'released',

                            released_at =
                                NOW()

                        WHERE

                            service_id = ?

                            AND status =
                                'active'
                        `,

                        [
                            serviceId
                        ]
                    );


                    await cleanupConnection.execute(

                        `
                        UPDATE services

                        SET status =
                            'failed'

                        WHERE id = ?
                        `,

                        [
                            serviceId
                        ]
                    );


                    await cleanupConnection
                        .commit();

                } catch (
                    cleanupError
                ) {

                    try {

                        await cleanupConnection
                            .rollback();

                    } catch (_) {}

                } finally {

                    cleanupConnection
                        .release();
                }

            } catch (_) {}
        }


        throw error;
    }
}


/* =========================================================
   STOP SERVICE
========================================================= */

async function stopService(
    serviceId
) {

    const service =
        await getService(
            serviceId
        );


    if (!service) {

        throw new Error(
            "Service not found"
        );
    }


    if (!service.vmid) {

        throw new Error(
            "Service does not have a VM"
        );
    }


    const proxmox =
        getProxmoxClient(
            service.node_name
        );


    const status =
        await proxmox.getVMStatus(
            service.vmid
        );


    if (
        status ===
        "running"
    ) {

        const task =
            await proxmox.stopVM(
                service.vmid
            );


        if (task) {

            await proxmox.waitForTask(
                task
            );
        }
    }


    /*
     * IMPORTANT:
     *
     * Stopping a VM does NOT release
     * its resources.
     */

    await pool.execute(

        `
        UPDATE services

        SET status =
            'stopped'

        WHERE id = ?
        `,

        [
            serviceId
        ]
    );


    return getService(
        serviceId
    );
}


/* =========================================================
   START SERVICE
========================================================= */

async function startService(
    serviceId
) {

    const service =
        await getService(
            serviceId
        );


    if (!service) {

        throw new Error(
            "Service not found"
        );
    }


    if (!service.vmid) {

        throw new Error(
            "Service does not have a VM"
        );
    }


    const proxmox =
        getProxmoxClient(
            service.node_name
        );


    const status =
        await proxmox.getVMStatus(
            service.vmid
        );


    if (
        status !==
        "running"
    ) {

        const task =
            await proxmox.startVM(
                service.vmid
            );


        if (task) {

            await proxmox.waitForTask(
                task
            );
        }
    }


    await proxmox.waitForGuestAgent(
        service.vmid
    );


    const ip =
        await proxmox.waitForVMIPv4(
            service.vmid
        );


    await pool.execute(

        `
        UPDATE services

        SET

            ip_address = ?,

            status =
                'active'

        WHERE id = ?
        `,

        [

            ip,

            serviceId
        ]
    );


    return getService(
        serviceId
    );
}


/* =========================================================
   DELETE SERVICE
========================================================= */

async function deleteService(
    serviceId
) {

    const service =
        await getService(
            serviceId
        );


    if (!service) {

        throw new Error(
            "Service not found"
        );
    }


    if (
        service.status ===
        "deleted"
    ) {

        return service;
    }


    await pool.execute(

        `
        UPDATE services

        SET status =
            'deleting'

        WHERE id = ?
        `,

        [
            serviceId
        ]
    );


    try {

        /*
         * Delete Proxmox VM.
         */

        if (
            service.vmid &&
            service.node_name
        ) {

            const proxmox =
                getProxmoxClient(
                    service.node_name
                );


            try {

                const status =
                    await proxmox.getVMStatus(
                        service.vmid
                    );


                if (
                    status ===
                    "running"
                ) {

                    const task =
                        await proxmox.stopVM(
                            service.vmid
                        );


                    if (task) {

                        await proxmox.waitForTask(
                            task
                        );
                    }
                }

            } catch (error) {

                if (
                    !error.message.includes(
                        "does not exist"
                    ) &&

                    !error.message.includes(
                        "Configuration file"
                    )
                ) {

                    throw error;
                }
            }


            try {

                await proxmox.deleteVM(
                    service.vmid
                );

            } catch (error) {

                if (
                    !error.message.includes(
                        "does not exist"
                    ) &&

                    !error.message.includes(
                        "Configuration file"
                    )
                ) {

                    throw error;
                }
            }
        }


        /*
         * Release resources ONLY when
         * the service is actually deleted.
         */

        await pool.execute(

            `
            UPDATE allocations

            SET

                status =
                    'released',

                released_at =
                    NOW()

            WHERE

                service_id = ?

                AND status =
                    'active'
            `,

            [
                serviceId
            ]
        );


        /*
         * Keep the service record for History.
         */

        await pool.execute(

            `
            UPDATE services

            SET status =
                'deleted'

            WHERE id = ?
            `,

            [
                serviceId
            ]
        );


        return getService(
            serviceId
        );


    } catch (error) {

        await pool.execute(

            `
            UPDATE services

            SET status =
                'failed'

            WHERE id = ?
            `,

            [
                serviceId
            ]
        );


        throw error;
    }
}


/* =========================================================
   EXPORTS
========================================================= */

module.exports = {

    validateComputeRequest,

    getService,

    getServices,

    getServiceHistory,

    createComputeService,

    startService,

    stopService,

    deleteService,

    getNodeById
};
