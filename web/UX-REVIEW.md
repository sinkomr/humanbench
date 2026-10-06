# UX review of the static app

Fresh-eyes product review of the public static MVP in `web/`, then fixes, integration and independent verification.
Workstream `ux` of wf10, branch `wf10/ux`: wave 1 on 2026-10-05 (review, fixes, verification; commit `ab80f33`) and
wave 2 on 2026-10-05 (merge of dev `5469d40`, the partly fixed items, faster first paint, a second verification;
commit `642f440`), then a final integration (one e2e test moved to the real timeline, `e83cee4`; this document's last
update and every gate on the branch head, appendix B). Nothing here is merged into `dev` or `main`; the lead merges.

Source records (all in `web/ux-review/`): [findings](ux-review/findings/) (one JSON per reviewer),
[triage.json](ux-review/triage.json), [fixes](ux-review/fixes/) (one JSON per fix package),
[integration.json](ux-review/integration.json), [verification.json](ux-review/verification.json) and
[verify-regressions.json](ux-review/findings/verify-regressions.json); for wave 2 the `w2-*` notes in
[fixes](ux-review/fixes/) ([w2-sync](ux-review/fixes/w2-sync.json), [w2-session](ux-review/fixes/w2-session.json),
[w2-render](ux-review/fixes/w2-render.json), [w2-perf](ux-review/fixes/w2-perf.json)),
[integration-2.json](ux-review/integration-2.json), [verification-2.json](ux-review/verification-2.json) and
[verify2-regressions.json](ux-review/findings/verify2-regressions.json). Every count below is taken from them.
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
20 deferred.

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
UX-085), VER-03 and one open point from integration. D29 to D31 are new questions from wave 2 (at the end). Nothing
was changed for any of them. "Recommended" is the triage's or the verifier's advice; screenshots under the reviewers'
run ids show the build before the fixes, and those under `verify2/` show the wave-2 build. Wave 2 changed none of
the facts below except where a line says "wave 2".

### Before any public link

- **D1. UX-061 (major): the privacy notice shows "TODO(user)" placeholders.** What controller name and contact should the notice show, and what should the static MVP say until the online terms exist?
  - Options: A. supply the real controller and a contact address now. B. interim wording ("This site is a hobby project. The name of the person responsible and a contact address will be added here before any version that collects data.") and drop the draft-terms placeholder. C. "Questions: open an issue at <repo URL>" as the contact.
  - Recommended: A if possible, otherwise B before any public link; either way add a copy test that fails on "TODO" in any rendered string.
  - Evidence: COPY-04, VIS1-06; `web/test-results/ux-review/copy/tour/privacy/1280-light.png`. Touches: §13, ROADMAP M1.15 (TODO(user)); `session/copy.ts` PRIVACY_SECTIONS, TERMS_VERSION if the substance changes; the pinned literals in `e2e/session.spec.ts` and four unit tests.
