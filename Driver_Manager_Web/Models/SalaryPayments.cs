
namespace Driver_Manager_Web.Models
{
    public class SalaryPayment
    {
        public int Id { get; set; }
        public int SalaryId { get; set; }
        public DateTime? PaymentTime { get; set; }
        public string PaymentStatus { get; set; } =
            "Chưa thanh toán";
        public string? Note { get; set; }
    }
}
