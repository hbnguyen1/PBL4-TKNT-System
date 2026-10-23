
const API_BASE = "http://localhost:5005";

const form = document.getElementById("addDriverForm");
const saveButton = document.getElementById("saveButton");
const message = document.getElementById("formMessage");

function showMessage(text, isError = false) {
  message.textContent = text;
  message.style.display = "block";
  message.style.color = isError ? "#dc2626" : "#15803d";
}

form.addEventListener("submit", async function(event) {
  event.preventDefault();

  if (!form.reportValidity()) return;

  const driverId = document.getElementById("driverId").value.trim();
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const fullName = document.getElementById("fullName").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const licenseType = document.getElementById("licenseType").value;

  if (!driverId || !username || !fullName || password.length < 8) {
    showMessage("Vui lòng nhập đầy đủ thông tin hợp lệ.", true);
    return;
  }

  // Cấu trúc JSON mà DriversController.cs nhận
  const data = {
    driver: {
      id: driverId,
      fullName: fullName,
      dateOfBirth: null,
      address: null,
      avatarUrl: null,
      phone: phone || null,
      licenseType: licenseType,
      isSuspended: false
    },
    account: {
      username: username,
      passwordHash: password
    }
  };

  saveButton.disabled = true;
  saveButton.querySelector("span").textContent = "Đang lưu...";
  showMessage("Đang lưu hồ sơ tài xế...");

  try {
    const response = await fetch(`${API_BASE}/api/drivers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(data)
    });

    let result = {};

    try {
      result = await response.json();
    } catch {
      // Server có thể trả về nội dung không phải JSON
    }

    if (!response.ok) {
      throw new Error(
        result.message ||
        result.detail ||
        "Không thể thêm tài xế (HTTP " + response.status + ")"
      );
    }

    showMessage("Thêm tài xế thành công! Đang chuyển về danh sách...");

    form.reset();

    window.location.href = "drivers.html";

  } catch (error) {
    console.error("Lỗi thêm tài xế:", error);
    showMessage(
      error.message || "Không thể kết nối backend.",
      true
    );

  } finally {
    saveButton.disabled = false;
    saveButton.querySelector("span").textContent = "Lưu Hồ Sơ";
  }
});
