require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const http = require("http");

const pool = require("./src/db/mysql");

const {
    getProxmoxClient
} = require("./src/proxmox");

const serviceManager =
    require("./src/allocator/serviceManager");

const resourceAllocator =
    require("./src/allocator/resourceAllocator");

const authRoutes =
    require("./src/routes/auth");

const terminalRoutes =
    require("./src/routes/terminal");

const terminalProxy =
    require("./src/terminal/terminalProxy");

const {
    requireAdmin
} = require("./src/auth/authMiddleware");

const app = express();

const server =
    http.createServer(app);

const PORT =
    Number(
        process.env.PORT || 3000
    );


// --------------------------------------------------
// Express
// --------------------------------------------------

app.set(
    "view engine",
    "ejs"
);

app.set(
    "views",
    path.join(
        __dirname,
        "views"
    )
);


// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(
    express.json()
);

app.use(
    express.urlencoded({
        extended: true
    })
);

app.use(
    express.static(
        path.join(
            __dirname,
            "public"
        )
    )
);


// xterm.js browser assets
app.use(
    "/xterm",
    express.static(
        path.join(
            __dirname,
            "node_modules",
            "xterm"
        )
    )
);

app.use(
    "/xterm-addon-fit",
    express.static(
        path.join(
            __dirname,
            "node_modules",
            "xterm-addon-fit"
        )
    )
);


// --------------------------------------------------
// Session
// --------------------------------------------------

const sessionMiddleware =
    session({

        secret:
            process.env.SESSION_SECRET ||
            "tfsrun-session-secret",

        resave: false,

        saveUninitialized: false,

        cookie: {

            httpOnly: true,

            sameSite: "lax",

            secure: false
        }
    });

app.use(
    sessionMiddleware
);


// --------------------------------------------------
// Authentication
// --------------------------------------------------

app.use(
    "/",
    authRoutes
);


function requireLogin(
    req,
    res,
    next
) {

    if (
        !req.session ||
        !req.session.user
    ) {

        return res.redirect(
            "/login"
        );
    }

    next();
}


function requireStudent(
    req,
    res,
    next
) {

    if (
        !req.session ||
        !req.session.user
    ) {

        return res.redirect(
            "/login"
        );
    }

    if (
        req.session.user.role !==
        "student"
    ) {

        return res.status(
            403
        ).send(
            "Student access required"
        );
    }

    next();
}


// --------------------------------------------------
// Root
// --------------------------------------------------

app.get(
    "/",
    (
        req,
        res
    ) => {

        if (
            !req.session ||
            !req.session.user
        ) {

            return res.redirect(
                "/login"
            );
        }

        if (
            req.session.user.role ===
            "admin"
        ) {

            return res.redirect(
                "/admin"
            );
        }

        res.redirect(
            "/student"
        );
    }
);


// --------------------------------------------------
// Student dashboard
// --------------------------------------------------

app.get(
    "/student",
    requireStudent,
    (
        req,
        res
    ) => {

        res.render(
            "dashboard",
            {

                user:
                    req.session.user,

                title:
                    "Dashboard - TFSrun"
            }
        );
    }
);


// --------------------------------------------------
// Student services
// --------------------------------------------------

async function getStudentActiveServices(
    ownerId
) {

    const [rows] =
        await pool.execute(

            `
            SELECT

                s.id,

                s.service_type AS type,

                s.name,

                s.owner_id,

                s.node_id,

                s.vmid AS vm_id,

                s.ip_address,

                s.status,

                s.created_at,

                s.updated_at,

                a.cpu,

                a.ram_mb AS ram,

                a.storage_gb AS storage,

                a.storage_type

            FROM services s

            LEFT JOIN allocations a

                ON a.service_id = s.id

                AND a.status = 'active'

            WHERE s.owner_id = ?

                AND s.status <> 'deleted'

            ORDER BY s.id DESC
            `,

            [
                ownerId
            ]
        );

    return rows;
}


