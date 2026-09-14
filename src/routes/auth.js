const express = require("express");

const authService =
    require("../auth/authService");

const router = express.Router();


/*
 * Student registration page
 */
router.get(
    "/register",
    (req, res) => {
        if (req.session?.user) {
            return res.redirect("/");
        }

        res.render("register", {
            title:
                "Student Registration - TFSrun"
        });
    }
);


/*
 * Student login page
 */
router.get(
    "/login",
    (req, res) => {
        if (req.session?.user) {
            if (
                req.session.user.role === "admin"
            ) {
                return res.redirect("/admin");
            }

            return res.redirect("/");
        }

        res.render("login", {
            title:
                "Student Login - TFSrun"
        });
    }
);


/*
 * Admin login page
 */
router.get(
    "/admin/login",
    (req, res) => {
        if (req.session?.user) {
            if (
                req.session.user.role === "admin"
            ) {
                return res.redirect("/admin");
            }

            return res.redirect("/");
        }

        res.render("admin-login", {
            title:
                "Admin Login - TFSrun"
        });
    }
);


/*
 * Student registration
 */
router.post(
    "/api/auth/register",
    async (req, res) => {
        try {
            const {
                prn,
                name,
                password
            } = req.body;

            const user =
                await authService.registerStudent({
                    prn,
                    name,
                    password
                });

            req.session.user = user;

            res.status(201).json({
                success: true,
                user
            });
        } catch (error) {
            console.error(error);

            res.status(400).json({
                success: false,
                error: error.message
            });
        }
    }
);


/*
 * Student login
 */
router.post(
    "/api/auth/login",
    async (req, res) => {
        try {
            const {
                prn,
                password
            } = req.body;

            const user =
                await authService.authenticateStudent({
                    prn,
                    password
                });

            req.session.regenerate(
                error => {
                    if (error) {
                        console.error(error);

                        return res.status(500).json({
                            success: false,
                            error:
                                "Failed to create session"
                        });
                    }

                    req.session.user = user;

                    res.json({
                        success: true,
                        user
                    });
                }
            );
        } catch (error) {
            console.error(error);

            res.status(401).json({
                success: false,
                error: error.message
            });
        }
    }
);


/*
 * Admin login
 */
router.post(
    "/api/auth/admin-login",
    async (req, res) => {
        try {
            const {
                username,
                password
            } = req.body;

            const user =
                await authService.authenticateAdmin({
                    username,
                    password
                });

            req.session.regenerate(
                error => {
                    if (error) {
                        console.error(error);

                        return res.status(500).json({
                            success: false,
                            error:
                                "Failed to create session"
                        });
                    }

                    req.session.user = user;

                    res.json({
                        success: true,
                        user
                    });
                }
            );
        } catch (error) {
            console.error(error);

            res.status(401).json({
                success: false,
                error: error.message
            });
        }
    }
);


/*
 * Logout
 */
router.post(
    "/api/auth/logout",
    (req, res) => {
        req.session.destroy(
            error => {
                if (error) {
                    console.error(error);

                    return res.status(500).json({
                        success: false,
                        error:
                            "Logout failed"
                    });
                }

                res.clearCookie(
                    "tfsrun.sid"
                );

                res.json({
                    success: true
                });
            }
        );
    }
);


/*
 * Current user
 */
router.get(
    "/api/auth/me",
    (req, res) => {
        if (!req.session?.user) {
            return res.status(401).json({
                success: false,
                error:
                    "Not authenticated"
            });
        }

        res.json({
            success: true,
            user:
                req.session.user
        });
    }
);


module.exports = router;
