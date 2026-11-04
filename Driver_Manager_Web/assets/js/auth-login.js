document.getElementById("form-login")
    .addEventListener("submit", async function (e) {
        e.preventDefault();

        const form = e.currentTarget;
        const message = document.getElementById("login-message");
        const button = form.querySelector('button[type="submit"]');

        const username = form.elements["username"].value.trim();
        const password = form.elements["password"].value;

        message.textContent = "";
        button.disabled = true;

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify({
                    username: username,
                    password: password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.message || "Đăng nhập thất bại"
                );
            }

            // Chuyển trang theo quyền
            window.location.replace(data.redirect);

        } catch (error) {
            message.textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });
