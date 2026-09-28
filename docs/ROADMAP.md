# HumanBench — Build Roadmap (task backlog)

Source of truth for *what to build*: `docs/DESIGN.md` (requirements are R-x.y / §x.y).
This file is the ordered backlog. `docs/PROGRESS.md` is the session log and resume protocol.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked on user (see PROGRESS.md "Needs you").
Repo tags: **pub** = `~/code/humanbench` (public, GitHub Pages) · **bank** = `~/code/humanbench-bank` (private).

## Architecture decisions (ADR-lite)

- **A1 — M1 item generation.** Procedural families are generated **client-side in TypeScript from a seeded PRNG** for the static MVP (DESIGN §14.3 M1 allows it; procedural keys client-side are acceptable). Each TS generator ships a TS verifier and a vitest property test over 10k instances. The canonical **Python twins + verifiers live in bank** (needed for the M2 server pool). Cross-check: bank verifies a JSON dump of ≥1,000 TS instances per family with **0 disagreements**. From M2 on the server is authoritative and TS scoring is display/offline only.
- **A2 — Scoring engine.** TS port of the reference scorer in bank (`hb.calib.mirt_score`). Parity: TS matches `golden/scoring_v1.json` to 1e-6 (θ, cov, EAP). `n_iter` is informational only. The MAP convention is the one recorded in the golden file: a Newton step with observed information when Σ⁻¹ + diag(observed) passes Cholesky, otherwise Fisher scoring; stop on accepted step < 1e-8; step-halving slack 2⁻⁴⁶(1+|lp|); Laplace cov uses expected information. EAP uses equal weights on a 61-point grid over [−4, 4].
- **A3 — Front end.** Vite + Svelte 5 + TS strict + D3 v7 + Three.js (rotation only). Vitest (+ fast-check), Playwright (+ axe-core). Base path comes from the Pages settings (`/humanbench/`; the site is http://michaelsinko.phd/humanbench/).
- **A4 — Python.** 3.12 via `uv`, package `hb` (src layout), ruff, pytest, hypothesis, typer.
- **A5 — Git.** Work lands on `dev` in both repos, one commit per task, citing R-x.y. After each green batch, fast-forward `main` to `dev` and push both repos; the user OK'd this on 2026-09-26. Pages deploys from `main`.
- **A6 — No paid or cloud resources without the user.** M2 SQL is developed and tested locally (engine decided at M2.0). G4 solver unanimity uses independent Claude subagent solves until Ollama exists. **Finite items authored by Claude are not promoted to `live` until ≥2 non-Claude solvers have run.**
- **A7 — Axes & clusters.** 17 spokes, using the 8 cluster labels of the §3 table (Reasoning, Verbal, Quantitative, Spatial/Memory, Speed, Estimation, Knowledge, Social-Creative) for grouping, seriation contiguity, drill-down wedges and the checklist. Knowledge = 3 axes; its facets are the subject lists in §3 rows 13–15. Calibration (CAL) stays in the correlated model as a Gaussian axis (K = 17). User-facing name of EMO = "Emotion Reading (text scenarios)" (R-5.6.2 overrides §3).
- **A8 — Σ_init v2.** Pairwise, first match wins: (1) the midpoint of the §3 expected-r table where the pair is listed (MAT–QR .60, MAT–LG .60, MAT–SPA .50, RC–VOC .60, RC–KHU .60, VOC–KHU .60, LR–RC .60, WM–{MAT,LR,LG} .40, RT–{MAT,LR,LG} .28, PS–RC .30, FER–{QR,KST} .40, EMO–{VOC,KHU} .40, CRE–{MAT,LR,LG,RC,VOC,QR,SPA,WM,FER,KST,KHU,KAP} .23); (2) the L152 rules (CAL .20 to all, Speed–others .20, Social-Creative–others .30, same cluster .55, Reasoning–Knowledge .45); (3) otherwise .35. Then apply nearest-PD (clip eigenvalues to the 0.05 floor, rescale to unit diagonal, shrink toward I if needed). The Σ is pinned and versioned (`sigma_version`), and seriation uses the pinned version (§9.4).
- **A9 — Item models by option count (§7.1 wins over §3).** Options k ≤ 4 → 3PL with c = 1/k; k ≥ 5 and numeric entry → 2PL. So LR (5 options) is 2PL. Spatial uses **no** RT covariate; RT on power items is used only for time cost, flags, and as a difficulty feature (§7.1).
- **A10 — Speed/memory models.** WM: GRM with three graded items per session (digits forward, digits backward, Corsi). RT: τ̂ = β_task − median log-RT of valid trials, entered as a Gaussian observation with SE from MAD/√n; at least 20 valid simple trials and 30 valid choice trials. PS: two Gaussian observations on θ_Gs (coding log-rate, reading log-wpm). The reading observation is dropped if the gate fails. Every location/scale is **provisional** until M4.8.
- **A11 — Procedural families.** `family_id` = a stable hash of the structural parameters: the canonical polycube, the matrix rule set, the series rule family plus coefficients class, or the quant template. `item_id` = `i:<fam>:<genver>:<seed>`, so parameters can be regenerated from the id. Rotation: at most one pure-mirror distractor; every option pair is canonicalised and must be distinct. *Amended 2026-09-27:* `family_id` is the same function in both repos (the TS cyrb128 over TS-canonical JSON, ported bit-exactly to Python). Python twins tag their generator version `<ver>+py`, so an `item_id` names exactly one implementation. For re-scoring a saved TS `item_id` (R-8.1), the server must run the TS generator or keep the payload. Quant `family_id` is per stem-template variant (53 families). Per-topic families would exhaust QR after about 3 sessions under §7.7 exclusion, so near-isomorph siblings are excluded per session instead (M1.14).
- **A12 — Display honesty in M1.** Rings are labelled in SD units and marked "provisional". Percentiles appear only after M4 linking and N ≥ 500. Muting uses the θ = 0 rule (§9.5). "Distinctive peaks" use within-person contrasts θ_k − θ̄, whose 90% interval must exclude 0. Facet scores are a unidimensional EAP on facet items with the axis posterior as prior, shown only at ≥ 5 items.
- **A13 — Language guardrail.** The lint bans clinical nouns (autism, ADHD, alexithymia, …) everywhere except the exact R-5.6.5 sentence, which is an allow-listed constant rendered only in the results footer and never on share cards. The word "clinical" in the §13 disclaimer is allowed.
- **A14 — Reading-speed passages in pub.** This is an ADR exception to the "no finite items in pub" rule: tier-b speed gate items, uncalibrated, as allowed by §14.3 M1's static pool. The Gutenberg header is stripped and provenance is recorded. Gate questions are verified by ≥2 independent Claude solves plus a span check.
- **A15 — M1 session.** The M1 block order is RT → Matrix/Series → Spatial → Memory → Quant → Coding/Reading, with Calibration embedded, for a target of about 25–30 min. Blocks loop until SD < 0.3 or the time runs out. All 17 spokes are shown, and unbuilt axes appear as "not measured" stubs.
- **A16 — Save signing.** The server MAC is per session (session + anon_id), and the server refuses to sign a file that contains any unverified session. Calibration uses only DB rows deduplicated by session_id, never uploads (§8).
- **A17 — Cross-repo fixtures.** Non-secret fixtures flow bank → pub by copy: `golden/*.json` → `web/src/engine/__fixtures__/`. TS instance dumps go pub → bank `golden/ts_dumps/`. Sync scripts live in each repo, and each repo has a test that the copies match when the sibling repo is present.

## M0 — Scaffolding

- [x] **M0.1 pub** — `web/` Vite + Svelte 5 + TS strict, vitest + fast-check, base path, hello page with disclaimer.
- [x] **M0.2 pub** — `CLAUDE.md`.
- [x] **M0.3 pub** — `ci.yml` + `pages.yml`.
- [x] **M0.4 bank** — uv package `hb`, ruff/pytest/hypothesis, Typer CLI, CLAUDE.md, CI.
- [x] **M0.5** — pushed, Pages enabled, http://michaelsinko.phd/humanbench/ serves hello, CI green in both repos.

## M1 — Static MVP (no backend)

Core
- [x] **M1.1 pub** — engine core: PRNG (cyrb128 + sfc32, fork), axis registry, Σ rules, linalg, IRT math, types.
- [x] **M1.2 bank** — reference scorer (MAP/Laplace, EAP), `nearest_pd`, golden vectors (61 cases).
- [x] **M1.2b both** — Σ_init v2 per A8 plus `sigma_version`. Set LR to 2PL per A9. Regenerate the golden vectors. Update the TS registry test literal. Acceptance: every A8 pair is spot-tested in both repos; Σ is PD; both repos give an identical Σ (hash test). *(done 2026-09-27: pub b31d11f, bank 38e2be2)*
- [x] **M1.3 pub** — TS scorer port (A2): MAP/Laplace + per-axis EAP + all observation kinds + per-case Σ. nearestPD matches Python (clip, rescale, shrink) on the golden `nearest_pd` pairs. Acceptance: all golden cases within 1e-6; MAP with K = 17 and 150 observations < 10 ms in Node (bench test). *(done 2026-09-27: golden parity 1e-6, bench < 10 ms)*
- [x] **M1.4a bank** — θ-recovery simulation. N = 2,000 simulees with θ ~ MVN(0, Σ_init). Items: 2PL a ~ lognormal(0.2, 0.3), b ~ N(0, 1.2), with 20 items per axis on the 9 procedural and knowledge axes. Acceptance: r(θ̂, θ) ≥ .85 on **every** included axis. Also report coverage of the 90% intervals (0.85–0.95). *(done 2026-09-27: full N = 2,000 run gives item-axis r .890–.931 and cov90 .886–.907; slow test)*
- [ ] **M1.4b both** — (after M1.14) a TS CAT simulation (selector + scorer) on the same simulees, parity with Python within 0.02 on r. Uses a Node CLI. Use the real block families' observation parameters (RT/PS/WM), not the M1.4a stand-ins.
- [~] **M1.P both** — difficulty and time priors for procedural families (§6.ii). A v0 feature → b regression anchored to ICAR type means (rotation .19, matrix .52, series .59; b ≈ −logit(p)) with σ_b = 1.0, plus `expected_time_s` per family. The provisional location/scale for the RT, PS, WM, FER and CAL models (A10; Brysbaert 238 wpm; span norms fwd 6–7, bwd 4–5). *(partial: each family has a v0 prior. Open: re-centre each family pool so its mean b matches its ICAR anchor, not a reference item; provisional FER and CAL location/scale; make `stratum == stratumOfB(b_prior)` a contract rule.)*

Family contract + procedural families (each: TS gen + TS verify + 10k property test; Python twin + verifier; cross-check of ≥1,000 dumped TS instances with 0 disagreements; b prior + expected time; `family_id` per A11)
- [x] **M1.F pub+bank** — family contract: the `ProceduralFamily` TS interface, dump CLI (`npm run dump:families`), shared property-test helper, the bank `hb.gen.base` + cross-check harness, and fixture sync scripts (A17). *(done 2026-09-27; A17 sync tests in both repos, shared family_id hash, `+py` twin versions)*
- [ ] **M1.F2 pub+bank** — family contract v2, from the wf2 audit. It needs a block-result type: `score()` must return the block observation (Gaussian/GRM) and flags, and one meaning of `params.sigma` across the Gaussian blocks. It also needs a block-aware property suite that exercises `score()` for blocks, plus a uniform malformed-response error contract (span throws TypeError, the other blocks throw RangeError). Other items: an explicit fixed-block marker and sub-task modelling (span vs rt modes); per-item facets (quant facet by template); a numeric-aware KeyEchoTracker in both repos; and the fields M1.13 renderers and M1.14 selector need (option display order, time caps per §13, sibling-variant exclusion for quant). Update the bank `default_key_tamper` and the DESIGN §14.6 ex. 2/3 key shape. Pin the strictness of series `simpler_than_interpolant` (nit).
- [x] **M1.5** — mental rotation (§4.2, A11). *(done)*
- [x] **M1.6** — matrices: rule enumeration must give a unique 9th cell; the option-only heuristic is a modal-attribute picker, whose hit rate over 10k items must be ≤ 1.5 × chance **and** no single item may be solvable by it with certainty. *(done)*
- [x] **M1.7** — series: rule families = arithmetic, geometric, alternating/interleaved, 2nd-difference polynomial, Fibonacci-type, letter-position arithmetic mod 26, and composite (complexity k ≤ 3). DL = rule-family cost + coefficient bits. Reject when ≥ 2 minimum-DL rules disagree on the next term. The key rule must be strictly simpler than a degree-(n−2) polynomial. *(done)*
- [x] **M1.8** — quantitative: arithmetic → algebra templates, numeric entry with per-item tolerance, exact rational verification (TS) and SymPy (Python). *(done; numeric key = canonical rational string + tolerance, shared with series)*
- [x] **M1.9** — working memory: digit span forward/backward and Corsi (fixed 9-block coordinates). Start at length 3; 2 trials per length; stop when both trials at a length fail; max length 10 forward/Corsi, 9 backward. GRM scoring per A10. *(done)*
- [x] **M1.10** — reaction time: simple (30 trials) and 4-choice (40 trials), foreperiod 800–2,000 ms, trim simple < 150 or > 1,500 ms and choice < 200 or > 2,000 ms, τ̂ per A10. *(done; parity fixtures in rt_scores.json)*
- [x] **M1.11** — processing speed: symbol-digit coding, 9 symbols, key table randomised per session, 90 s; score = log(correct per minute); errors are counted and flagged if > 20%. *(done)*
- [~] **M1.12** — reading speed: ≥ 6 public-domain passages of ~350 words (A14), 3 literal gate questions each (gate ≥ 2/3), flag wpm > 900. *(built and merged; 8 passages v3. A14 is open: in the round-2 independent solves both solvers matched all 24 keys, but 4 questions (franklin q3, dana q2, faraday q1, huxley q1) were flagged as guessable without the passage. Rewrite them, run a third solve round, and record the solves in the repo.)*

Guardrails first (they apply to every UI task below)
- [ ] **M1.20 pub** — language lint per A13, scanning Svelte templates, TS string constants, share-card renderer, README. Disclaimer presence tests.
- [ ] **M1.A pub** — Playwright + axe-core harness. Every UI task from M1.13 on must reach 0 serious/critical axe issues on its routes.

UI
- [ ] **M1.13 pub** — renderers: Three.js polycube (fixed isometric camera), SVG matrix cells with text alternatives, series/quant entry, span/Corsi boards, RT stimuli. Acceptance: no key or correctness hint in the DOM or data attributes (test), and a snapshot test per renderer.
- [ ] **M1.14 pub** — adaptive selector: info/second (§7.4), randomesque top-5 (chi-square uniformity test), coverage floor ≥ 3 per axis, family exclusion, w_k = 0 for skipped axes. RT, span, coding and reading run as fixed blocks, not CAT items.
- [ ] **M1.17 pub** — save file (§8): `schema/save-v1.json` (the §8 example validates), RFC 8785 canonical JSON, an unsigned MVP save, download / Web Share / copy-code (gzip + base64url round trip), upload by content (a `.txt` rename still parses), paste, localStorage autosave per item, merge R-8.1 (idempotent property test), and a migrations scaffold.
- [ ] **M1.19 pub** — integrity flags (§13): visibility hidden > 10 s, paste, too fast (< 25% of median on items with median > 20 s), uniform RT (CV of log-RT < 0.1 across items whose expected times differ by ≥ 2×), accuracy on b > θ + 1.5 items above expectation (p < .01 binomial), lz* < −2 with ≥ 20 items. Tests on synthetic patterns.
- [ ] **M1.15 pub** — session flow (R-7.4, §10, §13, A15): consent + 18+ gate (the under-18 path writes nothing to storage), privacy/terms page, honour code, device check + RT input mode, blocks with interstitials, time-based progress ring, per-cluster checklist, break at 30 min, finish early, skip axis, hard stop, per-axis early stop SD < 0.3, and the confidence slider (floor 1/k for MC, 0 for entry; Brier). Practice mode (feedback, not counted). A `?fast=1` dev flag compresses timings; production builds ignore it (test). Playwright with a fake clock covers every listed rule.
- [ ] **M1.16 pub** — blob viz (§9, A12): linear radius; rings in SD units, "provisional"; Catmull-Rom closed with overshoot ≤ 0.1 ring, else cardinal(0.6) (numeric test); 20-curve fuzz + crisp mean; seriation matches brute force for K ≤ 10 and keeps clusters contiguous; muting rule; tier glyphs/hatch; not-measured stubs; bar/lollipop view (the screen-reader default); Okabe–Ito palette with ≥ 4.5:1 text contrast; no area or total in the DOM (test); drill-down to facet EAPs (≥ 5 items).
- [ ] **M1.R pub** — reveal flow (§10): the blob builds axis by axis → credible distinctive peaks (A12) → drill-down → required save download with a beforeunload guard → share card → 3 procedural items with worked solutions. Results copy: disclaimer, the R-5.6.5 resource line, "vs other HumanBench takers" wording (hidden until A12 allows it), external norms (Brysbaert wpm, digit span, web-relative RT), the Pace tooltip, and the "practice-adjusted" label. Retest-motivation UI: predicted shrinkage from §7.6, fuzziest axes, 20-min focus sessions, ≥ 7-day spacing advice.
- [ ] **M1.18 pub** — export: SVG, 2× PNG, a share card at exactly 1200×630 CSS px (2400×1260 at 2×). The card has a toggle to hide any axis and never shows emotion lows or hidden axes (tests).
- [ ] **M1.21 pub** — accessibility pass: axe 0 serious/critical on every route, a keyboard-only full session e2e, prefers-reduced-motion, 200% zoom, a contrast unit test.
- [ ] **M1.22 pub** — Playwright e2e: a full `?fast=1` session; WebKit/iOS emulation of save download and upload (M1 acceptance 4).
- [ ] **M1.Q both** — retest priors ρ_k(s) (§7.8) applied when re-scoring multi-session saves.
- [ ] **M1.23 pub** — RT jitter self-test page; the **user** runs it on a 120 Hz Mac (< 5 ms).
- [!] **M1.G7 user** — spot audit of 30 instances per procedural family (§4.4). Claude builds the procedural review page, and the user does the audit (~4 h total).

## M3.1 — Item schema (moved ahead of M2)
- [ ] **M3.1 bank** — item pydantic model + JSON Schema (G1) matching §12, the status lifecycle, `hb promote` gate plumbing. The M1 Python twins emit §12-valid records.

## M4 — Calibration (algorithms offline-testable before M2)
- [ ] **M4.1 bank** — Phase A: grid-posterior update of b that integrates over θ posteriors; Elo pretest updates. Acceptance: recovers b within SE on simulation.
- [ ] **M4.2 bank** — Phase B: 2PL MML per axis with fixed anchors and a lognormal prior on a. Acceptance: at n = 500, RMSE(b) < .15 and RMSE(a) < .2.
- [ ] **M4.3 bank** — linking: anchor drift check and Stocking–Lord. Acceptance: an injected shift is recovered within 0.05.
- [ ] **M4.4 bank** — QA rules §4.5 + distractor analysis §4.3 + report thresholds → quarantine. Acceptance: an injected negative-a item is quarantined.
- [ ] **M4.5 bank** — Σ re-estimation from disattenuated posteriors + nearest-PD. Acceptance: Frobenius error < .1 at N = 2,000.
- [ ] **M4.6 bank** — M4 acceptance simulation: 300 users, r(b̂, b) ≥ .9, drift < 0.1.
- [ ] **M4.7 bank** — retest model ρ_k(s) estimation, plus re-scoring from raw responses. Acceptance: ρ recovery in simulation.
- [ ] **M4.8 bank** — calibrate the non-2PL models: RT β/σ, PS location/scale, GRM thresholds, Fermi δ, CAL standardisation.
- [ ] **M4.9 bank** — nightly falsifiable-check report (F1, F3, F4, F7, F8, F10, F11) with thresholds and injected-violation tests; Mantel–Haenszel DIF (§13).
- [ ] **M4.10 bank** — write versioned item_parameters, publish param_version/bank_version, re-score recent sessions (after M2.1; DB adapter tested locally).

## M2 — Backend (SQL written + tested locally; deploy needs user)
- [ ] **M2.0** — choose the local Postgres engine (brew postgresql@17 if the user installs it, else pip `pgserver` or PGlite) with stubbed anon/authenticated roles and a Vault shim.
- [ ] **M2.1 pub** — migrations: §12 schema + mirror, rate, survey and exposure-log tables; RLS on **every** table; default privileges revoked; EXECUTE revoked except whitelisted RPCs; SECURITY DEFINER functions with `search_path = ''`. RPCs: start_session(device, save), next_item, submit, finish, report_problem, rescore(save), delete_my_data, mirror_put/get.
- [ ] **M2.2 pub** — PL/pgSQL scoring: EAP grid (equal weights, 61 points) in `sessions.state`, correlated MAP at finish (golden parity 1e-6), selection SQL with the 0.25 exposure cap, pretest slots (≤ 10%, Thompson sampling), calibration_eligible at finish.
- [ ] **M2.3 pub** — per-session HMAC saves (A16), Vault key + kid rotation, unverified path.
- [ ] **M2.4 pub** — local tests: anon cannot select any table; anon can EXECUTE only whitelisted RPCs; no payload contains `key` (fuzz 1,000 items); tampered save → unverified; rate limits (5 sessions/day per hashed IP+salt, 200 items, ≥ 2 s/item average).
- [ ] **M2.5 bank** — `hb load push`, `calibrate.yml` (exits cleanly when `SUPABASE_DB_URL` is unset), `backup.yml` (restore round trip tested locally, keep 8), nightly archive/compaction, DB-size check.
- [ ] **M2.7 pub** — front-end integration: supabase-js; start/next/submit/finish flow; static fallback; unverified-save UI; Report-a-problem button (5 categories); optional 2-question survey; deletion and mirror UI.
- [!] **M2.6 user** — Supabase project, secrets, Vault HMAC key, age keypair, CAPTCHA keys, region; then the p95 < 300 ms latency check against the live project.

## M3 — Knowledge & verbal banks (bank)
- [ ] **M3.2** — verifiers: z3 logic games, RC passage-dependence (no-passage rate logged in `verification`, reject > 1.5 × chance), citations G5, sensitivity lint G6, license allow-list + 8-gram overlap lint F9 (the anchor corpus needs the user).
- [ ] **M3.3** — solver gate G4 (Claude now; Ollama adapter for ≥ 2 model families).
- [ ] **M3.4** — `hb review` (Typer + FastAPI :8765); `--take` stores author responses flagged and excluded from calibration.
- [ ] **M3.6** — procedural logic-game generator (Z3, 2–500 models per setup).
- [ ] **M3.7** — `hb gen`, `hb verify`, `hb push` CLIs (§14.5); `fact_volatility` field (fast facts only in Fermi).
- [ ] **M3.8** — anchor pipeline: NAEP released items (per-item rights check) → p → b priors; 10–20 anchors per axis.
- [ ] **M3.9** — testlet random effect γ ~ N(0, .3²) in both scorers (§7.1) before testlet items go live.
- [ ] **M3.5** — authoring batches, per axis at S = 3: ≈ 162 items for each of the 7 finite v1 axes (LR, RC, VOC, KST, KHU, KAP, + LG pool), plus Fermi. Each batch passes G1–G6 and gets an audit-bound record (G7 needs the user).

## M5 — Tier (b) Fermi + calibration UI
- [ ] **M5.1** — Fermi items (≥ 2 sources, uncertainty in dex, down-weighting above 0.15 dex, reject above 0.3), the magnitude + unit entry UI, 80% intervals, server-side Brier.

## M6 — Tier (c) (v2)
- [ ] **M6.1** — appraisal vignettes + rule engine (100% rule-key agreement; AI-vs-theory ≥ 85% or reject), R-5.6.2 label and tooltip.
- [ ] **M6.2** — SJT + key blending (§5.2), circularity guard, F6 check (expert ratings need the user or recruited raters).
- [ ] **M6.3** — RAT with a compound check (corpus licensing is the user's call) and spelling variants.
- [ ] **M6.4** — AUT with in-browser MiniLM, the "don't type personal info" warning, opt-in Ocsai consent, hatch rendering.
