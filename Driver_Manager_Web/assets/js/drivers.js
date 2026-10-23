
// ======================================
// 1. CẤU HÌNH API
// ======================================

const API_URL = "http://localhost:5005/api/drivers";

const searchInput = document.getElementById("searchDriver");
const licenseFilter = document.getElementById("filterLicense");
const statusFilter = document.getElementById("filterStatus");
const tableBody = document.getElementById("driverTableBody");

let drivers = [];


// ======================================
// 2. HÀM CHUYỂN TEXT AN TOÀN
// ======================================

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}


// ======================================
// 3. TẢI DANH SÁCH TÀI XẾ TỪ MYSQL
// ======================================

async function loadDrivers() {
  try {
    const response = await fetch(API_URL, {
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

    const data = await response.json();

    if (!Array.isArray(data)) {
      throw new Error("Dữ liệu API không đúng định dạng");
    }

    drivers = data;

    // Hiển thị danh sách
    renderDrivers();

  } catch (error) {
    console.error("Lỗi tải tài xế:", error);

    tableBody.innerHTML = `
      <tr>
        <td
          colspan="5"
          class="data-table__td"
          style="text-align:center;color:#dc2626;"
        >
          Không thể tải danh sách tài xế.
          Vui lòng kiểm tra backend và kết nối MySQL.
        </td>
      </tr>
    `;
  }
}


// ======================================
// 4. HIỂN THỊ DANH SÁCH TÀI XẾ
// ======================================

function renderDrivers() {
  // Lấy từ khóa tìm kiếm
  const keyword = searchInput.value.trim().toLowerCase();

  // Lấy bộ lọc
  const license = licenseFilter.value;
  const status = statusFilter.value;

  // Lọc dữ liệu
  const filteredDrivers = drivers.filter(driver => {

    const searchableText = [
      driver.id,
      driver.fullName,
      driver.phone
    ].join(" ").toLowerCase();

    const matchSearch = searchableText.includes(keyword);

    // Chuẩn hóa hạng bằng lái
    const licenseType = String(driver.licenseType ?? "")
      .replace(/^Hạng\s+/i, "")
      .trim()
      .toUpperCase();

    const matchLicense =
      !license || licenseType === license;

    // Lọc trạng thái hoạt động / đình chỉ
    const matchStatus =
      status === "" ||
      String(Number(driver.isSuspended === true)) === status;

    return matchSearch && matchLicense && matchStatus;
  });


  // Không có tài xế phù hợp
  if (filteredDrivers.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td
          colspan="5"
          class="data-table__td"
          style="text-align:center;"
        >
          Không tìm thấy tài xế phù hợp.
        </td>
      </tr>
    `;
    return;
  }


  // Hiển thị từng tài xế lên bảng
  tableBody.innerHTML = filteredDrivers.map(driver => {

    const id = escapeHTML(driver.id);
    const name = escapeHTML(driver.fullName);

    const phone = escapeHTML(
      driver.phone || "Chưa cập nhật"
    );

    const license = escapeHTML(
      driver.licenseType || "Chưa có"
    );

    // Trạng thái tài xế
    const statusBadge = driver.isSuspended
      ? '<span class="badge badge--danger">Đình chỉ</span>'
      : '<span class="badge badge--success">Đang hoạt động</span>';

    return `
      <tr>

        <!-- MÃ TÀI XẾ -->
        <td
          class="data-table__td"
          style="font-family:monospace;font-weight:700;color:var(--color-primary);"
        >
          ${id}
        </td>

        <!-- HỌ TÊN -->
        <td class="data-table__td">
          <a
            href="driver-detail.html?id=${encodeURIComponent(driver.id)}"
            class="drivers-list__link"
          >
            ${name}
          </a>
        </td>

        <!-- SỐ ĐIỆN THOẠI -->
        <td
          class="data-table__td"
          style="font-family:monospace;"
        >
          ${phone}
        </td>

        <!-- HẠNG BẰNG -->
        <td class="data-table__td">
          <span class="badge badge--info">
            ${license}
          </span>
        </td>

        <!-- TRẠNG THÁI -->
        <td class="data-table__td">
          ${statusBadge}
        </td>

      </tr>
    `;
  }).join("");
}


// ======================================
// 5. XỬ LÝ TÌM KIẾM VÀ BỘ LỌC
// ======================================

// Tìm kiếm theo tên, mã tài xế, SĐT
searchInput.addEventListener("input", renderDrivers);

// Lọc theo hạng bằng lái
licenseFilter.addEventListener("change", renderDrivers);

// Lọc theo trạng thái
statusFilter.addEventListener("change", renderDrivers);


// ======================================
// 6. KHỞI ĐỘNG TRANG
// ======================================

loadDrivers();
