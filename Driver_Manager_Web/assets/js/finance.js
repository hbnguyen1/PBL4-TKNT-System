
document.addEventListener("DOMContentLoaded", () => {
    const API = "/api/finance";

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

    async function apiRequest(url, signal) {
        const response = await fetch(url, {
            signal,
            headers: { Accept: "application/json" }
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

    // Tạo danh sách tháng hoặc quý khi đổi loại kỳ
    function onViewTypeChange() {
        const type = el("viewTypeSelect").value;
        const periodWrapper = el("periodWrapper");
        const periodLabel = el("periodLabel");
        const periodSelect = el("periodSelect");
        const yearWrapper = el("yearWrapper");

        periodSelect.innerHTML = "";

        if (type === "month") {
            periodWrapper.style.display = "flex";
            yearWrapper.style.display = "flex";
            periodLabel.textContent = "Tháng:";

            for (let m = 1; m <= 12; m++) {
                const option = new Option(
                    `Tháng ${String(m).padStart(2, "0")}`,
                    String(m)
                );

                if (m === 9) option.selected = true;
                periodSelect.add(option);
            }
        } else if (type === "quarter") {
            periodWrapper.style.display = "flex";
            yearWrapper.style.display = "flex";
            periodLabel.textContent = "Quý:";

            for (let q = 1; q <= 4; q++) {
                const option = new Option(`Quý ${q}`, String(q));
                if (q === 3) option.selected = true;
                periodSelect.add(option);
            }
        } else {
            periodWrapper.style.display = "none";
            yearWrapper.style.display = "flex";
        }

        applyFilter();
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

    function renderChart(labels, income, penalty) {
        const canvas = el("financeBarChart");

        el("chartNoData").classList.add(
            "finance-chart-card__no-data--hidden"
        );

        if (financeChart) financeChart.destroy();

        financeChart = new Chart(canvas.getContext("2d"), {
            type: "bar",
            data: {
                labels,
                datasets: [
                    {
                        label: "Lương ròng theo cấu trúc (triệu ₫)",
                        data: income,
                        backgroundColor: "#2563eb",
                        borderRadius: 6,
                        barPercentage: 0.6,
                        categoryPercentage: 0.6
                    },
                    {
                        label: "Khấu trừ phạt (triệu ₫)",
                        data: penalty,
                        backgroundColor: "#f43f5e",
                        borderRadius: 6,
                        barPercentage: 0.6,
                        categoryPercentage: 0.6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: "top" },
                    tooltip: {
                        callbacks: {
                            label(context) {
                                return context.dataset.label + ": " +
                                    Number(context.parsed.y).toLocaleString("vi-VN") +
                                    " triệu ₫";
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { callback: value => value + " Tr" }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }

    function renderTable(data) {
        const hasRecords = Number(data.drivers) > 0;

        if (!hasRecords) {
            el("tableBody").innerHTML = `
                <tr>
                    <td colspan="9"
                        style="text-align:center;padding:2rem;color:#94a3b8">
                        Chưa có dữ liệu lương trong kỳ này.
                    </td>
                </tr>
            `;
            return;
        }

        el("tableBody").innerHTML = `
            <tr>
                <td class="data-table__td"
                    style="font-weight:700;color:var(--color-primary)">
                    ${escapeHtml(data.periodName)}
                </td>
                <td class="data-table__td" style="text-align:center">
                    ${Number(data.drivers).toLocaleString("vi-VN")} tài xế
                </td>
                <td class="data-table__td" style="text-align:center">
                    ${data.trips == null ? "Chưa có dữ liệu" : escapeHtml(data.trips)}
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
                    ${money(data.total)}
                </td>
                <td class="data-table__td" style="text-align:center">
                    <span class="badge badge--success">
                        ${escapeHtml(data.penaltyRate)}
                    </span>
                </td>
            </tr>
        `;
    }

    // Tải thống kê từ XAMPP thông qua FinanceController
    async function applyFilter() {
        const type = el("viewTypeSelect").value;
        const year = Number(el("yearInput").value);
        const period = Number(el("periodSelect").value || 1);

        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            showMessage("Vui lòng nhập năm hợp lệ.");
            return;
        }

        if (activeController) activeController.abort();

        const controller = new AbortController();
        activeController = controller;

        const params = new URLSearchParams({
            type,
            period: String(period),
            year: String(year)
        });

        el("statTotalPay").textContent = "Đang tải...";
        el("statBaseSalary").textContent = "Đang tải...";
        el("statBonus").textContent = "Đang tải...";
        el("statPenalty").textContent = "Đang tải...";
        el("statPenaltyRatio").textContent = "Đang tải...";

        try {
            const data = await apiRequest(
                `${API}?${params.toString()}`,
                controller.signal
            );

            if (activeController !== controller) return;

            el("statTotalPay").textContent = money(data.totalPaid);
            el("statBaseSalary").textContent = money(data.base);
            el("statBonus").textContent = money(
                Number(data.allowance || 0) + Number(data.bonus || 0)
            );
            el("statPenalty").textContent = "-" + money(data.penalty);
            el("statPenaltyRatio").textContent =
                `Tỷ lệ: ${data.penaltyRate}`;

            el("chartSubTitle").textContent =
                `Dữ liệu từ XAMPP: ${data.periodName}`;

            renderTable(data);

            const income = data.chartLabels.some(
                (_, i) => Number(data.incomeData[i] || 0) !== 0
            );

            if (income) {
                renderChart(
                    data.chartLabels,
                    data.incomeData,
                    data.penaltyData
                );
            } else {
                showNoChart();
            }
        } catch (error) {
            if (error.name === "AbortError") return;
            if (activeController !== controller) return;

            console.error("Lỗi tải tài chính:", error);
            showMessage(`Không thể tải dữ liệu: ${error.message}`);
            showNoChart();
        } finally {
            if (activeController === controller) {
                activeController = null;
            }
        }
    }

    function showMessage(message) {
        el("tableBody").innerHTML = `
            <tr>
                <td colspan="9" style="text-align:center;padding:2rem">
                    ${escapeHtml(message)}
                </td>
            </tr>
        `;
    }

    // Giữ tương thích với onchange trong HTML tài chính hiện tại
    window.onViewTypeChange = onViewTypeChange;
    window.applyFilter = applyFilter;

    onViewTypeChange();
});
