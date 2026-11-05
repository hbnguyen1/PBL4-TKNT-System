
const API_BASE = "http://localhost:5005";

// =====================================
// 1. LẤY THÔNG TIN TÀI KHOẢN TỪ URL
// =====================================

const params = new URLSearchParams(window.location.search);
const driverId = params.get("id");

const form = document.getElementById("password-form");
const driverIdInput = document.getElementById("driver-id");
const usernameInput = document.getElementById("driver-username");
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");
const message = document.getElementById("password-message");
const saveButton = document.getElementById("btn-save");

let isAuthorizedAdmin = false;

// =====================================
// 2. HIỂN THỊ THÔNG BÁO
// =====================================

function showMessage(text, success = false) {
    message.textContent = text;
    message.style.color = success ? "#16a34a" : "#dc2626";
}

// =====================================
// 3. KIỂM TRA ADMIN ĐĂNG NHẬP
// =====================================

async function checkAdmin() {
    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
            credentials: "include",
            cache: "no-store"
        });

        if (response.status === 401) {
            window.top.location.replace("/login.html");
            return false;
        }

        if (!response.ok) {
            throw new Error("Không thể xác thực tài khoản Admin!");
        }

        const data = await response.json();

        if (data.role !== "Admin") {
            window.top.location.replace("/driver.html");
            return false;
        }

        isAuthorizedAdmin = true;
        return true;

    } catch (error) {
        console.error("Lỗi xác thực Admin:", error);
        showMessage("Không thể xác thực tài khoản Admin!");
        return false;
    }
}

// =====================================
// 4. KHỞI TẠO TRANG ĐỔI MẬT KHẨU
// =====================================

async function initializePage() {

    if (!driverId) {
        showMessage("Không tìm thấy mã tài xế!");

        saveButton.disabled = true;
        return;
    }

    // Hiển thị mã tài xế lấy từ URL
    driverIdInput.value = driverId;

    // API GET driver
    try {
        const response = await fetch(
            `${API_BASE}/api/drivers/${encodeURIComponent(driverId)}` // ✅ ĐÃ SỬA: Gọi đúng API GET chi tiết tài xế
        );

        if (!response.ok) {
            throw new Error("Không lấy được thông tin tài xế!");
        }

        const driver = await response.json();

        // Gán tên đăng nhập thu được từ API vào ô input
        usernameInput.value = driver.username || "Chưa có tài khoản";

    } catch (error) {
        console.error("Lỗi lấy username:", error);
        usernameInput.value = "Không tải được";
    }

    // Kiểm tra quyền Admin
    const authorized = await checkAdmin();

    if (!authorized) {
        saveButton.disabled = true;
        return;
    }

    saveButton.disabled = false;
}

// =====================================
// 5. XỬ LÝ ĐỔI MẬT KHẨU TÀI XẾ
// =====================================

form.addEventListener("submit", async function (event) {

    event.preventDefault();

    if (!isAuthorizedAdmin) {
        showMessage("Bạn không có quyền thực hiện thao tác này!");
        return;
    }

    if (!driverId) {
        showMessage("Mã tài xế không hợp lệ!");
        return;
    }

    const newPassword = newPasswordInput.value;
    const confirmPassword = confirmPasswordInput.value;

    if (!newPassword || !confirmPassword) {
        showMessage("Vui lòng nhập đầy đủ thông tin!");
        return;
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
        showMessage("Mật khẩu phải có từ 8 đến 128 ký tự!");
        return;
    }

    if (newPassword !== confirmPassword) {
        showMessage("Mật khẩu xác nhận không khớp!");
        return;
    }

    const confirmed = confirm(
        `Bạn có chắc muốn đổi mật khẩu cho tài xế ${driverId}?`
    );

    if (!confirmed) return;

    try {
        saveButton.disabled = true;

        saveButton.innerHTML =
            '<i class="fa-solid fa-spinner fa-spin"></i> Đang cập nhật...';

        const response = await fetch(
            `${API_BASE}/api/drivers/${encodeURIComponent(driverId)}/password`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    newPassword: newPassword
                })
            }
        );

        const data = await response.json().catch(() => ({}));

        if (response.status === 401) {
            window.top.location.replace("/login.html");
            return;
        }

        if (!response.ok) {
            throw new Error(
                data.message || "Đổi mật khẩu thất bại!"
            );
        }

        showMessage("Đổi mật khẩu thành công!", true);

        form.reset();

        // Giữ lại mã tài xế sau khi reset form
        driverIdInput.value = driverId;

    } catch (error) {
        console.error("Lỗi đổi mật khẩu:", error);
        showMessage(error.message || "Không thể kết nối máy chủ!");

    } finally {
        saveButton.disabled = false;

        saveButton.innerHTML =
            '<i class="fa-solid fa-floppy-disk"></i> Cập Nhật Mật Khẩu';
    }
});

// =====================================
// 6. KHỞI ĐỘNG
// =====================================

initializePage();
