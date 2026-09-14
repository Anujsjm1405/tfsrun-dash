const bcrypt = require("bcryptjs");

const pool = require("../db/mysql");

class AuthService {
    async registerStudent({
        prn,
        name,
        password
    }) {
        prn = String(prn || "").trim();
        name = String(name || "").trim();
        password = String(password || "");

        if (!prn) {
            throw new Error("PRN is required");
        }

        if (prn.length > 50) {
            throw new Error(
                "PRN must be 50 characters or less"
            );
        }

        if (!name) {
            throw new Error("Name is required");
        }

        if (name.length > 100) {
            throw new Error(
                "Name must be 100 characters or less"
            );
        }

        if (password.length < 8) {
            throw new Error(
                "Password must be at least 8 characters"
            );
        }

        const [existingUsers] =
            await pool.execute(
                `
                SELECT id
                FROM users
                WHERE prn = ?
                LIMIT 1
                `,
                [prn]
            );

        if (existingUsers.length > 0) {
            throw new Error(
                "A student with this PRN already exists"
            );
        }

        const passwordHash =
            await bcrypt.hash(password, 12);

        const [result] =
            await pool.execute(
                `
                INSERT INTO users (
                    prn,
                    name,
                    username,
                    email,
                    password_hash,
                    role,
                    enabled
                )
                VALUES (
                    ?,
                    ?,
                    NULL,
                    NULL,
                    ?,
                    'student',
                    TRUE
                )
                `,
                [
                    prn,
                    name,
                    passwordHash
                ]
            );

        return {
            id: result.insertId,
            prn,
            name,
            role: "student"
        };
    }


    async authenticateStudent({
        prn,
        password
    }) {
        prn = String(prn || "").trim();
        password = String(password || "");

        if (!prn || !password) {
            throw new Error(
                "PRN and password are required"
            );
        }

        const [rows] =
            await pool.execute(
                `
                SELECT
                    id,
                    prn,
                    name,
                    password_hash,
                    role,
                    enabled
                FROM users
                WHERE prn = ?
                  AND role = 'student'
                LIMIT 1
                `,
                [prn]
            );

        if (rows.length === 0) {
            throw new Error(
                "Invalid PRN or password"
            );
        }

        const user = rows[0];

        if (!user.enabled) {
            throw new Error(
                "This account is disabled"
            );
        }

        const passwordValid =
            await bcrypt.compare(
                password,
                user.password_hash
            );

        if (!passwordValid) {
            throw new Error(
                "Invalid PRN or password"
            );
        }

        return {
            id: user.id,
            prn: user.prn,
            name: user.name,
            role: user.role
        };
    }


    async authenticateAdmin({
        username,
        password
    }) {
        username =
            String(username || "").trim();

        password =
            String(password || "");

        if (!username || !password) {
            throw new Error(
                "Username and password are required"
            );
        }

        const [rows] =
            await pool.execute(
                `
                SELECT
                    id,
                    username,
                    name,
                    password_hash,
                    role,
                    enabled
                FROM users
                WHERE username = ?
                  AND role = 'admin'
                LIMIT 1
                `,
                [username]
            );

        if (rows.length === 0) {
            throw new Error(
                "Invalid username or password"
            );
        }

        const user = rows[0];

        if (!user.enabled) {
            throw new Error(
                "This account is disabled"
            );
        }

        const passwordValid =
            await bcrypt.compare(
                password,
                user.password_hash
            );

        if (!passwordValid) {
            throw new Error(
                "Invalid username or password"
            );
        }

        return {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        };
    }


    async getUserById(userId) {
        const [rows] =
            await pool.execute(
                `
                SELECT
                    id,
                    prn,
                    name,
                    username,
                    email,
                    role,
                    enabled,
                    created_at
                FROM users
                WHERE id = ?
                LIMIT 1
                `,
                [userId]
            );

        return rows[0] || null;
    }
}

module.exports = new AuthService();
