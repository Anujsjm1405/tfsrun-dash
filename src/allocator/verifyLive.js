require("dotenv").config();

const proxmoxConfig = require("../config/proxmox");
const ProxmoxClient = require("../proxmox/proxmoxClient");

async function main() {
    const client = new ProxmoxClient(proxmoxConfig.node1);

    try {
        const config = await client.getVMConfig("node1", 1000);

        console.log("\nTFSrun LIVE VM VERIFICATION\n");

        console.log({
            vmid: 1000,
            name: config.name,
            cores: config.cores,
            memoryMb: config.memory,
            scsi0: config.scsi0,
            status: "configuration reachable"
        });

        console.log("\nVM CONFIGURATION VERIFIED\n");
    } catch (error) {
        console.error("\nVM VERIFICATION FAILED\n");

        console.error(
            error.response?.data ||
            error.message
        );

        process.exitCode = 1;
    }
}

main();
