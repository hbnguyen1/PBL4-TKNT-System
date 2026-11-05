"use strict";

(() => {
    const API_URL = "/api/driver/me/vehicle";

    function setText(id, value, fallback = "---") {
        const element = document.getElementById(id);
        if (!element) return;

        const text = value == null
            ? ""
            : String(value).trim();

        element.textContent = text || fallback;
    }

    function showMessage(message, isError = false) {
        const element = document.getElementById("vehicleMessage");
        if (!element) return;

        element.textContent = message;
        element.style.color = isError ? "#dc2626" : "#64748b";
    }

    function resetVehicle() {
        setText("vehicleName", "Chưa được phân công xe");
        setText("licensePlate", "---");
        setText("vehicleStatus", "Chưa được phân công");

        setText("vehicleNameDetail", "---");
        setText("vehiclePlateDetail", "---");
        setText("vehicleRoute", "---");

        setText("driverId", "---");
        setText("driverName", "---");
        setText("driverPhone", "---");
        setText("assignmentStatus", "Chưa phân công");

        setText("deviceInfo", "---");
        setText("deviceStatus", "Chưa có dữ liệu");
    }

    function displayVehicle(data) {
        setText("vehicleName", data.vehicleName);
        setText("licensePlate", data.licensePlate);

        setText(
            "vehicleStatus",
            data.vehicleStatus,
            "Chưa có dữ liệu trạng thái"
        );

        setText("vehicleNameDetail", data.vehicleName);
        setText("vehiclePlateDetail", data.licensePlate);
        setText("vehicleRoute", data.route);

        setText("driverId", data.driverId);
        setText("driverName", data.driverName);
        setText("driverPhone", data.driverPhone);

        setText(
            "assignmentStatus",
            data.assignmentStatus,
            "Đã phân công xe"
        );

        setText("deviceInfo", data.deviceInfo);

        setText(
            "deviceStatus",
            data.deviceStatus,
            "Chưa có dữ liệu kết nối"
        );

        showMessage("");
    }

    async function loadAssignedVehicle() {
        showMessage("Đang tải thông tin phương tiện...");

        try {
            const response = await fetch(API_URL, {
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
                    "Bạn không có quyền xem thông tin này.",
                    true
                );
                return;
            }

            if (!response.ok) {
                throw new Error(
                    "Không thể tải dữ liệu. Mã lỗi: " +
                    response.status
                );
            }

            const result = await response.json();

            // Hỗ trợ cả API trả về object và array.
            const vehicle = Array.isArray(result)
                ? result[0]
                : result;

            if (!vehicle) {
                resetVehicle();

                showMessage(
                    "Bạn chưa được Admin phân công phương tiện."
                );
                return;
            }

            displayVehicle(vehicle);

        } catch (error) {
            console.error("Lỗi tải xe:", error);

            showMessage(
                error.message ||
                "Không thể kết nối đến máy chủ.",
                true
            );
        }
    }

    document.addEventListener(
        "DOMContentLoaded",
        loadAssignedVehicle
    );
})();
