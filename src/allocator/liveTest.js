require("dotenv").config();

const serviceManager =
    require("./serviceManager");

async function main() {

    console.log(
        "\nTFSrun AUTOMATED COMPUTE TEST\n"
    );

    try {

        const service =
            await serviceManager.createService({
                serviceType: "compute",
                name: "tfsrun-test-vm-1core",
                cpu: 1,
                ramMb: 2048,
                storageGb: 32
            });

        console.log(
            "\nVM CREATED SUCCESSFULLY\n"
        );

        console.log({
            serviceId:
                service.serviceId,

            vmid:
                service.vmid,

            nodeId:
                service.nodeId,

            nodeName:
                service.nodeName,

            allocationId:
                service.allocationId,

            status:
                service.status,

            ipAddress:
                service.ipAddress
        });

    } catch (error) {

        console.error(
            "\nVM CREATION FAILED\n"
        );

        console.error(
            error.response?.data ||
            error.message
        );

        process.exitCode = 1;
    }
}

main();
