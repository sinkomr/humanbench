# HumanBench

HumanBench is a free, browser-based battery of short cognitive tasks that draws your
results as a "jagged blob": one spike per ability, with its uncertainty shown, instead of
a single score. Its disclaimer (DESIGN §13):

> For curiosity and self-reflection. Not an IQ test, a clinical assessment, or a basis for decisions about education, employment, or health.

Status: static MVP in progress (milestone M1). The design spec is in
[docs/DESIGN.md](docs/DESIGN.md), and the build backlog is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Layout

- `web/`: the app (Vite, Svelte 5, TypeScript strict), deployed to GitHub Pages under `/humanbench/`
  - `web/src/engine/`: scoring (MAP/Laplace, EAP, the §7.8 retest model for multi-session saves), timing
  - `web/src/save/`: the save file (DESIGN §8): schema v1 validator, RFC 8785 canonical JSON, merge, migrations, copy code, upload by content, download/share, localStorage autosave
  - `web/src/tasks/`: task families
  - `web/src/render/`: the item and block renderers (what the taker sees), by family
  - `web/src/review/`: the dev-only procedural review page (G7), never in a production build

  - `web/src/selftest/`: the RT timing self-test page (`web/rt-selftest.html`)
  - `web/src/viz/`: blob and bar views, export
- `schema/`: JSON Schemas; `schema/save-v1.json` is the save file (JSON Schema 2020-12, mirrored by `web/src/save/validate.ts`); the build publishes each `schema/*.json` at `/humanbench/schema/`
- `web/e2e/`: Playwright end-to-end and axe accessibility tests (`web/playwright.config.ts`)
- `.github/workflows/`: `ci.yml` (typecheck, tests, build; Playwright e2e) and `pages.yml` (deploy on push to `main`)

## Development

Requires Node 24.15 or newer in the 24 line, or Node 26 or newer; Node 25 is not supported (see `engines` in `web/package.json`). CI uses Node 24, from `web/.nvmrc`.

Install dependencies:

```zsh
cd web
npm ci
```

