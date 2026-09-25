const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const {
    S3Client,
    CreateBucketCommand,
    ListObjectsV2Command,
    DeleteBucketCommand,
    HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const s3Config = require("./s3Config");
const pool = require("../db/mysql");

const masterClient = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey },
    forcePathStyle: true,
});

const execFileAsync = promisify(execFile);

// --------------------------------------------------
// MinIO admin tooling (mc)
// --------------------------------------------------

async function runMc(args, options = {}) {
    try {
        return await execFileAsync(s3Config.mcPath, args, { timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, ...options });
    } catch (error) {
        const detail = `${error.stdout || ""}\n${error.stderr || ""}`.trim();
        const wrapped = new Error(detail || error.message);
        wrapped.code = error.code;
        wrapped.stdout = error.stdout;
        wrapped.stderr = error.stderr;
        throw wrapped;
    }
}

let mcAliasReady = false;

async function ensureMcAlias() {
    if (mcAliasReady) return;
    await runMc(["alias", "set", s3Config.mcAlias, s3Config.endpoint, s3Config.accessKeyId, s3Config.secretAccessKey, "--api", "S3v4"]);
    mcAliasReady = true;
}

// --------------------------------------------------
// Per-user MinIO identity
// --------------------------------------------------

function minioUsernameFor(user) {
    const username = String(user.prn || user.name || user.username || "").trim().toLowerCase();
    const sanitized = username.replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (!sanitized || sanitized.length < 3) throw new Error("Cannot derive a valid S3 username from the current user.");
    return sanitized;
}

function minioPasswordFor(userId) {
    const salt = process.env.MINIO_USER_PASSWORD_SALT || s3Config.sessionSecret;
    return crypto.createHmac("sha256", salt).update(`minio-user:${userId}`).digest("base64url");
}

async function minioUserExists(username) {
    await ensureMcAlias();
    try {
        await runMc(["admin", "user", "info", s3Config.mcAlias, username]);
        return true;
    } catch (error) {
        const output = `${error.stdout || ""}\n${error.stderr || ""}`.toLowerCase();
        if (output.includes("not exist") || output.includes("no such") || output.includes("not found") || output.includes("unable to get user")) return false;
        throw error;
    }
}

const minioUsersProvisioned = new Set();

// Probe whether the derived per-user credentials actually authenticate.
// Returns 'ok' (or bucket missing), 'bad' for credential mismatch.
async function probeUserCredentials(userId, username) {
    const client = userClient(userId, username);
    try {
        await client.send(new ListObjectsV2Command({ Bucket: `${username}-workspace`, MaxKeys: 1 }));
        return "ok";
    } catch (error) {
        if (error.name === "NoSuchBucket") return "ok"; // credentials fine, bucket not created yet
        if (error.name === "SignatureDoesNotMatch" || error.name === "InvalidAccessKeyId") return "bad";
        throw error;
    }
}

async function ensureMinioUser(userId, username) {
    if (minioUsersProvisioned.has(userId)) return false;
    if (await minioUserExists(username)) {
        // Heal credential drift (e.g. database rebuilt with different user ids):
        // if the derived password no longer matches, rotate it via re-add.
        const status = await probeUserCredentials(userId, username);
        if (status === "bad") {
            await runMc(["admin", "user", "add", s3Config.mcAlias, username, minioPasswordFor(userId)]);
            minioUsersProvisioned.add(userId);
            return true;
        }
        minioUsersProvisioned.add(userId);
        return false;
    }
    try {
        await runMc(["admin", "user", "add", s3Config.mcAlias, username, minioPasswordFor(userId)]);
    } catch (error) {
        const output = `${error.stdout || ""}\n${error.stderr || ""}`.toLowerCase();
        // Tolerate a concurrent first-time creation.
        if (!output.includes("already exists")) throw error;
    }
    minioUsersProvisioned.add(userId);
    return true;
}

// --------------------------------------------------
// Buckets + policies
// --------------------------------------------------

function bucketFor(user) {
    return `${minioUsernameFor(user)}-workspace`;
}

function labelToBucketName(username, label) {
    const clean = String(label || "bucket").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    return `${username}-${clean}-${crypto.randomBytes(4).toString("hex")}`.slice(0, 63);
}

