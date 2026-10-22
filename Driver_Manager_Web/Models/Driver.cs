
namespace Driver_Manager_Web.Models
{
    public class Driver
    {
        public string Id { get; set; } = "";
        public string FullName { get; set; } = "";
        public DateTime? DateOfBirth { get; set; }
        public string? Address { get; set; }
        public string? AvatarUrl { get; set; }
        public string? Phone { get; set; }
        public string? LicenseType { get; set; }
        public bool IsSuspended { get; set; }
    }
}
