# HumanBench — Progress log and resume protocol

## How autonomous work continues

The user's Claude plan has a rolling 5-hour usage limit. Work continues across limits like this:

- **Hourly resume ticks** fire at minute :23, **from 17:23 on 2026-09-26 through 09:23 on 2026-09-27, then stop**, as the user asked. They are two session-only CronCreate jobs: `23 17-23 26 9 *` and `23 0-9 27 9 *`.
  - A tick fires only while the session is idle.
  - If the limit is still active, the tick fails cheaply. The first tick after the reset picks the work back up.
  - Don't extend past 10:00 on 2026-09-27 without asking.
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

- **wf2 was interrupted** at about 20:12 on 2026-09-26 by the usage limit. Scorer, contract, series, span and rt had finished their review fixes. The fixes for matrices, quant, rotation and coding, and the reading review, had not finished.
- **In flight: recovery workflow wf2b** (run `wf_598bf613-59c` in session `fc164352`, started 21:58). It does four things in order:
  1. finishes those fixes on each `wf2/<fam>` branch;
  2. runs an integrator that merges `wf2/*` into `dev` in both repos, registers the families, regenerates `golden/ts_dumps` and removes the worktrees;
  3. runs a 4-lens audit of the merged `dev`;
  4. repairs what the audit finds.
  The prior findings are saved in the session scratchpad (`wf2/findings.json`).
- **If interrupted:** run `git worktree list` and `git branch --list 'wf2/*'` in both repos. A branch that is still unmerged and has a dirty worktree is a fix left half-done: finish it, then merge into `dev` in this order: scorer, contract, rotation, matrices, series, quant, span, rt, coding, reading. After that, register the families, regenerate the dumps, run all gates, and remove the worktrees.
- Resume ticks were re-created in this session (the old session's crons died with it), with the same schedule: `23 22-23 26 9 *` and `23 0-9 27 9 *`.

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