function bucketPolicy(bucketName) {
    return {
        Version: "2012-10-17",
        Statement: [
            { Sid: "ListOwnBucket", Effect: "Allow", Action: ["s3:ListBucket", "s3:GetBucketLocation"], Resource: [`arn:aws:s3:::${bucketName}`] },
            { Sid: "ManageOwnObjects", Effect: "Allow", Action: ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"], Resource: [`arn:aws:s3:::${bucketName}/*`] },
        ],
    };
}

function policyNameFor(bucketName) {
    return `${bucketName}-policy`;
}

async function ensureBucket(bucketName) {
    try {
        await masterClient.send(new CreateBucketCommand({ Bucket: bucketName }));
    } catch (error) {
        if (error.name === "BucketAlreadyOwnedByYou" || error.name === "BucketAlreadyExists") return;
        throw error;
    }
}

async function attachBucketPolicy(username, bucketName) {
    await ensureMcAlias();
    const policyName = policyNameFor(bucketName);
    const policyFile = path.join(os.tmpdir(), `${policyName}-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(policyFile, JSON.stringify(bucketPolicy(bucketName), null, 2), { mode: 0o600 });
    try {
        try {
            await runMc(["admin", "policy", "create", s3Config.mcAlias, policyName, policyFile]);
        } catch (error) {
            const output = `${error.stdout || ""}\n${error.stderr || ""}`.toLowerCase();
            if (!output.includes("already exists") && !output.includes("already present")) throw error;
        }
        await runMc(["admin", "policy", "attach", s3Config.mcAlias, policyName, `--user=${username}`]);
    } finally {
        fs.rmSync(policyFile, { force: true });
    }
    return policyName;
}

async function detachBucketPolicy(username, bucketName) {
    await ensureMcAlias();
    const policyName = policyNameFor(bucketName);
    try {
        await runMc(["admin", "policy", "detach", s3Config.mcAlias, policyName, `--user=${username}`]);
    } catch (_) {
        // policy may not exist or may not be attached; cleanup is best-effort
    }
}

async function getOwnedBuckets(userId) {
    const [rows] = await pool.execute(
        `SELECT id, bucket_name, status, created_at FROM s3_buckets WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC`,
        [userId]
    );
    return rows.map(r => ({ id: r.id, name: r.bucket_name, status: r.status, createdAt: r.created_at }));
}

async function isOwnedBucket(userId, bucketName) {
    const [rows] = await pool.execute(
        `SELECT 1 FROM s3_buckets WHERE user_id = ? AND bucket_name = ? AND status = 'active' LIMIT 1`,
        [userId, bucketName]
    );
    return rows.length > 0;
}

async function provisionBucket(userId, bucketName, username) {
    await ensureBucket(bucketName);
    await attachBucketPolicy(username, bucketName);
    await pool.execute(
        `INSERT INTO s3_buckets (user_id, bucket_name, status) VALUES (?, ?, 'active')`,
        [userId, bucketName]
    );
    return bucketName;
}

async function isBucketEmpty(bucketName) {
    const response = await masterClient.send(
        new ListObjectsV2Command({ Bucket: bucketName, MaxKeys: 1 })
    );
    return !response.Contents || response.Contents.length === 0;
}

async function deleteMinioBucket(bucketName) {
    try {
        await masterClient.send(new DeleteBucketCommand({ Bucket: bucketName }));
    } catch (error) {
        if (error.name === "NoSuchBucket") return;
        throw error;
    }
}

async function deleteOwnedBucket(userId, bucketName, username) {
    if (!(await isOwnedBucket(userId, bucketName))) {
        throw new Error("That bucket does not belong to your account.");
    }
    if (!(await isBucketEmpty(bucketName))) {
        throw new Error("Bucket is not empty. Delete all files before deleting the bucket.");
    }
    await deleteMinioBucket(bucketName);
    await detachBucketPolicy(username, bucketName);
    await pool.execute(
        `UPDATE s3_buckets SET status = 'deleted' WHERE user_id = ? AND bucket_name = ? AND status = 'active'`,
        [userId, bucketName]
    );
    return bucketName;
}

// --------------------------------------------------
// Per-user S3 client (MinIO enforces isolation)
// --------------------------------------------------

function userClient(userId, username) {
    return new S3Client({
        endpoint: s3Config.endpoint,
        region: s3Config.region,
        credentials: { accessKeyId: username, secretAccessKey: minioPasswordFor(userId) },
        forcePathStyle: true,
    });
}

// --------------------------------------------------
// Application integrations (per-bucket access keys)
// --------------------------------------------------

function parseAccessKeyOutput(output) {
    const text = `${output.stdout || ""}\n${output.stderr || ""}`;
    const accessMatch = text.match(/Access\s*Key\s*[:=]\s*(\S+)/i);
    const secretMatch = text.match(/Secret\s*Key\s*[:=]\s*(\S+)/i);
    if (accessMatch && secretMatch) return { accessKey: accessMatch[1], secretKey: secretMatch[1] };
    try {
        const start = text.indexOf("{");
        const parsed = JSON.parse(text.slice(start));
        const accessKey = parsed.accessKey || parsed.AccessKeyID || parsed.accessKeyId || parsed.AccessKeyId;
        const secretKey = parsed.secretKey || parsed.SecretAccessKey || parsed.secretAccessKey;
        if (accessKey && secretKey) return { accessKey, secretKey };
    } catch (_) {}
    throw new Error("MinIO created no readable application credentials. Check the mc version and command output.");
}

const integrationLocks = new Set();

async function createIntegration(userId, username, bucketName, label) {
    if (!(await isOwnedBucket(userId, bucketName))) {
        throw new Error("That bucket does not belong to your account.");
    }
    const cleanLabel = String(label || "application").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "application";
    const [existing] = await pool.execute(
        `SELECT 1 FROM s3_integrations WHERE user_id = ? AND bucket_name = ? AND name = ? AND status = 'active' LIMIT 1`,
        [userId, bucketName, cleanLabel]
    );
    if (existing.length > 0) {
        const error = new Error("Credentials already exist for this bucket and application. Use the existing saved credentials; no new key was created.");
        error.publicMessage = error.message;
        throw error;
    }
    const integrationKey = `${userId}:${bucketName}:${cleanLabel}`;
    if (integrationLocks.has(integrationKey)) {
        const error = new Error("Credential creation is already in progress. Refresh and check the integrations list.");
        error.publicMessage = error.message;
        throw error;
    }
    integrationLocks.add(integrationKey);
    const policyFile = path.join(os.tmpdir(), `${policyNameFor(bucketName)}-integration-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(policyFile, JSON.stringify(bucketPolicy(bucketName), null, 2), { mode: 0o600 });
    try {
        await ensureMcAlias();
        const output = await runMc(["admin", "accesskey", "create", s3Config.mcAlias, username, "--name", cleanLabel, "--policy", policyFile]);
        const credentials = parseAccessKeyOutput(output);
        await pool.execute(
            `INSERT INTO s3_integrations (user_id, access_key, name, bucket_name, status) VALUES (?, ?, ?, ?, 'active')`,
            [userId, credentials.accessKey, cleanLabel, bucketName]
        );
        return { ...credentials, name: cleanLabel, bucketName, endpoint: s3Config.endpoint, region: s3Config.region };
    } finally {
        integrationLocks.delete(integrationKey);
        fs.rmSync(policyFile, { force: true });
    }
}

async function getIntegrations(userId) {
    const [rows] = await pool.execute(
        `SELECT id, access_key, name, bucket_name, status, created_at FROM s3_integrations WHERE user_id = ? AND status = 'active' ORDER BY created_at DESC`,
        [userId]
    );
    return rows.map(r => ({ id: r.id, accessKey: r.access_key, name: r.name, bucketName: r.bucket_name, status: r.status, createdAt: r.created_at }));
}

async function deleteIntegration(userId, accessKey) {
    const [rows] = await pool.execute(
        `SELECT id, access_key FROM s3_integrations WHERE user_id = ? AND access_key = ? AND status = 'active' LIMIT 1`,
        [userId, accessKey]
    );
    if (rows.length === 0) throw new Error("That access key does not belong to your account.");
    await ensureMcAlias();
    try {
        await runMc(["admin", "accesskey", "remove", s3Config.mcAlias, accessKey]);
    } catch (error) {
        const output = `${error.stdout || ""}\n${error.stderr || ""}`.toLowerCase();
        if (!output.includes("does not exist") && !output.includes("no such") && !output.includes("not found")) throw error;
    }
    await pool.execute(
        `UPDATE s3_integrations SET status = 'deleted' WHERE id = ?`,
        [rows[0].id]
    );
    return accessKey;
}

module.exports = {
    masterClient,
    runMc,
    ensureMcAlias,
    minioUsernameFor,
    minioPasswordFor,
    minioUserExists,
    ensureMinioUser,
    bucketFor,
    labelToBucketName,
    bucketPolicy,
    policyNameFor,
    ensureBucket,
    attachBucketPolicy,
    detachBucketPolicy,
    getOwnedBuckets,
    isOwnedBucket,
    provisionBucket,
    isBucketEmpty,
    deleteMinioBucket,
    deleteOwnedBucket,
    userClient,
    createIntegration,
    getIntegrations,
    deleteIntegration,
};
