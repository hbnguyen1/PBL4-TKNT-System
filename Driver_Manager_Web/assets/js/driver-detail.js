
// ======================================
// 1. CẤU HÌNH API VÀ BIẾN
// ======================================

const API_BASE = "http://localhost:5005";

const DEFAULT_AVATAR = "/assets/imgs/default-avatar.png";

const driverId = new URLSearchParams(
    window.location.search
).get("id");

const changePasswordLink = document.querySelector(
    ".driver-identity__password-btn"
);

if (changePasswordLink && driverId) {
    changePasswordLink.href =
        `driver-password.html?id=${encodeURIComponent(driverId)}`;
}

const form = document.getElementById("form-driver-detail");
const saveBtn = document.getElementById("btn-save-driver");
const deleteBtn = document.getElementById("btn-delete-driver");

const avatarInput = document.getElementById("inp-avatar");
const avatarImage = document.getElementById("img-avatar");

const el = id => document.getElementById(id);

let currentDriver = null;
let selectedAvatar = null;


// ======================================
// 2. HÀM HỖ TRỢ
// ======================================

function setText(id, value) {
    const element = el(id);

    if (!element) return;

    element.textContent =
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

function showDefaultAvatar() {
    if (avatarImage) {
        avatarImage.onerror = null;
        avatarImage.src = DEFAULT_AVATAR;
    }
}


// ======================================
// 3. GỌI API BACKEND
// ======================================

async function api(path, options = {}) {
    let response;

    try {
        response = await fetch(API_BASE + path, options);
    } catch (error) {
        throw new Error(
            "Không kết nối được backend tại " +
            API_BASE +
            ". Kiểm tra dotnet run và CORS."
        );
    }

    const contentType =
        response.headers.get("content-type") || "";

    const result = contentType.includes("application/json")
        ? await response.json().catch(() => null)
        : await response.text().catch(() => "");

    if (!response.ok) {
        const errorMessage =
            result && typeof result === "object"
                ? result.message || result.detail || result.title
                : result;

        const failure = new Error(errorMessage || `HTTP ${response.status}`);
        failure.status = response.status;
        throw failure;
    }

    return result;
}


// ======================================
// 4. HIỂN THỊ ẢNH ĐẠI DIỆN
// ======================================

function loadAvatar() {
    if (!avatarImage) return;

    // Xóa sự kiện lỗi cũ
    avatarImage.onerror = null;

    // Gọi API lấy ảnh từ MySQL
    avatarImage.src =
        `${API_BASE}/api/drivers/${encodeURIComponent(driverId)}/avatar?t=${Date.now()}`;

    // Nếu tài xế chưa có ảnh hoặc API trả lỗi
    // thì hiển thị ảnh mặc định
    avatarImage.onerror = function () {
        showDefaultAvatar();
    };
}


// ======================================
// 5. CHỌN VÀ XEM TRƯỚC ẢNH
// ======================================

if (avatarInput) {
    avatarInput.addEventListener("change", function () {
        const file = this.files[0];

        if (!file) return;

        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];

        // Kiểm tra định dạng
        if (!allowedTypes.includes(file.type)) {
            alert("Chỉ chấp nhận ảnh JPG, PNG hoặc WEBP!");

            this.value = "";
            selectedAvatar = null;

            return;
        }

        // Kiểm tra dung lượng tối đa 5 MB
        if (file.size > 5 * 1024 * 1024) {
            alert("Ảnh không được vượt quá 5 MB!");

            this.value = "";
            selectedAvatar = null;

            return;
        }

        // Lưu ảnh được chọn để gửi lên API
        selectedAvatar = file;

        // Xem trước ảnh
        const reader = new FileReader();

        reader.onload = function (event) {
            avatarImage.src = event.target.result;
        };

        reader.onerror = function () {
            alert("Không thể đọc ảnh đã chọn!");
            selectedAvatar = null;
            avatarInput.value = "";
        };

        reader.readAsDataURL(file);
    });
}


