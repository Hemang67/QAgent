# QAgent – Design, Publishing & User Guide

Oct 30, 2026 · @Techovarya

## Overview

QAgent is a desktop app for Windows and Linux that tests any web-app project you open: it finds the pages, opens each one in a real browser, and records health, speed, accessibility and security problems in an Excel workbook in the project root.

It grew out of the page-health suite built for OMS 2.0, but it is a new, separate codebase with no OMS-specific code. Everything that was hand-written for OMS (route files, login token, loader classes, environment files) is detected per project or asked once.

**Who it is for:** developers and QA on any team that ships web apps, whatever the language: React, Next.js, Vue, Angular, plain JS, PHP/Laravel, .NET, Python (Django/Flask) and similar. QAgent works next to whatever editor the team uses; it does not depend on one.

**What success looks like:**

- Download the installer from GitHub Releases, open a web project, and get a first Smoke run in under 5 minutes.
- The same 11 test types, safety rules and Excel design on every project, with no code changes in the project itself.
- A developer building a feature runs Change-impact locally and sees only the pages they touched, before they push.

Name: **QAgent** (QA + Agent).

## Goals, non-goals and anti-goals

Version 1 covers web apps only; Android, iOS, Flutter mobile and React Native are out of scope until a later version.

**Goals**

- Work on any web project without editing the project's code.
- Detect the framework, how to start it locally, the environment URLs and the pages, and ask only what cannot be detected.
- Offer 11 test types on Local, Dev, Test and Live, with safety rules per environment.
- Write results to one Excel workbook in the project root, in the design used by the OMS workbook, and show the latest results inside the app.
- Ask for environment, test type and login on every run; store no credentials; log out when the run ends.
- Install with one download per platform, and update automatically.

**Non-goals (v1)**

- Native mobile apps (Android, iOS, Flutter mobile, React Native). A later version may add emulator-only testing; never real devices.
- Desktop apps, CLI tools and libraries (no pages to visit).
- Load or stress testing.
- Replacing a professional penetration test.
- macOS builds, and an editor extension (VS Code or other).

**Anti-goals: failure even if it works**

- Any test changes or deletes real data on Live.
- Credentials or login tokens are written to disk, logs, traces or the workbook.
- A test touches a domain other than the project's own.
- A run reports a page as passed that was not really checked.
- Setup takes longer than the first run.

## Supported projects

QAgent reads one marker file to recognise the project, then uses that framework's adapter for start command, environment URLs and page discovery; anything unrecognised falls back to crawling the running site.

| Framework | Detected by | Local start (default) | Environment URLs read from | Pages found from |
| --- | --- | --- | --- | --- |
| React (CRA / Vite) + React Router | `package.json` deps `react-router-dom` / `react-router` | `npm start` / `npm run dev` | `.env.*` (`REACT_APP_*`, `VITE_*`) | Route objects (`createBrowserRouter`, `useRoutes`) and `<Route>` JSX, including route constants and lazy pages |
| Next.js | `next` in `package.json` | `npm run dev` | `.env.*` (`NEXT_PUBLIC_*`) | `app/` and `pages/` folders |
| Vue + Vue Router / Nuxt | `vue`, `vue-router` or `nuxt` | `npm run dev` | `.env.*` (`VITE_*`, `NUXT_*`) | router `routes` arrays (nested, lazy `.vue` pages); Nuxt `pages/` with `[id]`, `[[optional]]` and `(group)` folders |
| Angular | `angular.json` | `npm start` (port from `angular.json`) | `src/environments/environment*.ts` | `Routes` arrays, `loadComponent`, and `loadChildren` files under their parent path |
| SvelteKit | `@sveltejs/kit` | `npm run dev` | `.env.*` | `src/routes/**/+page.svelte`, with `[id]`, `[[optional]]` and `(group)` folders |
| Plain HTML | `index.html` and no framework | static server | asked once | every `.html` file |
| PHP / Laravel | `composer.json`, `artisan` | `php artisan serve` | `.env` (`APP_URL`) | `routes/web.php`: `Route::get`/`view`/`match`, `Route::resource`, `prefix()->group()`; controllers and Blade views as source files |
| .NET (MVC, Razor Pages, Blazor) | `*.csproj` / `*.sln` | `dotnet run` | `launchSettings.json` (Local), `*Url` keys in `appsettings.{Env}.json` | Razor `Pages/` with `@page "{id}"`, Blazor `@page`, MVC attribute and conventional routes (API controllers left out) |
| Python (Django / Flask / FastAPI with pages) | `manage.py`, or `flask` / `fastapi` in `requirements.txt` / `pyproject.toml` | `python manage.py runserver` / `flask run` / `uvicorn` | `.env` | Django `urls.py` with `include()`; Flask `@app.route` and blueprint prefixes (GET only); FastAPI routes that return HTML |
| Anything else | none of the above | asked once | asked once | crawl |

