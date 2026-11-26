
using System.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Driver_Manager_Web.Models;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers
{
    [ApiController]
    [Authorize(Roles = "Admin")]
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
            if (month < 1 || month > 12 || year < 1800 || year > 2500)
            {
                return BadRequest(new
                {
                    message = "Tháng hoặc năm không hợp lệ."
                });
            }

            var sql = $$"""
                SELECT
                    s.id AS SalaryId,
                    d.id AS DriverId,
                    d.full_name AS DriverName,
                    s.base_salary AS BaseSalary,
                    s.route_allowance AS RouteAllowance,
                    s.bonus AS ShiftBonus,
                    {{PayrollDeductions.TotalPenalty}} AS Deduction,
                    {{PayrollDeductions.DisciplinaryPenalty}} AS DisciplinaryPenalty,
                    s.base_salary + s.route_allowance + s.bonus - {{PayrollDeductions.TotalPenalty}} AS NetSalary,
                    COALESCE(p.payment_status, 'Chưa thanh toán') AS Status
                FROM salarystructures s
                INNER JOIN drivers d ON d.id = s.driver_id
                {{PayrollDeductions.PaymentJoin}}
                WHERE s.period_month = @month
                  AND s.period_year = @year
                  AND (
                      @search = ''
                      OR d.id LIKE @keyword
                      OR d.full_name LIKE @keyword
                  )
                ORDER BY d.full_name;
                """;

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
                        disciplinaryPenalty = Convert.ToDecimal(reader["DisciplinaryPenalty"]),
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

            try
            {
                var db = new Database();
                await using var conn = db.GetConnection();
                await conn.OpenAsync();

                const string initStructureSql = @"
                    INSERT INTO salarystructures (driver_id, base_salary, route_allowance, bonus, penalty, period_month, period_year)
                    SELECT 
                        d.id, 
                        COALESCE((SELECT ss_prev.base_salary FROM salarystructures ss_prev WHERE ss_prev.driver_id = d.id ORDER BY ss_prev.period_year DESC, ss_prev.period_month DESC LIMIT 1), 8000000) AS base_salary,
                        COALESCE((SELECT ss_prev.route_allowance FROM salarystructures ss_prev WHERE ss_prev.driver_id = d.id ORDER BY ss_prev.period_year DESC, ss_prev.period_month DESC LIMIT 1), 0) AS route_allowance,
                        0 AS bonus,
                        0 AS penalty,
                        @month,
                        @year
                    FROM drivers d
                    WHERE d.is_suspended = 0
                     AND NOT EXISTS (
                        SELECT 1 FROM salarystructures ss_curr 
                        WHERE ss_curr.driver_id = d.id 
                          AND ss_curr.period_month = @month 
                          AND ss_curr.period_year = @year
                    );
                ";

                await using var initCmd = new MySqlCommand(initStructureSql, conn);
                initCmd.Parameters.AddWithValue("@month", request.Month);
                initCmd.Parameters.AddWithValue("@year", request.Year);
                await initCmd.ExecuteNonQueryAsync();

                const string paymentSql = @"
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

                await using var cmd = new MySqlCommand(paymentSql, conn);
                cmd.Parameters.AddWithValue("@month", request.Month);
                cmd.Parameters.AddWithValue("@year", request.Year);

                int count = await cmd.ExecuteNonQueryAsync();

                return Ok(new
                {
                    success = true,
                    count,
                    message = $"Đã tính toán và khởi tạo thành công {count} bản ghi lương cho kỳ {request.Month:00}/{request.Year}."
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

        [HttpPost("pay")]
        public async Task<IActionResult> Pay([FromBody] PayPayrollRequest request, CancellationToken ct)
        {
            if (string.IsNullOrWhiteSpace(request.DriverId) ||
                request.Month < 1 || request.Month > 12 ||
                request.Year < 1800 || request.Year > 2500)
            {
                return BadRequest(new { message = "Thông tin thanh toán không hợp lệ." });
            }

            try
            {
                var db = new Database();
                await using var conn = db.GetConnection();
                await conn.OpenAsync(ct);
                // Approving/deleting violations and settling payroll take the same driver lock.
                await using var tx = await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
                await using var lockDriver = new MySqlCommand(
                    "SELECT id FROM drivers WHERE id = @driverId FOR UPDATE", conn, tx);
                lockDriver.Parameters.AddWithValue("@driverId", request.DriverId.Trim());
                if (await lockDriver.ExecuteScalarAsync(ct) is null)
                    return NotFound(new { message = "Không tìm thấy tài xế." });

                var paymentQuery = $$"""
                    SELECT p.id, p.payment_status
                    FROM salarystructures s
                    {{PayrollDeductions.PaymentJoin}}
                    WHERE s.driver_id = @driverId AND s.period_month = @month AND s.period_year = @year
                    """;
                await using var payment = new MySqlCommand(paymentQuery, conn, tx);
                payment.Parameters.AddWithValue("@driverId", request.DriverId.Trim());
                payment.Parameters.AddWithValue("@month", request.Month);
                payment.Parameters.AddWithValue("@year", request.Year);

                int paymentId;
                await using (var row = await payment.ExecuteReaderAsync(ct))
                {
                    if (!await row.ReadAsync(ct) || row.IsDBNull(0))
                        return Conflict(new { message = "Hãy tính lương kỳ này trước." });
                    if (row.GetString(1) == "Đã thanh toán")
                        return Conflict(new { message = "Lương kỳ này đã được chốt." });
                    paymentId = row.GetInt32(0);
                }

                var sql = $$"""
                    UPDATE salarypayments p
                    INNER JOIN salarystructures s ON s.id = p.salary_id
                    SET p.disciplinary_penalty = {{PayrollDeductions.PendingPenalty}},
                        p.payment_status = 'Đã thanh toán',
                        p.payment_time = NOW(),
                        p.note = CONCAT('Đã thanh toán lương tháng ', LPAD(s.period_month, 2, '0'), '/', s.period_year)
                    WHERE p.id = @paymentId;
                    """;
                await using var cmd = new MySqlCommand(sql, conn, tx);
                cmd.Parameters.AddWithValue("@paymentId", paymentId);
                await cmd.ExecuteNonQueryAsync(ct);
                await tx.CommitAsync(ct);

                return Ok(new
                {
                    success = true,
                    message = $"Đã xác nhận thanh toán cho tài xế {request.DriverId.Trim()}."
                });
            }
            catch (MySqlException)
            {
                return Problem(title: "Lỗi cập nhật thanh toán", statusCode: 500);
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
