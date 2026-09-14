# TFSrun Development Handover

> **WARNING — DEVELOPMENT ONLY**
>
> This repository intentionally documents and tracks the development `.env`, including development database, Proxmox, console, and session credentials. Do not use these credentials in production. Rotate them before any production deployment, remove secrets from Git history before making the repository public, and use a proper secret-management system in production.

TFSrun is a Node.js/Express cloud-platform development project for provisioning and managing virtual machines on a three-node Proxmox VE cluster. The current implementation provides student authentication, an Admin area, Compute VM provisioning, resource allocation, VM lifecycle operations, and an interactive serial terminal based on Proxmox `termproxy`, `vncwebsocket`, WebSocket, and xterm.js.

The repository also contains database and storage metadata for future Storage and Database services. Those services are not complete user-facing products yet.

## Current status

### Implemented

- Student registration and login using bcrypt password hashes.
- Separate Admin login and role-protected Admin dashboard.
- Student dashboard and Compute page.
- Compute VM creation from a node-local Proxmox template.
- CPU, RAM, local-storage, and SSD-storage allocation.
- Enabled-node selection with capacity checks.
- Cloud-init username/password configuration.
- VM start, Guest Agent readiness, IPv4 detection, and activation.
- Student VM listing, history, and lifecycle controls.
- Admin infrastructure-resource and service views.
- Interactive serial terminal using Proxmox termproxy and xterm.js.
- Short-lived, single-use browser terminal tickets.
- Responsive TFSrun CSS for student, Admin, and terminal pages.

### Partially implemented or infrastructure-only

- Storage service metadata exists in SQL seed data for the permanent S3 infrastructure VM, but there is no student S3 provisioning workflow.
- A Database template row is present in seed data, but there is no Database-as-a-Service provisioning workflow.
- The live database has a `users` table used by authentication, but the checked-in `sql/schema.sql` does not create that table. A database setup/migration outside these two SQL files is therefore required for a fresh authentication database.
- The live database currently contains a node3 compute template (VMID 113). The checked-in seed file inserts compute templates for node1 (111) and node2 (112), so seed data and live runtime metadata are not identical.

### Planned

- Student-facing object storage/S3 service provisioning.
- Database service provisioning.
- Service-specific managers and dashboards for those future service types.
- Production-grade secret management, HTTPS, and deployment configuration.

## Architecture

```text
 Student or Admin browser
             |
             v
      Express.js / EJS
       |       |       \
       |       |        \ WebSocket upgrade
       |       |         v
       |       |   terminalProxy
       |       |         |
       |       |         +-- Proxmox access/ticket
       |       |         +-- termproxy
       |       |         +-- vncwebsocket / serial console
       |       |
       |       +-- Service Manager
       |                 |
       |                 +-- Resource Allocator
       |                 +-- ProxmoxClient
       |
       +-- MariaDB/MySQL
             |
             +-- users
             +-- nodes
             +-- services
             +-- allocations
             +-- templates

 Proxmox VE cluster
       +-- node1
       +-- node2
       +-- node3
```

The browser receives ordinary page/API responses from Express. VM lifecycle and allocation state are stored in MariaDB. `ProxmoxClient` is the API-token client for normal Proxmox operations. The terminal uses a separate console username/password to obtain a PVE authentication ticket and create a termproxy session.

## Repository structure

```text
.
├── app.js
├── package.json
├── package-lock.json
├── .env
├── .env.example
├── sql/
├── src/
│   ├── allocator/
│   ├── auth/
│   ├── config/
│   ├── db/
│   ├── proxmox/
│   ├── routes/
│   └── terminal/
├── views/
└── public/
    ├── css/
    ├── fonts/
    └── js/
```

### Important backend files

- `app.js` — Express setup, static assets, session middleware, page routes, student API routes, Admin API routes, VM lifecycle endpoints, terminal route mounting, WebSocket upgrade delegation, error handling, and server startup.
- `src/db/mysql.js` — creates the MySQL/MariaDB connection pool from environment variables.
- `src/config/proxmox.js` — loads the three normal Proxmox API-token configurations from `PVE_NODE1_*`, `PVE_NODE2_*`, and `PVE_NODE3_*`.
- `src/proxmox/index.js` — normalizes database node IDs (`1`, `2`, `3`) to `node1`, `node2`, and `node3`, and returns cached `ProxmoxClient` instances.
- `src/proxmox/ProxmoxClient.js` — Axios-based Proxmox API abstraction for VM IDs, clone/configure/resize/start/stop/delete, Guest Agent commands, Guest Agent shutdown, IPv4 discovery, and task polling.
- `src/allocator/resourceAllocator.js` — capacity calculation, enabled-node selection, allocation insertion, locking, and allocation release.
- `src/allocator/serviceManager.js` — Compute validation, service records, VM provisioning, lifecycle operations, history queries, and cleanup.
- `src/auth/authService.js` — student registration/authentication, Admin authentication, bcrypt comparison/hashing, and safe user lookup.
- `src/auth/authMiddleware.js` — `requireAuth`, `requireRole`, `requireStudent`, and `requireAdmin`.
- `src/routes/auth.js` — login/registration pages and authentication APIs.
- `src/routes/terminal.js` — ownership-checked terminal page and terminal-ticket routes.
- `src/terminal/terminalProxy.js` — Proxmox console authentication, termproxy creation, browser-ticket storage, WebSocket upgrade, protocol translation, and cleanup.

