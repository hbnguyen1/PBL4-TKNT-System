window.addEventListener("pageshow", () => {
    fetchOverviewStats();
    initViolationStats();
});

// ============================================================================
// 1. TẢI 4 THẺ KPI TỔNG QUAN
// ============================================================================
async function fetchOverviewStats() {
    try {
        const response = await fetch('/api/overview/stats', { cache: 'no-store' });
        if (!response.ok) {
            console.error("Lỗi gọi API Overview:", response.statusText);
            return;
        }

        const data = await response.json();

        const elDrivers = document.getElementById('kpi-drivers');
        if (elDrivers) elDrivers.textContent = data.totalDrivers;

        const elVehicles = document.getElementById('kpi-vehicles');
        if (elVehicles) elVehicles.textContent = `${data.activeVehicles} / ${data.totalVehicles}`;

        const elPayroll = document.getElementById('kpi-payroll');
        if (elPayroll) elPayroll.textContent = formatVnd(data.payrollAmount);

        const elDemerits = document.getElementById('kpi-demerits');
        if (elDemerits) elDemerits.textContent = `${data.pendingDemerits} Ca`;
    } catch (error) {
        console.error("Không thể lấy dữ liệu Overview:", error);
    }
}

// ============================================================================
// 2. THỐNG KÊ ĐIỂM TRỪ VI PHẠM (LỌC LOẠI VI PHẠM & TÊN TÀI XẾ)
// ============================================================================
const vsState = {
    initialized: false,
    raw: null,
    selectedKey: "",   // format: "source::name_lower" hoặc "" (tất cả)
    searchQuery: "",
    limit: 8
};

function initViolationStats() {
    const monthEl = document.getElementById('vs-month');
    const yearEl = document.getElementById('vs-year');
    const searchEl = document.getElementById('vs-search');
    const typeFilterEl = document.getElementById('vs-type-filter');
    const resetEl = document.getElementById('vs-reset');
    const moreEl = document.getElementById('vs-more');

    if (!monthEl || !yearEl) return;

    const now = new Date();
    if (!vsState.initialized) {
        monthEl.value = String(now.getMonth() + 1);
        yearEl.value = String(now.getFullYear());

        monthEl.addEventListener('change', () => {
            vsState.selectedKey = "";
            vsState.limit = 8;
            loadViolationStats();
        });

        yearEl.addEventListener('change', () => {
            vsState.selectedKey = "";
            vsState.limit = 8;
            loadViolationStats();
        });

        searchEl?.addEventListener('input', (e) => {
            vsState.searchQuery = e.target.value.trim();
            vsState.limit = 8;
            renderViolationStats();
        });

        typeFilterEl?.addEventListener('change', (e) => {
            vsState.selectedKey = e.target.value;
            vsState.limit = 8;
            renderViolationStats();
        });

        resetEl?.addEventListener('click', () => {
            const d = new Date();
            monthEl.value = String(d.getMonth() + 1);
            yearEl.value = String(d.getFullYear());
            vsState.selectedKey = "";
            vsState.searchQuery = "";
            vsState.limit = 8;
            if (searchEl) searchEl.value = "";
            if (typeFilterEl) typeFilterEl.value = "";
            loadViolationStats();
        });

        moreEl?.addEventListener('click', () => {
            vsState.limit += 10;
            renderViolationStats();
        });

        vsState.initialized = true;
    }

    loadViolationStats();
}

async function loadViolationStats() {
    const month = document.getElementById('vs-month')?.value ?? "";
    const year = document.getElementById('vs-year')?.value ?? "";
    const typesEl = document.getElementById('vs-types');
    const driversEl = document.getElementById('vs-drivers');

    // Hiển thị hiệu ứng Skeleton đang tải
    if (typesEl) typesEl.innerHTML = '<div class="vstats__skeleton"></div><div class="vstats__skeleton"></div>';
    if (driversEl) driversEl.innerHTML = '<div class="vstats__skeleton"></div><div class="vstats__skeleton"></div><div class="vstats__skeleton"></div>';

    try {
        const params = new URLSearchParams();
        if (month !== "") params.set("month", month);
        if (year !== "") params.set("year", year);

        const res = await fetch(`/api/overview/violations?${params.toString()}`, {
            cache: 'no-store',
            credentials: 'same-origin'
        });

        if (!res.ok) {
            const msg = res.status === 401 || res.status === 403
                ? "Bạn cần đăng nhập bằng tài khoản Quản trị viên (Admin) để xem thống kê."
                : `Lỗi tải dữ liệu (${res.status})`;
            renderViolationError(msg);
            return;
        }

        vsState.raw = await res.json();
        populateTypeDropdown(vsState.raw.violations || []);
        renderViolationStats();
    } catch (err) {
        console.error("Lỗi fetch /api/overview/violations:", err);
        renderViolationError("Không thể kết nối máy chủ để tải thống kê vi phạm.");
    }
}

