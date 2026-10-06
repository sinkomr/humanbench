# UX review harness

Persona specs drive a prebuilt copy of the public app and leave screenshots, page text, accessibility trees,
metrics and findings behind; fix packages run the existing e2e specs in isolation. Everything runs from `web/`
(the e2e helpers shell out to `npx tsx scripts/e2e-save.ts` with the current directory).

## Build the app once

```
npm run ux:build
```

Writes `test-results/ux-review/_dist` (base `/humanbench/`, dev routes on, so `?fast=1` and `#/dev/*` work).
It takes about 2 s (`ux-review/build.ts` runs `vite build` with the dev routes flag set; it is a script because
`scripts/dev-routes.test.ts` keeps that flag out of package.json). **Do not rebuild it while reviewers are running**:
they all serve this one directory.

## Baseline

`personas/baseline.ux.ts` toured all 50 product routes on desktop Chromium at 1280 px, light scheme, with metrics, one test per
route group (`start`, `session`, `results`, `notes`, `selftest`). Read `web/test-results/ux-review/baseline/tour/summary.json`
(per route: ok/error, console log, metrics per `<width>-<scheme>`) and `.../baseline/tour/<route>/1280-light.png` (+ `.txt`, `.aria.yml`)
before starting; re-run a group with `--grep "baseline: <group>"` and `UX_RUN=baseline`.

## Run a persona

```
UX_PORT=4606 UX_RUN=phone npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/smoke.ux.ts --project=iphone
```

`npm run ux:review -- <args>` is the same command with the config filled in.

| Variable | |
| --- | --- |
| `UX_PORT` | required, integer: the port of this run's `vite preview` |
| `UX_RUN` | required, kebab-case: the run id and output folder |
| `UX_DIST` | build dir relative to `web/` (default `test-results/ux-review/_dist`) |
| `UX_REUSE=1` | reuse a server already listening on `UX_PORT` |

Projects: `chromium` (Desktop Chrome), `webkit` (Desktop Safari), `iphone` (iPhone 13), `iphone-se`
(iPhone SE, 375 x 667), `pixel` (Pixel 7). One worker, 15 minutes per test, 15 s expect timeout, no retries.
Specs are `personas/<name>.ux.ts`; copy `personas/smoke.ux.ts` as the template.

**Ports.** Every package has its own 46xx port (this package: 4606 for the preview, 4607 and 4608 for the isolated
e2e). Two runs on one port fail at start (`--strictPort`), which is the point.

## What the lib gives you (`import ... from '../lib'`)

- `Shots(page, runId, sub?)`: `shot(name, {fullPage, locator})`, `text(name)`, `aria(name)`, `json(name, data)`,
  `all(name)` (png + txt + aria under one counter number). Files go to `test-results/ux-review/<runId>/<sub>/NNN-name.ext`;
  every method returns the path relative to the repo root (what a finding lists) and never throws ('' on failure).
  Use one `Shots` per directory: the counter starts at 1.
- `trackConsole(page)`: live `{errors, warnings, pageErrors, failed}`; `readability(text)`; `pageMetrics(page, {touch, axe, scope})`:
  headings, landmarks, tab stops, touch targets under 24 px (44 px with `touch`), text fields under 16 px (iOS zooms on focus),
  overflow, clipped text, longest line, longest paragraph, live regions, axe.
- `tour(context, {runId, routes, widths, schemes, textZoom, metrics, axe, touch, sub})`: opens each route of `PRODUCT_ROUTES`
  (`e2e/routes.ts` without the dev tools) on a fresh page and photographs it at each width and scheme:
  `<runId>/tour/<route>/<width>-<scheme>.png`, plus the page text and accessibility tree of the first one, and
  `<runId>/tour/summary.json` (entries are merged by route, so several tours of one run add up). A route that fails to
  open is recorded with its error and a screenshot of what was on screen, and the tour goes on. Every route starts with the app's
  browser storage emptied (like each e2e test's new context), or the consent record one route leaves would make the next skip
  the gate; `keepStorage: true` turns that off.
- `playJourney(page, {runId, touch, practice, everyStep, maxSteps, skipParts, ...})`: plays a `?fast=1` session with `SessionDriver`
  and photographs each screen that is new within its part; saves `<runId>/journey/journey.json`. Never throws.
  Screenshots take real time and the session clock runs 20 times faster than real time under `?fast=1`.
- `validateFindings(value, repoRoot)`.

## Findings

Each reviewer writes `ux-review/findings/<reviewer>.json`:

```
{ "reviewer": "phone", "model": "...", "summary": "...", "coverage": ["welcome (iPhone 13)", "..."],
  "findings": [ { "id": "PHONE-01", "severity": "blocker|major|minor|polish",
    "category": "bug|flow|layout|visual|a11y|copy|language-a13|performance|content|data-honesty",
    "title": "", "route": "", "env": "", "screenshots": ["web/test-results/ux-review/phone/tour/results/390-light.png"],
    "observed": "", "expected": "", "suggestion": "", "files": [], "spec_refs": [],
    "confidence": "high|medium|low", "owner_decision": false } ] }
```

Ids are `<PREFIX>-NN`, one prefix per file, unique. Screenshot paths are relative to the repo root and must exist.
Check a file before handing it in (exit code 1 on any problem):

```
npx tsx ux-review/validate-findings.ts ux-review/findings/phone.json
```

`ux-review/fixes/` holds the fix packages' notes.

## The e2e suite in isolation

For fix packages that run `e2e/*.spec.ts` beside other workstreams:

```
E2E_PORT=4607 E2E_DEV_PORT=4608 HB_RUN=fix-a npx playwright test -c ux-review/playwright.iso.config.ts e2e/smoke.spec.ts --project=chromium
```

(`npm run e2e:iso -- <args>`.) It is the base `playwright.config.ts` with its own build (`test-results/iso/<HB_RUN>/dist`), output
(`.../out`) and ports, so nothing is shared with other runs and the base config stays as it is. `E2E_PORT` and `HB_RUN` are required.
`HB_DEV_SERVER=1` also starts the Vite dev server on `E2E_DEV_PORT` (required then) and runs the dev-only specs
(`gallery.spec.ts`, `render-visual.spec.ts`), which are ignored without it. Snapshots stay in `e2e/*-snapshots/`.

The build gate of a package, with its own output directory so the shared ones are not touched:

```
npm run build -- --outDir test-results/iso/<id>/dist-gate
```

## Warnings

- **Never run the default `npm run e2e` or `npx playwright test` without `-c`**: it uses ports 4174 and 4175, which other
  workstreams use, and it wipes `web/test-results/` (which holds the review output, the shared `_dist` and the isolated builds).
- **Never rebuild the shared `_dist` while reviewers run.**
- Without `HB_DEV_SERVER=1` the dev-server routes of `e2e/a11y.spec.ts` are skipped (`HB_NO_DEV_SERVER`, `e2e/dev-server.ts`),
  not run against whatever listens on 4175. A full isolated pass therefore needs one `HB_DEV_SERVER=1` run per project.
- Output under `web/test-results/` is gitignored; copy nothing from it into a commit.
