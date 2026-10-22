
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
        cmd.Parameters.AddWithValue("@keyword", $"%{search}%");

        await using var reader = await cmd.ExecuteReaderAsync();

        while (await reader.ReadAsync())
            result.Add(ReadDriver(reader));

        return Ok(result);
    }

    // GET /api/drivers/TX-001
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

    // POST /api/drivers
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] JsonElement body)
    {
        if (!body.TryGetProperty("driver", out var driverJson) ||
            !body.TryGetProperty("account", out var accountJson))
            return BadRequest(new {
                message = "Cần có driver và account"
            });

        Driver? driver;
        User? account;

        try
        {
            var options = new JsonSerializerOptions {
                PropertyNameCaseInsensitive = true
            };

            driver = driverJson.Deserialize<Driver>(options);
            account = accountJson.Deserialize<User>(options);
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
            return BadRequest(new {
                message = "Thiếu thông tin bắt buộc"
            });

        if (driver.Id.Length > 20 ||
            driver.FullName.Length > 100 ||
            account.Username.Length > 50 ||
            account.PasswordHash.Length < 8)
            return BadRequest(new {
                message = "Mã, tên, username hoặc mật khẩu không hợp lệ"
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        try
        {
            const string accountSql = """
                INSERT INTO accounts(id, username, password_hash)
                VALUES (@id, @username, @password)
                """;

            await using (var cmd = new MySqlCommand(accountSql, conn, tx))
            {
                cmd.Parameters.AddWithValue("@id", driver.Id);
                cmd.Parameters.AddWithValue("@username", account.Username);
                cmd.Parameters.AddWithValue("@password",
                    BCrypt.Net.BCrypt.HashPassword(account.PasswordHash));
                await cmd.ExecuteNonQueryAsync();
            }

            const string driverSql = """
                INSERT INTO drivers
                (id, full_name, date_of_birth, address,
                 avatar_url, phone, license_type, is_suspended)
                VALUES
                (@id, @name, @dob, @address,
                 @avatar, @phone, @license, @suspended)
                """;

            await using (var cmd = new MySqlCommand(driverSql, conn, tx))
            {
                AddDriverParameters(cmd, driver);
                await cmd.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();

            return CreatedAtAction(nameof(GetById),
                new { id = driver.Id },
                new { message = "Thêm tài xế thành công", driver.Id });
        }
        catch (MySqlException ex) when (ex.Number == 1062)
        {
            await tx.RollbackAsync();
            return Conflict(new {
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
    [HttpPut("{id}")]
    public async Task<IActionResult> Update(
        string id, [FromBody] Driver driver)
    {
        if (string.IsNullOrWhiteSpace(driver.FullName) ||
            driver.FullName.Length > 100 ||
            (!string.IsNullOrEmpty(driver.Id) && driver.Id != id))
            return BadRequest(new {
                message = "Thông tin tài xế không hợp lệ"
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            UPDATE drivers SET
                full_name = @name,
                date_of_birth = @dob,
                address = @address,
                avatar_url = @avatar,
                phone = @phone,
                license_type = @license,
                is_suspended = @suspended
            WHERE id = @id
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        driver.Id = id;
        AddDriverParameters(cmd, driver);

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

            await using (var check = new MySqlCommand(checkSql, conn, tx))
            {
                check.Parameters.AddWithValue("@id", id);
                long count = Convert.ToInt64(
                    await check.ExecuteScalarAsync());

                if (count > 0)
                    return Conflict(new {
                        message = "Tài xế còn xe, dữ liệu lương hoặc vi phạm"
                    });
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
                return NotFound(new {
                    message = "Không tìm thấy tài xế"
                });

            await tx.CommitAsync();
            return Ok(new { message = "Xóa tài xế thành công" });
        }
        catch
        {
            await tx.RollbackAsync();
            return Problem("Không thể xóa tài xế");
        }
    }

    private static Driver ReadDriver(MySqlDataReader r)
    {
        string? Text(string column) =>
            r[column] == DBNull.Value
                ? null : Convert.ToString(r[column]);

        return new Driver
        {
            Id = Text("id") ?? "",
            FullName = Text("full_name") ?? "",
            DateOfBirth = r["date_of_birth"] == DBNull.Value
                ? null : Convert.ToDateTime(r["date_of_birth"]),
            Address = Text("address"),
            AvatarUrl = Text("avatar_url"),
            Phone = Text("phone"),
            LicenseType = Text("license_type"),
            IsSuspended = Convert.ToBoolean(r["is_suspended"])
        };
    }

    private static void AddDriverParameters(
        MySqlCommand cmd, Driver driver)
    {
        cmd.Parameters.AddWithValue("@id", driver.Id);
        cmd.Parameters.AddWithValue("@name", driver.FullName);
        cmd.Parameters.AddWithValue("@dob",
            (object?)driver.DateOfBirth ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@address",
            (object?)driver.Address ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@avatar",
            (object?)driver.AvatarUrl ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@phone",
            (object?)driver.Phone ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@license",
            (object?)driver.LicenseType ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@suspended", driver.IsSuspended);
    }
    
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
