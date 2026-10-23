using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;
using Driver_Manager_Web.Models;
using MySqlConnector;
using System.IO;

var builder = WebApplication.CreateBuilder(args);

// Đăng ký API Controllers
builder.Services.AddControllers();

// OpenAPI
builder.Services.AddOpenApi();

var app = builder.Build();

// OpenAPI trong môi trường Development
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

// Phục vụ CSS, JavaScript và hình ảnh từ thư mục assets
var assetsPath = Path.Combine(
    app.Environment.ContentRootPath,
    "assets"
);

if (Directory.Exists(assetsPath))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(assetsPath),
        RequestPath = "/assets"
    });
}

// Đăng ký tất cả API Controllers
// Bao gồm PayrollController và FinanceController
app.MapControllers();

// Trang chủ: views/admin/index.html
app.MapGet("/", (IWebHostEnvironment env) =>
{
    var path = Path.Combine(
        env.ContentRootPath,
        "views",
        "admin",
        "index.html"
    );

    if (!File.Exists(path))
    {
        return Results.NotFound(
            $"Không tìm thấy trang chủ: {path}"
        );
    }

    return Results.File(path, "text/html");
});

// Tự động phục vụ các trang HTML trong views/admin
// Ví dụ: /finance.html, /payroll.html, /drivers.html
app.MapGet("/{page}.html", (
    string page,
    IWebHostEnvironment env) =>
{
    if (string.IsNullOrWhiteSpace(page) ||
        page.Contains('/') ||
        page.Contains('\\') ||
        page.Contains(".."))
    {
        return Results.NotFound();
    }

    if (page.Equals(
        "index",
        StringComparison.OrdinalIgnoreCase))
    {
        return Results.Redirect("/");
    }

    var path = Path.Combine(
        env.ContentRootPath,
        "views",
        "admin",
        page + ".html"
    );

    if (!File.Exists(path))
    {
        return Results.NotFound(
            $"Không tìm thấy trang HTML: {path}"
        );
    }

    return Results.File(path, "text/html");
});

// Kiểm tra kết nối MySQL/XAMPP
app.MapGet("/db-test", async () =>
{
    try
    {
        var db = new Database();

        await using var connection = db.GetConnection();
        await connection.OpenAsync();

        await using var command = new MySqlCommand(
            "SELECT DATABASE()",
            connection
        );

        var databaseName = await command.ExecuteScalarAsync();

        return Results.Ok(new
        {
            success = true,
            message = "Kết nối MySQL thành công!",
            database = databaseName
        });
    }
    catch (Exception ex)
    {
        return Results.Problem(
            title: "Kết nối database thất bại",
            detail: ex.Message
        );
    }
});

app.Run();