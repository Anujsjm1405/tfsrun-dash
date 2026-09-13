require("dotenv").config();

const proxmoxConfig =
    require("../config/proxmox");

const ProxmoxClient =
    require("./proxmoxClient");

async function main() {

    console.log(
        "\nTFSrun VM IP TEST\n"
    );

    const client =
        new ProxmoxClient(
            proxmoxConfig.node3
        );

    const vmid = 101;

    try {

        const interfaces =
            await client.getVMNetworkInterfaces(
                "node3",
                vmid
            );

        console.log(
            "\nNETWORK INTERFACES:\n"
        );

        console.dir(
            interfaces,
            {
                depth: null
            }
        );

        const ipAddress =
            await client.getVMIPv4(
                "node3",
                vmid
            );

        console.log(
            `\nVM ${vmid} IPv4: ${ipAddress}`
        );

    } catch (error) {

        console.error(
            "\nIP TEST FAILED\n"
        );

        console.error(
            error.message
        );

        process.exitCode = 1;
    }
}

main();
