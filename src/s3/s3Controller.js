const multer = require("multer");
const path = require("path");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");
const s3Config = require("./s3Config");
const s3Service = require("./s3Service");
const { ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");

// Files are buffered to a temp file on disk (not RAM), then streamed to MinIO,
// so uploads of any practical size work without a size limit.
const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const dir = path.join(os.tmpdir(), "tfsrun-uploads");
            fs.mkdir(dir, { recursive: true }, (error) => cb(error, dir));
        },
        filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`)
    }),
    limits: { files: 1 },
    fileFilter: (_req, file, cb) => cb(null, true)
});

function redirectWith(res, values) {
    res.redirect(`/student/s3?${new URLSearchParams(values).toString()}`);
}

// Public-safe error surface: never leak mc/SDK internals into redirects.
const PUBLIC_ERROR_PATTERNS = [
    /already exist/i,
    /does not belong/i,
    /cannot be deleted/i,
    /not empty/i,
    /invalid (file|object|bucket|access)/i,
    /label must/i,
    /choose a file/i,
    /credentials already/i,
    /in progress/i,
    /cannot derive a valid/i,
    /workspace bucket/i,
];

function publicMessage(error) {
    if (!error) return "The operation could not be completed.";
    if (error.publicMessage) return error.publicMessage;
    const message = String(error.message || "");
    if (PUBLIC_ERROR_PATTERNS.some(p => p.test(message))) return message;
    return "The operation could not be completed. Please try again.";
}

async function resolveBucket(req, user) {
    const selected = req.session.s3Bucket;
    if (selected && await s3Service.isOwnedBucket(user.id, selected)) return selected;
    return s3Service.bucketFor(user);
}

// Make sure the MinIO-side user exists before any per-user credential use.
// Cheap after the first call (in-memory cache in the service).
async function ensureUser(user) {
    const username = s3Service.minioUsernameFor(user);
    await s3Service.ensureMinioUser(user.id, username);
    return username;
}

function handleError(err, res, fallback) {
    console.error(fallback, err);
    return redirectWith(res, { error: publicMessage(err) });
}

async function handleDashboard(req, res) {
    const user = req.session.user;
    try {
        const username = s3Service.minioUsernameFor(user);
        const defaultBucket = s3Service.bucketFor(user);
        let buckets = await s3Service.getOwnedBuckets(user.id);

        // Create the MinIO-side user on first visit; heal legacy buckets
        // (created before per-user policies) by attaching their policies.
        const createdMinioUser = await s3Service.ensureMinioUser(user.id, username);
        if (createdMinioUser) {
            for (const bucket of buckets) {
                try { await s3Service.attachBucketPolicy(username, bucket.name); } catch (_) {}
            }
        }

        if (!buckets.some(b => b.name === defaultBucket)) {
            try { await s3Service.provisionBucket(user.id, defaultBucket, username); } catch (_) {}
            buckets = await s3Service.getOwnedBuckets(user.id);
        }

        const selectedBucket = buckets.some(b => b.name === req.session.s3Bucket)
            ? req.session.s3Bucket
            : (buckets.some(b => b.name === defaultBucket)
                ? defaultBucket
                : (buckets[0] ? buckets[0].name : defaultBucket));
        req.session.s3Bucket = selectedBucket;

        const integrations = await s3Service.getIntegrations(user.id);

        let files = [];
        let storageError = null;
        try {
            const client = s3Service.userClient(user.id, username);
            const response = await client.send(
                new ListObjectsV2Command({ Bucket: selectedBucket })
            );
            files = response.Contents || [];
        } catch (error) {
            storageError = "MinIO authorization or dashboard loading failed.";
        }

        const oneTimeIntegration = req.session.oneTimeIntegration || null;
        delete req.session.oneTimeIntegration;

        return res.render("s3", {
            user: user.name || user.prn,
            username,
            bucket: selectedBucket,
            buckets,
            files,
            integrations,
            integration: oneTimeIntegration,
            storageError,
            error: req.query.error || null,
            success: req.query.success || null,
        });
    } catch (error) {
        console.error("[S3 DASHBOARD ERROR]", error);
        return res.render("s3", {
            user: req.session.user.name || req.session.user.prn,
            username: null,
            bucket: null,
            buckets: [],
            files: [],
            integrations: [],
            integration: null,
            storageError: null,
            error: "S3 dashboard loading failed.",
            success: null,
        });
    }
}

// --------------------------------------------------
// Documentation page
// --------------------------------------------------

function handleDocs(req, res) {
    const user = req.session.user;
    try {
        const username = s3Service.minioUsernameFor(user);
        const defaultBucket = s3Service.bucketFor(user);
        return res.render("s3-docs", {
            user: user.name || user.prn,
            username,
            defaultBucket,
            endpoint: s3Config.endpoint,
            region: s3Config.region,
        });
    } catch (error) {
        console.error("[S3 DOCS ERROR]", error);
        return res.render("s3-docs", {
            user: user.name || user.prn,
            username: null,
            defaultBucket: null,
            endpoint: s3Config.endpoint,
            region: s3Config.region,
        });
    }
}

async function handleCreateBucket(req, res) {
    try {
        const user = req.session.user;
        const label = String(req.body.label || "bucket").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        if (!label || label.length > 24) throw new Error("Bucket label must be 1-24 characters (letters, numbers, hyphens).");
        const username = await ensureUser(user);
        const bucketName = s3Service.labelToBucketName(username, label);
        await s3Service.provisionBucket(user.id, bucketName, username);
        req.session.s3Bucket = bucketName;
        redirectWith(res, { success: `Bucket ${bucketName} created.` });
    } catch (error) {
        return handleError(error, res, "[BUCKET CREATE ERROR]");
    }
}

async function handleUpload(req, res) {
    try {
        if (!req.file) throw new Error("Choose a file first.");
        const user = req.session.user;
        const targetBucket = await resolveBucket(req, user);
        const safeKey = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
        if (!safeKey || safeKey === "." || safeKey === "..") throw new Error("Invalid file name.");
        const client = s3Service.userClient(user.id, await ensureUser(user));
        const body = fs.createReadStream(req.file.path);
        try {
            await client.send(
                new PutObjectCommand({ Bucket: targetBucket, Key: safeKey, Body: body, ContentLength: req.file.size, ContentType: req.file.mimetype || "application/octet-stream" })
            );
        } finally {
            fs.rm(req.file.path, { force: true }, () => {});
        }
        redirectWith(res, { success: "File uploaded." });
    } catch (error) {
        return handleError(error, res, "[UPLOAD ERROR]");
    }
}

async function handleDelete(req, res) {
    try {
        const user = req.session.user;
        const key = path.basename(String(req.body.key || ""));
        if (!key) throw new Error("Invalid object key.");
        const targetBucket = await resolveBucket(req, user);
        const client = s3Service.userClient(user.id, await ensureUser(user));
        await client.send(new DeleteObjectCommand({ Bucket: targetBucket, Key: key }));
        redirectWith(res, { success: "File deleted." });
    } catch (error) {
        return handleError(error, res, "[DELETE ERROR]");
    }
}

async function handleDownload(req, res) {
    try {
        const user = req.session.user;
        const key = path.basename(String(req.query.key || ""));
        if (!key) return res.status(400).send("Invalid object key.");
        const targetBucket = await resolveBucket(req, user);
        const client = s3Service.userClient(user.id, await ensureUser(user));
        const response = await client.send(new GetObjectCommand({ Bucket: targetBucket, Key: key }));
        res.setHeader("Content-Type", response.ContentType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename=\"${key.replace(/\"/g, '')}\"`);
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
        return handleError(error, res, "[SELECT BUCKET ERROR]");
    }
}

