
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
// 3. CHUẨN HÓA DỮ LIỆU
// ======================================

function normalizeBoolean(value) {
    return (
        value === true ||
        value === 1 ||
        value === "1" ||
        String(value).toLowerCase() === "true"
    );
}


// ======================================
// 4. TẢI DANH SÁCH TÀI XẾ TỪ MYSQL
// ======================================

async function loadDrivers() {
    try {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5"
                    class="data-table__td"
                    style="text-align:center;">
                    Đang tải danh sách tài xế...
                </td>
            </tr>
        `;

        const response = await fetch(API_URL, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });

        // Đọc nội dung phản hồi để dễ xác định lỗi Backend
        const responseText = await response.text();

        if (!response.ok) {
            console.error(
                "API GET /api/drivers thất bại:",
                response.status,
                responseText
            );

            throw new Error(
                `HTTP ${response.status}: ${
                    responseText || "Backend không trả về chi tiết lỗi"
                }`
            );
        }

        let data;

        try {
            data = JSON.parse(responseText);
        } catch {
            throw new Error("Backend trả về dữ liệu JSON không hợp lệ.");
        }

        if (!Array.isArray(data)) {
            throw new Error("Dữ liệu API không đúng định dạng danh sách.");
        }

        drivers = data;

        renderDrivers();

    } catch (error) {
        console.error("Lỗi tải tài xế:", error);

        tableBody.innerHTML = `
            <tr>
                <td colspan="5"
                    class="data-table__td"
                    style="text-align:center;color:#dc2626;">
                    Không thể tải danh sách tài xế.
                    <br>
                    ${escapeHTML(error.message)}
                </td>
            </tr>
        `;
    }
}


// ======================================
// 5. HIỂN THỊ DANH SÁCH TÀI XẾ
// ======================================

function renderDrivers() {

    // Kiểm tra các phần tử HTML
    if (!searchInput || !licenseFilter ||
        !statusFilter || !tableBody) {
        console.error("Không tìm thấy các phần tử HTML cần thiết.");
        return;
    }

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
        ]
            .join(" ")
            .toLowerCase();

        // Tìm kiếm
        const matchSearch = searchableText.includes(keyword);

        // Chuẩn hóa hạng bằng lái
        const licenseType = String(driver.licenseType ?? "")
            .replace(/^Hạng\s+/i, "")
            .trim()
            .toUpperCase();

        const matchLicense =
            !license || licenseType === license.toUpperCase();

        // Chuẩn hóa trạng thái
        const suspended = normalizeBoolean(driver.isSuspended);

        const matchStatus =
            status === "" ||
            String(Number(suspended)) === status;

        return matchSearch && matchLicense && matchStatus;
    });


    // Không có tài xế phù hợp
    if (filteredDrivers.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5"
                    class="data-table__td"
                    style="text-align:center;">
                    Không tìm thấy tài xế phù hợp.
                </td>
            </tr>
        `;
        return;
    }


    // Hiển thị từng tài xế
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
        const isSuspended = normalizeBoolean(driver.isSuspended);

        const statusBadge = isSuspended
            ? '<span class="badge badge--danger">Đình chỉ</span>'
            : '<span class="badge badge--success">Đang hoạt động</span>';

        return `
            <tr>

                <!-- MÃ TÀI XẾ -->
                <td class="data-table__td"
                    style="font-family:monospace;font-weight:700;color:var(--color-primary);">
                    ${id}
                </td>

                <!-- HỌ TÊN -->
                <td class="data-table__td">
                    <a
                        href="driver-detail.html?id=${encodeURIComponent(driver.id)}"
                        class="drivers-list__link">
                        ${name}
                    </a>
                </td>

                <!-- SỐ ĐIỆN THOẠI -->
                <td class="data-table__td"
                    style="font-family:monospace;">
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
// 6. XỬ LÝ TÌM KIẾM VÀ BỘ LỌC
// ======================================

// Tìm kiếm theo tên, mã tài xế, số điện thoại
if (searchInput) {
    searchInput.addEventListener("input", renderDrivers);
}

// Lọc theo hạng bằng lái
if (licenseFilter) {
    licenseFilter.addEventListener("change", renderDrivers);
}

// Lọc theo trạng thái
if (statusFilter) {
    statusFilter.addEventListener("change", renderDrivers);
}


// ======================================
// 7. KHỞI ĐỘNG TRANG
// ======================================

loadDrivers();
