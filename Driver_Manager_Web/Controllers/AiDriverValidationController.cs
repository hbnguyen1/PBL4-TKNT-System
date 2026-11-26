using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers;

// Internal service-to-service endpoint. Not a browser login endpoint.
[ApiController]
[Route("api/ai-stream/internal")]
public sealed class AiDriverValidationController : ControllerBase
{
    private readonly IConfiguration _config;
    private readonly Database _database = new();

    public AiDriverValidationController(IConfiguration config) => _config = config;

    private bool HasServiceKey()
    {
        var configuredKey = _config["AiStream:ServiceKey"];
        var providedKey = Request.Headers["X-PBL4-Service-Key"].ToString();
        return !string.IsNullOrWhiteSpace(configuredKey) && !string.IsNullOrWhiteSpace(providedKey)
            && CryptographicOperations.FixedTimeEquals(
                SHA256.HashData(Encoding.UTF8.GetBytes(configuredKey)),
                SHA256.HashData(Encoding.UTF8.GetBytes(providedKey)));
    }

    private byte[] SignEvidenceSession(string driverId, string plate, Guid sessionId)
    {
        var key = Encoding.UTF8.GetBytes(_config["AiStream:ServiceKey"]!);
        var payload = Encoding.UTF8.GetBytes($"pbl4-evidence\n{sessionId:N}\n{driverId}\n{plate}");
        return HMACSHA256.HashData(key, payload);
    }

    private bool ValidEvidenceSession(string signature, string driverId, string plate, Guid sessionId)
    {
        if (signature.Length != 64) return false;
        Span<byte> bytes = stackalloc byte[32];
        return Convert.FromHexString(signature.AsSpan(), bytes, out _, out var written) == System.Buffers.OperationStatus.Done
            && written == bytes.Length
            && CryptographicOperations.FixedTimeEquals(bytes, SignEvidenceSession(driverId, plate, sessionId));
    }

    [HttpPost("driving-events")]
    [RequestSizeLimit(1_100_000)]
    public async Task<IActionResult> SaveEvent([FromForm] Guid eventId, [FromForm] Guid sessionId,
        [FromForm] string driverId, [FromForm] string vehiclePlate, [FromForm] DateTimeOffset capturedAt,
        [FromForm] string? evidenceSession, [FromForm] string? eventType, IFormFile image, CancellationToken ct)
    {
        if (!HasServiceKey()) return Unauthorized();
        if (eventId == Guid.Empty || sessionId == Guid.Empty || capturedAt == default ||
            eventType is not (null or "phone_use" or "drowsy") ||
            !Regex.IsMatch(driverId, @"\ATX-?\d{1,12}\z", RegexOptions.CultureInvariant) ||
            string.IsNullOrWhiteSpace(vehiclePlate) || vehiclePlate.Length > 32 ||
            image.Length is < 4 or > 1_000_000)
            return BadRequest();

        var verifiedSession = evidenceSession is not null;
        if (verifiedSession && !ValidEvidenceSession(evidenceSession!, driverId, vehiclePlate, sessionId))
            return BadRequest();

        if (eventType is null) return NoContent();

        using var buffer = new MemoryStream();
        await image.CopyToAsync(buffer, ct);
        var jpeg = buffer.ToArray();
        if (jpeg[0] != 0xff || jpeg[1] != 0xd8 || jpeg[^2] != 0xff || jpeg[^1] != 0xd9)
            return BadRequest();

        await using var conn = _database.GetConnection();
        await conn.OpenAsync(ct);
        const string sql = """
            INSERT INTO ai_driving_events
                (event_id, driver_id, vehicle_plate, session_id, captured_utc, evidence_jpeg, event_type, review_status)
            SELECT @event, @driver, @plate, @session, @captured, @jpeg, @type, 'pending'
            WHERE @verifiedSession = 1 OR EXISTS (
                SELECT 1 FROM vehicles
                WHERE license_plate = @plate AND driver_id = @driver
            )
            ON DUPLICATE KEY UPDATE id = id
            """;
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@verifiedSession", verifiedSession ? 1 : 0);
        cmd.Parameters.AddWithValue("@event", eventId.ToString("N"));
        cmd.Parameters.AddWithValue("@driver", driverId);
        cmd.Parameters.AddWithValue("@plate", vehiclePlate);
        cmd.Parameters.AddWithValue("@session", sessionId.ToString("N"));
        cmd.Parameters.AddWithValue("@captured", capturedAt.UtcDateTime);
        cmd.Parameters.AddWithValue("@jpeg", jpeg);
        cmd.Parameters.AddWithValue("@type", eventType);
        await cmd.ExecuteNonQueryAsync(ct);

        cmd.CommandText = """
            SELECT 1 FROM ai_driving_events WHERE event_id = @event AND driver_id = @driver
                AND vehicle_plate = @plate AND session_id = @session AND event_type <=> @type
            """;
        return await cmd.ExecuteScalarAsync(ct) is null ? Conflict() : Ok();
    }

    public sealed record ValidateDriverRequest(string? DriverId);

    [HttpPost("validate-driver")]
    public async Task<IActionResult> ValidateDriver([FromBody] ValidateDriverRequest request, CancellationToken cancellationToken)
    {
        Response.Headers.CacheControl = "no-store";
        if (!HasServiceKey())
            return Unauthorized(new { message = "Invalid AI service key." });

        var id = request.DriverId?.Trim().ToUpperInvariant();
        if (id is null || !Regex.IsMatch(id, @"\ATX-?\d{1,12}\z", RegexOptions.CultureInvariant))
            return BadRequest(new { message = "Invalid driver ID." });

        await using var connection = _database.GetConnection();
        await connection.OpenAsync(cancellationToken);
        const string sql = """
            SELECT d.id, d.full_name, d.is_suspended, v.license_plate
            FROM drivers d
            LEFT JOIN vehicles v ON v.driver_id = d.id
            WHERE d.id = @driverId
            LIMIT 2
            """;
        await using var command = new MySqlCommand(sql, connection);
        command.Parameters.AddWithValue("@driverId", id);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
            return NotFound(new { message = "Driver not found." });
        var name = reader.GetString(1);
        var suspended = reader.GetBoolean(2);
        var plate = reader.IsDBNull(3) ? null : reader.GetString(3);
        if (await reader.ReadAsync(cancellationToken))
            return Conflict(new { message = "Driver is assigned to multiple vehicles." });
        if (suspended)
            return Conflict(new { message = "Driver is suspended." });
        if (string.IsNullOrWhiteSpace(plate))
            return Conflict(new { message = "Driver has no assigned vehicle." });
        plate = plate.Trim();
        var sessionId = Guid.NewGuid();
        return Ok(new
        {
            driverId = id,
            driverName = name,
            vehiclePlate = plate,
            sessionId = sessionId.ToString("N"),
            evidenceSession = Convert.ToHexString(SignEvidenceSession(id, plate, sessionId))
        });
    }
}
