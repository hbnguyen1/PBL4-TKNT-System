"use strict";

(() => {
    const API_URL = "/api/driver/me/demerits";

    function byId(id) {
        return document.getElementById(id);
    }

    function setText(id, value) {
        const element = byId(id);
        if (element) {
            element.textContent = value;
        }
    }

    function showMessage(message, isError = false) {
        const element = byId("demeritsMessage");
        if (!element) return;

        element.textContent = message;
        element.style.color = isError ? "#dc2626" : "#64748b";
    }

    function formatDate(value) {
        if (!value) return "---";

        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return "---";
        }

        return date.toLocaleDateString("vi-VN");
    }

    function initializeYears() {
        const yearSelect = byId("demeritYear");
        if (!yearSelect) return;

        const currentYear = new Date().getFullYear();

        yearSelect.innerHTML =
            '<option value="">Tất cả các năm</option>';

        for (
            let year = currentYear;
            year >= currentYear - 10;
            year--
        ) {
            const option = document.createElement("option");
            option.value = String(year);
            option.textContent = `Năm ${year}`;
            yearSelect.appendChild(option);
        }
    }

    function resetSummary() {
        setText("totalViolations", "0");
        setText("totalDemeritPoints", "0");
        setText("latestViolationDate", "---");
        setText("demeritRecordCount", "0 bản ghi");
    }

    function showEmpty(message) {
        const tbody = byId("demeritsTableBody");
        if (!tbody) return;

        tbody.replaceChildren();

        const row = document.createElement("tr");
        const cell = document.createElement("td");

        cell.colSpan = 6;
        cell.className = "driver-demerits-empty";
        cell.textContent = message;

        row.appendChild(cell);
        tbody.appendChild(row);
    }

    function getStatusText(status) {
        switch (String(status || "").toLowerCase()) {
            case "confirmed":
                return "Đã xác nhận";
            case "pending":
                return "Đang xử lý";
            case "rejected":
                return "Đã hủy";
            default:
                return "Chưa có thông tin";
        }
    }

    function createCell(row, text, className = "") {
        const cell = document.createElement("td");
        cell.textContent = text ?? "---";

        if (className) {
            cell.className = className;
        }

        row.appendChild(cell);
    }

    function displayRecords(records) {
        const tbody = byId("demeritsTableBody");
        if (!tbody) return;

        tbody.replaceChildren();

        if (!records.length) {
            resetSummary();
            showEmpty("Không có dữ liệu vi phạm phù hợp.");
            return;
        }

        let totalPoints = 0;
        let latestDate = null;

        for (const record of records) {
            const points = Number(record.pointsDeducted) || 0;
            totalPoints += points;

            const date = new Date(record.violatedAt);

            if (!Number.isNaN(date.getTime())) {
                if (!latestDate || date > latestDate) {
                    latestDate = date;
                }
            }

            const row = document.createElement("tr");

            createCell(row, formatDate(record.violatedAt));
            createCell(row, record.violation || "---");
            createCell(row, record.licensePlate || "---");
            createCell(row, String(points), "text-center");
            createCell(row, getStatusText(record.status));
            createCell(row, record.note || "---");

            tbody.appendChild(row);
        }

        setText("totalViolations", String(records.length));
        setText("totalDemeritPoints", String(totalPoints));

        setText(
            "latestViolationDate",
            latestDate
                ? latestDate.toLocaleDateString("vi-VN")
                : "---"
        );

        setText(
            "demeritRecordCount",
            `${records.length} bản ghi`
        );
    }

    async function loadDemerits() {
        const month = byId("demeritMonth").value;
        const year = byId("demeritYear").value;
        const status = byId("demeritStatus").value;

        const params = new URLSearchParams();

        if (month) params.set("month", month);
        if (year) params.set("year", year);

        const url = params.toString()
            ? `${API_URL}?${params}`
            : API_URL;

        const button = byId("filterDemeritsButton");
        button.disabled = true;

        showMessage("Đang tải lịch sử điểm trừ...");

        try {
            const response = await fetch(url, {
                method: "GET",
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json"
                },
                cache: "no-store"
            });

            if (response.status === 401) {
                throw new Error(
                    "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."
                );
            }

            if (response.status === 403) {
                throw new Error(
                    "Bạn không có quyền xem dữ liệu này."
                );
            }

            if (!response.ok) {
                throw new Error(
                    `Không thể tải dữ liệu. Mã lỗi: ${response.status}`
                );
            }

            const data = await response.json();

            if (!Array.isArray(data)) {
                throw new Error("Dữ liệu API không đúng định dạng.");
            }

            // Chỉ lọc trạng thái nếu API thực sự có trường status.
            let records = data;

            if (status) {
                const hasStatus = data.some(
                    item => item.status != null
                );

                if (hasStatus) {
                    records = data.filter(
                        item => String(item.status).toLowerCase()
                            === status
                    );
                } else {
                    resetSummary();
                    showEmpty(
                        "Chưa có dữ liệu trạng thái để lọc."
                    );
                    showMessage(
                        "API hiện chưa cung cấp trạng thái vi phạm."
                    );
                    return;
                }
            }

            displayRecords(records);
            showMessage("");

        } catch (error) {
            console.error("Lỗi tải điểm trừ:", error);

            resetSummary();
            showEmpty("Không thể tải dữ liệu điểm trừ.");
            showMessage(error.message, true);

        } finally {
            button.disabled = false;
        }
    }

    function initializePage() {
        if (!byId("demeritsTableBody")) return;

        initializeYears();

        byId("filterDemeritsButton")
            .addEventListener("click", loadDemerits);

        loadDemerits();
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initializePage
        );
    } else {
        initializePage();
    }
})();
