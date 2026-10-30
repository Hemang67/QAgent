using Microsoft.AspNetCore.Mvc;

// A JSON API: not a page
[ApiController]
[Route("api/items")]
public class ItemsController : ControllerBase
{
    [HttpGet]
    public IActionResult List() => Ok(new[] { "Brush", "Roller" });
}
