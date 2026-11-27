using System.Data;
using MySqlConnector;

namespace Driver_Manager_Web.Models;

internal static class DisciplinaryHistory
{
    private const int PageSize = 10;

    private const string History = """
        WITH history AS (
            SELECT id, 'demerit' AS record_source, violation, points_deducted, violated_at,
                   NULL AS license_plate, driver_id
            FROM demeritpoints WHERE driver_id = @driver AND deleted_utc IS NULL
            UNION ALL
            SELECT id, 'ai', CASE event_type WHEN 'phone_use' THEN 'Sử dụng điện thoại' ELSE 'Buồn ngủ' END,
                   points_deducted, DATE_ADD(captured_utc, INTERVAL 7 HOUR), vehicle_plate, driver_id
            FROM ai_driving_events
            WHERE driver_id = @driver AND event_type IN ('phone_use', 'drowsy')
              AND review_status = 'approved' AND deleted_utc IS NULL
        )
        """;

    internal sealed record Entry(long Id, string Source, string Violation, int PointsDeducted,
        string ViolatedAt, string? LicensePlate, string? ImageUrl, string Status, bool CanDelete);

    internal sealed record Page(IReadOnlyList<Entry> Items, long TotalPoints,
        int PageNumber, int TotalPages, long TotalCount);

    internal static async Task<Page> ReadPage(MySqlConnection connection, string driverId,
        int page, CancellationToken ct)
    {
        // Keep the page and its counts consistent if another admin changes the history.
        await using var tx = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, ct);
        await using var stats = new MySqlCommand(History + """

            SELECT COUNT(*), COALESCE(SUM(points_deducted), 0) FROM history
            """, connection, tx);
        stats.Parameters.AddWithValue("@driver", driverId);
        long count;
        long points;
        await using (var reader = await stats.ExecuteReaderAsync(ct))
        {
            await reader.ReadAsync(ct);
            count = reader.GetInt64(0);
            points = reader.GetInt64(1);
        }

        var totalPages = Math.Max(1, (int)Math.Ceiling(count / (double)PageSize));
        page = Math.Clamp(page, 1, totalPages);
        var canDelete = ViolationPeriod.CanDeleteSql("history.driver_id", "history.violated_at");
        await using var query = new MySqlCommand(History + $"""

            SELECT id, record_source, violation, points_deducted, violated_at, license_plate,
                   (@manage = 1 AND {canDelete})
            FROM history
            ORDER BY violated_at DESC, id DESC, record_source
            LIMIT @limit OFFSET @offset
            """, connection, tx);
        query.Parameters.AddWithValue("@driver", driverId);
        query.Parameters.AddWithValue("@manage", 1);
        query.Parameters.AddWithValue("@limit", PageSize);
        query.Parameters.AddWithValue("@offset", (page - 1L) * PageSize);
        var items = await ReadEntries(query, ct);
        await tx.CommitAsync(ct);
        return new Page(items, points, page, totalPages, count);
    }

    internal static async Task<IReadOnlyList<Entry>> ReadAll(MySqlConnection connection, string driverId,
        int? month, int? year, CancellationToken ct, bool canManage = false)
    {
        var canDelete = ViolationPeriod.CanDeleteSql("history.driver_id", "history.violated_at");
        await using var query = new MySqlCommand(History + $"""

            SELECT id, record_source, violation, points_deducted, violated_at, license_plate,
                   (@manage = 1 AND {canDelete})
            FROM history
            WHERE (@month IS NULL OR MONTH(violated_at) = @month)
              AND (@year IS NULL OR YEAR(violated_at) = @year)
            ORDER BY violated_at DESC, id DESC, record_source
            """, connection);
        query.Parameters.AddWithValue("@driver", driverId);
        query.Parameters.AddWithValue("@month", month);
        query.Parameters.AddWithValue("@year", year);
        query.Parameters.AddWithValue("@manage", canManage ? 1 : 0);
        return await ReadEntries(query, ct);
    }

    private static async Task<IReadOnlyList<Entry>> ReadEntries(MySqlCommand query, CancellationToken ct)
    {
        var items = new List<Entry>();
        await using var reader = await query.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var id = reader.GetInt64(0);
            var source = reader.GetString(1);
            var recordedAt = reader.GetDateTime(4).ToString("yyyy-MM-ddTHH:mm:ss");
            if (source == "ai") recordedAt += "+07:00";
            items.Add(new Entry(id, source, reader.GetString(2), reader.GetInt32(3), recordedAt,
                reader.IsDBNull(5) ? null : reader.GetString(5),
                source == "ai" ? $"/api/ai-driving-events/{id}/image" : null, "confirmed", reader.GetBoolean(6)));
        }
        return items;
    }
}
