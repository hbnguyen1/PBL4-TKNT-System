
// ======================================
// 1. CẤU HÌNH API VÀ BIẾN
// ======================================

const API_BASE = "http://localhost:5005";

const driverId = new URLSearchParams(
  window.location.search
).get("id");

const form = document.getElementById("form-driver-detail");
const saveBtn = document.getElementById("btn-save-driver");
const deleteBtn = document.getElementById("btn-delete-driver");

const el = id => document.getElementById(id);

let currentDriver = null;


// ======================================
// 2. HÀM HỖ TRỢ
// ======================================

function setText(id, value) {
  el(id).textContent =
    value === null ||
    value === undefined ||
    value === ""
      ? "Chưa cập nhật"
      : String(value);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}


// ======================================
// 3. GỌI API BACKEND
// ======================================

async function api(path, options = {}) {
  let response;

  try {
    response = await fetch(API_BASE + path, options);
  } catch {
    throw new Error(
      "Không kết nối được backend ở " +
      API_BASE +
      ". Kiểm tra dotnet run và CORS."
    );
  }

  const contentType = response.headers.get("content-type") || "";

  const result = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");

  if (!response.ok) {
    const error =
      result && typeof result === "object"
        ? (result.message || result.detail || result.title)
        : null;

    throw new Error(error || `HTTP ${response.status}`);
  }

  return result;
}


// ======================================
// 4. TẢI THÔNG TIN TÀI XẾ
// ======================================

async function loadDriver() {
  if (!driverId) {
    alert("Thiếu mã tài xế. Hãy mở hồ sơ từ trang danh sách.");
    window.location.href = "drivers.html";
    return;
  }

  saveBtn.disabled = true;
  deleteBtn.disabled = true;

  try {
    const d = await api(
      `/api/drivers/${encodeURIComponent(driverId)}`
    );

    currentDriver = d;

    setText("header-driver-name", d.fullName);
    setText("header-driver-id", d.id);
    setText("view-fullname", d.fullName);
    setText("view-id", d.id);

    // API hiện tại chưa trả username
    setText("view-username", "Chưa có trong API");

    el("inp-fullname").value = d.fullName ?? "";
    el("inp-phone").value = d.phone ?? "";
    el("inp-address").value = d.address ?? "";

    el("inp-dob").value = d.dateOfBirth
      ? String(d.dateOfBirth).slice(0, 10)
      : "";

    el("inp-suspended").value =
      d.isSuspended ? "1" : "0";

    // Chuẩn hóa hạng bằng lái
    const license = String(d.licenseType ?? "").trim();

    const normalized =
      license && !/^Hạng\s+/i.test(license)
        ? "Hạng " + license
        : license;

    if (
      normalized &&
      !Array.from(el("inp-license").options)
        .some(option => option.value === normalized)
    ) {
      el("inp-license").add(
        new Option(normalized, normalized)
      );
    }

    el("inp-license").value =
      normalized || "Hạng E";

    // Avatar
    if (
      d.avatarUrl &&
      /^https?:\/\//i.test(d.avatarUrl)
    ) {
      el("img-avatar").src = d.avatarUrl;
    }

    saveBtn.disabled = false;
    deleteBtn.disabled = false;

    // Lỗi API phụ không ảnh hưởng việc sửa hồ sơ
    await Promise.allSettled([
      loadVehicle(),
      loadDemerits()
    ]);

  } catch (error) {
    alert("Không tải được hồ sơ: " + error.message);
    console.error(error);
  }
}


// ======================================
// 5. TẢI XE ĐANG PHỤ TRÁCH
// ======================================