**Environment files:** `.env` / `.env.local` → Local, `.env.development` / `.env.dev` → Dev, `.env.test` / `.env.qa` / `.env.staging` / `.env.uat` → Test, `.env.production` / `.env.prod` → Live. A `*_URL` variable named like an API (`API`, `BACKEND`, `SERVER`, `GRAPHQL`) becomes the environment's API domain; another `*_URL` (`BASE_URL`, `APP_URL`, `SITE_URL`…) becomes the site. Setup shows what was found so it can be corrected.

**Crawl fallback:** QAgent opens the home page after login and follows same-domain links, up to a page limit (default 300). Logout links and file downloads are never followed. It cannot find pages that need an ID or open only from a button, so those are added in setup.

**Pages that need an ID** (`?orderId=…`, `/orders/:id`) are detected from the route pattern or from the page's code reading an ID-like URL parameter (`id`, `orderId`, `customer_id`…; parameters like `?tab=` are ignored). They are reported as unverified until a record ID is set per environment.

## Test types

QAgent offers 11 test types; only CRUD writes data, and CRUD never runs on Live.

| # | Test type | What it checks | Local | Dev | Test | Live | Writes data | Setup needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Smoke | The site answers, login works, home and top menu pages load. Runs first; a failure skips the other types for that environment | Yes | Yes | Yes | Yes | No | None (top menu pages chosen automatically, editable) |
| 2 | Change-impact | Only pages affected by git changes (committed, uncommitted, new files) since a base branch, with all tabs | Yes | Yes | – | – | No | None |
| 3 | Full regression (read-only) | Every page and tab: console errors, failed API calls, blank views, endless loaders, hung requests | Yes | Yes | Yes | Yes | No (GET only) | None |
| 4 | Critical flows | The project's most important journeys, step by step | Yes | Yes | Yes | Yes | Only if allowed; never on Live | Pick or record the journeys |
| 5 | CRUD | Create, edit and delete a `QAgent-…` test record on chosen screens, then clean up | Yes | Yes | Yes | No | Yes | Pick the screens |
| 6 | Accessibility audit | WCAG 2.1 AA on every page (axe-core); critical and serious issues fail the page | Yes | Yes | Yes | Yes | No | None |
| 7 | Performance budget | Time to ready, slowest API call and LCP per page against budgets (warn 5 s, fail 15 s, API 3 s, LCP 4 s) | Yes | Yes | Yes | Yes | No | None (budgets editable) |
| 8 | Broken links & assets | Links that return 404, missing images, scripts and styles, mixed http/https | Yes | Yes | Yes | Yes | No | None |
| 9 | Responsive (mobile view) | Phone (390 px) and tablet (820 px) widths: cut-off content, sideways scrolling, overlapping elements | Yes | Yes | Yes | Yes | No | None |
| 10 | Visual change check | Screenshot of each page compared with the last approved baseline; one baseline kept per page | Yes | Yes | Yes | Yes | No | First run saves the baseline |
| 11 | Security scan | Passive checks everywhere; active checks full on Local and Dev, restricted on Test and Live (next section) | Yes | Yes | Yes | Yes | No (stored XSS on Local and Dev only) | A second, low-permission login for role checks |

**How a page is judged.** A page passes when something rendered, no loader is still visible, no API call is in flight for 750 ms, and no error was recorded. Results are passed, failed, skipped (no permission by design, a logout page, or set to skip) or unverified (not really checked, e.g. login skipped, the session rejected, or an ID missing). Pass rate = passed ÷ (passed + failed + unverified).

**What counts as an error:** the page itself returning HTTP 4xx/5xx, a framework error screen, an uncaught JavaScript exception, a console error, a failed call to the project's own API (other domains are never judged), a request that never finishes, a loader that never goes away, or a blank view. Known noise (React dev warnings, dev-server messages, library upgrade notices) is recorded as information, not failure.

**Redirects:** sent to the login page → unverified (session rejected or login skipped). Sent back to the home or logged-in page → skipped (the account may not open it).

**Change-impact rules** (carried over from OMS): new routes test only the new pages; a shared file that only gained new exports tests only the pages using them; an edit to existing shared code tests every page that imports it; edits to the app shell, layout, global styles or the package file test every page. Import tracing is exact for JavaScript and TypeScript; for PHP, .NET and Python, a changed file that is a page's own file (controller, view, template, `views.py`) selects its pages, and any other changed server file tests every page. Start-up, settings, dependency and layout files of those frameworks (`Program.cs`, `appsettings`, `settings.py`, `requirements.txt`, `composer.json`, `_Layout.cshtml`) also test every page.

## Security scan

The security scan runs on every environment, Live included; on Test and Live only the checks that cannot change data or lock accounts run, and Live needs `LIVE SECURITY` typed to start.

