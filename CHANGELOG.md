# Changelog

## 0.1.3 — 2026-11-16

- Smoke pages are easy to add and remove: chosen pages show as chips with a ×, and a search box adds any page found in your code, or a path you type. The picker is on Setup and Project settings, and every page on the Pages screen has a Smoke toggle that saves at once.
- Finding record IDs: when a list opens its records through a button in the row (Permissions, Display Columns, View Sketch) rather than the row itself, QAgent now clicks that button. It reads the button's label from your code, then tries the row, then other safely labelled buttons in the row. It never clicks Delete, Save, Send, Convert or similar.
- A page that still has no record says why, list by list: no rows in the table, the row opened nothing or another page, or the button is disabled for your account.

## 0.1.2 — 2026-11-16

- Pages that need a record ID no longer stay unverified when you have not set one. QAgent reads your project's code to find the list pages that open each one. During the run it opens the first record there (a link, or the first table row) and tests the page the app opened. The Pages screen shows where each page's record will come from. Results say which list the record came from, or where QAgent looked when it found none. IDs you set in test data still come first; `"findRecords": false` in `.qagent.json` turns this off.
- The results workbook is readable in Excel's dark mode: every row now has its own fill, so text no longer sits on black. Workbooks from earlier runs are repaired on the next run.

## 0.1.1 — 2026-11-02

- Open in Excel works on Windows: when the system refuses to open the workbook directly, QAgent opens it through Explorer, as a double-click would.
- Results and Run screens: a Show in folder button next to Open in Excel, and an error message if a workbook cannot be opened.
- Layout fixes at every window size: tables scroll sideways instead of cutting columns off, the sidebar scrolls in short windows, wide windows use up to 1440 px, the scan view keeps its clock beside the title and its tiles readable when narrow, and labels no longer wrap.

## 0.1.0 — 2026-10-30

The first public release.

- Desktop app for Windows and Linux: Projects, Setup, Run, Results, Pages, Flows, Project settings and App settings screens, in a sci-fi theme with a live scan view (radar, pages being tested now, test lanes, telemetry).
- Finds pages in React Router, Next.js, Vue / Nuxt, Angular, SvelteKit, plain HTML, Laravel, .NET (Razor Pages, Blazor, MVC) and Python (Django, Flask, FastAPI) projects; crawls the running site for anything else.
- All 11 test types: Smoke (with the Smoke gate), Change-impact, Full regression, Critical flows, CRUD, Accessibility, Performance, Broken links, Responsive, Visual change and Security scan.
- Flows screen: record critical journeys and CRUD screens in a browser.
- Pages screen: New since the base branch (add new pages), and an optional commit reminder.
- Read-only by default: non-GET requests and side-effect endpoints are blocked in the browser. GraphQL queries and calls listed in `readOnlyAllow` are let through.
- Login every run (browser window, username and password, or skip); nothing is stored; optional logout URL.
- Results in `qagent-results.xlsx` (Guide, Run History, one sheet per run, security findings) and on the Results screen.
- Uses the installed Chrome or Edge; downloads Chromium only when neither is present.
- A guided tour on first launch, testing a demo shop through the real screens (Help → Take the tour).
- In-app updates from GitHub Releases, with "What's new" after each update.
