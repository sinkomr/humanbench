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
  - `web/src/session/`: the session flow (consent and 18+ gate, honour code, device check, practice, the A15 blocks and items with their clock, break, hard stop and confidence slider, results and save)
  - `web/src/tasks/`: task families
  - `web/src/render/`: the item and block renderers (what the taker sees), by family
  - `web/src/review/`: the dev-only procedural review page (G7), never in a production build
  - `web/src/selftest/`: the RT timing self-test page (`web/rt-selftest.html`)
  - `web/src/brief/`: "Notes for your AI" (Phase AI): a pure, deterministic generator of short notes a person pastes into their own assistant. Closed grammar `hb-brief/1`, lint, parser, checker (`check.ts`: paste any notes, see what they say and what is foreign, edited, out of date or switched off), `surfaces.json` (install and removal steps), no network; storage only when the person says they are 18 or older and asks to keep their settings, as the optional `brief_prefs` of a prefs-only save (`web/src/brief-store/`, `hb:save:v1:prefs`; settings and fit notes only, never what was typed); the builder page is `web/notes.html`; `npm run dump:briefs -- --as-of YYYY-MM` writes the notes (and the results-talk preamble) the bank's behaviour harness reads; `reveal.ts` is the light barrel the reveal and share-card screens import for the "Working with AI" card and the "Talking about your results with an AI" helper (demo at `#/dev/reveal-ai`, dev builds only)
  - `web/src/viz/`: blob and bar views, the share card and its export
  - `web/src/reveal/`: the results and reveal flow (build-up, distinctive peaks, required save, worked examples, retest advice, norms and pace)
- `schema/`: JSON Schemas; `schema/save-v1.json` is the save file (JSON Schema 2020-12, mirrored by `web/src/save/validate.ts`; its optional `brief_prefs` holds the notes settings, `web/src/save/brief-prefs.ts`); `schema/brief-v1.json` is the JSON form of the notes (mirrored by `web/src/brief/validate.ts`); the build publishes each `schema/*.json` at `/humanbench/schema/`
- `web/e2e/`: Playwright end-to-end and axe accessibility tests (`web/playwright.config.ts`); `routes.ts` lists every route for the accessibility pass (M1.21)
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

### θ-recovery simulation (ROADMAP M1.4b)

