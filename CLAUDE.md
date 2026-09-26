# HumanBench — rules for Claude Code

- Read docs/DESIGN.md before any change. Requirements are R-x.y and sections §x.y; cite them in commits.
- The backlog is docs/ROADMAP.md; the session log and resume protocol are in docs/PROGRESS.md. Update both when a task finishes.
- NEVER commit answer keys, item_keys data, service-role keys, or finite-bank items to this public repo. Procedural generators for the static MVP are allowed here (ROADMAP A1).
- Front end: TypeScript strict, Svelte 5, D3 v7, Three.js only for rotation stimuli. No Pyodide.
- Timing code: rAF-locked onset, performance.now(); never Date.now() for RT.
- Every feature needs tests: vitest (unit, fast-check property tests), Playwright (e2e incl. WebKit/iOS emulation for save/upload).
- Terminal instructions written for the user: macOS zsh, and NO '#' comments inside command blocks.
- Blob: radius linear in theta [-3,3]; show uncertainty; never show total area or a single score.
- Non-diagnostic language only (R-5.6.x). No clinical terms in UI, share cards, or copy.
- Git: work on branch `dev`; one commit per ROADMAP task. Do not push or merge to `main` without the user's OK.
