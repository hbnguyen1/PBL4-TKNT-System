using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Driver_Manager_Web.Models;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly Database _db = new();

    public record LoginRequest(string Username, string Password);

    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) ||
            string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { message = "Nhập tài khoản và mật khẩu." });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT a.id, a.username, a.password_hash,
                   d.id AS driver_id
            FROM accounts a
            LEFT JOIN drivers d ON d.id = a.id
            WHERE a.username = @username
            LIMIT 1
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@username", request.Username.Trim());

        await using var reader = await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
            return Unauthorized(new { message = "Sai tài khoản hoặc mật khẩu." });

        string id = reader.GetString("id");
        string username = reader.GetString("username");
        string hash = reader.GetString("password_hash");
        bool isDriver = !reader.IsDBNull(reader.GetOrdinal("driver_id"));

        bool valid;
        try
        {
            valid = BCrypt.Net.BCrypt.Verify(request.Password, hash);
        }
        catch
        {
            valid = false;
        }

        if (!valid)
            return Unauthorized(new { message = "Sai tài khoản hoặc mật khẩu." });

        // Tài khoản không thuộc drivers được tạm coi là Admin.
        // Cần thay bằng role thực tế trước khi cấp quyền quản trị.
        string role = isDriver ? "Driver" : "Unassigned";

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, id),
            new(ClaimTypes.Name, username),
            new(ClaimTypes.Role, role)
        };

        var identity = new ClaimsIdentity(
            claims,
            CookieAuthenticationDefaults.AuthenticationScheme
        );

        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity),
            new AuthenticationProperties
            {
                IsPersistent = false,
                ExpiresUtc = DateTimeOffset.UtcNow.AddHours(8)
            }
        );

        return Ok(new
        {
            id,
            username,
            role,
            redirectUrl = isDriver
                ? "/driver/index.html"
                : "/login/Login.html"
        });
    }

    [HttpGet("me")]
    [Authorize]
    public IActionResult Me()
    {
        return Ok(new
        {
            id = User.FindFirstValue(ClaimTypes.NameIdentifier),
            username = User.Identity?.Name,
            role = User.FindFirstValue(ClaimTypes.Role)
        });
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(
            CookieAuthenticationDefaults.AuthenticationScheme
        );

        return Ok(new { message = "Đăng xuất thành công." });
    }
}
