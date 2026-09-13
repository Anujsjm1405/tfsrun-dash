USE tfsrun;

INSERT INTO nodes (
    name,
    host,
    port,
    total_cpu,
    reserved_cpu,
    total_ram_mb,
    reserved_ram_mb,
    total_storage_gb,
    reserved_storage_gb
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
    0
),
(
    'node2',
    '10.13.3.90',
    8006,
    4,
    2,
    16384,
    4096,
    1000,
    0
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
    0
)
ON DUPLICATE KEY UPDATE
    total_cpu = VALUES(total_cpu),
    reserved_cpu = VALUES(reserved_cpu),
    total_ram_mb = VALUES(total_ram_mb),
    reserved_ram_mb = VALUES(reserved_ram_mb),
    total_storage_gb = VALUES(total_storage_gb);

INSERT INTO templates (
    service_type,
    node_id,
    vmid,
    name,
    storage_gb
)
SELECT
    'compute',
    id,
    100,
    'Compute Template',
    32
FROM nodes
WHERE name = 'node1'
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    storage_gb = VALUES(storage_gb);

INSERT INTO templates (
    service_type,
    node_id,
    vmid,
    name,
    storage_gb
)
SELECT
    'database',
    id,
    999,
    'Database Template',
    8
FROM nodes
WHERE name = 'node2'
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    storage_gb = VALUES(storage_gb);
