# HumanBench — Progress log and resume protocol

## How autonomous work continues

The user's Claude plan has a rolling 5-hour usage limit. Work continues across limits like this:

- **Hourly resume ticks** fire at minute :23.
  - The first window ran from 17:23 on 2026-09-26 to 09:23 on 2026-09-27.
  - The user renewed the ticks at about 19:50 on 2026-09-27, and they **now run until 06:23 on 2026-09-28, then stop**. They are two session-only CronCreate jobs: `23 20-23 27 9 *` and `23 0-6 28 9 *`.
  - A tick fires only while the session is idle.
  - If the limit is still active, the tick fails cheaply. The first tick after the reset picks the work back up.
  - Don't extend past 07:00 on 2026-09-28 without asking.
- If the session was closed, the user can run `cd ~/code/humanbench` then `claude --continue`, and type `resume`.

### Resume protocol (run on every tick or "resume")

1. If a HumanBench task or workflow from this conversation is still running, do nothing on this tick.
2. Check both repos (`~/code/humanbench`, `~/code/humanbench-bank`): run `git status` and make sure the branch is `dev`.
   - Uncommitted changes mean a run was interrupted.
   - Read the diff and run the tests, then either finish the task or commit it as `WIP(<task>)` with a note under "Log".
3. Read "Now" below, then find the first `[ ]` or `[~]` task in `docs/ROADMAP.md` that is not blocked on the user.
4. Run it as a Workflow: implement → run tests/build → adversarial review → fix.
   - Parallelise across independent tasks when possible.
   - To avoid write conflicts, give parallel agents separate repos, separate path-scoped directories, or `isolation: 'worktree'`.