### Frontend and views

- `views/dashboard.ejs` — Student landing dashboard; Compute is available while Storage and Database are shown as in development.
- `views/compute.ejs` — VM creation form, Active VMs/History tabs, and page controls.
- `views/terminal.ejs` — full-viewport terminal page with connection status, Reconnect, and Disconnect controls.
- `views/admin-login.ejs` and `views/admin-dashboard.ejs` — Admin login and Admin infrastructure/service dashboard.
- `public/js/compute.js` — Compute cards, lifecycle actions, creation notifications, and provisioning polling.
- `public/js/terminal.js` — xterm.js initialization, FitAddon sizing, terminal input/output, resize forwarding, reconnect, and disconnect.
- `public/js/admin-dashboard.js` — Admin resource/service fetches, rendering, refresh buttons, Admin lifecycle actions, and logout.
- `public/js/auth.js` and `public/js/admin-auth.js` — Student and Admin login form clients.
- `public/css/auth.css`, `compute.css`, and `dashboard.css` — page and shared visual styling.
- `public/fonts/` — PixelCode application font assets. The terminal itself uses xterm's default monospace font configuration rather than the application display font.

`public/js/dashboard.js` is an older/secondary dashboard client and is not loaded by the current `views/dashboard.ejs`, which contains its own logout handler. Be careful before using it as the source of truth for the current Student dashboard.

## Development environment

The following values are copied from the current development `.env`. They are intentionally included in this development handover and must not be reused in production.

```dotenv
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=tfsrun
DB_USER=tfsrun
DB_PASSWORD=tfsrun@7

PVE_NODE1_NAME=node1
PVE_NODE1_HOST=10.13.3.92
PVE_NODE1_PORT=8006
PVE_NODE1_USER=root@pam
PVE_NODE1_TOKEN_NAME=tfsrun
PVE_NODE1_TOKEN_SECRET=04007f17-ca47-4d07-b0c0-f88a015fe5a7

PVE_NODE2_NAME=node2
PVE_NODE2_HOST=10.13.3.90
PVE_NODE2_PORT=8006
PVE_NODE2_USER=root@pam
PVE_NODE2_TOKEN_NAME=tfsrun
PVE_NODE2_TOKEN_SECRET=04007f17-ca47-4d07-b0c0-f88a015fe5a7

PVE_NODE3_NAME=node3
PVE_NODE3_HOST=10.13.3.91
PVE_NODE3_PORT=8006
PVE_NODE3_USER=root@pam
PVE_NODE3_TOKEN_NAME=tfsrun
PVE_NODE3_TOKEN_SECRET=04007f17-ca47-4d07-b0c0-f88a015fe5a7

PVE_CONSOLE_USER=tfsrun-console@pve
PVE_CONSOLE_PASSWORD=tfsrun@7
PVE_TLS_REJECT_UNAUTHORIZED=false

SESSION_SECRET=a1903b1fec018fd69c8f5c35150e1e919d3f451a41c5c54b7f7c670bd90d0875
```

Variable purposes:

