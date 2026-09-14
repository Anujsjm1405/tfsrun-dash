require("dotenv").config();

function getNodeConfig(number) {
    return {
        name: process.env[`PVE_NODE${number}_NAME`],
        host: process.env[`PVE_NODE${number}_HOST`],
        port: Number(process.env[`PVE_NODE${number}_PORT`]),
        user: process.env[`PVE_NODE${number}_USER`],
        tokenName: process.env[`PVE_NODE${number}_TOKEN_NAME`],
        tokenSecret: process.env[`PVE_NODE${number}_TOKEN_SECRET`]
    };
}

const proxmox = {
    node1: getNodeConfig(1),
    node2: getNodeConfig(2),
    node3: getNodeConfig(3)
};

module.exports = proxmox;
