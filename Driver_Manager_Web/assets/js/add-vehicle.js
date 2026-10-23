
const API_BASE = "http://localhost:5005";

const form = document.getElementById("form-add-vehicle");
const submitBtn = document.getElementById("btn-submit");
const message = document.getElementById("form-message");

// Hiển thị thông báo
function showMessage(text, error = false) {
  message.style.display = "block";
  message.style.color = error ? "#dc2626" : "#15803d";
  message.textContent = text;
}

// Xử lý khi nhấn nút khai báo xe
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) return;

  // Lấy dữ liệu từ form
  const licensePlate = document
    .getElementById("license-plate")
    .value.trim()
    .toUpperCase();

  const vehicleName = document
    .getElementById("vehicle-name")
    .value.trim();

  const deviceInfo = document
    .getElementById("device-info")
    .value.trim();

  const route = document
    .getElementById("vehicle-route")
    .value.trim();

  // Kiểm tra dữ liệu bắt buộc
  if (!licensePlate || !vehicleName) {
    showMessage("Vui lòng nhập biển số và tên dòng xe.", true);
    return;
  }

  // Dữ liệu gửi đến VehiclesController.cs
  const payload = {
    licensePlate: licensePlate,
    vehicleName: vehicleName,
    deviceInfo: deviceInfo || null,
    route: route || null,
    driverId: null
  };

  submitBtn.disabled = true;
  showMessage("Đang lưu phương tiện vào MySQL...");

  try {
    // Gọi API thêm phương tiện
    const response = await fetch(`${API_BASE}/api/vehicles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const contentType = response.headers.get("content-type") || "";

    const data = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");

    // Kiểm tra kết quả từ API
    if (!response.ok) {
      const detail = typeof data === "string"
        ? data
        : (data?.message || data?.detail || data?.title || "");

      throw new Error(detail || `HTTP ${response.status}`);
    }

    // Thêm xe thành công
    showMessage(
      `Đã khai báo xe ${licensePlate} thành công! Đang quay lại danh sách...`
    );

    form.reset();

    // Chuyển về danh sách phương tiện
    window.setTimeout(() => {
      window.location.href = "vehicles.html";
    }, 900);

  } catch (error) {
    console.error("Lỗi thêm xe:", error);

    showMessage(
      `Không thể thêm phương tiện: ${error.message}. ` +
      "Kiểm tra backend cổng 5005 và CORS.",
      true
    );

  } finally {
    submitBtn.disabled = false;
  }
});
