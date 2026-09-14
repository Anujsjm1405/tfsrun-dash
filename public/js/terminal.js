(() => {

    "use strict";


    const terminalElement =
        document.getElementById(
            "terminal"
        );

    const statusElement =
        document.getElementById(
            "terminalStatus"
        );

    const reconnectButton =
        document.getElementById(
            "reconnectButton"
        );

    const disconnectButton =
        document.getElementById(
            "disconnectButton"
        );

    const terminalConfig =
        window.TFSRUN_TERMINAL || {
            serviceId:
                document.body.dataset.terminalServiceId,

            serviceName:
                document.body.dataset.terminalServiceName
        };


    if (
        !terminalElement ||
        !terminalConfig.serviceId
    ) {

        return;
    }

    // ------------------------------------------------
    // xterm
    // ------------------------------------------------

    const terminal =
        new Terminal({

            cursorBlink:
                true,

            cursorStyle:
                "block",

            convertEol:
                true,

            fontSize:
                15,

            letterSpacing:
                0,

            scrollback:
                5000,

            theme: {

                background:
                    "#000000",

            foreground:
                    "#f9fafb",

                cursor:
                    "#f9fafb"
            }
        });

    const fitAddon =
        new FitAddon.FitAddon();

    terminal.loadAddon(
        fitAddon
    );


    terminal.open(
        terminalElement
    );


    // ------------------------------------------------
    function fitTerminal() {
        const width = terminalElement.clientWidth;
        const height = terminalElement.clientHeight;

        if (width <= 0 || height <= 0) {
            return false;
        }

        fitAddon.fit();

        return terminal.cols > 0 && terminal.rows > 0;
    }

    function fitAndNotifyBackend() {
        if (fitTerminal()) {
            sendResize();
        }
    }

    let fitFrame = null;

    function scheduleFit() {
        if (fitFrame !== null) {
            return;
        }

        fitFrame = window.requestAnimationFrame(
            () => {
                fitFrame = null;
                fitAndNotifyBackend();
            }
        );
    }

    const resizeObserver =
        typeof ResizeObserver === "function"
            ? new ResizeObserver(() => {
                scheduleFit();
            })
            : null;

    if (resizeObserver) {
        resizeObserver.observe(terminalElement);
    }


    let socket =
        null;


    let manualDisconnect =
        false;

    function cleanup() {
        manualDisconnect = true;

        if (socket) {
            socket.close();
            socket = null;
        }

        terminal.dispose();
        fitAddon.dispose();

        if (resizeObserver) {
            resizeObserver.disconnect();
        }

        if (fitFrame !== null) {
            window.cancelAnimationFrame(fitFrame);
            fitFrame = null;
        }
    }


    // ------------------------------------------------
    // Status
    // ------------------------------------------------

    function setStatus(
        text,
        type = ""
    ) {

        statusElement.textContent =
            text;

        statusElement.className =
            `status ${type}`;
    }


    // ------------------------------------------------
    // Send resize
    // ------------------------------------------------

    function sendResize() {

        if (
            !socket ||
            socket.readyState !==
            WebSocket.OPEN
        ) {

            return;
        }

        const cols =
            terminal.cols;

        const rows =
            terminal.rows;

        socket.send(
            JSON.stringify({

                type:
                    "resize",

                cols,

                rows
            })
        );
    }


    // ------------------------------------------------
    // Connect
    // ------------------------------------------------

    async function connect() {

        manualDisconnect =
            false;

        if (socket) {

            try {
                socket.close();
            } catch (error) {
                // ignore
            }

            socket =
                null;
        }

        setStatus(
            "Creating terminal session..."
        );

        try {

            const response =
                await fetch(
                    `/student/compute/terminal-ticket/` +
                    `${terminalConfig.serviceId}`,
                    {

                        method:
                            "GET",

                        credentials:
                            "same-origin",

                        headers: {

                            Accept:
                                "application/json"
                        }
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {

                throw new Error(
                    data.error ||
                    "Failed to create terminal session"
                );
            }


            setStatus(
                "Connecting..."
            );


            const protocol =
                window.location.protocol ===
                "https:"
                    ? "wss:"
                    : "ws:";


            const wsURL =
                `${protocol}//` +
                `${window.location.host}` +
                `/ws/terminal/${data.ticket}`;


            socket =
                new WebSocket(
                    wsURL
                );


            socket.binaryType =
                "arraybuffer";


            socket.onopen =
                () => {

                    setStatus(
                        "Connected",
                        "connected"
                    );

                    terminal.focus();

                    sendResize();
                };


            socket.onmessage =
                event => {

                    if (
                        typeof event.data ===
                        "string"
                    ) {

                        try {

                            const message =
                                JSON.parse(
                                    event.data
                                );

                            if (
                                message.type ===
                                "connected"
                            ) {

                                setStatus(
                                    "Connected",
                                    "connected"
                                );

                                terminal.focus();

                                sendResize();

                                return;
                            }

                        } catch (error) {

                            // Not JSON.
                        }

                        terminal.write(
                            event.data
                        );

                        return;
                    }


                    if (
                        event.data instanceof
                        ArrayBuffer
                    ) {

                        const text =
                            new TextDecoder()
                                .decode(
                                    new Uint8Array(
                                        event.data
                                    )
                                );

                        terminal.write(
                            text
                        );

                        return;
                    }


                    if (
                        event.data instanceof
                        Blob
                    ) {

                        event.data
                            .arrayBuffer()
                            .then(
                                buffer => {

                                    const text =
                                        new TextDecoder()
                                            .decode(
                                                new Uint8Array(
                                                    buffer
                                                )
                                            );

                                    terminal.write(
                                        text
                                    );
                                }
                            );
                    }
                };


            socket.onerror =
                error => {

                    console.error(
                        "Terminal WebSocket error:",
                        error
                    );

                    setStatus(
                        "Connection error",
                        "error"
                    );
                };


            socket.onclose =
                () => {

                    if (
                        manualDisconnect
                    ) {

                        setStatus(
                            "Disconnected"
                        );

                        return;
                    }

                    setStatus(
                        "Disconnected",
                        "error"
                    );
                };

        } catch (error) {

            console.error(
                "Terminal connection error:",
                error
            );

            setStatus(
                error.message ||
                "Connection failed",
                "error"
            );
        }
    }


    // ------------------------------------------------
    // Terminal input
    // ------------------------------------------------

    terminal.onData(
        data => {

            if (
                !socket ||
                socket.readyState !==
                WebSocket.OPEN
            ) {

                return;
            }

            socket.send(
                JSON.stringify({

                    type:
                        "input",

                    data
                })
            );
        }
    );


    // ------------------------------------------------
    // Resize
    // ------------------------------------------------

    window.addEventListener(
        "resize",
        () => {
            scheduleFit();
        }
    );

    // ------------------------------------------------
    // Reconnect
    // ------------------------------------------------

    reconnectButton.addEventListener(
        "click",
        () => {

            terminal.clear();

            connect();
        }
    );


    // ------------------------------------------------
    // Disconnect
    // ------------------------------------------------

    disconnectButton.addEventListener(
        "click",
        () => {

            manualDisconnect =
                true;

            if (socket) {

                socket.close();

                socket =
                    null;
            }

            setStatus(
                "Disconnected"
            );
        }
    );

    window.addEventListener(
        "pagehide",
        cleanup,
        { once: true }
    );


    // ------------------------------------------------
    // Start
    // ------------------------------------------------

    window.requestAnimationFrame(
        () => {
            fitAndNotifyBackend();
            connect();
        }
    );

})();
