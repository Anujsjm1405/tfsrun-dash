const pool = require("../db/mysql");

const { Client } = require("pg");
const crypto = require("crypto");

const {
    getLxcClient
} = require("./lxcIndex");

const resourceAllocator =
    require("../allocator/resourceAllocator");


/* =========================================================
   DATABASE SERVICE LIMITS
========================================================= */

const ALLOWED_CPU = [
    1,
    2
];

const ALLOWED_RAM_MB = [
    512,
    1024,
    2048
];

const ALLOWED_STORAGE_GB = [
    8,
    16,
    32
];


/*
 * Superuser password baked into the database template. The backend
 * uses it to connect to a freshly cloned container and create the
 * student's own login role.
 *
 * This exists because the Proxmox API cannot execute commands
 * inside an LXC container (there is no LXC equivalent of the QEMU
 * guest agent), so provisioning happens over the network instead.
 */
const BOOTSTRAP_USER = "postgres";

const BOOTSTRAP_PASSWORD =
    process.env.DB_BOOTSTRAP_PASSWORD;


/* =========================================================
   VALIDATION
========================================================= */

/*
 * Identifiers are interpolated into SQL DDL, which cannot use
 * bound parameters for object names. They are therefore held to a
 * strict allowlist rather than being escaped.
 */
function isSafeIdentifier(value) {
    return /^[a-z_][a-z0-9_]{2,30}$/.test(value);
}


