const proxmox = require("../config/proxmox");
const LxcClient = require("./LxcClient");

const {
    normalizeNodeName
} = require("../proxmox");

const clients = {};


/*
 * Cached LXC client per node.
 *
 * Reuses the existing Proxmox config and the existing node-name
 * normalisation so database services resolve nodes exactly the
 * same way compute services do.
 */
function getLxcClient(node) {

    const nodeName =
        normalizeNodeName(node);

    if (!clients[nodeName]) {

        if (!proxmox[nodeName]) {

            throw new Error(
                `No Proxmox configuration found for ${nodeName}`
            );
        }

        clients[nodeName] =
            new LxcClient(
                proxmox[nodeName]
            );
    }

    return clients[nodeName];
}


module.exports = {
    getLxcClient
};
