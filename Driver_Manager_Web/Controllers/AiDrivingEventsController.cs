using System.Data;
using System.Security.Claims;
using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Authorize(Roles = "Admin,Driver")]
[Route("api/ai-driving-events")]
public sealed class AiDrivingEventsController : ControllerBase
{
    private readonly Database _database = new();

    [HttpGet]
    public async Task<IActionResult> List(string? driverId, long? before, string? type, string? search,
        int? month, int? year, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        var admin = User.IsInRole("Admin");
        var owner = admin ? driverId?.Trim() : User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!admin && string.IsNullOrWhiteSpace(owner)) return Forbid();
        if (type is not (null or "phone_use" or "drowsy" or "violations") || month is < 1 or > 12 || year is < 1 or > 9999 ||
            search?.Length > 100 || (admin && string.IsNullOrWhiteSpace(owner) && type is null))
            return BadRequest();

        await using var conn = _database.GetConnection();
        await conn.OpenAsync(ct);
        var canDelete = ViolationPeriod.CanDeleteSql("e.driver_id", "DATE_ADD(e.captured_utc, INTERVAL 7 HOUR)");
        var sql = $"""
            SELECT e.id, e.vehicle_plate, e.captured_utc, e.event_id, e.driver_id,
                   d.full_name, e.event_type, e.review_status, e.points_deducted,
                   CASE WHEN e.review_status = 'approved' THEN e.points_deducted ELSE 0 END,
                   (@admin = 1 AND e.event_type IN ('phone_use', 'drowsy') AND {canDelete})
            FROM ai_driving_events e
            LEFT JOIN drivers d ON d.id = e.driver_id
            WHERE e.deleted_utc IS NULL AND (@driver IS NULL OR e.driver_id = @driver) AND e.id < @before
              AND (@type IS NULL OR e.event_type = @type
                   OR (@type = 'violations' AND e.event_type IN ('phone_use', 'drowsy')))
              AND (@search IS NULL OR LOCATE(@search, e.driver_id) > 0 OR LOCATE(@search, d.full_name) > 0)
              AND (@month IS NULL OR MONTH(DATE_ADD(e.captured_utc, INTERVAL 7 HOUR)) = @month)
              AND (@year IS NULL OR YEAR(DATE_ADD(e.captured_utc, INTERVAL 7 HOUR)) = @year)
            ORDER BY e.id DESC
            LIMIT 21
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@driver", string.IsNullOrWhiteSpace(owner) ? null : owner);
        cmd.Parameters.AddWithValue("@before", before ?? long.MaxValue);
        cmd.Parameters.AddWithValue("@type", type);
        cmd.Parameters.AddWithValue("@admin", admin ? 1 : 0);
        cmd.Parameters.AddWithValue("@search", string.IsNullOrWhiteSpace(search) ? null : search.Trim());
        cmd.Parameters.AddWithValue("@month", month);
        cmd.Parameters.AddWithValue("@year", year);
        var rows = new List<DrivingEvent>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
            rows.Add(new(reader.GetInt64(0), reader.GetString(1),
                DateTime.SpecifyKind(reader.GetDateTime(2), DateTimeKind.Utc),
                reader.GetString(3), reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6),
                reader.IsDBNull(7) ? null : reader.GetString(7), reader.GetInt32(8), reader.GetInt32(9),
                !reader.IsDBNull(10) && reader.GetBoolean(10)));
        return Ok(new { events = rows.Take(20), nextBefore = rows.Count > 20 ? rows[19].Id : (long?)null });
    }

    [Authorize(Roles = "Admin")]
    [HttpPost("{id:long}/review")]
    [Consumes("application/json")]
    public async Task<IActionResult> Review(long id, ReviewRequest request, CancellationToken ct)
    {
        if (request.Status is not ("approved" or "rejected"))
            return BadRequest();
        var reviewer = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(reviewer)) return Forbid();

        await using var conn = _database.GetConnection();
        await conn.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var record = await LockEvent(conn, tx, id, ct);
        if (record is null || record.Deleted) return NotFound();
        if (record.Status == request.Status) return NoContent();
        if (record.Status != "pending") return Conflict(new { status = record.Status });
        if (request.Status == "approved" &&
            await ViolationPeriod.IsPaid(conn, tx, record.DriverId, record.OccurredLocal, ct))
            return Conflict(new { message = ViolationPeriod.ApprovalLockedMessage });

        const string sql = """
            UPDATE ai_driving_events
            SET review_status = @status, reviewed_utc = UTC_TIMESTAMP(6), reviewed_by = @reviewer
            WHERE id = @id AND review_status = 'pending' AND deleted_utc IS NULL
            """;
        await using var cmd = new MySqlCommand(sql, conn, tx);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@status", request.Status);
        cmd.Parameters.AddWithValue("@reviewer", reviewer);
        if (await cmd.ExecuteNonQueryAsync(ct) != 1) return Conflict();
        await tx.CommitAsync(ct);
        return NoContent();
    }

    public sealed record ReviewRequest(string? Status);

    [Authorize(Roles = "Admin")]
    [HttpDelete("{id:long}")]
    public async Task<IActionResult> Delete(long id, CancellationToken ct)
    {
        var actor = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (string.IsNullOrWhiteSpace(actor)) return Forbid();
        await using var conn = _database.GetConnection();
        await conn.OpenAsync(ct);
        await using var tx = await conn.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var record = await LockEvent(conn, tx, id, ct);
        if (record is null) return NotFound();
        if (record.Deleted) return NoContent();
        if (!ViolationPeriod.IsCurrentMonth(record.OccurredLocal) ||
            await ViolationPeriod.IsPaid(conn, tx, record.DriverId, record.OccurredLocal, ct))
            return Conflict(new { message = ViolationPeriod.LockedMessage });

        const string sql = """
            UPDATE ai_driving_events
            SET deleted_utc = UTC_TIMESTAMP(6), deleted_by = @actor
            WHERE id = @id AND deleted_utc IS NULL
            """;
        await using var cmd = new MySqlCommand(sql, conn, tx);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@actor", actor);
        if (await cmd.ExecuteNonQueryAsync(ct) != 1) return Conflict();
        await tx.CommitAsync(ct);
        return NoContent();
    }

    [HttpGet("{id:long}/image")]
    public async Task<IActionResult> Image(long id, CancellationToken ct)
    {
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        var admin = User.IsInRole("Admin");
        var owner = User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!admin && string.IsNullOrWhiteSpace(owner))
            return Forbid();

        await using var conn = _database.GetConnection();
        await conn.OpenAsync(ct);
        const string sql = """
            SELECT evidence_jpeg FROM ai_driving_events
            WHERE id = @id AND deleted_utc IS NULL AND (@admin = 1 OR driver_id = @driver)
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@id", id);
        cmd.Parameters.AddWithValue("@admin", admin ? 1 : 0);
        cmd.Parameters.AddWithValue("@driver", owner ?? "");
        return await cmd.ExecuteScalarAsync(ct) is byte[] jpeg
            ? File(jpeg, "image/jpeg")
            : NotFound();
    }

    private static async Task<LockedEvent?> LockEvent(MySqlConnection connection, MySqlTransaction tx,
        long id, CancellationToken ct)
    {
        const string ownerSql = """
            SELECT driver_id FROM ai_driving_events
            WHERE id = @id AND event_type IN ('phone_use', 'drowsy')
            """;
        await using var query = new MySqlCommand(ownerSql, connection, tx);
        query.Parameters.AddWithValue("@id", id);
        var driverId = await query.ExecuteScalarAsync(ct) as string;
        if (driverId is null || !await ViolationPeriod.LockDriver(connection, tx, driverId, ct))
            return null;

        query.CommandText = """
            SELECT DATE_ADD(captured_utc, INTERVAL 7 HOUR), review_status, deleted_utc
            FROM ai_driving_events WHERE id = @id
            """;
        await using var reader = await query.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return new LockedEvent(driverId, reader.GetDateTime(0), reader.IsDBNull(1) ? null : reader.GetString(1),
            !reader.IsDBNull(2));
    }

    private sealed record LockedEvent(string DriverId, DateTime OccurredLocal, string? Status, bool Deleted);

    private sealed record DrivingEvent(long Id, string VehiclePlate, DateTime CapturedAt,
        string EventId, string DriverId, string? DriverName, string? EventType, string? ReviewStatus,
        int RulePoints, int PointsDeducted, bool CanDelete);
}
