using Microsoft.AspNetCore.Authorization;
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

        // ------------------------------------------------------------------
        // GET /api/overview/violations?month=11&year=2026
        //   month: 1-12 = một tháng, 0 = cả năm. Bỏ trống = tháng hiện tại (UTC+7).
        // Thống kê điểm trừ theo từng loại vi phạm và theo từng tài xế.
        // Dùng đúng quy tắc tính lương: biên bản thủ công chưa xóa + sự kiện AI đã duyệt.
        // ------------------------------------------------------------------
        private sealed record ViolationRow(string DriverId, string Name, string Source, int Cases, int Points);

        [Authorize(Roles = "Admin")]
        [HttpGet("violations")]
        public async Task<IActionResult> GetViolationStats(int? month, int? year, CancellationToken ct)
        {
            Response.Headers.CacheControl = "private, no-store";

            var today = DateTime.UtcNow.AddHours(7);
            var y = year ?? today.Year;
            var m = month ?? today.Month;
            if (y is < 2000 or > 2999 || m is < 0 or > 12) return BadRequest();

            var from = new DateTime(y, m == 0 ? 1 : m, 1);
            var to = m == 0 ? from.AddYears(1) : from.AddMonths(1);

            try
            {
                await using var conn = _db.GetConnection();
                await conn.OpenAsync(ct);

                var rows = new List<ViolationRow>();

                // 1. Biên bản vi phạm nhập thủ công (giờ địa phương)
                const string sqlManual = """
                    SELECT d.driver_id, TRIM(d.violation), COUNT(*), COALESCE(SUM(d.points_deducted), 0)
                    FROM demeritpoints d
                    WHERE d.deleted_utc IS NULL AND d.violated_at >= @from AND d.violated_at < @to
                    GROUP BY d.driver_id, TRIM(d.violation)
                    """;
                await using (var cmd = new MySqlCommand(sqlManual, conn))
                {
                    cmd.Parameters.AddWithValue("@from", from);
                    cmd.Parameters.AddWithValue("@to", to);
                    await using var reader = await cmd.ExecuteReaderAsync(ct);
                    while (await reader.ReadAsync(ct))
                    {
                        var points = Convert.ToInt32(reader.GetValue(3));
                        if (points <= 0) continue;
                        rows.Add(new(reader.GetString(0), reader.GetString(1), "manual",
                            Convert.ToInt32(reader.GetValue(2)), points));
                    }
                }

                // 2. Sự kiện AI đã được admin duyệt (captured_utc lưu UTC nên lùi 7 giờ)
                const string sqlAi = """
                    SELECT e.driver_id, e.event_type, COUNT(*), COALESCE(SUM(e.points_deducted), 0)
                    FROM ai_driving_events e
                    WHERE e.event_type IN ('phone_use', 'drowsy') AND e.review_status = 'approved'
                      AND e.deleted_utc IS NULL
                      AND e.captured_utc >= DATE_SUB(@from, INTERVAL 7 HOUR)
                      AND e.captured_utc < DATE_SUB(@to, INTERVAL 7 HOUR)
                    GROUP BY e.driver_id, e.event_type
                    """;
                await using (var cmd = new MySqlCommand(sqlAi, conn))
                {
                    cmd.Parameters.AddWithValue("@from", from);
                    cmd.Parameters.AddWithValue("@to", to);
                    await using var reader = await cmd.ExecuteReaderAsync(ct);
                    while (await reader.ReadAsync(ct))
                    {
                        var type = reader.GetString(1);
                        var name = type == "phone_use" ? "Sử dụng điện thoại" : "Buồn ngủ";
                        var points = Convert.ToInt32(reader.GetValue(3));
                        if (points <= 0) continue;
                        rows.Add(new(reader.GetString(0), name, "ai",
                            Convert.ToInt32(reader.GetValue(2)), points));
                    }
                }

                // 3. Tên tài xế
                var names = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                await using (var cmd = new MySqlCommand("SELECT id, full_name FROM drivers", conn))
                {
                    await using var reader = await cmd.ExecuteReaderAsync(ct);
                    while (await reader.ReadAsync(ct))
                        names[reader.GetString(0)] = reader.IsDBNull(1) ? "" : reader.GetString(1);
                }

                // Gộp theo loại vi phạm (không phân biệt hoa thường, tách theo nguồn)
                var violations = rows
                    .GroupBy(r => (r.Source, Key: r.Name.ToLowerInvariant()))
                    .Select(g => new
                    {
                        name = g.First().Name,
                        source = g.Key.Source,
                        cases = g.Sum(x => x.Cases),
                        points = g.Sum(x => x.Points),
                        drivers = g.Select(x => x.DriverId).Distinct().Count()
                    })
                    .OrderByDescending(v => v.points).ThenByDescending(v => v.cases).ThenBy(v => v.name)
                    .ToList();

                // Gộp theo tài xế
                var drivers = rows
                    .GroupBy(r => r.DriverId)
                    .Select(g => new
                    {
                        id = g.Key,
                        name = names.TryGetValue(g.Key, out var n) && !string.IsNullOrWhiteSpace(n) ? n : g.Key,
                        points = g.Sum(x => x.Points),
                        cases = g.Sum(x => x.Cases),
                        items = g.GroupBy(x => (x.Source, Key: x.Name.ToLowerInvariant()))
                            .Select(i => new
                            {
                                name = i.First().Name,
                                source = i.Key.Source,
                                cases = i.Sum(x => x.Cases),
                                points = i.Sum(x => x.Points)
                            })
                            .OrderByDescending(i => i.points).ThenBy(i => i.name)
                            .ToList()
                    })
                    .OrderByDescending(d => d.points).ThenByDescending(d => d.cases).ThenBy(d => d.name)
                    .ToList();

                var totalPoints = rows.Sum(r => r.Points);
                return Ok(new
                {
                    month = m,
                    year = y,
                    vndPerPoint = PayrollDeductions.VndPerPoint,
                    totals = new
                    {
                        points = totalPoints,
                        cases = rows.Sum(r => r.Cases),
                        drivers = drivers.Count,
                        fine = (long)totalPoints * PayrollDeductions.VndPerPoint
                    },
                    violations,
                    drivers
                });
            }
            catch (Exception ex)
            {
                return Problem(title: "Không thể thống kê vi phạm", detail: ex.Message, statusCode: 500);
            }
        }
    }
}
