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

- **wf2b** (`wf_598bf613-59c`) finished its fixes and merged `wf2/*` into `dev` in both repos. Quant was merged later, and is **not yet registered**. The 4-lens audit ran; its findings are in the scratchpad file `wf2/audit_findings.json`. The repair step then failed: the stall watchdog kills an agent after 3 minutes with no progress, and the serial bank pytest run takes about 5.5 minutes.
- **In flight: wf2c** (`wf_47425241-a4c`, started 2026-09-27 19:43). It runs in order:
  - **base:** on bank `dev`, finish the id-scheme work (shared cyrb128 `family_id`, Python twin versions tagged `+py`) and add pytest-xdist.
  - **4 scoped repairs**, each in its own worktree on branch `wf2c/<name>`: `quantreg`, `infra`, `rules`, `rtfix`.
  - **reading:** re-solve the A14 questions with 2 independent solvers, then fix them on `wf2c/reading2`.
  - **merger:** merge into `dev`.
  - **verifier.**
- **If interrupted:** check `git branch --list 'wf2c/*'` and `git worktree list`. Merge the green branches into `dev` in this order: quantreg, rtfix, infra, rules, reading2. Regenerate the dumps, then run the gates. For the bank, use `uv run pytest -q -n 8`.
- Deferred to new ROADMAP tasks (M1.F2 contract v2 and M1.P):
  - the block-observation API and block-aware property suite;
  - per-item facets;
  - a numeric-aware KeyEchoTracker;
  - re-centring the prior anchors, and FER/CAL provisional models;
  - realistic block parameters for M1.4a;
  - quant sibling-variant exclusion (M1.14);
  - the contract fields that renderers and the selector need.

## Needs you (blocked on the user)

- [ ] **RT jitter self-test** (M1.23): run the self-test page on a 120 Hz Mac once it exists.
- [ ] **G7 spot audits** (§4.4): 30 instances per procedural family (about 8 families, ~4 h total) once the review page exists. For M3, 60 items per finite batch.
- [ ] **Ollama** (G4, M3): run `brew install ollama` and pull two models from different families that fit 16 GB, e.g. a Qwen ~14B and a Gemma ~9B. Claude-authored finite items stay out of `live` until these run (A6).
- [ ] **Local Postgres** (M2.0): optionally `brew install postgresql@17`. Otherwise Claude uses a pip- or npm-bundled Postgres.
- [ ] **Supabase project** (M2.6): a free project, the region (us-east or eu-central), secrets, a Vault HMAC key, an age keypair for backups, and CAPTCHA keys.
- [ ] **Privacy notice**: the controller's name and contact, and sign-off on 24-month retention and consent as the legal basis, before any data-collecting deploy (M2).
- [ ] **Brand**: keep "HumanBench", or use "HumanBench: Jagged" / "Jagged Mind" (§2.6)? Also the custom subdomain, the trademark check, and optionally the ICAR permission email and STEU-B permission email.
- [ ] Later: SJT expert ratings (M6.2), the RAT corpus license and Ocsai opt-in (M6), and the F9 anchor corpus of released test items.

## Log

- 2026-09-26 16:05: Autonomy set up with `dev` branches, CLAUDE.md, ROADMAP.md, PROGRESS.md and hourly resume ticks.
- 2026-09-26 16:25: **M0 done.** Pushed, Pages enabled, site live at http://michaelsinko.phd/humanbench/, CI green in both repos.
- 2026-09-26 17:35: **M1.1** (pub a325971, 93 tests) and **M1.2** (bank f36f6f9, 134 tests) done after adversarial review; all 26 review findings fixed. Pushed to main.
- 2026-09-26 17:50: A roadmap critic pass compared ROADMAP with DESIGN.md. It added ~36 missing tasks and decisions A7–A17, reordered the guardrails and M3.1 ahead of M2, and expanded "Needs you".