| Check | Finds | Local | Dev | Test | Live | How it stays safe |
| --- | --- | --- | --- | --- | --- | --- |
| Vulnerable libraries | Known CVEs in dependencies, via the ecosystem's tool: `npm audit`, `pip-audit`, `dotnet list package --vulnerable`, `composer audit` | Yes | Yes | Yes | Yes | Reads the project only |
| Secrets in code | API keys, passwords and tokens in the repo or `.env` files | Yes | Yes | Yes | Yes | Reads the project only; values masked in the report |
| Security headers | Missing CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy | Yes | Yes | Yes | Yes | Passive |
| Cookies | Session cookies without `Secure`, `HttpOnly` or `SameSite` | Yes | Yes | Yes | Yes | Passive |
| HTTPS / TLS | http pages, mixed content, weak or expiring certificates | Yes | Yes | Yes | Yes | Passive |
| Information leaks | Stack traces shown to users, version banners, public source maps | Yes | Yes | Yes | Yes | Passive |
| Exposed files and URLs | Reachable `/.env`, `/.git/`, backups, debug and admin pages, Swagger on Live | Yes | Yes | Yes | Yes | GET only, fixed list |
| Tokens in browser storage | Login tokens in localStorage | Yes | Yes | Yes | Yes | Passive |
| Logged-out access | Pages that show data without login | Yes | Yes | Yes | Yes | GET only |
| Role checks (IDOR) | A low-permission user opening another user's records by ID | Yes | Yes | Yes | Yes (view only) | GET only on Test and Live |
| Open redirect | Redirect parameters that send users to other sites | Yes | Yes | Yes | Yes | The redirect target is read, never followed |
| Reflected XSS | Marker text in URL parameters and search fields that runs as script | Yes | Yes | Yes | Yes | Harmless marker; URL and search fields only on Test and Live |
| SQL injection signals | Database errors after special characters | Yes | Yes | Yes (gentle) | Yes (gentle) | GET parameters only on Test and Live |
| Stored XSS | Marker text saved through forms that runs for other users | Yes | Yes | No | No | Saves data, so Local and Dev only |
| Login rate limit | Unlimited password attempts | Yes | Yes | No | No | Could lock accounts, so Local and Dev only |

**Limits on active checks:** requests are spaced out (default 2 per second on Live), stay on the project's own domain, and stop on the first sign of blocking by a firewall. Each finding is reported with a severity (Critical, High, Medium, Low), the URL, the evidence and how to fix it.

The scan reduces risk; it does not prove the app is secure. It covers common, known problems (roughly the OWASP Top 10 basics).

## Safety rules

Every run is read-only unless the chosen test type is CRUD (or the active security checks on Local and Dev), and these rules cannot be turned off by project config.

1. **Read-only by default.** Every request other than GET, HEAD and OPTIONS is blocked in the browser before it reaches the server. Two exceptions let pages that read data with POST still work: GraphQL queries (never mutations or subscriptions) and calls the project lists in `readOnlyAllow` (e.g. `"POST /api/orders/search"`). Service workers are disabled so no request can go around the block.
2. **Blocked side effects.** Endpoints that email, book carriers, charge payments or call third parties are blocked in every test type, CRUD included. QAgent suggests candidates by name (send, email, sms, notify, book, tender, ship, void, cancel, charge, pay, refund, invoice, label); the project's list lives in `.qagent.json`.
3. **No CRUD on Live.** Not offered in the app, and refused by the planner and the engine if requested.
4. **Live confirmation.** Typing `LIVE` starts any Live run; the security scan on Live needs `LIVE SECURITY`. Typing `YES` starts CRUD.
5. **Login every run.** Choose: log in yourself in a QAgent browser window (recommended), type a username and password (kept in memory only), or skip. Login happens before blocking starts, because login forms usually POST.
6. **Nothing stored.** No credentials, tokens or session files are written to the project or to the app's settings. The session lives in a temporary folder deleted when the run ends, is cancelled, or QAgent closes; folders left by a crash are deleted on the next start. If the project sets a logout URL, QAgent also opens it to end the session on the server.
7. **Own domain only.** Requests to other domains are allowed to load (fonts, CDNs) but never judged, scanned or crawled.
8. **Honest results.** A page that was not really checked is unverified, never passed.
9. **Smoke gate.** If Smoke fails on an environment, the other chosen types are skipped there.
10. **Logout pages are never opened** by any test type or the crawler, so a run cannot end its own session.

## First-time setup and `.qagent.json`

First-time setup is mainly about environments: QAgent detects the Local, Dev, Test and Live URLs, asks you to confirm or fill the gaps, and saves them in `.qagent.json` at the project root.

**Setup screen** (opens automatically the first time you open a project):

1. Detects the framework, local start command and port, and the page list.
2. Shows the environment URLs it found; you confirm, edit or add them. Environments with no URL are hidden from the Run screen.
3. Asks which URL means you are logged in (pre-filled with the first page after the login page, if found), and optionally the logout URL.
4. Offers the top menu pages as the Smoke list (empty = chosen at run time).
5. Lists candidate side-effect endpoints to block.
6. Offers to add `qagent-results.xlsx` and `.qagent/` to `.gitignore`.

Setup takes about a minute; every later change is made on the **Settings** screen (a form, with a raw JSON tab validated against the same schema) or by editing the file. Commit `.qagent.json` so the team shares it. It never holds credentials.

