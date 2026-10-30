using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

public class LoginModel : PageModel
{
    public bool Failed { get; set; }

    public IActionResult OnPost(string username, string password)
    {
        if (username == "demo" && password == "demo")
        {
            Response.Cookies.Append("session", "ok", new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Lax });
            return Redirect("/Dashboard");
        }
        Failed = true;
        return Page();
    }
}
