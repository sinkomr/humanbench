# HumanBench

HumanBench is a free, browser-based battery of short cognitive tasks that draws your
results as a "jagged blob": one spike per ability, with its uncertainty shown, instead of
a single score. Its disclaimer (DESIGN §13):

> For curiosity and self-reflection. Not an IQ test, a clinical assessment, or a basis for decisions about education, employment, or health.

Status: static MVP in progress (milestone M1). The design spec is in
[docs/DESIGN.md](docs/DESIGN.md), and the build backlog is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Layout

- `web/`: the app (Vite, Svelte 5, TypeScript strict), deployed to GitHub Pages under `/humanbench/`
  - `web/src/engine/`: scoring, save file, timing
  - `web/src/tasks/`: task families
  - `web/src/viz/`: blob and bar views, export
- `schema/`: JSON Schemas (the save file, from M1); the build publishes each `schema/*.json` at `/humanbench/schema/`
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

### Procedural families

Each procedural task family lives in `web/src/tasks/<family>/` and implements the contract in
`web/src/tasks/family.ts` (ROADMAP A1, A11): a seeded generator, a verifier and a scorer, tested
with the shared property suite in `web/src/tasks/testing.ts` over 10,000 instances (with the
family's own key-leak check, `specLeaksKey`, or a documented waiver). The families registered
in `web/src/tasks/registry.ts` are rotation, matrices, series, quant, span_fwd, span_bwd, corsi,
rt, coding and reading; `registry.test.ts` runs every registered family through the property suite
at n = 500. The private bank repo re-verifies at least 1,000 TS instances of every family with
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
coding and rt parity dumps, and
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
literals and Svelte markup under `web/src`, JSON copy, `web/public`, `web/index.html` and this
README (not tests, test data or code comments). It fails on the banned terms listed, each with its
reason, in `web/scripts/language-lint.ts`. Matching ignores case and respects word boundaries. Only
two texts may carry a banned word: the §13 disclaimer, quoted exactly, and the R-5.6.5 resource
sentence, which is spelled out only in `web/src/copy.ts` as `RESOURCE_LINE` (import it; only the
results footer renders it). To lint the repo, or just some files, and print each hit:

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
