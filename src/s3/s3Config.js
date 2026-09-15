require("dotenv").config();
const fs = require("fs");
const path = require("path");

function resolveMcPath() {
    const envPath = process.env.MINIO_MC_PATH;
    if (envPath && fs.existsSync(envPath)) return envPath;
    const candidates = [
        "mc",
        path.join(process.env.HOME || process.env.USERPROFILE || "", "mc"),
        path.join(process.env.HOME || process.env.USERPROFILE || "", "bin", "mc"),
        "/usr/local/bin/mc",
        "/opt/homebrew/bin/mc",
        "C:\\tools\\mc.exe",
        "C:\\Program Files\\mc\\mc.exe"
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) return p;
        } catch (_) {}
    }
    return "mc";
}

const s3Config = {
    endpoint: process.env.S3_ENDPOINT || "http://localhost:9000",
    region: process.env.S3_REGION || "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY || "",
    secretAccessKey: process.env.S3_SECRET_KEY || "",
    sessionSecret: process.env.SESSION_SECRET || "tfsrun-session-secret",
    maxUploadBytes: 25 * 1024 * 1024,
    sessionTtlMs: 8 * 60 * 60 * 1000,
    mcPath: resolveMcPath(),
    mcAlias: process.env.MINIO_ALIAS || "localminio"
};

module.exports = s3Config;
