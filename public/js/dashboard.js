const nodesContainer =
    document.getElementById("nodesContainer");

const servicesTable =
    document.getElementById("servicesTable");

const createVmForm =
    document.getElementById("createVmForm");

const createButton =
    document.getElementById("createButton");

const createMessage =
    document.getElementById("createMessage");

const refreshButton =
    document.getElementById("refreshButton");


async function api(url, options = {}) {
    const response = await fetch(
        url,
        {
            ...options,

            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        }
    );

    const data = await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.error || "Request failed"
        );
    }

    return data;
}


/*
 * Format numbers
 */

function formatNumber(value) {
    return Number(value).toLocaleString();
}


/*
 * Calculate resource usage percentage
 */

function usagePercent(allocated, total) {
    if (!total) {
        return 0;
    }

    return Math.min(
        100,
        Math.max(
            0,
            (Number(allocated) / Number(total)) * 100
        )
    );
}


/*
 * Load node resources
 */

async function loadResources() {
    const data =
        await api("/api/resources");

    renderNodes(data.resources);
}


/*
 * Render node cards
 */

function renderNodes(resources) {
    if (!resources.length) {
        nodesContainer.innerHTML =
            `<div class="loading">
                No nodes configured.
             </div>`;

        return;
    }

    nodesContainer.innerHTML =
        resources.map(node => {

            const cpuPercent =
                usagePercent(
                    node.cpu.allocated,
                    node.cpu.total -
                        node.cpu.reserved
                );

            const ramPercent =
                usagePercent(
                    node.ramMb.allocated,
                    node.ramMb.total -
                        node.ramMb.reserved
                );

            const localPercent =
                usagePercent(
                    node.localStorageGb.allocated,
                    node.localStorageGb.total
                );

            const ssdPercent =
                usagePercent(
                    node.ssdStorageGb.allocated,
                    node.ssdStorageGb.total
                );

            return `
                <div class="node-card">

                    <div class="node-header">

                        <div class="node-name">
                            ${escapeHtml(node.nodeName)}
                        </div>

                        <div class="node-status ${
                            node.enabled
                                ? "enabled"
                                : "disabled"
                        }">
                            ${
                                node.enabled
                                    ? "Enabled"
                                    : "Disabled"
                            }
                        </div>

                    </div>


                    <div class="resource">

                        <div class="resource-label">
                            <span>CPU</span>

                            <span>
                                ${node.cpu.allocated}
                                /
                                ${
                                    node.cpu.total -
                                    node.cpu.reserved
                                }
                                cores
                            </span>
                        </div>

                        <div class="resource-bar">
                            <div
                                class="resource-used"
                                style="width: ${cpuPercent}%"
                            ></div>
                        </div>

                    </div>


                    <div class="resource">

                        <div class="resource-label">
                            <span>RAM</span>

                            <span>
                                ${
                                    formatNumber(
                                        node.ramMb.allocated
                                    )
                                }
                                /
                                ${
                                    formatNumber(
                                        node.ramMb.total -
                                        node.ramMb.reserved
                                    )
                                }
                                MB
                            </span>
                        </div>

                        <div class="resource-bar">
                            <div
                                class="resource-used"
                                style="width: ${ramPercent}%"
                            ></div>
                        </div>

                    </div>


                    <div class="resource">

                        <div class="resource-label">
                            <span>Local Storage</span>

                            <span>
                                ${
                                    Number(
                                        node.localStorageGb.allocated
                                    ).toFixed(1)
                                }
                                /
                                ${
                                    Number(
                                        node.localStorageGb.total
                                    ).toFixed(1)
                                }
                                GB
                            </span>
                        </div>

                        <div class="resource-bar">
                            <div
                                class="resource-used"
                                style="width: ${localPercent}%"
                            ></div>
                        </div>

                    </div>


                    <div class="resource">

                        <div class="resource-label">
                            <span>SSD Storage</span>

                            <span>
                                ${
                                    Number(
                                        node.ssdStorageGb.allocated
                                    ).toFixed(1)
                                }
                                /
                                ${
                                    Number(
                                        node.ssdStorageGb.total
                                    ).toFixed(1)
                                }
                                GB
                            </span>
                        </div>

                        <div class="resource-bar">
                            <div
                                class="resource-used"
                                style="width: ${ssdPercent}%"
                            ></div>
                        </div>

                    </div>

                </div>
            `;
        }).join("");
}


/*
 * Load services
 */

async function loadServices() {
    const data =
        await api("/api/services");

    renderServices(data.services);
}


/*
 * Render services
 */

