
// ======================================
// 1. CẤU HÌNH API
// ======================================

const API_BASE = "http://localhost:5005";

const plate = new URLSearchParams(
  window.location.search
).get("plate");

const form = document.getElementById("form-vehicle-detail");
const saveBtn = document.getElementById("btn-save");
const deleteBtn = document.getElementById("btn-delete");
const driverSelect = document.getElementById("inp-driver");
const messageBox = document.getElementById("form-message");

let currentVehicle = null;


// ======================================
// HÀM HIỂN THỊ THÔNG BÁO
// ======================================

function showMessage(text, isError = false) {
  messageBox.style.display = "block";
  messageBox.style.color = isError ? "#dc2626" : "#15803d";
  messageBox.textContent = text;
}


// ======================================
// HÀM GỌI API BACKEND
// ======================================

async function apiRequest(path, options = {}) {
  const response = await fetch(API_BASE + path, options);

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      data?.message ||
      data?.detail ||
      `API báo lỗi HTTP ${response.status}`
    );
  }

  return data;
}


// ======================================
// 2. TẢI THÔNG TIN XE
// ======================================

async function loadVehicle() {
  if (!plate) {
    showMessage("Không có biển số xe trong đường dẫn.", true);
    return;
  }

  try {
    const vehicle = await apiRequest(
      "/api/vehicles/" + encodeURIComponent(plate)
    );

    currentVehicle = vehicle;

    document.getElementById("header-plate").textContent =
      vehicle.licensePlate;

    document.getElementById("inp-plate").value =
      vehicle.licensePlate ?? "";

    document.getElementById("inp-name").value =
      vehicle.vehicleName ?? "";

    document.getElementById("inp-route").value =
      vehicle.route ?? "";

    document.getElementById("inp-device").value =
      vehicle.deviceInfo ?? "";

    await loadDrivers(vehicle.driverId);

    saveBtn.disabled = false;
    deleteBtn.disabled = false;

  } catch (error) {
    console.error(error);

    showMessage(
      "Không thể tải thông tin xe: " + error.message,
      true
    );
  }
}


// ======================================
// 3. TẢI DANH SÁCH TÀI XẾ
// ======================================

async function loadDrivers(selectedDriverId) {
  driverSelect.innerHTML = "";

  try {
    const [drivers, vehicles] = await Promise.all([
      apiRequest("/api/drivers"),
      apiRequest("/api/vehicles")
    ]);

    if (!Array.isArray(drivers) || !Array.isArray(vehicles)) {
      throw new Error("Danh sách API không hợp lệ");
    }

    // Tài xế chưa phân công
    driverSelect.add(
      new Option("-- Chưa phân công tài xế --", "")
    );

    for (const driver of drivers) {
      // Kiểm tra tài xế đang phụ trách xe khác
      const assignedVehicle = vehicles.find(v =>
        v.driverId === driver.id &&
        v.licensePlate !== plate
      );

      const isCurrentDriver =
        driver.id === selectedDriverId;

      // Không cho chọn tài xế bị đình chỉ
      // hoặc đang phụ trách xe khác
      const unavailable =
        !isCurrentDriver &&
        (driver.isSuspended || assignedVehicle);

      const label =
        `${driver.id} (${driver.fullName})` +
        (driver.isSuspended ? " - Đình chỉ" : "") +
        (assignedVehicle
          ? ` - Đang phụ trách ${assignedVehicle.licensePlate}`
          : "");

      const option = new Option(label, driver.id);
      option.disabled = Boolean(unavailable);

      driverSelect.add(option);
    }

    // Hiển thị tài xế hiện tại của xe
    if (selectedDriverId) {
      const found = [...driverSelect.options].some(
        option => option.value === selectedDriverId
      );

      if (!found) {
        driverSelect.add(
          new Option(
            `${selectedDriverId} (Không tìm thấy hồ sơ)`,
            selectedDriverId
          )
        );
      }

      driverSelect.value = selectedDriverId;
    } else {
      driverSelect.value = "";
    }

    driverSelect.disabled = false;

  } catch (error) {
    console.error(error);

    driverSelect.innerHTML = "";

    driverSelect.add(
      new Option("Không tải được danh sách tài xế", "")
    );

    driverSelect.disabled = true;

    showMessage(
      "Không thể tải danh sách tài xế: " + error.message,
      true
    );
  }
}


