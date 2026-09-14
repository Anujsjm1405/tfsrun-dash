const axios = require("axios");
const https = require("https");

class ProxmoxClient {

    constructor(config) {
        this.node = config.name;

        this.client = axios.create({
            baseURL: `https://${config.host}:${config.port}/api2/json`,
            headers: {
                Authorization:
                    `PVEAPIToken=${config.user}!${config.tokenName}=${config.tokenSecret}`
            },
            httpsAgent: new https.Agent({
                rejectUnauthorized:
                    process.env.PVE_TLS_REJECT_UNAUTHORIZED !== "false"
            }),
            timeout: 30000
        });
    }

    formatAxiosError(error) {
        if (error.response) {
            const responseData = error.response.data;

            let message;

            if (responseData?.errors) {
                message =
                    typeof responseData.errors === "string"
                        ? responseData.errors
                        : JSON.stringify(responseData.errors);
            } else if (responseData?.message) {
                message =
                    typeof responseData.message === "string"
                        ? responseData.message
                        : JSON.stringify(responseData.message);
            } else {
                message = error.message;
            }

            return new Error(
                `Proxmox API error (${error.response.status}): ${message}`
            );
        }

        return new Error(
            `Proxmox connection error: ${error.message}`
        );
    }

    async getNextVMID() {
        try {
            const response =
                await this.client.get("/cluster/nextid");

            return Number(response.data.data);

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async cloneVM(templateVmid, newVmid, name) {
        try {
            const response =
                await this.client.post(
                    `/nodes/${this.node}/qemu/${templateVmid}/clone`,
                    {
                        newid: newVmid,
                        name,
                        full: 1
                    }
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async getVMConfig(vmid) {
        try {
            const response =
                await this.client.get(
                    `/nodes/${this.node}/qemu/${vmid}/config`
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async configureVM(
        vmid,
        {
            cores,
            memoryMb,
            username,
            password
        }
    ) {
        try {
            const config = {
                cores,
                memory: memoryMb
            };

            if (username) {
                config.ciuser = username;
            }

            if (password) {
                config.cipassword = password;
            }

            const response =
                await this.client.put(
                    `/nodes/${this.node}/qemu/${vmid}/config`,
                    config
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async resizeDisk(vmid, disk, additionalGb) {
        try {
            if (
                !Number.isInteger(additionalGb) ||
                additionalGb <= 0
            ) {
                return null;
            }

            const response =
                await this.client.put(
                    `/nodes/${this.node}/qemu/${vmid}/resize`,
                    {
                        disk,
                        size: `+${additionalGb}G`
                    }
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async getVMStatus(vmid) {
        try {
            const response =
                await this.client.get(
                    `/nodes/${this.node}/qemu/${vmid}/status/current`
                );

            return response.data.data?.status || "unknown";

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async startVM(vmid) {
        try {
            const response =
                await this.client.post(
                    `/nodes/${this.node}/qemu/${vmid}/status/start`
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async stopVM(vmid) {
        try {
            const response =
                await this.client.post(
                    `/nodes/${this.node}/qemu/${vmid}/status/stop`
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async deleteVM(vmid) {
        try {
            const response =
                await this.client.delete(
                    `/nodes/${this.node}/qemu/${vmid}`,
                    {
                        params: {
                            purge: 1
                        }
                    }
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    /*
     * ==========================================
     * QEMU Guest Agent
     * ==========================================
     */

    async waitForGuestAgent(
        vmid,
        timeoutMs = 120000,
        intervalMs = 3000
    ) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            try {
                const response =
                    await this.client.get(
                        `/nodes/${this.node}/qemu/${vmid}/agent/info`
                    );

                if (response.data?.data) {
                    return response.data.data;
                }

            } catch (error) {
                // Agent is not ready yet.
            }

            await new Promise(resolve =>
                setTimeout(resolve, intervalMs)
            );
        }

        throw new Error(
            `Timed out waiting for QEMU Guest Agent on VM ${vmid}`
        );
    }

    async executeGuestCommand(vmid, command) {
        if (
            !Array.isArray(command) ||
            command.length === 0
        ) {
            throw new Error(
                "Guest command must be a non-empty array"
            );
        }

        try {
            const response =
                await this.client.post(
                    `/nodes/${this.node}/qemu/${vmid}/agent/exec`,
                    {
                        command
                    }
                );

            const result = response.data.data;

            if (
                !result ||
                result.pid === undefined
            ) {
                throw new Error(
                    `QEMU Guest Agent did not return a PID for VM ${vmid}`
                );
            }

            return result;

        } catch (error) {
            if (
                error.message &&
                error.message.startsWith(
                    "QEMU Guest Agent did not return"
                )
            ) {
                throw error;
            }

            throw this.formatAxiosError(error);
        }
    }

    async getGuestCommandStatus(vmid, pid) {
        if (
            pid === undefined ||
            pid === null ||
            pid === ""
        ) {
            throw new Error(
                "Guest command PID is required"
            );
        }

        try {
            const response =
                await this.client.get(
                    `/nodes/${this.node}/qemu/${vmid}/agent/exec-status`,
                    {
                        params: {
                            pid: Number(pid)
                        }
                    }
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async waitForGuestCommand(
        vmid,
        pid,
        timeoutMs = 120000,
        intervalMs = 1000
    ) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            const status =
                await this.getGuestCommandStatus(
                    vmid,
                    pid
                );

            if (
                status &&
                Number(status.exited) === 1
            ) {
                return status;
            }

            await new Promise(resolve =>
                setTimeout(resolve, intervalMs)
            );
        }

        throw new Error(
            `Timed out waiting for guest command on VM ${vmid}`
        );
    }

    async runGuestCommand(
        vmid,
        command,
        timeoutMs = 120000
    ) {
        const result =
            await this.executeGuestCommand(
                vmid,
                command
            );

        const status =
            await this.waitForGuestCommand(
                vmid,
                result.pid,
                timeoutMs
            );

        const exitCode =
            Number(status.exitcode);

        if (exitCode !== 0) {
            const error =
                new Error(
                    `Guest command failed on VM ${vmid} with exit code ${status.exitcode}`
                );

            error.stdout =
                status["out-data"] || "";

            error.stderr =
                status["err-data"] || "";

            throw error;
        }

        return {
            pid: result.pid,
            exitcode: exitCode,
            exited: true,
            stdout: status["out-data"] || "",
            stderr: status["err-data"] || ""
        };
    }

    /*
     * Graceful guest shutdown.
     */
    async shutdownGuest(vmid) {
    try {
        const response = await this.client.post(
            `/nodes/${this.node}/qemu/${vmid}/agent/shutdown`
        );

        return response.data.data;
    } catch (error) {
        throw this.formatAxiosError(error);
    }
}
    /*
     * Guest network interfaces.
     */
    async getVMNetworkInterfaces(vmid) {
        try {
            const response =
                await this.client.get(
                    `/nodes/${this.node}/qemu/${vmid}/agent/network-get-interfaces`
                );

            return (
                response.data.data?.result ||
                []
            );

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }

    async getVMIPv4(vmid) {
        const interfaces =
            await this.getVMNetworkInterfaces(vmid);

        for (const iface of interfaces) {
            if (!iface["ip-addresses"]) {
                continue;
            }

            for (const address of iface["ip-addresses"]) {
                if (
                    address["ip-address-type"] === "ipv4" &&
                    address["ip-address"] !== "127.0.0.1"
                ) {
                    return address["ip-address"];
                }
            }
        }

        return null;
    }

    async waitForVMIPv4(
        vmid,
        timeoutMs = 120000,
        intervalMs = 5000
    ) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            try {
                const ip =
                    await this.getVMIPv4(vmid);

                if (ip) {
                    return ip;
                }

            } catch (error) {
                // Agent/network may not be ready yet.
            }

            await new Promise(resolve =>
                setTimeout(resolve, intervalMs)
            );
        }

        throw new Error(
            `Timed out waiting for IPv4 address for VM ${vmid}`
        );
    }

    /*
     * ==========================================
     * Proxmox task handling
     * ==========================================
     */

    async getTaskStatus(upid) {
        try {
            const encodedUpid =
                encodeURIComponent(upid);

            const response =
                await this.client.get(
                    `/nodes/${this.node}/tasks/${encodedUpid}/status`
                );

            return response.data.data;

        } catch (error) {
            if (
                error.response?.status === 596
            ) {
                throw new Error(
                    "PVE_TASK_STATUS_TIMEOUT"
                );
            }

            throw this.formatAxiosError(error);
        }
    }

    async waitForTask(
        upid,
        timeoutMs = 20 * 60 * 1000
    ) {
        const start = Date.now();

        while (
            Date.now() - start < timeoutMs
        ) {
            try {
                const status =
                    await this.getTaskStatus(
                        upid
                    );

                if (
                    status.status === "stopped"
                ) {
                    if (
                        status.exitstatus !== "OK"
                    ) {
                        throw new Error(
                            `Proxmox task failed: ${
                                status.exitstatus ||
                                "unknown error"
                            }`
                        );
                    }

                    return status;
                }

            } catch (error) {
                if (
                    error.message !==
                    "PVE_TASK_STATUS_TIMEOUT"
                ) {
                    throw error;
                }
            }

            await new Promise(resolve =>
                setTimeout(resolve, 2000)
            );
        }

        throw new Error(
            "Proxmox task timeout"
        );
    }
}

module.exports = ProxmoxClient;