```json
{
  "framework": "react-router",
  "local": { "start": "npm start", "url": "http://localhost:3000" },
  "environments": {
    "dev":  { "url": "https://dev.example.com", "apiUrl": "https://dev-api.example.com" },
    "test": { "url": "https://test.example.com" },
    "live": { "url": "https://app.example.com" }
  },
  "login": {
    "path": "/login",
    "loggedInPath": "/dashboard",
    "logoutPath": "/logout",
    "accountSelector": ".navbar .user-name"
  },
  "lists": {
    "smoke": ["/dashboard", "/orders"],
    "criticalFlows": [],
    "crud": []
  },
  "pages": {
    "/orders/:id": { "params": { "id": "orderId" } },
    "/admin/reindex": { "skip": "Starts a long background job" }
  },
  "blockedEndpoints": ["/api/email/send", "/api/ups/ship"],
  "readOnlyAllow": ["POST /api/orders/search"],
  "budgets": { "readyWarnMs": 5000, "readyFailMs": 15000, "apiWarnMs": 3000, "lcpWarnMs": 4000 },
  "readiness": { "readyTimeoutMs": 30000 },
  "workers": 3,
  "results": { "file": "qagent-results.xlsx" }
}
```

| Key | Purpose |
| --- | --- |
| `environments.*.apiUrl` | The API's domain when it differs from the site; its calls count as the app's own |
| `login.logoutPath` | Opened at the end of a run to end the session on the server. Without it, the session is only deleted locally |
| `login.accountSelector` | Element showing the logged-in user's name, for the Run History "App account" column |
| `readOnlyAllow` | Non-GET calls that only read data. Pages that load data this way would otherwise show empty |
| `readiness` | Override the content area, loader selectors, quiet window, timeout or tab depth for unusual apps |
| `discovery` / `crawlLimit` | `"crawl"` to always crawl instead of reading routes from code; the page limit |
| `baseBranch` | The branch Change-impact compares with (default `origin/development`, then `origin/main`) |
| `visual` | `threshold`: share of pixels that may change (default 0.005); `mask`: selectors hidden in screenshots, such as dates and counters |
| `lists.criticalFlows` / `lists.crud` | Recorded journeys and CRUD screens, normally created on the Flows screen. A flow's `allowWrites` lets it save data, never on Live |

**Recording flows:** on the Flows screen, a browser opens with a QAgent bar. Log in, press **Record**, and do the journey; **Add check** makes the next clicked text an expectation. For a CRUD screen, start on the list page, type `QAGENT` as the record's name when creating and `QAGENT-EDITED` when editing; each run replaces them with a unique `QAgent-…` name. Recording really happens on the site, and `confirm()` dialogs are accepted automatically, both while recording and when replaying.

**Visual baselines** are kept per environment. A changed page fails and keeps its new screenshot and a diff image in `.qagent/baselines/<env>/` until you choose **Approve visual changes** on the Results screen.

**Record IDs** for pages like `/orders/:id` differ per environment, so they live in `.qagent/test-data.<env>.json`, which is gitignored and stays on each developer's machine.

**Adding pages later:** on the **Pages** screen, **New since the base branch** finds pages (a new page file, or a path added to a router file) and send/book/charge calls added since the base branch, and asks OMS's `e2e:add-page` questions: daily key page for Smoke? which record ID does it need (saved on this machine only)? never open it automatically? block this call? Critical flows and CRUD screens are recorded on the Flows screen. `qagent new-pages <project>` lists the same from the command line.

**Commit reminder** (optional, per clone): turned on from the same panel. It installs a small `pre-commit` hook in this clone's `.git/hooks` that prints a hint when a commit adds a page-like file or a send/book/charge call, and never blocks the commit. An existing `pre-commit` hook is never changed; QAgent shows the one line to add to it instead.

## How a run works

A run starts from the **Run** screen of an open project and ends with a new sheet in the workbook, the results shown in the app, and the session deleted.

1. **Choose** one or more environments and one or more test types; Change-impact asks for the base branch (default `origin/development`, then `origin/main`).
2. **Confirmations:** `LIVE` for Live, `LIVE SECURITY` for the security scan on Live, `YES` for CRUD. CRUD is not offered when Live is chosen.
3. **Login per environment:** a QAgent browser window opens on the login page and closes itself once the logged-in URL is reached, or you type a username and password in the app, or skip. Role checks ask for a second, low-permission login.
4. **Local only:** if the app is not answering on its local URL, QAgent runs the start command and shows its output in a log pane, waits for it (up to 5 minutes), and stops it after the run.
5. **Tests run** in a headless browser, 3 pages at a time by default. The Run screen shows live progress per page; failures link to the page's source file, which opens in your editor.
6. **Results** are written to the workbook (one new sheet for each environment and test type, plus a Run History row) and shown on the Results screen.
7. **Clean-up:** the app logs out (if a logout URL is set), the session folder is deleted, and the summary offers **Open in Excel**.

Cancel stops the run, deletes the session and still writes what finished, marking the rest unverified.

## Excel report

Results go to `qagent-results.xlsx` in the project root, in the same design as the OMS Test Result workbook; nothing else is kept on disk after a successful write.