`npm run sim:cat` runs the TS simulations on the bank's M1.4a simulees
(`web/src/engine/__fixtures__/sim_m14a_v1.json`, copied by `npm run sync:golden`): (a) the
non-adaptive M1.4a replication, whose per-axis r must match the bank's Python result within 0.02,
and (b) adaptive first sessions with the real selector, scorer and families, under the A15 time
rule (each block takes the simulated taker's own time; every session must end within 30 min) and
with a fixed 20 items per CAT axis. It prints one table per run with its acceptance
verdict; the full N = 2,000 run takes several minutes. `npm test` runs N = 300 versions;
`npm run test:slow` runs the full size.

The r criterion is DESIGN §14.3's (decided 2026-09-29): r ≥ .85 on MAT, SPA and QR **at 20
items/axis**, judged only on the fixed-length run. The run under the A15 time budget is accepted on
time (every session ≤ 30 min) and 90% coverage; its r is printed as informational, not judged.
`--fixed 0` (or under 20) therefore leaves the r criterion unchecked and says so, and `--strict`
(exit 1 on any failed acceptance) refuses it with a usage error (exit 2). `npm test` holds only a
regression floor on r at 20 items/axis (r ≥ .80, N = 150); the criterion itself is asserted by
`npm run test:slow`, which CI does not run.

```zsh
npm run sim:cat
npm run sim:cat -- --part a --n 300
npm run sim:cat -- --part b --n 300 --target-min 45 --fixed 0 --json sim.json
npm run test:slow
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
pull requests, with the browsers cached, and uploads the report as an artifact. Each Playwright project runs
in two halves (`--shard=1/2`, `--shard=2/2`), six jobs in all, so that the accessibility sweep keeps each job
well inside its time limit; locally `npm run e2e -- --project=webkit --shard=1/2` runs one half.

#### The accessibility pass (ROADMAP M1.21)

Four things stand behind "axe finds nothing serious on any route":

- **The route list** (`web/e2e/routes.ts`): the three pages, `#/privacy`, the dev routes, every screen of the
  session flow (gate, honour code, device check, ready, practice, each part of the session, the confirmation
  questions, the break, the end, the Spatial item in a browser without WebGL), the results and the share card in
  their states, the notes builder (as it opens, filled in, with a fit note, the 18+ error, the kept settings, a
  returning person's notice, and with a checked paste) and the RT self-test. `web/scripts/a11y-routes.test.ts`
  fails when a page, a hash route, a session part, a renderer or a screen component has no entry, so a new
  screen cannot skip the pass. To add one, give it an entry that opens the state, and name each file it shows
  (a folder is not a claim); the states a component alone does not show are pinned in that test.
- **The sweep** (`web/e2e/a11y.spec.ts`, `npm run e2e:a11y`): each route is opened on a fresh page set in a
  wide font (`web/e2e/wide-font.ts`: Verdana or DejaVu Sans, with extra letter spacing, so a layout that fits
  only a narrow font fails on every machine, the Linux CI runners included) and checked for 0 serious or
  critical axe issues in light and dark, nothing animating under `prefers-reduced-motion`, no sideways scroll
  and no clipped text at 320 px, at 200% browser zoom (640 × 400) and with the text alone at 200%, and, on
  desktop engines, a Tab round of the page that reaches every control, never gets stuck, and shows focus. Under
  `prefers-reduced-motion` it also fails on any animation or transition that started while the page loaded,
  however short (it listens for the events, not only for what is running at one moment).
- **A whole session by keyboard** (`web/e2e/keyboard-session.spec.ts`): the `?fast=1` session from the start
  page to the save, the share card and back, with Tab, Enter, Space, the arrow keys and typed text only. A guard
  in the page counts real pointer events and the test fails on any; it also fails on a screen that leaves
  nothing in focus or hides where focus is (a heading or container that a screen moves focus to is the only
  thing allowed without a ring), and unless all six parts of the session were played in order, each showing its
  own kind of screen. The reaction targets are read from the live region the page announces, as a
  screen-reader user would.
- **The colours** (`web/scripts/contrast.test.ts`, in `npm test`): every colour token of the stylesheets, in
  light and dark, is in a text pair (4.5:1) or a control pair (3:1), or is listed as decorative with a reason,
  wherever it is declared (a colour token in a rule the test does not list fails, and so does one written as a
  name, `oklch()` or with an alpha, whose contrast cannot be computed); a hard-coded colour (hex, `rgb()`,
  `hsl()`, a name) must be reviewed in the same file; no colour is set inline in markup or script.
  `web/scripts/a11y-static.test.ts` checks the page shells (language, title, zoom allowed), that no text size is
  fixed in px, and that every animation or transition is switched off for `prefers-reduced-motion` for its own
  selector (or `*`), not just somewhere in its file.

#### A whole session and its save (ROADMAP M1.22)

`web/e2e/session-save.spec.ts` (`npm run e2e:save`) is M1 acceptance 4 ("iOS Safari emulation downloads and
uploads a save") and the AI.7 acceptance "the WebKit save round trip covers the preferences". It runs in
Chromium, desktop WebKit and the iPhone 13 emulation, one serial group per browser:

- **The session.** The notes builder keeps its settings on the device, then the `?fast=1` session is played from
  the start page through all six parts to the build-up, the required save and the cards that follow it.
  `web/e2e/session-driver.ts` plays it the way most people do: a mouse and the number and reaction keys on
  desktop, a finger and the on-screen keypads and boards on the phone (Playwright's `tap()` sends touch events,
  so the renderers see `pointerType: 'touch'`; the saved reaction blocks say `touch`). Answers are not chosen to
  score well; the test checks that every part ran in order and that the file holds every instrument.
- **Download.** The file the browser receives has the `humanbench-<id>-<date>.hbsave.json` name, validates against
  the schema, is the RFC 8785 canonical text, holds the session and the `brief_prefs` the builder kept, and has
  no `sig`. The device keeps the same session as its autosave, and drops the autosave that held only the
  settings, since the session's holds them too.
- **Upload.** On a device that has nothing, the save loads by its content however it arrives: named as
  downloaded, renamed `.txt` the way iOS does, with no extension or type, with a byte-order mark, as pasted file
  text, as a pasted copy code, and as a code wrapped inside a message. The next session is added to it (R-8.1):
  the earlier session, the identifier and the notes settings come back unchanged, and the same session reached
  twice (the autosave and the file) is still one. Files that are not saves, and a code cut short, are refused
  with a message.
- **Copy code and share.** The code the app hands to the clipboard is decoded in Node (a different gzip) and equals
  the file. Where the clipboard refuses, the code is shown for copying by hand and that code loads. The share
  sheet is given the file, and on a platform that only shares text the same content as `.txt`; both load again.
- **Notes.** The settings that travelled in the save are the ones the notes builder shows on the other device,
  whether it finds them in the session's autosave or is given the file.

The engines cannot read the system clipboard (WebKit has no clipboard permission in Playwright) or open the
share sheet or the Files picker, so the spec replaces those two with recorders in the page. They see exactly
what the app hands over, and say yes; Chromium also reads the real clipboard. Downloads are real events in all
three projects (the iPhone emulation reports them like the desktop engines do), and the files are read from them.

Test files live next to the code in `web/src/` (and `web/scripts/` for the Node scripts). A file named `*.dom.test.ts` or `*.svelte.test.ts` runs in jsdom (use it for components and runes); every other `*.test.ts` runs in Node. `npm run check` fails on Svelte accessibility warnings as well as type errors.

### Session flow

The session (ROADMAP M1.15) is `web/src/session/`. `run.ts` is the state machine: it plans the A15
order with the M1.14 scheduler, runs the blocks and the adaptive items, keeps the active-time clock,
and records §8 response tuples that `save/rescore.ts` scores to the same observations. It has no DOM
and no timers of its own, so its tests (`run.test.ts`) drive it on a fake timeline with the simulated
takers of `web/src/sim/`. The screens are Svelte components around it (`SessionApp.svelte`
orchestrates them); `persist.ts` writes the autosave through the save library after every answer
(a session with no answer yet writes nothing). The rules that depend on minutes (the break at 30,
the hard stop at 57, the coverage floor when the time budget is gone) are covered in Playwright on a
fake clock (`web/e2e/session.spec.ts`). The 3-item coverage floor is per axis: items that earlier
sessions hold count toward it (`coverage.ts`), so an abandoned start does not lift it.

The under-18 path keeps nothing: the gate screens hold their state in memory, and the consent
record, the autosave and the restore of earlier saves all come after the gate is passed.

For development, `?fast=1` (for example `http://localhost:5173/humanbench/?fast=1`) makes the session
timeline run 20 times faster, so the break, the hard stop and the progress ring can be seen in
seconds; response times measured that way are not valid scores. It works only where the build-time
constant `__HB_DEV_ROUTES__` is true (the dev server, the tests and the Playwright build). A plain
production build ignores it and does not contain it (`web/scripts/dev-routes.test.ts` builds the
flag's module both ways and runs it).

### Results and reveal

The end of a session (ROADMAP M1.R, DESIGN §10) is `web/src/reveal/`, shown by
`session/Finished.svelte`. The results are the practice-adjusted re-score of the whole save
(`results.ts`, on `save/rescore.ts`), so a returning person sees all their sessions together. The
blob builds up skill by skill (`frames.ts`; `prefers-reduced-motion` skips it and "Skip animation"
ends it), then come the distinctive peaks (`peaks.ts`: within-person contrasts whose 90% interval
excludes 0, ROADMAP A12), the cluster drill-down, and the save file, which is required before
leaving: a `beforeunload` guard (`guard.ts`) stays on until the file is downloaded or shared. Only
then do the share card, the "Notes for your AI" card and the results-talk helper appear
(`AfterSave.svelte`, `slots.ts`; Phase AI). Three worked examples (`worked/`) are fresh procedural
items whose solutions are derived from the item and tested against the key; their families go into
the save's `seen_families`, so later sessions leave them out. The R-5.6.5 resource line is rendered
only in the results footer. A 20-minute focus session (`RunConfig.focus`) runs only the parts a
person picks, from the results or from the start screen of a returning person.

The browser suite cannot sit through a full session, so `web/e2e/reveal.spec.ts` loads a simulated
earlier session (`web/scripts/e2e-save.ts`, run with `tsx` because Playwright's loader cannot import
the passages JSON) on the ready screen and finishes at once.

### Share card

The share card (ROADMAP M1.18, DESIGN §9.9) is a 1200 × 630 picture of the blob, the most distinctive
peaks and the number of sessions. `web/src/viz/card.ts` builds it as an SVG string (so it is
deterministic and tested in Node), `card-copy.ts` holds every line of text on it, `export.ts` draws
the 2400 × 1260 PNG on a canvas and offers the SVG file and the share sheet, and
`web/src/reveal/ShareCard.svelte` is the panel in the share slot after the save. Everything happens
on the device: no request is made and there is no image server (`web/scripts/share-card.test.ts`
scans for network, storage and notes imports). Tests pin these rules:

- only measured skills the person leaves ticked are drawn, and a hidden skill leaves no trace: the
  file is byte-identical whatever its estimate is;
- Emotion Reading is put on a card only at or above the 0 SD ring (R-5.6.4), whether or not it is
  ticked, and no skill is ever picked out as a weakness;
- the peaks are worked out over the skills on the card only (so a hidden skill, or an Emotion Reading
  below the 0 SD ring, never moves the numbers of the visible ones), credible ones only (A12), at
  most three, each with its 90% range, and never a low;
- the blob is the on-page blob (`card.dom.test.ts` compares them element by element), with a linear
  radius, its uncertainty, and no total, area or single score;
- every text on the card is an axis label, a ring label or a line of `card-copy.ts`, so notes text
  (Phase AI), the R-5.6.5 resource line and the save file cannot reach it;
- the panel links to the results-talk helper below it.

Two departures from the letter of DESIGN §9.9, which ROADMAP M1.18 (the higher authority) does not
require: the card says "Based on n sessions" and gives each listed peak's 90% range instead of
"SE ±" (there is no single standard error across skills, and the blob's band and whiskers carry the
uncertainty), and the SVG export is the card's own SVG, which `card.dom.test.ts` compares with the
page's D3 chart element by element, rather than a serialisation of the page's node. File names carry
the person's local date.

`web/e2e/share-card.spec.ts` checks the real PNG (2400 × 1260 with the blob drawn), the SVG, the
toggles, the reflow at 320 px and axe in Chromium, WebKit and the iPhone 13 emulation.

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
registered family through the property suite at n = 500. A QR instance may carry the family flags
`ladder_probe` (a held-out ladder probe) or `practice_only` (a quiz item that never enters a
scored session), each `true` or absent and never both (ROADMAP A23, AI.2; `web/src/tasks/family.ts`).
No family sets them yet. The other item tags (topic, curriculum level, notation, ...) are added
to bank records only; the public repo never sees a curriculum level, and
`web/scripts/item-tags.test.ts` keeps it out of every rendered or saved surface. The private bank repo re-verifies at least 1,000 TS instances of every family with
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
`web/scripts/sync-golden.test.ts` the golden fixtures. The bank also owns the topic taxonomy
(Phase AI, ROADMAP A23): `schema/topics-v1.json`, `schema/topics-aliases.json` and the frozen
ledger of released IDs `schema/topics-released-v1.json` (test-only here) there are copied into
`web/src/tasks/` by `npm run sync:topics` (`uv run hb sync topics` in the bank does the same
copy), and `web/scripts/sync-topics.test.ts` checks them. Without the bank (as in CI) these checks
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

This repo owns the banned vocabulary. The private bank's item lint (gate G6, ROADMAP M3.2) reads a
copy of it: `web/scripts/language-terms.json`, which `language-terms.test.ts` keeps equal to the
lists in `language-lint.ts` (and, when the bank checkout is present, to the bank's
`golden/language_terms.json`, A17). After changing the lists, refresh the export here and copy it
in the bank:

```zsh
cd web
npm run dump:language-terms
cd ../../humanbench-bank
uv run hb sync language-terms
```

The build uses the base path `/humanbench/`. To build for a different path, such as a custom domain served at `/`:

```zsh
VITE_BASE=/ npm run build
```

The Pages workflow sets the base path from the repository's Pages settings, so a custom domain needs no change here. It runs `npm run check` and `npm test` before it builds and deploys.
