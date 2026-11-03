using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Driver_Manager_Web.Models;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Route("api/accounts")]
public class AccountController : ControllerBase
{
    private readonly Database _db = new Database();

    // GET: /api/accounts/check-username?username=admin
    [HttpGet("check-username")]
    public async Task<IActionResult> CheckUsername(string username)
    {
        if (string.IsNullOrWhiteSpace(username))
        {
            return BadRequest(new
            {
                message = "Username không được để trống!"
            });
        }

        using var conn = _db.GetConnection();
        await conn.OpenAsync();

        string sql = @"
            SELECT COUNT(*)
            FROM accounts
            WHERE username = @username";

        using var cmd = new MySqlCommand(sql, conn);

        cmd.Parameters.AddWithValue(
            "@username",
            username.Trim()
        );

        int count = Convert.ToInt32(
            await cmd.ExecuteScalarAsync()
        );

        return Ok(new
        {
            exists = count > 0
        });
    }

    // GET: /api/accounts
    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        using var conn = _db.GetConnection();
        await conn.OpenAsync();

        string sql = @"
            SELECT id, username
            FROM accounts
            ORDER BY id";

        using var cmd = new MySqlCommand(sql, conn);
        using var reader = await cmd.ExecuteReaderAsync();

        var accounts = new List<object>();

        while (await reader.ReadAsync())
        {
            accounts.Add(new
            {
                id = reader["id"].ToString(),
                username = reader["username"].ToString()
            });
        }

        return Ok(accounts);
    }

    // GET: /api/accounts/{id}
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id)
    {
        using var conn = _db.GetConnection();
        await conn.OpenAsync();

        string sql = @"
            SELECT id, username
            FROM accounts
            WHERE id = @id";

        using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);

        using var reader = await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
        {
            return NotFound(new
            {
                message = "Không tìm thấy tài khoản!"
            });
        }

        return Ok(new
        {
            id = reader["id"].ToString(),
            username = reader["username"].ToString()
        });
    }
}