| Sheet | Contents |
| --- | --- |
| Guide | Rebuilt on every run: what each sheet shows, result meanings, common reasons, the 11 test types, environments, safety rules, troubleshooting |
| Run History | One row per environment × test type: run time, environment, test type, result, passed, failed, skipped, unverified, pass rate, link to the sheet, run by (git user name), device (computer name), app account (logged-in user) |
| `<Env> <Type> <MM-DD HH.MM>` | One per run, newest first: navy title band, subtitle with who ran it, 5 summary tiles with a live pass-rate formula, then an Excel table of every page and tab with failures first (page, heading/tab, result, reason, details, console errors, failed API calls, time, source file). Tab green when passed, red when failed, grey when unverified |
| Security sections | On security-scan sheets: findings by severity with URL, evidence and fix |
| Visual baselines | Not in the workbook; kept as PNGs in `.qagent/baselines/` (gitignored) |

A type skipped by the Smoke gate gets a Run History row marked skipped, with no sheet.

**Writing safely:** QAgent waits up to 1 minute if the workbook is open in desktop Excel, keeps a safety copy in the system temp folder until the write succeeds, builds the new file in temp and copies it in place in one write. If the write fails, results are kept in `.qagent/results/<run>/` and the app says where.

**Sharing:** the file is gitignored by default because Excel files do not merge. To share results with a team, set `results.file` to a OneDrive- or SharePoint-synced path; the write method above was built for synced folders.

## Architecture and tech stack

QAgent is written entirely in TypeScript as an Electron app: the main process plans each run, a separate engine process drives the browser and writes the workbook, and the React window shows progress, so a long or crashed run never freezes the app.

```
┌──────────────── Electron app ────────────────┐
│  Window (React)        Main process           │
│  Projects · Setup  ◄──► project list, menus,  │
│  Run · Results          planner, local app,   │
│  Settings      (IPC)    open in editor        │
└───────────────────────────┬──────────────────┘
                            │ run plan on stdin · progress on stdout (JSON lines)
                ┌───────────▼───────────┐        ┌──────────────────┐
                │ Engine process        │ ─────► │ Chrome / Edge /  │
                │ runner · checks ·     │        │ Chromium         │
                │ safety guard · report │        └──────────────────┘
                └───────────┬───────────┘
                            ▼
               qagent-results.xlsx (project root)
```

The main process reads `.qagent.json` and the project's code (through the framework adapters) to build a run plan, then starts the engine with Electron's built-in Node. The plan travels over the engine's standard input, so typed credentials never touch disk; the engine streams progress back as one JSON line per event. A dev CLI uses the same protocol, for CI and scripting.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript (strict) | One language for app, engine and UI |
| Desktop shell | Electron (current stable), `contextIsolation` on, `nodeIntegration` off, a typed preload bridge | Node is built in, so the engine runs unchanged; one codebase for Windows and Linux |
| UI | React 18 + Vite, light and dark themes following the OS | Familiar stack; same components for every screen |
| Engine process | Node child process started with Electron's Node (`ELECTRON_RUN_AS_NODE`) | Isolates crashes and memory from the window |
| Browser automation | `playwright-core` (library API, own runner) | Full control of parallel pages, request blocking and tracing; nothing installed into the user's project |
| Browser | Installed Chrome or Edge when present; otherwise Chromium downloaded on first run (about 150 MB) | Keeps the installer small; most machines need no download |
| Accessibility | `@axe-core/playwright` | Industry-standard WCAG rules |
| Excel | `exceljs` | Styled sheets, tables, formulas and hyperlinks, same as the OMS workbook |
| Code parsing | `@babel/parser` for JS/TS routes and imports; pattern scanners for PHP, C# and Python route declarations | Page discovery and Change-impact without running the project's build |
| Settings validation | JSON schema (`schemas/qagent.schema.json`) | One schema for the Settings screen, setup and the raw JSON editor |
| Git | `git` CLI | Changed files, merge base, untracked files, run-by name |
| Visual diff | `pixelmatch` + `pngjs` | Small and fast screenshot comparison |
| Security | Own passive and active checks; `npm audit`, `pip-audit`, `dotnet list package --vulnerable`, `composer audit` when installed; Node `tls` for certificates | Uses each ecosystem's official vulnerability data |
| Bundling | `esbuild` for main, preload, engine and CLI; Vite for the UI | Fast builds and start-up |
| Packaging | `electron-builder`: NSIS installer for Windows, AppImage and `.deb` for Linux | One config for both platforms |
| Updates | `electron-updater` reading GitHub Releases | Automatic updates with no update server |
| Tests | Vitest (engine, adapters, planner), Playwright for the app window, one small sample app per framework | Each adapter is proven on a real project shape |
| CI | GitHub Actions | Build, test, sign and publish on a version tag |

## Repository layout and development

QAgent lives in its own repository (e.g. `qagent`), separate from OMS; no OMS code is copied, only the ideas.

