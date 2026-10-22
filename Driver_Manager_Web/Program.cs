
using Driver_Manager_Web.Models;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddOpenApi();
builder.Services.AddControllers();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(
            "http://127.0.0.1:5500",
            "http://localhost:5500"
        )
        .AllowAnyHeader()
        .AllowAnyMethod();
    });
});

var app = builder.Build();
app.UseCors("AllowFrontend");

// Cau hinh OpenAPI khi chay Development
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();

// Kiem tra ket noi MySQL/XAMPP
app.MapGet("/db-test", async () =>
{
    try
    {
        var db = new Database();

        await using var connection = db.GetConnection();
        await connection.OpenAsync();

        await using var command =
            new MySqlCommand("SELECT DATABASE()", connection);

        var databaseName = await command.ExecuteScalarAsync();

        return Results.Ok(new
        {
            success = true,
            message = "Ket noi XAMPP thanh cong!",
            database = databaseName
        });
    }
    catch (Exception ex)
    {
        return Results.Problem(
            title: "Ket noi database that bai",
            detail: ex.Message
        );
    }
});

// Endpoint mac dinh de kiem tra website
var summaries = new[]
{
    "Freezing", "Bracing", "Chilly", "Cool", "Mild",
    "Warm", "Balmy", "Hot", "Sweltering", "Scorching"
};

app.MapGet("/weatherforecast", () =>
{
    var forecast = Enumerable.Range(1, 5).Select(index =>
        new WeatherForecast(
            DateOnly.FromDateTime(DateTime.Now.AddDays(index)),
            Random.Shared.Next(-20, 55),
            summaries[Random.Shared.Next(summaries.Length)]
        )).ToArray();

    return forecast;
}).WithName("GetWeatherForecast");

app.MapControllers();
app.Run();

record WeatherForecast(
    DateOnly Date,
    int TemperatureC,
    string? Summary)
{
    public int TemperatureF =>
        32 + (int)(TemperatureC / 0.5556);
}
