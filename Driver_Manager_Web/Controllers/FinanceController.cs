using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers
{
    [Route("[controller]")]
    public class FinanceController : Controller
    {
        private readonly Database _db = new Database();

        // GET: /Finance
        [HttpGet("")]
        public IActionResult Index()
        {
            return View();
        }

        // GET: /Finance/Report?type=month&year=2026&period=9
        [HttpGet("Report")]
        public async Task<IActionResult> Report(
            string type = "month",
            int year = 2026,
            int period = 9)
        {
            int startMonth;
            int endMonth;

            switch (type.ToLower())
            {
                case "month":
                    if (period < 1 || period > 12)
                        return BadRequest("Tháng không hợp lệ.");

                    startMonth = period;
                    endMonth = period;
                    break;

                case "year":
                    startMonth = 1;
                    endMonth = 12;
                    break;

                default:
                    return BadRequest(
                        "Loại thống kê phải là tháng hoặc năm.");
            }

            const string sql = @"
                SELECT
                    COUNT(DISTINCT s.driver_id) AS driver_count,
                    COALESCE(SUM(s.base_salary), 0) AS base_salary,
                    COALESCE(SUM(s.route_allowance), 0) AS allowance,
                    COALESCE(SUM(s.bonus), 0) AS bonus,
                    COALESCE(SUM(s.penalty), 0) AS penalty,

                    COALESCE(SUM(
                        CASE
                            WHEN p.payment_status = 'Đã thanh toán'
                            THEN s.base_salary
                               + s.route_allowance
                               + s.bonus
                               - s.penalty
                            ELSE 0
                        END
                    ), 0) AS total_paid,

                    COALESCE(SUM(
                        CASE
                            WHEN p.payment_status = 'Đã thanh toán'
                            THEN 1 ELSE 0
                        END
                    ), 0) AS paid_records,

                    COALESCE(SUM(
                        CASE
                            WHEN p.payment_status = 'Chưa thanh toán'
                              OR p.id IS NULL
                            THEN 1 ELSE 0
                        END
                    ), 0) AS unpaid_records

                FROM salarystructures s
                LEFT JOIN salarypayments p
                    ON p.salary_id = s.id
                WHERE s.period_year = @year
                  AND s.period_month BETWEEN @startMonth AND @endMonth;
            ";

            try
            {
                await using var connection = _db.GetConnection();
                await connection.OpenAsync();

                await using var command =
                    new MySqlCommand(sql, connection);

                command.Parameters.AddWithValue("@year", year);
                command.Parameters.AddWithValue(
                    "@startMonth", startMonth);
                command.Parameters.AddWithValue(
                    "@endMonth", endMonth);

                await using var reader =
                    await command.ExecuteReaderAsync();

                if (!await reader.ReadAsync())
                    return Ok(new { success = true, data = (object?)null });

                var data = new
                {
                    year,
                    type,
                    period,
                    startMonth,
                    endMonth,

                    driverCount = reader.GetInt32(0),
                    baseSalary = reader.GetDecimal(1),
                    allowance = reader.GetDecimal(2),
                    bonus = reader.GetDecimal(3),
                    penalty = reader.GetDecimal(4),
                    totalPaid = reader.GetDecimal(5),
                    paidRecords = reader.GetInt32(6),
                    unpaidRecords = reader.GetInt32(7)
                };

                return Ok(new
                {
                    success = true,
                    data
                });
            }
            catch (Exception)
            {
                return StatusCode(500, new
                {
                    success = false,
                    message = "Không thể lấy dữ liệu báo cáo tài chính."
                });
            }
        }
    
    [HttpGet("Chart")]
    public async Task<IActionResult> Chart(int year, int month)
    {
        if (year < 2000 || year > 2100)
            return BadRequest(new {
                success = false,
                message = "Năm không hợp lệ."
            });

        if (month < 1 || month > 12)
            return BadRequest(new {
                success = false,
                message = "Tháng không hợp lệ."
            });

        const string sql = @"
            SELECT
                COALESCE(SUM(
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM salarypayments p
                            WHERE p.salary_id = s.id
                            AND p.payment_status = 'Đã thanh toán'
                        )
                        THEN s.base_salary
                        + s.route_allowance
                        + s.bonus
                        - s.penalty
                        ELSE 0
                    END
                ), 0) AS total_paid,

                COALESCE(SUM(s.penalty), 0) AS total_penalty

            FROM salarystructures s
            WHERE s.period_year = @year
            AND s.period_month = @month;";

        try
        {
            await using var connection = _db.GetConnection();
            await connection.OpenAsync();

            await using var command = new MySqlCommand(sql, connection);
            command.Parameters.AddWithValue("@year", year);
            command.Parameters.AddWithValue("@month", month);

            await using var reader = await command.ExecuteReaderAsync();

            await reader.ReadAsync();

            var totalPaid = reader.GetDecimal(0);
            var totalPenalty = reader.GetDecimal(1);

            return Ok(new
            {
                success = true,
                data = new
                {
                    year,
                    month,
                    label = $"Tháng {month:00}/{year}",
                    totalPaid,
                    totalPenalty
                }
            });
        }
        catch (Exception ex)
        {
            // Ghi lỗi để tiện kiểm tra trong cửa sổ Output/Terminal.
            Console.Error.WriteLine(
                $"Finance Chart error: {ex.Message}"
            );

            return StatusCode(500, new
            {
                success = false,
                message = "Không thể tải dữ liệu biểu đồ."
            });
        }
    }
        
    [HttpGet("ChartYear")]
    public async Task<IActionResult> ChartYear(int year)
    {
        if (year < 2000 || year > 2100)
            return BadRequest(new {
                success = false,
                message = "Năm không hợp lệ."
            });

        const string sql = @"
            SELECT
                s.period_month AS month,

                COALESCE(SUM(
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM salarypayments p
                            WHERE p.salary_id = s.id
                            AND p.payment_status = 'Đã thanh toán'
                        )
                        THEN s.base_salary
                        + s.route_allowance
                        + s.bonus
                        - s.penalty
                        ELSE 0
                    END
                ), 0) AS total_paid,

                COALESCE(SUM(s.penalty), 0) AS total_penalty

            FROM salarystructures s
            WHERE s.period_year = @year
            GROUP BY s.period_month
            ORDER BY s.period_month;";

        try
        {
            await using var connection = _db.GetConnection();
            await connection.OpenAsync();

            await using var command = new MySqlCommand(sql, connection);
            command.Parameters.AddWithValue("@year", year);

            var months = new Dictionary<int, object>();

            await using var reader = await command.ExecuteReaderAsync();

            while (await reader.ReadAsync())
            {
                int month = reader.GetInt32(0);

                months[month] = new
                {
                    month,
                    totalPaid = reader.GetDecimal(1),
                    totalPenalty = reader.GetDecimal(2)
                };
            }

            // Luôn trả đủ 12 tháng, tháng chưa có dữ liệu = 0
            var data = Enumerable.Range(1, 12).Select(month =>
            {
                if (months.TryGetValue(month, out var item))
                    return item;

                return (object)new
                {
                    month,
                    totalPaid = 0m,
                    totalPenalty = 0m
                };
            }).ToArray();

            return Ok(new
            {
                success = true,
                data = new
                {
                    year,
                    months = data
                }
            });
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Finance ChartYear error: {ex.Message}");

            return StatusCode(500, new
            {
                success = false,
                message = "Không thể tải biểu đồ theo năm."
            });
        }
    }
    }
}