```
qagent/
├─ package.json              # app name, version, scripts, electron-builder config
├─ src/
│  ├─ main/                  # Electron main process: windows, menus, project list, IPC, open in editor
│  ├─ preload/               # typed bridge the UI calls (no Node in the window)
│  ├─ ui/                    # React screens: Projects, Setup, Run, Results, Settings
│  ├─ planner/               # .qagent.json + adapters + choices → run plan; starts the local app
│  ├─ engine/                # separate process, no Electron imports
│  │  ├─ main.ts             # stdin/stdout protocol, cancel, clean-up
│  │  ├─ runner.ts           # environments, Smoke gate, parallel pages, crawl queue
│  │  ├─ guard.ts            # which requests may leave the browser (safety rules 1–2)
│  │  ├─ monitor.ts  readiness.ts  assess.ts  tabs.ts  visit.ts  login.ts  session.ts
│  │  ├─ checks/             # one file per test type (Phase 3)
│  │  ├─ security/           # passive and active checks (Phase 4)
│  │  ├─ impact/             # git diff + import tracing (Phase 3)
│  │  └─ report/             # Excel writer, Guide sheet
│  ├─ adapters/              # one folder per framework: detect, start, envs, routes
│  │  ├─ react-router/  ├─ nextjs/  └─ crawl/   # Phase 1; more in Phase 5
│  ├─ shared/                # types, config loader
│  └─ cli.ts                 # dev CLI over the same engine protocol
├─ schemas/                  # qagent.schema.json
├─ fixtures/                 # small sample apps, one per adapter, each with expected.json
├─ scripts/                  # build, fixture e2e runner
├─ test/                     # Vitest unit tests
├─ build/                    # app icons (icon.ico, icon.png 512×512)
├─ README.md  CHANGELOG.md  LICENSE
└─ .github/workflows/        # build, test, release
```

**Develop and debug**

1. `npm install`, then `npm run dev`: the app opens with hot reload for the UI; breakpoints work in the main process, and the engine starts with `--inspect` in debug mode so you can attach to it.
2. Open any sample app from `fixtures/` in it.
3. `npm test` runs Vitest; `npm run test:e2e` runs QAgent against every fixture app and compares the workbook with each fixture's `expected.json`; `npm run test:app` drives the real app window (set `QAGENT_APP_EXE` to test a packaged build). `npm run dist` builds this platform's installers into `release/`.
4. Without the window: `node dist/cli.js pages <project>` lists the pages found; `node dist/cli.js run <project> --env local --types smoke,regression --login browser` runs tests.

**Adding a framework later** = one new folder in `adapters/` implementing four functions (`detect`, `startCommand`, `environments`, `routes`) plus a fixture app with its `expected.json`.

## Publishing on GitHub Releases

QAgent is published as installers attached to a GitHub Release; a version tag builds, signs and publishes both platforms, and installed copies update themselves.

| Platform | Download | Installs to | Updates |
| --- | --- | --- | --- |
| Windows 10 and 11 (x64) | `QAgent-Setup-X.Y.Z.exe` (NSIS, per-user, no admin rights) | `%LOCALAPPDATA%\Programs\QAgent` | Automatic |
| Linux x64 (Ubuntu 20.04+, Debian 11+, Fedora and others) | `QAgent-X.Y.Z.AppImage` | Anywhere; run it directly | Automatic |
| Linux x64 (Debian / Ubuntu) | `qagent_X.Y.Z_amd64.deb` | `/opt/QAgent` | Install the new `.deb` (the app says when one is out) |

**Code signing (Windows)**

An unsigned Windows installer works but shows "Windows protected your PC" (SmartScreen) until enough people have installed it. The plan, cheapest first:

| Option | Cost | Notes |
| --- | --- | --- |
| **SignPath Foundation** (recommended) | Free for open-source projects | Requires an OSI licence (MIT qualifies), a public repository, and builds that run in GitHub Actions. Signing runs in CI; no certificate is kept by the team. The signer shown is SignPath Foundation. Apply once the repository is public |
| Unsigned | Free | Until SignPath approval: the release notes explain **More info → Run anyway** |
| Azure Trusted Signing | About US$10 a month | Signer shown is Techovarya; needs a verified organisation |
| OV/EV certificate from a CA | About US$200–600 a year | Hardware token or cloud HSM required |

Linux packages are not code-signed; each release publishes `SHA256SUMS` so downloads can be checked.

**One-time setup**

1. **Repository:** the public repository is https://github.com/Hemang67/QAgent.
2. **App identity:** `package.json` → `name` `qagent`, `productName` `QAgent`, `version`, `description`, `author` (Techovarya), `license` `MIT`, `repository`; `build.appId` `com.techovarya.qagent`.
3. **Icons:** `build/icon.ico` (Windows, 256×256 inside) and `build/icon.png` (512×512, Linux).
4. **Release config:** `electron-builder` targets `nsis` (Windows) and `AppImage`, `deb` (Linux), with `publish: github`.
5. **Signing:** apply to SignPath Foundation; once approved, add its GitHub Action step to the Windows job.
6. **Page:** `README.md` with screenshots and download links; release notes come from `CHANGELOG.md`.

**Release workflow** (runs when you push a tag such as `v1.0.0`):

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    permissions:
      contents: write   # attach installers to the GitHub Release
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm test
      - run: npm run build
      # Windows: SignPath signing step goes here once approved
      - run: npx electron-builder --publish always
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Each release**