function populateTypeDropdown(violations) {
    const select = document.getElementById('vs-type-filter');
    if (!select) return;

    const current = vsState.selectedKey;
    select.innerHTML = '<option value="">Tất cả loại vi phạm</option>';

    violations.forEach(v => {
        const key = makeViolationKey(v.source, v.name);
        const tag = v.source === 'ai' ? '[AI]' : '[Biên bản]';
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `${tag} ${v.name} (-${v.points}đ)`;
        select.appendChild(opt);
    });

    select.value = current;
}

function renderViolationStats() {
    const data = vsState.raw;
    if (!data) return;

    const violations = data.violations || [];
    const allDrivers = data.drivers || [];
    const vndPerPoint = data.vndPerPoint || 0;

    // 1. Lọc danh sách tài xế theo loại vi phạm & từ khóa tên/mã
    const normalizedQuery = removeVietnameseTones(vsState.searchQuery.toLowerCase());

    const filteredDrivers = allDrivers
        .map(driver => {
            // Lọc các mục vi phạm của tài xế nếu đang chọn 1 loại vi phạm cụ thể
            const matchedItems = vsState.selectedKey
                ? (driver.items || []).filter(it => makeViolationKey(it.source, it.name) === vsState.selectedKey)
                : (driver.items || []);

            const points = matchedItems.reduce((sum, it) => sum + it.points, 0);
            const cases = matchedItems.reduce((sum, it) => sum + it.cases, 0);

            return { ...driver, items: matchedItems, points, cases };
        })
        .filter(driver => {
            if (driver.points <= 0) return false;
            if (!normalizedQuery) return true;

            const nameNorm = removeVietnameseTones((driver.name || "").toLowerCase());
            const idNorm = (driver.id || "").toLowerCase();
            return nameNorm.includes(normalizedQuery) || idNorm.includes(normalizedQuery);
        })
        .sort((a, b) => b.points - a.points || b.cases - a.cases || a.name.localeCompare(b.name, 'vi'));

    // 2. Cập nhật 4 thẻ tổng hợp (tính động theo bộ lọc hiện tại)
    const isFiltering = Boolean(vsState.selectedKey || normalizedQuery);
    const totalPoints = isFiltering
        ? filteredDrivers.reduce((s, d) => s + d.points, 0)
        : (data.totals?.points ?? 0);
    const totalCases = isFiltering
        ? filteredDrivers.reduce((s, d) => s + d.cases, 0)
        : (data.totals?.cases ?? 0);
    const totalDrivers = isFiltering
        ? filteredDrivers.length
        : (data.totals?.drivers ?? 0);
    const totalFine = isFiltering
        ? totalPoints * vndPerPoint
        : (data.totals?.fine ?? 0);

    setText('vs-total-points', `${totalPoints.toLocaleString('vi-VN')} điểm`);
    setText('vs-total-cases', `${totalCases.toLocaleString('vi-VN')} lượt`);
    setText('vs-total-drivers', `${totalDrivers.toLocaleString('vi-VN')} người`);
    setText('vs-total-fine', formatVnd(totalFine));

    // 3. Vẽ cột trái: Danh sách loại vi phạm
    renderViolationTypes(violations);

    // 4. Vẽ cột phải: Danh sách tài xế
    renderDriverList(filteredDrivers, vndPerPoint);
}

