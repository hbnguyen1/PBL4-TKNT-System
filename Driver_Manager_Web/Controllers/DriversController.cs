using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Driver_Manager_Web.Models;
using System.Text.Json;
namespace Driver_Manager_Web.Controllers;

[ApiController]
[Route("api/drivers")]
public class DriversController : ControllerBase
{
    private readonly Database _db = new Database();

    private const long MaxAvatarSize = 5 * 1024 * 1024;

    // DTO nhận dữ liệu multipart/form-data
    public class DriverCreateForm
    {
        public string Driver { get; set; } = "";
        public string Account { get; set; } = "";
        public IFormFile? Avatar { get; set; }
    }

    public class DriverUpdateForm
    {
        public string Driver { get; set; } = "";
        public IFormFile? Avatar { get; set; }
    }

    // Kiểm tra chữ ký thực tế của ảnh
    private static string? GetImageContentType(byte[] data)
    {
        if (data.Length >= 3 &&
            data[0] == 0xFF &&
            data[1] == 0xD8 &&
            data[2] == 0xFF)
            return "image/jpeg";

        if (data.Length >= 8 &&
            data[0] == 0x89 &&
            data[1] == 0x50 &&
            data[2] == 0x4E &&
            data[3] == 0x47 &&
            data[4] == 0x0D &&
            data[5] == 0x0A &&
            data[6] == 0x1A &&
            data[7] == 0x0A)
            return "image/png";

        if (data.Length >= 12 &&
            data[0] == 0x52 &&
            data[1] == 0x49 &&
            data[2] == 0x46 &&
            data[3] == 0x46 &&
            data[8] == 0x57 &&
            data[9] == 0x45 &&
            data[10] == 0x42 &&
            data[11] == 0x50)
            return "image/webp";

        return null;
    }

    private static async Task<(byte[] Data, string ContentType)?>
        ReadAvatarAsync(IFormFile? file)
    {
        if (file == null || file.Length == 0)
            return null;

        if (file.Length > MaxAvatarSize)
            throw new InvalidDataException("Ảnh không được vượt quá 5MB");

        await using var ms = new MemoryStream();
        await file.CopyToAsync(ms);

        byte[] data = ms.ToArray();

        string? contentType = GetImageContentType(data);

        if (contentType == null)
            throw new InvalidDataException(
                "Ảnh phải có định dạng JPG, PNG hoặc WEBP");

        return (data, contentType);
    }

    // GET /api/drivers?search=Nguyen
    [HttpGet]
    public async Task<IActionResult> GetAll(string? search)
    {
        var result = new List<Driver>();

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT * FROM drivers
            WHERE @search = ''
               OR id LIKE @keyword
               OR full_name LIKE @keyword
               OR phone LIKE @keyword
            ORDER BY id
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@search", search ?? "");
        cmd.Parameters.AddWithValue("@keyword", $"%{search ?? ""}%");

        await using var reader = await cmd.ExecuteReaderAsync();

        while (await reader.ReadAsync())
            result.Add(ReadDriver(reader));

        return Ok(result);
    }

    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        await using var cmd = new MySqlCommand(
            "SELECT * FROM drivers WHERE id = @id", conn);

        cmd.Parameters.AddWithValue("@id", id);

        await using var reader = await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
            return NotFound(new { message = "Không tìm thấy tài xế" });