- `PORT` — Express HTTP/WebSocket port. The current development value is used by `app.js` unless overridden.
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` — MariaDB/MySQL pool connection.
- `PVE_NODE{1,2,3}_NAME`, `HOST`, and `PORT` — Proxmox node identity and API endpoint.
- `PVE_NODE{1,2,3}_USER`, `TOKEN_NAME`, and `TOKEN_SECRET` — API-token authentication used by `ProxmoxClient` for normal VM operations.
- `PVE_CONSOLE_USER` and `PVE_CONSOLE_PASSWORD` — password authentication used only by the terminal proxy to obtain a PVE authentication ticket for `termproxy`.
- `PVE_TLS_REJECT_UNAUTHORIZED` — controls TLS certificate verification for Proxmox Axios/WebSocket clients. The current development setup disables certificate verification.
- `SESSION_SECRET` — Express session signing secret.

`.env.example` contains the variable names and blank placeholders. Do not replace the current development `.env` with the example file.

## Current Proxmox infrastructure

The checked-in SQL seed and current runtime database describe the following nodes:

| Node | Host | Port | CPU | Reserved CPU | RAM | Reserved RAM | Local storage | SSD storage | Enabled |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| node1 | 10.13.3.92 | 8006 | 8 cores | 2 cores | 12288 MB | 4096 MB | 794.30 GB | 238.50 GB | yes |
| node2 | 10.13.3.90 | 8006 | 4 cores | 2 cores | 16384 MB | 4096 MB | 794.30 GB | 0 GB | yes |
| node3 | 10.13.3.91 | 8006 | 4 cores | 2 cores | 16384 MB | 4096 MB | 794.30 GB | 238.50 GB | yes |

Current template metadata in the live database:

| Node | Service type | Template VMID | Template name | Template size |
|---|---|---:|---|---:|
| node1 | compute | 111 | `tfsrun-ubuntu-template-node1` | 32 GB |
| node2 | compute | 112 | `tfsrun-compute-template-node2` | 32 GB |
| node3 | compute | 113 | `tfsrun-compute-template-node3` | 32 GB |
| node3 | database | 999 | `db-clean-master` | 8 GB |

The node1 and node2 compute rows and the node3 database metadata are present in `sql/seed.sql`. The node3 compute row was observed in the current live database but is not inserted by the checked-in seed file.

The code chooses templates by database `templates.node_id`, `service_type`, and `enabled`; it does not hard-code the compute VMID in the provisioning function.

## Compute VM lifecycle

The current Compute request path is:

```text
Student form
   -> POST /api/services/compute
   -> request validation
   -> insert provisioning service row
   -> ResourceAllocator allocation and node selection
   -> update service.node_id
   -> commit service/allocation transaction
   -> choose enabled node-local compute template
   -> get Proxmox next VMID
   -> clone template
   -> wait for clone task
   -> configure CPU, RAM, cloud-init user/password
   -> resize scsi0 if requested storage exceeds template size
   -> store VMID
   -> start VM and wait for task
   -> wait for QEMU Guest Agent
   -> wait for non-loopback IPv4
   -> update ip_address and status=active
   -> return service data
```

Current Compute validation:

- Name is required and limited to 100 characters.
- CPU must be 1, 2, or 4 cores.
- RAM must be 2, 4, or 6 GB in the API; the service manager converts this to 2048, 4096, or 6144 MB.
- Storage must be 32, 64, or 128 GB.
- Storage type must be `local` or `ssd`, defaulting to `local`.
- VM username is required.
- VM password must contain at least 4 characters.

The service manager also sanitizes the Proxmox VM name to letters, numbers, dot, underscore, and hyphen, and appends the service ID.

If allocation fails, template lookup fails, a Proxmox task fails, the VM cannot start, the Guest Agent does not become ready, or IPv4 detection times out, the service-manager failure path attempts to delete a partially-created VM, releases its active allocation, marks the service `failed`, and rethrows the error. The API returns a JSON error response. Since the creation call waits for provisioning, a slow Guest Agent/IP can keep the request open until the configured timeout.

## Resource allocator

`src/allocator/resourceAllocator.js` is the single capacity-calculation and allocation component. `serviceManager.createComputeService()` passes its already-open database transaction connection into `resourceAllocator.allocate(connection, options)`.

### Resource snapshot

`getNodeResources(nodeId, connection)` reads the node row and sums only `allocations.status = 'active'` for that node. It returns:

```text
CPU available = total_cpu - reserved_cpu - active allocation CPU
RAM available = total_ram_mb - reserved_ram_mb - active allocation RAM
Local available = total_local_storage_gb - active local allocation storage
SSD available = total_ssd_storage_gb - active SSD allocation storage
```

CPU and RAM reservations are read from each node row. The current reservation is 2 CPU cores and 4096 MB RAM per node. Storage has no separate reserved-storage subtraction in the allocator.

`getResourceSnapshot()` reads all node IDs in ascending order and returns the same nested resource objects used by the Admin resource API.

### Node selection

`findNode()` and `allocate()` consider enabled nodes ordered by ascending database ID. For Compute requests, a node is skipped unless it has an enabled template row for `service_type = 'compute'`. The allocator checks CPU, RAM, and the requested storage type. The first suitable node is selected.

When allocation runs without an external transaction, the allocator starts and commits its own transaction. The current Compute service manager supplies an external transaction. For automatic selection, enabled node rows are selected with `FOR UPDATE`, then capacity is checked and a final capacity check is performed before inserting the allocation.

If a preferred node is supplied, it must be enabled and, for Compute, must have an enabled Compute template. If no suitable node exists, the allocator throws `No node has sufficient resources for this request`.

### Allocation records and release

`allocate()` inserts an `allocations` row with:

- service ID and selected node ID
- CPU cores
- RAM MB
- requested storage GB and `local`/`ssd` type
- `allocation_type = 'service'`
- description
- `status = 'active'`

`releaseService(serviceId)` changes active rows to `released` and records `released_at`. `serviceManager.deleteService()` performs the equivalent release as part of deletion. Stopping a VM only changes the service status to `stopped`; it does not release resources. Thus an existing service continues to consume its allocation until deletion succeeds.

## Database model

```text
users
  |
  | services.owner_id
  v
