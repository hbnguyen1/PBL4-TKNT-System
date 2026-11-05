
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

        throw new Error(
            errorMessage || `HTTP ${response.status}`
        );
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
