
using Microsoft.AspNetCore.Mvc;
using Driver_Manager_Web.Models;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers
{
    [ApiController]
    [Route("api/payroll")]
    public class PayrollController : ControllerBase
    {
        // GET: /api/payroll?month=9&year=2026&search=
        // Lấy bảng lương theo tháng/năm
        [HttpGet]
        public async Task<IActionResult> Get(
            [FromQuery] int month = 9,
            [FromQuery] int year = 2026,
            [FromQuery] string search = "")
        {
            if (month < 1 || month > 12 || year < 2000 || year > 2100)
            {
                return BadRequest(new
                {
                    message = "Tháng hoặc năm không hợp lệ."
                });
            }

            const string sql = @"
                SELECT
                    ss.id AS SalaryId,
                    d.id AS DriverId,
                    d.full_name AS DriverName,
                    ss.base_salary AS BaseSalary,
                    ss.route_allowance AS RouteAllowance,
                    ss.bonus AS ShiftBonus,
                    ss.penalty AS Deduction,

                    (
                        ss.base_salary
                        + ss.route_allowance
                        + ss.bonus
                        - ss.penalty
                    ) AS NetSalary,

                    COALESCE(
                        sp.payment_status,
                        'Chưa thanh toán'
                    ) AS Status

                FROM salarystructures ss

                INNER JOIN drivers d
                    ON d.id = ss.driver_id

                LEFT JOIN salarypayments sp
                    ON sp.salary_id = ss.id

                WHERE ss.period_month = @month
                  AND ss.period_year = @year
                  AND (
                      @search = ''
                      OR d.id LIKE @keyword
                      OR d.full_name LIKE @keyword
                  )

                ORDER BY d.full_name;
            ";

            try
            {
                var db = new Database();
                await using var conn = db.GetConnection();
                await conn.OpenAsync();

                await using var cmd = new MySqlCommand(sql, conn);

                cmd.Parameters.AddWithValue("@month", month);
                cmd.Parameters.AddWithValue("@year", year);
                cmd.Parameters.AddWithValue("@search", search.Trim());
                cmd.Parameters.AddWithValue(
                    "@keyword", $"%{search.Trim()}%");

                var result = new List<object>();

                await using var reader = await cmd.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    result.Add(new
                    {
                        salaryId = Convert.ToInt32(reader["SalaryId"]),
                        driverId = reader["DriverId"].ToString(),
                        driverName = reader["DriverName"].ToString(),

                        baseSalary = Convert.ToDecimal(reader["BaseSalary"]),
                        routeAllowance = Convert.ToDecimal(reader["RouteAllowance"]),
                        shiftBonus = Convert.ToDecimal(reader["ShiftBonus"]),
                        deduction = Convert.ToDecimal(reader["Deduction"]),
                        netSalary = Convert.ToDecimal(reader["NetSalary"]),

                        status = reader["Status"].ToString()
                    });
                }

                return Ok(result);
            }
            catch (Exception ex)
            {
                return Problem(
                    title: "Lỗi tải bảng lương",
                    detail: ex.Message,
                    statusCode: 500
                );
            }
        }

        // POST: /api/payroll/calculate
        // Tạo bản ghi chờ thanh toán cho toàn bộ tài xế trong kỳ
        [HttpPost("calculate")]
        public async Task<IActionResult> Calculate(
            [FromBody] PayrollPeriod request)
        {
            if (request.Month < 1 || request.Month > 12 ||
                request.Year < 2000 || request.Year > 2100)
            {
                return BadRequest(new
                {
                    message = "Tháng hoặc năm không hợp lệ."
                });
            }

            const string sql = @"
                INSERT INTO salarypayments
                (
                    salary_id,
                    payment_status,
                    payment_time,
                    note
                )
                SELECT
                    ss.id,
                    'Chưa thanh toán',
                    NULL,
                    CONCAT(
                        'Chờ thanh toán lương tháng ',
                        LPAD(ss.period_month, 2, '0'),
                        '/',
                        ss.period_year
                    )
                FROM salarystructures ss
                WHERE ss.period_month = @month
                  AND ss.period_year = @year

                  AND NOT EXISTS
                  (
                      SELECT 1
                      FROM salarypayments sp
                      WHERE sp.salary_id = ss.id
                  );
            ";

            try
            {
                var db = new Database();
                await using var conn = db.GetConnection();
                await conn.OpenAsync();

                await using var cmd = new MySqlCommand(sql, conn);

                cmd.Parameters.AddWithValue("@month", request.Month);
                cmd.Parameters.AddWithValue("@year", request.Year);

                int count = await cmd.ExecuteNonQueryAsync();

                return Ok(new
                {
                    success = true,
                    count,
                    message =
                        $"Đã tạo {count} bản ghi chờ thanh toán cho kỳ " +
                        $"{request.Month:00}/{request.Year}."
                });
            }
            catch (Exception ex)
            {
                return Problem(
                    title: "Lỗi tính lương",
                    detail: ex.Message,
                    statusCode: 500
                );
            }
        }

        // POST: /api/payroll/pay
        // Cập nhật trạng thái thanh toán của một tài xế
        [HttpPost("pay")]
        public async Task<IActionResult> Pay(
            [FromBody] PayPayrollRequest request)
        {
            if (string.IsNullOrWhiteSpace(request.DriverId) ||
                request.Month < 1 || request.Month > 12 ||
                request.Year < 2000 || request.Year > 2100)
            {
                return BadRequest(new
                {
                    message = "Thông tin thanh toán không hợp lệ."
                });
            }

            const string sql = @"
                UPDATE salarypayments sp

                INNER JOIN salarystructures ss
                    ON ss.id = sp.salary_id

                SET
                    sp.payment_status = 'Đã thanh toán',
                    sp.payment_time = NOW(),
                    sp.note = CONCAT(
                        'Đã thanh toán lương tháng ',
                        LPAD(ss.period_month, 2, '0'),
                        '/',
                        ss.period_year
                    )

                WHERE ss.driver_id = @driverId
                  AND ss.period_month = @month
                  AND ss.period_year = @year
                  AND sp.payment_status <> 'Đã thanh toán';
            ";

            try
            {
                var db = new Database();
                await using var conn = db.GetConnection();
                await conn.OpenAsync();

                await using var cmd = new MySqlCommand(sql, conn);

                cmd.Parameters.AddWithValue("@driverId", request.DriverId);
                cmd.Parameters.AddWithValue("@month", request.Month);
                cmd.Parameters.AddWithValue("@year", request.Year);

                int count = await cmd.ExecuteNonQueryAsync();

                if (count == 0)
                {
                    return Conflict(new
                    {
                        message =
                            "Không tìm thấy bản ghi chờ thanh toán. " +
                            "Em hãy tính lương kỳ này trước."
                    });
                }

                return Ok(new
                {
                    success = true,
                    message =
                        $"Đã xác nhận thanh toán cho tài xế {request.DriverId}."
                });
            }
            catch (Exception ex)
            {
                return Problem(
                    title: "Lỗi cập nhật thanh toán",
                    detail: ex.Message,
                    statusCode: 500
                );
            }
        }
    }

    public class PayrollPeriod
    {
        public int Month { get; set; }
        public int Year { get; set; }
    }

    public class PayPayrollRequest : PayrollPeriod
    {
        public string DriverId { get; set; } = "";
    }
}
