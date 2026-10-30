# CLAUDE.md

QAgent is an Electron desktop app (Windows and Linux) that tests web-app projects: it finds pages in the project's code, drives Chrome/Edge with playwright-core, and writes results to `qagent-results.xlsx` in the project. The spec is `QAgent – Design, Publishing & User Guide.md`; keep it in step with behaviour changes.

## Commands

```bash
npm run build      # esbuild main/preload/engine/cli + Vite UI into dist/
npm run typecheck  # tsc --noEmit (strict)
npm test           # Vitest unit tests (test/*.test.ts), ~1 min
npm run test:e2e   # every runnable fixture + recorder-check + security-check, ~15 min
npm run test:app   # drives the Electron window; QAGENT_APP_EXE=<QAgent.exe> tests a packaged build
npm run dist       # electron-builder installers into release/
node scripts/e2e-fixtures.mjs <name>   # one fixture only, e.g. flask
```

Run `npm run build` (or `node scripts/build.mjs --no-ui`) before the e2e scripts: they use `dist/cli.js`.

## Architecture

- `src/engine/` runs as a **separate process** (`dist/engine.js`), started with Electron's own Node (`ELECTRON_RUN_AS_NODE=1`). Protocol: line 1 of stdin is the `RunPlan` JSON (it carries typed passwords, so it must never be written to disk); later stdin lines may be `{"kind":"cancel"}`; stdout is one `EngineMessage` JSON per line. No Electron or vscode imports in the engine.
- `src/planner/` builds the `RunPlan` from `.qagent.json`, the adapter's routes, test data and the user's choices. It also holds Change-impact (`impact.ts`), new-page detection and the commit reminder.
- `src/adapters/<framework>/` each implements `detect`, `startCommand`, `environments`, `routes`. Order in `adapters/index.ts` matters (most specific marker first). JS route-object parsing is shared: `codeRoutes()` in `react-router/index.ts` serves React Router, Vue Router and Angular.
- `src/main/` is the Electron main process (IPC handlers in `main.ts`, run manager, recorder, results reader); `src/preload/preload.ts` is the only bridge; `src/ui/` is React with no Node access. The IPC contract is `src/shared/ipc.ts`.
- `src/cli.ts` speaks the same engine protocol as the app.

## Safety rules: do not weaken

These are product guarantees, enforced in more than one layer on purpose (UI, planner, engine):

- Read-only by default: `engine/guard.ts` decides every browser request. Only CRUD (and flows with `allowWrites`, never on Live) may write. `blockedEndpoints` are blocked in every type.
- Every active security request goes through `SafeClient` (`engine/security/client.ts`): own domain only, GET only, rate-limited, stops at the first firewall-like answer.
- Stored XSS and the login rate-limit check run on Local and Dev only. CRUD never on Live. Live needs `LIVE`; the Live security scan needs `LIVE SECURITY`; CRUD needs `YES`.
- No credentials or tokens on disk: the login session lives in a temp folder deleted on exit; secret values in reports are masked (`mask()`).
- A page that was not really checked is `unverified`, never `passed`.

## Traps learned the hard way

- **`ELECTRON_RUN_AS_NODE` is set in VS Code terminals.** Electron then starts as plain Node (`app` is undefined). Scripts that launch the app delete it from the env (`scripts/dev.mjs`, `scripts/app-smoke.mjs`); run `npx electron .` from a clean shell.
- **Every `spawn` needs `windowsHide: true`.** A console process started from the GUI app opens a window, takes focus and minimised QAgent.
- **The engine's `cwd` must be a real folder.** In the packaged app it lives inside `app.asar`; a `cwd` there makes the spawn fail. `RunManager` uses the project root and handles the `error` event.
- **Windows short paths:** `os.tmpdir()` may be `C:\Users\ABCDEF~1\…` while git reports long paths. Compare with `fs.realpathSync.native` (see `gitChanges`).
- **`@babel/parser` v8 is ESM-only:** tsconfig uses `moduleResolution: Bundler`; esbuild bundles it.
- **Shell text inside TS template strings** (`planner/reminder.ts`): backticks inside `"…"` in `$( )` must be emitted as `` \` ``, and `$` must not start an ERE group. Check the generated script with `sh -n`.
- **Fixture state:** the React fixture's mock API keeps data in memory while its Vite server runs. Use `POST /api/test/reset` before tests that create data; a stray server on port 5179 makes runs see old data.
- **`npm run test:app` opens real windows.** A click or a covering window can disturb it; the script restores minimised windows and passes occlusion flags.
- `fixtures/routes/*` is generated: edit `scripts/make-route-fixtures.mjs` and rerun it, not the files.
- `exceljs` `Worksheet.orderNo` exists at runtime but not in its types (cast).

## First run, what's new, updates

- The first launch shows the tour (`src/ui/tour.tsx`). It opens the bundled demo shop (`demo/site`, shipped as an extra resource), which `src/main/demo.ts` copies to the app's data folder and serves on a free local port, and it walks the real screens. It never advances by itself: Previous / Next / Skip, and Next performs a step's action if the user has not.
- Settings `tourDone` and `lastSeenVersion` decide the tour and "What's new". The notes come from `CHANGELOG.md`, which the build copies into `dist/`: write each release's notes there under `## x.y.z`.
- `src/main/updater.ts` checks GitHub Releases at start and every 4 hours, and the window asks before downloading and before restarting. `QAGENT_FAKE_UPDATE=<version>` plays the whole update sequence without a server (used by `test:app`).
- `test:app` pre-writes `settings.json` (`tourDone`, `lastSeenVersion`) so the main checks start as a returning user; the tour and update scenarios use their own data folders.
- App icon and logos come from `build/logo.png` through `node scripts/make-icons.mjs`.

## Testing expectations

- Change engine or adapter behaviour → add or extend a fixture expectation (`fixtures/<app>/expected.json`, `expected-routes.json`) or a unit test, then run the affected suite.
- The runnable fixtures plant specific failures on purpose (`/crash`, `/hang`, `/reports`, the security lab pages); their `expected.json` lists what each must report.
- Laravel is proven on route discovery only (no PHP on the build machine); running it needs Docker or PHP.

## Status and decisions

- Phases 1–5 are built. The public repository is https://github.com/Hemang67/QAgent; releases come from the `release` workflow on a `v*` tag, and installed copies update from its GitHub Releases (`package.json` `build.publish`, `RELEASES_URL` in `main.ts`).
- Product decisions: Electron desktop app (VS Code extension dropped), Windows + Linux only, public download from GitHub Releases, MIT, free code signing via SignPath Foundation once the repository is public.
