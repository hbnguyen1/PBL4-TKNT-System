const API_BASE = "http://localhost:5005";

const form = document.getElementById("addDriverForm");
const saveButton = document.getElementById("saveButton");
const message = document.getElementById("formMessage");
const avatarInput = document.getElementById("avatar");
const avatarPreview = document.getElementById("avatarPreview");

// Hiển thị thông báo
function showMessage(text, isError = false) {
    message.textContent = text;
    message.style.display = "block";
    message.style.color = isError ? "#dc2626" : "#15803d";
}

// Xem trước ảnh đại diện
avatarInput.addEventListener("change", function () {
    const file = this.files[0];

    if (!file) return;

    const allowedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    if (!allowedTypes.includes(file.type)) {
        alert("Vui lòng chọn ảnh JPG, PNG hoặc WEBP!");
        this.value = "";
        return;
    }

    if (file.size > 5 * 1024 * 1024) {
        alert("Ảnh không được vượt quá 5MB!");
        this.value = "";
        return;
    }

    const reader = new FileReader();

    reader.onload = function (event) {
        avatarPreview.src = event.target.result;
        avatarPreview.style.display = "block";
    };

    reader.readAsDataURL(file);
});

// Xử lý thêm tài xế
form.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (!form.reportValidity()) return;

    // 1. Lấy dữ liệu từ form
    const driverId = document.getElementById("driverId").value.trim();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const fullName = document.getElementById("fullName").value.trim();
    const dateOfBirth = document.getElementById("dateOfBirth").value; 
    const address = document.getElementById("address").value.trim();
    const phone = document.getElementById("phone").value.trim();
    const licenseType = document.getElementById("licenseType").value;

    // 2. Kiểm tra dữ liệu
    if (!driverId || !username || !fullName || password.length < 8 || !dateOfBirth || !address) {
        showMessage("Vui lòng nhập đầy đủ thông tin hợp lệ!", true);
        return;
    }

    // 3. Tạo thông tin tài xế
    const driverData = {
        id: driverId,
        fullName: fullName,
        dateOfBirth: dateOfBirth,
        address: address,
        avatarUrl: null,
        phone: phone || null,
        licenseType: licenseType,
        isSuspended: false
    };

    // 4. Tạo thông tin tài khoản
    const accountData = {
        username: username,
        passwordHash: password
    };

    // 5. Đóng gói dữ liệu bằng FormData
    const formData = new FormData();

    formData.append("Driver", JSON.stringify(driverData));
    formData.append("Account", JSON.stringify(accountData));

    // 6. Thêm ảnh đại diện nếu có
    if (avatarInput.files.length > 0) {
        formData.append("Avatar", avatarInput.files[0]);
    }

    // 7. Khóa nút lưu
    saveButton.disabled = true;

    const buttonText = saveButton.querySelector("span");

    if (buttonText) {
        buttonText.textContent = "Đang lưu...";
    }

    showMessage("Đang lưu hồ sơ tài xế...");

    try {
        // 8. Gửi dữ liệu đến backend
        const response = await fetch(`${API_BASE}/api/drivers`, {
            method: "POST",
            headers: {
                "Accept": "application/json"
            },
            body: formData
        });

        // 9. Nhận phản hồi từ backend
        const contentType = response.headers.get("content-type") || "";

        let result;

        if (contentType.includes("application/json")) {
            result = await response.json();
        } else {
            result = await response.text();
        }

        // 10. Kiểm tra kết quả
        if (!response.ok) {
            const errorMessage = typeof result === "string"
                ? result
                : result.message || result.detail || result.title;

            throw new Error(
                errorMessage || `Lỗi HTTP ${response.status}`
            );
        }

        // 11. Thêm thành công
        showMessage("Thêm tài xế thành công!");

        form.reset();

        avatarPreview.src = "";
        avatarPreview.style.display = "none";

        // 12. Chuyển về danh sách tài xế
        setTimeout(function () {
            window.location.href = "drivers.html";
        }, 1000);

    } catch (error) {
        console.error("Lỗi thêm tài xế:", error);

        showMessage(
            "Không thể thêm tài xế: " + error.message,
            true
        );

    } finally {
        saveButton.disabled = false;

        if (buttonText) {
            buttonText.textContent = "Lưu Hồ Sơ";
        }
    }
});