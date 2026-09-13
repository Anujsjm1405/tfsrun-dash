USE tfsrun;

ALTER TABLE allocations
ADD COLUMN allocation_type ENUM(
    'infrastructure',
    'service'
) NOT NULL DEFAULT 'service'
AFTER service_id;

ALTER TABLE allocations
ADD COLUMN description VARCHAR(255) NULL
AFTER storage_type;

INSERT INTO services (
    service_type,
    name,
    node_id,
    vmid,
    status
)
SELECT
    'storage',
    'S3 Infrastructure',
    id,
    105,
    'active'
FROM nodes
WHERE name = 'node1'
AND NOT EXISTS (
    SELECT 1
    FROM services
    WHERE vmid = 105
);

INSERT INTO allocations (
    service_id,
    node_id,
    cpu,
    ram_mb,
    storage_gb,
    storage_type,
    allocation_type,
    description,
    status
)
SELECT
    s.id,
    n.id,
    4,
    5120,
    238.50,
    'ssd',
    'infrastructure',
    'Permanent S3 VM 105 and SSD storage',
    'active'
FROM services s
JOIN nodes n
    ON n.name = 'node1'
WHERE s.vmid = 105
AND NOT EXISTS (
    SELECT 1
    FROM allocations a
    WHERE a.service_id = s.id
      AND a.allocation_type = 'infrastructure'
      AND a.status = 'active'
);
