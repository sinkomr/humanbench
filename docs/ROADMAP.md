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
- **A18 — Numeric-entry key and contract v2 (2026-09-28).** A numeric key is `{value: "<canonical rational>", tol: {abs|rel}}`, and a letter key is `{letter}`. This supersedes the DESIGN §14.6 ex. 2/3 shape `{value: 42, tol: 0}`. Families declare `kind: item | block`; each block sub-task is its own family (span_fwd/span_bwd/corsi, rt_simple/rt_choice4). A block's `score()` returns a BlockScore (an observation, or reasons, plus flags). For Gaussian blocks, `params.sigma` is τ_res. Every item carries `sibling_group`, used for per-session exclusion, and `time_limit_s = max(180, ceil(2.5·E[T]))` (§13). Saved item ids are regenerated only through `resolveItem()`, which requires an exact version match. Otherwise the stored correctness and the server params or payload are used.
- **A19 — Calibration QA readings (2026-09-28).**
  - M4.5's "Frobenius < .1" means the relative Frobenius error over the measured off-diagonal pairs, and within 2× the oracle error. The absolute 17×17 bound has a sampling floor of about 0.28 at N = 2,000. The bound needs about 6 or more items per axis.
  - §4.3: auto-quarantine requires a distractor's point-biserial CI to exclude 0. A positive r whose CI includes 0 goes to review.
  - §4.5: the negative-a rule applies only when SE(a) ≤ 1.0 (NEG_A_MAX_SE).
  - The negative point-biserial rule should require a minimum count of the minority response. This is open, and belongs in M4.4/M4.6.
  - A12 facet counting treats a block as one observation. Revisit in M4.
- **A24-sec — Accepted inference risks (owner decision, 2026-10-02).** HumanBench is a low-stakes self-knowledge test, not a credential or an LLM benchmark. Two key-harvesting channels are accepted, documented risks rather than engineered away:
  1. **Adaptive leak:** the next item served after `submit`/`next_item` reveals whether the previous answer was right.
  2. **Rescore differencing:** a caller who already knows 4 answers can read the 5th from a minimum-n axis estimate.

  Both need a deliberate script and many sessions. The protections in place: rate limits (5 sessions/day per hashed IP plus salt, 200 items, ≥ 2 s per item on average); the 0.25 per-item exposure cap with randomesque selection; finish.include_correct = false; and items showing anomalous exposure or p-value drift are rotated (M4.4 QA). Revisit if stakes change, for example published norms or third-party use.
- **A20 — Notes for your AI: contract (Part 1 approved 2026-09-29).**
  - **Generation.** Notes are generated in the browser by a deterministic rule table (`web/src/brief/`) from `brief_prefs` and, in Part 2, the local save or the M2 `rescore` result. There is no LLM, no API call, no send-to integration, no deep link and no telemetry. HumanBench never stores, logs or transmits notes.
  - **Grammar.** Every line comes from the closed, versioned grammar `hb-brief/1`, with slots from closed lists. Custom lines are allowed; they are flagged, checked and never persisted. The checker enforces `parse(render(p)) = p` and parses every released version.
  - **Content.** Every line is an instruction about wording, depth, format or checking, and no line describes the person.
    - Text forms are ASCII, with digits only in YYYY-MM, markup only `#` and `-`, and no URLs.
    - They contain no scores, estimates, percentiles, levels, school-level words, axis names or branding.
    - The JSON mirrors the rendered lines: line IDs, template versions, topic IDs, statuses and months only.
  - **Structure.**
    - The self-expiring header (with a no-date fallback) and fixed clauses F1–F4 come first and are locked; CC is locked in coding contexts. F1–F4 are grammar line IDs, not the DESIGN §16 checks of the same name.
    - Tiers: T0 always; T1 (≤ 5 topics per context, ≤ 5 contexts) by default; T2 behind a warning and never with inferred lines.
  - **Inputs** are limited to DESIGN R-17.4. Format and accessibility lines are chosen, never inferred.
  - **Storage.** Preferences persist only as enums, IDs, versions, months and integers. That means an optional save-1.0 field if this is adopted before M1 goes public, or localStorage otherwise (Q3).
    - Free text is never persisted, and notes never appear on share cards.
    - In M2, `brief_prefs` is removed before every upload, rejected by the server, excluded from the mirror and outside the HMAC scope (AI.26).
  - **Precedence:** chat request > the person's own setting > an accepted suggestion shifted by the fit log > no line. Fit shift: over the last ≤ 4 entries within 180 days, a net of ±2 moves one setting. The fit log never enters any likelihood, the blob or calibration.
  - *Consequences:*
    - M1 personal content is self-set only;
    - the notes are useless as a credential by design;
    - adding a line type requires a grammar version and a gate run (A22).
- **A21 — Topic zones (`zone_rule z1`; Part 2).** Part 1 approval covers the AI.8s simulation of this rule; the engine (AI.8) and any results-derived line need the separate Part 2 approval.
  - **Person input:** the own-axis, practice-adjusted posterior `RetestScore.eap[axis]` (in M2, returned by `rescore`), never the correlated MAP. Only `calibration_eligible` sessions count; ineligible sessions still count as practice exposures.
  - **Topic curve:** TCC_t(θ) = mean of P_j(θ) over the topic's items.
  - **Total uncertainty:** S² = s² + σ_rel² + κ·m.
    - **No results-derived lines on uncalibrated (M1) priors.**
    - After M4, σ_rel = max(.25, calibrated SE) until F12 sets it.
    - κ = .01 per month [SPEC] until M4.7.
  - **Zones:** skip if TCC(μ − 1.282·S) ≥ .80; build up if TCC(μ + 1.282·S) ≤ .50; otherwise ask first.
  - **Safeguards:**
    - the floor rule (no results-derived build-up on the two lowest quant groups);
    - ≤ 2 inferred lines per note;
    - never in T2;
    - hysteresis (a change needs .93, or two consecutive regenerations);
    - E19 must pass.
  - **No line** with fewer than 6 own-axis items, or for unmeasured, skipped or Σ-borrowed axes.
  - **Basis:** *inferred* (QR ladder only), *observed* (≥ 5 facet items and τ̂ ≥ .20, required for knowledge and notation), or *self_set*.
  - **Acceptance:** the AI.8s sweeps on the real M1.4b CAT pass at soft ≤ 5% and gross ≤ 1%, **and** F12 passes on real data. Thresholds change only through a new rule version.
- **A22 — Evidence and release gate; copy claims.**
  - **Which line types exist.** A line type exists only if its **current template version** passes F16/F17. For results-derived types, the adaptation also needs at least moderate evidence for a person-by-instruction interaction.
    - Passing means doing so on ≥ 2 families (≥ 1 local), with positive controls detected.
    - A type is *shipped* for a destination only when that destination's surface smoke also passes.
    - Otherwise it is *experimental* (badged; results-derived lines never pre-ticked) or *blocked* (never rendered).
    - Changing the wording resets the gate.
  - **Model drift.** Gates are re-run quarterly and on major model releases. A newly blocked type triggers the in-app withdrawal notice.
  - **Publication.** Pub's gates file carries statuses only; per-family metrics stay in bank (D1: no public benchmark of named AI models).
  - **Which inputs may drive lines:** as F12–F15 allow.
  - **What the copy may claim:** benefit is claimed only after F18/F19 pass in pre-registered studies. Until then: "Designed from research on explanations; not yet shown to help HumanBench users". No banner or drawer implies benefit. Nulls are published.
