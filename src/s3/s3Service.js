const crypto = require("crypto");
const {
    S3Client,
    CreateBucketCommand,
    ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const s3Config = require("./s3Config");
const pool = require("../db/mysql");

const masterClient = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: { accessKeyId: s3Config.accessKeyId, secretAccessKey: s3Config.secretAccessKey },
    forcePathStyle: true,
});

function bucketFor(user) {
    const username = String(user.prn || user.name || user.username || "").trim().toLowerCase();
    const sanitized = username.replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    if (!sanitized || sanitized.length < 3) throw new Error("Cannot derive a valid S3 username from the current user.");
    return `${sanitized}-workspace`;
}

function labelToBucketName(username, label) {
    const clean = String(label || "bucket").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    return `${username}-${clean}-${crypto.randomBytes(4).toString("hex")}`.slice(0, 63);
}

async function ensureBucket(bucketName) {
    try {
        await masterClient.send(new CreateBucketCommand({ Bucket: bucketName }));
    } catch (error) {
        if (error.name === "BucketAlreadyOwnedByYou" || error.name === "BucketAlreadyExists") return;
        throw error;
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

async function provisionBucket(userId, bucketName) {
    await ensureBucket(bucketName);
    await pool.execute(
        `INSERT INTO s3_buckets (user_id, bucket_name, status) VALUES (?, ?, 'active')`,
        [userId, bucketName]
    );
    return bucketName;
}

module.exports = {
    masterClient,
    bucketFor,
    labelToBucketName,
    ensureBucket,
    getOwnedBuckets,
    isOwnedBucket,
    provisionBucket,
};