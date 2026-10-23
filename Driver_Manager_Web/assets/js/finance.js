document.addEventListener("DOMContentLoaded", () => {
    const API = "/Finance";
    let financeChart = null;
    let activeController = null;

    const el = id => document.getElementById(id);

    function money(value) {
        return new Intl.NumberFormat("vi-VN", {
            style: "currency",
            currency: "VND",
            maximumFractionDigits: 0
        }).format(Number(value ?? 0));
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, c => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[c]);
    }

    async function getJson(url, signal) {
        const response = await fetch(url, { signal });
        const text = await response.text();
        let result = {};

        if (text) {
            try {
                result = JSON.parse(text);
            } catch {
                throw new Error("API không trả về JSON hợp lệ.");
            }
        }

        if (!response.ok) {
            throw new Error(
                result.message ||
                result.detail ||
                result.title ||
                `HTTP ${response.status}`
            );
        }

        if (result.success === false) {
            throw new Error(result.message || "Tải dữ liệu thất bại.");
        }

        return result.data ?? result;
    }

    function showMessage(message) {
        el("tableBody").innerHTML = `
            <tr>
                <td colspan="9"
                    style="text-align:center;padding:2rem;color:#dc2626">
                    ${escapeHtml(message)}
                </td>
            </tr>`;
    }

    function onViewTypeChange() {
        const type = el("viewTypeSelect").value;
        const periodSelect = el("periodSelect");

        el("periodWrapper").style.display =
            type === "year" ? "none" : "flex";
        el("yearWrapper").style.display = "flex";

        periodSelect.innerHTML = "";

        if (type === "month") {
            el("periodLabel").textContent = "Tháng:";

            for (let month = 1; month <= 12; month++) {
                const option = new Option(
                    `Tháng ${String(month).padStart(2, "0")}`,
                    month
                );
                if (month === 9) option.selected = true;
                periodSelect.add(option);
            }
        }
        applyFilter();
    }

    async function applyFilter() {
        const type = el("viewTypeSelect").value;
        const year = Number(el("yearInput").value);
        const period = Number(el("periodSelect").value || 1);

        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            showMessage("Vui lòng nhập năm từ 2000 đến 2100.");
            return;
        }

        if (activeController) activeController.abort();

        const controller = new AbortController();
        activeController = controller;

        const params = new URLSearchParams({
            type,
            year: String(year),
            period: String(period)
        });

        [
            "statTotalPay",
            "statBaseSalary",
            "statBonus",
            "statPenalty",
            "statPenaltyRatio"
        ].forEach(id => {
            el(id).textContent = "Đang tải...";
        });

        try {
            // Đúng route Report trong FinanceController.cs
            const data = await getJson(
                `${API}/Report?${params}`,
                controller.signal
            );

            if (activeController !== controller) return;

            const report = data;

            const base = Number(report.baseSalary || 0);
            const allowance = Number(report.allowance || 0);
            const bonus = Number(report.bonus || 0);
            const penalty = Number(report.penalty || 0);
            const totalPaid = Number(report.totalPaid || 0);

            const gross = base + allowance + bonus;
            const penaltyRate = gross > 0
                ? penalty / gross * 100
                : 0;

            el("statTotalPay").textContent = money(totalPaid);
            el("statBaseSalary").textContent = money(base);
            el("statBonus").textContent = money(allowance + bonus);
            el("statPenalty").textContent = "-" + money(penalty);
            el("statPenaltyRatio").textContent =
                `Tỷ lệ phạt: ${penaltyRate.toFixed(2)}%`;

            el("chartSubTitle").textContent =
                `Dữ liệu thực tế từ XAMPP: ${getPeriodName(type, period, year)}`;

            renderTable({
                name: getPeriodName(type, period, year),
                driverCount: report.driverCount,
                base,
                allowance,
                bonus,
                penalty,
                totalPaid,
                paidRecords: report.paidRecords,
                unpaidRecords: report.unpaidRecords
            });

            // Lấy biểu đồ tháng trong năm rồi lọc khoảng đang xem
            const chartData = await getJson(
                `${API}/ChartYear?year=${year}`,
                controller.signal
            );

            if (activeController !== controller) return;

            let months = chartData.months || [];

            if (type === "month") {
                months = months.filter(item => Number(item.month) === period);
            } 
            renderChart(months);

        } catch (error) {
            if (error.name === "AbortError") return;
            if (activeController !== controller) return;

            console.error("Lỗi tải tài chính:", error);

            [
                "statTotalPay",
                "statBaseSalary",
                "statBonus",
                "statPenalty"
            ].forEach(id => {
                el(id).textContent = "Lỗi tải dữ liệu";
            });

            el("statPenaltyRatio").textContent = error.message;
            el("chartSubTitle").textContent = "Không tải được dữ liệu";

            showMessage(error.message);
            showNoChart();
        } finally {
            if (activeController === controller) {
                activeController = null;
            }
        }
    }

    function getPeriodName(type, period, year) {
        if (type === "month") {
            return `Tháng ${String(period).padStart(2, "0")}/${year}`;
        }

        return `Năm ${year}`;
    }

    function renderTable(data) {
        el("tableBody").innerHTML = `
            <tr>
                <td class="data-table__td"
                    style="font-weight:700;color:var(--color-primary)">
                    ${escapeHtml(data.name)}
                </td>
                <td class="data-table__td" style="text-align:center">
                    ${Number(data.driverCount || 0).toLocaleString("vi-VN")} tài xế
                </td>
                <td class="data-table__td" style="text-align:center">
                    Chưa có dữ liệu
                </td>
                <td class="data-table__td" style="text-align:right">
                    ${money(data.base)}
                </td>
                <td class="data-table__td" style="text-align:right">
                    ${money(data.allowance)}
                </td>
                <td class="data-table__td"
                    style="text-align:right;color:var(--color-success)">
                    +${money(data.bonus)}
                </td>
                <td class="data-table__td"
                    style="text-align:right;color:var(--color-danger)">
                    -${money(data.penalty)}
                </td>
                <td class="data-table__td data-table__td--highlight"
                    style="text-align:right">
                    ${money(data.totalPaid)}
                </td>
                <td class="data-table__td" style="text-align:center">
                    <span class="badge badge--success">
                        Đã thanh toán: ${data.paidRecords}
                    </span>
                    <br>
                    <span class="badge badge--warning">
                        Chưa thanh toán: ${data.unpaidRecords}
                    </span>
                </td>
            </tr>`;
    }

    function renderChart(months) {
        const labels = months.map(item =>
            `Tháng ${String(item.month).padStart(2, "0")}`
        );

        const income = months.map(item =>
            Number(item.totalPaid || 0) / 1_000_000
        );

        const penalty = months.map(item =>
            Number(item.totalPenalty || 0) / 1_000_000
        );

        if (income.every(value => value === 0) &&
            penalty.every(value => value === 0)) {
            showNoChart();
            return;
        }

        el("chartNoData").classList.add(
            "finance-chart-card__no-data--hidden"
        );

        if (financeChart) financeChart.destroy();

        financeChart = new Chart(
            el("financeBarChart").getContext("2d"),
            {
                type: "bar",
                data: {
                    labels,
                    datasets: [
                        {
                            label: "Lương đã thanh toán (triệu ₫)",
                            data: income,
                            backgroundColor: "#2563eb",
                            borderRadius: 6
                        },
                        {
                            label: "Khấu trừ phạt (triệu ₫)",
                            data: penalty,
                            backgroundColor: "#f43f5e",
                            borderRadius: 6
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: "top" }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: value => `${value} Tr`
                            }
                        },
                        x: { grid: { display: false } }
                    }
                }
            }
        );
    }

    function showNoChart() {
        if (financeChart) {
            financeChart.destroy();
            financeChart = null;
        }

        el("chartNoData").classList.remove(
            "finance-chart-card__no-data--hidden"
        );
    }

    // Giữ các hàm có tên được gọi từ thuộc tính onchange trong HTML
    window.onViewTypeChange = onViewTypeChange;
    window.applyFilter = applyFilter;

    onViewTypeChange();
});
