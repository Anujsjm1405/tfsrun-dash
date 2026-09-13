require("dotenv").config();

const proxmoxConfig =
    require("../config/proxmox");

const ProxmoxClient =
    require("./proxmoxClient");

async function main() {
    console.log(
        "\nTFSrun PROXMOX TASK TEST\n"
    );

    const client =
        new ProxmoxClient(
            proxmoxConfig.node1
        );

    const upid =
        "UPID:node1:001221DC:0238472A:6AA55901:qmclone:111:root@pam!tfsrun:";

    try {
        const task =
            await client.waitForTask(
                "node1",
                upid
            );

        console.log(
            "\nTASK VERIFIED\n"
        );

        console.log(task);

    } catch (error) {
        console.error(
            "\nTASK TEST FAILED\n"
        );

        console.error(
            error.message
        );

        process.exitCode = 1;
    }
}

main();
