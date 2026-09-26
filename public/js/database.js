const createForm =
    document.getElementById("createDatabaseForm");

const createStatus =
    document.getElementById("createStatus");

const createButton =
    document.getElementById("createButton");

const tableBody =
    document.getElementById("databaseTableBody");

const refreshButton =
    document.getElementById("refreshButton");

const logoutButton =
    document.getElementById("logoutButton");


/* =========================================================
   LOGOUT
========================================================= */

if (logoutButton) {

    logoutButton.addEventListener(
        "click",
        async () => {

            try {

                const response =
                    await fetch(
                        "/api/auth/logout",
                        {
                            method: "POST"
                        }
                    );

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.error || "Logout failed"
                    );
                }

                window.location.href = "/login";

            } catch (error) {
                alert(error.message);
            }
        }
    );
}


/* =========================================================
   CREATE
========================================================= */

createForm.addEventListener(
    "submit",
    async (event) => {

        event.preventDefault();

        const formData =
            new FormData(createForm);

        const payload =
            Object.fromEntries(formData);

        if (
            payload.dbPassword !==
            payload.dbPasswordConfirm
        ) {

            createStatus.textContent =
                "Passwords do not match.";

            createStatus.className =
                "db-status error";

            return;
        }

        delete payload.dbPasswordConfirm;

        createButton.disabled = true;

        createStatus.className = "db-status";

        createStatus.textContent =
            "Provisioning your database. This usually takes a minute or two.";

        try {

            const response =
                await fetch(
                    "/student/database/api/create",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify(payload)
                    }
                );

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(
                    data.error || "Failed to create database"
                );
            }

            createStatus.className =
                "db-status success";

            createStatus.textContent =
                `Database created on ${data.service.node_name}. ` +
                `Use "Credentials" below to see how to connect.`;

            createForm.reset();

            await loadDatabases();

        } catch (error) {

            createStatus.className =
                "db-status error";

            createStatus.textContent =
                error.message;

        } finally {
            createButton.disabled = false;
        }
    }
);


/* =========================================================
   LIST
========================================================= */

async function loadDatabases() {

    tableBody.innerHTML =
        `<tr><td colspan="9">Loading...</td></tr>`;

    try {

        const response =
            await fetch("/student/database/api/list");

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Failed to load databases"
            );
        }

        if (
            !data.services ||
            data.services.length === 0
        ) {

            tableBody.innerHTML =
                `<tr><td colspan="9">No databases yet.</td></tr>`;

            return;
        }

        tableBody.innerHTML = "";

        data.services.forEach(service => {

            const isRunning =
                service.status === "active";

            const row =
                document.createElement("tr");

            row.innerHTML = `
                <td>${escapeHtml(service.name)}</td>
                <td>${escapeHtml(service.node_name || "-")}</td>
                <td>${service.vmid || "-"}</td>
                <td>${escapeHtml(service.db_user || "-")}</td>
                <td>${service.cpu || "-"}</td>
                <td>${service.ram_mb ? service.ram_mb + " MB" : "-"}</td>
                <td>${service.storage_gb ? service.storage_gb + " GB" : "-"}</td>
                <td><span class="status status-${escapeHtml(service.status)}">${escapeHtml(service.status)}</span></td>
                <td class="row-actions">
                    <button type="button" data-id="${service.id}" class="credentialsButton">Credentials</button>
                    <button type="button" data-id="${service.id}" class="startButton" ${isRunning ? "disabled" : ""}>Start</button>
                    <button type="button" data-id="${service.id}" class="stopButton" ${!isRunning ? "disabled" : ""}>Stop</button>
                    <button type="button" data-id="${service.id}" class="deleteButton">Delete</button>
                </td>
            `;

            tableBody.appendChild(row);

            const detailsRow =
                document.createElement("tr");

            detailsRow.id =
                `credentials-${service.id}`;

            detailsRow.className =
                "credentials-row";

            detailsRow.style.display = "none";

            detailsRow.innerHTML = `
                <td colspan="9">
                    <pre id="credentials-content-${service.id}">Loading...</pre>
                </td>
            `;

            tableBody.appendChild(detailsRow);
        });

        bindRowActions();

    } catch (error) {

        tableBody.innerHTML =
            `<tr><td colspan="9">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}


function bindRowActions() {

    document
        .querySelectorAll(".credentialsButton")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => toggleCredentials(button.dataset.id)
            );
        });

    document
        .querySelectorAll(".startButton")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => controlDatabase(button.dataset.id, "start")
            );
        });

    document
        .querySelectorAll(".stopButton")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => controlDatabase(button.dataset.id, "stop")
            );
        });

    document
        .querySelectorAll(".deleteButton")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => deleteDatabase(button.dataset.id)
            );
        });
}


/* =========================================================
   CREDENTIALS
========================================================= */

async function toggleCredentials(serviceId) {

    const detailsRow =
        document.getElementById(
            `credentials-${serviceId}`
        );

    if (detailsRow.style.display !== "none") {
        detailsRow.style.display = "none";
        return;
    }

    detailsRow.style.display = "table-row";

    const contentElement =
        document.getElementById(
            `credentials-content-${serviceId}`
        );

    contentElement.textContent = "Loading...";

    try {

        const response =
            await fetch(
                `/student/database/api/${serviceId}/credentials`
            );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Failed to load credentials"
            );
        }

        const credentials = data.credentials;

        contentElement.textContent =
            `Host:     ${credentials.host || "unavailable"}\n` +
            `Port:     ${credentials.port}\n` +
            `Username: ${credentials.username}\n` +
            `Password: ${credentials.password}\n\n` +
            `You don't have a database yet - create one after connecting:\n\n` +
            `psql -h ${credentials.host} -U ${credentials.username} -d postgres\n` +
            `CREATE DATABASE myproject;`;

    } catch (error) {

        contentElement.textContent =
            `Error: ${error.message}`;
    }
}


/* =========================================================
   START / STOP
========================================================= */

async function controlDatabase(serviceId, action) {

    try {

        const response =
            await fetch(
                `/student/database/api/${serviceId}/${action}`,
                {
                    method: "POST"
                }
            );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || `Failed to ${action} database`
            );
        }

        await loadDatabases();

    } catch (error) {
        alert(error.message);
    }
}


/* =========================================================
   DELETE
========================================================= */

async function deleteDatabase(serviceId) {

    const confirmed =
        confirm(
            "Delete this database? The container and all its data " +
            "will be destroyed permanently."
        );

    if (!confirmed) {
        return;
    }

    try {

        const response =
            await fetch(
                `/student/database/api/${serviceId}`,
                {
                    method: "DELETE"
                }
            );

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Failed to delete database"
            );
        }

        await loadDatabases();

    } catch (error) {
        alert(error.message);
    }
}


/* =========================================================
   UTIL
========================================================= */

function escapeHtml(value) {

    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


refreshButton.addEventListener(
    "click",
    loadDatabases
);


loadDatabases();
