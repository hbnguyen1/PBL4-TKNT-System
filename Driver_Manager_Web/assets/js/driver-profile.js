document.addEventListener("DOMContentLoaded", () => {
    loadDriverProfile();

    document.getElementById("driverProfileForm")
        .addEventListener("submit", saveDriverProfile);

    document.getElementById("changePasswordForm")
        .addEventListener("submit", changePassword);

    document.getElementById("openPasswordModal")
        .addEventListener("click", openPasswordModal);

    document.getElementById("closePasswordModal")
        .addEventListener("click", closePasswordModal);

    document.getElementById("cancelPasswordModal")
        .addEventListener("click", closePasswordModal);

    document.querySelector(".password-modal__overlay")
        .addEventListener("click", closePasswordModal);

    document.addEventListener("keydown", (event) => {
        const modal = document.getElementById("passwordModal");

        if (event.key === "Escape" && !modal.hidden) {
            closePasswordModal();
        }
    });

    document.getElementById("avatar")
        .addEventListener("change", function () {
            const file = this.files[0];
            if (!file) return;

            const allowed = [
                "image/jpeg",
                "image/png",
                "image/webp"
            ];

            if (!allowed.includes(file.type) ||
                file.size > 2 * 1024 * 1024) {
                showProfileToast(
                    "Chỉ chọn ảnh JPG, PNG, WEBP tối đa 2MB.",
                    false
                );
                this.value = "";
                return;
            }

            const url = URL.createObjectURL(file);
            const img = document.getElementById("avatarUploadPreview");

            img.onload = () => URL.revokeObjectURL(url);
            img.src = url;

            document.getElementById("avatarHint").textContent =
                "Ảnh mới chỉ được xem trước, chưa lưu vào MySQL.";
        });
});

// ====================================
// HÀM CHUNG
// ====================================
function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value ?? "";
}

function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value ?? "—";
}

function showMessage(id, text, success) {
    const element = document.getElementById(id);
    if (!element) return;

    element.textContent = text;
    element.style.color = success ? "#059669" : "#dc2626";
}

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        credentials: "same-origin",
        cache: "no-store"
    });

    if (response.status === 401 || response.status === 403) {
        window.top.location.replace("/login/Login.html");
        throw new Error("Phiên đăng nhập không hợp lệ.");
    }

    const text = await response.text();
    let data = {};

    try {
        data = text ? JSON.parse(text) : {};
    } catch {
        throw new Error("Backend trả về dữ liệu không hợp lệ.");
    }

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.title ||
            `Lỗi HTTP ${response.status}`
        );
    }

    return data;
}

// ====================================
// 1. TẢI HỒ SƠ
// ====================================
async function loadDriverProfile() {
    try {
        const profile = await apiRequest(
            "/api/driver/me/profile"
        );

        setText("displayFullName", profile.fullName);
        setText("displayDriverId", profile.id);
        setText("displayUsername", profile.username);

        setText(
            "displayStatus",
            profile.isSuspended
                ? "Đang bị đình chỉ"
                : "Đang hoạt động"
        );

        setValue("username", profile.username);
        setValue("fullName", profile.fullName);
        setValue("licenseType", profile.licenseType);
        setValue("phone", profile.phone);
        setValue(
            "dateOfBirth",
            profile.dateOfBirth
                ? profile.dateOfBirth.substring(0, 10)
                : ""
        );
        setValue("address", profile.address);

        try {
            const vehicles = await apiRequest(
                "/api/driver/me/vehicle"
            );

            if (Array.isArray(vehicles) && vehicles.length > 0) {
                const plates = vehicles
                    .map(v => v.licensePlate)
                    .filter(Boolean);

                setText(
                    "displayVehicle",
                    plates.join(", ") || "Chưa phân công"
                );
            } else {
                setText("displayVehicle", "Chưa phân công");
            }
        } catch (error) {
            console.error("Lỗi tải xe:", error);
            setText(
                "displayVehicle",
                "Không tải được thông tin xe"
            );
        }

    } catch (error) {
        console.error("Lỗi tải hồ sơ:", error);
        showMessage(
            "formMessage",
            "Không thể tải hồ sơ: " + error.message,
            false
        );
    }
}

