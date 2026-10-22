
namespace Driver_Manager_Web.Models
{
    public class SalaryStructure
    {
        public int Id { get; set; }
        public string DriverId { get; set; } = "";
        public int PeriodMonth { get; set; }
        public int PeriodYear { get; set; }
        public decimal BaseSalary { get; set; }
        public decimal RouteAllowance { get; set; }
        public decimal Bonus { get; set; }
        public decimal Penalty { get; set; }

        public decimal NetSalary =>
            BaseSalary + RouteAllowance + Bonus - Penalty;
    }
}
