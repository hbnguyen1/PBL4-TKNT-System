using Driver_Manager_Web.Models;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.FileProviders;
using MySqlConnector;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers();
builder.Services.AddOpenApi();

// Cấu hình đăng nhập bằng Cookie
builder.Services
    .AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/login.html";
        options.AccessDeniedPath = "/login.html";

        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Strict;
        options.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;

        options.ExpireTimeSpan = TimeSpan.FromHours(8);

        options.Events.OnRedirectToLogin = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.StatusCode = 401;
                return Task.CompletedTask;
            }

            context.Response.Redirect("/login.html");
            return Task.CompletedTask;
        };

        options.Events.OnRedirectToAccessDenied = context =>
        {
            if (context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.StatusCode = 403;
                return Task.CompletedTask;
            }

            context.Response.Redirect("/login.html");
            return Task.CompletedTask;
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseAuthentication();
app.UseAuthorization();

// Kiểm tra quyền truy cập API
app.Use(async (context, next) =>
{
    var path = context.Request.Path;

    if (path.StartsWithSegments("/api") &&
        !path.StartsWithSegments("/api/auth"))
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            context.Response.StatusCode = 401;
            return;
        }

        if (!context.User.IsInRole("Admin"))
        {
            context.Response.StatusCode = 403;
            return;
        }
    }

    // Chặn yêu cầu thay đổi dữ liệu từ Origin khác
    bool isWrite =
        HttpMethods.IsPost(context.Request.Method) ||
        HttpMethods.IsPut(context.Request.Method) ||
        HttpMethods.IsPatch(context.Request.Method) ||
        HttpMethods.IsDelete(context.Request.Method);

    if (path.StartsWithSegments("/api") && isWrite)
    {
        string origin = context.Request.Headers.Origin.ToString();
        string expected = $"{context.Request.Scheme}://{context.Request.Host}";

        if (!string.IsNullOrEmpty(origin) &&
            !string.Equals(origin, expected,
                StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = 403;
            return;
        }
    }

    await next();
});

// Cho phép tải CSS, JS, hình ảnh
var assetsPath = Path.Combine(
    app.Environment.ContentRootPath, "assets");

if (Directory.Exists(assetsPath))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(assetsPath),
        RequestPath = "/assets"
    });
}

app.MapControllers();

// Trang đăng nhập
app.MapGet("/login.html", (IWebHostEnvironment env) =>
{
    return Results.File(
        Path.Combine(env.ContentRootPath,
            "views", "login", "Login.html"),
        "text/html");
});

// Trang chủ Admin
app.MapGet("/", (HttpContext ctx, IWebHostEnvironment env) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login.html");

    if (!ctx.User.IsInRole("Admin"))
        return Results.Redirect("/driver.html");

    return Results.File(
        Path.Combine(env.ContentRootPath,
            "views", "admin", "index.html"),
        "text/html");
});

// Trang dành cho Driver
app.MapGet("/driver.html",
    (HttpContext ctx, IWebHostEnvironment env) =>
{
    if (ctx.User.Identity?.IsAuthenticated != true)
        return Results.Redirect("/login.html");

    if (!ctx.User.IsInRole("Driver"))
        return Results.Redirect("/");

    return Results.File(
        Path.Combine(env.ContentRootPath,
            "views", "driver", "driver.html"),
        "text/html");
});

// Các trang quản trị khác
app.MapGet("/{page}.html",
    (string page, HttpContext ctx, IWebHostEnvironment env) =>
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

        await using var connection = db.GetConnection();
        await connection.OpenAsync();

        await using var command =
            new MySqlCommand("SELECT DATABASE()", connection);

        return Results.Ok(new
        {
            success = true,
            database = await command.ExecuteScalarAsync()
        });
    }
    catch
    {
        return Results.Problem("Kết nối database thất bại.");
    }
});

app.Run();