// ====================================
// 2. CẬP NHẬT HỒ SƠ
// ====================================
async function saveDriverProfile(event) {
    event.preventDefault();

    const button = document.getElementById("saveButton");

    const payload = {
        fullName: document.getElementById("fullName")
            .value.trim(),

        phone: document.getElementById("phone")
            .value.trim() || null,

        dateOfBirth: document.getElementById("dateOfBirth")
            .value || null,

        address: document.getElementById("address")
            .value.trim() || null
    };

    if (!payload.fullName) {
        showMessage(
            "formMessage",
            "Vui lòng nhập họ tên tài xế.",
            false
        );
        return;
    }

    button.disabled = true;

    try {
        const data = await apiRequest(
            "/api/driver/me/profile",
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            }
        );

        showMessage(
            "formMessage",
            data.message || "Lưu hồ sơ thành công!",
            true
        );

        showProfileToast(
            data.message || "Lưu hồ sơ thành công!",
            true
        );

        await loadDriverProfile();

    } catch (error) {
        showMessage("formMessage", error.message, false);
    } finally {
        button.disabled = false;
    }
}

// ====================================
// 3. MỞ / ĐÓNG POPUP
// ====================================
function openPasswordModal() {
    const modal = document.getElementById("passwordModal");

    document.getElementById("changePasswordForm").reset();
    document.getElementById("passwordMessage").textContent = "";

    modal.hidden = false;
    document.getElementById("currentPassword").focus();
}

function closePasswordModal() {
    const modal = document.getElementById("passwordModal");

    modal.hidden = true;
    document.getElementById("changePasswordForm").reset();
    document.getElementById("passwordMessage").textContent = "";
    document.getElementById("openPasswordModal").focus();
}

// ====================================
// 4. THÔNG BÁO
// ====================================
let profileToastTimer = null;

function showProfileToast(message, success = true) {
    const toast = document.getElementById("profileToast");

    toast.textContent = message;
    toast.className = "profile-toast " +
        (success ? "profile-toast--success"
                 : "profile-toast--error");

    toast.hidden = false;

    clearTimeout(profileToastTimer);

    profileToastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 4000);
}

// ====================================
// 5. ĐỔI MẬT KHẨU
// ====================================
async function changePassword(event) {
    event.preventDefault();

    const currentPassword =
        document.getElementById("currentPassword").value;

    const newPassword =
        document.getElementById("newPassword").value;

    const confirmPassword =
        document.getElementById("confirmPassword").value;

    const button =
        document.getElementById("changePasswordButton");

    const message =
        document.getElementById("passwordMessage");

    message.textContent = "";

    if (newPassword !== confirmPassword) {
        showMessage(
            "passwordMessage",
            "Mật khẩu xác nhận không khớp.",
            false
        );
        return;
    }

    if (newPassword.length < 8 || newPassword.length > 72) {
        showMessage(
            "passwordMessage",
            "Mật khẩu mới phải có từ 8 đến 72 ký tự.",
            false
        );
        return;
    }

    if (currentPassword === newPassword) {
        showMessage(
            "passwordMessage",
            "Mật khẩu mới phải khác mật khẩu hiện tại.",
            false
        );
        return;
    }

    button.disabled = true;
    button.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Đang cập nhật...';

    try {
        const data = await apiRequest(
            "/api/driver/me/password",
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    currentPassword,
                    newPassword
                })
            }
        );

        closePasswordModal();

        showProfileToast(
            data.message || "Đổi mật khẩu thành công!",
            true
        );

    } catch (error) {
        showMessage(
            "passwordMessage",
            error.message || "Không thể đổi mật khẩu.",
            false
        );
    } finally {
        button.disabled = false;
        button.innerHTML =
            '<i class="fa-solid fa-lock"></i> Cập nhật mật khẩu';
    }
}
