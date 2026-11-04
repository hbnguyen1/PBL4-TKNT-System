// ĐĂNG XUẤT
async function logout() {
    try {
        const response = await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin"
        });

        if (!response.ok && response.status !== 401) {
            throw new Error("Đăng xuất thất bại");
        }

        window.location.replace("/login.html");
    } catch (error) {
        alert(error.message);
    }
}

// ĐỔI MẬT KHẨU
async function changePassword(e) {
    e.preventDefault();

    const form = e.currentTarget;
    const message = document.getElementById("password-message");

    const currentPassword =
        form.elements["currentPassword"].value;

    const newPassword =
        form.elements["newPassword"].value;

    const confirmPassword =
        form.elements["confirmPassword"].value;

    if (newPassword !== confirmPassword) {
        message.textContent = "Mật khẩu xác nhận không khớp!";
        return;
    }

    if (newPassword.length < 8) {
        message.textContent =
            "Mật khẩu mới phải có ít nhất 8 ký tự!";
        return;
    }

    try {
        const response = await fetch(
            "/api/auth/change-password",
            {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword,
                    confirmPassword
                })
            }
        );

        const data = await response.json();

        message.textContent =
            data.message || "Có lỗi xảy ra";

        if (response.ok) {
            alert("Đổi mật khẩu thành công!");
            window.location.replace("/login.html");
        }

    } catch (error) {
        message.textContent = "Không thể kết nối máy chủ!";
    }
}
