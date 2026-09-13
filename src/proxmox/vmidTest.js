require("dotenv").config();

const proxmoxConfig =
    require("../config/proxmox");

const ProxmoxClient =
    require("./proxmoxClient");

async function main() {

    console.log(
        "\nTFSrun PROXMOX VMID TEST\n"
    );

    try {

        const client =
            new ProxmoxClient(
                proxmoxConfig.node1
            );

        const vmid =
            await client.getNextVMID();

        console.log(
            `Next available VMID: ${vmid}`
        );

    } catch (error) {

        console.error(
            "\nVMID TEST FAILED\n"
        );

        console.error(
            error.response?.data ||
            error.message
        );

        process.exitCode = 1;
    }
}

main();
