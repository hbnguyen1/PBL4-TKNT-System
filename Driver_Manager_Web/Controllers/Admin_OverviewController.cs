using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Driver_Manager_Web.Models; 

namespace Driver_Manager_Web.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class OverviewController : ControllerBase
    {
        private readonly Database _db = new Database();

        [HttpGet("stats")]
        public async Task<IActionResult> GetStats()
        {
            try
            {
                await using var conn = _db.GetConnection();
                await conn.OpenAsync();

                // 1. Tổng số tài xế (Bảng Drivers)
                const string sqlDrivers = "SELECT COUNT(*) FROM drivers;";
                await using var cmdDrivers = new MySqlCommand(sqlDrivers, conn);
                var totalDrivers = Convert.ToInt32(await cmdDrivers.ExecuteScalarAsync());

                // 2. Xe đang vận hành & Tổng số xe (Bảng Vehicles)
                const string sqlVehicles = @"
                    SELECT 
                        SUM(CASE WHEN driver_id IS NOT NULL AND driver_id != '' THEN 1 ELSE 0 END) AS ActiveVehicles,
                        COUNT(*) AS TotalVehicles
                    FROM vehicles;";
                await using var cmdVehicles = new MySqlCommand(sqlVehicles, conn);
                await using var readerVehicles = await cmdVehicles.ExecuteReaderAsync();
                
                int activeVehicles = 0;
                int totalVehicles = 0;
                if (await readerVehicles.ReadAsync())
                {
                    activeVehicles = Convert.ToInt32(readerVehicles["ActiveVehicles"] != DBNull.Value ? readerVehicles["ActiveVehicles"] : 0);
                    totalVehicles = Convert.ToInt32(readerVehicles["TotalVehicles"] != DBNull.Value ? readerVehicles["TotalVehicles"] : 0);
                }
                await readerVehicles.CloseAsync();

                // 3. Quỹ lương kỳ này (Bảng SalaryStructures)
                const string sqlPayroll = @"
                    SELECT COALESCE(SUM(base_salary + route_allowance + bonus - penalty), 0)
                    FROM salarystructures
                    WHERE period_month = MONTH(CURRENT_DATE()) AND period_year = YEAR(CURRENT_DATE());";
                await using var cmdPayroll = new MySqlCommand(sqlPayroll, conn);
                var payrollAmount = Convert.ToDecimal(await cmdPayroll.ExecuteScalarAsync());

                // 4. Vi phạm chờ duyệt (Bảng DemeritPoints)
                const string sqlDemerits = "SELECT COUNT(*) FROM demeritpoints;";
                await using var cmdDemerits = new MySqlCommand(sqlDemerits, conn);
                var pendingDemerits = Convert.ToInt32(await cmdDemerits.ExecuteScalarAsync());

                return Ok(new
                {
                    totalDrivers = totalDrivers,
                    activeVehicles = activeVehicles,
                    totalVehicles = totalVehicles,
                    payrollAmount = payrollAmount,
                    pendingDemerits = pendingDemerits
                });
            }
            catch (Exception ex)
            {
                return Problem(title: "Lỗi kết nối CSDL Overview", detail: ex.Message, statusCode: 500);
            }
        }
    }
}