const loginForm =
    document.getElementById("loginForm");

const registerForm =
    document.getElementById("registerForm");

const message =
    document.getElementById("message");


function showMessage(
    text,
    type
) {
    message.textContent = text;

    message.className =
        `message ${type}`;
}


async function sendRequest(
    url,
    body
) {
    const response =
        await fetch(
            url,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body:
                    JSON.stringify(body)
            }
        );

    const data =
        await response.json();

    if (!response.ok || !data.success) {
        throw new Error(
            data.error ||
            "Request failed"
        );
    }

    return data;
}


/*
 * Student login
 */

if (loginForm) {

    loginForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            const button =
                document.getElementById(
                    "loginButton"
                );

            button.disabled = true;

            try {

                await sendRequest(
                    "/api/auth/login",
                    {
                        prn:
                            document.getElementById(
                                "prn"
                            ).value,

                        password:
                            document.getElementById(
                                "password"
                            ).value
                    }
                );

                showMessage(
                    "Login successful.",
                    "success"
                );

                setTimeout(
                    () => {
                        window.location.href =
                            "/";
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
}


/*
 * Student registration
 */

if (registerForm) {

    registerForm.addEventListener(
        "submit",
        async event => {

            event.preventDefault();

            const button =
                document.getElementById(
                    "registerButton"
                );

            const password =
                document.getElementById(
                    "password"
                ).value;

            const confirmPassword =
                document.getElementById(
                    "confirmPassword"
                ).value;

            if (
                password !==
                confirmPassword
            ) {
                showMessage(
                    "Passwords do not match.",
                    "error"
                );

                return;
            }

            button.disabled = true;

            try {

                await sendRequest(
                    "/api/auth/register",
                    {
                        prn:
                            document.getElementById(
                                "prn"
                            ).value,

                        name:
                            document.getElementById(
                                "name"
                            ).value,

                        password
                    }
                );

                showMessage(
                    "Registration successful.",
                    "success"
                );

                setTimeout(
                    () => {
                        window.location.href =
                            "/";
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
}
