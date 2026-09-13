const axios = require("axios");
const https = require("https");

class ProxmoxClient {

    constructor({
        host,
        port,
        user,
        tokenName,
        tokenSecret
    }) {
        this.host = host;
        this.port = port;

        this.client = axios.create({
            baseURL:
                `https://${host}:${port}/api2/json`,

            timeout: 30000,

            httpsAgent: new https.Agent({
                rejectUnauthorized: false
            }),

            headers: {
                Authorization:
                    `PVEAPIToken=${user}!${tokenName}=${tokenSecret}`
            }
        });
    }

    formatAxiosError(error) {

        if (error.response) {

            const status =
                error.response.status;

            const data =
                error.response.data;

            const message =
                data?.errors
                    ? JSON.stringify(data.errors)
                    : data?.message ||
                      data?.data ||
                      error.message;

            return new Error(
                `Proxmox API error ${status}: ${message}`
            );
        }

        if (error.request) {

            return new Error(
                `Proxmox connection failed: ${error.message}`
            );
        }

        return error;
    }

    /*
     * =========================================================
     * CLUSTER / NODE
     * =========================================================
     */

    async getVersion() {

        try {

            const response =
                await this.client.get(
                    "/version"
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async getNodes() {

        try {

            const response =
                await this.client.get(
                    "/nodes"
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async getNextVMID() {

        try {

            const response =
                await this.client.get(
                    "/cluster/nextid"
                );

            return Number(
                response.data.data
            );

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async getNodeStatus(
        nodeName
    ) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${nodeName}/status`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    /*
     * =========================================================
     * QEMU
     * =========================================================
     */

    async getVMs(
        nodeName
    ) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${nodeName}/qemu`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async getVMConfig(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${nodeName}/qemu/${vmid}/config`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async cloneVM(
        nodeName,
        templateVmid,
        newVmid,
        name
    ) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${nodeName}/qemu/${templateVmid}/clone`,
                    {
                        newid: newVmid,
                        name,
                        full: 1
                    }
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async moveVMDisk(
    nodeName,
    vmid,
    disk,
    targetStorage,
    deleteSource = true
) {

    try {

        const response =
            await this.client.post(
                `/nodes/${nodeName}/qemu/${vmid}/move_disk`,
                {
                    disk,
                    storage: targetStorage,
                    delete:
                        deleteSource ? 1 : 0
                }
            );

        return response.data.data;

    } catch (error) {

        throw this.formatAxiosError(
            error
        );
    }
}

    /*
     * ---------------------------------------------------------
     * MIGRATION
     * ---------------------------------------------------------
     *
     * Proxmox VE 9.2 does NOT accept "delete" in the
     * QEMU migration API schema.
     *
     * targetstorage tells Proxmox where the VM disks
     * should be created on the destination.
     */

    async migrateVM(
        nodeName,
        vmid,
        targetNode,
        targetStorage = "local-lvm"
    ) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${nodeName}/qemu/${vmid}/migrate`,
                    {
                        target: targetNode,
                        online: 0,
                        targetstorage:
                            targetStorage
                    }
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async setVMResources(
        nodeName,
        vmid,
        {
            cores,
            memory
        }
    ) {

        try {

            const response =
                await this.client.put(
                    `/nodes/${nodeName}/qemu/${vmid}/config`,
                    {
                        cores,
                        memory
                    }
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async startVM(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${nodeName}/qemu/${vmid}/status/start`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async stopVM(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${nodeName}/qemu/${vmid}/status/stop`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async deleteVM(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.delete(
                    `/nodes/${nodeName}/qemu/${vmid}`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    /*
     * ---------------------------------------------------------
     * QEMU GUEST AGENT
     * ---------------------------------------------------------
     */

    async getVMNetworkInterfaces(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${nodeName}/qemu/${vmid}/agent/network-get-interfaces`
                );

            /*
             * Proxmox returns:
             *
             * response.data.data.result
             *
             * where result contains the array
             * of network interfaces.
             */

            return response.data.data.result;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async getVMIPv4(
        nodeName,
        vmid
    ) {

        const interfaces =
            await this.getVMNetworkInterfaces(
                nodeName,
                vmid
            );

        if (!Array.isArray(interfaces)) {
            return null;
        }

        for (
            const networkInterface
            of interfaces
        ) {

            const addresses =
                networkInterface?.[
                    "ip-addresses"
                ];

            if (!Array.isArray(addresses)) {
                continue;
            }

            for (
                const address
                of addresses
            ) {

                const ip =
                    address?.[
                        "ip-address"
                    ];

                const type =
                    address?.[
                        "ip-address-type"
                    ];

                /*
                 * We want a real IPv4 address,
                 * not loopback.
                 */

                if (
                    type === "ipv4" &&
                    ip &&
                    ip !== "127.0.0.1"
                ) {

                    return ip;
                }
            }
        }

        return null;
    }

    async waitForVMIPv4(
        nodeName,
        vmid,
        {
            intervalMs = 2000,
            timeoutMs = 120000
        } = {}
    ) {

        const startTime =
            Date.now();

        let lastError = null;

        while (
            Date.now() - startTime <
            timeoutMs
        ) {

            try {

                const ipAddress =
                    await this.getVMIPv4(
                        nodeName,
                        vmid
                    );

                if (ipAddress) {

                    return ipAddress;
                }

            } catch (error) {

                /*
                 * Guest Agent may not be ready
                 * immediately after VM startup.
                 */

                lastError = error;
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        intervalMs
                    )
            );
        }

        if (lastError) {

            throw new Error(
                `Unable to obtain VM IP from Guest Agent: ${lastError.message}`
            );
        }

        throw new Error(
            `VM ${vmid} did not obtain an IPv4 address within ${
                timeoutMs / 1000
            } seconds`
        );
    }

    /*
     * =========================================================
     * LXC
     * =========================================================
     */

    async getContainers(
        nodeName
    ) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${nodeName}/lxc`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async getContainerConfig(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${nodeName}/lxc/${vmid}/config`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async cloneContainer(
        nodeName,
        templateVmid,
        newVmid,
        hostname
    ) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${nodeName}/lxc/${templateVmid}/clone`,
                    {
                        newid: newVmid,
                        hostname,
                        full: 1
                    }
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async setContainerResources(
        nodeName,
        vmid,
        {
            cores,
            memory
        }
    ) {

        try {

            const response =
                await this.client.put(
                    `/nodes/${nodeName}/lxc/${vmid}/config`,
                    {
                        cores,
                        memory
                    }
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async startContainer(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${nodeName}/lxc/${vmid}/status/start`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async stopContainer(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${nodeName}/lxc/${vmid}/status/stop`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    async deleteContainer(
        nodeName,
        vmid
    ) {

        try {

            const response =
                await this.client.delete(
                    `/nodes/${nodeName}/lxc/${vmid}`
                );

            return response.data.data;

        } catch (error) {

            throw this.formatAxiosError(
                error
            );
        }
    }

    /*
     * =========================================================
     * TASK STATUS
     * =========================================================
     */

    async getTaskStatus(
        nodeName,
        upid
    ) {

        const encodedUpid =
            encodeURIComponent(upid);

        try {

            const response =
                await this.client.get(
                    `/nodes/${nodeName}/tasks/${encodedUpid}/status`,
                    {
                        timeout: 120000
                    }
                );

            return response.data.data;

        } catch (error) {

            /*
             * HTTP 596 is a pveproxy timeout.
             *
             * It does not necessarily mean that the
             * underlying Proxmox task failed.
             */

            if (
                error.response &&
                error.response.status === 596
            ) {

                const retryError =
                    new Error(
                        "PVE_TASK_STATUS_TIMEOUT"
                    );

                retryError.code =
                    "PVE_TASK_STATUS_TIMEOUT";

                throw retryError;
            }

            throw this.formatAxiosError(
                error
            );
        }
    }

    async waitForTask(
        nodeName,
        upid,
        {
            intervalMs = 2000,
            timeoutMs =
                20 * 60 * 1000
        } = {}
    ) {

        const startTime =
            Date.now();

        let timeoutCount = 0;

        while (true) {

            try {

                const task =
                    await this.getTaskStatus(
                        nodeName,
                        upid
                    );

                timeoutCount = 0;

                if (
                    task.status ===
                    "stopped"
                ) {

                    if (
                        task.exitstatus ===
                        "OK"
                    ) {

                        return task;
                    }

                    throw new Error(
                        `Proxmox task failed: ${
                            task.exitstatus ||
                            "unknown error"
                        }`
                    );
                }

            } catch (error) {

                if (
                    error.code ===
                    "PVE_TASK_STATUS_TIMEOUT"
                ) {

                    timeoutCount++;

                    console.log(
                        `Task status request timed out (596), retrying... attempt ${timeoutCount}`
                    );

                } else {

                    throw error;
                }
            }

            if (
                Date.now() -
                startTime >
                timeoutMs
            ) {

                throw new Error(
                    `Proxmox task timed out after ${
                        timeoutMs / 1000
                    } seconds`
                );
            }

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        intervalMs
                    )
            );
        }
    }
}

module.exports =
    ProxmoxClient;