1. Update `CHANGELOG.md`.
2. Run `npm version minor` (or `patch`), which updates `version` and creates the tag, then `git push --follow-tags`; the workflow builds and publishes.
3. Check the draft release on GitHub, then publish it; installed copies offer the update on their next start.

**Options**

| Need | How |
| --- | --- |
| Test before release | `npm run dist` builds the installers locally into `release/` |
| Beta channel | Tag `v1.3.0-beta.1`; GitHub marks it pre-release, and only users who chose "beta updates" in Settings receive it |
| Team-only build | Share the installer file directly; it updates from public releases unless updates are turned off in Settings |
| Withdraw a release | Mark it as draft or delete it on GitHub; the updater ignores it |

## User guide

Download QAgent from GitHub Releases, open a web project, confirm the environment URLs once, and run Smoke; results land in `qagent-results.xlsx` and on the Results screen.

**Requirements**

| Need | Details |
| --- | --- |
| Operating system | Windows 10 or 11 (64-bit), or 64-bit Linux (Ubuntu 20.04+, Debian 11+, Fedora 38+ or similar) |
| Disk space | About 300 MB for QAgent; about 300 MB more for Chromium only if Chrome or Edge is not installed |
| Git | Needed for Change-impact, "Add new pages" and the Run History "Run by" name |
| Local runs | The project's own toolchain (Node, PHP, .NET SDK or Python) and any backend it needs, running or startable |
| Dev / Test / Live runs | The site's URL reachable from your machine, and a login for it |
| Security scan | Optional: `npm`, `pip-audit`, `dotnet` or `composer` for the vulnerable-library check; a second, low-permission login for role checks |
| Excel | Any app that opens `.xlsx`: Excel, Excel online, LibreOffice |

**Install**

- **Windows:** download `QAgent-Setup-X.Y.Z.exe` from the latest GitHub Release and run it. If SmartScreen appears, choose **More info → Run anyway** (only until the installer is signed).
- **Linux (AppImage):** download `QAgent-X.Y.Z.AppImage`, run `chmod +x QAgent-*.AppImage`, then open it.
- **Linux (Debian/Ubuntu):** `sudo apt install ./qagent_X.Y.Z_amd64.deb`.

**First launch: the tour**

The first time QAgent opens, a guided tour starts. It opens a small demo shop that QAgent serves on your own computer, and walks through the real screens: choosing environments and test types, logging in, a real Smoke and Full regression run, the scan view, the results (the demo has a page that really fails), Pages and Flows. Move with **Previous**, **Next** and **Skip tour**; nothing advances by itself, and each step explains what that part of QAgent does. Where a step asks you to do something (tick a test type, press Run) you can click the real control or press Next to have it done. Take it again from **Help → Take the tour** or App settings.

**Updates**

QAgent checks GitHub Releases when it starts and every few hours. When a new version is out, a bar at the top offers **Download**; the download runs inside the app with a progress bar, and **Restart now** installs it (or it installs the next time QAgent closes). After an update, a **What's new** window lists the changes since the version you had. **Help → Check for updates** and **Help → What's new** are always available; App settings can turn the checks off or include beta versions. The Linux `.deb` does not update itself: install the new `.deb`.

**First run on a project**

1. Open QAgent and choose **Open project**, then pick the project folder (or drag it onto the window).
2. If Chrome or Edge is not installed, QAgent offers to download Chromium; accept.
3. The Setup screen shows what it detected; confirm the environment URLs and the logged-in page.
4. On the Run screen, pick **Local** and **Smoke**, choose how to log in, and press **Run**. Log in when the browser window opens.
5. Wait for the summary, then look at the Results screen or choose **Open in Excel**.

**Screens and actions**

| Where | What it does |
| --- | --- |
| Projects | Recent projects; open, remove from list, open a new folder |
| Run | Choose environments, test types and login; live progress per page; Cancel |
| Results | Latest runs with summary tiles and failures first; click a failure to open its source file in your editor; Open in Excel |
| Settings (project) | Edit `.qagent.json` as a form or raw JSON, validated; re-run setup |
| Project menu → Add new pages | Finds new pages and side-effect endpoints since the base branch and asks where they belong |
| Project menu → List pages | Every page QAgent found, how it was found, and its source file |
| Project menu → Approve visual baseline | Accepts the latest screenshots as the new baseline |
| App settings | Editor used to open files, theme, beta updates, update checks |

**Reading results**

| Result | Meaning |
| --- | --- |
| passed | Content rendered, data loaded, tabs worked, no errors |
| failed | A real problem; see Reason and Details |
| skipped | The logged-in account may not open the page, it is a logout page, or it is set to be skipped; not a defect |
| unverified | Not really checked: login skipped or failed, session rejected, or the page needs a record ID |

**Troubleshooting**