function isSafePassword(value) {
    return (
        typeof value === "string" &&
        value.length >= 6 &&
        value.length <= 64 &&
        !/['"\\\s]/.test(value)
    );
}


function validateDatabaseRequest(data) {

    const {
        name,
        dbUser,
        dbPassword,
        cpu,
        ramMb,
        storageGb
    } = data;

    const cpuValue = Number(cpu);
    const ramValue = Number(ramMb);
    const storageValue = Number(storageGb);

    if (
        !name ||
        typeof name !== "string" ||
        name.trim().length < 1 ||
        name.trim().length > 100
    ) {
        throw new Error(
            "Invalid database service name"
        );
    }

    if (!isSafeIdentifier(dbUser)) {
        throw new Error(
            "Database username must be 3-31 characters, lowercase letters, digits or underscore, and start with a letter or underscore"
        );
    }

    if (!isSafePassword(dbPassword)) {
        throw new Error(
            "Database password must be 6-64 characters and contain no spaces, quotes or backslashes"
        );
    }

    if (!ALLOWED_CPU.includes(cpuValue)) {
        throw new Error(
            "CPU must be 1 or 2 cores"
        );
    }

    if (!ALLOWED_RAM_MB.includes(ramValue)) {
        throw new Error(
            "RAM must be 512, 1024 or 2048 MB"
        );
    }

    if (!ALLOWED_STORAGE_GB.includes(storageValue)) {
        throw new Error(
            "Storage must be 8, 16 or 32 GB"
        );
    }

    return {
        name: name.trim(),
        dbUser,
        dbPassword,
        cpu: cpuValue,
        ramMb: ramValue,
        storageGb: storageValue
    };
}


function sanitizeHostname(name) {

    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .substring(0, 50) || "db";
}


/*
 * Confirms the container currently assigned to this service's
 * stored vmid is actually the one created for it, by checking that
 * its Proxmox hostname still contains this service's own ID.
 *
 * Container IDs are recycled by Proxmox once destroyed. If a
 * service's stored vmid is ever stale (for example, a leftover
 * reference on a service whose container was destroyed through
 * some path that did not clear it), that ID could by now belong to
 * a completely different, unrelated, live database. Every
 * start/stop/delete action checks this first rather than trusting
 * the stored vmid blindly.
 */
async function verifyContainerOwnership(lxc, vmid, serviceId) {

    let hostname = null;

    try {
        hostname = await lxc.getHostname(vmid);
    } catch (error) {
        throw new Error(
            `Could not verify container ${vmid} before acting on it: ${error.message}`
        );
    }

    const expectedSuffix = `-${serviceId}`;

    if (!hostname || !hostname.endsWith(expectedSuffix)) {

        throw new Error(
            `Container ${vmid} does not appear to belong to this ` +
            `service (hostname was "${hostname}"). Refusing to act ` +
            `on it to avoid touching the wrong container.`
        );
    }
}


/* =========================================================
   HELPERS
========================================================= */

async function getNodeById(connection, nodeId) {

    const [rows] =
        await connection.execute(
            `
            SELECT *
            FROM nodes
            WHERE id = ?
            LIMIT 1
            `,
            [nodeId]
        );

    return rows[0] || null;
}


/*
 * A database service plus its instance details and node, scoped so
 * callers can check ownership before acting on it.
 */
async function getDatabaseService(serviceId) {

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

                d.db_user,
                d.db_password,
                d.db_port,

                COALESCE(
                    (
                        SELECT a.cpu
                        FROM allocations a
                        WHERE a.service_id = s.id
                          AND a.status = 'active'
                        ORDER BY a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS cpu,

                COALESCE(
                    (
                        SELECT a.ram_mb
                        FROM allocations a
                        WHERE a.service_id = s.id
                          AND a.status = 'active'
                        ORDER BY a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS ram_mb,

                COALESCE(
                    (
                        SELECT a.storage_gb
                        FROM allocations a
                        WHERE a.service_id = s.id
                          AND a.status = 'active'
                        ORDER BY a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS storage_gb

            FROM services s

            INNER JOIN nodes n
                ON n.id = s.node_id

            LEFT JOIN database_instances d
                ON d.service_id = s.id

            WHERE s.id = ?
              AND s.service_type = 'database'

            LIMIT 1
            `,
            [serviceId]
        );

    return rows[0] || null;
}


async function fetchDatabaseServiceRows(ownerId) {

    const [rows] =
        await pool.execute(
            `
            SELECT
                s.id,
                s.name,
                s.node_id,
                s.vmid,
                s.ip_address,
                s.status,
                s.created_at,

                n.name AS node_name,

                d.db_user,
                d.db_port,

                COALESCE(
                    (
                        SELECT a.cpu
                        FROM allocations a
                        WHERE a.service_id = s.id
                          AND a.status = 'active'
                        ORDER BY a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS cpu,

                COALESCE(
                    (
                        SELECT a.ram_mb
                        FROM allocations a
                        WHERE a.service_id = s.id
                          AND a.status = 'active'
                        ORDER BY a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS ram_mb,

                COALESCE(
                    (
                        SELECT a.storage_gb
                        FROM allocations a
                        WHERE a.service_id = s.id
                          AND a.status = 'active'
                        ORDER BY a.id DESC
                        LIMIT 1
                    ),
                    0
                ) AS storage_gb

            FROM services s

            INNER JOIN nodes n
                ON n.id = s.node_id

            LEFT JOIN database_instances d
                ON d.service_id = s.id

            WHERE s.owner_id = ?
              AND s.service_type = 'database'
              AND s.status <> 'deleted'

            ORDER BY s.id DESC
            `,
            [ownerId]
        );

    return rows;
}


/*
 * Checks each listed service's container against Proxmox and cleans
 * up any whose container no longer matches - for example, one
 * destroyed directly in Proxmox outside the app, bypassing the
 * normal delete flow entirely. Reuses deleteDatabaseService rather
 * than duplicating its cleanup logic, so a reconciled entry gets
 * exactly the same safe handling (allocation released, credentials
 * dropped, status updated) as an explicit delete would give it -
 * including refusing to touch a container whose hostname does not
 * match, the same protection verifyContainerOwnership always gives.
 *
 * Runs on every list/refresh call. With the small number of
 * instances a student has, the extra Proxmox lookups are cheap and
 * only happen on a page load or an explicit Refresh click - there is
 * no background polling in this UI to make this run more often than
 * that.
 */
async function reconcileServiceStatuses(services) {

    for (const service of services) {

        if (
            !service.vmid ||
            (
                service.status !== "active" &&
                service.status !== "stopped"
            )
        ) {
            continue;
        }

        try {

            const lxc =
                getLxcClient(service.node_name);

            await verifyContainerOwnership(
                lxc,
                service.vmid,
                service.id
            );

        } catch (error) {

            console.error(
                `Reconcile: service ${service.id}'s container ` +
                `${service.vmid} failed ownership check, cleaning ` +
                `up its record: ${error.message}`
            );

            try {
                await deleteDatabaseService(service.id);
            } catch (cleanupError) {
                console.error(
                    `Reconcile: cleanup for service ${service.id} ` +
                    `failed: ${cleanupError.message}`
                );
            }
        }
    }
}


async function getDatabaseServices(ownerId) {

    const rows =
        await fetchDatabaseServiceRows(ownerId);

    await reconcileServiceStatuses(rows);

    /*
     * Re-fetch rather than patch the in-memory rows, since
     * reconciliation may have changed status, released an
     * allocation, or (for a genuinely deleted service) removed the
     * row from this filtered result entirely.
     */
    return await fetchDatabaseServiceRows(ownerId);
}


/*
 * Connect to a freshly cloned container as the template's bootstrap
 * superuser and create the student's own login role.
 *
 * CREATEDB is granted, not SUPERUSER: it lets the student create as
 * many databases as they like inside their own instance (their
 * disk allocation is the real ceiling), without giving them control
 * over PostgreSQL internals.
 *
 * No starter database is created here. The student connects to the
 * default "postgres" database first and runs CREATE DATABASE
 * themselves, the same way a real managed Postgres service expects
 * you to once you have a login.
 *
 * Password rotation: every container is cloned from the same
 * template, so it starts out with the same baked-in bootstrap
 * password. The very first thing this function does - before
 * creating the student's account - is log in with that shared
 * password and immediately change it to a fresh, random one that is
 * never stored or shown anywhere. From that point on, the shared
 * template password no longer works against this container, so a
 * leak of it can only ever affect a container in the brief window
 * before this rotation runs, never one that is already in use.
 */
function generateRandomPassword() {

    // 32 random bytes, base64url-encoded, trimmed to 40 chars.
    // Only used transiently in memory - never persisted.
    return crypto
        .randomBytes(32)
        .toString("base64url")
        .slice(0, 40);
}


async function provisionPostgres(
    host,
    port,
    dbUser,
    dbPassword
) {

    if (!BOOTSTRAP_PASSWORD) {
        throw new Error(
            "DB_BOOTSTRAP_PASSWORD is not configured"
        );
    }

    const client = new Client({
        host,
        port,
        user: BOOTSTRAP_USER,
        password: BOOTSTRAP_PASSWORD,
        database: "postgres",
        connectionTimeoutMillis: 10000
    });

    await client.connect();

    try {

        // ALTER/CREATE USER's PASSWORD clause requires a literal
        // value written directly into the statement - PostgreSQL's
        // grammar does not accept a bound parameter ($1) there, only
        // for ordinary VALUES/WHERE-style queries. This is safe to
        // interpolate directly because both dbPassword and the
        // generated rotatedPassword are restricted to characters
        // that exclude quotes and backslashes (see isSafePassword
        // and generateRandomPassword), so no escaping gap exists.
        const rotatedPassword =
            generateRandomPassword();

        await client.query(
            `ALTER USER ${BOOTSTRAP_USER} PASSWORD '${rotatedPassword}'`
        );

        // dbUser is allowlisted by validateDatabaseRequest; dbPassword
        // is restricted by isSafePassword to the same safe character
        // set, for the same reason described above.
        await client.query(
            `CREATE USER ${dbUser} WITH CREATEDB PASSWORD '${dbPassword}'`
        );

    } finally {
        await client.end();
    }
}


async function waitForPostgres(
    host,
    port,
    timeoutMs = 120000,
    intervalMs = 3000
) {

    const start = Date.now();

    let lastError = null;

    while (Date.now() - start < timeoutMs) {

        const client = new Client({
            host,
            port,
            user: BOOTSTRAP_USER,
            password: BOOTSTRAP_PASSWORD,
            database: "postgres",
            connectionTimeoutMillis: 5000
        });

        try {

            await client.connect();
            await client.end();

            return true;

        } catch (error) {

            lastError = error;

            try {
                await client.end();
            } catch (_) {}
        }

        await new Promise(resolve =>
            setTimeout(resolve, intervalMs)
        );
    }

    throw new Error(
        `Timed out waiting for PostgreSQL at ${host}:${port}` +
        (lastError ? ` (${lastError.message})` : "")
    );
}


/* =========================================================
   CREATE DATABASE SERVICE
========================================================= */

async function createDatabaseService(data, ownerId) {

    if (
        ownerId === undefined ||
        ownerId === null
    ) {
        throw new Error("Owner ID is required");
    }

    const request =
        validateDatabaseRequest(data);

    let connection = null;
    let serviceId = null;
    let vmid = null;
    let node = null;

    try {

        connection = await pool.getConnection();

        await connection.beginTransaction();

        /*
         * Create the service row first so the allocator has
         * something to attach its allocation to. node_id is a
         * placeholder - the allocator overwrites it with the node
         * it actually picks.
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
                    'database',
                    ?,
                    ?,
                    1,
                    'provisioning'
                )
                `,
                [
                    request.name,
                    ownerId
                ]
            );

        serviceId = serviceResult.insertId;

        /*
         * Node selection is delegated entirely to the existing
         * ResourceAllocator, so database services compete for
         * capacity on the same terms as compute services and the
         * student never picks a node.
         */
        const allocation =
            await resourceAllocator.allocate(
                connection,
                {
                    serviceId,
                    serviceType: "database",
                    cpu: request.cpu,
                    ramMb: request.ramMb,
                    storageGb: request.storageGb,
                    storageType: "local",
                    description:
                        `Database ${request.name}`
                }
            );

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

        /*
         * Confirm the chosen node actually has a database template
         * before committing, so a missing template fails cleanly
         * instead of half-way through provisioning.
         */
        const [templates] =
            await connection.execute(
                `
                SELECT vmid, storage_gb
                FROM templates
                WHERE node_id = ?
                  AND service_type = 'database'
                  AND enabled = TRUE
                ORDER BY id ASC
                LIMIT 1
                `,
                [node.id]
            );

        if (templates.length === 0) {
            throw new Error(
                `No database template configured for ${node.name}`
            );
        }

        const template = templates[0];

        await connection.commit();

        connection.release();
        connection = null;

        /* =================================================
           PROXMOX
        ================================================= */

        const lxc = getLxcClient(node.name);

        vmid = await lxc.getNextVMID();

        const hostname =
            sanitizeHostname(
                `db-${request.name}-${serviceId}`
            );

        const cloneTask =
            await lxc.cloneContainer(
                template.vmid,
                vmid,
                hostname
            );

        if (cloneTask) {
            await lxc.waitForTask(cloneTask);
        }

        await lxc.configureContainer(
            vmid,
            {
                cores: request.cpu,
                memoryMb: request.ramMb
            }
        );

        const templateStorage =
            Number(template.storage_gb || 8);

        const additionalStorage =
            request.storageGb - templateStorage;

        if (additionalStorage > 0) {

            const resizeTask =
                await lxc.resizeDisk(
                    vmid,
                    additionalStorage
                );

            if (resizeTask) {
                await lxc.waitForTask(resizeTask);
            }
        }

        await pool.execute(
            `
            UPDATE services
            SET vmid = ?
            WHERE id = ?
            `,
            [vmid, serviceId]
        );

        const startTask =
            await lxc.startContainer(vmid);

        if (startTask) {
            await lxc.waitForTask(startTask);
        }

        const ip =
            await lxc.waitForIPv4(vmid);

        await waitForPostgres(ip, 5432);

        await provisionPostgres(
            ip,
            5432,
            request.dbUser,
            request.dbPassword
        );

        await pool.execute(
            `
            INSERT INTO database_instances (
                service_id,
                db_user,
                db_password,
                db_port
            )
            VALUES (?, ?, ?, 5432)
            `,
            [
                serviceId,
                request.dbUser,
                request.dbPassword
            ]
        );

        await pool.execute(
            `
            UPDATE services
            SET
                ip_address = ?,
                status = 'active'
            WHERE id = ?
            `,
            [ip, serviceId]
        );

        return await getDatabaseService(serviceId);

    } catch (error) {

        if (connection) {

            try {
                await connection.rollback();
            } catch (_) {}

            connection.release();
            connection = null;
        }

        console.error(
            `Database provisioning failed for service ` +
            `${serviceId || "unknown"}:`,
            error.message
        );

        /*
         * Remove a partially-created container so a failed request
         * does not leave an orphan consuming node capacity.
         *
         * Proxmox locks a container's config file while an earlier
         * task (clone/resize/start) is still finishing, so a delete
         * issued immediately after a failure can itself hit the same
         * transient "can't lock file ... got timeout" error seen
         * during provisioning. Retry a few times with a short delay -
         * most locks clear within a few seconds once the stuck task
         * finishes.
         *
         * containerDeleted tracks whether removal was actually
         * confirmed, so the DB cleanup below only clears vmid when
         * that is true - otherwise a failed delete would silently
         * orphan a real container with no service row left pointing
         * at it (exactly what happened before this fix: CT 102 stayed
         * on the node with no way to find it from the app).
         */
        let containerDeleted = false;

        if (vmid && node) {

            try {

                const lxc = getLxcClient(node.name);

                try {
                    const status =
                        await lxc.getStatus(vmid);

                    if (status === "running") {
                        const stopTask =
                            await lxc.stopContainer(vmid);

                        if (stopTask) {
                            await lxc.waitForTask(stopTask);
                        }
                    }
                } catch (stopError) {
                    console.error(
                        `Cleanup: could not stop container ${vmid} on ` +
                        `${node.name} before delete: ${stopError.message}`
                    );
                }

                const DELETE_ATTEMPTS = 3;
                const RETRY_DELAY_MS = 4000;

                for (
                    let attempt = 1;
                    attempt <= DELETE_ATTEMPTS;
                    attempt++
                ) {

                    try {

                        await lxc.deleteContainer(vmid);

                        containerDeleted = true;
                        break;

                    } catch (deleteError) {

                        console.error(
                            `Cleanup: delete attempt ${attempt}/` +
                            `${DELETE_ATTEMPTS} for container ${vmid} ` +
                            `on ${node.name} failed: ${deleteError.message}`
                        );

                        if (attempt < DELETE_ATTEMPTS) {
                            await new Promise(resolve =>
                                setTimeout(resolve, RETRY_DELAY_MS)
                            );
                        }
                    }
                }

                if (!containerDeleted) {
                    console.error(
                        `Cleanup: gave up deleting container ${vmid} on ` +
                        `${node.name} after ${DELETE_ATTEMPTS} attempts. ` +
                        `It is likely still present in Proxmox and needs ` +
                        `manual removal - service ${serviceId} will be ` +
                        `marked failed with its vmid kept so this is ` +
                        `traceable.`
                    );
                }

            } catch (lxcError) {

                console.error(
                    `Cleanup: could not reach Proxmox on ${node.name} ` +
                    `to remove container ${vmid}: ${lxcError.message}`
                );
            }
        }

        if (serviceId) {

            try {

                const cleanupConnection =
                    await pool.getConnection();

                try {

                    await cleanupConnection.beginTransaction();

                    await cleanupConnection.execute(
                        `
                        UPDATE allocations
                        SET
                            status = 'released',
                            released_at = NOW()
                        WHERE service_id = ?
                          AND status = 'active'
                        `,
                        [serviceId]
                    );

                    if (containerDeleted || !vmid) {

                        await cleanupConnection.execute(
                            `
                            UPDATE services
                            SET
                                status = 'failed',
                                vmid = NULL
                            WHERE id = ?
                            `,
                            [serviceId]
                        );

                    } else {

                        /*
                         * Delete failed after retries - keep vmid on
                         * the failed row so the leftover Proxmox
                         * container stays traceable back to a service
                         * instead of disappearing from the app's
                         * records. Find these later with:
                         *   SELECT id, name, node_id, vmid FROM services
                         *   WHERE status = 'failed' AND vmid IS NOT NULL
                         */
                        await cleanupConnection.execute(
                            `
                            UPDATE services
                            SET status = 'failed'
                            WHERE id = ?
                            `,
                            [serviceId]
                        );
                    }

                    await cleanupConnection.commit();

                } catch (cleanupError) {

                    try {
                        await cleanupConnection.rollback();
                    } catch (_) {}

                } finally {
                    cleanupConnection.release();
                }

            } catch (_) {}
        }

        throw error;
    }
}


/* =========================================================
   START
========================================================= */

async function startDatabaseService(serviceId) {

    const service =
        await getDatabaseService(serviceId);

    if (!service) {
        throw new Error("Database service not found");
    }

    if (!service.vmid) {
        throw new Error(
            "Database service does not have a container"
        );
    }

    const lxc = getLxcClient(service.node_name);

    await verifyContainerOwnership(
        lxc,
        service.vmid,
        service.id
    );

    const status = await lxc.getStatus(service.vmid);

    if (status !== "running") {

        const task =
            await lxc.startContainer(service.vmid);

        if (task) {
            await lxc.waitForTask(task);
        }
    }

    const ip = await lxc.waitForIPv4(service.vmid);

    await pool.execute(
        `
        UPDATE services
        SET
            ip_address = ?,
            status = 'active'
        WHERE id = ?
        `,
        [ip, serviceId]
    );

    return getDatabaseService(serviceId);
}


/* =========================================================
   STOP
========================================================= */

async function stopDatabaseService(serviceId) {

    const service =
        await getDatabaseService(serviceId);

    if (!service) {
        throw new Error("Database service not found");
    }

    if (!service.vmid) {
        throw new Error(
            "Database service does not have a container"
        );
    }

    const lxc = getLxcClient(service.node_name);

    await verifyContainerOwnership(
        lxc,
        service.vmid,
        service.id
    );

    const status = await lxc.getStatus(service.vmid);

    if (status === "running") {

        const task =
            await lxc.stopContainer(service.vmid);

        if (task) {
            await lxc.waitForTask(task);
        }
    }

    /*
     * Stopping does not release the allocation, matching how
     * compute services behave - the capacity stays reserved until
     * the service is actually deleted.
     */
    await pool.execute(
        `
        UPDATE services
        SET status = 'stopped'
        WHERE id = ?
        `,
        [serviceId]
    );

    return getDatabaseService(serviceId);
}


/* =========================================================
   DELETE
========================================================= */

async function deleteDatabaseService(serviceId) {

    const service =
        await getDatabaseService(serviceId);

    if (!service) {
        throw new Error("Database service not found");
    }

    if (service.status === "deleted") {
        return service;
    }

    await pool.execute(
        `
        UPDATE services
        SET status = 'deleting'
        WHERE id = ?
        `,
        [serviceId]
    );

    try {

        if (service.vmid && service.node_name) {

            const lxc =
                getLxcClient(service.node_name);

            // Skip straight to Proxmox actions only if we can
            // confirm this vmid still belongs to this service. If
            // the container is already gone entirely, there is
            // nothing to protect and nothing to destroy - proceed
            // to clean up the database row as normal. If it exists
            // but belongs to someone else's service, that is the
            // exact situation this check exists to catch: abort
            // rather than destroy the wrong container.
            let containerStillExists = true;

            try {

                await verifyContainerOwnership(
                    lxc,
                    service.vmid,
                    service.id
                );

            } catch (ownershipError) {

                const message =
                    ownershipError.message || "";

                const alreadyGone =
                    message.includes("does not exist") ||
                    message.includes("Configuration file");

                if (alreadyGone) {
                    containerStillExists = false;
                } else {
                    throw ownershipError;
                }
            }

            if (containerStillExists) {

            try {

                const status =
                    await lxc.getStatus(service.vmid);

                if (status === "running") {

                    const task =
                        await lxc.stopContainer(service.vmid);

                    if (task) {
                        await lxc.waitForTask(task);
                    }
                }

            } catch (error) {

                if (
                    !error.message.includes("does not exist") &&
                    !error.message.includes("Configuration file")
                ) {
                    throw error;
                }
            }

            try {
                await lxc.deleteContainer(service.vmid);

            } catch (error) {

                if (
                    !error.message.includes("does not exist") &&
                    !error.message.includes("Configuration file")
                ) {
                    throw error;
                }
            }

            } // end if (containerStillExists)
        }

        await pool.execute(
            `
            UPDATE allocations
            SET
                status = 'released',
                released_at = NOW()
            WHERE service_id = ?
              AND status = 'active'
            `,
            [serviceId]
        );

        /*
         * Credentials are dropped on delete, but the service row is
         * kept so the instance still appears in history.
         */
        await pool.execute(
            `
            DELETE FROM database_instances
            WHERE service_id = ?
            `,
            [serviceId]
        );

        await pool.execute(
            `
            UPDATE services
            SET status = 'deleted'
            WHERE id = ?
            `,
            [serviceId]
        );

        return getDatabaseService(serviceId);

    } catch (error) {

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


module.exports = {
    validateDatabaseRequest,
    getDatabaseService,
    getDatabaseServices,
    createDatabaseService,
    startDatabaseService,
    stopDatabaseService,
    deleteDatabaseService,
    ALLOWED_CPU,
    ALLOWED_RAM_MB,
    ALLOWED_STORAGE_GB
};