function renderServices(services) {
    if (!services.length) {
        servicesTable.innerHTML =
            `<tr>
                <td colspan="8" class="loading">
                    No services found.
                </td>
             </tr>`;

        return;
    }

    servicesTable.innerHTML =
        services.map(service => {

            const isCompute =
                service.service_type === "compute";

            const canStart =
                isCompute &&
                service.status === "stopped";

            const canStop =
                isCompute &&
                service.status === "active";

            const canDelete =
                isCompute &&
                !["deleted", "deleting"].includes(
                    service.status
                );

            return `
                <tr>

                    <td>
                        ${service.id}
                    </td>

                    <td>
                        ${escapeHtml(service.name)}
                    </td>

                    <td>
                        ${escapeHtml(
                            service.service_type
                        )}
                    </td>

                    <td>
                        ${escapeHtml(
                            service.node_name
                        )}
                    </td>

                    <td>
                        ${
                            service.vmid ?? "-"
                        }
                    </td>

                    <td>
                        ${
                            service.ip_address || "-"
                        }
                    </td>

                    <td>
                        <span class="status ${
                            service.status
                        }">
                            ${service.status}
                        </span>
                    </td>

                    <td>

                        ${
                            canStart
                                ? `
                                    <button
                                        class="button secondary"
                                        onclick="startService(${service.id})"
                                    >
                                        Start
                                    </button>
                                  `
                                : ""
                        }

                        ${
                            canStop
                                ? `
                                    <button
                                        class="button secondary"
                                        onclick="stopService(${service.id})"
                                    >
                                        Stop
                                    </button>
                                  `
                                : ""
                        }

                        ${
                            canDelete
                                ? `
                                    <button
                                        class="button danger"
                                        onclick="deleteService(${service.id})"
                                    >
                                        Delete
                                    </button>
                                  `
                                : ""
                        }

                    </td>

                </tr>
            `;
        }).join("");
}


/*
 * Create VM
 */

createVmForm.addEventListener(
    "submit",
    async event => {
        event.preventDefault();

        createButton.disabled = true;

        showMessage(
            "Creating VM. Please wait...",
            "success"
        );

        const formData =
            new FormData(createVmForm);

        const payload = {
            name:
                formData.get("name"),

            cpu:
                Number(
                    formData.get("cpu")
                ),

            ramMb:
                Number(
                    formData.get("ramMb")
                ),

            storageGb:
                Number(
                    formData.get("storageGb")
                ),

            storageType:
                formData.get("storageType")
        };

        try {
            const data =
                await api(
                    "/api/services/compute",
                    {
                        method: "POST",

                        body:
                            JSON.stringify(
                                payload
                            )
                    }
                );

            showMessage(
                `VM created successfully. ` +
                `Node: ${data.service.node_name}, ` +
                `VMID: ${data.service.vmid}, ` +
                `IP: ${data.service.ip_address}`,
                "success"
            );

            createVmForm.reset();

            document.getElementById("cpu").value =
                1;

            document.getElementById("ramMb").value =
                2048;

            document.getElementById("storageGb").value =
                32;

            document.getElementById("storageType").value =
                "local";

            await refreshDashboard();

        } catch (error) {
            showMessage(
                error.message,
                "error"
            );
        } finally {
            createButton.disabled = false;
        }
    }
);


/*
 * Stop service
 */

async function stopService(serviceId) {
    try {
        await api(
            `/api/services/${serviceId}/stop`,
            {
                method: "POST"
            }
        );

        await refreshDashboard();

    } catch (error) {
        alert(error.message);
    }
}


/*
 * Start service
 */

async function startService(serviceId) {
    try {
        await api(
            `/api/services/${serviceId}/start`,
            {
                method: "POST"
            }
        );

        await refreshDashboard();

    } catch (error) {
        alert(error.message);
    }
}


/*
 * Delete service
 */

async function deleteService(serviceId) {
    const confirmed =
        confirm(
            "Are you sure you want to delete this VM?"
        );

    if (!confirmed) {
        return;
    }

    try {
        await api(
            `/api/services/${serviceId}`,
            {
                method: "DELETE"
            }
        );

        await refreshDashboard();

    } catch (error) {
        alert(error.message);
    }
}


/*
 * Refresh dashboard
 */

async function refreshDashboard() {
    try {
        await Promise.all([
            loadResources(),
            loadServices()
        ]);
    } catch (error) {
        console.error(error);

        showMessage(
            error.message,
            "error"
        );
    }
}


/*
 * Show message
 */

function showMessage(
    message,
    type
) {
    createMessage.textContent =
        message;

    createMessage.className =
        `message ${type}`;
}


/*
 * Escape HTML
 */

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/*
 * Refresh button
 */

refreshButton.addEventListener(
    "click",
    refreshDashboard
);


/*
 * Initial load
 */

refreshDashboard();
