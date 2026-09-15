-- =========================================================
-- S3 / MinIO TABLES
-- =========================================================

USE tfsrun;

-- ---------------------------------------------------------
-- S3 Buckets: user-owned buckets
-- ---------------------------------------------------------
CREATE TABLE s3_buckets (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    bucket_name VARCHAR(63) NOT NULL,
    status ENUM('active', 'deleted') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_bucket_name (bucket_name),
    INDEX idx_s3_buckets_user (user_id),
    INDEX idx_s3_buckets_status (status)
);

-- ---------------------------------------------------------
-- View: User S3 Summary
-- ---------------------------------------------------------
CREATE OR REPLACE VIEW v_user_s3_summary AS
SELECT
    u.id AS user_id,
    u.prn,
    u.name,
    COUNT(DISTINCT b.id) AS bucket_count
FROM users u
LEFT JOIN s3_buckets b ON b.user_id = u.id AND b.status = 'active'
GROUP BY u.id, u.prn, u.name;