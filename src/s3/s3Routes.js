const express = require("express");
const router = express.Router();
const s3Controller = require("./s3Controller");
const { requireStudent } = require("../auth/authMiddleware");
const { upload } = s3Controller;

router.get("/", requireStudent, s3Controller.handleDashboard);
router.get("/docs", requireStudent, s3Controller.handleDocs);
router.post("/create-bucket", requireStudent, s3Controller.handleCreateBucket);
router.post("/select-bucket", requireStudent, s3Controller.handleSelectBucket);
router.post("/delete-bucket", requireStudent, s3Controller.handleDeleteBucket);
router.post("/create-integration", requireStudent, s3Controller.handleCreateIntegration);
router.post("/delete-integration", requireStudent, s3Controller.handleDeleteIntegration);
router.post("/upload", requireStudent, upload.single("file"), s3Controller.handleUpload);
router.post("/delete", requireStudent, s3Controller.handleDelete);
router.get("/download", requireStudent, s3Controller.handleDownload);
router.use(s3Controller.handleErrorMiddleware);

module.exports = router;
