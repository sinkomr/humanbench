# HumanBench — Progress log and resume protocol

## How autonomous work continues

The user's Claude plan has a rolling 5-hour usage limit. Work continues across limits like this:

- An in-session **hourly cron** (CronCreate, minute :23) sends the resume prompt below. It fires only while the session is idle. If the limit is still active the tick fails cheaply; the first tick after the reset picks the work back up.
- The cron lives only inside the running Claude Code session and **expires 7 days after creation**. Created: 2026-09-26. On any tick on or after 2026-10-02, run CronList; if the job is older than 6 days, CronDelete it and CronCreate an identical one.
- If the session was closed, the user can restart with `cd ~/code/humanbench` then `claude --continue` and type `resume`, which runs the same protocol.

### Resume protocol (run on every tick or "resume")

1. If a task or workflow from this conversation is still running, do nothing on this tick.
2. Check both repos (`~/code/humanbench`, `~/code/humanbench-bank`): run `git status`, and make sure the branch is `dev`. Uncommitted changes mean a run was interrupted. Read the diff, run the tests, then either finish the task or commit it as `WIP(<task>)` with a note under "Log".
3. Read "Now" below and the first `[ ]` or `[~]` task in `docs/ROADMAP.md` that is not blocked on the user.
4. Run it as a Workflow: implement → run tests/build → adversarial review → fix. Parallelise across independent tasks when possible. Separate repos, or `isolation: 'worktree'`, avoid write conflicts.
5. When a task passes its acceptance criteria, commit it (one commit per task, cite R-x.y), tick it in ROADMAP, and add a Log line here. Commit this file together with the task.
6. Continue with the next task until the backlog or usage runs out. Never push, merge to `main`, create cloud resources, or spend money without the user's OK. Add those items to "Needs you".

## Now

- Current focus: **M0 scaffolding**, then M1 core (M1.1–M1.4) and procedural families.

## Needs you (blocked on the user)

- [ ] **Push and enable Pages** (M0.5): OK to push `dev` → `main` on both repos? Then run `gh api -X POST repos/sinkomr/humanbench/pages -f build_type=workflow`.
- [ ] **Supabase project** (M2.6): create a free project and share the project ref. Secrets are set by you (§15).
- [ ] **Ollama** (G4 solvers, M3): `brew install ollama` and pull a model sized for 16 GB RAM (≤14B). Until then, G4 uses independent Claude solves.
- [ ] **RT jitter self-test** (M1.23): run the self-test page on a 120 Hz Mac once it exists.
- [ ] Optional: ICAR permission email, trademark/domain check (§2.6, §16).

## Log

- 2026-09-26 — Autonomy set up: `dev` branches, CLAUDE.md, ROADMAP.md, PROGRESS.md, hourly resume cron.