async function handleDeleteBucket(req, res) {
    try {
        const user = req.session.user;
        const bucketName = String(req.body.bucketName || "").trim().toLowerCase();
        if (!bucketName) throw new Error("Invalid bucket name.");
        if (bucketName === s3Service.bucketFor(user)) {
            throw new Error("The default workspace bucket cannot be deleted.");
        }
        await s3Service.deleteOwnedBucket(user.id, bucketName, await ensureUser(user));
        if (req.session.s3Bucket === bucketName) {
            req.session.s3Bucket = s3Service.bucketFor(user);
        }
        redirectWith(res, { success: `Bucket ${bucketName} deleted.` });
    } catch (error) {
        return handleError(error, res, "[BUCKET DELETE ERROR]");
    }
}

async function handleCreateIntegration(req, res) {
    try {
        const user = req.session.user;
        const bucketName = String(req.body.bucketName || "").trim().toLowerCase();
        const integration = await s3Service.createIntegration(
            user.id,
            await ensureUser(user),
            bucketName,
            req.body.label || "application"
        );
        // Secret is shown exactly once, on the next page render.
        req.session.oneTimeIntegration = integration;
        redirectWith(res, { success: "Application credentials created. Save the secret now; it will not be shown again." });
    } catch (error) {
        return handleError(error, res, "[INTEGRATION ERROR]");
    }
}

async function handleDeleteIntegration(req, res) {
    try {
        const user = req.session.user;
        const accessKey = String(req.body.accessKey || "").trim();
        await s3Service.deleteIntegration(user.id, accessKey);
        redirectWith(res, { success: `Access key ${accessKey} removed.` });
    } catch (error) {
        return handleError(error, res, "[INTEGRATION DELETE ERROR]");
    }
}function handleErrorMiddleware(error, req, res, next) {
    if (error && error.name === "MulterError") {
        const friendly = {
            LIMIT_FILE_COUNT: "Only one file can be uploaded at a time.",
            LIMIT_UNEXPECTED_FILE: "Unexpected upload field. Use the file input on the storage page."
        };
        return redirectWith(res, { error: friendly[error.code] || "File upload failed. Please try again." });
    }
    next(error);
}

module.exports = {
    upload,
    redirectWith,
    handleDashboard,
    handleDocs,
    handleCreateBucket,
    handleUpload,
    handleDelete,
    handleDeleteBucket,
    handleDownload,
    handleSelectBucket,
    handleCreateIntegration,
    handleDeleteIntegration,
    handleErrorMiddleware,
};
