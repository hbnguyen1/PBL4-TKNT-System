using System.Net;
using System.Buffers;
using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;
using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Authorize(Roles = "Admin")]
[Route("api/ai-stream")]
public sealed class AiStreamController : ControllerBase
{
    private readonly IHttpClientFactory _factory;
    private readonly IConfiguration _config;
    private readonly Database _db = new();

    public AiStreamController(IHttpClientFactory factory, IConfiguration config)
    {
        _factory = factory;
        _config = config;
    }

    private HttpClient Client() => _factory.CreateClient("AiStream");

    private void AddKey(HttpRequestMessage request)
    {
        var key = _config["AiStream:StreamKey"];
        if (!string.IsNullOrEmpty(key))
            request.Headers.TryAddWithoutValidation("X-AI-Stream-Key", key);
    }

    private async Task<(string? DriverId, string? SessionId, bool Ready)> ReadStatus(CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(3));
        using var req = new HttpRequestMessage(HttpMethod.Get, "status");
        AddKey(req);
        using var resp = await Client().SendAsync(req, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(timeout.Token));
        var obj = doc.RootElement;
        string? Str(string key) => obj.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.String ? el.GetString() : null;
        bool ready = obj.TryGetProperty("ready", out var r) && r.ValueKind == JsonValueKind.True;
        return (Str("driver_id"), Str("session_id"), ready);
    }

    private async Task<bool> IsAssigned(string plate, string driverId, CancellationToken ct)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync(ct);
        const string sql = "SELECT COUNT(*) FROM vehicles WHERE license_plate = @plate AND driver_id = @driver";
        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@plate", plate);
        cmd.Parameters.AddWithValue("@driver", driverId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync(ct)) > 0;
    }

    [HttpGet("vehicles/{plate}/status")]
    public async Task<IActionResult> VehicleStatus(string plate, CancellationToken ct)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            var s = await ReadStatus(ct);
            var matches = !string.IsNullOrWhiteSpace(s.DriverId) &&
                await IsAssigned(plate, s.DriverId, ct);
            return Ok(new { ready = s.Ready && matches && !string.IsNullOrEmpty(s.SessionId),
                active = matches, driverId = matches ? s.DriverId : null,
                sessionId = matches ? s.SessionId : null,
                message = !matches ? "Chưa có tài xế đang phát video cho xe này" :
                          !s.Ready ? "Camera đang chờ khôi phục" : "Đang truyền video AI" });
        }
        catch (HttpRequestException) { return StatusCode(503, new { ready = false, message = "Python StreamHub chưa kết nối" }); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            return new EmptyResult();
        }
        catch (OperationCanceledException)
        {
            return StatusCode(503, new { ready = false, message = "StreamHub phản hồi quá chậm" });
        }
    }

    [HttpGet("vehicles/{plate}/stream")]
    public async Task Stream(string plate, [FromQuery] string sessionId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(sessionId)) { Response.StatusCode = 400; return; }
        try
        {
            var s = await ReadStatus(ct);
            if (!s.Ready || s.SessionId != sessionId || string.IsNullOrWhiteSpace(s.DriverId) ||
                !await IsAssigned(plate, s.DriverId, ct))
            { Response.StatusCode = 404; return; }

            using var req = new HttpRequestMessage(HttpMethod.Get,
                "stream/" + Uri.EscapeDataString(s.DriverId) + "?session_id=" + Uri.EscapeDataString(sessionId));
            AddKey(req);
            using var upstream = await Client().SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!upstream.IsSuccessStatusCode) { Response.StatusCode = (int)upstream.StatusCode; return; }
            Response.StatusCode = 200;
            Response.Headers.CacheControl = "no-store, no-cache, must-revalidate";
            Response.Headers["X-Content-Type-Options"] = "nosniff";
            Response.ContentType = upstream.Content.Headers.ContentType?.ToString()
                ?? "multipart/x-mixed-replace; boundary=frame";
            HttpContext.Features.Get<IHttpResponseBodyFeature>()?.DisableBuffering();
            await using var body = await upstream.Content.ReadAsStreamAsync(ct);
            var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
            var lastAssignmentCheck = Stopwatch.GetTimestamp();
            try
            {
                while (!ct.IsCancellationRequested)
                {
                    using var idle = CancellationTokenSource.CreateLinkedTokenSource(ct);
                    idle.CancelAfter(TimeSpan.FromSeconds(10));
                    var count = await body.ReadAsync(buffer.AsMemory(), idle.Token);
                    if (count == 0) break;
                    if (Stopwatch.GetElapsedTime(lastAssignmentCheck) >= TimeSpan.FromSeconds(2))
                    {
                        if (!await IsAssigned(plate, s.DriverId, idle.Token)) break;
                        lastAssignmentCheck = Stopwatch.GetTimestamp();
                    }
                    await Response.Body.WriteAsync(buffer.AsMemory(0, count), idle.Token);
                    await Response.Body.FlushAsync(idle.Token);
                }
            }
            finally { ArrayPool<byte>.Shared.Return(buffer); }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { }
        catch (OperationCanceledException) { if (!Response.HasStarted) Response.StatusCode = 503; }
        catch (HttpRequestException) { if (!Response.HasStarted) Response.StatusCode = 503; }
        catch (IOException) { if (!Response.HasStarted) Response.StatusCode = 503; }
    }
}
