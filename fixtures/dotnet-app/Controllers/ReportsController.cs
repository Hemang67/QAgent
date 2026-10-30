using Microsoft.AspNetCore.Mvc;

public class ReportsController : Controller
{
    public IActionResult Index() => Content("<h1>Reports</h1><table><tbody><tr><td>Sales</td><td>42</td></tr></tbody></table>", "text/html");

    [HttpGet("reports/yearly/{year:int}")]
    public IActionResult Yearly(int year) => Content($"<h1>Year {year}</h1><p>Totals</p>", "text/html");

    [HttpPost]
    public IActionResult Rebuild() => RedirectToAction("Index");
}
