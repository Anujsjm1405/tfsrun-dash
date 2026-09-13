USE tfsrun;

UPDATE templates
SET
    vmid = 111,
    name = 'Compute Template'
WHERE service_type = 'compute';

UPDATE templates
SET
    node_id = (
        SELECT id
        FROM nodes
        WHERE name = 'node3'
    ),
    vmid = 999,
    name = 'Database Template'
WHERE service_type = 'database';
