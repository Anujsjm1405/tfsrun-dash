const express = require("express");
const router = express.Router();
const s3Controller = require("./s3Controller");
const { requireStudent } = require("../auth/authMiddleware");
const { upload } = s3Controller;

router.get("/", requireStudent, s3Controller.handleDashboard);
router.post("/create-bucket", requireStudent, s3Controller.handleCreateBucket);
router.post("/select-bucket", requireStudent, s3Controller.handleSelectBucket);
router.post("/upload", requireStudent, upload.single("file"), s3Controller.handleUpload);
router.post("/delete", requireStudent, s3Controller.handleDelete);
router.get("/download", requireStudent, s3Controller.handleDownload);
router.use(s3Controller.handleError);

module.exports = router;