services ---- nodes
  |
  | allocations.service_id
  v
allocations ---- nodes

nodes ---- templates
```

### `users`

The live database has:

- `id`
- `prn`
- `name`
- `username`
- `email`
- `password_hash`
- `role` (`admin` or `student`)
- `enabled`
- `created_at`
- `updated_at`

The checked-in `sql/schema.sql` does not create this table, although `authService.js` requires it. Preserve the live table or add a separately reviewed migration before setting up a fresh authenticated environment. Passwords are compared/created using bcrypt; plaintext passwords are not stored by the application.

### `nodes`

`nodes` stores Proxmox node identity, API host/port, capacity, reservations, local/SSD totals, enabled state, and timestamps. `services.node_id` and `allocations.node_id` reference it. The schema does not declare a foreign key from `services.owner_id` to `users.id`, although the application uses that relationship.

### `services`

Fields:

- `id` — service identifier.
- `service_type` — `compute`, `storage`, or `database`.
- `name` — user/service name.
- `owner_id` — student owner for student services; nullable for infrastructure services.
- `node_id` — selected node.
- `vmid` — Proxmox VM ID when applicable.
- `ip_address` — discovered IPv4 address when available.
- `status` — current service lifecycle state.
- `created_at`, `updated_at` — timestamps.

Current statuses in the schema are `provisioning`, `active`, `stopped`, `deleting`, `deleted`, and `failed`.

### `allocations`

Fields:

- `id`, `service_id`, `node_id`
- `cpu`, `ram_mb`, `storage_gb`
- `storage_type` (`local` or `ssd`)
- `allocation_type` (`service` or `infrastructure`)
- `description`
- `status` (`active` or `released`)
- `allocated_at`, `released_at`

### `templates`

`templates` maps a service type and node to a Proxmox template VMID, name, template size, and enabled flag. It supports `compute` and `database` metadata. Compute provisioning only uses enabled Compute rows.

## Authentication and authorization

Student authentication uses PRN and password. Admin authentication uses username and password. `authService.js` selects the expected role, verifies `enabled`, and compares the submitted password with `password_hash` using bcrypt. Successful login regenerates the Express session and stores a safe user object in `req.session.user` containing identity fields and role, not the password.

- `requireAuth` — requires any session user; API requests receive JSON 401 and page requests redirect to `/login`.
- `requireRole(...roles)` — checks a session role and returns API JSON 401/403 or a page redirect/403.
- `requireStudent` — accepts only role `student`.
- `requireAdmin` — accepts only role `admin`; unauthenticated page requests redirect to `/admin/login` and Admin API requests receive JSON 401/403.

Students can access `/student`, `/student/compute`, their own service APIs, and their own Compute terminal. Student service SQL queries include `owner_id`, so one student cannot retrieve or operate another student's VM. Admin pages and Admin APIs require the Admin role.

## Student interface

### Dashboard

`/student` renders the Student dashboard. Compute links to `/student/compute`. Storage and Database are displayed as “Coming soon” in the current UI.

### Compute

`/student/compute` renders the VM creation form and Active VMs/History tabs. Active cards display name, status, VMID, node, IP, CPU, RAM, storage, and the available lifecycle buttons:

- **Start** — calls the student start API and waits for the VM/Guest Agent/IP path in the service manager.
- **Stop** — stops the VM and marks it `stopped`; allocation remains active.
- **Shutdown** — uses the Proxmox QEMU Guest Agent shutdown endpoint and marks the service `stopped`.
- **Terminal** — opens `/student/compute/terminal/:serviceId` for an active owned Compute VM.
- **Delete** — deletes the Proxmox VM, releases active allocations, and retains a `deleted` service record for History.

The History tab calls the owner-filtered history API and does not show lifecycle actions for deleted services.

## VM updates and polling

`public/js/compute.js` calls `GET /api/services` and renders the returned owner-filtered array. Cards use `service.id` as their stable `data-service-id`; refreshes replace/update that card rather than appending duplicates.

After creation, the client uses the returned `data.service` when available, shows a provisioning/success/error notification, refreshes the service list, and starts a 2.5-second interval only when one or more returned services have `status = 'provisioning'`. The interval prevents overlapping requests and stops when no provisioning service remains. If the page is opened while a provisioning record already exists, the initial service load starts the same polling behavior. Missing IP values are displayed as `-` until the API reports an address.

The current server-side creation path normally waits until the service is active before returning. Polling is still needed for records already provisioned by an in-flight request, a page reopened during provisioning, or a service whose database state is not yet final.

## Interactive terminal

No noVNC implementation is used. The terminal is a real serial terminal backed by Proxmox termproxy.

```text
Student owns active Compute service
        |
        v
