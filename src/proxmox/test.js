require("dotenv").config();

const ProxmoxClient = require("./proxmoxClient");
const config = require("../config/proxmox");

async function test() {
    for (const [name, node] of Object.entries(config)) {
        console.log(`\nTesting ${name} (${node.host})...`);

        try {
            const client = new ProxmoxClient(node);

            const version = await client.getVersion();

            console.log("Connected:", version);

            const nodes = await client.getNodes();

            console.log("Proxmox nodes:");

            for (const item of nodes) {
                console.log(
                    `  ${item.node} - ${item.status} - CPU: ${item.maxcpu}`
                );
            }
        } catch (error) {
            console.error(
                `FAILED ${name}:`,
                error.response?.status,
                error.response?.data || error.message
            );
        }
    }
}

test();
