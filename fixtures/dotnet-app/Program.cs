// ASP.NET fixture for QAgent: Razor Pages + MVC. Login: demo / demo. Runs on http://localhost:5182.
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddRazorPages();
builder.Services.AddControllersWithViews();
var app = builder.Build();

// Everything but the login and About pages needs the session cookie
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path.Value ?? "/";
    var open = path.StartsWith("/Login", StringComparison.OrdinalIgnoreCase) || path.StartsWith("/About", StringComparison.OrdinalIgnoreCase);
    if (!open && ctx.Request.Cookies["session"] != "ok")
    {
        ctx.Response.Redirect("/Login");
        return;
    }
    await next();
});

app.MapRazorPages();
app.MapControllerRoute("default", "{controller=Home}/{action=Index}/{id?}");
app.Run();