- **A23 — Topics, quant groups and item tags (M3.1b = AI.2).**
  - `schema/topics-v1.json` is a controlled vocabulary of content labels. Topics are children of `facet` (prefix-consistent). It has `other/` self-settable topics, a deny-list test, `topics_version`, `group_version` and an alias map that stored IDs must resolve through.
  - The six M1 quant groups (proposal §5.2) are a pub constant with a bank twin, over template facets.
  - Item-v1 gains optional typed fields, required at promote for the relevant axes: `topic`, `curriculum_level` (never exported into notes), `notation[]`, `question_type`, `inference_steps`, private `jargon_terms[]`, and private VOC/RC `difficulty_prior.features`. Family metadata gains `ladder_probe` and `practice_only`.
  - Lexical norms stay in the bank. This lands before M3.5, M3.6 and M3.7.
- **A24 (draft; adopt with Part 2) — Goals mode as classification sessions.**
  - Focus sessions may target topics through contract v3 `generate(seed, {stratum, topic})` (with the bank twin and cross-check). They add weight-proportional budgets, selection at undecided zone cut points, zone-decided stopping, and facet-weighted finite selection in M2.2 (AI.21b, keeping the 0.25 exposure cap).
  - Each chosen topic gets 2 held-out ladder probes for F12.
  - Lifetime family exclusion (DESIGN §7.7) is unchanged.

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
- [x] **M1.4b both** — (after M1.14) a TS CAT simulation (selector + scorer) on the same simulees, parity with Python within 0.02 on r. Uses a Node CLI. Use the real block families' observation parameters (RT/PS/WM), not the M1.4a stand-ins. *(built: Node CLI `npm run sim:cat`, real selector, scorer and blocks. The non-adaptive replay matches Python within 0.02. **Open:** within the A15 ~25–30 min budget, CAT r on MAT/SPA/QR is .815/.798/.743, below .85; it passes at 20 items/axis (.903/.868/.905). Needs the user's decision.)* **Decided 2026-09-29 (user): option 1. The M1 criterion is r ≥ .85 at 20 items/axis (DESIGN §14.3); remove the `.fails` markers.**
- [x] **M1.P both** — difficulty and time priors for procedural families (§6.ii). A v0 feature → b regression anchored to ICAR type means (rotation .19, matrix .52, series .59; b ≈ −logit(p)) with σ_b = 1.0, plus `expected_time_s` per family. The provisional location/scale for the RT, PS, WM, FER and CAL models (A10; Brysbaert 238 wpm; span norms fwd 6–7, bwd 4–5). *(done 2026-09-28: the pool mean b equals the ICAR anchor for rotation, matrices and series; quant uses band centres; the rule stratum == stratumOfB(b) is part of the contract; FER and CAL norms are provisional until M4.8)*

Family contract + procedural families (each: TS gen + TS verify + 10k property test; Python twin + verifier; cross-check of ≥1,000 dumped TS instances with 0 disagreements; b prior + expected time; `family_id` per A11)
- [x] **M1.F pub+bank** — family contract: the `ProceduralFamily` TS interface, dump CLI (`npm run dump:families`), shared property-test helper, the bank `hb.gen.base` + cross-check harness, and fixture sync scripts (A17). *(done 2026-09-27; A17 sync tests in both repos, shared family_id hash, `+py` twin versions)*
- [x] **M1.F2 pub+bank** — family contract v2, from the wf2 audit. It needs a block-result type: `score()` must return the block observation (Gaussian/GRM) and flags, and one meaning of `params.sigma` across the Gaussian blocks. It also needs a block-aware property suite that exercises `score()` for blocks, plus a uniform malformed-response error contract (span throws TypeError, the other blocks throw RangeError). Other items: an explicit fixed-block marker and sub-task modelling (span vs rt modes); per-item facets (quant facet by template); a numeric-aware KeyEchoTracker in both repos; and the fields M1.13 renderers and M1.14 selector need (option display order, time caps per §13, sibling-variant exclusion for quant). Update the bank `default_key_tamper` and the DESIGN §14.6 ex. 2/3 key shape. Pin the strictness of series `simpler_than_interpolant` (nit). *(done 2026-09-28: BlockScore, sigma = τ_res, MalformedResponseError, kind item/block with rt split into rt_simple and rt_choice4, facets[], sibling_group, §13 cap max(180, 2.5·E[T]), numeric-aware KeyEcho; see A18)*
- [x] **M1.5** — mental rotation (§4.2, A11). *(done)*
- [x] **M1.6** — matrices: rule enumeration must give a unique 9th cell; the option-only heuristic is a modal-attribute picker, whose hit rate over 10k items must be ≤ 1.5 × chance **and** no single item may be solvable by it with certainty. *(done)*
- [x] **M1.7** — series: rule families = arithmetic, geometric, alternating/interleaved, 2nd-difference polynomial, Fibonacci-type, letter-position arithmetic mod 26, and composite (complexity k ≤ 3). DL = rule-family cost + coefficient bits. Reject when ≥ 2 minimum-DL rules disagree on the next term. The key rule must be strictly simpler than a degree-(n−2) polynomial. *(done)*
- [x] **M1.8** — quantitative: arithmetic → algebra templates, numeric entry with per-item tolerance, exact rational verification (TS) and SymPy (Python). *(done; numeric key = canonical rational string + tolerance, shared with series)*
- [x] **M1.9** — working memory: digit span forward/backward and Corsi (fixed 9-block coordinates). Start at length 3; 2 trials per length; stop when both trials at a length fail; max length 10 forward/Corsi, 9 backward. GRM scoring per A10. *(done)*
- [x] **M1.10** — reaction time: simple (30 trials) and 4-choice (40 trials), foreperiod 800–2,000 ms, trim simple < 150 or > 1,500 ms and choice < 200 or > 2,000 ms, τ̂ per A10. *(done; parity fixtures in rt_scores.json)*
- [x] **M1.11** — processing speed: symbol-digit coding, 9 symbols, key table randomised per session, 90 s; score = log(correct per minute); errors are counted and flagged if > 20%. *(done)*
- [x] **M1.12** — reading speed: ≥ 6 public-domain passages of ~350 words (A14), 3 literal gate questions each (gate ≥ 2/3), flag wpm > 900. *(done 2026-09-28: passages v4. Two clean round-3 independent solves are recorded in bank golden/reading_solves.json, with an A14 gate test. Note: a solver working without the passages, from memory, got 10 questions on famous source texts right; judged acceptable for a speed gate.)*

Guardrails first (they apply to every UI task below)
- [x] **M1.20 pub** — language lint per A13, scanning Svelte templates, TS string constants, share-card renderer, README. Disclaimer presence tests. *(done)*
- [x] **M1.A pub** — Playwright + axe-core harness. Every UI task from M1.13 on must reach 0 serious/critical axe issues on its routes. *(done: chromium, webkit, iPhone 13 projects, axe WCAG 2.1/2.2 AA, CI job)*

