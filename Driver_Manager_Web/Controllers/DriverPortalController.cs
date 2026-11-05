using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Driver_Manager_Web.Models;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Authorize(Roles = "Driver")]
[Route("api/driver/me")]
public class DriverPortalController : ControllerBase
{
    private readonly Database _db = new();

    private string? DriverId =>
        User.FindFirstValue(ClaimTypes.NameIdentifier);

    // 1. XEM HỒ SƠ
    [HttpGet("profile")]
    public async Task<IActionResult> Profile()
    {
        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized();

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT d.id, d.full_name, d.date_of_birth,
                   d.address, d.phone, d.license_type,
                   d.is_suspended, a.username
            FROM drivers d
            JOIN accounts a ON a.id = d.id
            WHERE d.id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", DriverId);

        await using var r = await cmd.ExecuteReaderAsync();

        if (!await r.ReadAsync())
            return NotFound(new {
                message = "Không tìm thấy tài xế."
            });

        return Ok(new
        {
            id = r["id"].ToString(),
            fullName = r["full_name"].ToString(),
            username = r["username"].ToString(),
            dateOfBirth = r["date_of_birth"] == DBNull.Value
                ? null
                : Convert.ToDateTime(r["date_of_birth"])
                    .ToString("yyyy-MM-dd"),
            address = r["address"].ToString(),
            phone = r["phone"].ToString(),
            licenseType = r["license_type"].ToString(),
            isSuspended = Convert.ToBoolean(r["is_suspended"])
        });
    }

    // 2. XEM XE ĐƯỢC PHÂN CÔNG

