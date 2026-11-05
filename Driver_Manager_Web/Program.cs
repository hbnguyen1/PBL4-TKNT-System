using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.FileProviders;
using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.FileProviders;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();

builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.Cookie.Name = "DriverWebAuth";
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;

        options.ExpireTimeSpan = TimeSpan.FromHours(8);

        options.Events.OnRedirectToLogin = context =>
        {
            context.Response.StatusCode = 401;
            return Task.CompletedTask;
        };

        options.Events.OnRedirectToAccessDenied = context =>
        {
            context.Response.StatusCode = 403;
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

var root = app.Environment.ContentRootPath;

var assetsPath = Path.Combine(root, "assets");

if (Directory.Exists(assetsPath))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(assetsPath),
        RequestPath = "/assets"
    });
}

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.MapGet("/", () =>
    Results.Redirect("/login/Login.html"));

// Trang đăng nhập
app.MapGet("/login/{page}.html", (string page) =>
{
    if (!ValidPage(page))
        return Results.NotFound();

    var path = Path.Combine(root, "views", "login", page + ".html");

    return HtmlFile(path);
});

// Trang Admin: giữ đường dẫn cũ
app.MapGet("/{page}.html", (string page) =>
{
    if (!ValidPage(page))
        return Results.NotFound();

    if (page.Equals("index", StringComparison.OrdinalIgnoreCase))
        return Results.Redirect("/");

    var path = Path.Combine(root, "views", "admin", page + ".html");

    return HtmlFile(path);
});

// Trang Driver: yêu cầu đăng nhập đúng vai trò
app.MapGet("/driver/{page}.html",
    (string page, HttpContext context) =>
{
    if (!ValidPage(page))
        return Results.NotFound();

    var path = Path.Combine(root, "views", "driver", page + ".html");

    return HtmlFile(path);
})
.RequireAuthorization(new AuthorizeAttribute { Roles = "Driver" });

app.MapGet("/db-test", async () =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login.html");

    if (!ctx.User.IsInRole("Admin"))
        return Results.Redirect("/driver.html");

    if (page.Contains('/') ||
        page.Contains('\\') ||
        page.Contains("..") ||
        page == "index")
        return Results.NotFound();

    var file = Path.Combine(
        env.ContentRootPath,
        "views", "admin", page + ".html");

    return File.Exists(file)
        ? Results.File(file, "text/html")
        : Results.NotFound();
});

// Kiểm tra kết nối database
app.MapGet("/db-test", async (HttpContext ctx) =>
{
    if (!ctx.User.IsInRole("Admin"))
        return Results.StatusCode(403);

    try
    {
        var db = new Database();

        await using var conn = db.GetConnection();
        await conn.OpenAsync();

        await using var cmd =
            new MySqlCommand("SELECT DATABASE()", conn);

        var name = await cmd.ExecuteScalarAsync();

        return Results.Ok(new
        {
            success = true,
            database = name
        });
    }
    catch
    {
        return Results.Problem(
            "Không thể kết nối MySQL. Kiểm tra cấu hình database.");
    }
});

app.Run();

static bool ValidPage(string page)
{
    return !string.IsNullOrWhiteSpace(page)
        && page != "."
        && page != ".."
        && page.All(c =>
            char.IsLetterOrDigit(c) || c == '-' || c == '_');
}

static IResult HtmlFile(string path)
{
    if (!File.Exists(path))
        return Results.NotFound("Không tìm thấy trang HTML.");

    return Results.File(path, "text/html");
}
