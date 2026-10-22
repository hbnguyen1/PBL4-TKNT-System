
namespace Driver_Manager_Web.Models
{
    public class DemeritPoint
    {
        public int Id { get; set; }
        public string DriverId { get; set; } = "";
        public string Violation { get; set; } = "";
        public int PointsDeducted { get; set; }
        public DateTime ViolatedAt { get; set; }
        public DateTime CreatedAt { get; set; }
    }
}