| Symptom | Fix |
| --- | --- |
| Every page unverified | Login was skipped or failed; run again and log in |
| "Workbook is locked" | Close it in desktop Excel; results were kept in `.qagent/results/` |
| Local run never starts | Check the start command and port in Settings, and that the backend is running; the log pane shows the app's output |
| A page needing an ID is unverified | Use **Add new pages**, or add the ID in `.qagent/test-data.<env>.json` |
| Pages empty with "empty-after-blocked-request" | The page reads data with POST; add that call to `readOnlyAllow` in Settings |
| Change-impact: base branch not found | Run `git fetch`, or choose another base branch on the Run screen |
| Security scan on Live stopped early | A firewall blocked it; this is reported as a finding. Tell the server owner before the next scan |
| Chromium download fails | Behind a proxy, set the proxy in App settings, or install Chrome or Edge |
| Windows: "Windows protected your PC" | The installer is not yet signed: **More info → Run anyway** |
| Linux: AppImage will not start | Make it executable (`chmod +x`); on Ubuntu 22.04+ install `libfuse2` |

## Roadmap and decisions

QAgent is built in five phases, each one usable on its own; the first public release on GitHub comes at the end of phase 3.

1. **Engine core — done (Oct 30, 2026):** runner, readiness and request blocking (with GraphQL queries and `readOnlyAllow`), Smoke with the gate and automatic menu pages, Full regression with tabs, crawl fallback, login (browser window, username/password, skip) with optional logout, Excel report with Guide and Run History, React Router and Next.js adapters, dev CLI. Proven by `npm run test:e2e` on the React Router and Next.js fixture apps (5 scenarios), and by page discovery on OMS 2.0 (138 pages, every page mapped to its source file).
2. **Desktop app — done (Oct 30, 2026):** Electron shell, Projects (recent list, drag and drop), Setup (detected URLs, login pages, Smoke list, side-effect endpoints found in the code, .gitignore), Run (live progress, typed or browser login, LIVE confirmation, cancel, local app output), Results viewer read from the workbook, Pages, Project settings (form and raw JSON, schema-validated), App settings (editor, theme, updates, Chromium download), CI and release workflows. Proven by `npm run test:app` (16 checks driving the real window, also on the packaged `QAgent.exe`), and the Windows installer builds (115 MB). Shared with the team as an unsigned installer.
3. **All checks — built (Oct 30, 2026), release pending:** Change-impact, Accessibility, Performance, Broken links, Responsive, Visual change (with approval of new baselines), Critical flows and CRUD (recorded in a browser on the new Flows screen), and the sci-fi interface with the live scan view. Proven on the React Router fixture by `npm run test:e2e`, including the recorder, and by unit tests for Change-impact on a real git repository. Still to do: the **first public release** on GitHub with auto-update, which needs the repository link (and signing, once SignPath approves).
4. **Security scan — built (Oct 30, 2026):** all 15 checks in the table above, as one row per check plus a findings table (severity, URL or file, evidence, fix) on the sheet and the Results screen. Every active request goes through one guarded client: own domain only, GET only, never a blocked endpoint, spaced out (2 per second on Live), and stopped at the first firewall-like answer, after which the remaining checks are unverified. Secret values are masked to their first four characters. Proven on fixtures with planted flaws (`scripts/security-check.mjs`): Local finds every planted flaw; Test finds the read-only ones and provably saves nothing and makes no extra login attempts; a clean app gets only real findings.
5. **More frameworks — built (Oct 30, 2026):** Vue / Nuxt, Angular, SvelteKit, plain HTML, Laravel, .NET and Python adapters; Change-impact for server-side files; "New since the base branch" (Add new pages) and the commit reminder. Route discovery is proven on a source fixture per framework (`fixtures/routes/`), and full runs (login, Smoke, Full regression) on a Flask app and an ASP.NET Razor Pages + MVC app. Laravel is proven on route discovery only, since PHP was not installed on the build machine.

**Decisions**

| Decision | Chosen | Status |
| --- | --- | --- |
| Product form | Desktop app (Electron); the VS Code extension is dropped | Confirmed Oct 30, 2026 |
| Platforms | Windows and Linux; no macOS | Confirmed |
| Distribution | Public download on GitHub Releases (https://github.com/Hemang67/QAgent), in-app updates | Confirmed |
| Windows signing | SignPath Foundation (free for open source); unsigned until approved | Confirmed (free option first) |
| Name | QAgent | Confirmed |
| Publisher / app ID | Techovarya / `com.techovarya.qagent` | Default |
| Results location | `qagent-results.xlsx` in the project root, gitignored | Confirmed |
| Record IDs | `.qagent/test-data.<env>.json`, gitignored | Confirmed |
| Live security scan | Restricted active checks allowed with `LIVE SECURITY` | Confirmed |
| UI | React | Confirmed |
| Licence | MIT (also required for free SignPath signing) | Confirmed |
| First release scope | Phases 1–3 | Confirmed |
| Mobile apps | Not in v1; later emulator-only | Confirmed |
| Read-only exceptions | GraphQL queries automatically; other POST reads per project in `readOnlyAllow` | Chosen during Phase 1 |
| Logout | Optional `login.logoutPath` per project; without it the session is deleted locally | Chosen during Phase 1 |