GET /student/compute/terminal/:serviceId
        |
        v
GET /student/compute/terminal-ticket/:serviceId
        |
        v
PVE /access/ticket using PVE_CONSOLE_USER/PVE_CONSOLE_PASSWORD
        |
        v
POST /nodes/<node>/qemu/<vmid>/termproxy?serial=serial0
        |
        v
TFSrun browser ticket -> /ws/terminal/<ticket>
        |
        v
wss://<proxmox>/api2/json/nodes/<node>/qemu/<vmid>/vncwebsocket
```

The terminal route checks that the user is a student, the service exists, belongs to that student, is a Compute service, is not deleted, is active, and has a VMID. `terminalProxy.js` obtains a PVE authentication ticket, creates termproxy, stores only server-side upstream information in a cryptographically random 15-second browser-ticket map, consumes each browser ticket once, and destroys invalid/expired/unknown WebSocket upgrades.

The upstream WebSocket uses the `binary` subprotocol and the PVE authentication cookie. On open, TFSrun sends `<PVE username>:<termproxy ticket>\n`. Browser input is converted to `0:<UTF-8 byte length>:<input>`, resize to `1:<cols>:<rows>:`, and ping to `2`. Upstream output is forwarded as binary/text data to the browser. Disconnecting either side closes the other side.

The page is a full-viewport terminal with only Connected status, Reconnect, and Disconnect controls. xterm.js uses the installed `xterm@5.3.0` package and `xterm-addon-fit@0.8.0`, black background, default xterm monospace font behavior, `fontSize: 15`, and `letterSpacing: 0`. FitAddon runs after the terminal opens and on controlled `ResizeObserver`/window resize callbacks. The browser does not receive the PVE username, password, PVE cookie, or raw termproxy ticket.

## Admin dashboard

Admin login is at `/admin/login`; the dashboard is at `/admin`. The dashboard uses `public/js/admin-dashboard.js` and provides:

- **Infrastructure Resources** — current per-node CPU, RAM, local storage, SSD storage, allocation, and available-resource snapshots.
- **All Services** — non-deleted services with ID, name, type, owner, node, VMID, IP, status, and actions.
- Refresh buttons for resources and services.
- Admin start, stop, delete, and logout operations.

Admin API endpoints are:

- `GET /api/admin/resources` — `requireAdmin`; returns `{ success, resources }` from `resourceAllocator.getResourceSnapshot()`.
- `GET /api/admin/services` — `requireAdmin`; returns `{ success, services }` from `serviceManager.getServices()` plus owner names.
- `POST /api/admin/services/:id/start` — `requireAdmin`.
- `POST /api/admin/services/:id/stop` — `requireAdmin`.
- `DELETE /api/admin/services/:id` — `requireAdmin`.

The Admin resource path is:

```text
nodes + active allocations
        -> resourceAllocator.getNodeResources()
        -> resourceAllocator.getResourceSnapshot()
        -> GET /api/admin/resources
        -> admin-dashboard.js
        -> resource cards
```

The allocator subtracts per-node CPU/RAM reservations and active allocations. Local and SSD allocations are summed separately by `storage_type`. A failed API request is rendered as an error rather than a legitimate `0 / 0` resource card.

## API reference

### Authentication

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/login` | public | Student login page |
| GET | `/register` | public | Student registration page |
| GET | `/admin/login` | public | Admin login page |
| POST | `/api/auth/register` | public | Body: `prn`, `name`, `password`; creates a student |
| POST | `/api/auth/login` | public | Body: `prn`, `password`; creates student session |
| POST | `/api/auth/admin-login` | public | Body: `username`, `password`; creates Admin session |
| POST | `/api/auth/logout` | session optional | Destroys the current session |
| GET | `/api/auth/me` | session | Returns the current safe session user or 401 |

