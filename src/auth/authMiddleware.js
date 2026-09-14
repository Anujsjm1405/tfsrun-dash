function requireAuth(req, res, next) {
    if (!req.session || !req.session.user) {
        if (req.path.startsWith("/api/")) {
            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });
        }

        return res.redirect("/login");
    }

    next();
}


function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            if (req.path.startsWith("/api/")) {
                return res.status(401).json({
                    success: false,
                    error: "Authentication required"
                });
            }

            return res.redirect("/login");
        }

        if (!roles.includes(req.session.user.role)) {
            if (req.path.startsWith("/api/")) {
                return res.status(403).json({
                    success: false,
                    error: "Access denied"
                });
            }

            return res.status(403).send("Access denied");
        }

        next();
    };
}


function requireStudent(req, res, next) {
    return requireRole("student")(
        req,
        res,
        next
    );
}


function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        if (req.path.startsWith("/api/")) {
            return res.status(401).json({
                success: false,
                error: "Authentication required"
            });
        }

        return res.redirect("/admin/login");
    }

    if (req.session.user.role !== "admin") {
        if (req.path.startsWith("/api/")) {
            return res.status(403).json({
                success: false,
                error: "Admin access required"
            });
        }

        return res.status(403).send(
            "Admin access required"
        );
    }

    next();
}


module.exports = {
    requireAuth,
    requireRole,
    requireStudent,
    requireAdmin
};
