const axios = require("axios");
const https = require("https");
const crypto = require("crypto");
const WebSocket = require("ws");

const proxmox = require("../config/proxmox");
const TICKET_LIFETIME = 15000;
const browserTickets = new Map();

function tlsAgent() {
    return new https.Agent({
        rejectUnauthorized: process.env.PVE_TLS_REJECT_UNAUTHORIZED !== "false"
    });
}

function apiClient(config, headers = {}) {
    return axios.create({
        baseURL: `https://${config.host}:${config.port}/api2/json`,
        timeout: 15000,
        httpsAgent: tlsAgent(),
        headers
    });
}

async function authenticate(config) {
    const username = process.env.PVE_CONSOLE_USER;
    const password = process.env.PVE_CONSOLE_PASSWORD;
    if (!username || !password) throw new Error("Console authentication is not configured");

    const response = await apiClient(config).post(
        "/access/ticket",
        new URLSearchParams({ username, password }).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const data = response.data?.data;
    if (!data?.ticket) throw new Error("Proxmox authentication failed");
    return { username, ticket: data.ticket, csrf: data.CSRFPreventionToken || null };
}

async function createTermProxy(nodeName, vmid) {
    const config = proxmox[nodeName];
    if (!config?.host || !config.port) throw new Error(`No Proxmox configuration found for ${nodeName}`);

    const auth = await authenticate(config);
    const headers = {
        Cookie: `PVEAuthCookie=${auth.ticket}`,
        "Content-Type": "application/x-www-form-urlencoded"
    };
    if (auth.csrf) headers.CSRFPreventionToken = auth.csrf;

    const response = await apiClient(config, headers).post(
        `/nodes/${encodeURIComponent(config.name || nodeName)}/qemu/${encodeURIComponent(vmid)}/termproxy`,
        new URLSearchParams({ serial: "serial0" }).toString()
    );
    const data = response.data?.data;
    if (!data?.port || !data?.ticket) throw new Error("Proxmox did not return terminal proxy information");

    return {
        host: config.host,
        apiPort: Number(config.port),
        node: config.name || nodeName,
        vmid: Number(vmid),
        port: Number(data.port),
        termTicket: data.ticket,
        authTicket: auth.ticket,
        username: auth.username
    };
}

function createBrowserTicket(data) {
    const ticket = crypto.randomBytes(32).toString("hex");
    browserTickets.set(ticket, { ...data, createdAt: Date.now() });
    const timer = setTimeout(() => browserTickets.delete(ticket), TICKET_LIFETIME);
    timer.unref?.();
    return ticket;
}

function consumeBrowserTicket(ticket) {
    const data = browserTickets.get(ticket);
    browserTickets.delete(ticket);
    if (!data || Date.now() - data.createdAt > TICKET_LIFETIME) return null;
    return data;
}

async function createTerminalSession(nodeName, vmid) {
    return createBrowserTicket(await createTermProxy(nodeName, vmid));
}

function closeSocket(socket) {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close();
}

function sendUpstream(upstream, payload) {
    upstream.send(Buffer.from(payload, "utf8"));
}

function connectUpstream(browserSocket, data) {
    const upstreamUrl =
        `wss://${data.host}:${data.apiPort}/api2/json/nodes/${encodeURIComponent(data.node)}` +
        `/qemu/${encodeURIComponent(data.vmid)}/vncwebsocket` +
        `?port=${encodeURIComponent(data.port)}&vncticket=${encodeURIComponent(data.termTicket)}`;
    const upstream = new WebSocket(upstreamUrl, ["binary"], {
        rejectUnauthorized: process.env.PVE_TLS_REJECT_UNAUTHORIZED !== "false",
        headers: { Cookie: `PVEAuthCookie=${data.authTicket}` }
    });
    upstream.binaryType = "arraybuffer";

    upstream.on("open", () => {
        // Proxmox's xterm websocket accepts the termproxy protocol as binary frames.
        sendUpstream(upstream, `${data.username}:${data.termTicket}\n`);
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(JSON.stringify({ type: "connected" }));
        console.log(`Terminal connected: node=${data.node} vmid=${data.vmid}`);
    });
    upstream.on("message", (message, isBinary) => {
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(message, { binary: isBinary });
    });
    upstream.on("error", error => {
        console.error(`Terminal upstream error: ${error.message}`);
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, "Terminal upstream unavailable");
    });
    upstream.on("close", () => closeSocket(browserSocket));

    browserSocket.on("message", message => {
        if (upstream.readyState !== WebSocket.OPEN) return;
        try {
            const frame = JSON.parse(Buffer.from(message).toString());
            if (frame.type === "input") {
                const input = String(frame.data || "");
                sendUpstream(upstream, `0:${Buffer.byteLength(input, "utf8")}:${input}`);
            } else if (frame.type === "resize") {
                const cols = Number(frame.cols);
                const rows = Number(frame.rows);
                if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0 && cols <= 500 && rows <= 200) sendUpstream(upstream, `1:${cols}:${rows}:`);
            } else if (frame.type === "ping") {
                sendUpstream(upstream, "2");
            }
        } catch (_) {
            // Ignore malformed browser frames.
        }
    });
    browserSocket.on("close", () => {
        closeSocket(upstream);
        console.log(`Terminal disconnected: node=${data.node} vmid=${data.vmid}`);
    });
    browserSocket.on("error", () => closeSocket(upstream));
}

function handleUpgrade(request, socket, head) {
    let parsedUrl;
    try { parsedUrl = new URL(request.url, "http://localhost"); } catch (_) { socket.destroy(); return; }
    const match = parsedUrl.pathname.match(/^\/ws\/terminal\/([^/]+)$/);
    if (!match) { socket.destroy(); return; }

    const data = consumeBrowserTicket(match[1]);
    if (!data) { socket.destroy(); return; }
    const server = new WebSocket.Server({ noServer: true });
    server.on("connection", browserSocket => connectUpstream(browserSocket, data));
    server.handleUpgrade(request, socket, head, browserSocket => server.emit("connection", browserSocket));
}

module.exports = { createTerminalSession, handleUpgrade };
