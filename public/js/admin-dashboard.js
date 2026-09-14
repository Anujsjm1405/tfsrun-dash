async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const contentType =
        response.headers.get("content-type") || "";

    const data = contentType.includes("application/json")
        ? await response.json()
        : {
            error: await response.text()
        };

    if (!response.ok) {
        throw new Error(data.error || "Request failed");
    }

    return data;
}


function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "0";
    }

    return Number.isInteger(number)
        ? String(number)
        : number.toFixed(2);
}


async function loadResources() {
    const container = document.getElementById("resources");

    try {
        const data = await apiRequest("/api/admin/resources");

        if (!Array.isArray(data.resources)) {
            throw new Error("Invalid resource response");
        }

        const resources = data.resources;

        if (resources.length === 0) {
            container.innerHTML = "<p>No resources available.</p>";
            return;
        }

        container.innerHTML = resources.map(node => {

            const {
                cpu,
                ramMb: ram,
                localStorageGb: local,
                ssdStorageGb: ssd
            } = node;

            if (!node.nodeName || !cpu || !ram || !local || !ssd) {
                throw new Error("Invalid resource data");
            }

            return `
                <div class="node-card">

                    <h3>
                        ${escapeHtml(node.nodeName)}
                    </h3>

                    <p>
                        <strong>CPU:</strong>
                        ${formatNumber(cpu.allocated)}
                        /
                        ${formatNumber(
                            cpu.total - cpu.reserved
                        )}
                        cores allocated
                    </p>

                    <p>
                        <strong>CPU Available:</strong>
                        ${formatNumber(cpu.available)}
                        cores
                    </p>

                    <p>
                        <strong>RAM:</strong>
                        ${formatNumber(ram.allocated)}
                        /
                        ${formatNumber(
                            ram.total - ram.reserved
                        )}
                        MB allocated
                    </p>

                    <p>
                        <strong>RAM Available:</strong>
                        ${formatNumber(ram.available)}
                        MB
                    </p>

                    <p>
                        <strong>Local Storage:</strong>
                        ${formatNumber(local.allocated)}
                        /
                        ${formatNumber(local.total)}
                        GB allocated
                    </p>

                    <p>
                        <strong>Local Available:</strong>
                        ${formatNumber(local.available)}
                        GB
                    </p>

                    <p>
                        <strong>SSD Storage:</strong>
                        ${formatNumber(ssd.allocated)}
                        /
                        ${formatNumber(ssd.total)}
                        GB allocated
                    </p>

                    <p>
                        <strong>SSD Available:</strong>
                        ${formatNumber(ssd.available)}
                        GB
                    </p>

                </div>
            `;

        }).join("");

    } catch (error) {

        container.innerHTML = `
            <p class="error">
                Failed to load resources:
                ${escapeHtml(error.message)}
            </p>
        `;
    }
}


async function loadServices() {
    const container = document.getElementById("services");

    try {
        const data = await apiRequest("/api/admin/services");

        const services = data.services || [];

        if (services.length === 0) {
            container.innerHTML = "<p>No services found.</p>";
            return;
        }

        container.innerHTML = `
            <div class="table-wrapper">

                <table>

                    <thead>
                        <tr>
                            <th>ID</th>
                            <th>Name</th>
                            <th>Type</th>
                            <th>Owner</th>
                            <th>Node</th>
                            <th>VMID</th>
                            <th>IP Address</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>

                    <tbody>

                        ${services.map(service => `

                            <tr>

                                <td>
                                    ${service.id}
                                </td>

                                <td>
                                    ${escapeHtml(service.name)}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        service.service_type || "-"
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        service.owner_name ||
                                        service.owner_prn ||
                                        service.owner_username ||
                                        "-"
                                    )}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        service.node_name || "-"
                                    )}
                                </td>

                                <td>
                                    ${service.vmid || "-"}
                                </td>

                                <td>
                                    ${escapeHtml(
                                        service.ip_address || "-"
                                    )}
                                </td>

                                <td>
                                    <span class="status ${escapeHtml(
                                        service.status
                                    )}">
                                        ${escapeHtml(
                                            service.status
                                        )}
                                    </span>
                                </td>

                                <td>
                                    <div class="actions">

                                        ${
                                            service.status === "active"
                                                ? `
                                                    <button
                                                        class="secondary-btn"
                                                        onclick="stopService(${service.id})">
                                                        Stop
                                                    </button>
                                                `
                                                : service.status === "stopped"
                                                ? `
                                                    <button
                                                        class="secondary-btn"
                                                        onclick="startService(${service.id})">
                                                        Start
                                                    </button>
                                                `
                                                : ""
                                        }

                                        ${
                                            service.status !== "deleted" &&
                                            service.status !== "deleting"
                                                ? `
                                                    <button
                                                        class="danger-btn"
                                                        onclick="deleteService(${service.id})">
                                                        Delete
                                                    </button>
                                                `
                                                : ""
                                        }

                                    </div>
                                </td>

                            </tr>

                        `).join("")}

                    </tbody>

                </table>

            </div>
        `;

    } catch (error) {

        container.innerHTML = `
            <p class="error">
                Failed to load services:
                ${escapeHtml(error.message)}
            </p>
        `;
    }
}


async function startService(id) {

    if (!confirm(`Start service ${id}?`)) {
        return;
    }

    try {

        await apiRequest(
            `/api/admin/services/${id}/start`,
            {
                method: "POST"
            }
        );

        await loadServices();
        await loadResources();

    } catch (error) {
        alert(error.message);
    }
}


async function stopService(id) {

    if (!confirm(`Stop service ${id}?`)) {
        return;
    }

    try {

        await apiRequest(
            `/api/admin/services/${id}/stop`,
            {
                method: "POST"
            }
        );

        await loadServices();
        await loadResources();

    } catch (error) {
        alert(error.message);
    }
}


async function deleteService(id) {

    if (!confirm(
        `Delete service ${id}?\n\nThis will permanently delete the VM.`
    )) {
        return;
    }

    try {

        await apiRequest(
            `/api/admin/services/${id}`,
            {
                method: "DELETE"
            }
        );

        await loadServices();
        await loadResources();

    } catch (error) {
        alert(error.message);
    }
}


async function logout() {

    try {

        await apiRequest(
            "/api/auth/logout",
            {
                method: "POST"
            }
        );

        window.location.href = "/admin/login";

    } catch (error) {
        alert(error.message);
    }
}


document
    .getElementById("refreshResourcesBtn")
    .addEventListener(
        "click",
        loadResources
    );


document
    .getElementById("refreshServicesBtn")
    .addEventListener(
        "click",
        loadServices
    );


document
    .getElementById("logoutBtn")
    .addEventListener(
        "click",
        logout
    );


loadResources();
loadServices();
