
using Microsoft.AspNetCore.Mvc;
using MySqlConnector;
using Driver_Manager_Web.Models;

namespace Driver_Manager_Web.Controllers;

[ApiController]
[Route("api/vehicles")]
public class VehiclesController : ControllerBase
{
    private readonly Database _db = new Database();

    // GET: api/vehicles?search=43A
    [HttpGet]
    public async Task<IActionResult> GetAll(string? search)
    {
        var result = new List<object>();

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT v.*, d.full_name AS driver_name
            FROM vehicles v
            LEFT JOIN drivers d ON v.driver_id = d.id
            WHERE @search = ''
               OR v.license_plate LIKE @keyword
               OR v.vehicle_name LIKE @keyword
               OR v.route LIKE @keyword
               OR d.full_name LIKE @keyword
            ORDER BY v.license_plate
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@search", search ?? "");
        cmd.Parameters.AddWithValue("@keyword", $"%{search}%");

        await using var reader = await cmd.ExecuteReaderAsync();

        while (await reader.ReadAsync())
            result.Add(ReadVehicleDetail(reader));

        return Ok(result);
    }

    // GET: api/vehicles/43A-12345
    [HttpGet("{plate}")]
    public async Task<IActionResult> GetByPlate(string plate)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            SELECT v.*, d.full_name AS driver_name
            FROM vehicles v
            LEFT JOIN drivers d ON v.driver_id = d.id
            WHERE v.license_plate = @plate
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@plate", plate);

        await using var reader = await cmd.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
            return NotFound(new { message = "Không tìm thấy xe" });

