-- =========================================================
-- S3 INTEGRATIONS: per-bucket application access keys
-- (service accounts usable from external S3 SDKs)
-- =========================================================

USE tfsrun;

CREATE TABLE IF NOT EXISTS s3_integrations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    access_key VARCHAR(64) NOT NULL,
    name VARCHAR(64) NOT NULL,
    bucket_name VARCHAR(63) NOT NULL,
    status ENUM('active', 'deleted') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_access_key (access_key),
    INDEX idx_s3_integrations_user (user_id),
    INDEX idx_s3_integrations_bucket (bucket_name)
);
