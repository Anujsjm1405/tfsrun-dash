require("dotenv").config();

const serviceManager =
    require("./serviceManager");

async function main() {

    const serviceIds = [12, 13];

    for (const serviceId of serviceIds) {

        console.log(
            `\nDeleting service ${serviceId}...`
        );

        try {

            const result =
                await serviceManager.deleteService(
                    serviceId
                );

            console.log(
                "Deleted:",
                result
            );

        } catch (error) {

            console.error(
                `Failed to delete service ${serviceId}:`
            );

            console.error(
                error.message
            );

            process.exitCode = 1;
        }
    }

    console.log(
        "\nCleanup complete."
    );
}

main();
