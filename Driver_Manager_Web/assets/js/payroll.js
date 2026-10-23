
document.addEventListener("DOMContentLoaded", () => {
    const API = "/api/payroll";

    const searchInput = document.getElementById("payrollSearch");
    const monthSelect = document.getElementById("payrollMonth");
    const yearInput = document.getElementById("payrollYear");
    const calculateButton = document.getElementById("calculatePayroll");
    const tableBody = document.getElementById("payrollTableBody");

    let searchTimer;
    let activeController = null;

    function formatMoney(value) {
        return new Intl.NumberFormat("vi-VN", {
            style: "currency",
            currency: "VND",
            maximumFractionDigits: 0
        }).format(Number(value ?? 0));
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    function getPeriod() {
        const month = Number(monthSelect.value);
        const year = Number(yearInput.value);

        if (
            !Number.isInteger(month) || month < 1 || month > 12 ||
            !Number.isInteger(year) || year < 2000 || year > 2100
        ) {
            throw new Error("Vui lòng chọn tháng và năm hợp lệ.");
        }

        return { month, year };
    }

    async function apiRequest(url, options = {}) {
        const response = await fetch(url, {
            ...options,
            headers: {
                Accept: "application/json",
                ...(options.body
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...options.headers
            }
        });

        const text = await response.text();
        let data = {};

        if (text) {
            try {
                data = JSON.parse(text);
            } catch {
                throw new Error("API không trả về JSON hợp lệ.");
            }
        }

        if (!response.ok) {
            throw new Error(
                data.detail || data.message || data.title ||
                `Lỗi HTTP ${response.status}`
            );
        }

        return data;
    }

    function showMessage(message) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="data-table__td"
                    style="text-align:center;padding:24px">
                    ${escapeHtml(message)}
                </td>
            </tr>
        `;
    }

    function isPaid(status) {
        return [
            "đã thanh toán",
            "paid",
            "completed"
        ].includes(
            String(status ?? "").trim().toLocaleLowerCase("vi")
        );
    }

    function renderStatus(item) {
        if (isPaid(item.status)) {
            return `
                <span class="badge badge--success">
                    <i class="fa-solid fa-check"></i>
                    Đã thanh toán
                </span>
            `;
        }

        return `
            <span class="badge badge--warning">
                <i class="fa-solid fa-clock"></i>
                Chưa thanh toán
            </span>
            <div style="margin-top:8px">
                <button type="button"
                    class="btn btn--primary payroll-pay-btn"
                    data-driver-id="${escapeHtml(item.driverId)}">
                    Thanh toán
                </button>
            </div>
        `;
    }

    function renderRow(item) {
        const baseSalary = Number(item.baseSalary ?? 0);
        const routeAllowance = Number(item.routeAllowance ?? 0);
        const shiftBonus = Number(item.shiftBonus ?? 0);
        const deduction = Number(item.deduction ?? 0);
        const netSalary = Number(item.netSalary ?? 0);

        if (
            ![
                baseSalary, routeAllowance, shiftBonus,
                deduction, netSalary
            ].every(Number.isFinite)
        ) {
            throw new Error("Dữ liệu lương trả về không hợp lệ.");
        }

        const driverId = item.driverId ?? "";
        const driverName = item.driverName || driverId;

        return `
            <tr>
                <td class="data-table__td">
                    <a
                        href="/driver-detail.html?id=${encodeURIComponent(driverId)}"
                        class="payroll-table__driver-link">
                        ${escapeHtml(driverName)}
                    </a>
                    <span class="payroll-table__driver-id">
                        ${escapeHtml(driverId)}
                    </span>
                </td>

                <td class="data-table__td payroll-table__currency">
                    ${formatMoney(baseSalary)}
                </td>
                <td class="data-table__td payroll-table__currency">
                    ${formatMoney(routeAllowance)}
                </td>
                <td class="data-table__td payroll-table__currency payroll-table__currency--bonus">
                    +${formatMoney(shiftBonus)}
                </td>
                <td class="data-table__td payroll-table__currency payroll-table__currency--deduct">
                    -${formatMoney(deduction)}
                </td>
                <td class="data-table__td payroll-table__net">
                    ${formatMoney(netSalary)}
                </td>
                <td class="data-table__td" style="text-align:center">
                    ${renderStatus(item)}
                </td>
            </tr>
        `;
    }

    // Đọc bảng lương thật từ PayrollController
    async function loadPayroll() {
        let period;

        try {
            period = getPeriod();
        } catch (error) {
            showMessage(error.message);
            return;
        }

        if (activeController) activeController.abort();

        const controller = new AbortController();
        activeController = controller;

        const params = new URLSearchParams({
            month: String(period.month),
            year: String(period.year),
            search: searchInput.value.trim()
        });

        showMessage("Đang tải bảng lương từ cơ sở dữ liệu...");

        try {
            const rows = await apiRequest(
                `${API}?${params.toString()}`,
                { signal: controller.signal }
            );

            if (activeController !== controller) return;

            if (!Array.isArray(rows)) {
                throw new Error("API không trả về danh sách bảng lương.");
            }

            if (rows.length === 0) {
                showMessage(
                    "Kỳ này chưa có cấu trúc lương. " +
                    "Hãy chọn kỳ khác hoặc kiểm tra SalaryStructures."
                );
                return;
            }

            tableBody.innerHTML = rows.map(renderRow).join("");
        } catch (error) {
            if (error.name === "AbortError") return;
            if (activeController !== controller) return;

            console.error("Lỗi tải bảng lương:", error);
            showMessage(`Không thể tải bảng lương: ${error.message}`);
        } finally {
            if (activeController === controller) {
                activeController = null;
            }
        }
    }

    // Tạo nhật ký chờ thanh toán cho kỳ được chọn
    calculateButton.addEventListener("click", async () => {
        let period;

        try {
            period = getPeriod();
        } catch (error) {
            alert(error.message);
            return;
        }

        const previousContent = calculateButton.innerHTML;
        calculateButton.disabled = true;

        try {
            calculateButton.innerHTML = `
                <i class="fa-solid fa-spinner fa-spin"></i>
                <span>Đang tính lương...</span>
            `;

            const result = await apiRequest(`${API}/calculate`, {
                method: "POST",
                body: JSON.stringify(period)
            });

            alert(result.message || "Đã xử lý kỳ lương.");
            await loadPayroll();
        } catch (error) {
            console.error("Lỗi tính lương:", error);
            alert(`Không thể tính lương: ${error.message}`);
        } finally {
            calculateButton.disabled = false;
            calculateButton.innerHTML = previousContent;
        }
    });

    // Đánh dấu một tài xế đã thanh toán
    tableBody.addEventListener("click", async event => {
        const button = event.target.closest(".payroll-pay-btn");
        if (!button) return;

        let period;

        try {
            period = getPeriod();
        } catch (error) {
            alert(error.message);
            return;
        }

        const driverId = button.dataset.driverId;

        if (!confirm(
            `Xác nhận thanh toán lương cho ${driverId} ` +
            `kỳ ${period.month}/${period.year}?`
        )) {
            return;
        }

        button.disabled = true;

        try {
            const result = await apiRequest(`${API}/pay`, {
                method: "POST",
                body: JSON.stringify({
                    driverId,
                    month: period.month,
                    year: period.year
                })
            });

            alert(result.message || "Đã cập nhật thanh toán.");
            await loadPayroll();
        } catch (error) {
            console.error("Lỗi thanh toán:", error);
            alert(`Không thể thanh toán: ${error.message}`);
            button.disabled = false;
        }
    });

    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadPayroll, 300);
    });

    monthSelect.addEventListener("change", loadPayroll);
    yearInput.addEventListener("change", loadPayroll);

    loadPayroll();
});
