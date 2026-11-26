namespace Driver_Manager_Web.Models;

internal static class PayrollDeductions
{
    internal const int VndPerPoint = 100_000;

    // A driver can have old duplicate payment rows. Prefer any settled row, then the newest.
    internal const string PaymentJoin = """
        LEFT JOIN salarypayments p ON p.id = (
            SELECT payment.id
            FROM salarypayments payment
            WHERE payment.salary_id = s.id
            ORDER BY (payment.payment_status = 'Đã thanh toán') DESC, payment.id DESC
            LIMIT 1
        )
        """;

    private const string MonthStart = "DATE_ADD(MAKEDATE(s.period_year, 1), INTERVAL (s.period_month - 1) MONTH)";
    private const string NextMonth = "DATE_ADD(MAKEDATE(s.period_year, 1), INTERVAL s.period_month MONTH)";

    internal static readonly string PendingPenalty = $$"""
        ((COALESCE((
            SELECT SUM(d.points_deducted) FROM demeritpoints d
            WHERE d.driver_id = s.driver_id AND d.deleted_utc IS NULL
              AND d.violated_at >= {{MonthStart}} AND d.violated_at < {{NextMonth}}
        ), 0) + COALESCE((
            SELECT SUM(e.points_deducted) FROM ai_driving_events e
            WHERE e.driver_id = s.driver_id AND e.event_type IN ('phone_use', 'drowsy')
              AND e.review_status = 'approved' AND e.deleted_utc IS NULL
              AND e.captured_utc >= DATE_SUB({{MonthStart}}, INTERVAL 7 HOUR)
              AND e.captured_utc < DATE_SUB({{NextMonth}}, INTERVAL 7 HOUR)
        ), 0)) * {{VndPerPoint}})
        """;

    internal static readonly string DisciplinaryPenalty = $"""
        (CASE WHEN p.payment_status = 'Đã thanh toán' THEN COALESCE(p.disciplinary_penalty, 0)
              ELSE {PendingPenalty} END)
        """;

    internal static readonly string TotalPenalty = $"(s.penalty + {DisciplinaryPenalty})";
}
