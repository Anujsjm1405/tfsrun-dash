const form =
    document.getElementById(
        "adminLoginForm"
    );

const button =
    document.getElementById(
        "adminLoginButton"
    );

const message =
    document.getElementById(
        "message"
    );


function showMessage(
    text,
    type
) {
    message.textContent = text;

    message.className =
        `message ${type}`;
}


form.addEventListener(
    "submit",
    async event => {
        event.preventDefault();

        button.disabled = true;

        try {
            const response =
                await fetch(
                    "/api/auth/admin-login",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                username:
                                    document
                                        .getElementById(
                                            "username"
                                        )
                                        .value,

                                password:
                                    document
                                        .getElementById(
                                            "password"
                                        )
                                        .value
                            })
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
                    "Login failed"
                );
            }

            showMessage(
                "Admin login successful.",
                "success"
            );

            setTimeout(
                () => {
                    window.location.href =
                        "/admin";
                },
                300
            );

        } catch (error) {
            showMessage(
                error.message,
                "error"
            );

            button.disabled = false;
        }
    }
);