### Student pages and services

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/` | session | Redirects to login, `/student`, or `/admin` based on session |
| GET | `/student` | student | Student dashboard |
| GET | `/student/compute` | student | Compute page |
| GET | `/api/services` | student | Active/non-deleted services owned by the student |
| GET | `/api/services/history` | student | Deleted services owned by the student |
| GET | `/api/services/:id` | student + owner | One owned service and active allocation details |
| POST | `/api/services/compute` | student | Body: `name`, `cpu`, `ram`, `storage`, optional `storageType`, `username`, `password`; provisions Compute VM |
| POST | `/api/services/:id/start` | student + owner | Starts an owned VM |
| POST | `/api/services/:id/stop` | student + owner | Stops an owned VM without releasing allocation |
| POST | `/api/services/:id/shutdown` | student + owner | Guest-Agent shutdown for an owned VM |
| DELETE | `/api/services/:id` | student + owner | Deletes an owned VM and releases allocation |

Successful creation returns HTTP 201 with `{ success: true, service }`. Lifecycle success responses generally return `{ success: true, service }`; shutdown returns `{ success: true }`. Invalid input is returned as JSON 400, ownership failures as JSON 404, and operational failures as JSON 500 with an error message.

### General resource endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/nodes` | any authenticated user | Returns node configuration/capacity rows |
| GET | `/resources` | any authenticated user | Returns the allocator resource snapshot array |

### Terminal

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/student/compute/terminal/:serviceId` | student + owner | Renders the terminal page after ownership/service checks |
| GET | `/student/compute/terminal-ticket/:serviceId` | student + owner | Creates a short-lived server-side terminal session and returns a browser ticket |
| WebSocket | `/ws/terminal/:ticket` | one-time server ticket | Proxies xterm data to/from Proxmox `vncwebsocket` |

Terminal ticket errors are safe JSON errors. Invalid WebSocket paths, expired tickets, unknown tickets, and already-consumed tickets are rejected at upgrade time.

### Admin

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/admin` | admin | Admin dashboard page |
| GET | `/api/admin/resources` | admin | Allocator-backed infrastructure snapshot |
| GET | `/api/admin/services` | admin | All non-deleted service rows with owner information |
| POST | `/api/admin/services/:id/start` | admin | Admin start action |
| POST | `/api/admin/services/:id/stop` | admin | Admin stop action |
| DELETE | `/api/admin/services/:id` | admin | Admin delete action |

Unauthenticated Admin API requests receive JSON 401. Authenticated non-admin requests receive JSON 403 and cannot receive Admin data.

## Storage architecture

The current allocator distinguishes two Proxmox storage pools logically:

- `local` — capacity from `nodes.total_local_storage_gb` and active allocations with `storage_type = 'local'`.
- `ssd` — capacity from `nodes.total_ssd_storage_gb` and active allocations with `storage_type = 'ssd'`.

The application does not contain an NFS client, NFS mount manager, or NFS-specific API route. Any NFS/template preparation is an external Proxmox/storage administration concern and is not represented as an implemented TFSrun service in this repository.

Compute requests use the node-local template associated with the selected database node. The current runtime template mapping is node1→111, node2→112, and node3→113. The service manager resizes `scsi0` only when requested storage exceeds the selected template’s recorded `storage_gb`.

## S3/object storage direction

The SQL seed prepares one infrastructure-only storage service named `S3 Infrastructure` on node1 with VMID 105 and an active infrastructure allocation of 4 CPU cores, 5120 MB RAM, and 238.50 GB SSD. This reserves capacity in the allocator and makes the infrastructure visible to resource calculations.

There is no current student S3 request route, S3 service manager, object-storage API, or S3 dashboard in the application. The intended future shape is:

```text
S3 request
  -> validation
  -> resourceAllocator.allocate(..., serviceType='storage')
  -> storage/S3 service deployment
  -> services row
  -> allocations row
  -> student/Admin API and UI
```

That is planned architecture, not current functionality. The permanent seed allocation must not be deleted or changed as part of ordinary Compute work.

## Database service direction

The schema allows `service_type = 'database'`, and the seed contains a node3 database template metadata row with VMID 999 and size 8 GB. No Database service route, service-manager provisioning function, lifecycle UI, or database backend deployment exists currently.

Future Database-as-a-Service work should reuse the existing pattern:

```text
Database request
  -> route validation
  -> service record
  -> resourceAllocator.allocate(..., serviceType='database')
  -> enabled database template selection
  -> Proxmox deployment/configuration
  -> service VMID/IP/status update
  -> allocation release only on deletion
```

Do not call this implemented until those routes and deployment steps exist.

## Service Manager interfaces

The current exported `src/allocator/serviceManager.js` functions are:

- `validateComputeRequest(data)`
- `getService(serviceId)`
- `getServices(ownerId = null)`
- `getServiceHistory(ownerId = null)`
- `createComputeService(data, ownerId)`
- `startService(serviceId)`
- `stopService(serviceId)`
- `deleteService(serviceId)`
- `getNodeById(connection, nodeId)`