async function getStudentDeletedServices(
    ownerId
) {

    const [rows] =
        await pool.execute(

            `
            SELECT

                s.id,

                s.service_type AS type,

                s.name,

                s.owner_id,

                s.node_id,

                s.vmid AS vm_id,

                s.ip_address,

                s.status,

                s.created_at,

                s.updated_at

            FROM services s

            WHERE s.owner_id = ?

                AND s.status = 'deleted'

            ORDER BY s.id DESC
            `,

            [
                ownerId
            ]
        );

    return rows;
}


// --------------------------------------------------
// Compute page
// --------------------------------------------------

app.get(
    "/student/compute",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const services =
                await getStudentActiveServices(
                    req.session.user.id
                );

            res.render(
                "compute",
                {

                    user:
                        req.session.user,

                    services:
                        services || [],

                    title:
                        "Compute - TFSrun"
                }
            );

        } catch (error) {

            console.error(
                "Compute page error:",
                error
            );

            res.status(
                500
            ).send(
                "Failed to load compute page"
            );
        }
    }
);


// --------------------------------------------------
// Terminal routes
// --------------------------------------------------

app.use(
    "/student/compute",
    terminalRoutes
);


// --------------------------------------------------
// Active services API
// --------------------------------------------------

app.get(
    "/api/services",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const services =
                await getStudentActiveServices(
                    req.session.user.id
                );

            res.json(
                services || []
            );

        } catch (error) {

            console.error(
                "GET /api/services:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// History API
// --------------------------------------------------

app.get(
    "/api/services/history",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const history =
                await getStudentDeletedServices(
                    req.session.user.id
                );

            res.json(
                history || []
            );

        } catch (error) {

            console.error(
                "GET /api/services/history:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Single service API
// --------------------------------------------------

app.get(
    "/api/services/:id",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const serviceId =
                Number(
                    req.params.id
                );

            if (
                !Number.isInteger(
                    serviceId
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Invalid service ID"
                });
            }

            const [rows] =
                await pool.execute(

                    `
                    SELECT

                        s.id,

                        s.service_type AS type,

                        s.name,

                        s.owner_id,

                        s.node_id,

                        s.vmid AS vm_id,

                        s.ip_address,

                        s.status,

                        s.created_at,

                        s.updated_at,

                        a.cpu,

                        a.ram_mb AS ram,

                        a.storage_gb AS storage,

                        a.storage_type

                    FROM services s

                    LEFT JOIN allocations a

                        ON a.service_id = s.id

                        AND a.status = 'active'

                    WHERE s.id = ?

                        AND s.owner_id = ?

                    LIMIT 1
                    `,

                    [
                        serviceId,
                        req.session.user.id
                    ]
                );

            if (
                rows.length === 0
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    error:
                        "Service not found"
                });
            }

            res.json({

                success:
                    true,

                service:
                    rows[0]
            });

        } catch (error) {

            console.error(
                "GET /api/services/:id:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Create compute VM
// --------------------------------------------------

app.post(
    "/api/services/compute",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const {
                name,
                cpu,
                ram,
                storage,
                storageType,
                username,
                password
            } = req.body;

            const cpuValue =
                Number(cpu);

            const ramValue =
                Number(ram);

            const storageValue =
                Number(storage);

            if (
                !name ||
                !username ||
                !password
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "VM name, username and password are required"
                });
            }

            if (
                ![
                    1,
                    2,
                    4
                ].includes(
                    cpuValue
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "CPU must be 1, 2, or 4 cores"
                });
            }

            if (
                ![
                    2,
                    4,
                    6
                ].includes(
                    ramValue
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "RAM must be 2, 4, or 6 GB"
                });
            }

            if (
                ![
                    32,
                    64,
                    128
                ].includes(
                    storageValue
                )
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "Storage must be 32, 64, or 128 GB"
                });
            }

            const result =
                await serviceManager
                    .createComputeService(

                        {
                            name,

                            cpu:
                                cpuValue,

                            ram:
                                ramValue,

                            storage:
                                storageValue,

                            storageType:
                                storageType ||
                                "local",

                            username,

                            password
                        },

                        req.session.user.id
                    );

            res.status(
                201
            ).json({

                success:
                    true,

                service:
                    result
            });

        } catch (error) {

            console.error(
                "Create compute service error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Start VM
// --------------------------------------------------

app.post(
    "/api/services/:id/start",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const serviceId =
                Number(
                    req.params.id
                );

            const service =
                await serviceManager.getService(
                    serviceId
                );

            if (
                !service ||
                Number(service.owner_id) !==
                Number(req.session.user.id)
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    error:
                        "Service not found"
                });
            }

            const result =
                await serviceManager
                    .startService(
                        serviceId
                    );

            res.json({

                success:
                    true,

                service:
                    result
            });

        } catch (error) {

            console.error(
                "Start service error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Stop VM
// --------------------------------------------------

app.post(
    "/api/services/:id/stop",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const serviceId =
                Number(
                    req.params.id
                );

            const service =
                await serviceManager.getService(
                    serviceId
                );

            if (
                !service ||
                Number(service.owner_id) !==
                Number(req.session.user.id)
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    error:
                        "Service not found"
                });
            }

            const result =
                await serviceManager
                    .stopService(
                        serviceId
                    );

            res.json({

                success:
                    true,

                service:
                    result
            });

        } catch (error) {

            console.error(
                "Stop service error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Shutdown VM
// --------------------------------------------------

app.post(
    "/api/services/:id/shutdown",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const serviceId =
                Number(
                    req.params.id
                );

            const service =
                await serviceManager.getService(
                    serviceId
                );

            if (
                !service ||
                Number(service.owner_id) !==
                Number(req.session.user.id)
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    error:
                        "Service not found"
                });
            }

            if (!service.vmid) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "VM ID is missing"
                });
            }

            const client =
                getProxmoxClient(
                    service.node_name ||
                    service.node_id
                );

            await client.shutdownGuest(
                service.vmid
            );

            await pool.execute(

                `
                UPDATE services

                SET status = 'stopped'

                WHERE id = ?
                `,

                [
                    serviceId
                ]
            );

            res.json({

                success:
                    true
            });

        } catch (error) {

            console.error(
                "Shutdown service error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Delete VM
// --------------------------------------------------

app.delete(
    "/api/services/:id",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const serviceId =
                Number(
                    req.params.id
                );

            const service =
                await serviceManager.getService(
                    serviceId
                );

            if (
                !service ||
                Number(service.owner_id) !==
                Number(req.session.user.id)
            ) {

                return res.status(
                    404
                ).json({

                    success:
                        false,

                    error:
                        "Service not found"
                });
            }

            const result =
                await serviceManager
                    .deleteService(
                        serviceId
                    );

            res.json({

                success:
                    true,

                service:
                    result
            });

        } catch (error) {

            console.error(
                "Delete service error:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Nodes API
// --------------------------------------------------

async function getInfrastructureResources() {
    return resourceAllocator.getResourceSnapshot();
}

app.get(
    "/nodes",
    requireLogin,
    async (
        req,
        res
    ) => {

        try {

            const [rows] =
                await pool.execute(

                    `
                    SELECT

                        id,
                        name,
                        host,
                        port,
                        total_cpu,
                        reserved_cpu,
                        total_ram_mb,
                        reserved_ram_mb,
                        total_local_storage_gb,
                        total_ssd_storage_gb,
                        enabled

                    FROM nodes

                    ORDER BY id
                    `
                );

            res.json(
                rows
            );

        } catch (error) {

            console.error(
                "GET /nodes:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Resources API
// --------------------------------------------------

app.get(
    "/resources",
    requireLogin,
    async (
        req,
        res
    ) => {

        try {

            const rows =
                await getInfrastructureResources();

            res.json(
                rows
            );

        } catch (error) {

            console.error(
                "GET /resources:",
                error
            );

            res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message
            });
        }
    }
);


// --------------------------------------------------
// Admin APIs
// --------------------------------------------------

app.get(
    "/api/admin/resources",
    requireAdmin,
    async (
        req,
        res
    ) => {

        try {

            res.json({
                success: true,
                resources:
                    await getInfrastructureResources()
            });

        } catch (error) {

            console.error(
                "GET /api/admin/resources:",
                error
            );

            res.status(500).json({
                success: false,
                error: "Failed to load infrastructure resources"
            });
        }
    }
);


app.get(
    "/api/admin/services",
    requireAdmin,
    async (
        req,
        res
    ) => {

        try {

            const services =
                await serviceManager.getServices();

            const [owners] =
                await pool.execute(
                    `
                    SELECT
                        s.id AS service_id,
                        u.name AS owner_name,
                        u.username AS owner_username
                    FROM services s
                    LEFT JOIN users u ON u.id = s.owner_id
                    WHERE s.status <> 'deleted'
                    `
                );

            const ownerByService =
                new Map(
                    owners.map(owner => [
                        Number(owner.service_id),
                        owner
                    ])
                );

            res.json({
                success: true,
                services: services.map(service => ({
                    ...service,
                    ...(ownerByService.get(
                        Number(service.id)
                    ) || {})
                }))
            });

        } catch (error) {

            console.error(
                "GET /api/admin/services:",
                error
            );

            res.status(500).json({
                success: false,
                error: "Failed to load services"
            });
        }
    }
);


async function handleAdminServiceAction(
    req,
    res,
    action
) {

    try {

        const serviceId =
            Number(req.params.id);

        if (!Number.isInteger(serviceId)) {
            return res.status(400).json({
                success: false,
                error: "Invalid service ID"
            });
        }

        const service =
            await serviceManager.getService(serviceId);

        if (!service) {
            return res.status(404).json({
                success: false,
                error: "Service not found"
            });
        }

        const result =
            await action(serviceId, service);

        res.json({
            success: true,
            service: result
        });

    } catch (error) {

        console.error(
            "Admin service action error:",
            error
        );

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
}


app.post(
    "/api/admin/services/:id/start",
    requireAdmin,
    (req, res) => handleAdminServiceAction(
        req,
        res,
        serviceId => serviceManager.startService(serviceId)
    )
);


app.post(
    "/api/admin/services/:id/stop",
    requireAdmin,
    (req, res) => handleAdminServiceAction(
        req,
        res,
        serviceId => serviceManager.stopService(serviceId)
    )
);


app.delete(
    "/api/admin/services/:id",
    requireAdmin,
    (req, res) => handleAdminServiceAction(
        req,
        res,
        serviceId => serviceManager.deleteService(serviceId)
    )
);


// --------------------------------------------------
// Admin
// --------------------------------------------------

app.get(
    "/admin",
    requireAdmin,
    (
        req,
        res
    ) => {

        res.render(
            "admin-dashboard",
            {

                user:
                    req.session.user,

                title:
                    "Admin Dashboard - TFSrun"
            }
        );
    }
);


// --------------------------------------------------
// WebSocket upgrade
// --------------------------------------------------

server.on(
    "upgrade",
    (
        request,
        socket,
        head
    ) => {

        terminalProxy.handleUpgrade(
            request,
            socket,
            head
        );
    }
);


// --------------------------------------------------
// 404
// --------------------------------------------------

app.use(
    (
        req,
        res
    ) => {

        if (
            req.path.startsWith(
                "/api/"
            )
        ) {

            return res.status(
                404
            ).json({

                success:
                    false,

                error:
                    "API endpoint not found"
            });
        }

        res.status(
            404
        ).send(
            "Page not found"
        );
    }
);


// --------------------------------------------------
// Error handler
// --------------------------------------------------

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            "Unhandled application error:",
            error
        );

        if (
            res.headersSent
        ) {

            return next(
                error
            );
        }

        if (
            req.path.startsWith(
                "/api/"
            )
        ) {

            return res.status(
                500
            ).json({

                success:
                    false,

                error:
                    error.message ||
                    "Internal server error"
            });
        }

        res.status(
            500
        ).send(
            "Internal server error"
        );
    }
);


// --------------------------------------------------
// Start
// --------------------------------------------------

server.listen(
    PORT,
    () => {

        console.log(
            `TFSrun running at ` +
            `http://localhost:${PORT}`
        );
    }
);
