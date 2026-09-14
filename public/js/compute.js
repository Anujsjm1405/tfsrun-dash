(() => {

    "use strict";


    // ------------------------------------------------
    // Elements
    // ------------------------------------------------

    const createForm =
        document.getElementById(
            "createVMForm"
        );

    const activeContainer =
        document.getElementById(
            "vmList"
        );

    const historyContainer =
        document.getElementById(
            "historyList"
        );

    const logoutButton =
        document.getElementById(
            "logoutButton"
        );

    const createButton =
        document.getElementById(
            "createButton"
        );

    const globalMessage =
        document.getElementById(
            "globalMessage"
        );

    let provisioningPollTimer = null;
    let provisioningPollInFlight = false;
    let notificationTimer = null;


    // ------------------------------------------------
    // Helpers
    // ------------------------------------------------

    function escapeHTML(
        value
    ) {

        return String(
            value ?? ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#039;"
            );
    }


    function formatRAM(
        ram
    ) {

        const value =
            Number(ram);

        if (!Number.isFinite(value)) {
            return "-";
        }

        if (
            value >= 1024 &&
            value % 1024 === 0
        ) {

            return `${value / 1024} GB`;
        }

        if (value >= 1024) {

            return `${(
                value / 1024
            ).toFixed(1)} GB`;
        }

        return `${value} MB`;
    }


    function formatStorage(
        storage
    ) {

        if (
            storage === null ||
            storage === undefined
        ) {

            return "-";
        }

        return `${storage} GB`;
    }


    function normalizeStatus(
        status
    ) {

        return String(
            status || ""
        ).toLowerCase();
    }


    function showNotification(
        type,
        title,
        detail = "",
        autoHideMs = 0
    ) {
        if (!globalMessage) return;

        if (notificationTimer) {
            clearTimeout(notificationTimer);
            notificationTimer = null;
        }

        globalMessage.className =
            `message ${type}`;

        globalMessage.innerHTML = `
            <div class="message-content">
                <strong class="message-title">
                    ${escapeHTML(title)}
                </strong>
                ${detail ? `
                    <span class="message-detail">
                        ${escapeHTML(detail)}
                    </span>
                ` : ""}
            </div>
            <button
                type="button"
                class="message-close"
                aria-label="Dismiss notification"
            >
                ×
            </button>
        `;

        globalMessage
            .querySelector(".message-close")
            .addEventListener(
                "click",
                () => {
                    globalMessage.classList.add("hidden");
                }
            );

        if (autoHideMs > 0) {
            notificationTimer = setTimeout(
                () => globalMessage.classList.add("hidden"),
                autoHideMs
            );
        }
    }


    function setCreateLoading(
        isLoading
    ) {
        if (!createButton) return;

        createButton.disabled = isLoading;
        createButton.textContent = isLoading
            ? "Creating VM..."
            : "Create VM";
    }


    // ------------------------------------------------
    // Service card
    // ------------------------------------------------

    function createServiceCard(
        service
    ) {

        const status =
            normalizeStatus(
                service.status
            );

        const card =
            document.createElement(
                "div"
            );

        card.className =
            "service-card";

        card.dataset.serviceId =
            String(service.id);


        const canStart =
            status === "stopped" ||
            status === "failed";


        const canStop =
            status === "active";


        const canShutdown =
            status === "active";


        const canDelete =
            status === "active" ||
            status === "stopped" ||
            status === "failed";


        card.innerHTML = `

            <div class="service-card-header">

                <div class="service-card-title">

                    <h3>
                        ${escapeHTML(
                            service.name
                        )}
                    </h3>

                </div>

                <span class="service-status status-${escapeHTML(status)}">
                    ${escapeHTML(
                        service.status
                    )}
                </span>

            </div>


            <div class="service-details">

                <div>
                    <strong>VM ID</strong>
                    <span>
                        ${escapeHTML(
                            service.vm_id
                        )}
                    </span>
                </div>

                <div>
                    <strong>Node</strong>
                    <span>
                        ${escapeHTML(
                            service.node_id
                        )}
                    </span>
                </div>

                <div>
                    <strong>IP Address</strong>
                    <span>
                        ${escapeHTML(
                            service.ip_address ||
                            "-"
                        )}
                    </span>
                </div>

                <div>
                    <strong>CPU</strong>
                    <span>
                        ${escapeHTML(
                            service.cpu ||
                            "-"
                        )} cores
                    </span>
                </div>

                <div>
                    <strong>RAM</strong>
                    <span>
                        ${formatRAM(
                            service.ram
                        )}
                    </span>
                </div>

                <div>
                    <strong>Storage</strong>
                    <span>
                        ${formatStorage(
                            service.storage
                        )}
                    </span>
                </div>

            </div>


            <div class="service-actions">

                <button
                    class="service-start"
                    data-id="${service.id}"
                    ${canStart ? "" : "disabled"}
                >
                    Start
                </button>

                <button
                    class="service-stop"
                    data-id="${service.id}"
                    ${canStop ? "" : "disabled"}
                >
                    Stop
                </button>

                <button
                    class="service-shutdown"
                    data-id="${service.id}"
                    ${canShutdown ? "" : "disabled"}
                >
                    Shutdown
                </button>

                <button
                    class="service-terminal"
                    data-id="${service.id}"
                    ${status === "active" ? "" : "disabled"}
                >
                    Terminal
                </button>

                <button
                    class="service-delete"
                    data-id="${service.id}"
                    ${canDelete ? "" : "disabled"}
                >
                    Delete
                </button>

            </div>
        `;


        // --------------------------------------------
        // Start
        // --------------------------------------------

        card
            .querySelector(
                ".service-start"
            )
            .addEventListener(
                "click",
                () => {

                    startService(
                        service.id
                    );
                }
            );


        // --------------------------------------------
        // Stop
        // --------------------------------------------

        card
            .querySelector(
                ".service-stop"
            )
            .addEventListener(
                "click",
                () => {

                    stopService(
                        service.id
                    );
                }
            );


        // --------------------------------------------
        // Shutdown
        // --------------------------------------------

        card
            .querySelector(
                ".service-shutdown"
            )
            .addEventListener(
                "click",
                () => {

                    shutdownService(
                        service.id
                    );
                }
            );


        // --------------------------------------------
        // Terminal
        // --------------------------------------------

        card
            .querySelector(
                ".service-terminal"
            )
            .addEventListener(
                "click",
                () => {

                    window.location.href =
                        `/student/compute/terminal/` +
                        `${service.id}`;
                }
            );


        // --------------------------------------------
        // Delete
        // --------------------------------------------

        card
            .querySelector(
                ".service-delete"
            )
            .addEventListener(
                "click",
                () => {

                    deleteService(
                        service.id
                    );
                }
            );


        return card;
    }


    // ------------------------------------------------
    // History card
    // ------------------------------------------------

    function createHistoryCard(
        service
    ) {

        const card =
            document.createElement(
                "div"
            );

        card.className =
            "service-card history-card";


        card.innerHTML = `

            <div class="service-card-header">

                <div class="service-card-title">

                    <h3>
                        ${escapeHTML(
                            service.name
                        )}
                    </h3>

                </div>

                <span class="service-status status-deleted">
                    Deleted
                </span>

            </div>


            <div class="service-details">

                <div>
                    <strong>VM ID</strong>
                    <span>
                        ${escapeHTML(
                            service.vm_id ||
                            "-"
                        )}
                    </span>
                </div>

                <div>
                    <strong>Node</strong>
                    <span>
                        ${escapeHTML(
                            service.node_id ||
                            "-"
                        )}
                    </span>
                </div>

                <div>
                    <strong>IP Address</strong>
                    <span>
                        ${escapeHTML(
                            service.ip_address ||
                            "-"
                        )}
                    </span>
                </div>

                <div>
                    <strong>Status</strong>
                    <span>
                        Deleted
                    </span>
                </div>

            </div>
        `;


        return card;
    }


    // ------------------------------------------------
    // Load services
    // ------------------------------------------------

    async function loadServices() {

        try {

            const response =
                await fetch(
                    "/api/services",
                    {
                        credentials:
                            "same-origin"
                    }
                );

            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const services =
                await response.json();

            renderServices(
                services
            );

            updateProvisioningPolling(
                services
            );

        } catch (error) {

            console.error(
                "Failed to load services:",
                error
            );

            if (activeContainer) {

                activeContainer.innerHTML =
                    `
                    <div class="service-error">
                        Failed to load virtual machines.
                    </div>
                    `;
            }
        }
    }


    async function loadHistory() {

        try {

            const response =
                await fetch(
                    "/api/services/history",
                    {
                        credentials:
                            "same-origin"
                    }
                );

            if (!response.ok) {

                throw new Error(
                    `HTTP ${response.status}`
                );
            }

            const history =
                await response.json();

            renderHistory(
                history
            );

        } catch (error) {

            console.error(
                "Failed to load history:",
                error
            );

            if (historyContainer) {

                historyContainer.innerHTML =
                    `
                    <div class="service-error">
                        Failed to load VM history.
                    </div>
                    `;
            }
        }
    }


    // ------------------------------------------------
    // Render
    // ------------------------------------------------

    function renderServices(
        services
    ) {

        if (!activeContainer) {

            console.warn(
                "Active services container not found"
            );

            return;
        }

        if (
            !Array.isArray(
                services
            ) ||
            services.length === 0
        ) {

            activeContainer.innerHTML =
                "";

            activeContainer.innerHTML =
                `
                <div class="empty-services">
                    No active virtual machines.
                </div>
                `;

            return;
        }

        const emptyState =
            activeContainer.querySelector(
                ".empty-services"
            );

        if (emptyState) {
            emptyState.remove();
        }

        const existingCards =
            new Map(
                Array.from(
                    activeContainer.querySelectorAll(
                        ".service-card[data-service-id]"
                    )
                ).map(card => [
                    card.dataset.serviceId,
                    card
                ])
            );

        const serviceIds =
            new Set(
                services.map(service =>
                    String(service.id)
                )
            );

        activeContainer
            .querySelectorAll(
                ".service-card[data-service-id]"
            )
            .forEach(card => {
                if (!serviceIds.has(card.dataset.serviceId)) {
                    card.remove();
                }
            });

        services.forEach(service => {
            upsertServiceCard(service, existingCards);
        });
    }


    function upsertServiceCard(
        service,
        existingCards = new Map()
    ) {
        if (!activeContainer || !service || service.id === undefined) {
            return;
        }

        const serviceId = String(service.id);
        const existingCard =
            existingCards.get(serviceId) ||
            activeContainer.querySelector(
                `.service-card[data-service-id="${serviceId}"]`
            );
        const nextCard = createServiceCard(service);

        if (existingCard) {
            existingCard.replaceWith(nextCard);
        } else {
            const emptyState = activeContainer.querySelector(
                ".empty-services"
            );

            if (emptyState) {
                emptyState.remove();
            }

            activeContainer.appendChild(nextCard);
        }
    }


    function updateProvisioningPolling(
        services
    ) {
        const hasProvisioningServices =
            Array.isArray(services) &&
            services.some(service =>
                normalizeStatus(service.status) ===
                "provisioning"
            );

        if (!hasProvisioningServices) {
            if (provisioningPollTimer) {
                clearInterval(
                    provisioningPollTimer
                );
                provisioningPollTimer = null;
            }

            return;
        }

        if (provisioningPollTimer) return;

        provisioningPollTimer = setInterval(
            async () => {
                if (provisioningPollInFlight) return;

                provisioningPollInFlight = true;

                try {
                    await loadServices();
                } finally {
                    provisioningPollInFlight = false;
                }
            },
            2500
        );
    }


    function renderHistory(
        history
    ) {

        if (!historyContainer) {

            return;
        }

        historyContainer.innerHTML =
            "";

        if (
            !Array.isArray(
                history
            ) ||
            history.length === 0
        ) {

            historyContainer.innerHTML =
                `
                <div class="empty-services">
                    No deleted virtual machines.
                </div>
                `;

            return;
        }


        history.forEach(
            service => {

                historyContainer.appendChild(
                    createHistoryCard(
                        service
                    )
                );
            }
        );
    }


    // ------------------------------------------------
    // Refresh
    // ------------------------------------------------

    async function refresh() {

        await Promise.all([
            loadServices(),
            loadHistory()
        ]);
    }


    // ------------------------------------------------
    // Active/history tabs
    // ------------------------------------------------

    document.querySelectorAll(".tab-button").forEach(button => {
        button.addEventListener("click", () => {
            const tab = button.dataset.tab;
            document.querySelectorAll(".tab-button").forEach(item => {
                item.classList.toggle("active", item === button);
            });
            document.getElementById("activeTab")?.classList.toggle("hidden", tab !== "active");
            document.getElementById("historyTab")?.classList.toggle("hidden", tab !== "history");
        });
    });


    // ------------------------------------------------
    // Start
    // ------------------------------------------------

    async function startService(
        serviceId
    ) {

        try {

            const response =
                await fetch(
                    `/api/services/${serviceId}/start`,
                    {

                        method:
                            "POST",

                        credentials:
                            "same-origin",

                        headers: {

                            "Content-Type":
                                "application/json"
                        }
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.error ||
                    "Failed to start VM"
                );
            }

            await refresh();

        } catch (error) {

            alert(
                error.message
            );
        }
    }


    // ------------------------------------------------
    // Stop
    // ------------------------------------------------

    async function stopService(
        serviceId
    ) {

        try {

            const response =
                await fetch(
                    `/api/services/${serviceId}/stop`,
                    {

                        method:
                            "POST",

                        credentials:
                            "same-origin"
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.error ||
                    "Failed to stop VM"
                );
            }

            await refresh();

        } catch (error) {

            alert(
                error.message
            );
        }
    }


    // ------------------------------------------------
    // Shutdown
    // ------------------------------------------------

    async function shutdownService(
        serviceId
    ) {

        if (
            !confirm(
                "Shutdown this virtual machine?"
            )
        ) {

            return;
        }

        try {

            const response =
                await fetch(
                    `/api/services/${serviceId}/shutdown`,
                    {

                        method:
                            "POST",

                        credentials:
                            "same-origin"
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.error ||
                    "Failed to shutdown VM"
                );
            }

            await refresh();

        } catch (error) {

            alert(
                error.message
            );
        }
    }


    // ------------------------------------------------
    // Delete
    // ------------------------------------------------

    async function deleteService(
        serviceId
    ) {

        if (
            !confirm(
                "Delete this virtual machine? This cannot be undone."
            )
        ) {

            return;
        }

        try {

            const response =
                await fetch(
                    `/api/services/${serviceId}`,
                    {

                        method:
                            "DELETE",

                        credentials:
                            "same-origin"
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.error ||
                    "Failed to delete VM"
                );
            }

            await refresh();

        } catch (error) {

            alert(
                error.message
            );
        }
    }


    // ------------------------------------------------
    // Create VM
    // ------------------------------------------------

    if (createForm) {

        createForm.addEventListener(
            "submit",
            async event => {

                event.preventDefault();

                if (
                    createButton &&
                    createButton.disabled
                ) {
                    return;
                }

                setCreateLoading(
                    true
                );

                showNotification(
                    "provisioning",
                    "Creating your VM...",
                    "Your VM is being provisioned. This may take up to a minute."
                );

                const formData =
                    new FormData(
                        createForm
                    );

                const body = {

                    name:
                        formData.get(
                            "name"
                        ),

                    cpu:
                        formData.get(
                            "cpu"
                        ),

                    ram:
                        formData.get(
                            "ram"
                        ),

                    storage:
                        formData.get(
                            "storage"
                        ),

                    storageType:
                        formData.get(
                            "storageType"
                        ) ||
                        "local",

                    username:
                        formData.get(
                            "username"
                        ),

                    password:
                        formData.get(
                            "password"
                        )
                };


                try {

                    const response =
                        await fetch(
                            "/api/services/compute",
                            {

                                method:
                                    "POST",

                                credentials:
                                    "same-origin",

                                headers: {

                                    "Content-Type":
                                        "application/json"
                                },

                                body:
                                    JSON.stringify(
                                        body
                                    )
                            }
                        );

                    const data =
                        await response.json();

                    if (
                        !response.ok ||
                        !data.success
                    ) {

                        throw new Error(
                            data.error ||
                            "Failed to create VM"
                        );
                    }


                    if (data.service && data.service.id !== undefined) {
                        upsertServiceCard(data.service);
                        updateProvisioningPolling([data.service]);
                    }

                    createForm.reset();

                    await refresh();

                    const createdService =
                        data.service || {};

                    const createdStatus =
                        normalizeStatus(
                            createdService.status
                        );

                    const createdDetails =
                        [
                            createdService.name,
                            createdService.vmid ||
                                createdService.vm_id,
                            createdService.ip_address
                        ]
                            .filter(value =>
                                value !== null &&
                                value !== undefined &&
                                String(value).trim() !== ""
                            )
                            .join(" · ");

                    if (
                        createdStatus ===
                        "provisioning"
                    ) {
                        showNotification(
                            "provisioning",
                            "VM created successfully.",
                            createdDetails
                                ? `${createdDetails} · Still provisioning.`
                                : "Your VM is still being provisioned."
                        );
                    } else {
                        showNotification(
                            "success",
                            "VM created successfully.",
                            createdDetails
                                ? `Your VM is now active. ${createdDetails}`
                                : "Your VM is now active.",
                            8000
                        );
                    }

                } catch (error) {

                    showNotification(
                        "error",
                        "VM creation failed.",
                        error.message ||
                        "Unable to create the VM.",
                        10000
                    );
                } finally {
                    setCreateLoading(
                        false
                    );
                }
            }
        );
    }


    // ------------------------------------------------
    // Logout
    // ------------------------------------------------

    if (logoutButton) {

        logoutButton.addEventListener(
            "click",
            async () => {

                try {

                    await fetch(
                        "/api/auth/logout",
                        {

                            method:
                                "POST",

                            credentials:
                                "same-origin"
                        }
                    );

                } finally {

                    window.location.href =
                        "/login";
                }
            }
        );
    }


    // ------------------------------------------------
    // Initial load
    // ------------------------------------------------

    refresh();

})();