5. When a task passes its acceptance criteria:
   - commit it (one commit per task, citing R-x.y);
   - tick it in ROADMAP and add a Log line here, committing this file with the task;
   - after each green batch, fast-forward `main` to `dev` and push both repos (the user OK'd this on 2026-09-26).
6. Continue with the next task until the backlog or the usage runs out. Never create paid or cloud resources without the user's OK. Add those to "Needs you".

## Now

- **In flight: wf9** (`wf_2839ddf7-e8e`). No time limit; it runs until done or the weekly usage limit is reached. Steps:
  - merge `wf8/m35b` and `wf8/m61`;
  - on `wf9/panel`: a verbatim G4 panel re-run of all 18 M3.5 batches. Solvers write their raw files themselves, and code (`hb panel verdict`) computes the verdicts;
  - on `wf9/repair`: finish the parked repair and the minor audit items;
  - final merge, then audit.

  ADR A24-sec, accepting both leaks, is already committed. Resume ticks run at :41.
- **If interrupted:** check `git branch --list 'wf9/*' 'wf8/*'`. The raw panel files live under `panels/m35-r3/` in `wt/panel`.

- **wf7 done; merged and pushed 2026-10-02** (stopped at 20:36 during its final repair pass).
  - Merged:
    - AI.7: the file's notes settings win on load.
    - AI.2: RC/VOC carry no topic tags.
    - M3.3: the three-model Claude G4 panel.
    - All of M2: M2.0 with a harness that needs no host shared memory, M2.1 with the rescore fix, M2.2, M2.3/M2.4, M2.5 and M2.7, all local.
    - M3.5: 972 draft items.
  - Gates: pub 4,144 unit tests, 544 DB tests and 1,888 e2e; bank 4,890 tests.
  - The unfinished pub repair is parked, unverified, on `wip/wf7-repair-pub`.
- **Open audit findings (next tasks):**
  - **HIGH (M2.1/M2.2):** the next item served by `submit`/`next_item` reveals whether the previous answer was right (adaptive difficulty), so a script can harvest keys. A mitigation is needed: delayed θ updates, randomisation, or not serving finite-bank items adaptively per response.
  - **MEDIUM (rescore):** a caller who knows 4 answers can infer the 5th.
  - **MEDIUM (M3.5):** the G4 records look normalised by the recorder agent, so the panel's independence can't be reproduced. Re-run the panel with raw solver outputs stored verbatim before any item moves past draft.
  - **Low:**
    - an M2.7 flaky timing test;
    - LR solution text refers to pre-shuffle option positions;
    - 2 UK items lack a region tag;
    - `toUploadPayload` must handle U+0000.
- **wf8 done, not merged:** `wf8/m35b` (bank: 119 Fermi items) and `wf8/m61` (both repos: M6.1 emotion vignettes, rule engine and UI). Both are committed and green in their worktrees; run the gates, then merge.

## Needs you (blocked on the user)

- [ ] **RT jitter self-test** (M1.23): the page is ready. Run `cd ~/code/humanbench/web`, then `npm run build`, then `npm run preview`, and open `rt-selftest.html` on a 120 Hz Mac (or use the live Pages URL once it is pushed). Pass means p95 < 5 ms.
- [ ] **G7 spot audits** (§4.4): the review page is ready. Run `cd ~/code/humanbench/web` then `npm run review`. It shows 30 instances per family (about 4 h in total), and you export the JSON when done. For M3, 60 items per finite batch.
- [ ] **Local Postgres** (M2.0): optionally `brew install postgresql@17`. Otherwise Claude uses a pip- or npm-bundled Postgres.
- [ ] **Supabase project** (M2.6): a free project, the region (us-east or eu-central), secrets, a Vault HMAC key, an age keypair for backups, and CAPTCHA keys.
- [ ] **Privacy notice**: the controller's name and contact, and sign-off on 24-month retention and consent as the legal basis, before any data-collecting deploy (M2).
- [ ] **Phase AI (your tasks):** AI.13, about 200 labels plus a think-aloud with about 10 people; AI.12c, a surface smoke test on each assistant; and the open questions in proposal §11 (bank `docs/proposals/ai-notes-v2.md`).
- [ ] **Run the DB tests outside the sandbox:** `cd ~/code/wt/m2/humanbench/web` then `npm run test:db`. If it fails there too, reboot and retry.
- [ ] **Brand**: keep "HumanBench", or use "HumanBench: Jagged" / "Jagged Mind" (§2.6)? Also the custom subdomain, the trademark check, and optionally the ICAR permission email and STEU-B permission email.
- [ ] Later: SJT expert ratings (M6.2), the RAT corpus license and Ocsai opt-in (M6), and the F9 anchor corpus of released test items.

## Log

- 2026-09-26 16:05: Autonomy set up with `dev` branches, CLAUDE.md, ROADMAP.md, PROGRESS.md and hourly resume ticks.
- 2026-09-26 16:25: **M0 done.** Pushed, Pages enabled, site live at http://michaelsinko.phd/humanbench/, CI green in both repos.
- 2026-09-26 17:35: **M1.1** (pub a325971, 93 tests) and **M1.2** (bank f36f6f9, 134 tests) done after adversarial review; all 26 review findings fixed. Pushed to main.
- 2026-09-26 17:50: A roadmap critic pass compared ROADMAP with DESIGN.md. It added ~36 missing tasks and decisions A7–A17, reordered the guardrails and M3.1 ahead of M2, and expanded "Needs you".
- 2026-09-26 17:58 to 20:12: **wf2** built M1.2b, M1.3, M1.4a, M1.F and 8 procedural families (M1.5–M1.12), each in its own worktree with an adversarial review. The usage limit interrupted it during the last review fixes.
- 2026-09-26 21:58 to 2026-09-27 00:00: **wf2b** finished the fixes and merged `wf2/*` into `dev`. Its 4-lens audit found 29 issues. The repair agent then died on the 3-minute stall watchdog, because the serial bank pytest takes 5.5 min.
- 2026-09-27 19:43 to 21:10: **wf2c** made these repairs:
  - `family_id` is now shared across repos (cyrb128 port), and Python twins carry `+py` versions.
  - pytest-xdist brings the bank suite to about 60 s.
  - quant is registered, and one numeric-key shape is shared with series.
  - A17 sync checks now exist in both repos.
  - A repo-wide timing lint was added. Verifier-only reading data is kept out of the app bundle. The SPA model kind is now per item, and ScoreResult was renamed to ItemScore.
  - RT parity fixtures moved out of the production keys.
  - 3 reading questions were rewritten.
  - The verifier found no regressions. Gates: pub 1119 tests, bank 1304 tests, with 0 cross-check disagreements.
  - Ticked M1.2b–M1.11. M1.12 and M1.P are partial. M1.F2 was added for the deferred contract gaps.
- 2026-09-27 21:15: Pushed `dev` to `main` in both repos. Pub CI and Pages are green. Bank CI had been red since M1.2 because Rich forces ANSI colour on GitHub Actions; this is fixed in 2bca38c.
- 2026-09-28 02:30: **wf3 done** (30 agents; it paused once at the usage limit and resumed by itself).
  - Tasks: M1.F2, M1.P, M1.12 A14 closure (round-3 solves recorded), M1.20, M1.A, M1.14, M1.17, M1.19, M3.1, M4.1 and M4.2.
  - Merge decision: quant sibling groups are the selector's near-isomorph sets (`g:quant:<label>`, quant 1.3.0).
  - The audit found 15 issues; the repair fixed the major one (the §12 records now carry `sibling_group`), plus the save merge, timestamps, `resolveItem()` and the integrity report.
  - Added ADR A18.
  - Gates: pub 1,482 unit tests plus 18 e2e (chromium, webkit, iPhone); bank 1,828 tests.
  - Known flaky test: the scorer's 3PL property test has hypothesis cases with two posterior modes. It was made tolerant (it asserts some local mode). Whether MAP should search for the global mode is open (it needs new golden vectors).
- 2026-09-28 07:20: **wf4 done** (25 agents; it paused once at the usage limit and resumed by itself).
  - Tasks: M1.13 (9 renderers), the G7 review page (Claude's half), M1.16 blob, M1.23 self-test page, M1.Q, M1.4b (criterion (b) open), M3.2, and M4.3–M4.5.
  - The audit found 8 issues; the repair fixed all 7 actionable ones: the M1.4b parity framing, the M4.5 metric (A19), the §9.3 fuzz, a WebKit ResizeObserver error, focus at the end of blocks, the G7 export format, and the random lint in render/ and viz/.
  - Gates: pub 1,927 unit tests plus 168 e2e; bank about 2,260 tests.