// ======================================
// 6. TẢI THÔNG TIN TÀI XẾ
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

        // Hiển thị thông tin cơ bản
        setText("header-driver-name", d.fullName);
        setText("header-driver-id", d.id);
        setText("view-fullname", d.fullName);
        setText("view-id", d.id);

        // API hiện tại chưa trả username
        setText("view-username", d.username ?? "Chưa có tài khoản");

        // Đổ dữ liệu vào form
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

        const licenseSelect = el("inp-license");

        if (
            normalized &&
            !Array.from(licenseSelect.options)
                .some(option => option.value === normalized)
        ) {
            licenseSelect.add(
                new Option(normalized, normalized)
            );
        }

        licenseSelect.value = normalized || "Hạng E";

        // Tải ảnh đại diện từ API
        loadAvatar();

        // Xóa trạng thái ảnh mới đã chọn
        selectedAvatar = null;

        if (avatarInput) {
            avatarInput.value = "";
        }

        saveBtn.disabled = false;
        deleteBtn.disabled = false;

        // Tải thông tin xe và lịch sử vi phạm
        await Promise.allSettled([
            loadVehicle(),
            loadDemerits()
        ]);

    } catch (error) {
        alert("Không tải được hồ sơ: " + error.message);

        console.error("Lỗi tải hồ sơ:", error);
    }
}


// ======================================
// 7. TẢI XE ĐANG PHỤ TRÁCH
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
// 8. TẢI LỊCH SỬ VI PHẠM
// ======================================

const demeritHistoryPath = `/api/drivers/${encodeURIComponent(driverId)}/demerits`;
const demeritBody = el("demerits-table-body");
const demeritPrevious = el("demerit-previous");
const demeritNext = el("demerit-next");
const demeritSummary = el("demerit-page-summary");
const demeritStatus = el("demerit-action-status");
const demeritTime = new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh"
});

let demeritPage = 1;
let demeritRequest = 0;

function demeritCell(row, content, centered = false) {
    const cell = row.insertCell();
    cell.className = centered
        ? "data-table__td driver-history-card__center"
        : "data-table__td";
    cell.append(content);
}

function showDemeritMessage(message) {
    demeritBody.replaceChildren();
    const row = demeritBody.insertRow();
    demeritCell(row, message, true);
    row.cells[0].colSpan = 5;
}

function createDemeritRow(item) {
    const row = document.createElement("tr");
    const isAi = item.source === "ai";
    row.dataset.violationSource = isAi ? "ai" : "demerit";
    row.dataset.violationId = String(item.id);
    const recordCode = isAi ? String(item.id).padStart(3, "0") : String(item.id);
    const points = Math.abs(Number(item.pointsDeducted) || 0);
    const badge = document.createElement("span");
    badge.className = points ? "badge badge--warning" : "badge badge--info";
    badge.textContent = points ? `-${points} điểm` : "0 điểm";

    const recordedAt = item.violatedAt || "";
    const timestamp = new Date(recordedAt);
    const formattedTime = isAi && !Number.isNaN(timestamp.getTime())
        ? demeritTime.format(timestamp)
        : recordedAt.replace("T", " ").slice(0, 16);

    const actions = document.createElement("div");
    actions.className = "driver-history-card__actions";
    if (item.imageUrl) {
        const evidence = document.createElement("a");
        evidence.href = item.imageUrl;
        evidence.target = "_blank";
        evidence.rel = "noopener";
        evidence.className = "btn btn--secondary";
        evidence.textContent = "Xem ảnh";
        actions.append(evidence);
    }

    if (item.canDelete === true) {
        addDemeritDeleteButton(actions, item, isAi, recordCode);
    } else {
        const locked = document.createElement("span");
        locked.className = "badge badge--info";
        locked.textContent = "Đã khóa xóa";
        actions.append(locked);
    }

    demeritCell(row, `#DP-${recordCode}`);
    demeritCell(row, item.violation);
    demeritCell(row, badge, true);
    demeritCell(row, formattedTime);
    demeritCell(row, actions, true);
    return row;
}

function addDemeritDeleteButton(actions, item, isAi, recordCode) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--danger";
    remove.textContent = "Xóa";
    remove.setAttribute("aria-label", `Xóa biên bản #DP-${recordCode}`);
    remove.addEventListener("click", async () => {
        if (!confirm(`Bạn có chắc muốn xóa biên bản #DP-${recordCode}?`)) return;
        remove.disabled = true;
        try {
            const id = encodeURIComponent(item.id);
            const path = isAi ? `/api/ai-driving-events/${id}` : `${demeritHistoryPath}/${id}`;
            await api(path, { method: "DELETE" });
            demeritStatus.textContent = `Đã xóa biên bản #DP-${recordCode}.`;
            window.pbl4NotifyViolationDeleted(isAi ? "ai" : "demerit", item.id);
        } catch (error) {
            if (error.status === 404 || error.status === 409) {
                demeritStatus.textContent = error.status === 409
                    ? error.message
                    : "Không tìm thấy biên bản để xóa.";
                await loadDemerits(demeritPage);
                return;
            }
            console.error("Lỗi xóa vi phạm:", error);
            demeritStatus.textContent = "Không xóa được biên bản. Hãy thử lại.";
            remove.disabled = false;
        }
    });
    actions.append(remove);
}

