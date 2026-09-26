# HumanBench — Build Roadmap (task backlog)

Source of truth for *what to build*: `docs/DESIGN.md` (requirements are R-x.y / §x.y).
This file is the ordered backlog. `docs/PROGRESS.md` is the session log and resume protocol.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked on user (see PROGRESS.md "Needs you").
Repo tags: **pub** = `~/code/humanbench` (public, GitHub Pages) · **bank** = `~/code/humanbench-bank` (private).

## Architecture decisions (ADR-lite)

- **A1 — M1 item generation.** Procedural families are generated **client-side in TypeScript from a seeded PRNG** for the static MVP (DESIGN M1 allows this; keys client-side are acceptable for procedural items). Each TS generator ships a TS verifier and a vitest property test (10k instances). The **canonical Python generators + verifiers live in bank** (DESIGN "all generation is in Python"; needed for the M2 server pool). Cross-check: bank tests run the Python verifiers over a JSON dump of TS-generated instances (independent implementations must agree).
- **A2 — Scoring engine.** TS port of per-axis EAP (61-point grid) and correlated-factor MAP/Laplace (§7.2) in `web/src/engine/`. The Python reference (`hb.calib.mirt_score`) exports golden vectors that TS unit tests must match to 1e-6.
- **A3 — Front end.** Vite + Svelte 5 + TypeScript strict + D3 v7 + Three.js (rotation only). Vitest (unit, property tests via fast-check), Playwright (e2e incl. WebKit/iOS emulation). Base path `/humanbench/` for Pages.
- **A4 — Python.** 3.12 via `uv`, package `hb`, `ruff`, `pytest`, `hypothesis`, `typer`.
- **A5 — Git.** Work lands on branch `dev` in both repos, one commit per task, messages cite R-x.y. Pushing / merging to `main` needs the user's OK.
- **A6 — No live services until the user provisions them.** Supabase (M2) SQL is developed and tested against a local Postgres; LLM solver gate G4 uses independent Claude subagent solves until Ollama is installed.

## M0 — Scaffolding (DESIGN §14.3)

- [ ] **M0.1 pub** — `web/` Vite + Svelte 5 + TS strict app; "HumanBench — hello" page; base `/humanbench/`; vitest wired; `npm run build`, `npm test`, `npm run check` green.
- [ ] **M0.2 pub** — `CLAUDE.md` (§14.2 + autonomy rules). *(done in setup, refine as needed)*
- [ ] **M0.3 pub** — `.github/workflows/ci.yml` (typecheck, vitest, build) and `pages.yml` (deploy `web/dist` on push to `main`).
- [ ] **M0.4 bank** — `uv` package `hb` (src layout), ruff + pytest + hypothesis configured, smoke test, `CLAUDE.md`, `.github/workflows/ci.yml`.
- [!] **M0.5 user** — push both repos, enable Pages (`gh api -X POST repos/sinkomr/humanbench/pages -f build_type=workflow`), confirm Pages URL serves hello.

## M1 — Static MVP (no backend)

Core
- [ ] **M1.1 pub** — engine core: seeded PRNG (sfc32 + seed hashing), axis registry (17 rows of §3 with cluster, CHC, tier, glyph), item/response types (§8 tuple), 2PL/3PL math.
- [ ] **M1.2 bank** — Python reference scorer `hb.calib.mirt_score` (§7.2 MAP/Laplace, EAP grid, nearest-PD with eigen floor 0.05, initial Σ per §3) + golden vectors JSON export.
- [ ] **M1.3 pub** — TS scorer port: per-axis EAP (61-pt grid) + correlated MAP/Laplace + continuous-model terms; matches golden vectors.
- [ ] **M1.4 bank** — simulation harness (catsim + own CAT loop): θ recovery r ≥ .85 at 20 items/axis (M1 acceptance 2). Also run the TS engine via a Node CLI on the same simulated data.

Procedural families (each: TS gen + TS verify + 10k property test; Python twin + verifier + cross-check)
- [ ] **M1.5** — mental rotation: Shepard–Metzler polycubes (8–10 cubes, ≥3 arms), 24-element group canonicalisation, chirality check, mirror / one-cube-moved distractors, pairwise-distinct distractors (§4.2). Difficulty features: angle, depth vs plane.
- [ ] **M1.6** — matrices: attribute × rule grammar, rule-enumeration uniqueness solver, one-rule-violation distractors, option-only heuristic check (≤1.5× chance) (§4.2).
- [ ] **M1.7** — series: numeric + letter families, MDL uniqueness, key-rule strictly simpler than the degree-(n−2) polynomial (§4.2).
- [ ] **M1.8** — quantitative: arithmetic → algebra templates, numeric entry with per-item tolerance; exact rational verification in TS, SymPy in Python.
- [ ] **M1.9** — working memory: digit span forward/backward, Corsi (9-block fixed layout); GRM on max span, 2 trials/length.
- [ ] **M1.10** — reaction time: simple (30 trials) and 4-choice (40 trials); rAF-locked onset, `performance.now()`, refresh-rate estimate from 60 rAF deltas, trimming rules, lognormal person parameter (§7.1, §11.6).
- [ ] **M1.11** — processing speed: symbol-digit coding, 90 s, log-rate model.
- [ ] **M1.12** — reading speed: ≥6 public-domain (pre-1928 Gutenberg) passages ~350 words, 3 literal gate questions each, gate ≥ 2/3, flag wpm > 900. Provenance recorded.

