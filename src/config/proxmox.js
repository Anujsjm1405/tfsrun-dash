require("dotenv").config();

function nodeConfig(number) {
    return {
        name: process.env[`PVE_NODE${number}_NAME`],
        host: process.env[`PVE_NODE${number}_HOST`],
        port: Number(process.env[`PVE_NODE${number}_PORT`]),
        user: process.env[`PVE_NODE${number}_USER`],
        tokenName: process.env[`PVE_NODE${number}_TOKEN_NAME`],
        tokenSecret: process.env[`PVE_NODE${number}_TOKEN_SECRET`]
    };
}

module.exports = {
    node1: nodeConfig(1),
    node2: nodeConfig(2),
    node3: nodeConfig(3)
};