- **D2. UX-071 (major): "Ranges that overlap are not real differences" is statistically wrong.** Replace the sentence in all three places (share card, the reveal's no-peaks note, the gated results-talk preamble)? Overlapping 90% intervals do not imply no difference, and the card names a peak whose range overlaps every other one. The fixed card still carries the sentence.
  - Options: A. "Where ranges overlap, a difference may not be real." (card and preamble) and "No skill stands out clearly from your others yet. That is common after one session: the ranges are still wide." (no-peaks note). B. Card and reveal only, keep the gated preamble. C. No change.
  - Recommended: A, as one gated change (DESIGN §17 table row and the gate pin together).
  - Evidence: DATA-04; `web/test-results/ux-review/data/results1-chromium/export-light-humanbench-card-2026-10-03.png`. Touches: §9.9, §17, A12, A20, A22; `viz/card-copy.ts`, `reveal/copy.ts`, `brief/results-talk.ts` and its pin.
- **D3. UX-070 (major): say what "0 SD" stands for; check the RT norm width.** Every verdict ("Above / Below / Overlaps 0 SD"), the muting and the peaks depend on 0 SD, and nothing says what it is. Under s = 0.15 a median simple RT of about 470 ms is −3 SD, common on touch screens.
  - Options: A. a two-sentence addition to RING_CAPTION and BARS_NOTE ("0 SD marks where we expect a typical adult to land… so the scale is provisional and may shift."). B. shorter: "0 SD is a provisional reference point, set from question difficulty and published figures, not from other takers." C. no change until M4 norms.
  - Recommended: B now; separately review the RT prior width against web RT data.
  - Evidence: DATA-03, DATA-01; `web/test-results/ux-review/data/results1-chromium/002-chart-light.png`. Touches: §7.3, §9.1, A12 (withholds "typical HumanBench taker"), A10; `viz/copy.ts`; the RT prior `tasks/rt/prior.ts` is bank-mirrored and needs the bank too.

### Measurement and scoring

- **D4. UX-072 (major): the facet model counts an axis's items twice; Quantitative has 18 one-template facets.** How should facet estimates be computed and grouped? Spatial's only facet flips from "Overlaps 0 SD" to "Below 0 SD", and every facet is narrower than its axis (14 of 14).
  - Options: A. leave-facet-out prior, and Quantitative facets = the six QUANT_GROUPS topics. B. interim: hide the facet estimate when an axis has one facet and caption "Facet ranges are provisional and somewhat too narrow." C. no change.
  - Recommended: A (amend A12); B as a stop-gap if A has to wait. The empty-panel display is already fixed (UX-041).
  - Evidence: DATA-02, DATA-14; `web/test-results/ux-review/data/results1-chromium/015-drill-spatial-memory.png`, `web/test-results/ux-review/data/journey-chromium/011-drill-quantitative.png`. Touches: A12, §9.6, §7.1, A7; `viz/facets.ts`, `tasks/quant/topics.ts`.
- **D5. UX-066 (major): session clock and part budgets.** Should the clock run on "Up next" screens, when is the break offered, and should skipping a part shorten the session? Today waiting on an interstitial uses session time, the break comes after 30 active minutes of a 28-minute target, and after a skip Quantitative grew to "About 14 min".
  - Options: A. pause the clock on interstitials ("the clock waits until you press Start") and offer the break at the interstitial nearest half-way. B. keep the clock running but cap each part at its planned share. C. A and B.
  - Recommended: C. The misleading "Almost there" copy is already fixed (UX-008).
  - Evidence: FLOW-03, FLOW-16; `web/test-results/ux-review/flow/break-chromium/001-interstitial-up-next-reaction-time.png`, `web/test-results/ux-review/flow/session-chromium/014-quantitative-reasoning-interstitial.png`. Touches: §10 (break at 30 min, 6–10 min blocks), §7.4, A15; `session/run.ts`, `clock.ts`, ProgressRing.
- **D6. UX-064 (major): resume an interrupted session after a refresh or crash.** Should an unfinished session (say under 24 h old) be resumable? Today a refresh lands on the welcome and the interrupted run comes back as "1 earlier session", practice-adjusted against the new one.
  - Options: A. true resume (same session id, elapsed time, next item). B. a new session marked as a continuation (finished parts skipped, no practice adjustment against it). C. no; keep the clearer Ready line of UX-012a.
  - Recommended: B for M1, A later. The leave guard and the clearer Ready line are already in (UX-011, UX-012a).
  - Evidence: SKIM-01, FLOW-02, SKIM-13; `web/test-results/ux-review/skimmer/back-chromium-refresh/002-after-refresh.png`. Touches: §8 ("crash recovery"), §7.8, R-8.1, §10; `SessionApp`, `run.ts`, `persist.ts`.
- **D7. UX-063 (minor): does an untouched confidence slider count as a rating?** Enter, Enter or a double click records the start value without the slider being used, so a skimmer's calibration record reads "50, 50, 50".
  - Options: A. require a touch (Continue enabled only after a move; quick buttons for keyboard users). B. keep the default but record `touched=false` and leave untouched ratings out of calibration (save and scoring change). C. no change; document the default as an answer.
  - Recommended: B; A if the save format must not change. Decide the slider step size (UX-111, deferred) at the same time. The held-Enter part is fixed (UX-014).
  - Evidence: KBD-13, SKIM-11; `web/test-results/ux-review/skimmer/double-chromium/004-after-continue-twice.png`. Touches: §3 row 12, §7, A15, §8 if B.
- **D8. UX-079 (minor): number-entry grammar.** "3,5" is rejected while "1,500" is silently read as 1500 (a decimal-comma typist meant 1.5); quant hints say "integer" where series hints say "whole number".
  - Options: A. read one comma followed by one or two digits as a decimal comma; reject "d,ddd" with "Write thousands without a comma (1500) and decimals with a point (1.5)."; hints say "whole number". B. hint wording only. C. no change.
  - Recommended: A, as one pub and bank change. The UI side (keypad, digit forms, the 3.5 check) is fixed (UX-024).
  - Evidence: L2-03, L2-04, L2-06, COPY-13; `web/test-results/ux-review/nonnative/entry-quant-chromium/002-quant-item-1-entry-1-rejected.png`. Touches: §4.2, A1, A14, A18; `tasks/quant/numeric.ts` and `templates.ts` with their bank twins.
- **D9. VER-03 (minor, new): one-row coding keypad keys are 30–38 px wide on phones.** UX-002 put the nine coding keys in one row so table, target and keypad fit one phone screen (they do). The keys are now 38 × 50 px at 390 px and 30 × 50 px at 320 px, where the old three-row keypad had 44 px keys, in the one block that rewards fast tapping.
  - Options: A. two rows of five and four when keys would be under about 40 px (container query); the screen budget still fits. B. 44 px keys with the gap removed at 320 px. C. keep one row.
  - Recommended (verifier): A.
  - Evidence: VER-03; `web/test-results/ux-review/verify/UX-002/iphone/005-320x568-coding-start-viewport.png`. Still valid after wave 2 (the keypad did not change); verification 2 measured the same on the Pixel 7 project, 40 px keys at 412 px and 30 px at 320 px (`web/test-results/ux-review/verify2/UX-002/pixel/005-320x568-coding-start-viewport.png`). Touches: WCAG 2.5.8; `render/common/Keypad.svelte`, `render/coding/CodingRenderer.svelte`; a timing re-check is wise for any change to a timed block (§11.6).
- **D10. UX-081 (minor): is scratch paper allowed in the Quantitative part?** The honour code forbids calculators "except where provided" but says nothing about paper; a mid-session blurb says "Keep paper and a calculator out of reach".
  - Options: A. allowed ("Paper is fine; keep calculators out of reach."). B. not allowed (a line under the honour sentence).
  - Recommended: whichever matches how the items were difficulty-seeded; state it once, up front.
  - Evidence: COPY-21; `web/test-results/ux-review/copy/journey/021-quantitative-reasoning-interstitial.png`. Touches: §13 (the honour sentence is fixed word for word); `session/segments.ts`.
- **D11. UX-082 (minor): reading passages and first-language norms.** A passage can be one 363-word paragraph (1,280 px on a phone) of 19th-century prose, and the results compare reading speed with first-language figures without saying so.
  - Options: A. split passages at about 120 words and prefer modern plain non-fiction in the bank. B. add "The comparison figures are for people reading in their first language." to the reading line. C. both.
  - Recommended: C (B is a one-line reveal change once approved).
  - Evidence: PHONE-13, L2-12; `web/test-results/ux-review/phone/reading-iphone/002-passage.png`. Touches: A1, A14, §3, §4.2; bank passage selection; `reveal/copy.ts`.
- **D12. UX-084 (polish): the RT fixation cross sits above the target box.** Move the "+" into the target area? Gaze has to drop about 128 px to the target, and the row costs 3.25rem on phones.
  - Options: A. draw the "+" centred in the pad and remove the separate row. B. no change (continuity with collected data).
  - Recommended: A before norms are collected, B once data exists; a self-test pass either way.
  - Evidence: VIS1-23; `web/test-results/ux-review/visual-start/details-motion-chromium/003-rt-trial-motion-2.png`. Touches: §11.6, §3; `render/rt/RtRenderer.svelte`.

### Results display

- **D13. UX-073 (minor): not-measured spokes dip to the centre, where −3 SD is drawn.** With 10 of 17 spokes unmeasured in every static profile the shape reads as seven petals around deep lows, and on a 390 px phone the stub labels leave the plot about 42% of the chart width.
  - Options: A. break the curve and band at an unmeasured spoke (a gap with a small × at the 0 SD ring). B. on narrow screens with five or more unmeasured spokes, short labels or none, and a "Not measured: …" list under the chart. C. draw only the offered skills in the static build.
  - Recommended: A and B (amend §9.7); C breaks the fixed 17-spoke order that §9.5(b) relies on.
  - Evidence: DATA-08, PHONE-08, VIS2-23; `web/test-results/ux-review/phone/blob-iphone/001-blob.png`. Touches: §9.7, §9.5, A12, A15; `viz/blob.ts`, `BlobChart.svelte`.
- **D14. Integration note: blob label floor of 9.5 px at 320 px.** The viz package lowered the minimum blob label size at 320 px from 10 to 9.5 px in `e2e/blob.spec.ts`, because the UX-042 compact names are longer. Accept it?
  - Options: A. accept (the bar view and the table carry the same names). B. restore 10 px by shortening names further or by D13 option B.
  - Recommended: none given; integration flagged it for an owner view. Deciding D13 first settles most of it.
  - Evidence: `ux-review/integration.json` open_issues; `web/test-results/ux-review/verify/viz-phone/iphone/001-blob.png`. Touches: §9 (legibility), UX-042, UX-044.
- **D15. UX-074 (minor): share card content.** The only strongly coloured spoke on the card can be a credible low while the named peak is grey; the card has no web address; on iPhone "Download image (PNG)" is primary and "Share image" third.
  - Options: A. draw credible lows muted on the card and mark the named peaks. B. add the site address and pass `url` to `navigator.share`. C. make "Share image" primary where file sharing works, downloads under "Save a copy".
  - Recommended: A and C; B once the final domain is chosen. Legibility and the key are fixed (UX-038).
  - Evidence: VIS2-13, DATA-05, SHARE-11, SHARE-13, VIS2-21, SHARE-15; `web/test-results/ux-review/sharer/card-chromium/card-light.png`. Touches: §9.5, §9.9, R-5.6.4, A12; `viz/card.ts`, `reveal/ShareCard.svelte`.
- **D16. UX-075 (minor): results page order and top.** May the results deviate from today's layout? On a phone the first screen is all text, the h1 and the reveal use two left edges, and the save panel is 2–3 screens down.
  - Options: A. keep the §10 order; compact the top (one-line practice note, small Replay, hidden live "Your profile is ready."), one 52rem column, chart up to 48rem on wide screens. B. A, and move the save panel directly under the chart (amends §10). C. nothing beyond UX-029.
  - Recommended: A; B only if later data show unsaved exits.
  - Evidence: SKIM-08, VIS2-16, PHONE-07, SKIM-09, FLOW-12; `web/test-results/ux-review/phone/results-iphone/003-results-viewport.png`. Touches: §10 (reveal order), §7.8, §9.
- **D17. UX-077 (minor): notes settings missing from the results-page save.** The save downloaded on the results page leaves out notes settings kept on this device; a second device then reports "That save has no notes settings."
  - Options: A. include them (read at click time). B. explain on the notes page that its save is a different file. C. both.
  - Recommended: A (one file per person).
  - Evidence: SHARE-21; `web/test-results/ux-review/sharer/notes-chromium-device2/001-load-settings-result-results-save.png`. Touches: R-17.12, §8; `reveal/SavePanel.svelte`, `save/brief-prefs.ts`.
- **D18. UX-078 (minor, gated): the results-talk helper says "Paste this first." and never what comes next.**
  - Options: A. add "Then describe your results in your own words, or attach your share card picture." B. no change.
  - Recommended: A, through the gate process.
  - Evidence: SHARE-18; `web/test-results/ux-review/sharer/talk-chromium/001-ai-card.png`. Touches: A20, A22, R-17.13; `brief/results-talk.ts` and its pin.
- **D19. UX-076 (polish): save and card file names.** The save is dated in UTC and the card locally (an evening save in the Americas is dated tomorrow); two saves on one day, and the light and dark cards, get identical names.
  - Options: A. local date for both; card "humanbench-card-light-<date>.png" and "-dark-". B. A plus a session count in the save name. C. keep UTC and say so in the save panel.
  - Recommended: A.
  - Evidence: PHONE-10, SHARE-17; `web/test-results/ux-review/sharer/card-chromium/002-card-panel.png`. Touches: §8 (file name pattern); `save/io.ts`, `viz/export.ts`.

### Flow and access

- **D20. UX-069 (minor): tell screen-reader users which parts need sight.** Reaction Time works only through announcements and Spatial offers four options with identical text alternatives; neither says that Skip is the intended path.
  - Options: A. one sentence in the RT intro and the Spatial interstitial ("This part needs you to see the screen. If you use a screen reader or cannot see the figures, choose Skip: it will show as not measured."). B. A, and record an "assistive" input type for RT. C. no change.
  - Recommended: A now, B later with the norming work.
  - Evidence: SR-04, SR-05; `web/test-results/ux-review/screenreader/audit/item-spatial/001-item-spatial.png`. Touches: §13, §11.6, WCAG 1.1.1.
- **D21. UX-068 (minor): per-question focus target.** Every new question re-focuses the same h1; for keyboard users that is 96 of 165 Tabs in a session, and a screen-reader user hears an identical heading about 60 times.
  - Options: A. keep the h1. B. h1 on the first question of a part, then the labelled item region. C. keep the h1 and announce "Next question." from the status line.
  - Recommended: B; C is the minimal alternative.
  - Evidence: KBD-12, SR-06; `web/test-results/ux-review/screenreader/journey/009-matrix-series-choice.png`. Touches: §13, WCAG 2.4.3 and 4.1.3, ROADMAP M1.15; `session/Screen.svelte`.
- **D22. UX-065 (minor): what the welcome screen adds.** The welcome does not say what 30 minutes buy (a shape with ranges, no single score, a file you keep), what is needed, or what it is not; a returning visitor gets no door to results or notes; default Safari cannot Tab to Start.
  - Options: A. a "What you get / what you need" block plus, when saves or kept notes exist, "See my results" and "Notes for your AI". B. only the returning-visitor row. C. A and an About page; optionally a Safari keyboard hint.
  - Recommended: B now (it reuses UX-010), A when the copy is approved; the Safari hint only if keyboard users ask.
  - Evidence: FLOW-09, SKIM-03, KBD-17, FLOW-10; `web/test-results/ux-review/skimmer/back-chromium-return/001-welcome-returning.png`. Touches: §10, §13, A13, D1.
- **D23. UX-067 (minor): fold the start funnel.** Seven presses, five screens and 1.8 s of mechanics before Begin; the honour screen is one sentence and a checkbox; the device check waits 1.3 s.
  - Options: A. one "Before you start" screen with both checkboxes (the §13 honour sentence word for word). B. start the refresh-rate measurement while the gate is shown. C. both.
  - Recommended: B now; A only if merging consent and honour is acceptable.
  - Evidence: SKIM-07; `web/test-results/ux-review/skimmer/funnel-chromium/003-honour.png`. Touches: §13, R-7.4, §10.
- **D24. UX-062 (minor): under-18 block has no way back from a mis-tap.**
  - Options: A. a quiet "I chose this by mistake" link back to the gate with the box unticked. B. move "I am under 18" away from Continue. C. no change.
  - Recommended: A (it stores nothing either way, so it does not weaken the block).
  - Evidence: KBD-15, FLOW-20; `web/test-results/ux-review/flow/funnel-chromium/004-under-18.png`. Touches: §13; `session/ConsentGate.svelte`.

### Words and look

- **D25. UX-060 (minor): one form for part and skill names.** "Reaction time" (h1) sits beside "Skip Reaction Time"; "Calibration/Metacognition" is on every session screen and "Analytical/Logic Games" in the table. Reviewers disagree on the direction.
  - Options: A. Title Case everywhere (the §3 names). B. sentence case everywhere. C. keep titles, give the two jargon axes plain display names ("Confidence calibration", "Logic games").
  - Recommended: A plus C's display names, done at integration because the e2e drivers match part titles.
  - Evidence: SR-11, COPY-05, VIS1-12, FLOW-05, COPY-19, L2-10, VIS1-11; `web/test-results/ux-review/copy/evidence/interstitial-reaction-time-casing/001-interstitial-reaction-time-casing.png`. Touches: §3, §10, A7, house style.
- **D26. UX-080 (minor): brand voice and self-description lines.** Tagline "A jagged profile of how you think…" (figurative, describes the person), meta "jagged-blob cognitive profile", "Ready when you are", "Your blob is only meaningful…" three screens before any blob, "skip any part you cannot do".
  - Options: A. new tagline, meta and intro wording, and a lead-in to the honour sentence. B. A plus plainer headings. C. no change; document the register split in the house style.
  - Recommended: A, and document the register split.
  - Evidence: L2-09, COPY-15, COPY-30; `web/test-results/ux-review/copy/tour/welcome/1280-light.png`. Touches: §13, A13, R-5.6.1.
- **D27. UX-083 (polish): one primary action per screen.**
  - Options: A. focus-session start secondary; Skip and Finish panels make "Keep going" primary; results-talk copy button secondary. B. only the focus-session start. C. no change.
  - Recommended: A. The leave panel (UX-005b) and the after-save download (UX-030) are already done.
  - Evidence: VIS1-21, VIS2-19; `web/test-results/ux-review/visual-start/tour-chromium/confirm-finish/390-dark.png`. Touches: §10.
- **D28. UX-085 (polish): Spatial stem "rotated? (Not mirror-imaged.)"**
  - Options: A. "Which option shows the same object as the target, rotated? A mirror image does not count." B. no change.
  - Recommended: A.
  - Evidence: L2-07, COPY-11; `web/test-results/ux-review/nonnative/tour/item-spatial/1280-light.png`. Touches: §12 (example item), §14.6, §4.2; `render/rotation/copy.ts`.

### New in wave 2

- **D29. VER2-01 (minor, new): the option-card focus ring leaves the card on arrow keys in desktop Safari.** Tab into an option group draws the 3 px orange ring on the first card. The first arrow key moves the focus and the choice to the next card, and in desktop WebKit the ring is gone, because WebKit stops matching `:focus-visible` there. Only the 2 px chosen ring then shows where the focus is. Chromium keeps the ring; Shift+Tab away and back brings it back in both.
  - Options: A. accept the chosen ring as the indicator while arrowing (the arrows choose as they move, so focus and choice are on the same card) and note it. B. also draw the ring on a checked card that has the focus (`input:focus:checked + .card`), accepting that Chromium then rings an option a mouse just clicked.
  - Recommended (verifier): none; the verifier offers both for an owner view.
  - Evidence: VER2-01; `web/test-results/ux-review/verify2/UX-021-focus/webkit/002-b-arrow-right.png` (Chromium for comparison: `web/test-results/ux-review/verify2/UX-021-focus/chromium/002-b-arrow-right.png`). Touches: WCAG 2.4.7, UX-021; `render/choice/OptionGroup.svelte`.
- **D30. Integration-2 note: an RT block keeps running while a "Skip" or "Finish now?" panel is open.** Practice or counted trials pass unanswered while the person reads the panel. Pausing the block would change the RT procedure, so nothing was changed in the product. The same behaviour made `e2e/keyboard-session.spec.ts:470` fail under machine load; the final integration runs that test on the real timeline instead of `?fast=1`, so it no longer depends on this decision (§4).
  - Options: A. pause the block while a panel is open and go on from the current trial after "Keep going". B. keep it running (the test side is done).
  - Recommended: none given; integration and the dev-merge package both flagged it as a product decision. A self-test pass is wise for A (§11.6).
  - Evidence: `ux-review/integration-2.json` open_issues and flaky; `ux-review/fixes/w2-sync.json` open_issues. Touches: §11.6, §10, UX-005a; `render/rt/RtRenderer.svelte`, `session/SessionScreen.svelte`.
- **D31. Integration-2 note: with a file loaded, a different pasted code is ignored without a word.** The ready screen uses the chosen file first and a code only when there is no file or the file is not a save. So pressing Load after pasting a different code does nothing and says nothing.
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

## 4. Still open

Closed in wave 2 and removed from this section: UX-007a with VER-01, UX-017a, UX-023, VER-02, UX-012a's deviation, and
three loose ends of wave-1 integration (the pasted-text wording, `PracticeRun.end()`, the option cards' print border).

**Caveats, deviations and findings caused by a fix:**

| Id | Sev. | What is left | Suggested next step | Suggested priority |
| --- | --- | --- | --- | --- |
| VER-03 | minor | One-row coding keypad, keys 30–38 px wide (40 px on a 412 px Pixel). | Owner decision D9. | P1 |
| VER2-01 | minor | New in verification 2: in desktop WebKit the option-card focus ring leaves the card as soon as an arrow key moves the focus; only the chosen ring shows where the focus is. | Owner decision D29. | P2 |
| UX-003 | major | Verified with a caveat: at 320 px the header is 100 px (acceptance about 96 px), 148 px on a screen with a notice. Verification 2 found the same on desktop WebKit. | Accept, or trim the ring at 320 px. | P3 |
| UX-042 | minor | Two deliberate deviations: Processing & Reading Speed is labelled "Processing" (not "Reading speed"), and stacked labels keep a 0.2 em gap, both to hold the phone legibility floors. | Revisit with D13 and D14. | P3 |
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
  (D2, D10, D18, D26, D28).
- **No save format or bank change** in either wave: §8 and `schema/` unchanged; no bank-mirrored file touched; the bank
  worktree is clean. Wave 2 changed the wording of save-load errors only; every error code is the same.
- **Kept pending a decision:** the h1 focus per question (D21), the firm under-18 block (D24), dips at unmeasured
  spokes (D13), the §10 reveal order (D16).
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
`web/test-results/iso/w2-int/`, final-integration logs in `web/test-results/iso/final-int/logs/`.

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
(2.2 s). Nothing was reverted. Branch against `dev` before this last update of the document: 267 files changed (+52,648 / −1,194),
104 of them new; most of the added lines are the review records in `web/ux-review/`. Bank gates do not apply: no bank
file changed in this workstream.