Run the dev server (it serves at http://localhost:5173/humanbench/):

```zsh
npm run dev
```

Typecheck, run the tests, and build:

```zsh
npm run check
npm test
npm run build
```

Preview the production build:

```zsh
npm run preview
```

Rerun the tests on every file change:

```zsh
npm run test:watch
```

### End-to-end and accessibility tests

The Playwright suite in `web/e2e/` (ROADMAP M1.A) builds the app, serves the production build with
`vite preview` under `/humanbench/`, and runs every `*.spec.ts` in three browsers: desktop Chromium,
desktop WebKit, and an emulated iPhone 13 (WebKit). Each UI page must have no serious or critical
axe-core violations of WCAG 2.0, 2.1 or 2.2 at levels A and AA (DESIGN §13): call
`expectNoSeriousAxe(page)` from `web/e2e/axe.ts` once the page has rendered.

Download the browsers once (on Linux this also installs their system libraries):

```zsh
cd web
npm run e2e:install
```

Run the suite, or one browser, or one file:

```zsh
npm run e2e
npm run e2e -- --project=webkit
npm run e2e -- e2e/smoke.spec.ts
```

WebKit is much slower than Chromium on a busy machine, so its tests get 90 s each rather than 60 s.
Locally, avoid running the suite alongside other heavy jobs (such as the bank's test suite), or
use fewer workers:

```zsh
npm run e2e -- --workers=2
```

It serves on port 4174. If that port is taken, pick another:

```zsh
E2E_PORT=4185 npm run e2e
```

After a failure, open the report, which links each failed test's trace:

```zsh
npx playwright show-report
```

The `e2e` job in `.github/workflows/ci.yml` runs the same suite on pushes to `main` and `dev` and on
pull requests, with the browsers cached, and uploads the report as an artifact.

Test files live next to the code in `web/src/` (and `web/scripts/` for the Node scripts). A file named `*.dom.test.ts` or `*.svelte.test.ts` runs in jsdom (use it for components and runes); every other `*.test.ts` runs in Node. `npm run check` fails on Svelte accessibility warnings as well as type errors.

### Renderers

Each family's renderer lives in `web/src/render/<family>/` (ROADMAP M1.13). A renderer is a Svelte
component that takes the item's `spec`, never its key, and calls `onrespond(response)` with exactly
the response the family's `score()` takes (`web/src/render/common/props.ts`). `web/src/render/entry.ts`
maps the typed-entry and block families (series, quant, span_fwd, span_bwd, corsi, rt_simple,
rt_choice4, coding, reading) to their renderers; `web/src/render/visual.ts` maps the image
families. Timing uses animation frames for onsets and `performance.now()` for responses, through
the RT timing utilities (`web/src/tasks/rt/timing.ts`). The RT renderer also reports, through
`oninputtype`, whether a block's responses came from the keyboard, a mouse or touch (from each
tap's `pointerType`), for the RT observation's `input_type` (DESIGN §11.6 norms them separately).
`web/src/render/entry-leak.dom.test.ts`
renders hundreds of generated instances and fails if the key, or anything that tells the keyed
option apart, reaches the DOM.

### Procedural review page (G7)

DESIGN §4.4 asks for a human spot audit of 30 instances per procedural family and generator
version: 11 registered families, 330 instances, planned at about 4 hours in all (ROADMAP M1.G7).
The review page shows, for every registered family, the instances with seeds `review-<family>-1` to `review-<family>-30`: each one rendered as
the taker sees it (or as JSON when the family has no renderer yet), with its key, the verifier's
checks, the difficulty features, the b prior, the stratum and the sibling group. Mark each one
pass, fail or unsure, with a note. The page is also the renderer gallery: you can work through any
renderer and see the response it sends and how `score()` reads it.

It runs only on the development server and is never part of a production build
(`web/scripts/review-build.test.ts`). Start it, which opens http://localhost:5173/humanbench/review.html:

```zsh
cd web
npm run review
```

Choose a family at the top, set "Per page" (1, 5, 10 or 30), and enter your name as the
reviewer: the verdict buttons and the export stay off until you do, because every verdict
records who gave it. Verdicts are saved in this browser (localStorage) as you go. "Export JSON" downloads
them as a `hb.g7_review.v1` file for the bank; "Import JSON" merges such a file back in (for
example on another machine). The file format is documented in `web/src/review/verdicts.ts`: a
summary row per family (planned, reviewed, pass, fail, unsure) and one row per verdict (item id,
family, generator version, seed, family_id, sibling_group, verdict, note, reviewer, UTC time;
an imported verdict keeps its own reviewer). A family
passes when all 30 of its instances pass; after a fail, fix the cause and audit the family again
(a generator fix bumps its version, which gives new instance ids, so old verdicts do not carry
over).

The e2e suite checks the page in the dev server too: `playwright.config.ts` starts `vite` on
port 4175 as well (set `E2E_DEV_PORT` if it is taken), and `web/e2e/gallery.spec.ts` checks every
renderer with axe, at 360 px and 640 px widths, with reduced motion, and from the keyboard. Its
two screenshot baselines (the Corsi board, the coding legend) are recorded on macOS Chromium; after
an intended visual change, update them:

```zsh
cd web
npx playwright test e2e/gallery.spec.ts --project=chromium --update-snapshots
```

### RT timing self-test

`/humanbench/rt-selftest.html` (ROADMAP M1.23, DESIGN §11.6) checks how precisely a browser and
display can time reaction-time trials. It measures the refresh rate, rAF frame-interval jitter, the
`performance.now()` resolution, the onset scheduling error (the frame a stimulus appears in versus
the first refresh at or after its target), and the delay from key and pointer events to their
handlers. Each check shows p50, p95 and max; it passes when its p95 is below 5 ms. The pass rule is
the p95, not the max, so up to 5% of samples may be slower: a few dropped frames at 120 Hz (8.3 ms)
still pass, and the max column shows them. The page ends with a JSON report to copy. It is linked
from nowhere else and asks search engines not to index it.

To run it on a local production build, open http://localhost:4173/humanbench/rt-selftest.html
after:

```zsh
cd web
npm run build
npm run preview
```

Keep the tab in front, on the display under test (for example a 120 Hz MacBook panel), with other
busy tabs closed. `?quick=1` runs small samples (the e2e smoke test uses it); the report marks it.

### Procedural families

Each procedural task family lives in `web/src/tasks/<family>/` and implements the contract in
`web/src/tasks/family.ts` (ROADMAP A1, A11, M1.F2): a seeded generator, a verifier and a scorer,
tested with the shared property suite in `web/src/tasks/testing.ts` over 10,000 instances (with
the family's own key-leak check, `specLeaksKey`, or a documented waiver, and its synthetic
responses: correct/incorrect for items, valid/invalid for blocks, plus malformed ones that must
throw a `MalformedResponseError`). A family is `kind: 'item'` (keyed power items the adaptive
selector serves) or `kind: 'block'` (a fixed block run whole, one family per sub-task, whose
`score()` returns the engine observation or the reasons there is none). The families registered
in `web/src/tasks/registry.ts` are rotation, matrices, series and quant (items), and span_fwd,
span_bwd, corsi, rt_simple, rt_choice4, coding and reading (blocks); `registry.test.ts` runs every
registered family through the property suite at n = 500. The private bank repo re-verifies at least 1,000 TS instances of every family with
its Python twin. Dump them into the sibling bank checkout (`../humanbench-bank`, or
`$HB_BANK_DIR`) with:

```zsh
cd web
npm run dump:families -- --family rotation --n 1000 --bank
```

Use `--all` in place of `--family <name>` to dump every registered family,
`--module src/tasks/<family>/index.ts` in place of `--family` for a family that is not in
`web/src/tasks/registry.ts` yet, or `--out <file>` in place of `--bank` to write elsewhere.

After changing a generator, refresh every bank fixture that comes from this repo: the family
dumps, the toy family dump, the coding and rt scoring parity dumps and the series analysis fixture
(then update `ANALYSIS_FIXTURE_DIGEST` in `series.test.ts` if it changed):

```zsh
cd web
npm run dump:families -- --all --n 1000 --bank
npm run dump:families -- --module src/tasks/_example/index.ts --family example --n 1000 --bank
npm run dump:coding-scores -- --n 1000 --bank
npm run dump:rt-scores -- --n 1000 --bank
npx tsx -e "import('./src/tasks/series/analysis-fixture.ts').then((m) => process.stdout.write(m.serializeAnalysisFixture()))" > ../../humanbench-bank/golden/ts_dumps/series.analysis.json
```

The other direction, the bank's golden scoring files into `web/src/engine/__fixtures__/`, is
`npm run sync:golden` (ROADMAP A17; `uv run hb sync golden` in the bank does the same copy).
When the bank checkout is present, `npm test` fails if any of these copies is stale:
`web/scripts/ts-dumps-sync.test.ts` requires a dump of every registered family (and the toy
family), checks each dump's header, item count, seed order, items and bytes, checks the series
analysis fixture, and fails on any file in `golden/ts_dumps/` that nothing here checks;
`web/scripts/coding-scores-dump.test.ts` and `web/scripts/rt-scores-dump.test.ts` check the
coding and RT parity dumps (`coding_scores.json`, `rt_simple_scores.json`,
`rt_choice4_scores.json`), and
`web/scripts/sync-golden.test.ts` the golden fixtures. Without the bank (as in CI) these checks
skip and name the path they looked at.

The reading passages are authored in `web/src/tasks/reading/passages.json`, with evidence spans
and option rationales that only the verifier and tests read (ROADMAP A14). The app ships
`passages.render.json`, the same bank without those fields. After editing `passages.json`,
regenerate it (`npm test` fails until you do), then copy `passages.json` to the bank (`uv run hb
sync passages` in the bank does the same copy):

```zsh
cd web
npm run sync:reading-render
cp src/tasks/reading/passages.json ../../humanbench-bank/src/hb/gen/reading/passages.json
```

App code imports the task helpers from `web/src/tasks` (the barrel) and the families only from
`web/src/tasks/registry.ts`. `web/scripts/bundle.test.ts` builds the app and both entry points
and fails if a bundle carries reading authoring data. `web/scripts/timing-lint.test.ts` fails on
any wall-clock read under `web/src` (`Date.now`, argless `new Date()`) and on unseeded
randomness in `web/src/engine` and `web/src/tasks`: timing uses `performance.now()`.

### Language lint

`npm test` also runs the language lint (ROADMAP A13, DESIGN R-5.6.x) in
`web/scripts/language-lint.test.ts`. It reads the user-facing text of the app: string and template
literals and Svelte markup under `web/src`, JSON copy, `web/public`, the published `schema/` JSON,
`web/index.html` and this README (not tests, test data or code comments). It fails on the banned
terms listed, each with its reason, in `web/scripts/language-lint.ts`. Matching ignores case, and
anything but a letter ends a word (a digit or `_` too), so `IQR` is not a hit. Only two texts may
carry a banned word: the §13 disclaimer, quoted exactly, and the R-5.6.5 resource sentence, which
is spelled out only in `web/src/copy.ts` as `RESOURCE_LINE` (import it; only the results footer
renders it). The Emotion Reading tooltip that DESIGN R-5.6.2 fixes word for word is not allowed
yet: ROADMAP M6.1 must settle that with an A13 amendment (see the lint's header). To lint the repo,
or just some files, and print each hit:

```zsh
cd web
npm run lint:language
npm run lint:language -- src/App.svelte ../README.md
```

The build uses the base path `/humanbench/`. To build for a different path, such as a custom domain served at `/`:

```zsh
VITE_BASE=/ npm run build
```

The Pages workflow sets the base path from the repository's Pages settings, so a custom domain needs no change here. It runs `npm run check` and `npm test` before it builds and deploys.
