USE tfsrun;

-- =========================================================
-- DATABASE INSTANCES
--
-- Connection details for a provisioned database service.
-- One row per service of type 'database'.
-- =========================================================

CREATE TABLE IF NOT EXISTS database_instances (

    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    service_id BIGINT UNSIGNED NOT NULL,

    db_user VARCHAR(63) NOT NULL,

    db_password VARCHAR(255) NOT NULL,

    db_port INT UNSIGNED NOT NULL DEFAULT 5432,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY unique_instance_service (service_id),

    FOREIGN KEY (service_id)
        REFERENCES services(id),

    INDEX idx_database_instances_service (service_id)
);


-- =========================================================
-- DATABASE TEMPLATES
--
-- Each node has its own database template, with its own vmid,
-- since Proxmox container/VM IDs are shared across the whole
-- cluster and cannot be reused between nodes:
--
--   node3 -> vmid 900
--   node1 -> vmid 901
--   node2 -> vmid 902
-- =========================================================

-- node3 already had a database template row from seed.sql.
-- Point it at the rebuilt template (the old 999 template did not
-- carry the bootstrap superuser password the backend needs).
UPDATE templates t
JOIN nodes n ON n.id = t.node_id
SET
    t.vmid = 900,
    t.name = 'db-template-node3',
    t.storage_gb = 8.00,
    t.enabled = TRUE
WHERE t.service_type = 'database'
  AND n.name = 'node3';


INSERT INTO templates (
    service_type, node_id, vmid, name, storage_gb, enabled
)
SELECT 'database', id, 901, 'db-template-node1', 8.00, TRUE
FROM nodes
WHERE name = 'node1'
  AND NOT EXISTS (
      SELECT 1 FROM templates t
      WHERE t.node_id = nodes.id AND t.service_type = 'database'
  );


INSERT INTO templates (
    service_type, node_id, vmid, name, storage_gb, enabled
)
SELECT 'database', id, 902, 'db-template-node2', 8.00, TRUE
FROM nodes
WHERE name = 'node2'
  AND NOT EXISTS (
      SELECT 1 FROM templates t
      WHERE t.node_id = nodes.id AND t.service_type = 'database'
  );