# UX review of the static app

Fresh-eyes product review of the public static MVP in `web/`, then fixes, integration and independent verification.
Workstream `ux` of wf10, branch `wf10/ux`: wave 1 on 2026-10-05 (review, fixes, verification; commit `ab80f33`) and
wave 2 on 2026-10-05 (merge of dev `5469d40`, the partly fixed items, faster first paint, a second verification;
commit `642f440`), then a final integration (one e2e test moved to the real timeline, `e83cee4`; every gate on the
branch head, appendix B). Waves 1 and 2 are on `dev` (commit `f6fb7fa`).

**Decisions round** (2026-10-05 and 2026-10-06, workstream `uxdec` of wf10, branch `wf10/uxdec` on dev `9f68f49`):
the owner answered D1, D2, D5 and D10 and asked for more context on D3; for the other decisions the owner asked the
team to follow the recommended actions without recording them as decisions. Fifteen packages built the answers and
the recommended defaults, one more wrote up the context for D3, an integration pass joined them and ran every gate of
both repos, and a third independent verifier replayed each decision (§1, §2, §3). This round is not merged into `dev`
or `main`; the lead merges. `dev` has since moved on (M6.2 to M6.4), so the gates in appendix B are of this branch
alone.

Source records (all in `web/ux-review/`): [findings](ux-review/findings/) (one JSON per reviewer),
[triage.json](ux-review/triage.json), [fixes](ux-review/fixes/) (one JSON per fix package),
[integration.json](ux-review/integration.json), [verification.json](ux-review/verification.json) and
[verify-regressions.json](ux-review/findings/verify-regressions.json); for wave 2 the `w2-*` notes in
[fixes](ux-review/fixes/) ([w2-sync](ux-review/fixes/w2-sync.json), [w2-session](ux-review/fixes/w2-session.json),
[w2-render](ux-review/fixes/w2-render.json), [w2-perf](ux-review/fixes/w2-perf.json)),
[integration-2.json](ux-review/integration-2.json), [verification-2.json](ux-review/verification-2.json) and
[verify2-regressions.json](ux-review/findings/verify2-regressions.json); for the decisions round the records in
[ux-review/uxdec/](ux-review/uxdec/): one handoff per package (for example
[start-copy.json](ux-review/uxdec/start-copy.json)), [integrate.json](ux-review/uxdec/integrate.json),
[verification.json](ux-review/uxdec/verification.json) and [d3-context.json](ux-review/uxdec/d3-context.json).
Every count below is taken from them.
Spec references are to [DESIGN.md](../docs/DESIGN.md) (§x, R-x.y) and [ROADMAP.md](../docs/ROADMAP.md) (Ax, Mx.y).
Screenshot paths are relative to the repo root and exist only on the machine that ran the review (see §6).

## 1. Summary

**What was reviewed.** The whole static experience: welcome, 18+ gate, honour code, device check, practice, every
part of a `?fast=1` session (Reaction Time, Matrix & Series, Spatial, Working Memory digits and Corsi, Quantitative
Reasoning, Processing & Reading Speed coding and reading), the confidence panel, break, skip, finish and leave panels,
the results reveal and blob, bar view and drill-down, save and load, share card, Notes for your AI (`notes.html`),
the results-talk helper, the RT self-test (`rt-selftest.html`) and the privacy page. All 50 product routes of
`e2e/routes.ts` were toured.

**How.** Eleven reviewers (seven personas, a copy editor, two visual designers, a flow and IA reviewer) drove a
prebuilt preview build with Playwright persona specs and filed 219 findings. Triage merged them into 111 items. Six
fix packages worked in parallel in one worktree, an integration pass joined them and ran every gate, and an
independent verifier replayed each finding's scenario on the fixed build (Chromium and iPhone 13) and swept all 50
routes and two whole sessions for regressions.

