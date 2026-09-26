const axios = require("axios");
const https = require("https");

/**
 * LxcClient
 *
 * The existing ProxmoxClient targets QEMU VMs (/qemu/ endpoints).
 * Database services run as LXC containers, which use a different
 * set of endpoints (/lxc/), so they get their own client rather
 * than changing the compute one.
 *
 * Note: the Proxmox API has no "exec inside a container" endpoint
 * for LXC (unlike QEMU's guest agent). Anything that needs to run
 * inside a database container is therefore done over the network
 * by connecting to PostgreSQL directly - see databaseManager.
 */
class LxcClient {

    constructor(config) {

        this.node = config.name;

        this.client = axios.create({

            baseURL:
                `https://${config.host}:${config.port}/api2/json`,

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


    /**
     * Cluster-wide next free ID. Shared with compute, so IDs never
     * collide between a VM and a container.
     */
    async getNextVMID() {

        try {

            const response =
                await this.client.get("/cluster/nextid");

            return Number(response.data.data);

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    async cloneContainer(templateVmid, newVmid, hostname) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${this.node}/lxc/${templateVmid}/clone`,
                    {
                        newid: newVmid,
                        hostname,
                        full: 1
                    }
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    async configureContainer(vmid, { cores, memoryMb }) {

        try {

            const config = {};

            if (cores) {
                config.cores = cores;
            }

            if (memoryMb) {
                config.memory = memoryMb;
            }

            const response =
                await this.client.put(
                    `/nodes/${this.node}/lxc/${vmid}/config`,
                    config
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    /**
     * Grow the container rootfs. Proxmox only supports growing,
     * never shrinking, so a zero or negative delta is a no-op.
     */
    async resizeDisk(vmid, additionalGb) {

        try {

            if (
                !Number.isFinite(additionalGb) ||
                additionalGb <= 0
            ) {
                return null;
            }

            const response =
                await this.client.put(
                    `/nodes/${this.node}/lxc/${vmid}/resize`,
                    {
                        disk: "rootfs",
                        size: `+${additionalGb}G`
                    }
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    async getStatus(vmid) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${this.node}/lxc/${vmid}/status/current`
                );

            return response.data.data?.status || "unknown";

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    /**
     * Read the container's current hostname from its Proxmox config
     * (the same source `pct config <vmid>` reads from). Used by
     * verifyContainerOwnership to confirm a stored vmid still points
     * at the container it was issued for, since Proxmox recycles
     * container IDs once destroyed.
     */
    async getHostname(vmid) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${this.node}/lxc/${vmid}/config`
                );

            return response.data.data?.hostname || null;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    async startContainer(vmid) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${this.node}/lxc/${vmid}/status/start`
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    async stopContainer(vmid) {

        try {

            const response =
                await this.client.post(
                    `/nodes/${this.node}/lxc/${vmid}/status/stop`
                );

            return response.data.data;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    async deleteContainer(vmid) {

        try {

            const response =
                await this.client.delete(
                    `/nodes/${this.node}/lxc/${vmid}`,
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


    /**
     * Read the container's current IPv4 address from its interfaces.
     * Loopback is skipped.
     */
    async getIPv4(vmid) {

        try {

            const response =
                await this.client.get(
                    `/nodes/${this.node}/lxc/${vmid}/interfaces`
                );

            const interfaces =
                response.data.data || [];

            for (const iface of interfaces) {

                if (iface.name === "lo") {
                    continue;
                }

                const raw =
                    iface.inet || iface.address || null;

                if (!raw) {
                    continue;
                }

                const ip =
                    String(raw).split("/")[0].trim();

                if (
                    ip &&
                    ip !== "127.0.0.1"
                ) {
                    return ip;
                }
            }

            return null;

        } catch (error) {
            throw this.formatAxiosError(error);
        }
    }


    async waitForIPv4(
        vmid,
        timeoutMs = 120000,
        intervalMs = 3000
    ) {

        const start = Date.now();

        while (Date.now() - start < timeoutMs) {

            try {

                const ip = await this.getIPv4(vmid);

                if (ip) {
                    return ip;
                }

            } catch (error) {
                // Container may not be far enough into boot yet.
            }

            await new Promise(resolve =>
                setTimeout(resolve, intervalMs)
            );
        }

        throw new Error(
            `Timed out waiting for an IPv4 address on container ${vmid}`
        );
    }


    async waitForTask(
        upid,
        timeoutMs = 300000,
        intervalMs = 2000
    ) {

        if (!upid) {
            return null;
        }

        const start = Date.now();

        while (Date.now() - start < timeoutMs) {

            try {

                const response =
                    await this.client.get(
                        `/nodes/${this.node}/tasks/${encodeURIComponent(upid)}/status`
                    );

                const task = response.data.data;

                if (task && task.status === "stopped") {

                    const exitStatus =
                        task.exitstatus || "";

                    // Proxmox reports "OK" on clean success, but
                    // also uses exitstatus for non-fatal warnings
                    // (e.g. the harmless "WARN: Systemd ... nesting"
                    // notice LXC clones commonly produce). Only
                    // treat this as a real failure if it actually
                    // says something failed - a bare warning count
                    // should not abort provisioning.
                    const looksLikeRealFailure =
                        exitStatus !== "OK" &&
                        exitStatus !== "" &&
                        !exitStatus.toLowerCase().startsWith("warn");

                    if (looksLikeRealFailure) {
                        throw new Error(
                            `Proxmox task failed: ${exitStatus}`
                        );
                    }

                    return task;
                }

            } catch (error) {

                if (
                    error.message &&
                    error.message.startsWith("Proxmox task failed")
                ) {
                    throw error;
                }
            }

            await new Promise(resolve =>
                setTimeout(resolve, intervalMs)
            );
        }

        throw new Error(
            `Timed out waiting for Proxmox task ${upid}`
        );
    }
}


module.exports = LxcClient;