"use strict";

(() => {
    const API_URL = "/api/driver/me/payroll";

    const monthSelect = document.getElementById("payrollMonth");
    const yearSelect = document.getElementById("payrollYear");
    const filterButton = document.getElementById("filterPayrollButton");

    // Định dạng tiền Việt Nam
    const moneyFormatter = new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0
    });

    function formatMoney(value) {
        const number = Number(value);
        return Number.isFinite(number)
            ? moneyFormatter.format(number)
            : "---";
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
        }
    }

    function showMessage(message, isError = false) {
        const element = document.getElementById("payrollMessage");
        if (!element) return;

        element.textContent = message;
        element.style.color = isError ? "#dc2626" : "#64748b";
    }

    // Tạo danh sách năm

function initializeYears() {
    const now = new Date();

    monthSelect.value = String(now.getMonth() + 1);
    yearSelect.value = String(now.getFullYear());
}


    // Xóa dữ liệu khi chưa có bảng lương
    function resetPayroll() {
        const fields = [
            "baseSalary",
            "allowance",
            "bonus",
            "penalty",
            "totalPaid",
            "detailBaseSalary",
            "detailAllowance",
            "detailBonus",
            "detailPenalty",
            "detailTotalPaid"
        ];

        fields.forEach(id => setText(id, "---"));

        setText("paymentDate", "Ngày thanh toán: ---");
        setText("paymentNote", "Ghi chú: ---");

        const status = document.getElementById("paymentStatus");

        if (status) {
            const badge = status.querySelector(
                ".driver-payroll-payment__badge"
            );

            if (badge) {
                badge.textContent = "Chưa có thông tin thanh toán";
            }
        }
    }

    // Hiển thị trạng thái thanh toán
    function displayPayment(data) {
        const status = document.getElementById("paymentStatus");

        if (status) {
            const badge = status.querySelector(
                ".driver-payroll-payment__badge"
            );

            if (badge) {
                badge.textContent =
                    data.paymentStatus || "Chưa thanh toán";
            }
        }

        let paymentDate = "---";

        if (data.paymentTime) {
            const date = new Date(data.paymentTime);

            if (!Number.isNaN(date.getTime())) {
                paymentDate = date.toLocaleDateString("vi-VN");
            }
        }

        setText(
            "paymentDate",
            `Ngày thanh toán: ${paymentDate}`
        );

        setText(
            "paymentNote",
            `Ghi chú: ${data.note || "---"}`
        );
    }

    // Hiển thị bảng lương
    function displayPayroll(data) {
        const baseSalary = formatMoney(data.baseSalary);
        const allowance = formatMoney(data.allowance);
        const bonus = formatMoney(data.bonus);
        const penalty = formatMoney(data.penalty);
        const netSalary = formatMoney(data.netSalary);

        // 4 thẻ tổng quan
        setText("baseSalary", baseSalary);
        setText("allowance", allowance);
        setText("bonus", bonus);
        setText("penalty", penalty);

        // Tổng lương thực nhận
        setText("totalPaid", netSalary);

        setText(
            "payrollPeriod",
            `Kỳ lương: Tháng ${data.month}/${data.year}`
        );

        // Bảng chi tiết
        setText("detailBaseSalary", baseSalary);
        setText("detailAllowance", allowance);
        setText("detailBonus", bonus);
        setText("detailPenalty", penalty);
        setText("detailTotalPaid", netSalary);

        // Trạng thái thanh toán
        displayPayment(data);

        showMessage("");
    }

    // Lấy bảng lương từ MySQL qua API
    async function loadPayroll() {
        const month = Number(monthSelect.value);
        const year = Number(yearSelect.value);

        if (!Number.isInteger(month) ||
            month < 1 || month > 12 ||
            !Number.isInteger(year) ||
            year < 1) {
            showMessage("Vui lòng chọn tháng và năm hợp lệ.", true);
            return;
        }

        resetPayroll();

        setText(
            "payrollPeriod",
            `Kỳ lương: Tháng ${month}/${year}`
        );

        showMessage("Đang tải thông tin bảng lương...");

        filterButton.disabled = true;

        try {
            const url =
                `${API_URL}?month=${month}&year=${year}`;

            const response = await fetch(url, {
                method: "GET",
                credentials: "same-origin",
                headers: {
                    "Accept": "application/json"
                },
                cache: "no-store"
            });

            if (response.status === 401) {
                showMessage(
                    "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
                    true
                );
                return;
            }

            if (response.status === 403) {
                showMessage(
                    "Bạn không có quyền xem bảng lương này.",
                    true
                );
                return;
            }

            if (response.status === 404) {
                showMessage(
                    `Chưa có bảng lương tháng ${month}/${year}.`
                );
                return;
            }

            if (!response.ok) {
                throw new Error(
                    `Không thể tải bảng lương. Mã lỗi: ${response.status}`
                );
            }

            const data = await response.json();

            displayPayroll(data);

        } catch (error) {
            console.error("Lỗi tải bảng lương:", error);

            showMessage(
                error.message || "Không thể kết nối máy chủ.",
                true
            );
        } finally {
            filterButton.disabled = false;
        }
    }

    // Khởi tạo trang
    function initializePayrollPage() {
    initializeYears();

    filterButton.addEventListener("click", loadPayroll);

    loadPayroll();
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializePayrollPage
    );
} else {
    initializePayrollPage();
}
})();
