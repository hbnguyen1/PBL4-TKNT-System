
namespace Driver_Manager_Web.Models
{
    public class Vehicle
    {
        public string LicensePlate { get; set; } = "";
        public string VehicleName { get; set; } = "";
        public string? Route { get; set; }
        public string? DeviceInfo { get; set; }
        public string? DriverId { get; set; }
    }
}
