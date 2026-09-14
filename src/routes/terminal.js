const express =
    require("express");

const pool =
    require("../db/mysql");

const {
    requireStudent
} = require("../auth/authMiddleware");

const {
    normalizeNodeName
} = require("../proxmox");

const {
    createTerminalSession
} = require("../terminal/terminalProxy");

const router =
    express.Router();


// --------------------------------------------------
// Terminal page
// --------------------------------------------------

router.get(
    "/terminal/:serviceId",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const serviceId =
                Number(
                    req.params.serviceId
                );

            if (
                !Number.isInteger(
                    serviceId
                )
            ) {

                return res.status(
                    400
                ).send(
                    "Invalid service ID"
                );
            }

            const [rows] =
                await pool.execute(

                    `
                    SELECT

                        s.id,

                        s.service_type,

                        s.service_type AS type,

                        s.name,

                        s.owner_id,

                        s.node_id,

                        s.vmid AS vm_id,

                        s.ip_address,

                        s.status

                    FROM services s

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
                ).send(
                    "Service not found"
                );
            }

            const service =
                rows[0];

            if (
                service.status ===
                "deleted"
            ) {

                return res.status(
                    404
                ).send(
                    "Service has been deleted"
                );
            }

            if (service.service_type !== "compute") {
                return res.status(404).send("Compute terminal not available");
            }

            res.render(
                "terminal",
                {

                    user:
                        req.session.user,

                    service,

                    serviceId,

                    title:
                        `Terminal - ${service.name}`
                }
            );

        } catch (error) {

            console.error(
                "Terminal page error:",
                error
            );

            res.status(
                500
            ).send(
                "Failed to load terminal"
            );
        }
    }
);


// --------------------------------------------------
// Create terminal ticket
// --------------------------------------------------

router.get(
    "/terminal-ticket/:serviceId",
    requireStudent,
    async (
        req,
        res
    ) => {

        try {

            const serviceId =
                Number(
                    req.params.serviceId
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

                        s.service_type,

                        s.name,

                        s.owner_id,

                        s.node_id,

                        s.vmid AS vm_id,

                        s.status

                    FROM services s

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

            const service =
                rows[0];

            if (service.service_type !== "compute") {
                return res.status(404).json({
                    success: false,
                    error: "Compute terminal not available"
                });
            }

            if (
                service.status !==
                "active"
            ) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        `VM is not active. Current status: ${service.status}`
                });
            }

            if (!service.vm_id) {

                return res.status(
                    400
                ).json({

                    success:
                        false,

                    error:
                        "VM ID is missing"
                });
            }

            const nodeName =
                normalizeNodeName(
                    service.node_id
                );


            const browserTicket =
                await createTerminalSession(
                    nodeName,
                    Number(
                        service.vm_id
                    )
                );


            console.log(
                `Terminal session created: ` +
                `service=${service.id} ` +
                `name=${service.name} ` +
                `node=${nodeName} ` +
                `vmid=${service.vm_id}`
            );


            res.json({

                success:
                    true,

                ticket:
                    browserTicket,

                serviceName:
                    service.name
            });

        } catch (error) {

            console.error(
                "Terminal ticket error:",
                error.message ||
                "unknown error"
            );

            res.status(
                500
            ).json({

                success:
                    false,

                    error:
                    "Failed to create terminal session"
            });
        }
    }
);


module.exports =
    router;