UI
- [x] **M1.13 pub** — renderers: Three.js polycube (fixed isometric camera), SVG matrix cells with text alternatives, series/quant entry, span/Corsi boards, RT stimuli. Acceptance: no key or correctness hint in the DOM or data attributes (test), and a snapshot test per renderer. *(done 2026-09-28: 9 renderers, leak scans, DOM snapshots, axe; Three.js lazy-loaded for rotation only)*
- [x] **M1.14 pub** — adaptive selector: info/second (§7.4), randomesque top-5 (chi-square uniformity test), coverage floor ≥ 3 per axis, family exclusion, w_k = 0 for skipped axes. RT, span, coding and reading run as fixed blocks, not CAT items. *(done; quant sibling sets g:quant:<label>, at least 8 units per stratum)*
- [x] **M1.17 pub** — save file (§8): `schema/save-v1.json` (the §8 example validates), RFC 8785 canonical JSON, an unsigned MVP save, download / Web Share / copy-code (gzip + base64url round trip), upload by content (a `.txt` rename still parses), paste, localStorage autosave per item, merge R-8.1 (idempotent property test), and a migrations scaffold. *(done: library only; UI wiring in M1.15/M1.R and WebKit e2e in M1.22)*
- [x] **M1.19 pub** — integrity flags (§13): visibility hidden > 10 s, paste, too fast (< 25% of median on items with median > 20 s), uniform RT (CV of log-RT < 0.1 across items whose expected times differ by ≥ 2×), accuracy on b > θ + 1.5 items above expectation (p < .01 binomial), lz* < −2 with ≥ 20 items. Tests on synthetic patterns. *(done)*
- [x] **M1.15 pub** — session flow (R-7.4, §10, §13, A15): consent + 18+ gate (the under-18 path writes nothing to storage), privacy/terms page, honour code, device check + RT input mode, blocks with interstitials, time-based progress ring, per-cluster checklist, break at 30 min, finish early, skip axis, hard stop, per-axis early stop SD < 0.3, and the confidence slider (floor 1/k for MC, 0 for entry; Brier). Practice mode (feedback, not counted). A `?fast=1` dev flag compresses timings; production builds ignore it (test). Playwright with a fake clock covers every listed rule. *Amended (Phase AI Part 2, only if approved):* the honour-code sentence "Your notes are only useful if the answers are yours" once results feed the notes.
- [x] **M1.16 pub** — blob viz (§9, A12): linear radius; rings in SD units, "provisional"; Catmull-Rom closed with overshoot ≤ 0.1 ring, else cardinal(0.6) (numeric test); 20-curve fuzz + crisp mean; seriation matches brute force for K ≤ 10 and keeps clusters contiguous; muting rule; tier glyphs/hatch; not-measured stubs; bar/lollipop view (the screen-reader default); Okabe–Ito palette with ≥ 4.5:1 text contrast; no area or total in the DOM (test); drill-down to facet EAPs (≥ 5 items). *(done; the fuzz follows §9.3: 20 nested curves at θ ± z·SD)*
- [x] **M1.R pub** — reveal flow (§10): the blob builds axis by axis → credible distinctive peaks (A12) → drill-down → required save download with a beforeunload guard → share card → 3 procedural items with worked solutions. Results copy: disclaimer, the R-5.6.5 resource line, "vs other HumanBench takers" wording (hidden until A12 allows it), external norms (Brysbaert wpm, digit span, web-relative RT), the Pace tooltip, and the "practice-adjusted" label. Retest-motivation UI: predicted shrinkage from §7.6, fuzziest axes, 20-min focus sessions, ≥ 7-day spacing advice. *Amended (Phase AI, AI.6b):* a "Working with AI" card appears after the required save download, never on share cards, and the results-talk helper (DESIGN §17.7) has a slot on the reveal screen.
- [x] **M1.18 pub** — export: SVG, 2× PNG, a share card at exactly 1200×630 CSS px (2400×1260 at 2×). The card has a toggle to hide any axis and never shows emotion lows or hidden axes (tests). *Amended (Phase AI, AI.6b):* notes text never appears on the card (test); the results-talk helper is linked from the share-card screen.
- [x] **M1.21 pub** — accessibility pass: axe 0 serious/critical on every route, a keyboard-only full session e2e, prefers-reduced-motion, 200% zoom, a contrast unit test. *Amended (Phase AI, AI.5):* the Notes for your AI builder routes join the route list.
- [x] **M1.22 pub** — Playwright e2e: a full `?fast=1` session; WebKit/iOS emulation of save download and upload (M1 acceptance 4). *Amended (Phase AI, AI.7):* the WebKit round trip covers `brief_prefs` if AI.7 lands first; if M1.22 lands first, AI.7 re-runs it as its own acceptance.
- [x] **M1.Q both** — retest priors ρ_k(s) (§7.8) applied when re-scoring multi-session saves. *(done: library; rescoreSessions applies §7.8, retest_v1 golden parity 1e-9)*
- [x] **M1.23 pub** — RT jitter self-test page; the **user** runs it on a 120 Hz Mac (< 5 ms). *(done 2026-10-03: Chrome on a 120 Hz Mac passes, with onset p95 0.75 ms. RT uses the event timestamp, guarded to ≤ 25 ms lag. Safari shows a ~205 ms event-clock offset, so it falls back to the handler clock.)*
- [!] **M1.G7 user** — spot audit of 30 instances per procedural family (§4.4). Claude builds the procedural review page, and the user does the audit (~4 h total). *(Claude's half done: `npm run review` opens the dev-only review page, 30 items per family, and exports `familyAudits`. Bank ingest comes in M3.4.)*

## M3.1 — Item schema (moved ahead of M2)
- [x] **M3.1 bank** — item pydantic model + JSON Schema (G1) matching §12, the status lifecycle, `hb promote` gate plumbing. The M1 Python twins emit §12-valid records. *(done: pydantic §12 records + schema/item-v1.json, lifecycle, `hb promote` gates, twin adapter carries sibling_group)*
- *M3.1b* (Phase AI, A23) is task **AI.2**: additive item-v1 tags, specified in the Phase AI section below. It blocks M3.5, M3.6 and M3.7.

## M4 — Calibration (algorithms offline-testable before M2)
- [x] **M4.1 bank** — Phase A: grid-posterior update of b that integrates over θ posteriors; Elo pretest updates. Acceptance: recovers b within SE on simulation. *(done)*
- [x] **M4.2 bank** — Phase B: 2PL MML per axis with fixed anchors and a lognormal prior on a. Acceptance: at n = 500, RMSE(b) < .15 and RMSE(a) < .2. *(done; the RMSE(b) < .15 criterion holds on the seed mean under a correctly specified b prior but is fragile per seed; revisit in M4.6)*
- [x] **M4.3 bank** — linking: anchor drift check and Stocking–Lord. Acceptance: an injected shift is recovered within 0.05. *(done)*
- [x] **M4.4 bank** — QA rules §4.5 + distractor analysis §4.3 + report thresholds → quarantine. Acceptance: an injected negative-a item is quarantined. *(done; see A19)*
- [x] **M4.5 bank** — Σ re-estimation from disattenuated posteriors + nearest-PD. Acceptance: Frobenius error < .1 at N = 2,000. *(done under A19: relative Frobenius error 0.085)*
- [x] **M4.6 bank** — M4 acceptance simulation: 300 users, r(b̂, b) ≥ .9, drift < 0.1.
- [x] **M4.7 bank** — retest model ρ_k(s) estimation, plus re-scoring from raw responses. Acceptance: ρ recovery in simulation. *Amended (Phase AI Part 2, only if approved; AI.20):* also estimates the between-session drift κ per axis, replacing κ = .01 per month [SPEC].
- [x] **M4.8 bank** — calibrate the non-2PL models: RT β/σ, PS location/scale, GRM thresholds, Fermi δ, CAL standardisation.
- [x] **M4.9 bank** — nightly falsifiable-check report (F1, F3, F4, F7, F8, F10, F11) with thresholds and injected-violation tests; Mantel–Haenszel DIF (§13). *Amended (Phase AI Part 2, only if approved; AI.20):* the nightly report adds F12, F13, F21 and F21-K (from recomputed zones; no notes or preferences are read).
- [ ] **M4.10 bank** — write versioned item_parameters, publish param_version/bank_version, re-score recent sessions (after M2.1; DB adapter tested locally).

## M2 — Backend (SQL written + tested locally; deploy needs user)
- [x] **M2.0** — choose the local Postgres engine (brew postgresql@17 if the user installs it, else pip `pgserver` or PGlite) with stubbed anon/authenticated roles and a Vault shim. *(built on branch `wf6/m2`, unmerged: the DB gate cannot start Postgres on this host)*
- [x] **M2.1 pub** — migrations: §12 schema + mirror, rate, survey and exposure-log tables; RLS on **every** table; default privileges revoked; EXECUTE revoked except whitelisted RPCs; SECURITY DEFINER functions with `search_path = ''`. RPCs: start_session(device, save), next_item, submit, finish, report_problem, rescore(save), delete_my_data, mirror_put/get. Add `item_families.sibling_group` (text not null, default family_id); the server selector (M2.2) excludes by it per session. *Amended (Phase AI, AI.26):* `brief_prefs` never reaches the server (RPCs reject a payload containing the key; no notes tables). *Amended (Phase AI Part 2; the default is to add it during M2.1 even before Part 2):* `rescore(save)` also returns `eap[axis]` (own-axis, practice-adjusted, eligible sessions only) and facet EAPs, with a parity test against the client zone engine; `item_families` gains the `topic` and `curriculum_level` columns of AI.2. *(built on `wf6/m2`, unmerged. Before merge: rescore must not leak single-answer verdicts, and owner decisions are needed; see PROGRESS)*
- [x] **M2.2 pub** — PL/pgSQL scoring: EAP grid (equal weights, 61 points) in `sessions.state`, correlated MAP at finish (golden parity 1e-6), selection SQL with the 0.25 exposure cap, pretest slots (≤ 10%, Thompson sampling), calibration_eligible at finish. *Amended (Phase AI Part 2, only if approved; AI.21b):* facet-weighted item selection in goals sessions only, keeping the 0.25 exposure cap and the per-session sibling exclusion.
- [x] **M2.3 pub** — per-session HMAC saves (A16), Vault key + kid rotation, unverified path. *Amended (Phase AI, AI.26):* the per-session HMAC covers session data only, so editing preferences never marks a session unverified (test).
- [x] **M2.4 pub** — local tests: anon cannot select any table; anon can EXECUTE only whitelisted RPCs; no payload contains `key` (fuzz 1,000 items); tampered save → unverified; rate limits (5 sessions/day per hashed IP+salt, 200 items, ≥ 2 s/item average). *Amended (Phase AI, AI.26):* a fuzz of 1,000 random saves finds no `brief_prefs` key in any RPC body or mirror blob, and the RPCs reject a crafted payload that contains it.
- [x] **M2.5 bank** — `hb load push`, `calibrate.yml` (exits cleanly when `SUPABASE_DB_URL` is unset), `backup.yml` (restore round trip tested locally, keep 8), nightly archive/compaction, DB-size check.
- [x] **M2.7 pub** — front-end integration: supabase-js; start/next/submit/finish flow; static fallback; unverified-save UI; Report-a-problem button (5 categories); optional 2-question survey; deletion and mirror UI. *Amended (Phase AI, AI.26):* `toUploadPayload()` strips `brief_prefs` before every network call; the mirror stores the stripped file and the UI says so (DESIGN §17.7 `mirror`); the save dialog carries the anti-coercion text; Report-a-problem gains a category "someone asked me for my notes" (6 in all; it is not an item category and never counts toward quarantine, DESIGN §4.5); the privacy notice says notes preferences stay on the device.
- [!] **M2.6 user** — Supabase project, secrets, Vault HMAC key, age keypair, CAPTCHA keys, region; then the p95 < 300 ms latency check against the live project.

## M3 — Knowledge & verbal banks (bank)
- [x] **M3.2** — verifiers: z3 logic games, RC passage-dependence (no-passage rate logged in `verification`, reject > 1.5 × chance), citations G5, sensitivity lint G6, license allow-list + 8-gram overlap lint F9 (the anchor corpus needs the user). *(done: z3, RC no-passage, G5, G6, F9. F9 returns not_run until the anchor corpus exists)*
- [x] **M3.3** — solver gate G4 (Claude now; Ollama adapter for ≥ 2 model families).
- [x] **M3.4** — `hb review` (Typer + FastAPI :8765); `--take` stores author responses flagged and excluded from calibration.
- [x] **M3.6** — procedural logic-game generator (Z3, 2–500 models per setup). **Blocked by AI.2** (Phase AI, A23): the generator emits the item tags (`topic`, `curriculum_level`, `notation[]`); if it landed first, AI.2 adds a retag pass by re-running it.
- [x] **M3.7** — `hb gen`, `hb verify`, `hb push` CLIs (§14.5); `fact_volatility` field (fast facts only in Fermi). **Blocked by AI.2** (Phase AI, A23): `hb gen` emits the item tags; if it landed first, AI.2 adds a retag pass for its outputs.
- [ ] **M3.8** — anchor pipeline: NAEP released items (per-item rights check) → p → b priors; 10–20 anchors per axis.
- [x] **M3.9** — testlet random effect γ ~ N(0, .3²) in both scorers (§7.1) before testlet items go live.
- [~] **M3.5** — authoring batches, per axis at S = 3: ≈ 162 items for each of the 7 finite v1 axes (LR, RC, VOC, KST, KHU, KAP, + LG pool), plus Fermi. Each batch passes G1–G6 and gets an audit-bound record (G7 needs the user). **Blocked by AI.2** (Phase AI, A23): each batch template emits the item tags of A23 (proposal §5.1) that apply to its axis: `topic`, `curriculum_level`, `notation[]` (LR/LG), private `jargon_terms[]`, and for LR/RC the `question_type` and `inference_steps`. *(2026-10-02: 972 draft items for LR/RC/VOC/KST/KHU/KAP with G4 panel records. 119 Fermi items are on branch `wf8/m35b`. The audit questions whether the panel records are truly independent; see PROGRESS. The LG pool is still to do.)*

## M5 — Tier (b) Fermi + calibration UI
- [~] **M5.1** — Fermi items (≥ 2 sources, uncertainty in dex, down-weighting above 0.15 dex, reject above 0.3), the magnitude + unit entry UI, 80% intervals, server-side Brier. *(library, Python/TS scoring parity, entry UI and dev fixtures are done; server-side Brier waits on M2)*

## M6 — Tier (c) (v2)
- [x] **M6.1** — appraisal vignettes + rule engine (100% rule-key agreement; AI-vs-theory ≥ 85% or reject), R-5.6.2 label and tooltip. *(merged 2026-10-03: 60 vignettes, the rule engine, the panel gate and the UI. 5 vignettes whose text changed need a panel re-run)*
- [~] **M6.2** — SJT + key blending (§5.2), circularity guard, F6 check (expert ratings need the user or recruited raters). *(built 2026-10-06: 60 SJT drafts, 57 panel-keyed. Expert ratings are owner-pending; dev route only)*
- [~] **M6.3** — RAT with a compound check (corpus licensing is the user's call) and spelling variants. *(2026-10-06: real permissive resources; 146 triads, G4 146 pass, G6 145 + 1 soft; dev route only. Open-compound frequency is a flagged proxy, because Google 2-grams are 324 GB, over the cap. Stratum 1 is empty under prior v2.)*
- [~] **M6.4** — AUT with in-browser MiniLM, the "don't type personal info" warning, opt-in Ocsai consent, hatch rendering. *(built: in-browser MiniLM scoring, aut-v0 parameters provisional; Ocsai off; dev route only)*

## Phase AI — "Notes for your AI" (Part 1 approved 2026-09-29; Part 2 needs separate approval)

A person builds short, plain notes on their own device and pastes them into their own AI assistant, so it explains things the way they want, topic by topic. Test results feed in only where checks on real data show that they are safe and useful.

- **Spec:** decision D13, DESIGN §17 (R-17.1–R-17.14, copy drafts in §17.7), the checks F12–F21-K in DESIGN §16, and ADRs A20–A23 plus the draft A24 above.
- **Annex (private repo):** bank `docs/proposals/ai-notes-v2.md`, cited below as "proposal §x". It holds the notes wording (§4.2), zone tables (§4.4), item tags (§5.1), gate metrics E1–E22 (§7.3) and worked examples (§4.9). It stays normative for those until AI.4 (wording, in `web/src/brief/grammar.ts`) and AI.12a-run (metrics, in the bank harness) copy them into code; after that the code and its tests are the source of truth.
- **Sizes:** **S** ≤ 1 agent session, **M** 1–2, **L** 3 or more. Each task is one commit on `dev` citing R-17.x and A20–A24 (CLAUDE.md).
- **Numbers:** Part 1 is 15 tasks (5 M, 10 S; AI.13 and AI.12c are the user's). Part 2 is 19 tasks and needs its own approval.
- **Critical path:** AI.3 then AI.2 land before any bank batch that emits ItemRecords (M3.5, M3.6, M3.7). Tags are free now and expensive after those batches. The smallest valuable slice is AI.4 + AI.5 + AI.6, with AI.7: it works for everyone, before M1.R, with no test data and no dependency on any bank task.
- Existing tasks named as dependencies are unchanged unless listed under "Amendments to existing tasks" below.

### Part 1 (approved 2026-09-29)

**Stage AI-0: Foundations (before the bank lane runs M3.5, M3.6 or M3.7)**
- [x] **AI.1 pub** — **[S]** Plan docs. *(done 2026-09-29)*
  - DESIGN: the D13 row, new §17 (proposal §10, R-17.1–R-17.14, plus the copy drafts in §17.7), §16 rows F12–F21 and F21-K.
  - ROADMAP: ADRs A20–A23 and the draft A24; Part 1 and Part 2 as separate backlogs; the amendments to existing tasks; the Phase AI open questions.
  - PROGRESS.md is not edited by this commit. The session that merges it updates the "Needs you" items (proposal §11) and the "Next batch" ordering (AI.3 then AI.2 ahead of M3.5, M3.6 and M3.7) in PROGRESS.md.
  - Deps: the user's OK on Part 1 (given 2026-09-29).
  - Acceptance:
    - the A13 lint passes on every new string (DESIGN §17 and its copy drafts, the F12–F21-K rows, the D13 row, this section, A20–A24);
    - every R-17.x is cited in the acceptance of at least one Part 1 task below (R-17.1–R-17.14), checked on the acceptance text and not on task headings;
    - cross-references resolve (AI.2 blocks M3.5/M3.6/M3.7; AI.26 amends M2.1/M2.3/M2.4/M2.7); this is checked by `web/scripts/docs-phase-ai.test.ts`.
- [x] **AI.3 both** — **[S]** Topic taxonomy and quant groups (A23).
  - `schema/topics-v1.json`, with topics as children of facets and `other/` self-settable topics.
  - The template → group map in `web/src/tasks/quant/topics.ts` with a bank twin; `group_version` `g1`; `topics-aliases.json`.
  - The pub half is all that AI.5 needs.
  - Deps: AI.1.
  - Acceptance:
    - each of the 53 quant families maps to exactly one group, and each group has ≥ 6 families;
    - a deny-list test (no topic names a general ability, reading, memory, speed or language background);
    - labels are digit-free and contain no school-level words (R-17.3);
    - prefix-consistency and alias-resolution property tests;
    - A17 sync test in both repos.
- [x] **AI.2 both** — **[M]** M3.1b: item-v1 additive tags (proposal §5.1, A23).
  - Pydantic fields, a `schema/item-v1.json` minor bump, `rows.py` routing, the `hb promote` requirement, and a note on the M2.1 columns (`item_families.topic`, `item_families.curriculum_level`).
  - Deps: **AI.3**, M3.1 ✔. **Blocks M3.5, M3.6 and M3.7.**
  - Acceptance:
    - existing records still validate;
    - G1 rejects new VOC/RC/K/LR/LG records missing required tags, and checks prefix consistency with `facet`;
    - unknown topic and level values are rejected;
    - `PublicPayload` never contains private features or `jargon_terms`; `curriculum_level` is never exported into notes (R-17.3);
    - an M3.5 batch template and the M3.6/M3.7 outputs emit the tags, or a retag pass covers outputs that landed first.

**Stage AI-1: Notes without results (static MVP; parallel with the bank lane)**
- [x] **AI.4 pub** — **[M]** `web/src/brief/` core (A20).
  - `grammar.ts` (`hb-brief/1` templates, each with a version and a status), `render.ts` (short, long, SKILL.md, rules, JSON), `parse.ts` (all released versions), `lint.ts`, an ASCII normaliser.
  - `surfaces.json` (limits, per-destination install and removal steps, smoke dates, `checked`), `schema/brief-v1.json`, and `npm run dump:briefs` for the harness.
  - Deps: M1.20 ✔, AI.3 (pub half).
  - Acceptance:
    - the generator invariants of proposal §7.2 except the zone properties, including the closed grammar, ASCII, no URLs and digits only in YYYY-MM (R-17.2, R-17.3) and the self-expiring header with the locked clauses first (R-17.6);
    - round trip: `parse(render(p)) = p` for every form on 10k random notes, and every released `hb-brief/N` parses (R-17.11);
    - JSON mirrors text;
    - `surfaces.json` carries dated install and removal steps, and a staleness warning fires when `checked` is more than 120 days old (R-17.10);
    - bundle test (`web/src/brief/` is not in light barrels).
- [x] **AI.5 pub** — **[M]** The "Notes for your AI" builder, no results needed (A20, DESIGN §17).
  - Context presets; self-set topics with the floor rule; T0, CC, LANG, W, FMT, VOICE and AC lines; mode and length; interests; constrained edits and custom lines.
  - Live preview with a per-destination counter and no silent truncation; the drawer (default and self-set templates).
  - Destination picker with download-first, per-OS install and removal steps; "Remove my notes settings".
  - Copy: provider, anti-coercion, placement, claim; "what to look for" and troubleshooting.
  - Also: the control-word card, the data-free snippet and `for-ai.md`.
  - Deps: AI.3 (pub), AI.4, M1.17 ✔. It uses M1.15's 18+ gate component when that lands; until then it runs storageless.
  - Acceptance:
    - Playwright copy and download on chromium, WebKit and iPhone 13;
    - **included in M1.21's route list**: axe 0 serious or critical, 320 px reflow with no horizontal scroll, 200% zoom, `prefers-reduced-motion`, and an `aria-live` announcement when copying succeeds (R-17.14);
    - keyboard-only e2e;
    - **zero network requests** on the route (interception test) (R-17.1);
    - a storage snapshot shows interests and custom text never reach storage, and **the under-18 path writes nothing from the builder** (Playwright) (R-17.12);
    - fixed clauses and CC cannot be unticked; tiers and pre-ticking follow R-17.7 (self-set lines pre-ticked and badged experimental until the smoke gate passes; the floor rule renders a self-set "New to me" on the two lowest quant groups as ask-first with the floor-rule note); a custom line is checked for URLs, digits and trait wording, flagged, and never saved (R-17.2);
    - the drawer shows basis, how sure, what research does and does not support, and what was checked (R-17.8);
    - provider warning, anti-coercion notice, placement advice and "What to look for" appear above the copy button, and the dated statements carry their `checked` month (R-17.10); the claim string is shown in the builder, and no other string implies benefit (A22);
    - the builder reads no results and renders no results-derived line: the grammar has no such line type before Part 2 (test) (R-17.5);
    - install blocks contain no `#` and use the refuse-to-overwrite form (test);
    - every string in DESIGN §17.7 assigned to AI.5 matches the table word for word (test);
    - A13 and brief lint pass.
- [x] **AI.6 pub** — **[S]** Checker, out-of-date diff and withdrawal notice.
  - Deps: AI.4.
  - Acceptance (R-17.11):
    - 100% of a hostile or odd corpus of ≥ 50 cases is flagged (injections, URLs, zero-width/bidi characters, homoglyphs, digits, trait wording (R-17.2), A13 terms, over-length, off-grammar lines);
    - 0 false flags on 10k generated notes;
    - it parses fixtures from every released `hb-brief/N`;
    - the diff marks changed lines correctly;
    - the load-time withdrawal notice fires exactly when a fixture gates file withdraws a copied line.
- [x] **AI.6b pub** — **[S]** "Talking about your results with an AI" helper and the reveal card (R-17.13).
  - Deps: AI.4, M1.R and M1.18 (slots).
  - Acceptance:
    - 0 A13 hits, and the strings match DESIGN §17.7 (`reveal-card`, `results-talk`, `results-preamble`, 340 characters) word for word;
    - on the reveal and share-card screens, the preamble copy button and the "never paste your save file" line are visible (e2e) (R-17.13);
    - the card appears only after the save download;
    - the share-card renderer never contains notes strings (M1.18 test);
    - E22 is in the smoke gate.
- [x] **AI.7 pub** — **[S]** `brief_prefs` (proposal §5.5), the fit log and the prefs-only save.
  - Deps: M1.17 ✔; Q3.
  - Acceptance:
    - the schema admits no free-text string (property) (R-17.12);
    - merge is idempotent, commutative and associative (fast-check);
    - fit-rule tests (window of 4 in 180 days, net ±2, clamping, no-setting base);
    - scoring isolation: `rescoreSessions` output is byte-identical with or without `brief_prefs`, and the fit log never enters scoring (R-17.4, R-17.12);
    - a prefs-only save with `sessions: []` validates;
    - stored topic IDs resolve through the alias map;
    - the WebKit save round trip covers the preferences, in M1.22 or re-run here if M1.22 landed first;
    - the localStorage variant is tested if Q3 chooses it.

**Evidence now**
- [ ] **AI.8s bank** — **[M]** Zone-rule simulation (proposal §4.4, §7.4; A21, R-17.5).
  - It drives the **real M1.4b CAT** (A15 budget, randomesque selection, coverage floor, sibling exclusion), through `npm run sim:cat` output or a Python port with parity.
  - It runs the M1 and post-M4 misspecification sweeps for 1 and 3 sessions.
  - Committed to bank `studies/zone_rule/` with fixed seeds.
  - Deps: the M1.4b decision (decided 2026-09-29: option 1), **M1.15** (the QR coverage-floor fix), AI.3.
  - Acceptance:
    - tables are regenerated from M1.4b and published;
    - the sweeps count `calibration_eligible` sessions only, and ineligible ones count as practice exposures (R-17.5);
    - the smallest passing σ_rel per sweep is reported, or "none"; whatever it says, M1 ships no results-derived line on uncalibrated priors (R-17.5);
    - the proposal §4.4 headline is restated from the output;
    - reruns are byte-identical.
- [ ] **AI.12s bank** — **[S]** The E1 accuracy set.
  - ≥ 400 paired items: procedural QR from a reserved harness seed range, never used in sessions, plus an openly licensed science MC set chosen after a licence check (candidates: ARC, MMLU; licences to be verified).
  - Deps: none beyond the M3.3 adapter format.
  - Acceptance:
    - licences are recorded in provenance;
    - harness seeds are disjoint from the scored and practice ranges (test);
    - no item is reachable from pub (CI).
- [ ] **AI.12a-run bank** — **[M]** Smoke harness run: every arm in proposal §7.3, the positive controls and the trait-worded arm (A22, R-17.9). Outputs are stored unjudged.
  - Deps: AI.4 (`dump:briefs`), AI.6b, AI.12s, **M3.3** (Ollama adapter), **Ollama install (user)**.
  - Acceptance: seeded and reproducible; model versions hashed; every arm produces outputs; a label sample is exported for AI.13; the harness README restates the metric definitions E1–E22.
- [ ] **AI.13 user** — **[S]** About 200 labels (3–4 h) and a think-aloud with about 10 people on the AI.5 build (F20).
  - Acceptance: the explicit pass or fail rules in proposal §7.5. Comprehension of what the notes tell the AI is part of the think-aloud (R-17.8).
- [ ] **AI.12a-gate bank** — **[S]** Apply the judge, compute E-metrics with CIs, check the positive controls, and write statuses to `brief-gates.json`. Copy statuses only to pub (A22, R-17.9).
  - Deps: AI.12a-run, AI.13.
  - Acceptance:
    - every E-metric is reported with a CI;
    - statuses cover the positive-control, multi-turn and headless arms, and the surface arm is recorded by AI.12c; no line type is marked shipped without a pass (A22, R-17.9);
    - a family whose positive controls are missed is marked invalid;
    - the pub test shows statuses gate rendering;
    - pub's copy has no numeric metric fields.
- [ ] **AI.12c user + Claude** — **[S]** Surface smoke per destination (proposal §7.3; R-17.9, R-17.10).
  - Deps: AI.5, AI.12a-gate, **the user's OK and free accounts**.
  - Acceptance: pass rate, Skill trigger rate and date are recorded per destination in `surfaces.json`, and the drawer shows them.
- [ ] **AI.26 pub** — **[S]** M2 privacy amendments (R-17.1, R-17.12); executed with M2.
  - `toUploadPayload()`; RPC rejection of `brief_prefs`; the mirror stores the stripped file; the per-session HMAC scope excludes preferences.
  - Privacy-notice text; anti-coercion text in the save dialog; a Report-a-problem category "someone asked me for my notes"; no notes tables or telemetry.
  - Deps: M2.1, M2.3, M2.4, M2.7.
  - Acceptance:
    - an M2.4-style fuzz (1,000 random saves) finds no `brief_prefs` key in any RPC body or mirror blob;
    - editing preferences never makes a session unverified (e2e);
    - the RPCs reject a crafted payload containing the key;
    - the "someone asked me for my notes" report carries no item and never counts toward item quarantine (DESIGN §4.5);
    - a schema grep finds no notes table.

### Part 2 (needs separate approval)

**Entry conditions:** Part 1 is done; F12 passes on real data at the chosen σ_rel; the gate passed for the relevant line types; the user's OK. No Part 2 task starts before all four hold.

**Stage AI-2: Measured math suggestions**
- [ ] **AI.8 both** — **[M]** Zone engine (A21): pub plus bank twin; the floor rule, the cap, hysteresis and the basis templates (R-17.4, R-17.5, R-17.7).
  - Deps: AI.8s, M4.6, F12 (AI.20), AI.12b.
  - Acceptance:
    - the zone properties of proposal §7.2;
    - golden parity 1e-9;
    - the M2 `rescore` RPC's `eap[axis]` matches the client to 1e-6;
    - E19 passes.
- [ ] **AI.9 both** — **[S]** Signed calibration and the C1/C2 suggestions.
  - Deps: M1.15, AI.8.
  - Acceptance:
    - parity 1e-9;
    - no suggestion when n < 160, the 96% CI includes 0, or |bias| < .05;
    - a **published power curve** (offer rate by |bias| ∈ {.05, .08, .10, .15} and n ∈ {80, 120, 160, 240}) with a false-offer rate ≤ 5% at bias 0.
- [ ] **AI.10 pub** — **[M]** Suggestions in the builder: "from your answers" next to picked topics; basis-specific drawers; diff and review-by banners (R-17.7, R-17.8).
  - Deps: AI.5, AI.7, AI.8.
  - Acceptance:
    - inferred-basis drawer strings never contain "you solved" or a topic-item count;
    - no estimates, SD units or percentiles;
    - never pre-ticked;
    - ≤ 2 inferred lines, and T2 excludes them;
    - the JSON mirrors the text;
    - axe; lint.
- [ ] **AI.11 pub** — **[S]** Sharpen (proposal §5.4).
  - Deps: AI.16, M4, AI.8, AI.10.
  - Acceptance: pool and spacing tests; the pool cost is shown; the forecast is calibrated within ±10 pp; fake-clock e2e.

**Stage AI-3: Local evidence**
- [ ] **AI.14 bank** — **[M]** Fixed-text set for Arm F (6 groups × 3 settings + generic).
  - Acceptance: key-fact checks pass; manipulation d ≥ .8; public-safe.
- [ ] **AI.15 pub** — **[M]** Taste test and a local Arm F pilot, with Project/Gem placement where possible and the preamble limitation stated.
  - Acceptance: pasted text is never persisted or sent (R-17.12); order is uniform; practice-only items are disjoint from scored items; axe.

**Stage AI-4: Richer math and goals mode**
- [ ] **AI.16 both** — **[L]** Adult-relevant quant templates and practice-only sets. It can be pulled forward on its own, because it grows the QR pool.
  - Acceptance:
    - A1 gates per template;
    - ≥ 5 variants and ≥ 3 sibling sets per group;
    - scored QR pool ≥ 80 families;
    - practice-only sets are disjoint from the scored pool;
    - M1.4b parity still passes.
- [ ] **AI.17 both** — **[L]** Goals mode (A24, contract v3).
  - Deps: AI.11, AI.16, M1.14 ✔.
  - Acceptance:
    - A1 cross-check with 0 disagreements;
    - ≥ 90% of simulees reach ≥ 5 items on 2 chosen groups within 2 sessions;
    - ladder-probe agreement ≥ .80;
    - lifetime exclusion unchanged.

**Stage AI-5: Knowledge, logic and language**
- [ ] **AI.18 bank** — **[S]** Lexical and passage feature extractors, with a licence register. Deps: AI.2, **Q11 (user)**.
- [ ] **AI.19 bank** — **[M]** Explanatory IRT (proposal §5.3), which also delivers the DESIGN §16 F1 report and automated F14. Deps: M4.2 ✔, M3.5 live with n ≥ 100 per item, AI.18.
- [ ] **AI.20 bank** — **[M]** τ (F13), κ (amends M4.7), the feasibility simulation, and F12, F13, F21 and F21-K in the M4.9 nightly report. If M4.9 has already landed, AI.20 adds them as a follow-up.
  - Deps: M4.7, M4.9, M2 data.
  - Acceptance:
    - τ recovered within ±.05 at N = 2,000;
    - an injected +.5 topic shift trips F12;
    - the feasibility table is published;
    - per-facet pool survival under AI.21b is checked, and M3.5 counts are raised if needed;
    - no notes or preferences are ever read (R-17.12).
- [ ] **AI.21 both** — **[M]** Topic × level aggregates (Q12) and topic summaries in the M2 `rescore` RPC. Deps: M4.10, M2.1.
- [ ] **AI.21b pub** — **[M]** Facet-weighted finite-item selection (an M2.2 amendment; goals sessions only).
  - Deps: M2.2, AI.17.
  - Acceptance:
    - in an SQL simulation, ≥ 90% of targeted sessions give ≥ 4 items in the chosen facet;
    - the 0.25 exposure cap is never exceeded (property);
    - sibling exclusion is intact;
    - parity with a TS reference.
- [ ] **AI.12b bank** — **[L]** The full gate (proposal §7.3), before any results-derived or AI-5 line type (A22, R-17.9).
- [ ] **AI.22 pub** — **[M]** Notes v2: observed knowledge-facet lines, observed NT, W suggestions next to own settings, and P7 behind a flag (R-17.4).
  - Deps: AI.12b, AI.19, AI.20, AI.21, AI.21b, M3.9.

**Stage AI-6: Real-user evidence (with M2)**
- [ ] **AI.23 pub** — **[L]** Pooled trial kit: Arm F and Arm B (proposal §7.7), with separate consent and uploads of numbers and enums only.
  - Deps: M2.1, M2.7, the privacy notice (user), AI.14–AI.16, **Q14 (the ethics route)**.
  - Acceptance:
    - Latin-square balance;
    - `performance.now()` timing;
    - no pasted text in any payload (fuzz);
    - withdrawal deletes trial rows;
    - placement is recorded.
- [ ] **AI.24 bank** — **[M]** Pre-registered analyses and the "Does it help?" page (F18, F19). Deps: AI.23, OSF registration (user).
- [ ] **AI.25 both** — **[M]** Optional word-knowledge probe (F15). Deps: AI.18, AI.23.

**Stage AI-7: Optional, demand-gated**
- [ ] **AI.27 pub** — **[M]** Local MCP server, read-only.
  - It reads an exported `hb-brief/1` JSON only, runs over stdio, and has no write tools.
  - Deps: Q15; a check of how the current MCP spec carries `instructions`.

### Ordering at a glance
```
PART 1 (approved)
before the bank lane runs M3.5/M3.6/M3.7    AI.1 - AI.3 - AI.2 -> M3.5 / M3.6 / M3.7
M1 (parallel to the bank lane)              AI.4 - AI.5 - AI.6 - AI.7          AI.6b (after M1.R, M1.18)
evidence now                                AI.8s (after M1.15; M1.4b is decided)
                                            AI.12s - AI.12a-run - AI.13 - AI.12a-gate - AI.12c
with M2                                     AI.26

PART 2 (separate approval; needs F12 on real data and the gate)
                                            AI.8 - AI.9 - AI.10 - AI.11
                                            AI.14 - AI.15      AI.16 - AI.17 - AI.21b
                                            AI.18 - AI.19 - AI.20 - AI.21 - AI.12b - AI.22
                                            AI.23 - AI.24 - AI.25      AI.27 (optional)
```

### Amendments to existing tasks
Applied inline to each task above, marked "Amended (Phase AI …)".
- **Part 1:**
  - M3.5, M3.6, M3.7: blocked by AI.2 (A23).
  - M1.R: card slot after the save download; results-talk helper slot.
  - M1.18: notes text never appears on the card; the results-talk helper is linked from the share-card screen.
  - M1.21: the builder routes join the route list.
  - M1.22: the WebKit round trip covers `brief_prefs` if AI.7 lands first.
  - M2.1, M2.3, M2.4, M2.7: AI.26 (strip rule, HMAC scope, fuzz, mirror copy).
- **Part 2 (only if approved):**
  - M2.1/M2.2: `rescore` returns `eap[axis]` and facet EAPs (the default is to add this during M2.1); facet-weighted selection (AI.21b).
  - M1.15: the honour-code sentence once results feed the notes.
  - M4.7: estimate κ. M4.9: F12, F13, F21, F21-K.

### Fallbacks if the bank lane runs first
- **M3.6/M3.7 land before AI.2:** AI.2 adds a retag pass for their outputs (for procedural LG, re-running the generator); M3.5 still waits for AI.2.
- **M1.22 lands before AI.7:** AI.7 re-runs the WebKit round trip as its own acceptance.
- **M4.9 lands without F12/F13/F21:** AI.20 adds them as a follow-up.
- The proposal's fourth fallback (a delayed M1.4b decision) is obsolete: the user decided on 2026-09-29.

### Phase AI open questions
Numbered as in proposal §11. The defaults apply until the user decides otherwise; the user's answers go in PROGRESS "Needs you".
1. Approve Part 1 and the names: **approved 2026-09-29.**
2. Results-derived lines in M1: none. The proposal's preliminary sweep (proposal §4.4) found no σ_rel that passes; AI.8s re-checks this on the real CAT.
3. Where preferences live (Q3): an optional `brief_prefs` field in save 1.0 if Part 1 lands before M1 goes public; otherwise localStorage `hb.brief.v1` until the next save minor bump.
4. Pre-ticking: fixed clauses locked; T0 and self-set lines pre-ticked (self-set ones badged "experimental" until the smoke gate passes); results-derived lines never pre-ticked.
5. The M1.4b criterion: **decided 2026-09-29, option 1** (r ≥ .85 at 20 items/axis). AI.8s runs on the real CAT.
6. Evaluation spend: $0, with Claude subagents plus Ollama. A hosted paid model only with the user's approval (A6).
7. The user's time: about 200 labels (3–4 hours), a think-aloud with about 10 volunteers, and the surface smoke (2–3 hours on free accounts, or Claude driving the browser with the user's OK).
8. Bottom-rung build lines: the floor rule. No results-derived build-up on the two lowest quant groups, ever. A self-set "New to me" there renders as ask-first until E3 passes with the θ = −2 persona.
9. M2 mirror: it stores the save without `brief_prefs`. The alternative is a separate consent question for backing them up.
10. Sustaining the math section (Part 2): adult-relevant templates plus practice-only sets (AI.16) before any ADR that lets procedural isomorphs reappear. AI.16 can be pulled forward on its own.
11. Lexical norms (Q11; Part 2, bank only): prevalence norms and AoA, with frozen wordfreq (CC BY-SA) as the fallback, pending a licence check. SUBTLEX-US only if its terms allow.
12. Public topic × level difficulty table after M4 (Q12; Part 2): aggregates only, cells of ≥ 5 items. Default: yes.
13. Language lines: self-set word and sentence lines now. Measured suggestions only if F14, F15 and the gate pass; the odds are put below even.
14. Trial governance (Q14; Part 2): OSF registration, and no publication outside the site. For journal publication later: an academic collaborator's institutional review before enrolment.
15. MCP server (Q15): defer until people ask; read-only if built.
16. Posterior level for zones (Part 2): one-sided .90 with the σ_rel floor of .25 after M4. AI.8s also reports .95. Change only through F12.

## Owner decisions 2026-10-01
- **`finish.include_correct` = false.** Saves never carry per-item correctness for server-scored items (R-11.1). `rescore` must also not leak single-answer verdicts; this blocks merging M2.1.
- **Loading a save:** the file's notes settings (`brief_prefs`) win on the session ready screen, the same as in the notes builder (AI.7). This is a follow-up code change.
- **RC and VOC items carry no topic tags.** `hb promote` requires `topic` only for the TOPIC_AXES (AI.2 follow-up).
- **Privacy page:** deferred until M2 collects data.
- **A6 amended (solver gate G4).** Finite items need no non-Claude or Ollama solvers. Instead a panel of Claude models (Sonnet 5.5, Opus 5.5, Fable 5.1) solves each item independently: no key, no author notes, no other solver's answer, and each must quote its evidence. A solver *disagrees* if its answer differs from the key or it marks the item ambiguous. Rules:
  - all 3 agree → **pass**;
  - only Sonnet disagrees → **pass with a soft flag**, and the item joins the G7 human-audit sample;
  - Opus or Fable disagrees, or 2 or more disagree → **hard flag**, blocked until rewritten or human-reviewed.

  The solves run as Claude Code subagents (no API keys, $0 extra). Ollama is optional, an extra check for later. **Follow-up code change:** update M3.3's G4 rule and adapters to match.
- **RAT word resources (owner decision 2026-10-06; bank docs/rat-corpus.md §7, all recommended options):**
  - **Use the permissive set**, cached outside both repos: Google Books Ngram v3 (CC BY 3.0), Open English WordNet (CC BY 4.0), the Moby compound list (public domain) and VarCon (MIT-like). Only per-item evidence goes in the bank, and the app gets a credits line.
  - **wordfreq (CC BY-SA)** is allowed as a secondary signal, with per-item values only.
  - **Not used:** COCA/iWeb and Norvig/Web1T. SUBTLEX is used only via wordfreq.