    // 2. XEM XE ĐƯỢC PHÂN CÔNG
    [HttpGet("vehicle")]
    public async Task<IActionResult> Vehicle()
    {
        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized(new
            {
                message = "Vui lòng đăng nhập."
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        // Chỉ lấy xe thuộc tài xế đang đăng nhập.
        // Không nhận driverId từ trình duyệt.
        const string sql = """
            SELECT
                v.license_plate,
                v.vehicle_name,
                v.route,
                v.device_info,
                d.id AS driver_id,
                d.full_name AS driver_name,
                d.phone AS driver_phone
            FROM vehicles v
            INNER JOIN drivers d
                ON v.driver_id = d.id
            WHERE d.id = @driverId
            ORDER BY v.license_plate
            LIMIT 1
            """;

        await using var cmd =
            new MySqlCommand(sql, conn);

        cmd.Parameters.AddWithValue(
            "@driverId", DriverId
        );

        await using var reader =
            await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
        {
            return Ok((object?)null);
        }

        string? ReadString(string column)
        {
            return reader[column] == DBNull.Value
                ? null
                : reader[column].ToString();
        }

        return Ok(new
        {
            // Chưa biết tên cột ID xe thực tế.
            vehicleName = ReadString("vehicle_name"),
            licensePlate = ReadString("license_plate"),
            route = ReadString("route"),

            // Chưa biết cột trạng thái xe.
            vehicleStatus = (string?)null,

            driverId = ReadString("driver_id"),
            driverName = ReadString("driver_name"),
            driverPhone = ReadString("driver_phone"),

            assignmentStatus = "Đã phân công xe",

            deviceInfo = ReadString("device_info"),

            // Không suy luận thiết bị online
            // khi chưa có dữ liệu kết nối thực tế.
            deviceStatus = (string?)null
        });
    }

    // 3. XEM ĐIỂM TRỪ VI PHẠM
    [HttpGet("demerits")]
    public async Task<IActionResult> Demerits(
        [FromQuery] int? month,
        [FromQuery] int? year)
    {
        if (month is < 1 or > 12 || year is < 1 or > 9999)
            return BadRequest(new {
                message = "Tháng hoặc năm không hợp lệ."
            });

        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized();

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT id, violation, points_deducted, violated_at
            FROM demeritpoints
            WHERE driver_id = @id
              AND (@month IS NULL OR MONTH(violated_at) = @month)
              AND (@year IS NULL OR YEAR(violated_at) = @year)
            ORDER BY violated_at DESC
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", DriverId);
        cmd.Parameters.AddWithValue(
            "@month", (object?)month ?? DBNull.Value);
        cmd.Parameters.AddWithValue(
            "@year", (object?)year ?? DBNull.Value);

        var records = new List<object>();

        await using var r = await cmd.ExecuteReaderAsync();

        while (await r.ReadAsync())
        {
            records.Add(new
            {
                id = Convert.ToInt32(r["id"]),
                violation = r["violation"].ToString(),
                pointsDeducted =
                    Convert.ToInt32(r["points_deducted"]),
                violatedAt =
                    Convert.ToDateTime(r["violated_at"])
            });
        }

        return Ok(records);
    }

    // 4. XEM BẢNG LƯƠNG
    [HttpGet("payroll")]
    public async Task<IActionResult> Payroll(
        [FromQuery] int month,
        [FromQuery] int year)
    {
        if (month < 1 || month > 12 ||
            year < 1 || year > 9999)
            return BadRequest(new {
                message = "Tháng hoặc năm không hợp lệ."
            });

        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized();

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT s.id, s.period_month, s.period_year,
                   s.base_salary, s.route_allowance,
                   s.bonus, s.penalty,
                   (s.base_salary + s.route_allowance
                    + s.bonus - s.penalty) AS net_salary,
                   p.payment_status, p.payment_time, p.note
            FROM salarystructures s
            LEFT JOIN salarypayments p ON p.salary_id = s.id
            WHERE s.driver_id = @id
              AND s.period_month = @month
              AND s.period_year = @year
            ORDER BY p.id DESC
            LIMIT 1
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", DriverId);
        cmd.Parameters.AddWithValue("@month", month);
        cmd.Parameters.AddWithValue("@year", year);

        await using var r = await cmd.ExecuteReaderAsync();

        if (!await r.ReadAsync())
            return NotFound(new {
                message = "Chưa có bảng lương kỳ này."
            });

        return Ok(new
        {
            salaryId = Convert.ToInt32(r["id"]),
            month = Convert.ToInt32(r["period_month"]),
            year = Convert.ToInt32(r["period_year"]),
            baseSalary = Convert.ToDecimal(r["base_salary"]),
            allowance = Convert.ToDecimal(r["route_allowance"]),
            bonus = Convert.ToDecimal(r["bonus"]),
            penalty = Convert.ToDecimal(r["penalty"]),
            netSalary = Convert.ToDecimal(r["net_salary"]),
            paymentStatus = r["payment_status"] == DBNull.Value
                ? "Chưa thanh toán"
                : r["payment_status"].ToString(),
            paymentTime = r["payment_time"] == DBNull.Value
                ? (DateTime?)null
                : Convert.ToDateTime(r["payment_time"]),
            note = r["note"].ToString()
        });
    }

    // 5. CẬP NHẬT HỒ SƠ
    public record UpdateProfileRequest(
        string FullName,
        string? Phone,
        DateTime? DateOfBirth,
        string? Address
    );

    [HttpPut("profile")]
    public async Task<IActionResult> UpdateProfile(
        [FromBody] UpdateProfileRequest request)
    {
        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized();

        if (string.IsNullOrWhiteSpace(request.FullName) ||
            request.FullName.Length > 100)
            return BadRequest(new {
                message = "Họ tên không hợp lệ."
            });

        if (request.Phone?.Length > 15 ||
            request.Address?.Length > 255)
            return BadRequest(new {
                message = "Thông tin vượt quá độ dài cho phép."
            });

        if (request.DateOfBirth > DateTime.Today)
            return BadRequest(new {
                message = "Ngày sinh không hợp lệ."
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            UPDATE drivers
            SET full_name = @name,
                phone = @phone,
                date_of_birth = @dob,
                address = @address
            WHERE id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);

        cmd.Parameters.AddWithValue("@id", DriverId);
        cmd.Parameters.AddWithValue(
            "@name", request.FullName.Trim());
        cmd.Parameters.AddWithValue(
            "@phone",
            (object?)request.Phone?.Trim() ?? DBNull.Value);
        cmd.Parameters.AddWithValue(
            "@dob",
            (object?)request.DateOfBirth?.Date ?? DBNull.Value);
        cmd.Parameters.AddWithValue(
            "@address",
            (object?)request.Address?.Trim() ?? DBNull.Value);

        int rows = await cmd.ExecuteNonQueryAsync();

        if (rows == 0)
        {
            await using var check = new MySqlCommand(
                "SELECT COUNT(*) FROM drivers WHERE id=@id", conn);
            check.Parameters.AddWithValue("@id", DriverId);

            if (Convert.ToInt32(
                await check.ExecuteScalarAsync()) == 0)
                return NotFound(new {
                    message = "Không tìm thấy tài xế."
                });
        }

        return Ok(new {
            message = "Cập nhật hồ sơ thành công."
        });
    }

    // 6. ĐỔI MẬT KHẨU
    public record ChangePasswordRequest(
        string CurrentPassword,
        string NewPassword
    );

    [HttpPut("password")]
    public async Task<IActionResult> ChangePassword(
        [FromBody] ChangePasswordRequest request)
    {
        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized();

        if (string.IsNullOrWhiteSpace(request.CurrentPassword))
            return BadRequest(new {
                message = "Vui lòng nhập mật khẩu hiện tại."
            });

        if (string.IsNullOrWhiteSpace(request.NewPassword) ||
            request.NewPassword.Length < 8 ||
            System.Text.Encoding.UTF8.GetByteCount(
                request.NewPassword) > 72)
            return BadRequest(new {
                message = "Mật khẩu mới phải có ít nhất 8 ký tự và tối đa 72 byte UTF-8."
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        string? hash;

        await using (var cmd = new MySqlCommand(
            "SELECT password_hash FROM accounts WHERE id=@id",
            conn))
        {
            cmd.Parameters.AddWithValue("@id", DriverId);
            hash = (string?)await cmd.ExecuteScalarAsync();
        }

        bool valid = false;

        if (!string.IsNullOrEmpty(hash))
        {
            try
            {
                valid = BCrypt.Net.BCrypt.Verify(
                    request.CurrentPassword, hash);
            }
            catch
            {
                valid = false;
            }
        }

        if (!valid)
            return BadRequest(new {
                message = "Mật khẩu hiện tại không đúng."
            });

        if (request.CurrentPassword == request.NewPassword)
            return BadRequest(new {
                message = "Mật khẩu mới phải khác mật khẩu cũ."
            });

        string newHash = BCrypt.Net.BCrypt.HashPassword(
            request.NewPassword);

        await using var update = new MySqlCommand("""
            UPDATE accounts
            SET password_hash = @hash
            WHERE id = @id AND password_hash = @oldHash
            """, conn);

        update.Parameters.AddWithValue("@hash", newHash);
        update.Parameters.AddWithValue("@id", DriverId);
        update.Parameters.AddWithValue("@oldHash", hash);

        int rows = await update.ExecuteNonQueryAsync();

        if (rows == 0)
            return Conflict(new {
                message = "Mật khẩu đã thay đổi. Vui lòng thử lại."
            });

        return Ok(new {
            message = "Đổi mật khẩu thành công."
        });
    }

    // 7. LẤY ẢNH ĐẠI DIỆN
    [HttpGet("avatar")]
    public async Task<IActionResult> GetAvatar()
    {
        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized();

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT avatar, avatar_content_type
            FROM drivers
            WHERE id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", DriverId);

        await using var reader = await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
            return NotFound(new {
                message = "Không tìm thấy tài xế."
            });

        if (reader["avatar"] == DBNull.Value)
            return NotFound(new {
                message = "Chưa có ảnh đại diện."
            });

        byte[] bytes = (byte[])reader["avatar"];
        string? contentType =
            reader["avatar_content_type"]?.ToString();

        if (contentType != "image/jpeg" &&
            contentType != "image/png" &&
            contentType != "image/webp")
            return StatusCode(500, new {
                message = "Định dạng ảnh lưu trữ không hợp lệ."
            });

        Response.Headers.CacheControl = "no-store";
        return File(bytes, contentType);
    }

    // 8. CẬP NHẬT ẢNH ĐẠI DIỆN
    [HttpPut("avatar")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(3 * 1024 * 1024)]
    public async Task<IActionResult> UpdateAvatar(
        [FromForm] IFormFile? avatar)
    {
        if (string.IsNullOrWhiteSpace(DriverId))
            return Unauthorized();

        if (avatar == null || avatar.Length == 0)
            return BadRequest(new {
                message = "Vui lòng chọn ảnh."
            });

        if (avatar.Length > 2 * 1024 * 1024)
            return BadRequest(new {
                message = "Ảnh không được vượt quá 2MB."
            });

        byte[] bytes;

        await using (var stream = avatar.OpenReadStream())
        using (var memory = new MemoryStream())
        {
            await stream.CopyToAsync(memory);
            bytes = memory.ToArray();
        }

        string? contentType = DetectImageType(bytes);

        if (contentType == null)
            return BadRequest(new {
                message = "Chỉ hỗ trợ ảnh JPG, PNG hoặc WEBP hợp lệ."
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            UPDATE drivers
            SET avatar = @avatar,
                avatar_content_type = @type
            WHERE id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", DriverId);
        cmd.Parameters.AddWithValue("@avatar", bytes);
        cmd.Parameters.AddWithValue("@type", contentType);

        int rows = await cmd.ExecuteNonQueryAsync();

        if (rows == 0)
            return NotFound(new {
                message = "Không tìm thấy tài xế."
            });

        return Ok(new {
            message = "Cập nhật ảnh đại diện thành công."
        });
    }

    private static string? DetectImageType(byte[] data)
    {
        if (data.Length >= 4 &&
            data[0] == 0xFF &&
            data[1] == 0xD8 &&
            data[2] == 0xFF &&
            data[^2] == 0xFF &&
            data[^1] == 0xD9)
            return "image/jpeg";

        byte[] png = {137, 80, 78, 71, 13, 10, 26, 10};

        if (data.Length >= 24 &&
            data.AsSpan(0, 8).SequenceEqual(png) &&
            System.Text.Encoding.ASCII.GetString(
                data, 12, 4) == "IHDR")
            return "image/png";

        if (data.Length >= 16 &&
            System.Text.Encoding.ASCII.GetString(
                data, 0, 4) == "RIFF" &&
            System.Text.Encoding.ASCII.GetString(
                data, 8, 4) == "WEBP")
            return "image/webp";

        return null;
    }
}
