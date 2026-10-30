# Changelog

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