function renderViolationTypes(violations) {
    const container = document.getElementById('vs-types');
    if (!container) return;

    if (!violations.length) {
        container.innerHTML = `
            <div class="vstats__empty">
                <i class="fa-solid fa-circle-check"></i>
                <span>Không có dữ liệu vi phạm nào trong kỳ này.</span>
            </div>`;
        return;
    }

    const maxPoints = Math.max(...violations.map(v => v.points), 1);

    container.innerHTML = violations.map(v => {
        const key = makeViolationKey(v.source, v.name);
        const isActive = vsState.selectedKey === key;
        const pct = Math.max(4, Math.round((v.points / maxPoints) * 100));
        const isAi = v.source === 'ai';

        return `
            <button type="button"
                    class="vstats__type ${isActive ? 'vstats__type--active' : ''}"
                    data-vkey="${escapeHtml(key)}"
                    title="Nhấn để lọc tài xế mắc lỗi này">
                <div class="vstats__type-top">
                    <span class="vstats__type-name">
                        <span class="vstats__source ${isAi ? 'vstats__source--ai' : 'vstats__source--manual'}"
                              title="${isAi ? 'Camera AI giám sát' : 'Biên bản thủ công'}">
                            <i class="fa-solid ${isAi ? 'fa-robot' : 'fa-file-pen'}"></i>
                        </span>
                        <span>${escapeHtml(v.name)}</span>
                    </span>
                    <span class="vstats__type-points">-${v.points} điểm</span>
                </div>
                <div class="vstats__bar">
                    <div class="vstats__bar-fill" style="width: ${pct}%"></div>
                </div>
                <div class="vstats__type-meta">
                    <span>${v.cases} lượt vi phạm</span>
                    <span>${v.drivers} tài xế</span>
                </div>
            </button>`;
    }).join('');

    // Gắn sự kiện click vào từng thanh vi phạm để bật/tắt lọc
    container.querySelectorAll('.vstats__type').forEach(btn => {
        btn.addEventListener('click', () => {
            const clickedKey = btn.getAttribute('data-vkey') || "";
            vsState.selectedKey = (vsState.selectedKey === clickedKey) ? "" : clickedKey;
            vsState.limit = 8;

            const select = document.getElementById('vs-type-filter');
            if (select) select.value = vsState.selectedKey;

            renderViolationStats();
        });
    });
}

function renderDriverList(drivers, vndPerPoint) {
    const container = document.getElementById('vs-drivers');
    const countEl = document.getElementById('vs-driver-count');
    const statusEl = document.getElementById('vs-status');
    const moreEl = document.getElementById('vs-more');

    if (!container) return;

    if (countEl) {
        countEl.textContent = drivers.length ? `${drivers.length} tài xế` : '';
    }

    if (!drivers.length) {
        container.innerHTML = `
            <div class="vstats__empty">
                <i class="fa-solid fa-user-check"></i>
                <span>Không tìm thấy tài xế vi phạm phù hợp với bộ lọc.</span>
            </div>`;
        if (statusEl) statusEl.textContent = '';
        if (moreEl) moreEl.hidden = true;
        return;
    }

    const visible = drivers.slice(0, vsState.limit);

    container.innerHTML = visible.map((d, idx) => {
        const rank = idx + 1;
        const rankClass = rank <= 3 ? `vstats__rank--${rank}` : '';
        const fine = d.points * vndPerPoint;

        const chipsHtml = (d.items || []).map(it => `
            <span class="vstats__chip">
                ${escapeHtml(it.name)} (${it.cases}): <b>-${it.points}đ</b>
            </span>
        `).join('');

        return `
            <div class="vstats__driver">
                <div class="vstats__rank ${rankClass}">#${rank}</div>
                <div class="vstats__driver-info">
                    <div>
                        <span class="vstats__driver-name">${escapeHtml(d.name)}</span>
                        <span class="vstats__driver-id">${escapeHtml(d.id)}</span>
                    </div>
                    <div class="vstats__chips">${chipsHtml}</div>
                </div>
                <div class="vstats__driver-score">
                    <span class="vstats__driver-points">-${d.points} điểm</span>
                    <span class="vstats__driver-fine">${formatVnd(fine)}</span>
                </div>
            </div>`;
    }).join('');

    if (statusEl) {
        statusEl.textContent = `Hiển thị ${visible.length} / ${drivers.length} tài xế`;
    }

    if (moreEl) {
        moreEl.hidden = visible.length >= drivers.length;
    }
}

function renderViolationError(message) {
    const typesEl = document.getElementById('vs-types');
    const driversEl = document.getElementById('vs-drivers');
    const html = `
        <div class="vstats__empty vstats__empty--error">
            <i class="fa-solid fa-circle-exclamation"></i>
            <span>${escapeHtml(message)}</span>
        </div>`;
    if (typesEl) typesEl.innerHTML = html;
    if (driversEl) driversEl.innerHTML = html;
}

// ============================================================================
// HÀM TIỆN ÍCH
// ============================================================================
function makeViolationKey(source, name) {
    return `${source}::${(name || "").trim().toLowerCase()}`;
}

function formatVnd(amount) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND'
    }).format(amount || 0);
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function removeVietnameseTones(str) {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D');
}