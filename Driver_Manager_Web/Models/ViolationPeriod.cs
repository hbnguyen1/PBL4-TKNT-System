using MySqlConnector;

namespace Driver_Manager_Web.Models;

internal static class ViolationPeriod
{
    internal const string LockedMessage = "Chỉ xóa được vi phạm trong tháng hiện tại khi lương của tài xế chưa chốt.";
    internal const string ApprovalLockedMessage = "Lương kỳ này đã chốt. Không thể duyệt thêm vi phạm tính điểm.";

    internal static bool IsCurrentMonth(DateTime occurredLocal)
    {
        var today = DateTime.UtcNow.AddHours(7);
        return today.Year == occurredLocal.Year && today.Month == occurredLocal.Month;
    }

    // SQL expressions supplied by the calling query, never from request data.
    internal static string CanDeleteSql(string driverColumn, string localDate) => $"""
        YEAR({localDate}) = YEAR(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))
        AND MONTH({localDate}) = MONTH(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))
        AND NOT EXISTS (
            SELECT 1 FROM salarystructures s
            INNER JOIN salarypayments p ON p.salary_id = s.id
            WHERE s.driver_id = {driverColumn} AND s.period_year = YEAR({localDate})
              AND s.period_month = MONTH({localDate}) AND p.payment_status = 'Đã thanh toán'
        )
        """;

    // Use the same driver row as payroll finalization to serialize changes to deductions.
    internal static async Task<bool> LockDriver(MySqlConnection connection, MySqlTransaction tx,
        string driverId, CancellationToken ct)
    {
        await using var query = new MySqlCommand(
            "SELECT id FROM drivers WHERE id = @driver FOR UPDATE", connection, tx);
        query.Parameters.AddWithValue("@driver", driverId);
        return await query.ExecuteScalarAsync(ct) is not null;
    }

    internal static async Task<bool> IsPaid(MySqlConnection connection, MySqlTransaction tx,
        string driverId, DateTime occurredLocal, CancellationToken ct)
    {
        const string sql = """
            SELECT 1 FROM salarystructures s
            INNER JOIN salarypayments p ON p.salary_id = s.id
            WHERE s.driver_id = @driver AND s.period_year = @year
              AND s.period_month = @month AND p.payment_status = 'Đã thanh toán'
            LIMIT 1
            """;
        await using var query = new MySqlCommand(sql, connection, tx);
        query.Parameters.AddWithValue("@driver", driverId);
        query.Parameters.AddWithValue("@year", occurredLocal.Year);
        query.Parameters.AddWithValue("@month", occurredLocal.Month);
        return await query.ExecuteScalarAsync(ct) is not null;
    }
}