async function loadDemerits(page = 1) {
    const request = ++demeritRequest;
    demeritPrevious.disabled = true;
    demeritNext.disabled = true;
    demeritBody.setAttribute("aria-busy", "true");

    try {
        const data = await api(`${demeritHistoryPath}?page=${page}`, {
            cache: "no-store"
        });
        if (request !== demeritRequest) return;
        if (!Array.isArray(data?.items)) throw new Error("Dữ liệu vi phạm không hợp lệ.");

        const totalPoints = Math.abs(Number(data.totalPoints) || 0);
        const points = totalPoints ? `-${totalPoints}` : "0";
        setText("demerit-total-badge", `Lũy kế điểm trừ: ${points} điểm`);
        demeritPage = data.page;
        demeritSummary.textContent = data.totalCount
            ? `Trang ${data.page}/${data.totalPages} · ${data.totalCount} vi phạm`
            : "";

        if (data.items.length) {
            demeritBody.replaceChildren(...data.items.map(createDemeritRow));
        } else {
            showDemeritMessage("Chưa có vi phạm.");
        }
        demeritPrevious.disabled = data.page <= 1;
        demeritNext.disabled = data.page >= data.totalPages;
    } catch (error) {
        if (request !== demeritRequest) return;
        console.error("Lỗi lịch sử vi phạm:", error);
        setText("demerit-total-badge", "Không tải được điểm trừ");
        demeritSummary.textContent = "";
        showDemeritMessage("Không tải được lịch sử vi phạm.");
    } finally {
        if (request === demeritRequest) demeritBody.removeAttribute("aria-busy");
    }
}

demeritPrevious.addEventListener("click", () => loadDemerits(demeritPage - 1));
demeritNext.addEventListener("click", () => loadDemerits(demeritPage + 1));
window.addEventListener("pbl4:driving-event-deleted", ({ detail }) => {
    const row = Array.from(demeritBody.rows).find(item =>
        item.dataset.violationSource === detail?.source && item.dataset.violationId === detail?.id);
    row?.remove();
    loadDemerits(demeritPage);
});
window.addEventListener("pageshow", event => {
    if (event.persisted) loadDemerits(demeritPage);
});


// ======================================
// 9. LƯU THÔNG TIN TÀI XẾ VÀ ẢNH
// ======================================

form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!currentDriver || !form.reportValidity()) {
        return;
    }

    // Lấy dữ liệu mới từ form
    const updated = {
        ...currentDriver,

        id: driverId,

        fullName: el("inp-fullname").value.trim(),

        phone: el("inp-phone").value.trim(),

        licenseType: el("inp-license").value,

        dateOfBirth: el("inp-dob").value || null,

        address: el("inp-address").value.trim() || null,

        isSuspended:
            el("inp-suspended").value === "1"
    };

    saveBtn.disabled = true;

    try {
        // Tạo FormData để gửi cả thông tin và ảnh
        const formData = new FormData();

        // Gửi thông tin tài xế dưới dạng JSON string
        formData.append(
            "Driver",
            JSON.stringify(updated)
        );

        // Chỉ gửi ảnh nếu người dùng chọn ảnh mới
        if (selectedAvatar) {
            formData.append(
                "Avatar",
                selectedAvatar
            );
        }

        // Gửi multipart/form-data lên backend
        // Không tự đặt Content-Type
        await api(
            `/api/drivers/${encodeURIComponent(driverId)}`,
            {
                method: "PUT",
                body: formData
            }
        );

        alert("Đã lưu thay đổi hồ sơ!");

        // Xóa ảnh tạm sau khi lưu thành công
        selectedAvatar = null;

        if (avatarInput) {
            avatarInput.value = "";
        }

        // Tải lại dữ liệu và ảnh mới từ database
        await loadDriver();

    } catch (error) {
        alert("Không lưu được: " + error.message);

        console.error("Lỗi cập nhật hồ sơ:", error);

    } finally {
        saveBtn.disabled = false;
    }
});


// ======================================
// 10. XÓA TÀI XẾ
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

        console.error("Lỗi xóa tài xế:", error);

        deleteBtn.disabled = false;
    }
});


// ======================================
// 11. KHỞI ĐỘNG TRANG
// ======================================

loadDriver();
