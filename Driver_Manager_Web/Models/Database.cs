
using MySqlConnector;

namespace Driver_Manager_Web.Models
{
    public class Database
    {
        private readonly string connectionString =
            "Server=127.0.0.1;" +
            "Port=3306;" +
            "Database=driverwebdb;" +
            "User ID=root;" +
            "Password=;" +
            "CharSet=utf8mb4;";

        public MySqlConnection GetConnection()
        {
            return new MySqlConnection(connectionString);
        }
    }
}