**Wave 2.** One package merged dev into the branch (the RT event-clock guard and self-test v3) and settled three
conflicts in the self-test. Three fix packages then finished the three partly fixed items, fixed VER-01 and VER-02
and three loose ends from integration, and did the deferred first-paint item (UX-100). A second integration pass
joined them and ran every gate. A second independent verifier replayed the wave-2 fixes (all but two code-only changes)
and the 20 major wave-1 items on desktop WebKit and Pixel 7, which wave 1 had not covered. It also swept all 51 product routes (the 50 of
the review plus wave 1's `results-view`) and ran one whole session per engine through save and load.

**Decisions round (2026-10-05, workstream uxdec).** Every one of the 31 decisions in §2 now has a status line, and
§3 has a table of all 31:
- **4 owner decisions**, built as the owner put them: D1 (the privacy page says no personally identifiable
  information is collected and all responses are anonymous), D2 (option A), D5 (option C) and D10 (have scratch
  paper and a pencil ready; no calculator or AI chatbot).
- **22 provisional defaults**: the recommended option applied and open to change, never recorded as a decision (D4,
  D6 to D9, D11 to D13, D15 to D28). Six of them in part (D6, D7, D11, D15, D20, D22): the part the recommendation
  left for later, or that needs something this round did not have, is not done (§2 says what).
- **1 not changed**: D3, which the owner is reviewing; §2 now gives the context the owner asked for.
- **4 skipped**: D14, D29, D30 and D31, for which no recommendation was given. D13 settled D14 (the test floor for
  chart labels at 320 px is back to 10 px).

Verification 3 replayed every decision in Chromium, desktop WebKit and iPhone 13: 25 verified, 1 partly (D22), 5
unchanged as required (D3, D14, D29, D30, D31), 0 not fixed, 0 regressed. Its sweep of 281 routes (706 states)
found no sideways overflow, clipped text, serious axe issue, rendered "TODO" or score wording. It raised six new
findings, none a regression (UXDEC-VER-01 to UXDEC-VER-06, §4). The integration fixed four problems of the combined
branch and ran every gate of both repos; all passed, the Chromium e2e after a fix to one rewritten test and a re-run
of its group (appendix B). Unlike waves 1 and 2, this round changes the save schema (optional additions; still
`save-v1`), the bank (D6 and D8, and a README section for D11) and the server SQL (two new migrations, D4 and D8).
DESIGN.md and ROADMAP.md were not edited; the lines now out of step are listed for the lead in §4.

**Headline results** (111 triage items; no reviewer filed a blocker; counts after wave 2):

| Status | Items | Major | Minor | Polish |
| --- | ---: | ---: | ---: | ---: |
| Fixed and verified | 64 | 20 | 34 | 10 |
| Fixed, partly verified | 0 | 0 | 0 | 0 |
| Not fixed or regressed | 0 | 0 | 0 | 0 |
| Owner decision | 26 | 6 | 16 | 4 |
| Deferred | 19 | 0 | 4 | 15 |
| Not a problem | 2 | 0 | 0 | 2 |
| **Total** | **111** | **26** | **54** | **31** |

Wave 2 moved four items: UX-007a (with VER-01), UX-017a and UX-023 from "partly verified" to "fixed and verified",
and UX-100 from "deferred" to "fixed and verified". After wave 1 the table read 60 fixed and verified, 3 partly and
20 deferred. The table stays as wave 2 left it: the 26 "owner decision" items are D1 to D28 less D9 and D14, and
their status after the decisions round is in §3.

**Verification findings.** Wave-1 verification raised three new findings caused by the fixes. Wave 2 fixed VER-01
(minor) and VER-02 (polish), and verification 2 confirmed both; VER-03 (minor) stays an owner decision (D9).
Verification 2 checked 30 entries (28 ids): 30 verified, 0 partly, 0 not fixed, 0 regressed. Its route sweep found
nothing new against the wave-1 tours. It raised one new finding, VER2-01 (minor, desktop WebKit only), an owner
decision (D29).

**First paint (UX-100).** On Fast 3G with a 4× slower CPU the welcome text first paints at 620 ms instead of
2,424 ms (median first contentful paint; verification 2 measured 624 ms). The entry script fell from 458.73 KB to
344.87 KB (158.37 KB to 120.31 KB gzipped), and the JavaScript fetched before the welcome from 201,804 to 177,020
bytes on the wire. The app itself still mounts at about 2.2 s on that line (§4).

**Loose ends closed.** Pasted text that is not a save is now worded as text, not as a file (PARSE-PASTE); an unused
`PracticeRun.end()` is gone (PRACTICE-END); option cards keep a light border on paper (OPTIONGROUP-PRINT). Load
errors on the ready screen are now alerts tied to their field, which closes UX-012a's deviation.

**Gates.** At wave-1 integration: `npm run check` clean, 4,525 unit tests passed and 0 failed, language lint clean,
build clean, isolated e2e green on Chromium, WebKit and iPhone after reruns. At wave-2 integration: `npm run check`
clean, 4,618 unit tests passed, 0 failed and 7 skipped, language lint clean (359 files), build clean, harness smoke
green. The isolated e2e ran in three shards on Chromium, WebKit and iPhone; every failure came from machine load or
from the three dev-server routes, and each passed when re-run alone or in the dev-server run (appendix B). At the
final integration, on the branch head: `npm run check` clean, 4,618 unit tests passed, 0 failed and 7 skipped,
language lint clean, build clean, harness smoke green, and one full e2e run per project with the dev server
(Chromium 818 passed, WebKit 824, iPhone 743). The 16 failures of that run fell in system sleeps of the lid-closed
review machine (15 s to 7 min each, in the power log); all passed on re-run once sleep was held off (appendix B).

**The changes that matter most to people using the app**

1. **Phones.** Every new screen and question now opens at its heading instead of scrolled past it on mobile WebKit
   (UX-001); timed blocks start with the stage, key and keypad in view (UX-002); the session header is one 60 px row
   at 390 px instead of up to 40% of the screen (UX-003). In wave 2: Corsi's Done button is in the first screen at
   320 × 568 and the board no longer moves when Done is pressed (UX-023); part names in the checklist never break
   inside a word (VER-01).
2. **Keeping results.** A chosen save file loads without a separate Load and load errors are tied to their field and
   say what to do (UX-012a, UX-012b); a returning person can open "See my results" from the ready screen without a
   fake session (UX-010); "Stay and save" lands on the download button and a note at the top says the results are not
   saved yet (UX-005b, UX-028, UX-029). In wave 2: load errors are announced as alerts (UX-012a), and a pasted save
   that cannot be read is called pasted text, not a file (PARSE-PASTE).
3. **Not losing a session.** Browser Back mid-session opens "Finish now?" and the tab asks before a refresh or close
   once an answer exists (UX-011). True resume is an owner decision (UX-064).
4. **Keyboard and screen reader.** Practice keeps focus and announces right or wrong; "Keep going" hands the keys back
   to the running block; Escape closes panels; Enter on a reading answer no longer submits the whole block; the page
   title names the screen (UX-004, UX-005a, UX-019, UX-006). In wave 2: a browser without 3D graphics says so once on
   the Spatial screen, in sight and to a screen reader, with Skip first (UX-017a).
5. **Honest results.** Off-scale estimates get an arrow and "(off scale)" instead of collapsing into the centre
   (UX-037); matrix options are drawn at the grid's true size (UX-020); the share card is legible at feed size and has
   a key (UX-038); the results header describes the whole profile and the skipped parts (UX-009a); never-offered
   skills read "Not measured (not offered yet)" (UX-048a, UX-048b); two benefit claims were removed (UX-018a, UX-018b).
6. **Speed (wave 2).** On a slow phone line the welcome text shows in about 0.6 s instead of a blank page for 2.4 s.
   The results code loads during the session. If it cannot load at the end, the page says the answers are not lost
   and offers "Try again" and "Download my save file" (UX-100).

## 2. Owner decisions needed

Thirty-one decisions. D1 to D28 come from wave 1, ordered by impact: the 26 owner items of the triage (UX-060 to
UX-085), VER-03 and one open point from integration. D29 to D31 are new questions from wave 2 (at the end). Waves 1
and 2 changed nothing for any of them. "Recommended" is the triage's or the verifier's advice; screenshots under the
reviewers' run ids show the build before the fixes, and those under `verify2/` show the wave-2 build. Wave 2 changed
none of the facts below except where a line says "wave 2".

**Status lines (decisions round, 2026-10-05).** The first line under each decision says what the round did; the
lines after it are the review's record as it stood before the round. "Owner decision 2026-10-05" quotes the owner's
answer. "Applied recommended default (provisional, revisit)" means the team applied the recommended option because
the owner asked it to follow the recommendations; the owner has not decided it, and it stays open to change. Files
are under `web/src/` unless the path says otherwise; the handoff of each package in
[ux-review/uxdec/](ux-review/uxdec/) has the strings, tests and open issues in full.

### Before any public link

- **D1. UX-061 (major): the privacy notice shows "TODO(user)" placeholders.** What controller name and contact should the notice show, and what should the static MVP say until the online terms exist?
  - **Status: Owner decision 2026-10-05: "just have the privacy page say that no PII is collected and all responses are anonymous".** Applied: both notices (static and server) lose every TODO(user) placeholder and the "Who runs this site" section; a new first section "In short" says "HumanBench collects no personally identifiable information, and all responses are anonymous.", that nothing asks for a name or email address and that there are no accounts. The static notice adds what the web host sees (the network address when a page loads); the server notice states consent as the basis, 24 months as the plan, where the data is held, and that deleting reaches the weekly backups within eight weeks but not the archive kept without the identifier (the data page's delete text says the same). TERMS_VERSION and TERMS_VERSION_SERVER are now `terms-2026-10-05` and `terms-2026-10-05-server`, so consent is asked again. New tests fail on "TODO" in any copy string and on the rendered pages (`no-todo.test.ts`, `App.dom.test.ts`, `App.served.dom.test.ts`, the privacy e2e). Files: `session/copy.ts`, `backend/copy.ts`, `session/constants.ts`, `session/Privacy.svelte`. For the owner (start-copy.json open issues): "anonymous" is true in the everyday sense, while DESIGN §13 calls the random identifier pseudonymous personal data (GDPR Recital 26); the server variant keeps a hashed network address for about two days and its host logs network addresses, which the notice says right after; the 24-month removal of database rows is not built yet, so the notice calls it the plan.
  - Options: A. supply the real controller and a contact address now. B. interim wording ("This site is a hobby project. The name of the person responsible and a contact address will be added here before any version that collects data.") and drop the draft-terms placeholder. C. "Questions: open an issue at <repo URL>" as the contact.
  - Recommended: A if possible, otherwise B before any public link; either way add a copy test that fails on "TODO" in any rendered string.
  - Evidence: COPY-04, VIS1-06; `web/test-results/ux-review/copy/tour/privacy/1280-light.png`. Touches: §13, ROADMAP M1.15 (TODO(user)); `session/copy.ts` PRIVACY_SECTIONS, TERMS_VERSION if the substance changes; the pinned literals in `e2e/session.spec.ts` and four unit tests.
- **D2. UX-071 (major): "Ranges that overlap are not real differences" is statistically wrong.** Replace the sentence in all three places (share card, the reveal's no-peaks note, the gated results-talk preamble)? Overlapping 90% intervals do not imply no difference, and the card names a peak whose range overlaps every other one. The fixed card still carries the sentence.
  - **Status: Owner decision 2026-10-05: "D2 ok, make your change" (option A).** Applied: the old sentence is gone from the app. The share card's small print and the results-talk preamble say "Where ranges overlap, a difference may not be real."; the reveal's no-peaks note says "No skill stands out clearly from your others yet. That is common after one session: the ranges are still wide." The preamble is a gated line (A22), so this is one gated change: wording version 2 (346 characters, was 340), a v2 pin beside the unchanged v1 pin, the gates entry at v2, and the preamble cap in `reveal/slots.ts` at 346. A source scan test fails if the old sentence comes back. Files: `viz/card-copy.ts`, `reveal/copy.ts`, `brief/results-talk.ts`, `brief/brief-gates.json`, `brief/__fixtures__/wording-pins.json`, `reveal/slots.ts`. The card's small print still wraps to three rows, so the card layout is unchanged.
  - Options: A. "Where ranges overlap, a difference may not be real." (card and preamble) and "No skill stands out clearly from your others yet. That is common after one session: the ranges are still wide." (no-peaks note). B. Card and reveal only, keep the gated preamble. C. No change.
  - Recommended: A, as one gated change (DESIGN §17 table row and the gate pin together).
  - Evidence: DATA-04; `web/test-results/ux-review/data/results1-chromium/export-light-humanbench-card-2026-10-03.png`. Touches: §9.9, §17, A12, A20, A22; `viz/card-copy.ts`, `reveal/copy.ts`, `brief/results-talk.ts` and its pin.
- **D3. UX-070 (major): say what "0 SD" stands for; check the RT norm width.** Every verdict ("Above / Below / Overlaps 0 SD"), the muting and the peaks depend on 0 SD, and nothing says what it is. Under s = 0.15 a median simple RT of about 470 ms is −3 SD, common on touch screens.
  - **Status: Not changed: the owner is reviewing it.** The ring caption, the bar-view note and the RT prior (`tasks/rt/prior.ts`, s = 0.15) are as they were (verification 3 compared them with the base commit). No 0 SD sentence was added anywhere.
  - Context for the owner (from [d3-context.json](ux-review/uxdec/d3-context.json)):
    - **What 0 SD is.** SD (standard deviation) is the usual spread between people. 0 SD is each skill's reference middle: the dashed ring on the blob and the dashed tick on each bar. There are no results from other people yet, so each 0 is set in advance (DESIGN §7.3, ROADMAP A12). For question-based skills it comes from the expected difficulty of the questions, anchored to published ICAR figures (M1.P). For reaction time it is a fixed web reference of 300 ms (simple) and 450 ms (choice): published lab times of about 200 to 250 ms plus an allowance for device delay.
    - **Why it matters.** Each skill has a 90% range. A range wholly above 0 reads "Above 0 SD", wholly below reads "Below 0 SD", and a range across 0 reads "Overlaps 0 SD" and is greyed out. Move 0 and every label moves. Peaks compare skills with the person's own average, so one skill pushed far down can make others look like peaks. Readers will take "Below 0 SD" as "below most people", and the page never says that 0 is a starting guess.
    - **The reaction-time example.** The score is (ln of the reference − ln of the median time) / 0.15: each 16% slower median is 1 SD lower. Simple reaction time: 250 ms is +1.22 SD, 300 ms is 0, 350 ms is −1.03, 400 ms is −1.92, 470 ms is −2.99, 550 ms is −4.04 and 650 ms is −5.15. Four-choice: 400 ms is +0.79, 470 ms is −0.29 and 650 ms is −2.45. So a simple median of 470 ms, common on touch screens because of device delay, lands at about −3 SD, where only about 0.1% of people should be. One block of 30 trials gives a 90% range of about ±0.8 SD (an estimate, assuming the trial-to-trial spread of the bank's simulation), so 470 ms reads about −3.8 to −2.2 SD, shown near −2.4 after one block; the label is "Below 0 SD" either way. With a wider spread (s = 0.20) 470 ms would be −2.2 SD (a calculation, not data). Today one table serves every device, though DESIGN §11.6 asks for norms per device class.
    - **What the options would change for people.** A: two more sentences under the blob and the bars, saying what 0 SD and 1 SD mean and that the scale may shift; the longest, and "typical adult" is a claim about people the numbers cannot back yet (A12 withholds even "typical HumanBench taker"). B (recommended): one sentence, "0 SD is a provisional reference point, set from question difficulty and published figures, not from other takers."; it does not say what 1 SD is, and "published figures" is loose for reaction time. C: nothing changes until M4 norms; "Below 0 SD" stays unexplained. A and B are a small copy edit in `viz/copy.ts` plus pinned tests.
    - **What reviewing the reaction-time prior needs.** Reaction-time blocks from real takers (the M2 backend), with device class and input type; at least 300 people per device class (DESIGN §16, F10); and some people measured twice, so the bank's M4.8 estimator, tested on simulated data only, can tell the spread between people from block-to-block noise. Estimated timing: M4.8 with real data, published through M4.10, after M2. Any change goes into `tasks/rt/prior.ts` and the bank's `hb/gen/rt.py` together (norms tag `rt-web-v0`), with parity fixtures.
    - **The owner's open questions.** (1) Which wording: A, B, C, or B plus A's clause "1 SD is the usual spread between people"? (2) Is "published figures" acceptable for reaction time, where 0 is a guess built on published lab times? (3) Keep s = 0.15 until real data, or make an interim change (say a touch-screen reference) before a public link? That is also a guess and touches pub and bank. (4) Wait for M4.8, or collect real web times earlier in a small pilot?
  - Options: A. a two-sentence addition to RING_CAPTION and BARS_NOTE ("0 SD marks where we expect a typical adult to land… so the scale is provisional and may shift."). B. shorter: "0 SD is a provisional reference point, set from question difficulty and published figures, not from other takers." C. no change until M4 norms.
  - Recommended: B now; separately review the RT prior width against web RT data.
  - Evidence: DATA-03, DATA-01; `web/test-results/ux-review/data/results1-chromium/002-chart-light.png`. Touches: §7.3, §9.1, A12 (withholds "typical HumanBench taker"), A10; `viz/copy.ts`; the RT prior `tasks/rt/prior.ts` is bank-mirrored and needs the bank too.

### Measurement and scoring

- **D4. UX-072 (major): the facet model counts an axis's items twice; Quantitative has 18 one-template facets.** How should facet estimates be computed and grouped? Spatial's only facet flips from "Overlaps 0 SD" to "Below 0 SD", and every facet is narrower than its axis (14 of 14).
  - **Status: Applied recommended default (provisional, revisit): option A:** a facet's estimate now starts from its skill's estimate with that facet's own answers taken out (leave-facet-out), so no answer counts twice; a facet that holds all of its skill's answers shows the skill's estimate. Quantitative's facets are the six topic groups of `tasks/quant/topics.ts`, not one per template. Facet panels say "Each facet's range also draws on the rest of its skill, so for now a facet sits close to its skill." The server re-score does the same (new migration `supabase/migrations/20261007000100_rescore_facets.sql`). Files: `viz/facets.ts`, `viz/copy.ts`; tests `viz/facets-prior.test.ts`, `viz/facets-groups.test.ts`, `web/scripts/db/facets.test.ts`, `web/scripts/db/rescore.db.test.ts`. Option B, the stop-gap in case A had to wait, was not done. For the owner (facets.json): with this prior every facet now repeats about its skill's estimate (for example Physics, Chemistry and Computing at +1.75 where STEM Knowledge is +1.74), so the drill-down shows nothing facet-specific until the model has a spread between people per facet (AI.20).
  - Options: A. leave-facet-out prior, and Quantitative facets = the six QUANT_GROUPS topics. B. interim: hide the facet estimate when an axis has one facet and caption "Facet ranges are provisional and somewhat too narrow." C. no change.
  - Recommended: A (amend A12); B as a stop-gap if A has to wait. The empty-panel display is already fixed (UX-041).
  - Evidence: DATA-02, DATA-14; `web/test-results/ux-review/data/results1-chromium/015-drill-spatial-memory.png`, `web/test-results/ux-review/data/journey-chromium/011-drill-quantitative.png`. Touches: A12, §9.6, §7.1, A7; `viz/facets.ts`, `tasks/quant/topics.ts`.
- **D5. UX-066 (major): session clock and part budgets.** Should the clock run on "Up next" screens, when is the break offered, and should skipping a part shorten the session? Today waiting on an interstitial uses session time, the break comes after 30 active minutes of a 28-minute target, and after a skip Quantitative grew to "About 14 min".
  - **Status: Owner decision 2026-10-05: "sure, do that" (option C, A and B).** Applied: the session clock waits from the end of a part until Start on the next "Up next" screen, the break offer included, and every "Up next" screen says "The clock waits until you press Start."; the one break offer comes at the part boundary nearest half the planned session (before Working Memory in every A15 plan the package sampled), no longer after 30 active minutes; each adaptive part (Matrix & Series, Spatial, Quantitative Reasoning) gets at most its planned share, so a skip or unused time shortens the session instead of growing later parts (the three-question floor still holds). Verified: after four skips Quantitative Reasoning reads "About 5 minutes". In the package's simulation (300 runs each) skipping Spatial took the session from 28.5 to 25.3 minutes and Quantitative from 8.0 to 4.8; with no skips 29.2 became 28.9. Files: `session/clock.ts` (named holds), `session/run.ts`, `session/copy.ts` (BREAK_OFFER_TEXT, INTERSTITIAL_CLOCK), `session/SessionScreen.svelte`, `session/constants.ts` (BREAK_AT_S removed); new `web/scripts/sim-session.ts` (`npm run sim:session`); the time-rule e2e tests were rewritten. For the owner: the break is still offered before Working Memory when every earlier part was skipped (UXDEC-VER-03); and should the M1.4b simulation `sim/cat.ts` model the cap? It is unchanged, and `test:slow` passes.
  - Options: A. pause the clock on interstitials ("the clock waits until you press Start") and offer the break at the interstitial nearest half-way. B. keep the clock running but cap each part at its planned share. C. A and B.
  - Recommended: C. The misleading "Almost there" copy is already fixed (UX-008).
  - Evidence: FLOW-03, FLOW-16; `web/test-results/ux-review/flow/break-chromium/001-interstitial-up-next-reaction-time.png`, `web/test-results/ux-review/flow/session-chromium/014-quantitative-reasoning-interstitial.png`. Touches: §10 (break at 30 min, 6–10 min blocks), §7.4, A15; `session/run.ts`, `clock.ts`, ProgressRing.
- **D6. UX-064 (major): resume an interrupted session after a refresh or crash.** Should an unfinished session (say under 24 h old) be resumable? Today a refresh lands on the welcome and the interrupted run comes back as "1 earlier session", practice-adjusted against the new one.
  - **Status: Applied recommended default (provisional, revisit): option B:** after a refresh or crash, the ready screen offers "Continue your unfinished session" for a session under 24 hours old. It runs as a new session flagged `continuation`, leaves out the parts already finished and starts again at the part that was cut off. A session and its continuation are one sitting: the §7.8 retest model numbers tests by sitting in pub and bank, so they are never practice-adjusted against each other, and the counts of sessions a person reads count sittings (the golden `retest_v1.json` gained continuation cases). Sessions now record `done_<part>`, `completed`, `focus_session` and `continuation` flags; the server receives none of them. Files: new `session/resume.ts` and `save/sittings.ts`; `session/run.ts`, `session/SessionApp.svelte`, `session/Ready.svelte`, `session/Finished.svelte`, `session/copy.ts`, `reveal/results.ts`, `engine/retest.ts`, `save/rescore.ts`, `schema/save-v1.json` (flag descriptions); bank `hb/calib/retest.py`, `rescore.py`, `retest_fit.py`, `golden.py`, `golden/retest_v1.json`. Not done: option A (true resume), left for later as recommended. The server variant offers no continuation, and its SQL re-score still numbers tests by session (engine-retest.json, resume.json).
  - Options: A. true resume (same session id, elapsed time, next item). B. a new session marked as a continuation (finished parts skipped, no practice adjustment against it). C. no; keep the clearer Ready line of UX-012a.
  - Recommended: B for M1, A later. The leave guard and the clearer Ready line are already in (UX-011, UX-012a).
  - Evidence: SKIM-01, FLOW-02, SKIM-13; `web/test-results/ux-review/skimmer/back-chromium-refresh/002-after-refresh.png`. Touches: §8 ("crash recovery"), §7.8, R-8.1, §10; `SessionApp`, `run.ts`, `persist.ts`.
- **D7. UX-063 (minor): does an untouched confidence slider count as a rating?** Enter, Enter or a double click records the start value without the slider being used, so a skimmer's calibration record reads "50, 50, 50".
  - **Status: Applied recommended default (provisional, revisit): option B:** a confidence slider confirmed without being moved is recorded as not rated (`confidence_pct` null; `confidence` null on the server), left out of the calibration, and counted in a new session flag `confidence_untouched_n` (an optional counter in `schema/save-v1.json` and `save/validate.ts`; still `save-v1`). Files: `session/Confidence.svelte`, `session/SessionScreen.svelte`, `session/run.ts`. Not done: the slider step size (UX-111), which this decision said to settle at the same time; no recommendation was given for it. Note (run.json): a rating left at the start value on purpose now also counts as not rated.
  - Options: A. require a touch (Continue enabled only after a move; quick buttons for keyboard users). B. keep the default but record `touched=false` and leave untouched ratings out of calibration (save and scoring change). C. no change; document the default as an answer.
  - Recommended: B; A if the save format must not change. Decide the slider step size (UX-111, deferred) at the same time. The held-Enter part is fixed (UX-014).
  - Evidence: KBD-13, SKIM-11; `web/test-results/ux-review/skimmer/double-chromium/004-after-continue-twice.png`. Touches: §3 row 12, §7, A15, §8 if B.
- **D8. UX-079 (minor): number-entry grammar.** "3,5" is rejected while "1,500" is silently read as 1500 (a decimal-comma typist meant 1.5); quant hints say "integer" where series hints say "whole number".
  - **Status: Applied recommended default (provisional, revisit): option A, in pub and bank:** digits, one comma and one or two digits make a decimal comma ("3,5" is 3.5); the entry box refuses "1,500" with "Write thousands without a comma (1500) and decimals with a point (1.5)."; quant hints say "whole number". Saved answers re-score as before: the scorer still reads the old thousands form, and property tests against a frozen copy of the old reader show that every answer it read is read the same way. The server's reader takes the decimal comma too (migration `supabase/migrations/20261007000200_parse_entry_decimal_comma.sql`, added at integration). Files: `tasks/quant/numeric.ts`, `tasks/quant/templates.ts` (hints), new `tasks/quant/entry-vectors.ts`, `render/common/NumericEntry.svelte`, `render/common/entry-copy.ts`, `render/quant/QuantRenderer.svelte`; bank `hb/gen/quant/entry.py`, `hb/gen/quant/spec.py`, `golden/ts_dumps/quant.json`, new `golden/ts_dumps/quant_entry.json`. For the owner: the quant generator stays at version 1.3.0 although its hint text changed, a documented exception to the version rule in `tasks/family.ts` (a bump would drop saved quant answers from local re-scoring); the alternative is quant 1.4.0. Series keeps its own whole-number note for "1,500".
  - Options: A. read one comma followed by one or two digits as a decimal comma; reject "d,ddd" with "Write thousands without a comma (1500) and decimals with a point (1.5)."; hints say "whole number". B. hint wording only. C. no change.
  - Recommended: A, as one pub and bank change. The UI side (keypad, digit forms, the 3.5 check) is fixed (UX-024).
  - Evidence: L2-03, L2-04, L2-06, COPY-13; `web/test-results/ux-review/nonnative/entry-quant-chromium/002-quant-item-1-entry-1-rejected.png`. Touches: §4.2, A1, A14, A18; `tasks/quant/numeric.ts` and `templates.ts` with their bank twins.
- **D9. VER-03 (minor, new): one-row coding keypad keys are 30–38 px wide on phones.** UX-002 put the nine coding keys in one row so table, target and keypad fit one phone screen (they do). The keys are now 38 × 50 px at 390 px and 30 × 50 px at 320 px, where the old three-row keypad had 44 px keys, in the one block that rewards fast tapping.
  - **Status: Applied recommended default (provisional, revisit): option A:** the nine coding keys fold into two rows of five and four when they would be under about 40 px wide (a container query on the keypad, so it also follows the text size). Verified in all three engines: keys 53.4 px wide at 320 px, 67.4 px at 390 px and 71.8 px at 412 px (two rows), 40.7 px at 430 px (one row, as before), no sideways overflow. The phone gap between keys went from 2 to 4 px. Files: `render/common/Keypad.svelte` (`narrowColumns`), `render/coding/CodingRenderer.svelte`. The timing code is unchanged; the response path was not re-timed on a real phone (§11.6 suggests it for a timed block).
  - Options: A. two rows of five and four when keys would be under about 40 px (container query); the screen budget still fits. B. 44 px keys with the gap removed at 320 px. C. keep one row.
  - Recommended (verifier): A.
  - Evidence: VER-03; `web/test-results/ux-review/verify/UX-002/iphone/005-320x568-coding-start-viewport.png`. Still valid after wave 2 (the keypad did not change); verification 2 measured the same on the Pixel 7 project, 40 px keys at 412 px and 30 px at 320 px (`web/test-results/ux-review/verify2/UX-002/pixel/005-320x568-coding-start-viewport.png`). Touches: WCAG 2.5.8; `render/common/Keypad.svelte`, `render/coding/CodingRenderer.svelte`; a timing re-check is wise for any change to a timed block (§11.6).
- **D10. UX-081 (minor): is scratch paper allowed in the Quantitative part?** The honour code forbids calculators "except where provided" but says nothing about paper; a mid-session blurb says "Keep paper and a calculator out of reach".
  - **Status: Owner decision 2026-10-05: "tell the user in advance that they may want to have scratch paper and pencil ready and a reminder not to use assistive technology such as calculators or LLMs".** Applied: the honour screen keeps the §13 sentence word for word and adds under it "You may want scratch paper and a pencil ready: writing things down is allowed. Please do not use a calculator or an AI chatbot. Screen readers, zoom and other accessibility settings are fine to use." The Quantitative "Up next" text now says "Scratch paper and a pencil are fine; please do not use a calculator or an AI chatbot." instead of "Keep paper and a calculator out of reach". Files: `session/copy.ts` (HONOUR_TOOLS), `session/Honour.svelte`, `session/segments.ts`. A wording note for the owner: in accessibility, "assistive technology" means screen readers and similar tools, which people must be able to keep using, so the text names the calculator and an AI chatbot (for LLMs) and says accessibility tools are fine ([HOUSE-STYLE.md](HOUSE-STYLE.md) records why).
  - Options: A. allowed ("Paper is fine; keep calculators out of reach."). B. not allowed (a line under the honour sentence).
  - Recommended: whichever matches how the items were difficulty-seeded; state it once, up front.
  - Evidence: COPY-21; `web/test-results/ux-review/copy/journey/021-quantitative-reasoning-interstitial.png`. Touches: §13 (the honour sentence is fixed word for word); `session/segments.ts`.
- **D11. UX-082 (minor): reading passages and first-language norms.** A passage can be one 363-word paragraph (1,280 px on a phone) of 19th-century prose, and the results compare reading speed with first-language figures without saying so.
  - **Status: Applied recommended default (provisional, revisit): option C, in part:** A's display split and B. A paragraph of more than 150 words is drawn as pieces of about 120 words, cut only at sentence ends; the passage data is unchanged (new `render/reading/split.ts`, `render/reading/ReadingRenderer.svelte`). Verified: a served passage drew as paragraphs of 92, 61, 61, 108 and 39 words (Chromium; no piece over 150 words in any engine). The results' reading line ends "The comparison figures are for people reading in their first language." (`reveal/copy.ts`). The bank README gained a section "Reading passages (A14)" that records the preference for modern plain non-fiction as provisional. Not done: replacing passages with modern plain non-fiction, which needs authoring, two independent clean solves per passage recorded in the bank, and a kind of source record the public repo's passage checks do not have yet (today they require a Project Gutenberg record and a year before 1928). Evidence note (reading.json): the session measurement reproduces the 1,280 px figure (the passage was 1,278 px before and 489 + 381 + 408 px after); the review page's card is narrower (306 px), so its figures are larger.
  - Options: A. split passages at about 120 words and prefer modern plain non-fiction in the bank. B. add "The comparison figures are for people reading in their first language." to the reading line. C. both.
  - Recommended: C (B is a one-line reveal change once approved).
  - Evidence: PHONE-13, L2-12; `web/test-results/ux-review/phone/reading-iphone/002-passage.png`. Touches: A1, A14, §3, §4.2; bank passage selection; `reveal/copy.ts`.
- **D12. UX-084 (polish): the RT fixation cross sits above the target box.** Move the "+" into the target area? Gaze has to drop about 128 px to the target, and the row costs 3.25rem on phones.
  - **Status: Applied recommended default (provisional, revisit): option A:** the "+" is drawn centred in the target pad and the separate row is gone, so the stage is 52 px shorter (228 px with one position). With four positions the cross sits in the middle of the row, between the two middle pads, with a halo in the stage colour. Markup and CSS only (`render/rt/RtRenderer.svelte`): the trial states, the rAF-locked onset and the performance.now() stamps are byte for byte as before. The RT self-test does not mount this renderer, so its pass shows the device checks are unaffected, not a re-timing of the renderer.
  - Options: A. draw the "+" centred in the pad and remove the separate row. B. no change (continuity with collected data).
  - Recommended: A before norms are collected, B once data exists; a self-test pass either way.
  - Evidence: VIS1-23; `web/test-results/ux-review/visual-start/details-motion-chromium/003-rt-trial-motion-2.png`. Touches: §11.6, §3; `render/rt/RtRenderer.svelte`.

### Results display

- **D13. UX-073 (minor): not-measured spokes dip to the centre, where −3 SD is drawn.** With 10 of 17 spokes unmeasured in every static profile the shape reads as seven petals around deep lows, and on a 390 px phone the stub labels leave the plot about 42% of the chart width.
  - **Status: Applied recommended default (provisional, revisit): options A and B:** the curve, the ±1 SD band and the fuzz break at a not-measured spoke (closed only when every spoke is measured, byte for byte as before), and the gap marker is a small x on the 0 SD ring; the grey stub and the dashed spoke stay (§9.7 names them). On a screen too narrow for the usual labels, with five or more spokes not measured, those spokes have no label and a visible "Not measured: …" list sits under the chart. The caption reads "Dashed grey spokes are skills that were not measured. The line breaks there, and a small x on the 0 SD ring marks the gap; it is not an estimate." Files: `viz/blob.ts`, `viz/curve.ts`, `viz/BlobChart.svelte`, `viz/copy.ts`. For the owner (viz-blob.json): the ten grey centre stubs now form a small grey star at the centre, where −3 SD is drawn; dropping them would need a §9.7 change.
  - Options: A. break the curve and band at an unmeasured spoke (a gap with a small × at the 0 SD ring). B. on narrow screens with five or more unmeasured spokes, short labels or none, and a "Not measured: …" list under the chart. C. draw only the offered skills in the static build.
  - Recommended: A and B (amend §9.7); C breaks the fixed 17-spoke order that §9.5(b) relies on.
  - Evidence: DATA-08, PHONE-08, VIS2-23; `web/test-results/ux-review/phone/blob-iphone/001-blob.png`. Touches: §9.7, §9.5, A12, A15; `viz/blob.ts`, `BlobChart.svelte`.
- **D14. Integration note: blob label floor of 9.5 px at 320 px.** The viz package lowered the minimum blob label size at 320 px from 10 to 9.5 px in `e2e/blob.spec.ts`, because the UX-042 compact names are longer. Accept it?
  - **Status: Skipped: no recommendation was given.** D13 settled it without a product change: with D13 B the smallest chart text on the static profile is 11 px at 320 px in all three engines, and the every-skill profile (the case of the 9.5 px floor, which D13 B does not touch) measures at least 10 px at 320 px (Knowledge facets 10.57 px with the wide font). So the viz-blob package put the test floor back from 9.5 to 10 px (`e2e/blob.spec.ts`, and `viz/blob.test.ts` for the every-skill profile). The margin is small: longer facet or compact names could need 9.5 px again.
  - Options: A. accept (the bar view and the table carry the same names). B. restore 10 px by shortening names further or by D13 option B.
  - Recommended: none given; integration flagged it for an owner view. Deciding D13 first settles most of it.
  - Evidence: `ux-review/integration.json` open_issues; `web/test-results/ux-review/verify/viz-phone/iphone/001-blob.png`. Touches: §9 (legibility), UX-042, UX-044.
- **D15. UX-074 (minor): share card content.** The only strongly coloured spoke on the card can be a credible low while the named peak is grey; the card has no web address; on iPhone "Download image (PNG)" is primary and "Share image" third.
  - **Status: Applied recommended default (provisional, revisit): options A and C; B not done.** A: on the share card a credible low (range below 0 SD) is drawn muted like a range that overlaps 0 SD, the named peaks are ringed with bold labels, and the key reads "Filled: range above 0 SD. Hollow: range overlaps or is below 0 SD." plus "Ringed: a named peak." when the card lists peaks; the results page keeps the §9.5 rule. C: where the browser can share image files, "Share image" comes first and is the only primary, with the two downloads in a group under "Save a copy"; elsewhere the buttons are as before. Files: `viz/card.ts`, `viz/card-copy.ts`, `viz/blob.ts`, `viz/BlobChart.svelte`, `reveal/ShareCard.svelte`, `reveal/copy.ts`. Not done: B (the site address on the card and in the share), which waits for the final domain.
  - Options: A. draw credible lows muted on the card and mark the named peaks. B. add the site address and pass `url` to `navigator.share`. C. make "Share image" primary where file sharing works, downloads under "Save a copy".
  - Recommended: A and C; B once the final domain is chosen. Legibility and the key are fixed (UX-038).
  - Evidence: VIS2-13, DATA-05, SHARE-11, SHARE-13, VIS2-21, SHARE-15; `web/test-results/ux-review/sharer/card-chromium/card-light.png`. Touches: §9.5, §9.9, R-5.6.4, A12; `viz/card.ts`, `reveal/ShareCard.svelte`.
- **D16. UX-075 (minor): results page order and top.** May the results deviate from today's layout? On a phone the first screen is all text, the h1 and the reveal use two left edges, and the save panel is 2–3 screens down.
  - **Status: Applied recommended default (provisional, revisit): option A:** the §10 order is kept. The practice note is one line ("Practice-adjusted. Nothing to adjust yet." after one session; what a later session is credited with moved into the "When to come back" advice), Replay and Skip animation are a small text button, "Your profile is ready." is a status kept for screen readers but not shown, and the results sit in one 52rem column with the chart up to 48rem. Verified: on a 390 × 664 phone 66% of the chart is in the first screen (the package measured 3% before), with one left edge for everything from the h1 to the save panel. Files: `reveal/RevealProfile.svelte`, `reveal/Reveal.svelte`, `reveal/reveal.css`, `reveal/copy.ts`, `viz/ProfileView.svelte`, `session/Finished.svelte`. Option B (save panel under the chart) not done, as recommended. Still open: at 200% text on a phone the chart starts below the first screen (UXDEC-VER-06).
  - Options: A. keep the §10 order; compact the top (one-line practice note, small Replay, hidden live "Your profile is ready."), one 52rem column, chart up to 48rem on wide screens. B. A, and move the save panel directly under the chart (amends §10). C. nothing beyond UX-029.
  - Recommended: A; B only if later data show unsaved exits.
  - Evidence: SKIM-08, VIS2-16, PHONE-07, SKIM-09, FLOW-12; `web/test-results/ux-review/phone/results-iphone/003-results-viewport.png`. Touches: §10 (reveal order), §7.8, §9.
- **D17. UX-077 (minor): notes settings missing from the results-page save.** The save downloaded on the results page leaves out notes settings kept on this device; a second device then reports "That save has no notes settings."
  - **Status: Applied recommended default (provisional, revisit): option A:** the save the results page downloads, shares or copies as a code now holds the notes settings kept on this device (choices only, never typed text), read when the button is pressed, and the save panel says "The file also holds the notes settings kept on this device: your choices, never text you typed." Files: `save/io.ts` (deviceBriefPrefs, withDeviceBriefPrefs), `save/brief-prefs.ts`, `reveal/SavePanel.svelte`, `reveal/copy.ts` (SAVE_HOLDS_NOTES). For the owner (share-save.json): when the earlier saves are left out (the ready screen's "Add my new session to the …" box unticked, for example two people on one device), should this device's notes settings stay out of the results-page save too?
  - Options: A. include them (read at click time). B. explain on the notes page that its save is a different file. C. both.
  - Recommended: A (one file per person).
  - Evidence: SHARE-21; `web/test-results/ux-review/sharer/notes-chromium-device2/001-load-settings-result-results-save.png`. Touches: R-17.12, §8; `reveal/SavePanel.svelte`, `save/brief-prefs.ts`.
- **D18. UX-078 (minor, gated): the results-talk helper says "Paste this first." and never what comes next.**
  - **Status: Applied recommended default (provisional, revisit): option A, through the gate process together with D2 (wording version 2):** the helper reads "Paste this first. Then describe your results in your own words, or attach your share card picture." File: `brief/results-talk.ts`.
  - Options: A. add "Then describe your results in your own words, or attach your share card picture." B. no change.
  - Recommended: A, through the gate process.
  - Evidence: SHARE-18; `web/test-results/ux-review/sharer/talk-chromium/001-ai-card.png`. Touches: A20, A22, R-17.13; `brief/results-talk.ts` and its pin.
- **D19. UX-076 (polish): save and card file names.** The save is dated in UTC and the card locally (an evening save in the Americas is dated tomorrow); two saves on one day, and the light and dark cards, get identical names.
  - **Status: Applied recommended default (provisional, revisit): option A:** both file names use the local date. Cards are `humanbench-card-light-<date>` and `humanbench-card-dark-<date>` (.png and .svg); the save keeps the §8 pattern `humanbench-<shortid>-<date>.hbsave.json` with the local day, and `created_utc` inside the file stays UTC. Files: `save/io.ts` (localDateStamp, saveFileName), `viz/export.ts` (cardFileName), `reveal/ShareCard.svelte`. Option B (a session count in the save name) not done, so two saves on one day still share a name.
  - Options: A. local date for both; card "humanbench-card-light-<date>.png" and "-dark-". B. A plus a session count in the save name. C. keep UTC and say so in the save panel.
  - Recommended: A.
  - Evidence: PHONE-10, SHARE-17; `web/test-results/ux-review/sharer/card-chromium/002-card-panel.png`. Touches: §8 (file name pattern); `save/io.ts`, `viz/export.ts`.

### Flow and access

- **D20. UX-069 (minor): tell screen-reader users which parts need sight.** Reaction Time works only through announcements and Spatial offers four options with identical text alternatives; neither says that Skip is the intended path.
  - **Status: Applied recommended default (provisional, revisit): option A:** the Reaction Time and Spatial "Up next" texts end with "This part needs you to see the screen. If you use a screen reader or cannot see the target [Spatial: the figures], choose “Skip this part”: it will show as not measured.", naming the button on that screen. File: `session/segments.ts`. Not done: option B (an "assistive" input type for Reaction Time), which needs its own norms and waits for the norming work, as recommended.
  - Options: A. one sentence in the RT intro and the Spatial interstitial ("This part needs you to see the screen. If you use a screen reader or cannot see the figures, choose Skip: it will show as not measured."). B. A, and record an "assistive" input type for RT. C. no change.
  - Recommended: A now, B later with the norming work.
  - Evidence: SR-04, SR-05; `web/test-results/ux-review/screenreader/audit/item-spatial/001-item-spatial.png`. Touches: §13, §11.6, WCAG 1.1.1.
- **D21. UX-068 (minor): per-question focus target.** Every new question re-focuses the same h1; for keyboard users that is 96 of 165 Tabs in a session, and a screen-reader user hears an identical heading about 60 times.
  - **Status: Applied recommended default (provisional, revisit): option B:** the part's heading takes focus on the first question of a part and on every screen that is not a question; on a later question focus goes to the question's own region (role group, named "Question N", focusable by script but not a Tab stop, no ring). Files: new `session/question-focus.ts`, `session/Screen.svelte`, `session/SessionScreen.svelte`. For the owner (screen.json): "Question N" is a running number, with no total, that only screen-reader users hear; SR-06 asked for no item count, and `itemRegionName` in `session/question-focus.ts` is the one place to change it (for example to "Next question"). Verification 3: in headless desktop WebKit one Tab from the region lands on the page instead of the first option (UXDEC-VER-05).
  - Options: A. keep the h1. B. h1 on the first question of a part, then the labelled item region. C. keep the h1 and announce "Next question." from the status line.
  - Recommended: B; C is the minimal alternative.
  - Evidence: KBD-12, SR-06; `web/test-results/ux-review/screenreader/journey/009-matrix-series-choice.png`. Touches: §13, WCAG 2.4.3 and 4.1.3, ROADMAP M1.15; `session/Screen.svelte`.
- **D22. UX-065 (minor): what the welcome screen adds.** The welcome does not say what 30 minutes buy (a shape with ranges, no single score, a file you keep), what is needed, or what it is not; a returning visitor gets no door to results or notes; default Safari cannot Tab to Start.
  - **Status: Applied recommended default (provisional, revisit): option B:** when this browser holds an adult consent record and earlier answers, the welcome shows a row "Earlier results and notes on this device" under Start, with a plain "See my results" and, when notes settings are kept, "Notes for your AI (opens in a new tab)"; Start stays the only primary. A first visit sees nothing new. Without an adult record the welcome reads only the consent record and writes nothing. Files: `session/Welcome.svelte`, `session/SessionApp.svelte`, new `session/returning.ts`, `session/gate.ts`, `session/copy.ts`. Not done: option A (the "What you get / what you need" block), which waits for approved copy, and the Safari keyboard hint. Verified in part: a browser that kept notes only on the notes page, with no session consent record, gets no row and so no notes link, although this decision's text promises the link when kept notes exist (UXDEC-VER-01).
  - Options: A. a "What you get / what you need" block plus, when saves or kept notes exist, "See my results" and "Notes for your AI". B. only the returning-visitor row. C. A and an About page; optionally a Safari keyboard hint.
  - Recommended: B now (it reuses UX-010), A when the copy is approved; the Safari hint only if keyboard users ask.
  - Evidence: FLOW-09, SKIM-03, KBD-17, FLOW-10; `web/test-results/ux-review/skimmer/back-chromium-return/001-welcome-returning.png`. Touches: §10, §13, A13, D1.
- **D23. UX-067 (minor): fold the start funnel.** Seven presses, five screens and 1.8 s of mechanics before Begin; the honour screen is one sentence and a checkbox; the device check waits 1.3 s.
  - **Status: Applied recommended default (provisional, revisit): option B:** the refresh-rate measurement starts when Start leads to the gate (or to the honour screen when the gate is skipped) and is handed to the device check. At a person's pace the device screen is ready at once (Continue enabled within 2 ms, no "Checking your screen"); at script pace it waits once for what is left, about 850 to 870 ms (UXDEC-VER-04); before, about 1.3 s every time. The press and screen counts are unchanged. Files: `session/device.ts` (RefreshProbe), `session/DeviceCheck.svelte`, `session/SessionApp.svelte`. Option A (one screen for both checkboxes), recommended only if merging consent and honour is acceptable, is not done.
  - Options: A. one "Before you start" screen with both checkboxes (the §13 honour sentence word for word). B. start the refresh-rate measurement while the gate is shown. C. both.
  - Recommended: B now; A only if merging consent and honour is acceptable.
  - Evidence: SKIM-07; `web/test-results/ux-review/skimmer/funnel-chromium/003-honour.png`. Touches: §13, R-7.4, §10.
- **D24. UX-062 (minor): under-18 block has no way back from a mis-tap.**
  - **Status: Applied recommended default (provisional, revisit): option A:** the under-18 screen has a quiet, link-styled "I chose this by mistake" (a 44 px target, not primary) that returns to the gate with the box unticked. It stores and reads nothing, and the block and its words are unchanged. Files: `session/ConsentGate.svelte`, `session/SessionApp.svelte`, `session/copy.ts` (BLOCKED_MISTAKE).
  - Options: A. a quiet "I chose this by mistake" link back to the gate with the box unticked. B. move "I am under 18" away from Continue. C. no change.
  - Recommended: A (it stores nothing either way, so it does not weaken the block).
  - Evidence: KBD-15, FLOW-20; `web/test-results/ux-review/flow/funnel-chromium/004-under-18.png`. Touches: §13; `session/ConsentGate.svelte`.

### Words and look

- **D25. UX-060 (minor): one form for part and skill names.** "Reaction time" (h1) sits beside "Skip Reaction Time"; "Calibration/Metacognition" is on every session screen and "Analytical/Logic Games" in the table. Reviewers disagree on the direction.
  - **Status: Applied recommended default (provisional, revisit): option A plus C's display names, in Title Case:** part and skill names are Title Case everywhere ("Up next: Reaction Time", the h1 "Reaction Time", "Skip Reaction Time"), and the two research names show as "Confidence Calibration" and "Logic Games". A new display layer, `axis-names.ts`, gives every screen its names; the engine registry and the bank keep the §3 names, so no save, golden or bank file changes. Files: `axis-names.ts`, `session/segments.ts`, `viz/profile.ts`, `viz/card.ts`, `viz/facets.ts`, `reveal/peaks.ts`, `reveal/norms.ts`, `backend/copy.ts`, and the shared e2e drivers that match part titles (`e2e/routes.ts`, `parts.ts`, `session-driver.ts`, `flow.ts`). Open (names.json): facet labels and block titles stay in sentence case; the phone label for Confidence Calibration is "Calibration".
  - Options: A. Title Case everywhere (the §3 names). B. sentence case everywhere. C. keep titles, give the two jargon axes plain display names ("Confidence calibration", "Logic games").
  - Recommended: A plus C's display names, done at integration because the e2e drivers match part titles.
  - Evidence: SR-11, COPY-05, VIS1-12, FLOW-05, COPY-19, L2-10, VIS1-11; `web/test-results/ux-review/copy/evidence/interstitial-reaction-time-casing/001-interstitial-reaction-time-casing.png`. Touches: §3, §10, A7, house style.
- **D26. UX-080 (minor): brand voice and self-description lines.** Tagline "A jagged profile of how you think…" (figurative, describes the person), meta "jagged-blob cognitive profile", "Ready when you are", "Your blob is only meaningful…" three screens before any blob, "skip any part you cannot do".
  - **Status: Applied recommended default (provisional, revisit): option A, and the register split documented:** the welcome tagline reads "Short tasks of reasoning, memory and speed. Your results are shown as a profile with ranges, not as a single score."; the intro says what the session is, how long it takes and that a save file can be downloaded to keep; the meta description is now `META_DESCRIPTION` in `copy.ts`, pinned to `index.html` by a test; a lead-in before the honour sentence introduces the blob ("At the end of the session, your results are drawn as a shape we call your blob. Before you start, please agree to the following."). Headings such as "Ready when you are" are kept. The register split is written up in the new [HOUSE-STYLE.md](HOUSE-STYLE.md), which says at its top that it is a provisional default. Files: `session/copy.ts` (HONOUR_LEAD and the welcome text), `session/Honour.svelte`, `copy.ts`, `index.html`.
  - Options: A. new tagline, meta and intro wording, and a lead-in to the honour sentence. B. A plus plainer headings. C. no change; document the register split in the house style.
  - Recommended: A, and document the register split.
  - Evidence: L2-09, COPY-15, COPY-30; `web/test-results/ux-review/copy/tour/welcome/1280-light.png`. Touches: §13, A13, R-5.6.1.
- **D27. UX-083 (polish): one primary action per screen.**
  - **Status: Applied recommended default (provisional, revisit): option A:** "Start a 20-minute focus session" and the results-talk copy button are plain buttons; the Skip and Finish panels put "Keep going" first as the only primary, and Escape still means "Keep going". Files: `reveal/FocusPicker.svelte`, `brief/ui/ResultsTalk.svelte`, `session/SessionScreen.svelte`. Open (screen.json): while a panel is open, other primaries on the screen behind it (Start, Confirm, Continue) keep their style.
  - Options: A. focus-session start secondary; Skip and Finish panels make "Keep going" primary; results-talk copy button secondary. B. only the focus-session start. C. no change.
  - Recommended: A. The leave panel (UX-005b) and the after-save download (UX-030) are already done.
  - Evidence: VIS1-21, VIS2-19; `web/test-results/ux-review/visual-start/tour-chromium/confirm-finish/390-dark.png`. Touches: §10.
- **D28. UX-085 (polish): Spatial stem "rotated? (Not mirror-imaged.)"**
  - **Status: Applied recommended default (provisional, revisit): option A:** the stem reads "Which option shows the same object as the target, rotated? A mirror image does not count." File: `render/rotation/copy.ts`. The DESIGN §12 example and the bank's `hb/items/examples.py` keep the older wording (§4, spec text now out of step).
  - Options: A. "Which option shows the same object as the target, rotated? A mirror image does not count." B. no change.
  - Recommended: A.
  - Evidence: L2-07, COPY-11; `web/test-results/ux-review/nonnative/tour/item-spatial/1280-light.png`. Touches: §12 (example item), §14.6, §4.2; `render/rotation/copy.ts`.

### New in wave 2

- **D29. VER2-01 (minor, new): the option-card focus ring leaves the card on arrow keys in desktop Safari.** Tab into an option group draws the 3 px orange ring on the first card. The first arrow key moves the focus and the choice to the next card, and in desktop WebKit the ring is gone, because WebKit stops matching `:focus-visible` there. Only the 2 px chosen ring then shows where the focus is. Chromium keeps the ring; Shift+Tab away and back brings it back in both.
  - **Status: Skipped: no recommendation was given** (the verifier offered both options). The option-card focus ring is as it was (`render/choice/OptionGroup.svelte` unchanged).
  - Options: A. accept the chosen ring as the indicator while arrowing (the arrows choose as they move, so focus and choice are on the same card) and note it. B. also draw the ring on a checked card that has the focus (`input:focus:checked + .card`), accepting that Chromium then rings an option a mouse just clicked.
  - Recommended (verifier): none; the verifier offers both for an owner view.
  - Evidence: VER2-01; `web/test-results/ux-review/verify2/UX-021-focus/webkit/002-b-arrow-right.png` (Chromium for comparison: `web/test-results/ux-review/verify2/UX-021-focus/chromium/002-b-arrow-right.png`). Touches: WCAG 2.4.7, UX-021; `render/choice/OptionGroup.svelte`.
- **D30. Integration-2 note: an RT block keeps running while a "Skip" or "Finish now?" panel is open.** Practice or counted trials pass unanswered while the person reads the panel. Pausing the block would change the RT procedure, so nothing was changed in the product. The same behaviour made `e2e/keyboard-session.spec.ts:470` fail under machine load; the final integration runs that test on the real timeline instead of `?fast=1`, so it no longer depends on this decision (§4).
  - **Status: Skipped: no recommendation was given.** Nothing changed: verification 3 saw the block keep running under an open Skip panel in all three engines, as before; the renderer's script is byte for byte the base commit's (D12 moved only markup and CSS).
  - Options: A. pause the block while a panel is open and go on from the current trial after "Keep going". B. keep it running (the test side is done).
  - Recommended: none given; integration and the dev-merge package both flagged it as a product decision. A self-test pass is wise for A (§11.6).
  - Evidence: `ux-review/integration-2.json` open_issues and flaky; `ux-review/fixes/w2-sync.json` open_issues. Touches: §11.6, §10, UX-005a; `render/rt/RtRenderer.svelte`, `session/SessionScreen.svelte`.
- **D31. Integration-2 note: with a file loaded, a different pasted code is ignored without a word.** The ready screen uses the chosen file first and a code only when there is no file or the file is not a save. So pressing Load after pasting a different code does nothing and says nothing.
  - **Status: Skipped: no recommendation was given.** Nothing changed: verification 3 loaded a file, pasted a different save as a code and pressed Load; the status stayed the same and nothing said the code was ignored.
  - Options: A. the newer input wins. B. keep the order and say that the chosen file is the one in use. C. no change.
  - Recommended: none given; integration asked for an owner view.
  - Evidence: `ux-review/integration-2.json` open_issues. Touches: §8, UX-012a; `session/Ready.svelte`.

## 3. What was fixed

Files are under `web/src/` unless they start with `e2e/`, `scripts/` or `ux-review/`, or are `index.html` or
`vite.config.ts` (all under `web/`). Tests: e2e specs are in `web/e2e/`, unit and DOM tests sit beside their source;
a test file is listed whether it is new or gained or changed tests for the item.

### Wave 1

63 items: the 58 items of the six area packages and 5 integration items. Verdicts are from
[verification.json](ux-review/verification.json); after-screenshots are under `web/test-results/ux-review/verify/`.

| UX id | Sev. | Title | Area | Files | Tests added | Verified |
| --- | --- | --- | --- | --- | --- | --- |
| UX-001 | major | New screens open scrolled past their heading on mobile WebKit | session | session/Screen.svelte, session/title.ts | Screen.dom.test, ux-session.spec | verified |
| UX-003 | major | Session header up to 40% of a phone screen; notices linger in the warning colour | session | session/SessionScreen.svelte, session/ProgressRing.svelte, session/run.ts, session/copy.ts | SessionScreen.dom.test, run.test, ux-session.spec | verified, caveat (§4) |
| UX-004 | major | Practice loses focus, does not announce right or wrong, "Back" ends practice | session | session/PracticeScreen.svelte, session/copy.ts | PracticeScreen.dom.test, keyboard-session.spec, session.spec, ux-session.spec | verified |
| UX-005a | major | Confirm panels: "Keep going" strands the block's keys, Escape does nothing, a double tap closes them | session | session/ConfirmPanel.svelte, session/SessionScreen.svelte | ConfirmPanel.dom.test, SessionScreen.dom.test, keyboard-session.spec, ux-session.spec | verified |
| UX-006 | minor | Welcome takes no focus when reached again; page title never changes; gate errors do not mark the field | session | session/Screen.svelte, session/title.ts, App.svelte, session/ConsentGate.svelte +3 | App.dom.test, Screen.dom.test, SessionApp.flow.dom.test, ux-session.spec | verified |
| UX-007a | minor | Checklist says "Up next" for every later group; rows run together; labels break mid-word | session | session/Checklist.svelte, session/copy.ts | components.dom.test, ux-session.spec | partly; verified in wave 2 (VER-01) |
| UX-008 | minor | Session length reads 30, 28 or 31 minutes; "Almost there" with every part to do | session | session/ProgressRing.svelte, session/SessionScreen.svelte, session/copy.ts | SessionScreen.dom.test, components.dom.test, copy.test, ux-session.spec | verified |
| UX-009a | major | Results header misdescribes the profile ("You answered 0 questions", "You finished every part" after skips) | session | session/Finished.svelte, session/copy.ts | Finished.dom.test, ux-session.spec | verified |
| UX-010 | major | No way to see earlier results without starting and abandoning a session | session | session/Ready.svelte, session/SessionApp.svelte, session/Finished.svelte, session/copy.ts | Ready.dom.test, Finished.dom.test, SessionApp.flow.dom.test, ux-session.spec | verified |
| UX-011 | major | Back leaves a session silently; a refresh loses it; the privacy notice can open over a running clock | session | session/SessionApp.svelte, session/phase.ts, App.svelte, session/Privacy.svelte +2 | App.dom.test, SessionApp.flow.dom.test, ux-session.spec | verified |
| UX-012a | major | Ready screen ignores a chosen file, and a pasted code after a bad file; errors not tied to fields | session | session/Ready.svelte, session/saved-at.ts, session/coverage.ts, session/copy.ts | Ready.dom.test, coverage.test, saved-at.test, ux-session.spec | verified; deviation closed in wave 2 |
| UX-013 | minor | Device check: Continue jumps below the fold, Tab skips it while measuring, silent measuring line | session | session/DeviceCheck.svelte, session/device.ts, session/copy.ts, session/session.css | DeviceCheck.dom.test, ux-session.spec | verified |
| UX-014 | minor | Confidence panel: Continue below the fold, faint slider track, held Enter submits | session | session/Confidence.svelte, session/copy.ts | components.dom.test, ux-session.spec | verified |
| UX-015 | minor | Legends cut through their frames; printed results overlap and print dark on dark | session | session/session.css, app.css, session/Confidence.svelte | ux-session.spec | verified |
| UX-016 | minor | Segment blurbs use other nouns than the items; curly apostrophe; welcome link crowds Start | session | session/segments.ts, session/copy.ts, session/Welcome.svelte, index.html | copy.test, ux-session.spec | verified |
| UX-017a | major | No-WebGL Spatial state repeats its message and hides the only action 2.4 screens down | session | session/SessionScreen.svelte | SessionScreen.dom.test, ux-session.spec | partly; verified in wave 2 |
| UX-018a | major | Break offer claims a benefit | session | session/copy.ts | copy.test, ux-session.spec | verified |
| UX-002 | major | Timed blocks start with the stage, key or keypad off screen on phones | render | render/coding/CodingRenderer.svelte, render/common/Keypad.svelte, render/common/focus.ts +3 | coding.dom.test, span.dom.test, ux-render.spec | verified (see VER-03) |
| UX-017b | major | Rotation: empty frames and an enabled-looking Confirm without 3D; empty boxes while loading | render | render/rotation/RotationRenderer.svelte, render/rotation/copy.ts | RotationFallback.dom.test, ux-render.spec | verified |
| UX-019 | major | Enter on a reading answer submits the whole block | render | render/reading/ReadingRenderer.svelte | reading.dom.test, ux-render.spec | verified |
| UX-020 | major | Matrix options drawn at 0.70 of the cell size, so size rules read wrong | render | render/matrices/MatrixRenderer.svelte, render/choice/OptionGroup.svelte | MatrixRenderer.dom.test, ux-render.spec | verified |
| UX-021 | minor | Option groups: own black Confirm, blue ring, enabled-looking disabled state; a double tap pre-selects | render | render/choice/OptionGroup.svelte | OptionGroup.dom.test, ux-render.spec | verified |
| UX-022 | minor | Timed blocks: nameless focus targets, silent instructions, numbers freeze under page translation, double-tap zoom | render | render/rt/RtRenderer.svelte, render/span/DigitSpanRenderer.svelte, render/common/Keypad.svelte +3 | coding.dom.test, rt.dom.test, span.dom.test, ux-render.spec | verified |
| UX-023 | minor | Corsi blocks 34–42 px on phones; Done below the fold | render | render/span/CorsiRenderer.svelte | span.dom.test, ux-render.spec | partly; verified in wave 2 |
| UX-024 | minor | Number entry: decimal-comma keypads, "3.5" on a whole-number item, full-width and Arabic-Indic digits | render | render/common/NumericEntry.svelte, render/common/normalize-digits.ts, render/common/entry-copy.ts, render/quant/QuantRenderer.svelte | normalize-digits.test, quant.dom.test, series.dom.test, ux-render.spec | verified |
| UX-025 | minor | Block instructions: digit span never mentions Enter; "key" for two things; sequence, series and term drift | render | render/span/DigitSpanRenderer.svelte, render/coding/CodingRenderer.svelte, render/series/SeriesRenderer.svelte | coding.dom.test, series.dom.test, span.dom.test | verified |
| UX-026 | polish | "Reaction time" shown twice | render | render/rt/RtRenderer.svelte | rt.dom.test, ux-render.spec | verified |
| UX-027 | polish | Render CSS: no gap under button rows, dark scheme on paper, browser-blue checkboxes | render | render/common/render.css | ux-render.spec | verified |
| UX-012b | minor | Load errors talk about JSON, gzip and schema versions | reveal | save/parse.ts | parse.test | verified |
| UX-018b | major | Focus-session copy claims a benefit | reveal | reveal/copy.ts | copy.test | verified |
| UX-028 | major | "Stay and save" leaves the person 2,000–3,000 px from the save button | reveal | reveal/Reveal.svelte, reveal/SavePanel.svelte | ux-reveal.spec | verified |
| UX-029 | minor | Required save 2–3 screens down; nothing near the top says the results are not saved | reveal | reveal/Reveal.svelte, reveal/SavePanel.svelte, reveal/reveal.css, reveal/slots.ts +1 | Reveal.dom.test, ux-reveal.spec | verified |
| UX-030 | minor | Save panel: "Save code copied." twice; nothing says what the file is for or where it went | reveal | reveal/SavePanel.svelte, reveal/copy.ts | Reveal.dom.test, ux-reveal.spec | verified |
| UX-031 | minor | "Save your file first…" sits outside the results column | reveal | reveal/Reveal.svelte | Reveal.dom.test, ux-reveal.spec | verified |
| UX-032 | major | Share card asks for 3 skills when 1 exists; PNG button leaves the Tab order; preview unreadable on phones | reveal | reveal/ShareCard.svelte, reveal/copy.ts | ShareCard.dom.test, ux-reveal.spec | verified |
| UX-033 | minor | Focus-session picker: run-together labels, 24 px rows | reveal | reveal/FocusPicker.svelte | FocusPicker.dom.test, ux-reveal.spec | verified |
| UX-034 | minor | Reveal copy: overstated practice adjustment, "describe you", colour-only peaks wording, wrong screen named | reveal | reveal/copy.ts, reveal/NumbersSection.svelte | copy.test, ux-reveal.spec | verified |
| UX-035 | minor | Worked examples: "Three" over two, "subtract 1x", an all-bold question, boxes in boxes | reveal | reveal/WorkedSection.svelte, reveal/worked/quant.ts, reveal/worked/index.ts, reveal/copy.ts +1 | worked.test, Reveal.dom.test, ux-reveal.spec | verified |
| UX-036 | polish | Disclosures without a marker; greyer peaks heading; build-up status mounted with its text | reveal | reveal/reveal.css, reveal/PeaksSection.svelte, reveal/RevealProfile.svelte | ux-reveal.spec | verified |
| UX-037 | major | Estimates below −3 SD collapse into the centre with no off-scale mark | viz | viz/geometry.ts, viz/profile.ts, viz/blob.ts, viz/BarTable.svelte +5 | geometry.test, profile.test, blob.test, card.test, card.dom.test, ProfileView.ux.dom.test, ux-viz.spec | verified |
| UX-038 | major | Share card caveats unreadable at feed size; hollow and filled marks have no key | viz | viz/card.ts, viz/card-copy.ts, viz/blob.ts, viz/BlobChart.svelte | blob.test, card.test | verified |
| UX-039 | minor | "SD" means two things; "interval" against "range"; jargon in the legend | viz | viz/copy.ts, viz/BarTable.svelte, viz/ProfileView.svelte | ProfileView.ux.dom.test, ux-viz.spec | verified |
| UX-040 | minor | Drill-down shows generator codes as facet names and internal units | viz | viz/facets.ts, viz/copy.ts | facets.test | verified |
| UX-041 | minor | Drill-down draws an empty sub-blob when no facet has enough data | viz | viz/ProfileView.svelte, viz/copy.ts | ProfileView.ux.dom.test, ux-viz.spec | verified |
| UX-042 | minor | Narrow blob labels do not match the table names | viz | viz/profile.ts, viz/blob.ts | blob.test, profile.test | verified, deviation (§4) |
| UX-043 | minor | Bar view: mid-word breaks, numbers split from units, 60–80 px lollipop on phones | viz | viz/BarTable.svelte | ProfileView.ux.dom.test, ux-viz.spec | verified |
| UX-044 | minor | Blob text does not grow with the browser text size on phones | viz | viz/blob.ts, viz/ProfileView.svelte, viz/copy.ts | blob.test, ProfileView.ux.dom.test, ux-viz.spec | verified |
| UX-045 | minor | Ring labels sit on the data; their halo erases curve and whiskers | viz | viz/BlobChart.svelte, viz/card.ts | card.test, card.dom.test, ux-viz.spec | verified |
| UX-046 | minor | Clicking a wedge opens the facet panel off screen | viz | viz/ProfileView.svelte | ProfileView.ux.dom.test, ux-viz.spec | verified |
| UX-047 | polish | Chart polish: image name, faint ±1 SD band, h2 size, dark chart in print, card peaks wording | viz | viz/BlobChart.svelte, viz/ProfileView.svelte, viz/palette.ts, viz/card.ts +1 | palette.test, card.test, ProfileView.dom.test, ux-viz.spec | verified |
| UX-048a | minor | Never-offered skills labelled plainly "Not measured" | viz | viz/profile.ts | profile.test | verified |
| UX-049 | minor | `notes.html` has no way back and 48 Tab stops before "Copy the notes" | notes | brief/NotesBuilder.svelte, brief/ui/Paste.svelte, brief/copy.ts | NotesBuilder.dom.test, ux-notes.spec | verified |
| UX-050 | minor | "Keep my settings" drops focus; its 18+ error does not mark the checkbox | notes | brief/ui/SaveSettings.svelte | NotesBuilder.keep.dom.test, ux-notes.spec | verified |
| UX-051 | polish | "Where will you use these notes?" radios carry their whole blurb in the name | notes | brief/ui/WherePicker.svelte | NotesBuilder.dom.test, ux-notes.spec | verified |
| UX-052 | polish | Notes copy: line lists, month in words, "Maths", "pitch", the returning page's text | notes | brief/ui/format.ts, brief/returning.ts, brief/ui/Checker.svelte, brief/topics.ts +5 | format.test, returning.test, Checker.dom.test, NotesBuilder.dom.test, NotesBuilder.keep.dom.test, ux-notes.spec | verified (month finished at integration) |
| UX-053 | polish | "Working with AI" card unlike the share card; notes print dark | notes | brief/ui/RevealCard.svelte, brief/ui/ResultsTalk.svelte, brief/notes.css | ux-notes.spec | verified |
| UX-054 | major | RT self-test table stacks digits one per line on phones | selftest | selftest/RtSelfTest.svelte | RtSelfTest.dom.test, ux-selftest.spec | verified |
| UX-055 | minor | Self-test: Start drops focus, developer notes and "RT" in the text, no way back | selftest | selftest/RtSelfTest.svelte, selftest/measure.ts, rt-selftest.html | RtSelfTest.dom.test, measure.test, ux-selftest.spec | verified |
| UX-005b | minor | Leave panel: "Stay and save" first and primary, and Escape means it | integration | reveal/Reveal.svelte | Reveal.dom.test, ux-reveal.spec | verified |
| UX-007b | polish | Checklist was a "navigation" landmark with no links; now a named region | integration | session/Checklist.svelte | components.dom.test, SessionApp.dom.test | verified |
| UX-009b | polish | Nothing-measured page is now headed "Session ended" | integration | session/copy.ts, session/Finished.svelte, e2e/flow.ts | Finished.dom.test, ux-session.spec | verified |
| UX-048b | minor | Offered axes wired in: never-offered skills read "Not measured (not offered yet)" | integration | reveal/results.ts | results.test, results.served.test | verified |
| UX-056 | polish | Backend copy named the wrong screen for loading a save | integration | backend/copy.ts | DataPage.dom.test | verified |

**Also fixed along the way** (not triage items):
- GUARD-OVERLAP: lifting the session's run guard also removed the results page's unsaved-file guard; `reveal/guard.ts`
  now installs one listener per call (`guard.test.ts`, `guard.dom.test.ts`; found by `e2e/session-save.spec.ts`).
- Integration review: a pasted code whose content is not a save gets the code message (`save/parse.ts`); the notes
  footer matches the app's; the hard-stop test and three stale "Session complete" expectations use `FINISHED_HEADINGS`.
- Six new isolated specs (`e2e/ux-session`, `ux-render`, `ux-reveal`, `ux-viz`, `ux-notes`, `ux-selftest`) and a new
  a11y route `results-view` with the full axe, reflow, zoom, text-spacing and keyboard sweep.

### Wave 2

The merge of dev, 9 fixed items and two fixes from the integration review. The 9 are the three partly fixed triage
items (UX-007a through VER-01, UX-017a, UX-023), VER-02, UX-012a's deviation, three loose ends and UX-100. "Loose end" items are integration notes of wave 1, not triage items. Verdicts are
from [verification-2.json](ux-review/verification-2.json); after-screenshots are under
`web/test-results/ux-review/verify2/`.

| Id | Sev. | Title | Files | Tests added or changed | Verify-2 |
| --- | --- | --- | --- | --- | --- |
| SYNC-SELFTEST, SYNC-RT | — | Merge of dev: RT event-clock guard and self-test v3 (M1.10, M1.23), three conflicts in the self-test | selftest/measure.ts, selftest/RtSelfTest.svelte | measure.test, RtSelfTest.dom.test, rt-selftest.spec, ux-selftest.spec | verified (both) |
| VER-01 (UX-007a) | minor | Checklist names break inside a word ("Metacognitio n"; one letter per line at 320 px with 200% text) | session/Checklist.svelte | components.dom.test, ux2-session.spec | verified |
| VER-02 | polish | Two identical "Privacy and terms" links on the welcome; the footer one 24 px tall on phones | App.svelte | App.dom.test, App.served.dom.test, smoke.spec, ux-session.spec, ux2-session.spec | verified |
| UX-017a | major | No-WebGL Spatial screen shows and announces its message twice | session/SessionScreen.svelte, e2e/routes.ts | SessionScreen.dom.test, ux-session.spec, ux2-session.spec, ux-render.spec | verified |
| UX-012a | major | Load errors sit in the status line instead of an alert | session/Ready.svelte | Ready.dom.test, components.dom.test, ux-session.spec, ux2-session.spec, session-save.spec | verified, with the "Last saved today at …" line |
| PARSE-PASTE | loose end | Pasted text that is not a save, or is cut off, is worded as a file | save/parse.ts | parse.test, ux2-session.spec, session-save.spec | verified |
| PRACTICE-END | loose end | `PracticeRun.end()` used only by its own test; removed | session/practice.ts | practice.test | not replayed (code only; unit test) |
| UX-023 | minor | Corsi: Done 17 px below the fold at 320 × 568; the board shifts 17 px after Done | render/span/CorsiRenderer.svelte | span.dom.test and its snapshot, ux2-render.spec, ux-render.spec | verified |
| OPTIONGROUP-PRINT | loose end | Option cards take their dark border on paper when the screen is dark | render/choice/OptionGroup.svelte | OptionGroup.dom.test, ux2-render.spec | verified |
| UX-100 | minor | Blank page for 2.4 s on Fast 3G; 202 KB of JavaScript before the welcome | index.html, main.ts, vite.config.ts, session/SessionApp.svelte, session/results-loader.ts | results-loader.dom.test, SessionApp.flow.dom.test, SessionApp.served.dom.test, scripts/static-shell.test, scripts/results-split.test, ux2-perf.spec | verified |
| (integration review) | — | A save made while "Leave without saving?" was open left the panel saying the file was not downloaded | reveal/Reveal.svelte | Reveal.dom.test (failed before the fix, passes after) | not replayed (DOM test) |
| (integration review) | — | The isolated e2e config sent the three dev-server a11y routes to port 4175 without starting a server there | ux-review/playwright.iso.config.ts, e2e/dev-server.ts, e2e/a11y.spec.ts | the integration e2e runs, with and without `HB_DEV_SERVER=1` | test harness only (gates) |

**Merge of dev** (commit `5469d40`, [w2-sync.json](ux-review/fixes/w2-sync.json)). Three conflicts, all in the RT
self-test:
- `selftest/measure.ts`: dev's measurement and timing code is kept byte for byte (signed lag, `MAX_EVENT_LAG_MS`, the
  offset check, report version `rt_selftest_v3`). Only note strings differ from dev: wave 1's plain notes, plus the
  offset note `EVENT_OFFSET_NOTE` reworded in plain words and built from the 25 ms bound.
- `selftest/RtSelfTest.svelte`: wave 1 decides the presentation (UX-054 phone table, UX-055 focus, home link, short
  intro); dev's offset branch is kept. The verdict cell reads "Fail: offset time stamps", and the full reason is a
  note above the table.
- `selftest/measure.test.ts`: both sides' tests are kept, plus a test that the two clock notes are different
  conditions.

The auto-merged files were checked (`render/rt/RtRenderer.svelte`, `render/coding/CodingRenderer.svelte`,
`session/run.ts`, `session/SessionScreen.svelte`, `e2e/rt-selftest.spec.ts`): dev's per-block time-stamp policy sits
beside wave 1's focus, labels and keypad, with nothing duplicated. Six strings were reworded with the same meaning
to keep the plain-words rule (w2-sync.json `strings_changed`). Verification 2 checked the self-test page and the RT
block on the merged build (SYNC-SELFTEST, SYNC-RT).

**UX-100 before and after** ([w2-perf.json](ux-review/fixes/w2-perf.json); Chromium, Fast 3G at 562.5 ms latency and
1.44 Mbps, 4× slower CPU, 1280 × 800, three cold loads, median):

| Measure | Before | After |
| --- | ---: | ---: |
| First contentful paint | 2,424 ms | 620 ms (verification 2: 624 ms) |
| Welcome heading visible | 2,427 ms (skimmer: 2,401 ms) | 650 ms (verification 2: 651 ms) |
| App mounted | 2,390 ms | 2,176 ms (verification 2: 2,200 ms; Start visible at 2,475 ms) |
| Entry script, raw / gzip | 458.73 KB / 158.37 KB | 344.87 KB / 120.31 KB |
| JavaScript before the welcome, on the wire | 201,804 bytes | 177,020 bytes |
| Entry stylesheet | 38.58 KB | 23.99 KB |

How: `index.html` now holds a static shell of the welcome (heading, tagline, intro, disclaimer and a "Loading…"
line). Its words are filled at build time from the app's own copy constants, so they cannot drift, and its inline CSS
is checked rule by rule against the app's sheets by `scripts/static-shell.test.ts`. The swap to the app moves nothing
(0 px, no colour change, both schemes, three engines). The results screen (Finished, the reveal, chart and card) is a
separate chunk of 116 KB, fetched from the ready screen on. If it cannot load at the end, four tries over about 5.5 s
are followed by "Try again" and "Download my save file", and the leave guard stays on until the save is downloaded.
Deep links such as `#/privacy` show only "Loading…" until their page mounts. No timing code was touched.

**Integration 2** ([integration-2.json](ux-review/integration-2.json)) made the packages' requested test changes:
`App.served.dom.test.ts` follows VER-02; the `item-spatial-no-webgl` route in `e2e/routes.ts` now claims
`session/SessionScreen.svelte` (the renderer is hidden on purpose); `e2e/ux-render.spec.ts` reads the hidden
renderer's note with `includeHidden` and checks that the renderer is hidden. Its review then found the two problems
in the table above and fixed them. Nothing was reverted.

### Decisions round

All 31 decisions of §2 after the round of 2026-10-05. "Owner decision" is the owner's answer of 2026-10-05.
"Provisional default" is the recommended option, applied because the owner asked the team to follow the
recommendations; it is not an owner decision and stays open to change. "Partly" marks a provisional default with a
part not done: one the recommendation left for later, or one that needs something this round did not have (§2 says
what). The
verdicts are from [verification.json](ux-review/uxdec/verification.json) (verification 3, Chromium, desktop WebKit and
iPhone 13); "unchanged" means the verifier confirmed that nothing changed, as required. What changed, with files, is
in each decision's status line in §2.

| D | Item | Status | Option | Verify-3 |
| --- | --- | --- | --- | --- |
| D1 | UX-061 | owner decision | the owner's own answer: no personally identifiable information, all responses anonymous | verified |
| D2 | UX-071 | owner decision | A | verified |
| D3 | UX-070 | not changed (the owner is reviewing it) | — | unchanged |
| D4 | UX-072 | provisional default | A | verified |
| D5 | UX-066 | owner decision | C (A and B) | verified |
| D6 | UX-064 | provisional default, partly | B; A later | verified |
| D7 | UX-063 | provisional default, partly | B; slider step (UX-111) not decided | verified |
| D8 | UX-079 | provisional default | A | verified |
| D9 | VER-03 | provisional default | A | verified |
| D10 | UX-081 | owner decision | the owner's own answer: scratch paper and pencil, no calculator or AI chatbot | verified |
| D11 | UX-082 | provisional default, partly | C: A's display split and B; no new passages | verified |
| D12 | UX-084 | provisional default | A | verified |
| D13 | UX-073 | provisional default | A and B | verified |
| D14 | integration note | skipped (no recommendation) | — (settled by D13; test floor back to 10 px) | unchanged |
| D15 | UX-074 | provisional default, partly | A and C; B waits for the domain | verified |
| D16 | UX-075 | provisional default | A | verified |
| D17 | UX-077 | provisional default | A | verified |
| D18 | UX-078 | provisional default | A (gated, with D2) | verified |
| D19 | UX-076 | provisional default | A | verified |
| D20 | UX-069 | provisional default, partly | A; B later | verified |
| D21 | UX-068 | provisional default | B | verified |
| D22 | UX-065 | provisional default, partly | B; A waits for approved copy | partly (UXDEC-VER-01) |
| D23 | UX-067 | provisional default | B | verified |
| D24 | UX-062 | provisional default | A | verified |
| D25 | UX-060 | provisional default | A plus C's display names | verified |
| D26 | UX-080 | provisional default | A | verified |
| D27 | UX-083 | provisional default | A | verified |
| D28 | UX-085 | provisional default | A | verified |
| D29 | VER2-01 | skipped (no recommendation) | — | unchanged |
| D30 | integration-2 note | skipped (no recommendation) | — | unchanged |
| D31 | integration-2 note | skipped (no recommendation) | — | unchanged |

Totals: 4 owner decisions, 22 provisional defaults (6 of them partly), 1 not changed, 4 skipped. Verification 3:
25 verified, 1 partly, 5 unchanged, 0 not fixed, 0 regressed.

**Fixed at integration** ([integrate.json](ux-review/uxdec/integrate.json) changes). Four problems of the combined
branch, each found by a gate:
- The RT fixation halo (D12) declared a colour token that no contrast pair reads, which failed
  `scripts/contrast.test.ts`; the halo now names the stage colours directly (same pixels, CSS only).
- The server's reader of a typed answer did not read the decimal comma the app reads since D8, so a served answer
  such as "0,5" would have scored as no number (`test:db`). New migration
  `supabase/migrations/20261007000200_parse_entry_decimal_comma.sql`; two db tests that pinned the old grammar now
  take "3,5" as 3.5.
- The D5 time-rule e2e tests still fast-forwarded on "Up next" screens and expected the break after 30 minutes;
  rewritten to the new rules (`e2e/session.spec.ts`, `ux2-session.spec.ts`, `session-save.spec.ts`).
- The a11y sweep had no route for the two new screens; `welcome-returning` (D22) and `ready-continue` (D6) are in
  `e2e/routes.ts` and pass every sweep.

The integration also folded two side copy files back into `session/copy.ts` and `reveal/copy.ts`, removed constants
left unused (`BREAK_AT_S`), documented the D8 version exception in `tasks/family.ts`, named the backups and the
archive in the data page's delete text, and applied or answered every package request (integrate.json requests).

## 4. Still open

Closed in wave 2 and removed from this section: UX-007a with VER-01, UX-017a, UX-023, VER-02, UX-012a's deviation, and
three loose ends of wave-1 integration (the pasted-text wording, `PracticeRun.end()`, the option cards' print border).

**Caveats, deviations and findings caused by a fix:**

| Id | Sev. | What is left | Suggested next step | Suggested priority |
| --- | --- | --- | --- | --- |
| VER-03 | minor | One-row coding keypad, keys 30–38 px wide (40 px on a 412 px Pixel). | Decisions round: D9 option A applied as a provisional default and verified (two rows under about 40 px; keys 53 to 72 px wide at 320 to 412 px). Left: a timing re-check on a real phone. | P1 |
| VER2-01 | minor | New in verification 2: in desktop WebKit the option-card focus ring leaves the card as soon as an arrow key moves the focus; only the chosen ring shows where the focus is. | Owner decision D29 (skipped in the decisions round: no recommendation). | P2 |
| UX-003 | major | Verified with a caveat: at 320 px the header is 100 px (acceptance about 96 px), 148 px on a screen with a notice. Verification 2 found the same on desktop WebKit. | Accept, or trim the ring at 320 px. | P3 |
| UX-042 | minor | Two deliberate deviations: Processing & Reading Speed is labelled "Processing" (not "Reading speed"), and stacked labels keep a 0.2 em gap, both to hold the phone legibility floors. | Revisit with D13 and D14 (decisions round: D13 A and B applied as provisional defaults, the 10 px test floor restored; the two deviations are unchanged). | P3 |
| UX-100 | minor | Fixed, with known limits: the app still mounts at about 2.2 s on Fast 3G (Start shows at 2.5 s). A chunk the results need but the entry does not (today `brief-gates`) that fails while the browser reports being online stays failed until a reload; the save download still works. If the entry script itself fails, the shell shows "Loading…" for good (before: a blank page). | Accept; a later pass could trim the entry further or preload the shared chunk. | P3 |
| UX-017a | major | Fixed as asked; at 320 × 568 with 200% text the Skip button ends at 1,117 px, below the fold (not part of the acceptance; the panel is still the first thing under the heading). | Accept, or shorten the panel at large text sizes. | P3 |

**Loose ends** ([integration.json](ux-review/integration.json) and [integration-2.json](ux-review/integration-2.json)
open_issues, [w2-sync.json](ux-review/fixes/w2-sync.json) open_issues):
- Two double-tap guards with different thresholds (`ConfirmPanel.svelte`, `OptionGroup.svelte`); one shared helper would be cleaner. (Wave 1.)
- The progress ring text is `translate="no"`, so a page translator leaves it in English (a translated node would stop updating). (Wave 1.)
- `e2e/session-save.spec.ts:289` (dev's whole-session test, unchanged here) depends on wall-clock speed under `?fast=1` and fails when the machine is loaded; it passes alone on every project. The 20× fast clock leaves 7.5–75 ms of real time for a valid RT response, so a slowed driver answers "too slow" and the block has too few valid trials. The other such test, `e2e/keyboard-session.spec.ts:470` (the RT practice keeps running under the Skip panel, D30), now runs on the real timeline (final integration, appendix B).
- `session/Ready.svelte`: a second file chosen while the first is still being read is not read, and if the first was not a save the field is cleared under the second. Unreachable in practice (a save is read in milliseconds); a queued re-read would close it.
- The no-WebGL panel's message is a `role=status` paragraph inserted together with its text; some screen readers do not announce such a region. Skip is the first thing in the panel and the heading stays, so the message is still found by reading on.
- Wave-1 isolated e2e runs may have checked the three dev-server a11y routes against another worktree's dev server. Fixed in integration 2: without `HB_DEV_SERVER=1` they are skipped, so a full isolated pass needs one `HB_DEV_SERVER=1` run per project (§6).
- e2e helpers are duplicated across the new specs: a no-WebGL init script in `e2e/routes.ts`, `e2e/ux-render.spec.ts` and `e2e/ux2-session.spec.ts`, and a second `toReady` in `e2e/ux2-perf.spec.ts`. Left as tested.
- Dev's `rt_timestamp_reason` in RT observations is taken as dev wrote it; no wave-1 code reads it. `ux-review/findings/copy-inventory.json` still lists the old self-test row names (a review-time record, left as it is).
- A vite preview from an earlier package of this worktree was still listening on port 4612 at integration 2; stop it when the worktree is retired.

**Small targets carried over** (seen by the verification-2 tour, already present in wave 1, not triage items): the
18 px "Make notes for your AI (opens in a new tab)" link on the saved results and share-card routes, at every width.
On the iPhone: the 24 px gate link "Read the full privacy notice and terms", the 24 px "Back" link on the privacy page
and the 26 px honour-code checkbox.

**Not covered by verification:** wave 2 closed wave 1's gaps (desktop WebKit, Pixel 7 and the "Last saved today at
…" line). Still not covered: the iPhone SE project; UX-023 and the print border on Pixel; the self-test and the
no-WebGL Skip offer at 200% text beyond what the acceptance named; the self-test's timing values (not judged); the
Chromium-only "Loading figures…" state of UX-017b; the wave-1 items outside the 20 majors (UX-005b to UX-008, UX-013
to UX-016, UX-022, UX-024 to UX-027, UX-033 to UX-036, UX-039 to UX-053) on WebKit and Pixel; PRACTICE-END and the
integration-2 leave-panel fix (unit and DOM tests only); vitest and the isolated e2e (the integrator's gates); and any
real device (every WebKit and Pixel result is Playwright's desktop WebKit build and device emulation).

**Decisions round: new findings of verification 3** ([verification.json](ux-review/uxdec/verification.json)
new_findings). None is a regression of this branch:

| Id | Sev. | Decision | What | Suggested next step |
| --- | --- | --- | --- | --- |
| UXDEC-VER-01 | minor | D22 | A browser that kept notes settings only on the notes page, with no session consent record yet, gets no welcome row and so no "Notes for your AI" link, although D22's text promises the link when kept notes exist. By design in funnel.json: without an adult consent record of the session flow the welcome reads nothing more, and the notes page keeps its own 18+ tick. | An owner line: accept it, or let the notes page's 18+ tick count as the adult record for the welcome row. |
| UXDEC-VER-02 | polish | sweep (already there before) | The notes card's "Make notes for your AI (opens in a new tab)" link on the saved results is 18 px tall at 1280 px (38 px at 200% text, 42 px at 320 px), under WCAG 2.5.8's 24 px for a link alone in its paragraph. `RevealCard.svelte` is unchanged on this branch. | Give the link the `.hb-standalone-link` 24 px minimum, or a 44 px row like the welcome's notes link. |
| UXDEC-VER-03 | polish | D5 | The break is offered before Working Memory even when the three parts before it were all skipped (no active minutes): the half-way rule taken literally, as run.json says. | Owner choice: keep the rule, or offer the break only after a part has run. |
| UXDEC-VER-04 | polish | D23 | At script pace (gate and honour code in well under a second) the device screen still shows "Checking your screen" for about 850 to 870 ms while the measurement started on the gate finishes; at a person's pace it never shows. Expected from the handoff; recorded so the number is on file. | None needed. |
| UXDEC-VER-05 | polish | D21 | In headless desktop WebKit, after a later question's region takes focus, one Tab lands on the page instead of the first option; Chromium reaches the option. Probably WebKit's Tab-to-controls setting (low confidence). | Check in real Safari with "Press Tab to highlight each item" on; no change proposed from emulation alone. |
| UXDEC-VER-06 | polish | D16 | At 200% text on a 390 px phone no part of the chart is in the first screen (66% of it is at 100% text); the h1, the lead line and the save pointer fill it. | Shorter Finished lead lines on phones (an open integration request) would help most. |

Verification 3 also saw the small targets above again, all over WCAG 2.5.8's 24 px except the 18 px link
(UXDEC-VER-02): the 24 px standalone links ("Privacy and terms", "Back", the gate link), the 26 px checkboxes of the
gate, the honour code and the ready screen's "Add my new session to the …" (each inside a 44 px label row), and the
notes page's 40 px "Show all topics" and "Why this line?". Its only console message was three.js failing to create a
WebGL context on the route that turns WebGL off on purpose.

**Decisions round: questions left for the owner** (from the handoffs and integrate.json for_lead; none was decided in
this round, and each provisional default stays open):
- D3: which wording, and whether to touch the RT norm width before real data (§2 D3 has the context and four
  questions).
- D1: "anonymous" is true in the everyday sense but not in the strict GDPR sense DESIGN §13 cites; the 24-month
  removal of database rows and the archive expiry are not built or turned on, so the server notice calls 24 months
  the plan. Both matter before any version that collects data (M2.6).
- D10: the wording says "a calculator or an AI chatbot" and that accessibility tools are fine, instead of the
  owner's "assistive technology such as calculators or LLMs"; integrate.json asks for one line to the owner on it.
- D4: with the leave-facet-out prior every facet repeats about its skill until the model has a spread between people
  per facet (AI.20). Keep the provisional default, or change the model?
- D5: offer the break when every earlier part was skipped (UXDEC-VER-03)? And should the M1.4b simulation
  (`sim/cat.ts`) model the budget cap? Capping would shorten its simulated sessions, and its acceptance band (every
  session at 25 to 30 minutes) might no longer hold; unchanged, `test:slow` still passes.
- D6: the server variant offers no continuation and its SQL re-score numbers tests by session, not sitting. Before
  the server goes live: port sittings, or accept that a continuation is practice-adjusted against the session it
  continues.
- D8: keep the documented exception (the quant generator stays at 1.3.0 although its hints changed) or follow the
  version rule literally (quant 1.4.0, a new dump and digest pin, and saved quant answers no longer re-scored
  locally).
- D17: should a session that leaves the earlier saves out also leave this device's notes settings out of its save?
- D21: name the question region "Question N" (a running number, no total) or something without a number?
- D22: the notes-only browser of UXDEC-VER-01.
- Smaller ones in the handoffs: dropping the grey centre stubs of not-measured spokes (D13, a §9.7 change); placing
  D18's sentence as its own line after the copy button; a smaller gap between the pieces of a split reading paragraph
  (D11).

**Decisions round: not covered by verification 3.** The Pixel 7 and iPhone SE projects did not run; their widths
(412 px and 320 × 568) were measured by resizing the viewport in all three engines, so the Android user agent was not
exercised. A UTC and local date that differ (D19) were not provoked; `save/local-date.test.ts` pins the function. The
no-peaks note (D2) did not render in the replay, because both simulated saves list a peak; `Reveal.dom.test.ts`
renders it. The four-position RT stage (D12) was not reached. The iPhone emulation exposes no download event (D17).
The facet numbers (D4), the sitting model (D6), the bank twin and the server reader (D8) are unit, golden and db-test
matters. No real device, and no device re-timing of the coding keypad (D9) or the RT renderer (D12).

**Spec text now out of step (decisions round; for the lead).** Collected from the handoffs' `spec_out_of_step`
entries. None of these lines was edited in this round: DESIGN.md and ROADMAP.md are the lead's. The four owner
decisions (D1, D2, D5, D10) may go into them with the owner's OK. The provisional defaults must not be written there
as decisions. D10 left nothing out of step, since the §13 honour sentence is kept word for word.

| Where | What no longer matches | From |
| --- | --- | --- |
| DESIGN §13, GDPR/CCPA basics ("controller = you, purpose, retention 24 months, legal basis = consent") | The notice names no controller or contact and says no personally identifiable information is collected and all responses are anonymous. §13 itself calls the random identifier pseudonymous personal data (Recital 26), which sits uneasily with "anonymous". | D1, owner decision |
| ROADMAP M1.15 (and PROGRESS "Needs you") | Still name the TODO(user) placeholders and the sign-off on retention and legal basis; the placeholders are gone. | D1, owner decision |
| `supabase/README.md`, nightly job and archive | Asks the M2.6 notice to say archived answers are kept; the server notice now says so, and names the eight-week backups. The 24-month removal is still not built. | D1, owner decision |
| DESIGN §17.7, row "results-preamble" and "exactly 340 characters"; ROADMAP AI.6b ("340 characters") | Wording version 2: "Where ranges overlap, a difference may not be real.", 346 characters. `scripts/docs-phase-ai.test.ts` compares the DESIGN row with the v1 fixture and asserts 340, so it must change with the row. | D2, owner decision |
| ROADMAP A22 and the gates file (RT entry); bank copies of gate statuses (A17) and any E22 smoke arm (AI.12a) | The results-talk gate is at wording version 2, status shipped; anything that names v1 or 340 characters needs the v2 text. | D2, owner decision; D18, provisional |
| DESIGN §10 ("A break is suggested at 30 min."; "6–10 minute blocks with a 1-screen interstitial"); ROADMAP M1.15 ("break at 30 min") | One break offer at the part boundary nearest half the planned session; the clock is held on every "Up next" screen and on the break offer. | D5, owner decision |
| DESIGN §7.4; ROADMAP A15 ("Blocks loop until SD < 0.3 or the time runs out") | An adaptive part gets at most its planned share; a skip or unused time shortens the session (the three-item floor still overrides). | D5, owner decision |
| DESIGN §17.7, row "results-talk" | Lacks D18's sentence. | D18, provisional |
| DESIGN §8 (flags, response tuple); §3 row 12; §7.1 | New counter `confidence_untouched_n`; a null `confidence_pct` also means a slider not moved, left out of the calibration. | D7, provisional |
| DESIGN §7.8 (the test number), §8 (flags, the crash-recovery bullet), §10 (ready screen); session counts on the card (M1.18); ROADMAP M1.Q | Test numbers and session counts count sittings; flags `continuation`, `done_<part>`, `completed`, `focus_session`; a 24-hour offer to continue; the retest golden has 52 cases, 14 of them continuations, and the server SQL re-score does not handle continuations. | D6, provisional |
| ROADMAP A12; A7 and A23; DESIGN §9.6 item 6 | The facet prior leaves the facet's own answers out, and a facet that holds its whole skill shows the skill; Quantitative's drill-down facets are the six topic groups. | D4, provisional |
| DESIGN §4.2 (Math); ROADMAP A18 | Neither describes the entry grammar: the decimal comma, the thousands form read in saved answers but refused by the entry box, the "whole number" hints. | D8, provisional |
| DESIGN §9.7, §9.2; ROADMAP A15 | The curve, band and fuzz break at a not-measured spoke (open curves between gaps); the gap marker is an x on the 0 SD ring; on narrow screens with five or more not-measured spokes their words move from the labels to a list under the chart. | D13, provisional |
| DESIGN §9.9 and §9.5; ROADMAP A12 | On the share card a credible low is muted and the named peaks are ringed, with the new key; the results page keeps §9.5. | D15 A, provisional |
| DESIGN §9.9 (Export); ROADMAP M1.18 | Neither gives the card's file name (`humanbench-card-light-<local date>`, or `-dark-`) or its button order where image files can be shared. | D15 C and D19, provisional |
| DESIGN §8 (file name `<date>`) | The date is the local calendar day; `created_utc` stays UTC. | D19, provisional |
| DESIGN §8 "Privacy", R-17.1, R-17.12; ROADMAP owner decisions 2026-10-01 (AI.7, the "Add my new session …" box) | The results-page save now carries this device's notes settings (choices only), also for a session that left the earlier saves out. | D17, provisional |
| DESIGN §3 rows 3 and 12; ROADMAP A7 | The screens say "Logic Games" and "Confidence Calibration"; the registry and the bank keep the §3 names. (Rows 13 to 15 already differed in case from the registry before this round.) | D25, provisional |
| DESIGN §12 (example item) and the bank's `hb/items/examples.py` | Still "(Not mirror-imaged.)"; the renderer says "A mirror image does not count." | D28, provisional |
| DESIGN §3 row 10 and A14; §7.3 (reading norm) | No conflict, but neither says a long paragraph is drawn as several pieces, nor that the reading figures are for first-language readers. | D11, provisional |
| DESIGN §10 "Reveal flow" and §9; ROADMAP M1.R | No conflict with the order; the practice note is one short sentence and its explanation is in the "When to come back" advice. | D16, provisional |
| DESIGN §11.6 and §3 row 9 | No conflict; neither says where the fixation cross is drawn. | D12, provisional |
| DESIGN §10 ("A progress ring shows time, not items"), §13; ROADMAP M1.15 | A running "Question N" heard only by screen-reader users; the focus rule per question is not in the spec. | D21, provisional |
| DESIGN §13 "Consent and age gate" | No conflict; the welcome now reads the consent record (and, with an adult record, the autosaves), and an adult record of older terms only leads to the gate. | D22, provisional |
| `web/src/render/common/render.css` header and CLAUDE.md (44 px targets) | Unfolded coding keys are 40.7 px wide on a 430 px phone; DESIGN states no target size. | D9, provisional |

**Deferred** (19 items; priority from triage, P2 before P3; UX-100 was done in wave 2):

| UX id | Sev. | Title | Pri. | Why deferred |
| --- | --- | --- | --- | --- |
| UX-106 | minor | Four colour-token sets with drifting values; three focus colours, three accents | P2 | A cross-area design-system refactor; quick wins done in UX-015, UX-021, UX-027. |
| UX-115 | minor | Only one save file can be loaded; a second Load replaces the first | P2 | Merging is defined (R-8.1) but a multi-file loader is new UI; silent drops fixed in UX-012a. |
| UX-117 | minor | Show how much the ranges tightened since the last session | P2 | New retest element (§10) needing per-session re-scores; the session count is in UX-009a. |
| UX-118 | minor | Sharing the save file counts as saved even if the target kept nothing | P2 | Depends on real iOS share-sheet behaviour; needs a real-device check first. |
| UX-101 | polish | Answer button is "Confirm" on some items and "Submit" on others | P3 | Both clear; renaming breaks the shared e2e drivers. |
| UX-102 | polish | "Block complete. Thank you." uses the internal word "block" | P3 | Drivers read it as the end-of-block signal; the viz part fixed in UX-040. |
| UX-103 | polish | "Cluster" and "facet" unexplained; short bar-view headers on phones | P3 | Heading matched by several specs; "cluster" is the A7 term. |
| UX-104 | polish | Copy-failed messages use four patterns | P3 | Pinned in three areas; the self-test part fixed in UX-055. |
| UX-105 | polish | Notes paid-plan sentence is ungrammatical and hedged twice | P3 | `brief/surfaces.json` is bank-mirrored. |
| UX-107 | polish | Body lines run to 81–98 characters at desktop widths | P3 | Global measure change; park for the design-system pass. |
| UX-108 | polish | Large matrix glyphs in corner slots touch the cell frame | P3 | Changes `draw.ts` geometry and every matrix snapshot; after UX-020 settles. |
| UX-109 | polish | No print stylesheet: controls print, cards split across pages | P3 | What a printout is for is an owner question; illegible print fixed in UX-015, UX-027, UX-047, UX-053. |
| UX-110 | polish | Notes builder: one long column on desktop, long intro on phones, product names in a blurb | P3 | A layout redesign; the way in and out fixed in UX-049. |
| UX-111 | polish | Confidence slider: 1% steps, uneven Page keys, no keyboard hint | P3 | Step size feeds calibration; decide with D7. |
| UX-112 | polish | Warm the Three.js chunk before the Spatial part | P3 | Needs a modulepreload decision; a loading line added in UX-017b. |
| UX-113 | polish | Landscape phone: digit keypad Done and RT "Start practice" just below the fold | P3 | Separate landscape design; portrait Corsi fixed in UX-023. |
| UX-114 | polish | First practice item 1.4–1.8 screens tall, Confirm below the fold on phones | P3 | Sticky action rows are a pattern decision; UX-001 and UX-004 help. |
| UX-116 | polish | A second tab counts the running session as an "earlier session" | P3 | Needs a cross-tab heartbeat design; rare. |
| UX-119 | polish | Wide font at 200% text breaks headings mid-word | P3 | Simulated worst case; global h1 wrapping needs the wide-font spec re-baselined. |

## 5. Considered and kept as designed

- **UX-120** (not a problem): the exported SVG keeps a fixed 1200 × 630 size; it is meant for editing tools (§9, item 9).
- **UX-121** (not a problem): a hand-edited save loads without an "unverified" mark, by design (§8): the static build
  has no signatures to check and never uploads.
- **Gated and pinned texts were not reworded:** Notes-for-your-AI lines, the results-talk preamble and lead,
  DISCLAIMER, RESOURCE_LINE, the emotion-axis name and tooltip, the §13 honour sentence. Objections are decisions
  (D2, D10, D18, D26, D28). The decisions round then changed the results-talk preamble as a gated change (D2, owner
  decision) and its helper line (D18), added a lead-in before and a tools paragraph after the §13 honour sentence
  (D26, D10) and reworded the Spatial stem (D28). The §13 sentence itself is unchanged (integrate.json review).
- **No save format or bank change** in either wave: §8 and `schema/` unchanged; no bank-mirrored file touched; the bank
  worktree is clean. Wave 2 changed the wording of save-load errors only; every error code is the same. The decisions
  round does change both: optional additions to `schema/save-v1.json` (the `confidence_untouched_n` counter and the
  flag descriptions; still `save-v1`), bank files for D6 and D8, and two server migrations (D4, D8).
- **Kept pending a decision** in waves 1 and 2: the h1 focus per question (D21), the firm under-18 block (D24), dips at
  unmeasured spokes (D13), the §10 reveal order (D16). The decisions round applied provisional defaults to all four
  (D21 B, D24 A, D13 A and B, D16 A with the §10 order kept).
- **Checked and found sound:** blob geometry (markers within 0.15 px, whiskers within 0.19 px, overshoot at most 0.05
  rings of the 0.1 allowed); no total, area, single score or percentile anywhere (A12, §9.5); Okabe–Ito marks
  separable under simulated colour-vision differences; 16 px fields; no keyboard trap, focus ring 4.5:1 or better
  (7.9:1 in dark); one h1 per route, 0 serious axe violations; double clicks never submit twice; reveal in §10 order.

## 6. Method

**Wave 1 pipeline.** Baseline tour of all 50 product routes → 11 reviewers → triage (219 findings into 111 items) →
six area fix packages in parallel in one worktree (session, render, reveal, viz, notes, selftest; Sonnet 5.5) →
integration (Opus 5.5: five integration items, the packages' integration requests, a review of the combined diff,
every gate) → independent verification (Fable: every fix replayed, a regression sweep, three new findings).

**Wave 2 pipeline.** Sync with dev (merge commit `5469d40`, three conflicts) → three fix packages in parallel in the
same worktree (session, render, perf) → integration 2 (the packages' integration requests, a review of the combined
diff with two fixes, every gate, e2e in three shards per project plus a dev-server run) → verification 2 (the
wave-2 items replayed, the 20 major wave-1 items on desktop WebKit and Pixel 7, a 51-route tour compared state by
state with the wave-1 tours by `ux-review/verify2-compare.ts`, one whole session per engine through save and load).

**Final integration** (Opus). A review of the whole branch against `dev` (no newer dev commits to merge; no bank
file changed; no answer keys, bank data, local paths or test output committed), the wave-2 flaky keyboard test moved to the
real timeline (`e83cee4`), the harness README brought in line with the dev-server skip, and every gate re-run on the
branch head: e2e as one unsharded run per project with the dev server (appendix B).

| Wave-2 package | What it did | Model | Record |
| --- | --- | --- | --- |
| w2-sync | Merged dev into `wf10/ux`; settled the three self-test conflicts | Opus | [w2-sync.json](ux-review/fixes/w2-sync.json) |
| w2-session | VER-01, VER-02, UX-017a, UX-012a, PARSE-PASTE, PRACTICE-END | Sonnet | [w2-session.json](ux-review/fixes/w2-session.json) |
| w2-render | UX-023, OPTIONGROUP-PRINT | Sonnet | [w2-render.json](ux-review/fixes/w2-render.json) |
| w2-perf | UX-100 | Opus | [w2-perf.json](ux-review/fixes/w2-perf.json) |
| integrate-2 | Integration requests, review fixes, gates | Opus | [integration-2.json](ux-review/integration-2.json) |
| verify-2 | Replay, coverage gaps, tour, journeys; one new finding | Fable | [verification-2.json](ux-review/verification-2.json), [verify2-regressions.json](ux-review/findings/verify2-regressions.json) |

**Decisions round pipeline.** The owner's answers of 2026-10-05 and the recommended options for the rest → fifteen
build packages in parallel in one pub worktree and one bank worktree (branch `wf10/uxdec`; pub on dev `9f68f49`,
bank on `0d2a60e`), and
a context package for D3 → integration (the packages' requests, four fixes, a review of the combined diff, every gate
of both repos on the branch head, a commit split per decision group) → verification 3 (every decision replayed on a
fresh build in Chromium, desktop WebKit and iPhone 13, a sweep of every route, six new findings) → this update of the
document. Each package wrote its own handoff; the integration and the verification wrote their own records.

| Package | Decisions | What it did | Repos | Record |
| --- | --- | --- | --- | --- |
| start-copy | D1, D10, D20, D26 | Privacy notices; honour tools paragraph; the needs-sight sentence; welcome, meta and honour lead-in wording; `HOUSE-STYLE.md` | pub | [start-copy.json](ux-review/uxdec/start-copy.json) |
| gated | D2, D18 | Results-talk wording version 2 (preamble and helper), card small print, no-peaks note | pub | [gated.json](ux-review/uxdec/gated.json) |
| run | D5, D7 | Clock holds, the half-way break, capped adaptive budgets, `sim:session`; untouched slider not rated | pub | [run.json](ux-review/uxdec/run.json) |
| engine-retest | D6 (retest model) | Test numbers count sittings; continuation cases in the retest golden | pub, bank | [engine-retest.json](ux-review/uxdec/engine-retest.json) |
| resume | D6 (flow) | Progress flags, the continue offer, counts by sitting | pub | [resume.json](ux-review/uxdec/resume.json) |
| facets | D4 | Leave-facet-out prior, Quantitative topic groups, server re-score migration | pub | [facets.json](ux-review/uxdec/facets.json) |
| quant-entry | D8 | Entry grammar and hints, shared parity vectors | pub, bank | [quant-entry.json](ux-review/uxdec/quant-entry.json) |
| render | D9, D12, D28 | Coding keypad fold, fixation cross in the pad, Spatial stem | pub | [render.json](ux-review/uxdec/render.json) |
| reading | D11 (A) | Display split of long paragraphs; bank README section on passages | pub, bank | [reading.json](ux-review/uxdec/reading.json) |
| reveal | D16, D11 (B) | Compact results top, one column; the first-language sentence | pub | [reveal.json](ux-review/uxdec/reveal.json) |
| viz-blob | D13, D14, D15 (A) | Gaps at not-measured spokes, the "Not measured" list, the 10 px floor; card muting and peak rings | pub | [viz-blob.json](ux-review/uxdec/viz-blob.json) |
| share-save | D15 (C), D17, D19 | Share button order, notes settings in the results save, local dates in file names | pub | [share-save.json](ux-review/uxdec/share-save.json) |
| names | D25 | Display-name layer, Title Case part and skill names | pub | [names.json](ux-review/uxdec/names.json) |
| screen | D21, D27 | Focus on the question region, one primary action per screen | pub | [screen.json](ux-review/uxdec/screen.json) |
| funnel | D22, D23, D24 | Returning-visitor row, refresh rate measured during the gate, the under-18 way back | pub | [funnel.json](ux-review/uxdec/funnel.json) |
| d3-context | D3 | Context for the owner; no code | — | [d3-context.json](ux-review/uxdec/d3-context.json) |
| integrate | all | Requests, four fixes, review, gates, commit split | pub, bank | [integrate.json](ux-review/uxdec/integrate.json) |
| verify | all | Replay, route sweep, six new findings; four harness files `ux-review/personas/uxdec-verify-*.ux.ts` | pub (harness) | [verification.json](ux-review/uxdec/verification.json) |
| docs | — | This update of `web/UX-REVIEW.md` | pub | this document |

The handoffs do not record which model ran each package, so the table names none; this update (docs) was written by
Opus 5.5.

**Reviewers** (model as recorded in each findings file; counts are findings filed, before triage):

| Reviewer | Persona or role | Model | Prefix | Findings (major / minor / polish) | Projects |
| --- | --- | --- | --- | --- | --- |
| phone | Sam, first-time phone user | Fable | PHONE | 16 (2 / 8 / 6) | iphone, iphone-se, pixel, webkit, chromium |
| keyboard | Alex, keyboard only | Sonnet | KBD | 18 (3 / 10 / 5) | chromium, webkit |
| screenreader | Jordan, blind screen-reader user | Fable | SR | 14 (1 / 8 / 5) | chromium, webkit |
| skimmer | Riley, impatient skimmer | Fable | SKIM | 15 (3 / 10 / 2) | chromium, iphone |
| nonnative | Mei, B2 English reader | Fable | L2 | 15 (2 / 10 / 3) | chromium, iphone |
| data | Dr Kim, curious data person | Opus | DATA | 19 (5 / 11 / 3) | chromium, webkit, iphone |
| sharer | Pat, sharer | Sonnet | SHARE | 24 (5 / 14 / 5) | chromium, webkit, iphone |
| copy | Copy editor | Opus | COPY | 30 (4 / 18 / 8) | chromium |
| visual-start | Visual designer, start and session | Opus | VIS1 | 23 (6 / 12 / 5) | chromium, iphone (and an SE fold check) |
| visual-results | Visual designer, results, notes, self-test | Opus | VIS2 | 24 (5 / 11 / 8) | chromium, iphone |
| flow | Flow and IA reviewer | Opus | FLOW | 21 (4 / 13 / 4) | chromium, iphone |
| | **Total** | | | **219 (40 / 125 / 54)** | |

**Coverage.** Chromium at 320, 390, 768, 1024, 1280 and 1440 px; WebKit desktop; iPhone 13 (390 × 664), iPhone SE
(320 × 568), Pixel 7 (412 × 839) and iPhone landscape; light and dark; 200% text and a wide font; Fast 3G with a 4×
slower CPU; simulated colour-vision differences; A4 print with a light and a dark OS; simulated page translation.
Not covered: real phones, a real screen reader (announcements inferred from trees and a live-region log), Firefox,
Windows forced colours, Safari's default keyboard settings, the real iOS share sheet, and the online backend variant.
Verification 2 added desktop WebKit at 1280 px and the Pixel 7 project to the replay and the tour; the other gaps
stand (§4 lists what verification 2 did not cover).

**Re-running the harness** (details in [ux-review/README.md](ux-review/README.md)). Build the preview once, then run a
persona on a free 46xx port with a new run id (a run id that already exists is overwritten):

```
cd web
npm run ux:build
UX_PORT=4606 UX_RUN=phone-2 npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/phone.ux.ts --project=iphone
```

Projects: `chromium`, `webkit`, `iphone`, `iphone-se`, `pixel`. Check a new findings file with
`npx tsx ux-review/validate-findings.ts ux-review/findings/<reviewer>.json`. For the existing e2e specs beside other
workstreams, use the isolated config, which has its own build, output and ports:

```
cd web
E2E_PORT=4607 E2E_DEV_PORT=4608 HB_RUN=ux-check npx playwright test -c ux-review/playwright.iso.config.ts e2e/ux-session.spec.ts --project=chromium
```

Without `HB_DEV_SERVER=1` the isolated config starts no dev server and skips the three a11y routes that live on it
(`dev-visual-gallery`, `dev-review`, `dev-review-matrices`). Check them in a run that starts it, once per project:

```
cd web
HB_DEV_SERVER=1 E2E_PORT=4607 E2E_DEV_PORT=4608 HB_RUN=ux-check-dev npx playwright test -c ux-review/playwright.iso.config.ts e2e/a11y.spec.ts --project=chromium --grep dev-
```

Never run the default `npm run e2e` (or `npx playwright test` without `-c`) while other runs are going: it uses ports
4174 and 4175 and wipes `web/test-results/`, which holds the review evidence and the shared build.

**Where things live.** Findings, triage, fix notes, integration and verification JSON are committed in `web/ux-review/`.
Screenshots, page text, accessibility trees and `facts.json` files stay local in `web/test-results/ux-review/<run id>/`
(gitignored, never committed); the verifiers' after-screenshots are in `web/test-results/ux-review/verify/` (wave 1)
and `web/test-results/ux-review/verify2/` (wave 2, with `tour-compare.json`). Integration-2 logs are in
`web/test-results/iso/w2-int/`, final-integration logs in `web/test-results/iso/final-int/logs/`. For the decisions
round the handoffs, `integrate.json`, `verification.json` and `d3-context.json` are in `web/ux-review/uxdec/`; the
integration logs are in `web/test-results/iso/uxdec-integrate/logs/`, and verification 3's facts, screenshots and logs
in `web/test-results/ux-review/uxdec-verify/` (local, like the others).

## 7. Appendix

### A. Reviewers

**phone (Fable).** Two full touch sessions on iPhone 13 (181 answers each), screen-by-screen runs on iPhone SE and
Pixel 7, landscape, Fast 3G, and all 50 routes with 44 px target checks and axe. Thumb-sized controls and 16 px fields;
the big problem was mobile WebKit landing screens scrolled past their heading (UX-001), then controls below the fold.

**keyboard (Sonnet).** Tab-by-Tab probe of all 50 routes plus the notes and self-test pages (858 stops in Chromium,
870 in WebKit) and a whole keyboard-only session per engine. Strong basics; problems where a control disappears or a
key means two things (practice, "Keep going", reading Enter, Escape, "Stay and save") and the Tab cost per question (D21).

**screenreader (Fable).** Trees, titles, focus and a live-region log through a whole session and the results, all 50
routes, WebKit trees compared. Unusually good structure; gaps in what is heard: an unchanging title, silent practice
feedback, nameless timed-block focus targets, and visual-first parts that never point to Skip (D20).

**skimmer (Fable).** Funnel, exits, Back and refresh, double clicks and speed on Chromium and iPhone 13. Double clicks
never submitted twice; the main findings were the misleading results header, the session lost on refresh and no way
back to earlier results; the 2.4 s blank page on Fast 3G was deferred (UX-100).

**nonnative (Fable).** A B2 English reader on Chromium and iPhone 13: readability on 35 routes, decimal-comma and
digit-form entry probes, simulated page translation, a 200% wide-font tour. Frozen numbers under translation and the
decimal keypad were fixed (UX-022, UX-024); the entry grammar and the passages are owner decisions (D8, D11).

**data (Opus).** A geometry evaluator compared the drawn charts, card and exports with the numbers (Chromium, WebKit,
iPhone 13; one- and two-session, partial and synthetic profiles; colour-vision simulation). The drawing holds; the
problems were in meaning: off-scale estimates (UX-037), the facet model (D4), 0 SD (D3) and the overlap sentence (D2).

**sharer (Sonnet).** Save panel, leave guard, share card exports, results-talk helper, notes builder, a second device
and 17 bad-input cases on Chromium, WebKit and iPhone 13. Clean exports; the loop around the save file was the weak
spot (UX-010, UX-012a, UX-028), with a card unreadable at feed size (UX-038).

**copy (Opus).** An inventory of 1,569 user-facing strings ([copy-inventory.json](ux-review/findings/copy-inventory.json)),
a tour of all 50 routes and a full journey. Careful, plain copy with almost no A13 risk; findings were two benefit
claims, "SD" used for two things, internal words reaching people, the privacy placeholders (D1) and name drift (D25).

**visual-start (Opus).** Start and session screens at six widths in both schemes, iPhone 13, 200% text, fold checks on
iPhone SE and pixel-sampled contrast. Calm and sound; the serious problems were the coding block on phones, legends
cutting frames, matrix options at 0.70 scale (UX-020), the no-WebGL state, and drifting colour tokens (UX-106).

**visual-results (Opus).** Results, notes and self-test routes at six widths in both schemes, iPhone 13, 200% text,
dark-mode axe, colour-vision simulation, card downloads and A4 print PDFs. Broken print, an unreadable card thumbnail,
the self-test table on phones (UX-054) and chart text that ignored the text size (UX-044) were the main findings.

**flow (Opus).** A journey map of entry points, funnel, orientation, end sequence and edge paths (refresh, Back, two
tabs, every part skipped) on Chromium and iPhone 13. Funnel and reveal follow §10; the weak points were around them:
nothing for a returning person, an easily lost session, resting that costs time (D5), contradictory orientation copy.

**verify (Fable).** Replayed all 63 fixed items on Chromium and iPhone 13 (320 × 568 and 200% text where needed), toured
the 50 routes (Chromium 390 and 1280 px in both schemes, iPhone 390 px) and ran a whole session per project (218 and
157 answers). 60 verified, 3 partly, none regressed; three new findings (VER-01 to VER-03).

**verify2 (Fable).** Replayed the ten wave-2 checks from their fix notes on Chromium and iPhone 13, plus desktop WebKit
and Pixel 7 for the session and dev-merge items, at 320 × 568 and 200% text where the finding named them. Replayed the
20 major wave-1 items on desktop WebKit and Pixel 7 (30 entries, 28 ids in all). Toured the 51 routes on Chromium at
390 and 1280 px in both schemes, iPhone 13 at 390 px in both and WebKit at 1280 px light (357 states), and compared
them with the wave-1 tours: no new failure, overflow, clipped text, small target, serious axe issue or console error.
Ran one whole session per engine (135, 205 and 196 answers) through save, reload, file load and "See my results",
each ending in the same profile. 30 verified, none partly or regressed; one new finding (VER2-01).

**verify, decisions round** (verification 3; [verification.json](ux-review/uxdec/verification.json), model not
recorded). A fresh production build of the integrated working tree, on Chromium, desktop WebKit and iPhone 13, with
four new harness files (`ux-review/personas/uxdec-verify-shared`, `-owner`, `-defaults` and `-sweep.ux.ts`). Replayed
each decision the handoffs mark as applied, including two whole `?fast=1` sessions per engine for D5 (one without
skips, one skipping Spatial), and checked that D3, D14, D29, D30 and D31 did not change. Swept 281 routes in 706
states: the 53 product routes at 390 and 1280 px in both schemes on Chromium and WebKit and at 390 px on the iPhone,
the 10 preview dev routes, 17 layout routes at 320 px and at 200% text, and the RT self-test in each engine. No route
failed to open; no sideways overflow, clipped text, serious axe issue, rendered "TODO" or score wording. Tests
corrected after a first pass were harness mistakes, never product code, and were re-run. 25 verified, 1 partly
(D22), 5 unchanged as required; six new findings (UXDEC-VER-01 to UXDEC-VER-06, §4).

### B. Gate results at integration

**Wave 1.** From [integration.json](ux-review/integration.json). The build used its own output directory
(`npm run build -- --outDir test-results/iso/integrate/dist-gate`); `test:db` was not run because the only backend
change is one string (UX-056) whose DOM test `npm test` runs.

| Gate | Result |
| --- | --- |
| `npm run check` | pass: svelte-check 1,192 files, 0 errors, 0 warnings; tsc node and scripts configs (incl. `e2e/`, `ux-review/`) |
| `npm test` | 4,525 passed, 0 failed, 7 skipped |
| Language lint | pass: 358 files clean |
| `npm run build` | pass |
| UX harness smoke | pass: `npm run ux:build`, then `smoke.ux.ts` on Chromium, 3 of 3 tour routes opened |
| e2e chromium (shards 1, 2, 3) | passed 261 / 266 / 279, failed 0 / 5 / 4. Shard 2: trace files cleared by a run started on the same ports, rerun 45 passed. Shard 3: stale "Session complete" literals, fixed, rerun 61 passed. New a11y route `results-view`: 7 passed |
| e2e webkit (shards 1, 2, 3) | passed 264 / 264 / 273, failed 0 |
| e2e iphone (shards 1, 2, 3) | passed 262 / 182 / 272, failed 0 |

No flaky tests and nothing reverted. Diff at integration: 161 tracked files changed (+5,991 / −1,132) and 33 new
files; verification then added six verify persona specs and its two JSON files. Bank gates do not apply: no bank file
changed.

**Wave 2.** From [integration-2.json](ux-review/integration-2.json); logs in `web/test-results/iso/w2-int/`. The build
used its own output directory (`npx vite build --outDir test-results/iso/w2-int/dist-gate --emptyOutDir`).

| Gate | Result |
| --- | --- |
| `npm run check` | pass: svelte-check 1,194 files, 0 errors, 0 warnings; tsc node and scripts configs (incl. `e2e/`, `ux-review/`) |
| `npm test` | 4,618 passed, 0 failed, 7 skipped (260 files, 1 skipped), in a final run alone on a quiet machine. An earlier run beside two e2e shards (load average up to 188) had 13 timeouts in 11 files; those files re-run alone passed 238 of 238 |
| Language lint | pass: 359 files clean |
| `npm run build` | pass: entry 345.13 kB (120.43 kB gzip), results chunk 116.05 kB (41.11 kB gzip) |
| `test:db` | not run: nothing under `src/backend`, `scripts/db` or `supabase` changed in wave 2 |
| UX harness smoke | pass: `npm run ux:build`, then `smoke.ux.ts` on Chromium, 3 of 3 tour routes opened, journey completed |
| e2e chromium (shards 1, 2, 3) | passed 256 / 254 / 262, failed 6 / 1 / 1, 18 did not run after the shard-3 failure. Shard 1: the six dev-server a11y routes, refused before the harness fix and green in the dev-server run. Shard 2: `keyboard-session.spec.ts:470` under load, passed alone. Shard 3: `session-save.spec.ts:289` under load, the file re-run alone passed 19 of 19 |
| e2e webkit (shards 1, 2, 3) | passed 256 / 251 / 253, failed 6 / 1 / 1, 18 did not run in shard 3; the same three causes, each green on its re-run |
| e2e iphone (shards 1, 2, 3) | passed 255 / 173 / 252, failed 0 / 0 / 1, 18 did not run in shard 3; `session-save.spec.ts:289` under load, the file re-run alone passed 19 of 19 |
| e2e with the dev server (`HB_DEV_SERVER=1`) | chromium 54 passed, 2 failed (`gallery.spec.ts:128` and `render-visual.spec.ts:67` timed out under load; both specs re-run alone passed 35 of 35); webkit 21 passed; iphone 17 passed |

Shard totals: Chromium 772 passed, WebKit 760, iPhone 680; plus 92 in the dev-server runs. Every failure has its re-run in
integration-2.json (the load-related ones also under `flaky`); all came from machine load or the dev-server routes.
Nothing was reverted. Diff at integration 2 (wave 2 and integration together, before this document): 36 tracked files changed
(+1,305 / −180) and 12 new files; verification 2 then added six persona specs, `verify2-compare.ts` and its two JSON
files. Bank gates do not apply: no bank file changed.

**Final integration.** On the branch head (`e83cee4`, plus this document and the harness README). `dev` had no newer
commits (it is an ancestor of `wf10/ux`), so nothing was merged. Logs are in `web/test-results/iso/final-int/logs/`.
The e2e ran as one unsharded run per project with the dev server (`HB_DEV_SERVER=1`, 4 workers).

| Gate | Result |
| --- | --- |
| `npm run check` | pass: svelte-check 1,194 files, 0 errors, 0 warnings; tsc node and scripts configs |
| `npm test` | 4,618 passed, 0 failed, 7 skipped (260 files, 1 skipped) |
| Language lint | pass: 359 files clean |
| `npm run build` | pass: entry 345.13 kB (120.43 kB gzip), results chunk 116.05 kB (41.11 kB gzip) |
| `test:db` | not run: nothing under `src/backend`, `scripts/db` or `supabase` changed since integration 2 |
| UX harness smoke | pass: `npm run ux:build`, then `smoke.ux.ts` on Chromium, 3 of 3 tour routes opened, journey completed |
| e2e chromium | 818 passed, 12 failed, 18 did not run, 67 skipped (13.5 min). The failures came in groups that failed together on all workers, each in or just after a system sleep (power log: 121 s at 18:32, 81 s at 18:35, 145 s at 18:37); the 18 not run are serial tests after one of them. The six files re-run (`keyboard-session`, `server`, `session-save`, `session`, `ux-render`, `ux-session`): 119 passed, 0 failed, 12 skipped |
| e2e webkit | 824 passed, 4 failed, 87 skipped (15.6 min). The 4 (`a11y.spec.ts`, routes `item-matrix-series`, `confidence`, `confirm-skip`) failed together at 7.0 min, across a 422 s sleep at 18:40. Those routes re-run: 21 passed, 0 failed, 3 skipped |
| e2e iphone | 743 passed, 0 failed, 172 skipped (7.6 min) |

The review machine had its lid closed and went into maintenance sleep every few minutes despite the existing
idle-sleep assertion; a `caffeinate -s` assertion held for the rest of the run stopped it (no sleep after 18:48). The
test moved to the real timeline, `keyboard-session.spec.ts:470`, passed in the full run on Chromium (1.7 s) and WebKit
(2.2 s). Nothing was reverted. Branch against `dev` before that integration's update of this document: 267 files changed (+52,648 / −1,194),
104 of them new; most of the added lines are the review records in `web/ux-review/`. Bank gates do not apply: no bank
file changed in this workstream.

**Decisions round.** From [integrate.json](ux-review/uxdec/integrate.json) gates, on the head of `wf10/uxdec` in
both repos (pub on dev `9f68f49`, bank on `0d2a60e`), before this document's update; logs in
`web/test-results/iso/uxdec-integrate/logs/`. Both `dev` branches have since moved on (M6.2 to M6.4), so these are
the gates of this branch alone: after the lead's merge or rebase they need a re-run. integrate.json lists the files
both sides changed (pub `README.md`, `e2e/routes.ts`, `package.json`, `scripts/a11y-routes.test.ts`,
`src/viz/facets.ts`; bank `README.md`); the hunks look separate.

| Gate | Result |
| --- | --- |
| `npm run check` | pass (final run after the last edit): svelte-check 1,218 files, 0 errors, 0 warnings; tsc node and scripts configs clean, e2e specs included |
| `npm test` (alone) | 278 files passed, 1 skipped; 5,009 tests passed, 7 skipped, 0 failed (final run). The baseline before integration had two failing files: `scripts/contrast.test.ts` (real: the RT halo token, fixed) and `src/session/run-copy.test.ts` (deleted mid-run by the fold) |
| Language lint | pass: 367 files clean |
| `npm run build` | pass, with the static first-paint shell check |
| `test:db` | first run 566 of 567: the server did not read the decimal comma (real, fixed by migration `20261007000200`); two tests of the old grammar updated. Final run: 20 files, 567 tests passed |
| `test:slow` | pass: `scripts/sim-cat.slow.test.ts`, 6 passed, 1 skipped by its own condition (327 s); run because the D5 budgets changed. `sim/cat.ts` itself is unchanged (an owner question, §4) |
| Cross-repo sync, pub side | pass: 6 files, 60 tests, none skipped |
| Bank `uv run ruff check && uv run ruff format --check` | pass: 319 files already formatted |
| Bank `uv run pytest -q -n 8` | pass: 6,336 passed, 2 skipped (Ollama not running), 172 s; includes `tests/test_crossrepo.py` against this pub worktree |
| Cross-repo sync, bank side | pass: 177 passed, none skipped (golden copies, passages, topics, `quant_entry.json` parity, family dumps) |
| e2e chromium (isolated, dev server, 4 workers, all 36 spec files) | 1,067 tests: 973 passed, 93 skipped, 1 failed (8.9 min). The failure was the rewritten break test's time format (`'60:00'`, which Playwright refuses), fixed to `'01:00:00'`; the time-rule tests re-run on Chromium: 8 passed. The new routes `welcome-returning` and `ready-continue` pass every sweep |
| e2e webkit | 1,067 tests: 952 passed, 115 skipped, 0 failed (10.4 min); run after the fix |
| e2e iphone | 1,067 tests: 866 passed, 201 skipped, 0 failed (8.8 min) |

The skips are the specs' own project and dev-only conditions. Nothing was reverted. Verification 3 then ran its own
checks on a fresh build: language lint clean (367 files), `tsc -p tsconfig.scripts.json` clean, no retired overlap
sentence and no "TODO(" in the built assets, and its 29 replay and 9 sweep tests per project green.