        return Ok(ReadVehicleDetail(reader));
    }

    // POST: api/vehicles
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] Vehicle vehicle)
    {
        if (!ValidVehicle(vehicle))
            return BadRequest(new {
                message = "Biển số hoặc tên xe không hợp lệ"
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        try
        {
            var driverId = NormalizeId(vehicle.DriverId);

            if (driverId != null)
            {
                string? error = await CheckDriver(
                    conn, tx, driverId, null);

                if (error != null)
                    return Conflict(new { message = error });
            }

            const string sql = """
                INSERT INTO vehicles
                (license_plate, vehicle_name, route,
                 device_info, driver_id)
                VALUES
                (@plate, @name, @route, @device, @driver)
                """;

            await using var cmd = new MySqlCommand(sql, conn, tx);
            AddVehicleParameters(cmd, vehicle, driverId);
            await cmd.ExecuteNonQueryAsync();

            await tx.CommitAsync();

            return CreatedAtAction(nameof(GetByPlate),
                new { plate = vehicle.LicensePlate },
                new { message = "Thêm xe thành công",
                      vehicle.LicensePlate });
        }
        catch (MySqlException ex) when (ex.Number == 1062)
        {
            return Conflict(new { message = "Biển số xe đã tồn tại" });
        }
        catch (MySqlException ex) when (ex.Number == 1452)
        {
            return Conflict(new { message = "Tài xế không tồn tại" });
        }
    }

    // PUT: api/vehicles/43A-12345
    [HttpPut("{plate}")]
    public async Task<IActionResult> Update(
        string plate, [FromBody] Vehicle vehicle)
    {
        if (!ValidVehicle(vehicle) ||
            !string.Equals(plate, vehicle.LicensePlate,
                StringComparison.OrdinalIgnoreCase))
            return BadRequest(new {
                message = "Thông tin xe hoặc biển số không hợp lệ"
            });

        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            UPDATE vehicles SET
                vehicle_name = @name,
                route = @route,
                device_info = @device
            WHERE license_plate = @plate
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@plate", plate);
        cmd.Parameters.AddWithValue("@name", vehicle.VehicleName);
        cmd.Parameters.AddWithValue("@route",
            (object?)vehicle.Route ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@device",
            (object?)vehicle.DeviceInfo ?? DBNull.Value);

        int affected = await cmd.ExecuteNonQueryAsync();

        if (affected == 0)
        {
            await using var check = new MySqlCommand(
                "SELECT COUNT(*) FROM vehicles WHERE license_plate = @plate",
                conn);
            check.Parameters.AddWithValue("@plate", plate);

            if (Convert.ToInt64(await check.ExecuteScalarAsync()) == 0)
                return NotFound(new { message = "Không tìm thấy xe" });
        }

        return Ok(new { message = "Cập nhật xe thành công" });
    }

    // PATCH: api/vehicles/43A-12345/assign
    // Body: {"driverId":"TX001"}
    // Bỏ phân công: {"driverId":null}
    [HttpPatch("{plate}/assign")]
    public async Task<IActionResult> AssignDriver(
        string plate, [FromBody] Vehicle vehicle)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync();
        await using var tx = await conn.BeginTransactionAsync();

        try
        {
            string? driverId = NormalizeId(vehicle.DriverId);

            // Khóa dòng tài xế để tránh hai yêu cầu
            // cùng lúc phân công tài xế cho hai xe.
            if (driverId != null)
            {
                string? error = await CheckDriver(
                    conn, tx, driverId, plate);

                if (error != null)
                    return Conflict(new { message = error });
            }

            const string sql = """
                UPDATE vehicles
                SET driver_id = @driver
                WHERE license_plate = @plate
                """;

            await using (var cmd = new MySqlCommand(sql, conn, tx))
            {
                cmd.Parameters.AddWithValue("@plate", plate);
                cmd.Parameters.AddWithValue("@driver",
                    (object?)driverId ?? DBNull.Value);

                await cmd.ExecuteNonQueryAsync();
            }

            await using (var check = new MySqlCommand(
                "SELECT COUNT(*) FROM vehicles WHERE license_plate = @plate",
                conn, tx))
            {
                check.Parameters.AddWithValue("@plate", plate);

                if (Convert.ToInt64(await check.ExecuteScalarAsync()) == 0)
                    return NotFound(new { message = "Không tìm thấy xe" });
            }

            await tx.CommitAsync();

            return Ok(new {
                message = driverId == null
                    ? "Đã hủy phân công tài xế"
                    : "Phân công tài xế thành công",
                licensePlate = plate,
                driverId
            });
        }
        catch (MySqlException ex) when (ex.Number == 1452)
        {
            return Conflict(new { message = "Tài xế không tồn tại" });
        }
    }

    // DELETE: api/vehicles/43A-12345
    [HttpDelete("{plate}")]
    public async Task<IActionResult> Delete(string plate)
    {
        await using var conn = _db.GetConnection();
        await conn.OpenAsync();

        const string sql = """
            DELETE FROM vehicles
            WHERE license_plate = @plate
            """;

        await using var cmd = new MySqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("@plate", plate);

        int affected = await cmd.ExecuteNonQueryAsync();

        return affected == 0
            ? NotFound(new { message = "Không tìm thấy xe" })
            : Ok(new { message = "Xóa xe thành công" });
    }

    // Kiểm tra tài xế trước khi phân công.
    // Gọi trong transaction.
    private static async Task<string?> CheckDriver(
        MySqlConnection conn,
        MySqlTransaction tx,
        string driverId,
        string? currentPlate)
    {
        const string driverSql = """
            SELECT is_suspended
            FROM drivers
            WHERE id = @id
            FOR UPDATE
            """;

        await using (var cmd = new MySqlCommand(driverSql, conn, tx))
        {
            cmd.Parameters.AddWithValue("@id", driverId);
            var status = await cmd.ExecuteScalarAsync();

            if (status == null || status == DBNull.Value)
                return "Tài xế không tồn tại";

            if (Convert.ToBoolean(status))
                return "Tài xế đang bị đình chỉ";
        }

        const string checkSql = """
            SELECT license_plate
            FROM vehicles
            WHERE driver_id = @id
              AND (@plate IS NULL OR license_plate <> @plate)
            LIMIT 1
            """;

        await using var check = new MySqlCommand(checkSql, conn, tx);
        check.Parameters.AddWithValue("@id", driverId);
        check.Parameters.AddWithValue("@plate",
            (object?)currentPlate ?? DBNull.Value);

        var assignedPlate = await check.ExecuteScalarAsync();

        if (assignedPlate != null)
            return $"Tài xế đã phụ trách xe {assignedPlate}";

        return null;
    }

    private static bool ValidVehicle(Vehicle? v)
    {
        return v != null
            && !string.IsNullOrWhiteSpace(v.LicensePlate)
            && v.LicensePlate.Length <= 20
            && !string.IsNullOrWhiteSpace(v.VehicleName)
            && v.VehicleName.Length <= 100
            && (v.Route?.Length ?? 0) <= 150
            && (v.DeviceInfo?.Length ?? 0) <= 150;
    }

    private static string? NormalizeId(string? id)
    {
        return string.IsNullOrWhiteSpace(id) ? null : id.Trim();
    }

    private static void AddVehicleParameters(
        MySqlCommand cmd, Vehicle vehicle, string? driverId)
    {
        cmd.Parameters.AddWithValue("@plate", vehicle.LicensePlate);
        cmd.Parameters.AddWithValue("@name", vehicle.VehicleName);
        cmd.Parameters.AddWithValue("@route",
            (object?)vehicle.Route ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@device",
            (object?)vehicle.DeviceInfo ?? DBNull.Value);
        cmd.Parameters.AddWithValue("@driver",
            (object?)driverId ?? DBNull.Value);
    }

    private static object ReadVehicleDetail(MySqlDataReader r)
    {
        string? Text(string column) =>
            r[column] == DBNull.Value
                ? null : Convert.ToString(r[column]);

        return new
        {
            licensePlate = Text("license_plate"),
            vehicleName = Text("vehicle_name"),
            route = Text("route"),
            deviceInfo = Text("device_info"),
            driverId = Text("driver_id"),
            driverName = Text("driver_name")
        };
    }
}
