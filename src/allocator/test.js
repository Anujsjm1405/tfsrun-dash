require("dotenv").config();

const allocator = require("./resourceAllocator");

async function main() {
    try {
        console.log("\nTFSrun Resource Allocator\n");

        const nodes =
            await allocator.getAllNodeResources();

        for (const node of nodes) {
            console.log(
                `${node.name}:`,
                `CPU ${node.cpu.available}/${node.cpu.total - node.cpu.reserved}`,
                `RAM ${node.ram.available}/${node.ram.total - node.ram.reserved}`
            );
        }

        console.log("\nNode selection test:");

        const node = await allocator.findNode({
            cpu: 2,
            ramMb: 4096,
            storageGb: 32,
            storageType: "local"
        });

        if (node) {
            console.log(
                `Selected: ${node.name}`
            );
        } else {
            console.log(
                "No node has sufficient resources"
            );
        }
    } catch (error) {
        console.error(
            "Allocator error:",
            error.message
        );

        process.exitCode = 1;
    }
}

main();