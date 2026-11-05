document.addEventListener("DOMContentLoaded", loadOverview);

function setText(id, value) {
    const element = document.getElementById(id);

    if (element) {
        element.textContent = value;
    }
}

function formatMoney(value) {
    if (value === null || value === undefined) {
        return "—";
    }

    return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0
    }).format(value);
}

async function loadOverview() {
    try {
        const response = await fetch(
            "/api/driver/me/overview",
            {
                method: "GET",
                credentials: "same-origin",
                cache: "no-store"
            }
        );

        if (response.status === 401 ||
            response.status === 403) {

            window.top.location.replace(
                "/login/Login.html"
            );
            return;
        }

        if (!response.ok) {
            throw new Error(
                "Không thể tải dữ liệu. HTTP " +
                response.status
            );
        }

        const data = await response.json();

        // Tên tài xế
        setText(
            "driver-name",
            data.fullName || "Tài xế"
        );

        // Số chuyến
        setText(
            "weekly-trips",
            data.weeklyTrips ?? "—"
        );

        // Số giờ
        setText(
            "operating-hours",
            data.operatingHours ?? "—"
        );

        // Điểm vi phạm
        const points = Number(data.totalDemerits ?? 0);

        setText("total-demerits", points);

        setText(
            "demerits-status",
            points === 0
                ? "Chưa ghi nhận điểm trừ"
                : `Đã ghi nhận ${points} điểm trừ`
        );

        // Lương tháng
        setText(
            "current-salary",
            formatMoney(data.salary)
        );

        setText(
            "salary-status",
            data.salary === null
                ? "Chưa có bảng lương tháng này"
                : "Kỳ lương tháng này"
        );

        // Xe được phân công
        const vehicles = Array.isArray(data.vehicles)
            ? data.vehicles
            : [];

        if (vehicles.length > 0) {
            const vehicle = vehicles[0];

            setText(
                "assigned-vehicle",
                `${vehicle.vehicleName} (Biển số: ${vehicle.licensePlate})`
            );

            setText(
                "current-route",
                vehicle.route || "Chưa có tuyến"
            );

            setText(
                "work-status",
                "Đã phân công xe"
            );

            if (vehicles.length > 1) {
                setText(
                    "assigned-vehicle",
                    `${vehicle.vehicleName} (${vehicle.licensePlate}) và ${vehicles.length - 1} xe khác`
                );
            }
        } else {
            setText(
                "assigned-vehicle",
                "Chưa được phân công"
            );

            setText(
                "current-route",
                "Chưa có tuyến"
            );

            setText(
                "work-status",
                "Chưa phân công"
            );
        }

        // Chưa có dữ liệu ca làm và IoT
        setText(
            "departure-time",
            "Chưa có dữ liệu lịch trình"
        );

        setText(
            "system-status",
            "Chưa kết nối dữ liệu giám sát trực tuyến"
        );

    } catch (error) {
        console.error("Lỗi tải Tổng quan:", error);

        setText(
            "driver-name",
            "Không tải được thông tin"
        );

        setText(
            "work-status",
            "Lỗi tải dữ liệu"
        );

        setText(
            "system-status",
            "Không thể kết nối API. Vui lòng thử lại."
        );
    }
}