The lifecycle pattern for a future service should be implemented in a dedicated service-manager function while reusing the database pool, allocator, Proxmox client, service status model, and cleanup conventions. There are currently no `createStorageService()` or `createDatabaseService()` functions.

## Proxmox client operations

`src/proxmox/ProxmoxClient.js` is the normal API-token abstraction. It implements:

- `getNextVMID()`
- `cloneVM(templateVmid, newVmid, name)`
- `getVMConfig(vmid)`
- `configureVM(vmid, { cores, memoryMb, username, password })`
- `resizeDisk(vmid, disk, additionalGb)`
- `getVMStatus(vmid)`
- `startVM(vmid)` and `stopVM(vmid)`
- `deleteVM(vmid)`
- `waitForGuestAgent(vmid)`
- `executeGuestCommand()`, `getGuestCommandStatus()`, and `waitForGuestCommand()`
- `runGuestCommand()`
- `shutdownGuest(vmid)`
- `getVMNetworkInterfaces(vmid)` and `getVMIPv4(vmid)`
- `waitForVMIPv4(vmid)`
- `getTaskStatus(upid)` and `waitForTask(upid)`

The interactive terminal is deliberately separate from this API-token client because the current Proxmox console flow requires a proper PVE authentication ticket and WebSocket cookie.

## Installation and database setup

### Prerequisites

- Linux development machine.
- Node.js compatible with the dependency lockfile. The dependency tree supports Node 18, 20, and current Node releases where packages permit it.
- MariaDB/MySQL reachable using the development `.env`.
- Proxmox nodes reachable from the TFSrun host.
- Enabled Compute templates and QEMU Guest Agent in the VMs.

### Install dependencies

```bash
git clone https://github.com/Anujsjm1405/tfsrun-dash.git
cd tfsrun-dash
npm ci
```

The project has no `start` script in `package.json`. Start it with:

```bash
node app.js
```

The development server listens on the configured `PORT`, normally port 3000.

### Database order

The checked-in SQL files are intended to be run in this order:

```bash
mariadb -u <db-admin> -p < sql/schema.sql
mariadb -u <db-admin> -p tfsrun < sql/seed.sql
```

`schema.sql` creates the database, `nodes`, `services`, `allocations`, and `templates`. `seed.sql` inserts node capacity, template metadata, the S3 infrastructure service, and its infrastructure allocation. The current SQL does not create the runtime `users` table, so authentication requires the existing users-table migration/setup used by the development database.

Do not put database-admin passwords in shell history or this README. The application’s runtime database user is configured by `.env`.

### Run and access

- Student login: `http://localhost:3000/login`
- Student registration: `http://localhost:3000/register`
- Student dashboard: `http://localhost:3000/student`
- Compute page: `http://localhost:3000/student/compute`
- Admin login: `http://localhost:3000/admin/login`
- Admin dashboard: `http://localhost:3000/admin`
- Terminal page pattern: `http://localhost:3000/student/compute/terminal/<serviceId>`

## Proxmox setup requirements

The normal API-token accounts must be able to perform the Proxmox operations used by `ProxmoxClient`: cluster next-ID lookup, template cloning, VM configuration, disk resize, status/start/stop/delete, task status, and QEMU Guest Agent endpoints.

For Compute provisioning:

- Each enabled node needs an enabled `templates` row for `service_type = 'compute'`.
- The template VMID must exist on the corresponding Proxmox node and be cloneable.
- The template must support the configured cloud-init username/password fields.
- QEMU Guest Agent must be enabled and running so TFSrun can wait for readiness and discover IPv4.
- `scsi0` must be the disk to resize when requested storage exceeds the template size.

For terminals:

- `PVE_CONSOLE_USER`/`PVE_CONSOLE_PASSWORD` must authenticate to Proxmox.
- The console user must have permission to create a QEMU `termproxy` and use the VM serial console.
- The VM must expose `serial0` and provide a usable login shell.
- Proxmox TLS behavior must match `PVE_TLS_REJECT_UNAUTHORIZED`.

The application never sends normal API-token secrets or console credentials to browser JavaScript.

## Sophos network login

No Sophos client, credential store, Sophos API integration, or `/etc/tfsrun` provisioning script is present in the current repository. TFSrun does not store student Sophos credentials. Any VM-side `/etc/tfsrun` portal configuration and Sophos login flow is external/manual infrastructure work and must be documented separately when implemented. Do not add real Sophos credentials to this repository.

## Future-service integration guide

If adding a new service, follow the existing Compute shape without bypassing the allocator:

