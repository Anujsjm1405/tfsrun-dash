require("dotenv").config();

const ProxmoxClient = require("./proxmoxClient");
const config = require("../config/proxmox");

async function checkQemu(client, node, vmid, label) {
    try {
        const configData =
            await client.getVMConfig(node, vmid);

        console.log(`\n${label} is a QEMU VM:`);
        console.log(JSON.stringify(configData, null, 2));

        return true;
    } catch (error) {
        if (error.response?.status !== 500) {
            console.error(
                "QEMU check failed:",
                error.response?.data || error.message
            );
        }

        return false;
    }
}

async function checkLxc(client, node, vmid, label) {
    try {
        const configData =
            await client.getContainerConfig(node, vmid);

        console.log(`\n${label} is an LXC container:`);
        console.log(JSON.stringify(configData, null, 2));

        return true;
    } catch (error) {
        console.error(
            "LXC check failed:",
            error.response?.data || error.message
        );

        return false;
    }
}

async function main() {
    const node1 =
        new ProxmoxClient(config.node1);

    const node3 =
        new ProxmoxClient(config.node3);

    console.log(
        "\nChecking Compute Template: node1 / VMID 111"
    );

    await checkQemu(
        node1,
        "node1",
        111,
        "Compute Template"
    );

    console.log(
        "\nChecking Database Template: node3 / ID 999"
    );

    const isQemu =
        await checkQemu(
            node3,
            "node3",
            999,
            "Database Template"
        );

    if (!isQemu) {
        await checkLxc(
            node3,
            "node3",
            999,
            "Database Template"
        );
    }
}

main();
