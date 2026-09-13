CREATE DATABASE IF NOT EXISTS tfsrun;

USE tfsrun;

CREATE TABLE IF NOT EXISTS nodes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    host VARCHAR(255) NOT NULL UNIQUE,
    port INT UNSIGNED NOT NULL DEFAULT 8006,

    total_cpu INT UNSIGNED NOT NULL,
    reserved_cpu INT UNSIGNED NOT NULL DEFAULT 2,

    total_ram_mb INT UNSIGNED NOT NULL,
    reserved_ram_mb INT UNSIGNED NOT NULL DEFAULT 4096,

    total_storage_gb DECIMAL(10,2) NOT NULL DEFAULT 0,
    reserved_storage_gb DECIMAL(10,2) NOT NULL DEFAULT 0,

    enabled BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS services (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    service_type ENUM(
        'compute',
        'storage',
        'database'
    ) NOT NULL,

    name VARCHAR(100) NOT NULL,

    owner_id BIGINT UNSIGNED NULL,

    node_id INT UNSIGNED NOT NULL,

    vmid INT UNSIGNED NULL,

    status ENUM(
        'provisioning',
        'active',
        'stopped',
        'deleting',
        'deleted',
        'failed'
    ) NOT NULL DEFAULT 'provisioning',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (node_id)
        REFERENCES nodes(id)
);

CREATE TABLE IF NOT EXISTS allocations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    service_id BIGINT UNSIGNED NOT NULL,
    node_id INT UNSIGNED NOT NULL,

    cpu INT UNSIGNED NOT NULL DEFAULT 0,
    ram_mb INT UNSIGNED NOT NULL DEFAULT 0,
    storage_gb DECIMAL(10,2) NOT NULL DEFAULT 0,

    storage_type ENUM(
        'local',
        'ssd',
        'nfs'
    ) NOT NULL DEFAULT 'local',

    status ENUM(
        'active',
        'released'
    ) NOT NULL DEFAULT 'active',

    allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    released_at TIMESTAMP NULL,

    FOREIGN KEY (service_id)
        REFERENCES services(id),

    FOREIGN KEY (node_id)
        REFERENCES nodes(id),

    INDEX idx_allocations_node_status (
        node_id,
        status
    ),

    INDEX idx_allocations_service (
        service_id
    )
);

CREATE TABLE IF NOT EXISTS templates (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    service_type ENUM(
        'compute',
        'database'
    ) NOT NULL,

    node_id INT UNSIGNED NOT NULL,

    vmid INT UNSIGNED NOT NULL,

    name VARCHAR(100) NOT NULL,

    storage_gb DECIMAL(10,2) NOT NULL,

    enabled BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE KEY unique_template_vmid (node_id, vmid),

    FOREIGN KEY (node_id)
        REFERENCES nodes(id)
);