async function loadVehicle() {
  try {
    const vehicles = await api("/api/vehicles");

    if (!Array.isArray(vehicles)) {
      throw new Error("Dữ liệu xe không hợp lệ");
    }

    const assigned = vehicles.filter(
      v => v.driverId === driverId
    );

    setText(
      "view-current-vehicle",
      assigned.length
        ? assigned.map(v => v.licensePlate).join(", ")
        : "Chưa phân công"
    );

  } catch (error) {
    console.error("Lỗi tải xe:", error);

    setText(
      "view-current-vehicle",
      "Không tải được thông tin xe"
    );
  }
}


// ======================================
// 6. TẢI LỊCH SỬ VI PHẠM
// ======================================

async function loadDemerits() {
  const body = el("demerits-table-body");

  try {
    const items = await api(
      `/api/drivers/${encodeURIComponent(driverId)}/demerits`
    );

    if (!Array.isArray(items)) {
      throw new Error("Dữ liệu vi phạm không hợp lệ");
    }

    const total = items.reduce(
      (sum, x) =>
        sum + Math.abs(Number(x.pointsDeducted) || 0),
      0
    );

    setText(
      "demerit-total-badge",
      `Lũy kế điểm trừ: -${total} Điểm`
    );

    if (!items.length) {
      body.innerHTML = `
        <tr>
          <td colspan="4"
              class="data-table__td"
              style="text-align:center;">
            Chưa có vi phạm
          </td>
        </tr>
      `;
      return;
    }

    body.innerHTML = items.map(x => `
      <tr>
        <td class="data-table__td">
          #DP-${escapeHTML(x.id)}
        </td>

        <td class="data-table__td">
          ${escapeHTML(x.violation)}
        </td>

        <td class="data-table__td"
            style="text-align:center;">
          <span class="badge badge--warning">
            -${escapeHTML(
              Math.abs(Number(x.pointsDeducted) || 0)
            )} Điểm
          </span>
        </td>

        <td class="data-table__td">
          ${escapeHTML(
            String(x.violatedAt ?? "").replace("T", " ")
          )}
        </td>
      </tr>
    `).join("");

  } catch (error) {
    console.error("Lỗi lịch sử vi phạm:", error);

    setText(
      "demerit-total-badge",
      "Không tải được điểm trừ"
    );

    body.innerHTML = `
      <tr>
        <td colspan="4"
            class="data-table__td"
            style="text-align:center;">
          Không tải được lịch sử vi phạm
        </td>
      </tr>
    `;
  }
}


// ======================================
// 7. LƯU THÔNG TIN TÀI XẾ
// ======================================

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentDriver || !form.reportValidity()) {
    return;
  }

  const updated = {
    ...currentDriver,
    id: driverId,
    fullName: el("inp-fullname").value.trim(),
    phone: el("inp-phone").value.trim(),
    licenseType: el("inp-license").value,
    dateOfBirth: el("inp-dob").value || null,
    address: el("inp-address").value.trim() || null,
    isSuspended: el("inp-suspended").value === "1"
  };

  saveBtn.disabled = true;

  try {
    await api(
      `/api/drivers/${encodeURIComponent(driverId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updated)
      }
    );

    alert("Đã lưu thay đổi hồ sơ!");

    await loadDriver();

  } catch (error) {
    alert("Không lưu được: " + error.message);

  } finally {
    saveBtn.disabled = false;
  }
});


// ======================================
// 8. XÓA TÀI XẾ
// ======================================

deleteBtn.addEventListener("click", async () => {
  if (!currentDriver) return;

  const confirmed = confirm(
    `Bạn chắc chắn muốn xóa tài xế ${driverId}?`
  );

  if (!confirmed) return;

  deleteBtn.disabled = true;

  try {
    await api(
      `/api/drivers/${encodeURIComponent(driverId)}`,
      {
        method: "DELETE"
      }
    );

    alert("Đã xóa tài xế!");

    window.location.href = "drivers.html";

  } catch (error) {
    alert("Không xóa được: " + error.message);
    deleteBtn.disabled = false;
  }
});


// ======================================
// 9. KHỞI ĐỘNG TRANG
// ======================================

loadDriver();
