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
            Response.Headers.CacheControl = "private, no-store";
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
                var sqlPayroll = $$"""
                    SELECT COALESCE(SUM(s.base_salary + s.route_allowance + s.bonus - {{PayrollDeductions.TotalPenalty}}), 0)
                    FROM salarystructures s
                    {{PayrollDeductions.PaymentJoin}}
                    WHERE s.period_month = MONTH(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))
                      AND s.period_year = YEAR(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR));
                    """;
                await using var cmdPayroll = new MySqlCommand(sqlPayroll, conn);
                var payrollAmount = Convert.ToDecimal(await cmdPayroll.ExecuteScalarAsync());

                // Count the same pending cases shown on the admin review page.
                const string sqlDemerits = """
                    SELECT COUNT(*) FROM ai_driving_events
                    WHERE event_type IN ('phone_use', 'drowsy') AND review_status = 'pending' AND deleted_utc IS NULL
                    """;
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