const multer = require("multer");
const path = require("path");
const s3Config = require("./s3Config");
const s3Service = require("./s3Service");
const { requireStudent } = require("../auth/authMiddleware");
const { ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: s3Config.maxUploadBytes, files: 1 } });

function redirectWith(res, values) {
    res.redirect(`/?${new URLSearchParams(values).toString()}`);
}

async function resolveBucket(req, user) {
    const selected = req.session.s3Bucket;
    if (selected && await s3Service.isOwnedBucket(user.id, selected)) return selected;
    return s3Service.bucketFor(user);
}

async function handleDashboard(req, res) {
    const user = req.session.user;
    try {
        const defaultBucket = s3Service.bucketFor(user);
        let buckets = await s3Service.getOwnedBuckets(user.id);
        if (!buckets.some(b => b.name === defaultBucket)) {
            try { await s3Service.provisionBucket(user.id, defaultBucket); } catch (_) {}
            buckets = await s3Service.getOwnedBuckets(user.id);
        }
        const selectedBucket = buckets.some(b => b.name === req.session.s3Bucket)
            ? req.session.s3Bucket
            : (buckets.some(b => b.name === defaultBucket)
                ? defaultBucket
                : (buckets[0] ? buckets[0].name : defaultBucket));
        req.session.s3Bucket = selectedBucket;
        const files = [];
        try {
            const response = await s3Service.masterClient.send(
                new ListObjectsV2Command({ Bucket: selectedBucket })
            );
            files = response.Contents || [];
        } catch (_) {}
        return res.render("s3", {
            user: user.name || user.prn,
            bucket: selectedBucket,
            buckets,
            files,
            error: req.query.error || null,
            success: req.query.success || null,
        });
    } catch (error) {
        console.error("[S3 DASHBOARD ERROR]", error);
        return res.render("s3", {
            user: req.session.user.name || req.session.user.prn,
            bucket: null,
            buckets: [],
            files: [],
            error: "S3 dashboard loading failed.",
            success: null,
        });
    }
}

async function handleCreateBucket(req, res) {
    try {
        const user = req.session.user;
        const label = String(req.body.label || "bucket").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        if (!label || label.length > 24) throw new Error("Bucket label must be 1-24 characters (letters, numbers, hyphens).");
        const bucketName = s3Service.labelToBucketName(s3Service.bucketFor(user), label);
        await s3Service.provisionBucket(user.id, bucketName);
        req.session.s3Bucket = bucketName;
        redirectWith(res, { success: `Bucket ${bucketName} created.` });
    } catch (error) {
        console.error("[BUCKET CREATE ERROR]", error);
        redirectWith(res, { error: error.publicMessage || error.message });
    }
}

async function handleUpload(req, res) {
    try {
        if (!req.file) throw new Error("Choose a file first.");
        const user = req.session.user;
        const targetBucket = await resolveBucket(req, user);
        const safeKey = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!safeKey || safeKey === "." || safeKey === "..") throw new Error("Invalid file name.");
        await s3Service.masterClient.send(
            new PutObjectCommand({ Bucket: targetBucket, Key: safeKey, Body: req.file.buffer, ContentType: req.file.mimetype || "application/octet-stream" })
        );
        redirectWith(res, { success: "File uploaded." });
    } catch (error) {
        console.error("[UPLOAD ERROR]", error);
        redirectWith(res, { error: error.publicMessage || error.message });
    }
}

async function handleDelete(req, res) {
    try {
        const user = req.session.user;
        const key = path.basename(String(req.body.key || ""));
        if (!key) throw new Error("Invalid object key.");
        const targetBucket = await resolveBucket(req, user);
        await s3Service.masterClient.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: key }));
        redirectWith(res, { success: "File deleted." });
    } catch (error) {
        console.error("[DELETE ERROR]", error);
        redirectWith(res, { error: error.publicMessage || error.message });
    }
}

async function handleDownload(req, res) {
    try {
        const user = req.session.user;
        const key = path.basename(String(req.query.key || ""));
        if (!key) return res.status(400).send("Invalid object key.");
        const targetBucket = await resolveBucket(req, user);
        const response = await s3Service.masterClient.send(new GetObjectCommand({ Bucket: targetBucket, Key: key }));
        res.setHeader("Content-Type", response.ContentType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${key.replace(/"/g, '')}"`);
        response.Body.pipe(res);
    } catch (error) {
        console.error("[DOWNLOAD ERROR]", error);
        res.status(403).send("Access denied or file not found.");
    }
}

async function handleSelectBucket(req, res) {
    try {
        const user = req.session.user;
        const bucketName = String(req.body.bucketName || "").trim().toLowerCase();
        if (!(await s3Service.isOwnedBucket(user.id, bucketName))) {
            return redirectWith(res, { error: "That bucket does not belong to your account." });
        }
        req.session.s3Bucket = bucketName;
        redirectWith(res, { success: `Selected bucket ${bucketName}.` });
    } catch (error) {
        console.error("[SELECT BUCKET ERROR]", error);
        redirectWith(res, { error: error.message });
    }
}

function handleError(error, req, res, next) {
    if (error && error.code === "LIMIT_FILE_SIZE") return redirectWith(res, { error: "File is too large. The development limit is 25 MB." });
    next(error);
}

module.exports = {
    upload,
    requireStudent,
    redirectWith,
    handleDashboard,
    handleCreateBucket,
    handleUpload,
    handleDelete,
    handleDownload,
    handleSelectBucket,
    handleError,
};