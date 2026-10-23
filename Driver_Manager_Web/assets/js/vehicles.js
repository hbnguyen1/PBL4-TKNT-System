
// ======================================
// 1. CẤU HÌNH API
// ======================================

// Backend ASP.NET Core chạy cổng 5005
const API_BASE = "http://localhost:5005";

const VEHICLES_API = `${API_BASE}/api/vehicles`;

// Lấy các phần tử HTML
const searchInput = document.getElementById("searchVehicle");
const statusFilter = document.getElementById("filterStatus");
const tableBody = document.getElementById("vehicleTableBody");

// Danh sách phương tiện
let vehicles = [];


// ======================================
// 2. HÀM HỖ TRỢ
// ======================================

// Ngăn dữ liệu từ database bị hiểu thành mã HTML
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// Hiển thị thông báo trong bảng
function showTableMessage(message, isError = false) {
  tableBody.innerHTML = `
    <tr>
      <td
        colspan="6"
        class="data-table__td"
        style="text-align:center; ${isError ? 'color:#dc2626;' : ''}"
      >
        ${escapeHTML(message)}
      </td>
    </tr>
  `;
}


// ======================================
// 3. TẢI DANH SÁCH XE TỪ BACKEND
// ======================================

async function loadVehicles() {
  showTableMessage("Đang tải danh sách phương tiện...");

  try {
    const response = await fetch(VEHICLES_API, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("API không trả về danh sách hợp lệ");
    }

    // Lưu danh sách xe
    vehicles = data;

    // Hiển thị danh sách
    renderVehicles();

  } catch (error) {
    console.error("Lỗi tải phương tiện:", error);

    showTableMessage(
      "Không thể tải danh sách xe. Kiểm tra backend ở cổng 5005 và cấu hình CORS.",
      true
    );
  }
}


// ======================================
// 4. HIỂN THỊ VÀ LỌC DANH SÁCH XE
// ======================================

function renderVehicles() {
  // Lấy từ khóa tìm kiếm
  const keyword = searchInput.value.trim().toLowerCase();

  // Lấy trạng thái lọc
  const status = statusFilter.value;

  // Lọc phương tiện
  const filteredVehicles = vehicles.filter(vehicle => {

    // Các thông tin cho phép tìm kiếm
    const searchText = [
      vehicle.licensePlate,
      vehicle.vehicleName,
      vehicle.route,
      vehicle.driverId,
      vehicle.driverName
    ]
    .map(value => String(value ?? ""))
    .join(" ")
    .toLowerCase();

    const matchesSearch = searchText.includes(keyword);

    // Kiểm tra xe đã có tài xế chưa
    const hasDriver =
      vehicle.driverId !== null &&
      vehicle.driverId !== undefined &&
      String(vehicle.driverId).trim() !== "";

    // Lọc trạng thái phân công
    const matchesStatus =
      status === "" ||
      (status === "assigned" && hasDriver) ||
      (status === "unassigned" && !hasDriver);

    return matchesSearch && matchesStatus;
  });


  // Không tìm thấy phương tiện
  if (filteredVehicles.length === 0) {
    showTableMessage("Không tìm thấy phương tiện phù hợp.");
    return;
  }


  // ======================================
  // 5. HIỂN THỊ TỪNG XE LÊN BẢNG
  // ======================================

  tableBody.innerHTML = filteredVehicles.map(vehicle => {

    const plate = escapeHTML(vehicle.licensePlate);

    const name = escapeHTML(
      vehicle.vehicleName || "Chưa cập nhật"
    );

    // Hiển thị tuyến đường
    const route = vehicle.route
      ? `
        <span class="vehicles-list__route">
          ${escapeHTML(vehicle.route)}
        </span>
      `
      : `
        <span class="vehicles-list__route vehicles-list__route--empty">
          Chưa gán tuyến
        </span>
      `;

    // Kiểm tra tài xế
    const hasDriver =
      vehicle.driverId !== null &&
      vehicle.driverId !== undefined &&
      String(vehicle.driverId).trim() !== "";

    // Hiển thị tài xế phụ trách
    const driverText = hasDriver
      ? `${escapeHTML(vehicle.driverId)}${
          vehicle.driverName
            ? ` (${escapeHTML(vehicle.driverName)})`
            : ""
        }`
      : "Chưa phân công tài xế";

    // CSS tài xế
    const driverStyle = hasDriver
      ? "font-weight:500;"
      : "color:var(--color-warning);font-style:italic;";

    // Trạng thái xe
    const statusBadge = hasDriver
      ? `
        <span class="badge badge--success">
          Đã phân công
        </span>
      `
      : `
        <span class="badge badge--warning">
          Chờ tài xế
        </span>
      `;

    // Đường dẫn xem chi tiết xe
    const detailUrl =
      "vehicle-detail.html?plate=" +
      encodeURIComponent(vehicle.licensePlate);

    // Tạo dòng HTML
    return `
      <tr>

        <!-- BIỂN SỐ XE -->
        <td class="data-table__td">
          <a
            href="${detailUrl}"
            class="vehicles-list__plate"
          >
            ${plate}
          </a>
        </td>

        <!-- TÊN XE -->
        <td
          class="data-table__td"
          style="font-weight:500;"
        >
          ${name}
        </td>

        <!-- TUYẾN ĐƯỜNG -->
        <td class="data-table__td">
          ${route}
        </td>

        <!-- TÀI XẾ PHỤ TRÁCH -->
        <td
          class="data-table__td"
          style="${driverStyle}"
        >
          ${driverText}
        </td>

        <!-- TRẠNG THÁI -->
        <td class="data-table__td">
          ${statusBadge}
        </td>

        <!-- NÚT CHI TIẾT -->
        <td
          class="data-table__td"
          style="text-align:center;"
        >
          <a
            href="${detailUrl}"
            class="btn btn--secondary"
            style="padding:0.25rem 0.625rem;font-size:0.6875rem;"
            title="Xem hoặc chỉnh sửa chi tiết"
          >
            <i class="fa-solid fa-pen-to-square"></i>
            Chi Tiết
          </a>
        </td>

      </tr>
    `;
  }).join("");
}


// ======================================
// 6. TÌM KIẾM VÀ LỌC TRỰC TIẾP
// ======================================

// Tìm kiếm theo biển số, tên xe, tuyến, tài xế
searchInput.addEventListener("input", renderVehicles);

// Lọc theo trạng thái phân công
statusFilter.addEventListener("change", renderVehicles);


// ======================================
// 7. KHỞI ĐỘNG TRANG
// ======================================

// Gọi API khi mở trang
loadVehicles();
