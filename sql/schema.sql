CREATE DATABASE IF NOT EXISTS tfsrun;

USE tfsrun;

-- =========================================================
-- NODES
-- =========================================================

CREATE TABLE nodes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    name VARCHAR(50) NOT NULL UNIQUE,
    host VARCHAR(255) NOT NULL UNIQUE,
    port INT UNSIGNED NOT NULL DEFAULT 8006,

    total_cpu INT UNSIGNED NOT NULL,
    reserved_cpu INT UNSIGNED NOT NULL DEFAULT 2,

    total_ram_mb INT UNSIGNED NOT NULL,
    reserved_ram_mb INT UNSIGNED NOT NULL DEFAULT 4096,

    total_local_storage_gb DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_ssd_storage_gb DECIMAL(10,2) NOT NULL DEFAULT 0,

    enabled BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);


-- =========================================================
-- SERVICES
-- =========================================================

CREATE TABLE services (
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

    ip_address VARCHAR(45) NULL,

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
        REFERENCES nodes(id),

    INDEX idx_services_node (node_id),
    INDEX idx_services_status (status),
    INDEX idx_services_type (service_type)
);


-- =========================================================
-- RESOURCE ALLOCATIONS
-- =========================================================

CREATE TABLE allocations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    service_id BIGINT UNSIGNED NOT NULL,

    node_id INT UNSIGNED NOT NULL,

    cpu INT UNSIGNED NOT NULL DEFAULT 0,

    ram_mb INT UNSIGNED NOT NULL DEFAULT 0,

    storage_gb DECIMAL(10,2) NOT NULL DEFAULT 0,

    storage_type ENUM(
        'local',
        'ssd'
    ) NOT NULL DEFAULT 'local',

    allocation_type ENUM(
        'service',
        'infrastructure'
    ) NOT NULL DEFAULT 'service',

    description VARCHAR(255) NULL,

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
    ),

    INDEX idx_allocations_storage (
        node_id,
        storage_type,
        status
    )
);


-- =========================================================
-- PROXMOX TEMPLATES
-- =========================================================

CREATE TABLE templates (
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

    UNIQUE KEY unique_template_vmid (
        node_id,
        vmid
    ),

    FOREIGN KEY (node_id)
        REFERENCES nodes(id),

    INDEX idx_templates_lookup (
        service_type,
        node_id,
        enabled
    )
);