Session + UX
- [ ] **M1.13 pub** — renderers: Three.js polycube (fixed isometric camera), SVG matrix cells, series/quant entry, span/Corsi boards, RT stimuli.
- [ ] **M1.14 pub** — adaptive selector: info/second (§7.4), randomesque top-5, coverage floor ≥3 per axis, family exclusion, exposure bookkeeping.
- [ ] **M1.15 pub** — session flow (R-7.4, §10, §13): consent + 18+ gate, honour code, device check, blocks with interstitials, time-based progress ring, break at 30 min, finish early, skip axis, hard stop 57 min, per-axis early stop SD < 0.3, confidence slider (calibration axis, Brier).
- [ ] **M1.16 pub** — blob viz (§9): linear radius θ∈[−3,3], rings + percentile labels, Catmull-Rom closed with overshoot fallback, 20-curve uncertainty fuzz + crisp mean, seriation by Σ (exact DP / 2-opt), muted non-credible spikes, tier glyphs/hatch, not-measured stubs, bar/lollipop view (screen-reader default), Okabe–Ito palette, drill-down stub.
- [ ] **M1.17 pub** — save file (§8): `schema/save-v1.json`, RFC 8785 canonical JSON, unsigned MVP save, download / Web Share / copy-code (gzip+base64url), upload-by-content / paste, localStorage autosave per item, merge R-8.1 (idempotent property test), migrations scaffold.
- [ ] **M1.18 pub** — export: SVG, PNG 2×, 1200×630 share card (no emotion lows, R-5.6.4).
- [ ] **M1.19 pub** — integrity flags client-side (§13): visibility, paste, too-fast, uniform-RT; person-fit lz*.
- [ ] **M1.20 pub** — language/ethics lint in CI: banned clinical terms (R-5.6.1), disclaimers present (§13).
- [ ] **M1.21 pub** — accessibility pass (WCAG 2.2 AA): keyboard, ARIA, contrast, reduced motion, text size.
- [ ] **M1.22 pub** — Playwright e2e: full fast-mode session; WebKit/iOS emulation save download + upload (M1 acceptance 4).
- [!] **M1.23 user** — RT jitter self-test on a 120 Hz Mac (< 5 ms; M1 acceptance 5). Claude builds the self-test page; the user runs it.

## M4 — Calibration (offline-testable; before M2 because it needs no services)

- [ ] **M4.1 bank** — Phase A grid-posterior b update integrating over θ posteriors; Elo pretest updates.
- [ ] **M4.2 bank** — Phase B 2PL MML per axis with fixed anchors (girth or custom EM), lognormal prior on a.
- [ ] **M4.3 bank** — linking: anchor drift check, Stocking–Lord transform.
- [ ] **M4.4 bank** — QA rules §4.5 (negative a, misfit S-X², infit/outfit, distractor analysis §4.3, report thresholds) → quarantine.
- [ ] **M4.5 bank** — Σ re-estimation from disattenuated posteriors + nearest-PD.
- [ ] **M4.6 bank** — acceptance simulation: 300 simulated users, r(b̂, b) ≥ .9, drift < 0.1, injected negative-a item auto-quarantined.
- [ ] **M4.7 bank** — retest model ρ_k(s) (§7.8); re-score from raw responses.

## M2 — Backend (SQL written + tested locally; deploy needs user)

- [ ] **M2.1 pub** — `supabase/migrations/`: schema §12, RLS on, revoke anon; `SECURITY DEFINER` RPCs start_session / next_item / submit / finish / report_problem.
- [ ] **M2.2 pub** — PL/pgSQL scoring (EAP grid in `sessions.state`) + selection query; rate limits; hashed-IP table purge.
- [ ] **M2.3 pub** — HMAC-signed saves (Vault key, kid rotation), verify on upload → "unverified" path.
- [ ] **M2.4 pub** — tests against local Postgres: anon cannot select any table; no payload contains `key` (fuzz 1,000 items); tampered save → unverified.
- [ ] **M2.5 bank** — `hb load push` (procedural pool → DB), `calibrate.yml`, `backup.yml`.
- [!] **M2.6 user** — create Supabase project, `supabase link`, `db push`, set secrets/variables (§15).

## M3 — Knowledge & verbal banks (bank)

- [ ] **M3.1** — item pydantic schema + JSON Schema (G1), status lifecycle, `hb promote` gates.
- [ ] **M3.2** — verifiers: z3 logic games (§4.2), RC passage-dependence test, citations checker (G5), sensitivity lint (G6), license allow-list + 8-gram overlap lint (F9).
- [ ] **M3.3** — solver gate G4 (Claude subagent solves now; Ollama adapter ready for when installed).
- [ ] **M3.4** — `hb review` Typer CLI + FastAPI page on :8765.
- [ ] **M3.5** — authoring batches: logic games, LR, RC, vocabulary, STEM/humanities/arts-practical knowledge, toward ~1,500 items (§7.7).

## M5 — Tier (b) Fermi + calibration UI
- [ ] **M5.1** — Fermi items with ≥2 sources, uncertainty dex, log-error scoring; 80% interval questions.

## M6 — Tier (c) (v2)
- [ ] **M6.1** — appraisal-keyed emotion vignettes with Roseman-style rule engine.
- [ ] **M6.2** — SJT with key blending (§5.2).
- [ ] **M6.3** — RAT with corpus compound check.
- [ ] **M6.4** — AUT with in-browser MiniLM embeddings.
