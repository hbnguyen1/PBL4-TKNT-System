document.addEventListener("DOMContentLoaded", function () {
    fetchOverviewStats();
});

async function fetchOverviewStats() {
    try {
        const response = await fetch('/api/overview/stats');
        
        if (!response.ok) {
            console.error("Lỗi gọi API Overview:", response.statusText);
            return;
        }

        const data = await response.json();

        // 1. Gán Tổng Tài Xế
        const elDrivers = document.getElementById('kpi-drivers');
        if (elDrivers) elDrivers.textContent = data.totalDrivers;

        // 2. Gán Xe Vận Hành
        const elVehicles = document.getElementById('kpi-vehicles');
        if (elVehicles) elVehicles.textContent = `${data.activeVehicles} / ${data.totalVehicles}`;

        // 3. Gán Quỹ Lương (định dạng tiền tệ VNĐ)
        const elPayroll = document.getElementById('kpi-payroll');
        if (elPayroll) {
            elPayroll.textContent = new Intl.NumberFormat('vi-VN', { 
                style: 'currency', 
                currency: 'VND' 
            }).format(data.payrollAmount);
        }

        // 4. Gán Vi Phạm Chờ Duyệt
        const elDemerits = document.getElementById('kpi-demerits');
        if (elDemerits) elDemerits.textContent = `${data.pendingDemerits} Ca`;

    } catch (error) {
        console.error("Không thể lấy dữ liệu Overview từ XAMPP:", error);
    }
}