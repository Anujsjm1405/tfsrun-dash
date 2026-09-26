const express = require("express");
const router = express.Router();

const databaseManager = require("./databaseManager");

const {
    requireStudent
} = require("../auth/authMiddleware");


/*
 * Every handler re-checks ownership against the session user before
 * touching a service, so knowing a service ID is never enough to
 * act on someone else's database.
 */
async function loadOwnedService(req, res) {

    const serviceId = Number(req.params.id);

    if (!Number.isInteger(serviceId)) {
        res.status(400).json({
            success: false,
            error: "Invalid service ID"
        });
        return null;
    }

    const service =
        await databaseManager.getDatabaseService(serviceId);

    if (
        !service ||
        Number(service.owner_id) !== Number(req.session.user.id)
    ) {
        res.status(404).json({
            success: false,
            error: "Database service not found"
        });
        return null;
    }

    return service;
}


/* =========================================================
   PAGE
========================================================= */

router.get(
    "/",
    requireStudent,
    async (req, res) => {

        try {

            const services =
                await databaseManager.getDatabaseServices(
                    req.session.user.id
                );

            res.render(
                "database",
                {
                    user: req.session.user,
                    services: services || [],
                    limits: {
                        cpu: databaseManager.ALLOWED_CPU,
                        ramMb: databaseManager.ALLOWED_RAM_MB,
                        storageGb: databaseManager.ALLOWED_STORAGE_GB
                    },
                    title: "Database - TFSrun"
                }
            );

        } catch (error) {

            console.error(
                "Database page error:",
                error
            );

            res.status(500).send(
                "Failed to load database page"
            );
        }
    }
);


/* =========================================================
   LIST
========================================================= */

router.get(
    "/api/list",
    requireStudent,
    async (req, res) => {

        try {

            const services =
                await databaseManager.getDatabaseServices(
                    req.session.user.id
                );

            res.json({
                success: true,
                services: services || []
            });

        } catch (error) {

            console.error(
                "GET database list:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* =========================================================
   CREATE
========================================================= */

router.post(
    "/api/create",
    requireStudent,
    async (req, res) => {

        try {

            const service =
                await databaseManager.createDatabaseService(
                    req.body,
                    req.session.user.id
                );

            res.status(201).json({
                success: true,
                service
            });

        } catch (error) {

            console.error(
                "Create database service error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* =========================================================
   CREDENTIALS
========================================================= */

router.get(
    "/api/:id/credentials",
    requireStudent,
    async (req, res) => {

        try {

            const service =
                await loadOwnedService(req, res);

            if (!service) {
                return;
            }

            res.json({
                success: true,
                credentials: {
                    host: service.ip_address,
                    port: service.db_port || 5432,
                    username: service.db_user,
                    password: service.db_password
                }
            });

        } catch (error) {

            console.error(
                "Get database credentials error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* =========================================================
   START
========================================================= */

router.post(
    "/api/:id/start",
    requireStudent,
    async (req, res) => {

        try {

            const service =
                await loadOwnedService(req, res);

            if (!service) {
                return;
            }

            const result =
                await databaseManager.startDatabaseService(
                    service.id
                );

            res.json({
                success: true,
                service: result
            });

        } catch (error) {

            console.error(
                "Start database service error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* =========================================================
   STOP
========================================================= */

router.post(
    "/api/:id/stop",
    requireStudent,
    async (req, res) => {

        try {

            const service =
                await loadOwnedService(req, res);

            if (!service) {
                return;
            }

            const result =
                await databaseManager.stopDatabaseService(
                    service.id
                );

            res.json({
                success: true,
                service: result
            });

        } catch (error) {

            console.error(
                "Stop database service error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


/* =========================================================
   DELETE
========================================================= */

router.delete(
    "/api/:id",
    requireStudent,
    async (req, res) => {

        try {

            const service =
                await loadOwnedService(req, res);

            if (!service) {
                return;
            }

            const result =
                await databaseManager.deleteDatabaseService(
                    service.id
                );

            res.json({
                success: true,
                service: result
            });

        } catch (error) {

            console.error(
                "Delete database service error:",
                error
            );

            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }
);


module.exports = router;