        return Ok(ReadDriver(reader));
    }

    // GET /api/drivers/TX-001/avatar
    // Lấy ảnh trực tiếp từ MySQL
    [HttpGet("{id}/avatar")]
    public async Task<IActionResult> GetAvatar(string id)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT avatar, avatar_content_type
            FROM drivers
            WHERE id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);

        await using var reader = await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
            return NotFound();

        if (reader["avatar"] == DBNull.Value)
            return NotFound(new { message = "Tài xế chưa có ảnh đại diện" });

        byte[] image = (byte[])reader["avatar"];

        string contentType = reader["avatar_content_type"] == DBNull.Value
            ? "application/octet-stream"
            : Convert.ToString(reader["avatar_content_type"])!;

        return File(image, contentType);
    }

    // POST /api/drivers
    // Thêm tài khoản và tài xế cùng lúc
    [HttpPost]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Create(
        [FromForm] DriverCreateForm request)
    {
        Driver? driver;
        User? account;

        try
        {
            var options = new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true
            };

            driver = JsonSerializer.Deserialize<Driver>(
                request.Driver, options);

            account = JsonSerializer.Deserialize<User>(
                request.Account, options);
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "JSON không hợp lệ" });
        }

        if (driver == null || account == null ||
            string.IsNullOrWhiteSpace(driver.Id) ||
            string.IsNullOrWhiteSpace(driver.FullName) ||
            string.IsNullOrWhiteSpace(account.Username) ||
            string.IsNullOrWhiteSpace(account.PasswordHash))
        {
            return BadRequest(new
            {
                message = "Thiếu thông tin bắt buộc"
            });
        }

        if (driver.Id.Length > 20 ||
            driver.FullName.Length > 100 ||
            account.Username.Length > 50 ||
            account.PasswordHash.Length < 8)
        {
            return BadRequest(new
            {
                message = "Mã, tên, username hoặc mật khẩu không hợp lệ"
            });
        }

        byte[]? avatarBytes = null;
        string? avatarContentType = null;

        try
        {
            var avatar = await ReadAvatarAsync(request.Avatar);

            if (avatar.HasValue)
            {
                avatarBytes = avatar.Value.Data;
                avatarContentType = avatar.Value.ContentType;
            }
        }
        catch (InvalidDataException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        try
        {
            const string accountSql = """
                INSERT INTO accounts(id, username, password_hash)
                VALUES (@id, @username, @password)
                """;

            await using (var cmd = new MySqlCommand(
                accountSql, conn, tx))
            {
                cmd.Parameters.AddWithValue("@id", driver.Id);
                cmd.Parameters.AddWithValue("@username", account.Username);
                cmd.Parameters.AddWithValue("@password",
                    BCrypt.Net.BCrypt.HashPassword(account.PasswordHash));

                await cmd.ExecuteNonQueryAsync();
            }

            const string driverSql = 
                """
                INSERT INTO drivers
                (
                    id, full_name, date_of_birth, address,
                    avatar, avatar_content_type,
                    phone, license_type, is_suspended
                )
                VALUES
                (
                    @id, @name, @dob, @address,
                    @avatar, @contentType,
                    @phone, @license, @suspended
                )
                """;

            await using (var cmd = new MySqlCommand(
                driverSql, conn, tx))
            {
                AddDriverParameters(cmd, driver);

                cmd.Parameters.AddWithValue("@avatar",
                    (object?)avatarBytes ?? DBNull.Value);

                cmd.Parameters.AddWithValue("@contentType",
                    (object?)avatarContentType ?? DBNull.Value);

                await cmd.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return CreatedAtAction(
                nameof(GetById),
                new { id = driver.Id },
                new
                {
                    message = "Thêm tài xế thành công",
                    driver.Id
                });
        }
        catch (MySqlException ex) when (ex.Number == 1062)
        {
            await tx.RollbackAsync();

            return Conflict(new
            {
                message = "Mã tài xế hoặc username đã tồn tại"
            });
        }
        catch
        {
            await tx.RollbackAsync();
            return Problem("Không thể thêm tài xế");
        }
    }

    // PUT /api/drivers/TX-001
    // Cập nhật thông tin và ảnh đại diện
    [HttpPut("{id}")]
    [Consumes("multipart/form-data")]
    public async Task<IActionResult> Update(
        string id,
        [FromForm] DriverUpdateForm request)
    {
        Driver? driver;

        try
        {
            driver = JsonSerializer.Deserialize<Driver>(
                request.Driver,
                new JsonSerializerOptions
                {
                    PropertyNameCaseInsensitive = true
                });
        }
        catch (JsonException)
        {
            return BadRequest(new { message = "JSON không hợp lệ" });
        }

        if (driver == null ||
            string.IsNullOrWhiteSpace(driver.FullName) ||
            driver.FullName.Length > 100 ||
            (!string.IsNullOrEmpty(driver.Id) && driver.Id != id))
        {
            return BadRequest(new
            {
                message = "Thông tin tài xế không hợp lệ"
            });
        }

        byte[]? avatarBytes = null;
        string? avatarContentType = null;

        try
        {
            var avatar = await ReadAvatarAsync(request.Avatar);

            if (avatar.HasValue)
            {
                avatarBytes = avatar.Value.Data;
                avatarContentType = avatar.Value.ContentType;
            }
        }
        catch (InvalidDataException ex)
        {
            return BadRequest(new { message = ex.Message });
        }

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = 
            """
            UPDATE drivers SET
                full_name = @name,
                date_of_birth = @dob,
                address = @address,
                avatar = COALESCE(@avatar, avatar),
                avatar_content_type =
                    COALESCE(@contentType, avatar_content_type),
                phone = @phone,
                license_type = @license,
                is_suspended = @suspended
            WHERE id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);

        driver.Id = id;
        AddDriverParameters(cmd, driver);

        cmd.Parameters.AddWithValue("@avatar",
            (object?)avatarBytes ?? DBNull.Value);

        cmd.Parameters.AddWithValue("@contentType",
            (object?)avatarContentType ?? DBNull.Value);

        int affected = await cmd.ExecuteNonQueryAsync();

        return affected == 0
            ? NotFound(new { message = "Không tìm thấy tài xế" })
            : Ok(new { message = "Cập nhật thành công" });
    }

    // PATCH /api/drivers/TX-001/suspension
    [HttpPatch("{id}/suspension")]
    public async Task<IActionResult> SetSuspension(
        string id, [FromBody] bool isSuspended)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            UPDATE drivers SET is_suspended = @status
            WHERE id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@status", isSuspended);

        int affected = await cmd.ExecuteNonQueryAsync();

        return affected == 0
            ? NotFound(new { message = "Không tìm thấy tài xế" })
            : Ok(new { message = "Cập nhật trạng thái thành công" });
    }

    // DELETE /api/drivers/TX-001
    [HttpDelete("{id}")]
    public async Task<IActionResult> Delete(string id)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        try
        {
            const string checkSql = """
                SELECT
                  (SELECT COUNT(*) FROM vehicles WHERE driver_id = @id)
                + (SELECT COUNT(*) FROM salarystructures WHERE driver_id = @id)
                + (SELECT COUNT(*) FROM demeritpoints WHERE driver_id = @id)
                """;

            await using (var check = new MySqlCommand(
                checkSql, conn, tx))
            {
                check.Parameters.AddWithValue("@id", id);

                long count = Convert.ToInt64(
                    await check.ExecuteScalarAsync());

                if (count > 0)
                {
                    return Conflict(new
                    {
                        message = "Tài xế còn xe, dữ liệu lương hoặc vi phạm"
                    });
                }
            }

            const string sql = """
                DELETE a FROM accounts a
                JOIN drivers d ON d.id = a.id
                WHERE a.id = @id
                """;

            await using var cmd = new MySqlCommand(sql, conn, tx);
            cmd.Parameters.AddWithValue("@id", id);

            int affected = await cmd.ExecuteNonQueryAsync();

            if (affected == 0)
            {
                return NotFound(new
                {
                    message = "Không tìm thấy tài xế"
                });
            }

            await tx.CommitAsync();

            return Ok(new { message = "Xóa tài xế thành công" });
        }
        catch
        {
            await tx.RollbackAsync();
            return Problem("Không thể xóa tài xế");
        }
    }

    // Đọc dữ liệu tài xế
    private static Driver ReadDriver(MySqlDataReader r)
    {
        // Kiểm tra cột có tồn tại trong kết quả truy vấn không
        bool HasColumn(string column)
        {
            try
            {
                r.GetOrdinal(column);
                return true;
            }
            catch (IndexOutOfRangeException)
            {
                return false;
            }
        }

        // Đọc dữ liệu an toàn
        string? Text(string column)
        {
            if (!HasColumn(column))
                return null;

            int ordinal = r.GetOrdinal(column);

            return r.IsDBNull(ordinal)
                ? null
                : Convert.ToString(r.GetValue(ordinal));
        }

        string id = Text("id") ?? "";

        // Kiểm tra ảnh BLOB
        bool hasAvatar = false;

        if (HasColumn("avatar"))
        {
            int avatarOrdinal = r.GetOrdinal("avatar");

            hasAvatar = !r.IsDBNull(avatarOrdinal);
        }

        return new Driver
        {
            Id = id,

            FullName = Text("full_name") ?? "",

            DateOfBirth = Text("date_of_birth") == null
                ? null
                : Convert.ToDateTime(r["date_of_birth"]),

            Address = Text("address"),

            // Ưu tiên ảnh lưu trực tiếp trong MySQL
            // Nếu không có BLOB thì dùng URL cũ nếu tồn tại
            AvatarUrl = hasAvatar
                ? $"/api/drivers/{Uri.EscapeDataString(id)}/avatar"
                : Text("avatar_url"),

            Phone = Text("phone"),

            LicenseType = Text("license_type"),

            IsSuspended = Convert.ToBoolean(
                r["is_suspended"]
            )
        };
    }

    // Gán tham số SQL
    private static void AddDriverParameters(
        MySqlCommand cmd, Driver driver)
    {
        cmd.Parameters.AddWithValue("@id", driver.Id);
        cmd.Parameters.AddWithValue("@name", driver.FullName);

        cmd.Parameters.AddWithValue("@dob",
            (object?)driver.DateOfBirth ?? DBNull.Value);

        cmd.Parameters.AddWithValue("@address",
            (object?)driver.Address ?? DBNull.Value);

        cmd.Parameters.AddWithValue("@phone",
            (object?)driver.Phone ?? DBNull.Value);

        cmd.Parameters.AddWithValue("@license",
            (object?)driver.LicenseType ?? DBNull.Value);

        cmd.Parameters.AddWithValue("@suspended",
            driver.IsSuspended);
    }

    // GET /api/drivers/TX-001/demerits
    [HttpGet("{id}/demerits")]
    public async Task<IActionResult> GetDemerits(string id)
    {
        var result = new List<object>();

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT id, violation, points_deducted, violated_at
            FROM demeritpoints
            WHERE driver_id = @id
            ORDER BY violated_at DESC, id DESC
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);

        await using var reader = await cmd.ExecuteReaderAsync();

        while (await reader.ReadAsync())
        {
            result.Add(new
            {
                id = reader.GetInt32("id"),
                violation = reader.GetString("violation"),
                pointsDeducted = reader.GetInt32("points_deducted"),
                violatedAt = reader.GetDateTime("violated_at")
                    .ToString("yyyy-MM-ddTHH:mm")
            });
        }

        return Ok(result);
    }
}
