USE tfsrun;

-- =========================================================
-- NODES
-- =========================================================

INSERT INTO nodes (
    name,
    host,
    port,
    total_cpu,
    reserved_cpu,
    total_ram_mb,
    reserved_ram_mb,
    total_local_storage_gb,
    total_ssd_storage_gb,
    enabled
)
VALUES
(
    'node1',
    '10.13.3.92',
    8006,
    8,
    2,
    12288,
    4096,
    794.30,
    238.50,
    TRUE
),
(
    'node2',
    '10.13.3.90',
    8006,
    4,
    2,
    16384,
    4096,
    794.30,
    0.00,
    TRUE
),
(
    'node3',
    '10.13.3.91',
    8006,
    4,
    2,
    16384,
    4096,
    794.30,
    238.50,
    TRUE
);


-- =========================================================
-- COMPUTE TEMPLATES
-- =========================================================

-- Node1: existing prepared compute template
INSERT INTO templates (
    service_type,
    node_id,
    vmid,
    name,
    storage_gb,
    enabled
)
SELECT
    'compute',
    id,
    111,
    'tfsrun-ubuntu-template-node1',
    32.00,
    TRUE
FROM nodes
WHERE name = 'node1';


-- Node2: existing prepared compute template
INSERT INTO templates (
    service_type,
    node_id,
    vmid,
    name,
    storage_gb,
    enabled
)
SELECT
    'compute',
    id,
    112,
    'tfsrun-compute-template-node2',
    32.00,
    TRUE
FROM nodes
WHERE name = 'node2';


-- =========================================================
-- DATABASE TEMPLATE
-- Metadata only.
-- Database provisioning is NOT enabled yet.
-- =========================================================

INSERT INTO templates (
    service_type,
    node_id,
    vmid,
    name,
    storage_gb,
    enabled
)
SELECT
    'database',
    id,
    999,
    'db-clean-master',
    8.00,
    TRUE
FROM nodes
WHERE name = 'node3';


-- =========================================================
-- S3 INFRASTRUCTURE SERVICE
-- Existing permanent VM 105 on node1.
-- =========================================================

INSERT INTO services (
    service_type,
    name,
    owner_id,
    node_id,
    vmid,
    ip_address,
    status
)
SELECT
    'storage',
    'S3 Infrastructure',
    NULL,
    id,
    105,
    NULL,
    'active'
FROM nodes
WHERE name = 'node1';


-- =========================================================
-- S3 RESOURCE ALLOCATION
-- VM 105 permanently consumes:
-- CPU  = 4 cores
-- RAM  = 5 GB
-- SSD  = 238.50 GB
-- =========================================================

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
    s.node_id,
    4,
    5120,
    238.50,
    'ssd',
    'infrastructure',
    'Permanent S3 VM 105 and SSD storage',
    'active'
FROM services s
JOIN nodes n
    ON n.id = s.node_id
WHERE
    s.service_type = 'storage'
    AND s.vmid = 105
    AND n.name = 'node1';
