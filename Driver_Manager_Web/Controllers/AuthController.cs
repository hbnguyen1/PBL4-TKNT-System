using System.Security.Claims;
using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly Database db = new();

    public record LoginRequest(string Username, string Password);

    public record PasswordRequest(
        string CurrentPassword,
        string NewPassword,
        string ConfirmPassword
    );

    // ĐĂNG NHẬP
    [HttpPost("login")]
    [AllowAnonymous]
    public async Task<IActionResult> Login(LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) ||
            string.IsNullOrWhiteSpace(request.Password))
        {
            return BadRequest(new {
                message = "Vui lòng nhập tài khoản và mật khẩu."
            });
        }

        await using var conn = db.GetConnection();
        await conn.OpenAsync();

        await using var cmd = new MySqlCommand(
            @"SELECT id, username, password_hash
              FROM accounts
              WHERE username = @username
              LIMIT 1", conn);

        cmd.Parameters.AddWithValue("@username", request.Username.Trim());

        await using var reader = await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
            return Unauthorized(new {
                message = "Tài khoản hoặc mật khẩu không đúng."
            });

        string id = reader.GetString("id");
        string username = reader.GetString("username");
        string hash = reader.GetString("password_hash");

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
            return Unauthorized(new {
                message = "Tài khoản hoặc mật khẩu không đúng."
            });

        // Phân quyền theo mã tài khoản hiện tại
        string role = id == "AD-01" ? "Admin" : "Driver";

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, id),
            new Claim(ClaimTypes.Name, username),
            new Claim(ClaimTypes.Role, role)
        };

        var identity = new ClaimsIdentity(
            claims,
            CookieAuthenticationDefaults.AuthenticationScheme
        );

        await HttpContext.SignInAsync(
            CookieAuthenticationDefaults.AuthenticationScheme,
            new ClaimsPrincipal(identity)
        );

        return Ok(new {
            id,
            username,
            role,
            redirect = role == "Admin" ? "/" : "/driver.html"
        });
    }

    // LẤY THÔNG TIN TÀI KHOẢN
    [Authorize]
    [HttpGet("me")]
    public IActionResult Me()
    {
        return Ok(new {
            id = User.FindFirstValue(ClaimTypes.NameIdentifier),
            username = User.Identity?.Name,
            role = User.IsInRole("Admin") ? "Admin" : "Driver"
        });
    }

    // ĐĂNG XUẤT
    [Authorize]
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await HttpContext.SignOutAsync(
            CookieAuthenticationDefaults.AuthenticationScheme
        );

        return Ok(new { message = "Đăng xuất thành công." });
    }

    // ĐỔI MẬT KHẨU
    [Authorize]
    [HttpPost("change-password")]
    public async Task<IActionResult> ChangePassword(
        PasswordRequest request)
    {
        if (request.NewPassword != request.ConfirmPassword)
            return BadRequest(new {
                message = "Mật khẩu xác nhận không khớp."
            });

        if (string.IsNullOrEmpty(request.NewPassword) ||
            request.NewPassword.Length < 8 ||
            request.NewPassword.Length > 128)
            return BadRequest(new {
                message = "Mật khẩu mới phải có từ 8 đến 128 ký tự."
            });

        string? id = User.FindFirstValue(ClaimTypes.NameIdentifier);

        await using var conn = db.GetConnection();
        await conn.OpenAsync();

        await using var cmd = new MySqlCommand(
            "SELECT password_hash FROM accounts WHERE id = @id", conn);

        cmd.Parameters.AddWithValue("@id", id);

        string? oldHash = (string?)await cmd.ExecuteScalarAsync();

        bool valid = false;
        if (!string.IsNullOrEmpty(oldHash) &&
            !string.IsNullOrEmpty(request.CurrentPassword))
        {
            try
            {
                valid = BCrypt.Net.BCrypt.Verify(
                    request.CurrentPassword, oldHash);
            }
            catch { }
        }

        if (!valid)
            return BadRequest(new {
                message = "Mật khẩu hiện tại không đúng."
            });

        string newHash = BCrypt.Net.BCrypt.HashPassword(
            request.NewPassword);

        await using var update = new MySqlCommand(
            @"UPDATE accounts
              SET password_hash = @newHash
              WHERE id = @id AND password_hash = @oldHash", conn);

        update.Parameters.AddWithValue("@newHash", newHash);
        update.Parameters.AddWithValue("@oldHash", oldHash);
        update.Parameters.AddWithValue("@id", id);

        int rows = await update.ExecuteNonQueryAsync();

        if (rows == 0)
            return Conflict(new {
                message = "Tài khoản đã thay đổi. Vui lòng thử lại."
            });

        await HttpContext.SignOutAsync(
            CookieAuthenticationDefaults.AuthenticationScheme
        );

        return Ok(new {
            message = "Đổi mật khẩu thành công. Vui lòng đăng nhập lại."
        });
    }
}
