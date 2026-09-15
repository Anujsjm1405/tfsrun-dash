document.addEventListener("DOMContentLoaded", () => {
    const logoutBtn = document.getElementById("s3LogoutBtn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            window.location.href = "/api/auth/logout";
        });
    }
});
