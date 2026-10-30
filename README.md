<p align="center"><img src="docs/logo.png" alt="QAgent" width="240"></p>

# QAgent

QAgent is a desktop app for Windows and Linux that tests any web-app project you open. It finds the pages in your code, opens each one in a real browser, and records what is broken (failed API calls, crashes, endless loaders, blank pages, accessibility, speed and security problems) in an Excel workbook in the project folder.

It works without changing your project's code, and it never writes to a live site: every request other than GET is blocked in the browser unless you choose a test type that needs it.

> **Status:** version 0.1.0, the first public release. Tested on sample apps of every supported framework.

## Download

Get the latest version from [Releases](https://github.com/Hemang67/QAgent/releases/latest):

| System | File |
| --- | --- |
| Windows 10 / 11 (64-bit) | `QAgent-Setup-X.Y.Z.exe` |
| Linux (any distribution) | `QAgent-X.Y.Z.AppImage` (`chmod +x`, then run it) |
| Debian / Ubuntu | `qagent_X.Y.Z_amd64.deb` (`sudo apt install ./qagent_*.deb`) |

QAgent uses your installed Chrome or Edge. If neither is present, it offers to download Chromium (about 150 MB) once.

**Updates are built in.** QAgent checks for new versions when it starts and every few hours, downloads them inside the app when you choose **Download**, and installs them on restart. After an update, **What's new** lists the changes. (The Linux `.deb` does not update itself; install the new `.deb`.)

> The Windows installer is not yet code-signed. If Windows shows "Windows protected your PC", choose **More info → Run anyway**.

## First run

The first time it opens, QAgent offers a **guided tour** of the real screens. It tests a small demo shop that runs on your own computer, including a real run with a real failure to look at. Move with Previous, Next and Skip tour; take it again any time from **Help → Take the tour**.

Then, on your own project:

1. Open QAgent and choose **Open project…** (or drop a project folder on the window).
2. Confirm the environment URLs QAgent found (in `.env`, `appsettings`, `launchSettings.json` or Angular environment files) and the page that means "logged in". This is saved to `.qagent.json`; commit it so your team shares it. It never holds passwords.
3. On **Run tests**, pick **Local** and **Smoke**, choose how to log in, and press **Run**. The scan view shows each page as it is tested.
4. Read the results on the **Results** screen, or open `qagent-results.xlsx`.

| Result | Meaning |
| --- | --- |
| passed | Content rendered, data loaded, tabs worked, no errors |
| failed | A real problem: see the reason and details |
| skipped | The account may not open the page, or it is set to be skipped |
| unverified | Not really checked: login skipped or failed, or the page needs a record ID |

## Test types

| Test type | What it checks | Writes data | Environments |
| --- | --- | --- | --- |
| Smoke | The site answers, login works, home and top menu pages load. If it fails, the other types are skipped there | No | All |
| Change-impact | Only the pages your git changes can affect | No | Local, Dev |
| Full regression | Every page and tab: errors, failed API calls, blank views, endless loaders | No | All |
| Critical flows | Journeys you recorded on the **Flows** screen, step by step | Only if a flow allows it, never on Live | All |
| CRUD | Creates, edits and deletes a `QAgent-…` record on recorded screens, then cleans up | Yes | Local, Dev, Test |
| Accessibility | WCAG 2.1 AA with axe-core | No | All |
| Performance | Time to ready, slowest API call and LCP against budgets | No | All |
| Broken links | Dead links, missing images, failed scripts and styles, mixed content | No | All |
| Responsive | Phone and tablet widths: sideways scrolling, cut-off content, overlaps | No | All |
| Visual change | Screenshots against approved baselines; approve changes on the Results screen | No | All |
| Security scan | 15 checks, from vulnerable libraries and secrets to XSS, SQL injection signals and role checks | Stored-XSS markers on Local and Dev only | All; read-only on Test and Live |

## Safety

- **Read-only by default.** Non-GET requests are blocked in the browser. GraphQL queries and calls you list in `readOnlyAllow` are let through.
- **Blocked endpoints** (email, ship, book, charge…) are never called, in any test type, CRUD included. Setup suggests them from your code.
- **Live needs confirmation:** type `LIVE` to run against it, and `LIVE SECURITY` to scan it. CRUD never runs on Live. CRUD needs `YES`.
- **Nothing is stored.** Passwords are typed for each run and kept in memory only; the login session is deleted when the run ends.
- **Own domain only.** Other domains load (fonts, CDNs) but are never tested, scanned or crawled.
- **Honest results.** A page that was not really checked is unverified, never passed.

## Supported projects

Pages are read from the code for:

| Framework | Pages found from |
| --- | --- |
| React Router | Route objects and `<Route>` JSX, including route constants and lazy pages |
| Next.js | `app/` and `pages/` folders |
| Vue / Nuxt | Vue Router `routes` arrays; Nuxt `pages/` |
| Angular | `Routes` arrays, `loadComponent`, `loadChildren` |
| SvelteKit | `src/routes/**/+page.svelte` |
| Plain HTML | Every `.html` file |
| Laravel | `routes/web.php`, including resources and prefix groups |
| .NET | Razor Pages, Blazor `@page`, MVC controllers |
| Python | Django `urls.py`, Flask routes and blueprints, FastAPI pages |

React, Next.js, Vue / Nuxt, Angular and SvelteKit are all Node.js projects: QAgent starts them with their own npm script. Server-rendered Node.js apps (Express, NestJS, Fastify, Koa) and any other web project are crawled from the home page after login. Pages that need a record ID (`/orders/:id`, `?orderId=`) read it from `.qagent/test-data.<env>.json`, which stays on your machine.

On the **Pages** screen, **New since the base branch** finds pages and risky calls added on your branch and asks how to test them. It can also turn on a commit reminder for your clone.

## Command line

The same engine runs without the window, for CI and scripts (`node dist/cli.js` after `npm run build`):

```bash
qagent pages <project>                     # pages found, environments, start command
qagent new-pages <project> [--base main]   # pages and risky calls added since a branch
qagent run <project> --env local --types smoke,regression --login browser
```

`run` options: `--env local,dev,test,live`, `--types` (any of `smoke impact regression flows crud a11y perf links responsive visual security`), `--login browser|credentials|skip` (credentials from `QAGENT_USERNAME` / `QAGENT_PASSWORD`, or typed), `--low-login credentials` (second user for role checks, from `QAGENT_LOW_USERNAME` / `QAGENT_LOW_PASSWORD`), `--base <branch>`, `--headed`, `--crawl`, and the confirmations `--confirm LIVE`, `--confirm-security "LIVE SECURITY"`, `--confirm-crud YES`.

## Development

Requires Node 20 or newer. The fixture apps also need Python 3 (Flask) and the .NET 10 SDK.

```bash
npm install
npm run dev        # the app with hot reload
npm test           # unit tests (Vitest), about 1 minute
npm run test:e2e   # QAgent against every fixture app, the recorder and the security scan, about 15 minutes
npm run test:app   # drives the real app window (Playwright + Electron); opens windows on your desktop
npm run dist       # installers for this OS into release/
```

| Folder | What is there |
| --- | --- |
| `src/engine` | The test engine: a separate Node process (runner, safety guard, checks, security scan, Excel report) |
| `src/adapters` | One folder per framework: detect, start command, environment URLs, pages |
| `src/planner` | Turns settings and choices into a run plan; Change-impact, new pages, commit reminder |
| `src/main`, `src/preload`, `src/ui` | The Electron app: main process, window bridge, React screens |
| `fixtures/` | Runnable sample apps with planted problems and `expected.json`; `fixtures/routes/` holds route-only samples |
| `scripts/` | Build, dev, and the end-to-end checks |

Design, safety rules, publishing and the full user guide: [QAgent – Design, Publishing & User Guide](QAgent%20–%20Design,%20Publishing%20&%20User%20Guide.md).

## Licence

MIT © Techovarya
