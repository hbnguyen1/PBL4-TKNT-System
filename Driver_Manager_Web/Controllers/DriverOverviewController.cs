using System.Security.Claims;
using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Authorize(Roles = "Driver")]
[Route("api/driver/me/overview")]
public class DriverOverviewController : ControllerBase
{
    private readonly Database _db = new();

    [HttpGet]
    public async Task<IActionResult> GetOverview()
    {
        string? driverId = User.FindFirstValue(
            ClaimTypes.NameIdentifier);

        if (string.IsNullOrEmpty(driverId))
            return Unauthorized();

        try
        {
            await using var conn = _db.GetConnection();
            await conn.OpenAsync();

            // 1. Thông tin tài xế
            string fullName;

            await using (var cmd = new MySqlCommand(
                "SELECT full_name FROM drivers WHERE id=@id",
                conn))
            {
                cmd.Parameters.AddWithValue("@id", driverId);

                var name = await cmd.ExecuteScalarAsync();

                if (name == null)
                    return NotFound(new {
                        message = "Không tìm thấy tài xế."
                    });

                fullName = Convert.ToString(name) ?? "";
            }

            // 2. Tổng điểm trừ
            int totalDemerits;

            await using (var cmd = new MySqlCommand("""
                SELECT COALESCE(SUM(points_deducted), 0)
                FROM demeritpoints
                WHERE driver_id=@id
                """, conn))
            {
                cmd.Parameters.AddWithValue("@id", driverId);

                totalDemerits = Convert.ToInt32(
                    await cmd.ExecuteScalarAsync());
            }

            // 3. Lương tháng hiện tại
            decimal? salary = null;

            await using (var cmd = new MySqlCommand("""
                SELECT
                    base_salary + route_allowance
                    + bonus - penalty
                FROM salarystructures
                WHERE driver_id=@id
                  AND period_month=MONTH(CURRENT_DATE())
                  AND period_year=YEAR(CURRENT_DATE())
                ORDER BY id DESC
                LIMIT 1
                """, conn))
            {
                cmd.Parameters.AddWithValue("@id", driverId);

                var value = await cmd.ExecuteScalarAsync();

                if (value != null && value != DBNull.Value)
                    salary = Convert.ToDecimal(value);
            }

            // 4. Xe được phân công
            var vehicles = new List<object>();

            await using (var cmd = new MySqlCommand("""
                SELECT license_plate, vehicle_name, route
                FROM vehicles
                WHERE driver_id=@id
                ORDER BY license_plate
                """, conn))
            {
                cmd.Parameters.AddWithValue("@id", driverId);

                await using var reader =
                    await cmd.ExecuteReaderAsync();

                while (await reader.ReadAsync())
                {
                    vehicles.Add(new
                    {
                        licensePlate =
                            reader["license_plate"].ToString(),
                        vehicleName =
                            reader["vehicle_name"].ToString(),
                        route = reader["route"] == DBNull.Value
                            ? null
                            : reader["route"].ToString()
                    });
                }
            }

            return Ok(new
            {
                driverId,
                fullName,
                totalDemerits,
                salary,
                vehicles,

                // Chưa có bảng lưu chuyến và giờ vận hành
                weeklyTrips = (int?)null,
                operatingHours = (decimal?)null
            });
        }
        catch (MySqlException)
        {
            return StatusCode(500, new
            {
                message = "Không thể truy vấn dữ liệu MySQL."
            });
        }
    }
}