1. Add a protected route in `app.js` or a dedicated route module.
2. Validate request fields in the relevant service-manager layer.
3. Insert a `services` row with the correct `service_type` and owner/node state.
4. Call `resourceAllocator.allocate()` using the current transaction pattern.
5. Select an enabled node/template through allocator rules.
6. Deploy/configure the service through `getProxmoxClient()` or the future backend adapter.
7. Update VMID, IP, and lifecycle status.
8. Keep allocation active while the service exists.
9. Release allocations only after successful deletion/release.
10. Return a safe API response and add the corresponding student/Admin view.

Existing reusable interfaces are `resourceAllocator.allocate()`, `resourceAllocator.getNodeResources()`, `resourceAllocator.getResourceSnapshot()`, `resourceAllocator.releaseService()`, `serviceManager.getService()`, `serviceManager.getServices()`, `getProxmoxClient()`, and the existing authentication middleware.

## Troubleshooting

### VM creation fails

Check the browser Network response for `POST /api/services/compute`, then inspect the Node process logs. Validate CPU/RAM/storage choices, node capacity, enabled Compute templates, Proxmox API credentials, clone task status, and the service/allocation rows in MariaDB.

### Insufficient resources

Use `resourceAllocator.getResourceSnapshot()` or the Admin Infrastructure Resources view. Check active allocations, node reservations, `storage_type`, and whether a node is enabled. Stopping a VM does not free its allocation.

### Guest Agent or IP timeout

Check that the VM is running, QEMU Guest Agent is installed/enabled, and the VM has a usable network interface. The relevant operations are `waitForGuestAgent()` and `waitForVMIPv4()` in `ProxmoxClient`.

### Terminal does not connect

Check `PVE_CONSOLE_USER`, `PVE_CONSOLE_PASSWORD`, TLS setting, Proxmox permissions, `serial0`, VM status, and the browser Network/Console tabs. The terminal-ticket endpoint requires an owned active Compute service with a VMID. The server logs session state without printing credentials or tickets.

### Admin data fails to load

Confirm the session was created through `/admin/login`, the session user role is `admin`, and the browser requests `/api/admin/resources` and `/api/admin/services`. These APIs are Admin-only and return JSON 401/403 when unauthorized. Check MariaDB connectivity and the live `nodes`, `allocations`, `services`, and `users` tables.

### Resource cards show incorrect values

The Admin endpoint must use `resourceAllocator.getResourceSnapshot()`. Verify the response has nested `cpu`, `ramMb`, `localStorageGb`, and `ssdStorageGb` objects. Do not replace missing data with hard-coded values.

### Database connection failure

Check the five `DB_*` values without printing `DB_PASSWORD`, confirm MariaDB is running and reachable, and verify that the runtime database contains the `users` table in addition to the tables created by `sql/schema.sql`.

### Proxmox connection failure

Check each node host/port, API user/token values, certificate behavior, network reachability, and required Proxmox privileges. `ProxmoxClient.formatAxiosError()` distinguishes API responses from connection errors.

## Development rules and design decisions

- Compute resources are allocated through `resourceAllocator`; do not duplicate capacity calculations in a new route.
- Each node reserves 2 CPU cores and 4096 MB RAM.
- Available CPU/RAM subtract reservations and active allocations.
- Local and SSD storage are tracked separately.
- Active allocations remain active while a service is stopped.
- Allocations are released when the service is actually deleted or a provisioning failure cleanup releases them.
- Compute template selection is node-local and database-driven.
- Normal Compute creation does not perform cross-node migration.
- Termproxy plus xterm.js is the current terminal architecture; noVNC is not part of the project.
- Students may access only their own services and terminals.
- Admin APIs remain protected by `requireAdmin`.
- VM cloud-init credentials are passed to Proxmox configuration and are not stored in service responses or logged intentionally.
- TFSrun does not store student Sophos credentials.
- Development secrets are kept in `.env` only because this repository is explicitly a development handover; production must use secret management.

## Validation checklist for future changes

```bash
node --check app.js
for file in $(find src public/js -type f -name '*.js'); do node --check "$file"; done
npm ci
node app.js
```

Then verify `/login`, unauthenticated protection for `/student` and `/admin`, student Compute APIs, Admin APIs, and terminal asset loading. Do not create or delete real infrastructure solely to validate a documentation or frontend change.

## Known repository notes

- `package.json` does not define an `npm start` script; use `node app.js`.
- `xterm` and `xterm-addon-fit` are the installed legacy-compatible packages used by the current browser terminal.
- `.env` is intentionally tracked for this development repository. This is not a safe production practice.
- The SQL schema and seed are not a complete fresh-install authentication migration because `users` is used by code but absent from the checked-in schema.
- `public/js/dashboard.js` contains an older dashboard client and should not be assumed to describe the currently loaded dashboard page.
