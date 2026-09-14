const proxmox = require("../config/proxmox");
const ProxmoxClient = require("./ProxmoxClient");

const clients = {};


/*
 * Convert database node IDs to
 * Proxmox configuration names.
 *
 * DB:
 *   1 -> node1
 *   2 -> node2
 *   3 -> node3
 *
 * Proxmox config:
 *   node1
 *   node2
 *   node3
 */
function normalizeNodeName(node) {

    if (
        node === 1 ||
        node === "1"
    ) {
        return "node1";
    }


    if (
        node === 2 ||
        node === "2"
    ) {
        return "node2";
    }


    if (
        node === 3 ||
        node === "3"
    ) {
        return "node3";
    }


    if (
        typeof node === "string" &&
        proxmox[node]
    ) {
        return node;
    }


    throw new Error(
        `Unknown Proxmox node: ${node}`
    );
}


/*
 * Get cached Proxmox client.
 */
function getProxmoxClient(node) {

    const nodeName =
        normalizeNodeName(node);


    if (!clients[nodeName]) {

        if (!proxmox[nodeName]) {

            throw new Error(
                `No Proxmox configuration found for ${nodeName}`
            );
        }


        clients[nodeName] =
            new ProxmoxClient(
                proxmox[nodeName]
            );
    }


    return clients[nodeName];
}


module.exports = {
    getProxmoxClient,
    normalizeNodeName
};