// ======================================
// 4. LƯU THÔNG TIN XE
// ======================================

form.addEventListener("submit", async function(event) {
  event.preventDefault();

  if (!currentVehicle || !form.reportValidity()) {
    return;
  }

  const newDriverId = driverSelect.disabled
    ? (currentVehicle.driverId || null)
    : (driverSelect.value || null);

  const updatedVehicle = {
    licensePlate: currentVehicle.licensePlate,
    vehicleName: document.getElementById("inp-name").value.trim(),
    route: document.getElementById("inp-route").value.trim() || null,
    deviceInfo: document.getElementById("inp-device").value.trim() || null,
    driverId: newDriverId
  };

  saveBtn.disabled = true;
  showMessage("Đang lưu thông tin xe...");

  try {
    // Bước 1: Cập nhật thông tin xe
    await apiRequest(
      "/api/vehicles/" +
      encodeURIComponent(currentVehicle.licensePlate),
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updatedVehicle)
      }
    );

    // Bước 2: Phân công tài xế nếu thay đổi
    const oldDriverId = currentVehicle.driverId || null;

    if (newDriverId !== oldDriverId) {
      await apiRequest(
        "/api/vehicles/" +
        encodeURIComponent(currentVehicle.licensePlate) +
        "/assign",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            driverId: newDriverId
          })
        }
      );
    }

    showMessage("Lưu thông tin xe thành công!");

    // Tải lại dữ liệu từ MySQL
    await loadVehicle();

  } catch (error) {
    console.error("Lỗi lưu xe:", error);

    showMessage(
      "Lỗi khi lưu: " + error.message +
      ". Hãy tải lại trang để kiểm tra dữ liệu.",
      true
    );

  } finally {
    saveBtn.disabled = false;
  }
});


// ======================================
// 5. XÓA PHƯƠNG TIỆN
// ======================================

deleteBtn.addEventListener("click", async () => {
  if (!currentVehicle) return;

  const currentPlate = currentVehicle.licensePlate;

  const confirmed = confirm(
    `Bạn có chắc muốn xóa xe ${currentPlate}?\n` +
    "Thao tác này không thể hoàn tác."
  );

  if (!confirmed) return;

  deleteBtn.disabled = true;
  saveBtn.disabled = true;

  showMessage("Đang xóa phương tiện...");

  try {
    await apiRequest(
      "/api/vehicles/" + encodeURIComponent(currentPlate),
      {
        method: "DELETE"
      }
    );

    alert(`Đã xóa xe ${currentPlate} thành công!`);

    window.location.href = "vehicles.html";

  } catch (error) {
    console.error("Lỗi xóa xe:", error);

    showMessage(
      "Không thể xóa xe: " + error.message,
      true
    );

    deleteBtn.disabled = false;
    saveBtn.disabled = false;
  }
});


// ======================================
// 6. ESP32-CAM
// ======================================

const camera = document.getElementById("esp32-camera");
const camStatus = document.getElementById("cam-status");
const camMessage = document.getElementById("cam-message");

// Địa chỉ stream camera
const CAMERA_URL = "http://172.31.99.200:81/stream";

// Khi nhận được hình ảnh
camera.onload = function() {
  camStatus.textContent = "ĐANG NHẬN HÌNH";
  camMessage.textContent = "Đã nhận dữ liệu hình ảnh";
};

// Khi không kết nối được
camera.onerror = function() {
  camStatus.textContent = "KHÔNG KẾT NỐI";
  camMessage.textContent =
    "Không tải được stream. Kiểm tra Wi-Fi, IP và cổng 81.";
};

// Bắt đầu tải stream
camera.src = CAMERA_URL;


// ======================================
// 7. KHỞI ĐỘNG TRANG
// ======================================

loadVehicle();
