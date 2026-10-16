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
- **A10 — Speed/memory models.** WM: GRM with three graded items per session (digits forward, digits backward, Corsi). RT: τ̂ = β_task − median log-RT of valid trials, entered as a Gaussian observation with SE from MAD/√n; at least 20 valid simple trials and 30 valid choice trials. PS: two Gaussian observations on θ_Gs (coding log-rate, reading log-wpm). The reading observation is dropped if the gate fails. Every location/scale is **provisional** until M4.8. *Amended 2026-10-13 (owner: "one try at each length unless the user gets it wrong, then they get a second attempt"):* the three span blocks are reactive (span 1.2.0, `+py` in the bank): one trial per length, a second attempt only after a miss, a second miss ends the block. The graded outcome has the same distribution as under two fixed trials (1 − (1 − p)² per length), so the GRM, its thresholds and the block's information stand; see "Owner decisions 2026-10-13".
- **A11 — Procedural families.** `family_id` = a stable hash of the structural parameters: the canonical polycube, the matrix rule set, the series rule family plus coefficients class, or the quant template. `item_id` = `i:<fam>:<genver>:<seed>`, so parameters can be regenerated from the id. Rotation: at most one pure-mirror distractor; every option pair is canonicalised and must be distinct. *Amended 2026-09-27:* `family_id` is the same function in both repos (the TS cyrb128 over TS-canonical JSON, ported bit-exactly to Python). Python twins tag their generator version `<ver>+py`, so an `item_id` names exactly one implementation. For re-scoring a saved TS `item_id` (R-8.1), the server must run the TS generator or keep the payload. Quant `family_id` is per stem-template variant (53 families). Per-topic families would exhaust QR after about 3 sessions under §7.7 exclusion, so near-isomorph siblings are excluded per session instead (M1.14).
- **A12 — Display honesty in M1.** Rings are labelled in SD units and marked "provisional". Percentiles appear only after M4 linking and N ≥ 500. Muting uses the θ = 0 rule (§9.5). "Distinctive peaks" use within-person contrasts θ_k − θ̄, whose 90% interval must exclude 0. Facet scores are a unidimensional EAP on facet items with the axis posterior as prior, shown only at ≥ 5 items.
- **A13 — Language guardrail.** The lint bans clinical nouns (autism, ADHD, alexithymia, …) everywhere except the exact R-5.6.5 sentence, which is an allow-listed constant rendered only in the results footer and never on share cards. The word "clinical" in the §13 disclaimer is allowed.
- **A14 — Reading-speed passages in pub.** This is an ADR exception to the "no finite items in pub" rule: tier-b speed gate items, uncalibrated, as allowed by §14.3 M1's static pool. The Gutenberg header is stripped and provenance is recorded. Gate questions are verified by ≥2 independent Claude solves plus a span check.
- **A15 — M1 session.** The M1 block order is RT → Matrix/Series → Spatial → Memory → Quant → Coding/Reading, with Calibration embedded, for a target of about 25–30 min. Blocks loop until SD < 0.3 or the time runs out. All 17 spokes are shown, and unbuilt axes appear as "not measured" stubs. *Amended 2026-10-12 (owner: "go to six questions"; DESIGN §7.4):* the Quantitative part runs until six of its questions are answered, with at most two more shown when some run out of time, in the online and the device-only version alike; the session is planned at 28.5 minutes (27.5 and a minute for this), still said as "about 30 minutes". The owner's ceiling for a session is 60 minutes; the hard stop stays at 57 active minutes. See "Owner decisions 2026-10-12". *Amended 2026-10-13:* every question part runs to six answered questions (`plan-table.ts` `PART_MINIMUMS`; Reading Comprehension: two passages), and item selection has a start-up step and a wider aim (`engine/startup.ts`); the six parts typically take 29.5 minutes. See "Owner decisions 2026-10-13". *Amended 2026-10-15:* the first question of a part is aimed where the session's other parts (and a returning person's earlier sessions) say the skill is likely to be (`engine/xskill.ts`); the order of the parts is unchanged. See "Owner decisions 2026-10-15".
- **A16 — Save signing.** The server MAC is per session (session + anon_id), and the server refuses to sign a file that contains any unverified session. Calibration uses only DB rows deduplicated by session_id, never uploads (§8).
- **A17 — Cross-repo fixtures.** Non-secret fixtures flow bank → pub by copy: `golden/*.json` → `web/src/engine/__fixtures__/`. TS instance dumps go pub → bank `golden/ts_dumps/`. Sync scripts live in each repo, and each repo has a test that the copies match when the sibling repo is present.
- **A18 — Numeric-entry key and contract v2 (2026-09-28).** A numeric key is `{value: "<canonical rational>", tol: {abs|rel}}`, and a letter key is `{letter}`. This supersedes the DESIGN §14.6 ex. 2/3 shape `{value: 42, tol: 0}`. Families declare `kind: item | block`; each block sub-task is its own family (span_fwd/span_bwd/corsi, rt_simple/rt_choice4). A block's `score()` returns a BlockScore (an observation, or reasons, plus flags). For Gaussian blocks, `params.sigma` is τ_res. Every item carries `sibling_group`, used for per-session exclusion, and `time_limit_s = max(180, ceil(2.5·E[T]))` (§13). Saved item ids are regenerated only through `resolveItem()`, which requires an exact version match. Otherwise the stored correctness and the server params or payload are used. *Amended 2026-10-13:* the time limit is shown: every question that can run out of time has a timer and a warning in its last 30 seconds (`session/ItemTimer.svelte`); the limit rule is unchanged. A generator version this build keeps whole (the span blocks of 1.1.0) still resolves, so a save made before the reactive procedure keeps its Working Memory score (`registry.ts` `generatorOf`).
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
- [x] **M1.15 pub** — session flow (R-7.4, §10, §13, A15): consent + 18+ gate (the under-18 path writes nothing to storage), privacy/terms page, honour code, device check + RT input mode, blocks with interstitials, time-based progress ring, per-cluster checklist, break at 30 min, finish early, skip axis, hard stop, per-axis early stop SD < 0.3, and the confidence slider (floor 1/k for MC, 0 for entry; Brier). Practice mode (feedback, not counted). A `?fast=1` dev flag compresses timings; production builds ignore it (test). Playwright with a fake clock covers every listed rule. *Amended (Phase AI Part 2, only if approved):* the honour-code sentence "Your notes are only useful if the answers are yours" once results feed the notes. *Amended 2026-10-13 (owner):* the follow-up confidence slider is replaced by an optional five-point scale on the question screen, sent with the answer by its one submit button; unset = no rating; see "Owner decision 2026-10-13: the confidence on the question screen".
- [x] **M1.16 pub** — blob viz (§9, A12): linear radius; rings in SD units, "provisional"; Catmull-Rom closed with overshoot ≤ 0.1 ring, else cardinal(0.6) (numeric test); 20-curve fuzz + crisp mean; seriation matches brute force for K ≤ 10 and keeps clusters contiguous; muting rule; tier glyphs/hatch; not-measured stubs; bar/lollipop view (the screen-reader default); Okabe–Ito palette with ≥ 4.5:1 text contrast; no area or total in the DOM (test); drill-down to facet EAPs (≥ 5 items). *(done; the fuzz follows §9.3: 20 nested curves at θ ± z·SD. Amended 2026-10-11, UX-REVIEW D3: the θ = 0 reference ring keeps its heavier dashed line and has no “0 SD” label on the blob, the card or an export.)*
- [x] **M1.R pub** — reveal flow (§10): the blob builds axis by axis → credible distinctive peaks (A12) → drill-down → required save download with a beforeunload guard → share card → 3 procedural items with worked solutions. Results copy: disclaimer, the R-5.6.5 resource line, "vs other HumanBench takers" wording (hidden until A12 allows it), external norms (Brysbaert wpm, digit span, web-relative RT, each input type against its own reference: touch or keyboard/mouse, 2026-10-11), the Pace tooltip, and the "practice-adjusted" label. Retest-motivation UI: predicted shrinkage from §7.6, fuzziest axes, 20-min focus sessions, ≥ 7-day spacing advice. *Amended (Phase AI, AI.6b):* a "Working with AI" card appears after the required save download, never on share cards, and the results-talk helper (DESIGN §17.7) has a slot on the reveal screen.
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
  - 2026-10-11 (branch `deploy/m26`): the 18 migrations are applied to the owner's project with `npm run db:deploy` (ledger `supabase_migrations.schema_migrations`), the Vault key `save_hmac.k2026a` exists and `hb.signing_check()` is ok, and the public API was verified as `anon` (supabase/README.md, "M2.6: the deploy"). Still open, the owner's: sign-ups off, exposed schemas, CAPTCHA, `service_role` reads the Vault on the platform, a copy of the signing key, age keypair, p95, wiring the site (M2.7).
  - 2026-10-12 (branches `feat/wire-backend` here, `feat/g7-waiver` in the bank; not merged): **owner decision: gate G7 is waived for the procedural families for launch** (an explicit waiver on file in the bank, recorded as `waived`, never as an audit; finite-bank items are not covered and stay drafts). The bank's first load is in the project: 1,800 procedural items (rotation, matrices, series, quant; 100 per family and stratum), `bank_version` `2026.10.12-b1`, `param_version` `prior`. The round trip through the public API as `anon` passed (served items, no key in any reply, a signed save that verifies, `rescore` withholding an axis under 5 answers, `delete_my_data`), p95 of `next_item`/`submit` 134 ms over 64 calls (supabase/README.md, "The first bank load"). `pages.yml` takes the project's public URL and key from the repository variables `HB_SUPABASE_URL` / `HB_SUPABASE_ANON_KEY` (set), static when unset; `npm run e2e:live` is the smoke test of the production build against the project. Still open, the owner's: merging to `main` (which puts the online version on the site), the dashboard items above, `SUPABASE_DB_URL` as a secret of the bank repository (nightly job, backup), and one more run of `e2e:live` for its deletion step.

## M3 — Knowledge & verbal banks (bank)
- [x] **M3.2** — verifiers: z3 logic games, RC passage-dependence (no-passage rate logged in `verification`, reject > 1.5 × chance), citations G5, sensitivity lint G6, license allow-list + 8-gram overlap lint F9 (the anchor corpus needs the user). *(done: z3, RC no-passage, G5, G6, F9. F9 returns not_run until the anchor corpus exists)*
- [x] **M3.3** — solver gate G4 (Claude now; Ollama adapter for ≥ 2 model families).
- [x] **M3.4** — `hb review` (Typer + FastAPI :8765); `--take` stores author responses flagged and excluded from calibration.
- [x] **M3.6** — procedural logic-game generator (Z3, 2–500 models per setup). **Blocked by AI.2** (Phase AI, A23): the generator emits the item tags (`topic`, `curriculum_level`, `notation[]`); if it landed first, AI.2 adds a retag pass by re-running it.
- [x] **M3.7** — `hb gen`, `hb verify`, `hb push` CLIs (§14.5); `fact_volatility` field (fast facts only in Fermi). **Blocked by AI.2** (Phase AI, A23): `hb gen` emits the item tags; if it landed first, AI.2 adds a retag pass for its outputs.
- [ ] **M3.8** — anchor pipeline: NAEP released items (per-item rights check) → p → b priors; 10–20 anchors per axis.
- [x] **M3.9** — testlet random effect γ ~ N(0, .3²) in both scorers (§7.1) before testlet items go live.
- [ ] **M3.10** — reading questions toward interpretation (owner note 2026-10-12, with the finite waiver; DESIGN §3 rows 4 and 10, §4.2; ROADMAP A14). The owner, on the two reading sets looked at: "the reading comprehension questions, based on the two sets i audited, seem to be more of a memory test. asking: did the reader remember these specific details from the text. typically, in standardized tests, reading comprehension sections ask for interpretation or themes from the passage. or broader details about where the characters are going or why".
  - **Which sets (owner, 2026-10-12, after the entry below was written): the two sets audited were the gate questions of the on-device reading-speed task (Processing & Reading Speed, M1.12, A14), not the RC bank.** So the note is about what a person meets on the site today: 8 public passages with 3 questions each, literal by design, answered with the passage hidden, which gate the speed measure and are not a comprehension score. The work this entry asks for is therefore in A14 first: the style of the gate questions (interpretation, theme, where the characters are going and why, instead of recall of a detail), or whether the passage stays in view while they are answered, or both. Both change what the gate checks (it exists to show the passage was read, not skimmed), so the choice is the owner's; no question was changed yet. The RC bank was not what the owner looked at; its classification below stays as context, and the same standard is the natural target for it before it is served (M3.11, a later phase). Proposed target for either, for the owner to confirm: at most one detail question per passage, and none that only asks for a name, number or date.
  - Where it stands (analysis only, 2026-10-12; no item changed; the per-item list is in the bank, `curation/m35/RC/`): of the 324 RC questions in play (84 passages, 3 or 4 each), the author's own tag says detail recall for 78 (24%), inference 131, main idea 43, purpose or tone 36, vocabulary in context 36. Two independent keyless model readings say detail recall for 99 and 87; both say so for 84 (26%), either for 102 (31%). 72 of the 84 passages have at least one detail question, 12 have two or more. 24 questions tagged inference read as detail recall to at least one reading: retag or rewrite those first.
  - Two different things are called "reading" (written before the owner said which: it was the second). (1) The RC bank above is not in the app at all: no screen draws it, so nobody has taken it, and whether its passage stays visible is a decision still to make (the server sends the passage with every question, so nothing forces hiding it). Decide it here (recommended: visible): with the passage in view a detail question is a lookup, with it hidden it is memory. (2) What a person meets on the site today is the reading-speed block (Processing & Reading Speed, M1.12, A14): 8 public passages with 3 questions each, all literal by design, **answered with the passage hidden**. They gate the speed measure and are not a comprehension score, but they are exactly a memory-for-details check. The note is about these (the owner, above), so the fix is in A14 (question style, or passage visibility), not in the RC bank.
  - **Owner decision, 2026-10-12 (the passage stays visible).** The owner, on reading comprehension: "the test taker should have the text available to them while answering the question, right? that is how typical standardized tests are formatted." So in the Reading Comprehension part of the RC bank the passage stays on screen while its questions are answered: beside the question on a wide screen, above it on a narrow one, for every question of the passage (built in M3.11 phase 2). With the passage in view a detail question is a lookup, not a memory check, which is the standard this entry asks for. The decision is about the RC part; the gate questions of the reading-speed task (A14) are still answered with the passage hidden, and whether that changes stays open here.
  - Deps: a person's review of the reworked questions (G7 or the waiver's conditions), G4 and G6 again for every changed question, M3.11.
- [ ] **M3.11** — make the finite banks servable (found 2026-10-12 while trying to load them on the finite waiver; nothing was loaded). Each line is a blocker today:
  - **Gates, bank.** G2 and G3 have never been recorded for LR, RC, VOC, KST, KHU and KAP (1,937 items in play), and RC has no no-passage test (§4.2): they cannot pass draft → review, waiver or not. Rule F9 reads `not_run` for every authored item because there is no anchor corpus (M3.8); the owner either supplies one or states that there are no anchors yet.
  - **Server.** Multiple-choice text items (LR, VOC, the knowledge axes) are stored, selected, served and scored as they are. A passage's or a logic game's questions share one family, and the selector serves one question per family, so a person gets one question of a passage and never the rest: testlets need their own serving rule (§7.1). A Fermi item is stored but never selected (the selector and the session score take only the dichotomous models) and its key shape is not scored. A RAT triad is stored and served, but a typed word is not scored (`hb.score_response` knows `index`, `letter` and `value` keys only): the answer is recorded with no verdict.
  - **Front end.** The session has six parts (RT, MAT, SPA, WM, QR, PS) and asks the server for MAT, SPA and QR only; `backend/items.ts` can draw `rotation`, `matrices`, `series` and `quant` and shows "cannot be shown" for anything else. There is no text multiple-choice screen, no passage screen and no logic-game screen for served items; the Fermi and RAT entry screens exist on dev routes only and are not wired to served items. New parts for the new axes, their names and their place in the session are owner decisions (A15).
  - **Phase 1, served text multiple choice (2026-10-12, branch `feat/m311-text-mc`, not merged; the owner: "proceed"; DESIGN §3 rows 2, 5, 13 to 15, §7.4, §10, §11.2, R-11.1). Done on the front end; no server change was needed and nothing was applied to the live project.**
    - *What exists.* A renderer for a served text question (`web/src/render/text/`: a stem, an optional text to read, two to six options; native radios, keys 1 to 6 and A to F, the rAF-locked onset, the server's text written as text and never as markup). Session parts for Logical Reasoning, Vocabulary & Verbal Analogies, STEM, Humanities and Arts & Practical Knowledge, with the same confidence slider, time cap and "Report a problem" as every served question. The page holds no key and no verdict for them.
    - *When a part exists.* Only in the online version, only for the skills the build names, and only when the server has questions. The build names them with the repository variable `HB_TEXT_AXES` (`LR,VOC,KST,KHU,KAP`, or `all`; read by `pages.yml` next to the two server variables, which are untouched). **It is unset, so the live site is the six-part session exactly as before: no extra part, no extra request, the same words.** When it is set, a text part is asked for before its "Up next" screen, and a skill the server answers `no_items` for is dropped without a word (no screen, no notice, no flag; the skill reads "not measured"). The variable exists because the welcome screen states the session's length before any call to the server, and only the owner knows when a skill's questions are loaded. *(Superseded 2026-10-13, phase 3: the variable is removed; the app asks the server's `live_axes`.)*
    - *Length.* One table, `web/src/engine/plan-table.ts` (`TEXT_PARTS`): Logical Reasoning 5 min, Vocabulary 2 min, the three knowledge parts 2 min 10 s each, **on top of** the six parts' 27.5 minutes, whose plan and budgets are untouched (tested). With all five the session is planned at **41 minutes** (42 since the Quantitative part's six questions, below) and says "up to eleven parts, about 40 minutes"; without them it says "six parts, about 30 minutes", as before. Order (§7.4): Reaction Time, Matrix & Series, Logical Reasoning, STEM, Spatial, Vocabulary, Working Memory, Quantitative, Humanities, Arts & Practical, Processing & Reading Speed.
    - *Five answers, not three.* The server publishes a skill only from a session with at least five scored answers on it (`rescore.min_axis_items`), so a text part that stopped at the §7.4 floor of three would measure nothing the person sees. A text part therefore goes on past its share until five questions are answered (at most two more are shown when some run out of time). Logical Reasoning at the bank's expected 60 s a question needs about 5 minutes for that, which is why its share is 5 and not 2 to 3. **Found on the way, not changed: the same rule applies to the six parts, and the Quantitative part typically serves about 4 questions, so its score is withheld by the server in a typical session** (the round trip of 2026-10-12 shows it: "QR with 4 answers was withheld"). Owner decision below.
    - *Tests.* Unit and property tests (the spec check, the plan, the run with a fake server, the settings, the copy, the results), jsdom tests of the renderer and the flow, `npm run e2e` (`e2e/text-mc.spec.ts`: Chromium, WebKit, iPhone; axe, keyboard, 320 px, a wide font, text at 200%), the real client against the real database (`scripts/db/text-mc.db.test.ts`), and a new `npm run e2e:db` (`web/e2e-db/`): the three browsers against the local PostgreSQL with made-up text items. A pool without the text skills gives the six-part session unchanged, at every one of these levels. All items in the tests are synthetic and say so.
    - *Open owner decisions.* *Decided 2026-10-12 (see "Owner decisions 2026-10-12"): (1) the length, "41 is acceptable, it can stretch up to 60 min max"; (4) the Quantitative part, "go to six questions"; (5) stays as it is, with the simulated figures there.* (1) The planned length with all five parts, 41 minutes, and the shares; (2) where the parts sit in the session and what they are called (the axis names are used); (3) when to set `HB_TEXT_AXES`, and for which skills (it can be one at a time); (4) the Quantitative part and the five-answer rule (lengthen the part, lower the server's minimum, or leave it); (5) a slow reader with all five parts can reach the 57-minute hard stop before the last part (a simulated taker at 90 s a question did).
    - *To turn a skill on, once its questions are live in the project:* since phase 3 (2026-10-13) nothing: loading the questions is enough (`live_axes`). The repository variable `HB_TEXT_AXES` is no longer read and can be deleted.
    - *Not in phase 1, and what each needs.* **Passages (RC):** a serving rule for testlets on the server (all questions of a passage, in order, with the §7.1 testlet effect; a migration and DB tests), a screen with the passage beside its questions, the decision whether the passage stays in view, the no-passage gate in the bank, and M3.10's standard for the questions. **Logic games:** the same testlet serving rule, and a screen with the setup kept in view over several questions (`logic_game_v1`). **Fermi:** the Gaussian model in the server's selection and session scoring, the Fermi key and its scoring in `hb.score_response` (a migration and DB tests), and the entry screen of the dev route wired to served items (an estimate and an 80% interval are not an option position). **RAT:** a typed-answer branch in `hb.score_response` with the accept list (a migration and DB tests), the corpus licence (owner), and the triad entry screen wired to served items. **Testlet serving rule:** as under passages; it is the one server change two of the four share.
  - **Phase 2, served passages (2026-10-13, branch `feat/m311-passages`, worktree `~/code/wt/passage/humanbench`; not merged, nothing pushed, the live project not touched; DESIGN §3 rows 3 and 4, §6.iii, §7.1, §7.4, §10, §11.2, §13, R-11.1; the owner's decision under M3.10: the passage stays visible).**
    - *Server: item sets.* One new migration, **`supabase/migrations/20261013000100_item_sets.sql`**, to be applied by the lead with `npm run db:deploy` after review (it was applied only to the throw-away test databases). The questions of one passage are served together: all the live questions of the family, one after the other, in the order of their ids; the passage competes for a slot as one unit (the sum of its questions' information over the sum of their times, a 2PL-testlet question at the 0.8 of §7.1); exposure is counted and capped per passage, at its first question; inside a passage nothing comes between two questions (no other item, no pretest slot, no per-skill stop), and a call for another part leaves it for good. A set is told by its `item_type` (`mc_passage`, `mc_logic_game`; the setting `selection.set_item_types`), so the rule is the one logic games need too. Scoring is unchanged and counts questions: two passages of three are six answers for `rescore.min_axis_items`. A reply gains `set: {position, of}` and, for a passage whose family has one, the source line as `media.attribution`; no key, verdict, parameter or family id. Rule, reasons and what the bank should set: supabase/README.md, "M3.11 phase 2: item sets".
    - *The passage screen.* `web/src/render/text/PassageLayout.svelte` and `passage.ts`; the question is drawn by the phase-1 text renderer. Wide: passage and question side by side, the passage scrolling in its own frame. Narrow: the passage above the question, held to about two fifths of the window and kept in view while the page scrolls to the options and the Confirm button, with a button that shows the whole passage; in a short window (a phone on its side, a browser at 200%) it is simply above the question. The page is not rebuilt between two questions of a passage: the passage is the same element, scrolled where it was left, through the question, its slider and the wait for the next one. A new passage takes focus on its region ("Passage", with a heading); a later question of the same passage takes focus on its own region and says "Question 2 of 4 about this passage". The source line is under the text, small. Every string is written as text, never as markup; an address in a source line is not a link. Nothing is timed afresh between questions: each has the time limit the server states, so **the first question's limit must cover the reading (the bank sets it; README)**.
    - *The part.* Reading Comprehension is a text part like the five (`RC` in `HB_TEXT_AXES`, dropped without a word when the server has no passages), after Vocabulary. It is counted in passages (`plan-table.ts`, `sets`): it reads two, every question of each (6 to 8), and ends; a passage that was started is finished whatever the part's time says; short of five answers after two (questions that ran out of time) it reads one more. Planned at 9 minutes.
    - *`all` now includes `RC`.* (Superseded by phase 3: no variable; a skill is in the session when the server has its questions.)
    - *The stated length is the typical length.* The words about a session's length and the progress ring are no longer the plan's sum (42 read "about 40" where the typical session is 45) but the simulated median, from the one table: `A15_TYPICAL_S` (31 min 20 s for the six parts; the plan is 28.5) and a `typical_s` per text part (LR 310 s, RC 530, VOC 135, the knowledge parts 130 each). Six parts still read "about 30 minutes"; the eleven of phase 1 "about 45"; with Reading Comprehension "about 55"; Reading Comprehension alone with the six "about 40". `scripts/sim-length.test.ts` holds each figure to the simulation, and with `HB_SLOW=1` checks all 64 combinations of the text parts.
    - *Twelve parts against the 60-minute ceiling* (`npm run sim:session -- --mode online --text all`; made-up passages of 3 and 4 questions, 100 s to read one, 45 s a question): median **54.2** minutes, 95th percentile **57.0** (the hard stop), **18%** of sessions at the hard stop; a taker 1.25 times slower: median 57, **95%** at the hard stop; 1.5 times slower: **100%**, and the Quantitative part publishes for 46%; with one question in ten left to run out of time: 94%. The eleven parts without it: 45.3 / 50.0 / none. So the typical taker fits under the ceiling, with three minutes to spare, and anyone slower than typical does not. The hard stop was not moved. **Proposed trims, for the owner** (estimates from the same simulated people; the first column is exact, the slow columns are upper bounds):

      | | typical: median / p95 / at the stop | 1.25 times slower, at the stop |
      |---|---|---|
      | as built | 54.2 / 57.0 / 18% | 95% (simulated) |
      | A: Vocabulary and the three knowledge parts stop at five answers (shares 85 s and 110 s) | 52.2 / 56.8 / 4% | under 94% |
      | B: A, and passages of three questions (six questions in all) | 51.4 / 56.0 / 2% | under 87% |
      | C: A, and the six parts planned three minutes shorter when text parts are on (Matrix & Series and Spatial give up about three questions each) | 49.2 / 53.8 / 0% | under 64% |
      | F: A, with two of the three knowledge parts per session (ten parts) | 48.5 / 53.2 / 0% | under 53% |

      None of them makes a slow taker's session fit; that needs fewer parts in a session (for example Logical Reasoning and Reading Comprehension in alternate sessions: 47.0 / 51.7 / 0%, under 34%).
    - *Tests.* Unit and property (the passage spec, the plan, the run with a fake set server, the typical lengths), jsdom (the layout; the flow: the passage element is the same across its questions), the database (`item-sets.db.test.ts`: the rule, exposure, the fuzz and the canaries; `passage.db.test.ts`: the app's run and the real client), `npm run e2e` (`e2e/text-passage.spec.ts`: Chromium, WebKit, iPhone; axe, keyboard, 320 px, a wide font, text at 200%, a short window), and `npm run e2e:db` (a third database with made-up passages). Every passage in the tests is made up and says so.
    - *Still out, and what each needs.* **Logic games:** the server rule is in place (`mc_logic_game` is a set type); a screen with the setup kept in view (`logic_game_v1`: the layout of this phase with a setup in the passage's place, and the setup's own structure, rules as a list), a session part and its share, and a waiver or gate decision for the pool. **Fermi:** the Gaussian model in the server's selection and session scoring, the Fermi key and its scoring in `hb.score_response` (a migration and DB tests), and the entry screen of the dev route wired to served items. **RAT:** a typed-answer branch in `hb.score_response` with the accept list (a migration and DB tests), the corpus licence (owner), and the triad entry screen wired to served items. **Passages themselves:** the new RC bank (M3.10's standard, the no-passage gate), the reading time on each passage's first question, and M3.9 for scoring a passage's answers as one testlet term.
    - *Open owner decisions.* (1) The trims above, or fewer parts per session; (2) `all` and the variable before the merge; (3) the name and place of the part (the axis name, after Vocabulary); (4) whether the reading-speed gate questions (A14) get the passage in view too.
  - **Phase 3, the remaining families (2026-10-13, branch `feat/served-families`, worktree `~/code/wt/families/humanbench`; not merged, nothing pushed, the live project not touched; DESIGN §3 rows 3, 11, 12, 16 and 17, §5.2 to §5.4, §7.1, §7.4, §10, §11.2, §13, R-5.6.x, R-11.1). The owner: "work on the fermi estimation scoring, and the logic games screen, the remaining families. suspend the alternate uses family. i don't want to use a model for any scoring. nothing against it, i just don't want to pay for hosting a scoring model right now"; and, standing: "the site is live and i want any edits we make to go live as soon as we push it. stop setting up artificial roadblocks."**
    - *Server: three new migrations, for the lead to apply in order after the two of phase 2 (`npm run db:deploy`):* **`20261015000100_rat_answers.sql`** (a word-links answer scored against the key's `{answer, accept}`, folded as the bank's `hb.rat.answers` and the app's `answers.ts` fold it: NFKD, letters a to z, lower case; no fuzzy match), **`20261015000200_continuous_items.sql`** (Fermi estimates as a Gaussian item and situational judgments as a GRM item: answer space, score, the session's EAP, the MAP at finish, selection with their information, and `rescore`; item-type balancing on EMO so vignettes and judgments alternate), **`20261015000300_live_axes.sql`** (`public.live_axes()`: the skills with a servable live item, nothing else). Dichotomous items rank and score exactly as before (the selection, scoring and rescore tests pass unchanged; `rescore`'s output on a 2PL/3PL save is equal to the old body's). supabase/README.md, "The remaining families".
    - *Fermi (FER).* score x = −|log10(estimate/truth)| after the unit conversion of `fermi-units-v1` (the table copied into SQL, tested equal), a Gaussian observation x ~ N(lam·θ + d, σ²) with σ widened by the truth's uncertainty read from the key (above 0.15 dex) as `fermiObservation` does. Parity with the device scorer to 1e-6 on all 112 golden cases of `fermi_scoring_v1.json`, its 14 malformed inputs and 250 fuzzed ones. **The 80% intervals do not feed Calibration**: §3 row 12 and §7.1 list the interval hit rate beside the Brier score, and `tasks/fermi/scoring.ts` leaves whether hits enter θ_CAL to the M4.8 calibration; the hit is computed by `hb.fermi_eval` and can be recomputed from the stored answer and the key, but no score uses it. No confidence slider follows a Fermi answer (its range is the statement). The served screen is the M5.1 entry (magnitude, unit, 80% range). *Found:* with the provisional fermi-v0 norms (0.2 dex per SD) a few answers 1.5 dex or more off put the 61-point grid posterior at its edge (θ = −4) with a small sd; the per-skill stop does not apply to Fermi items for that reason, and such a person's published estimate is the grid's edge until M4.8 calibrates the norms.
    - *Logic games (LG).* `mc_logic_game` was already a set type; the setup (the bank's `media.setup`, an opening sentence and one sentence per rule) is shown in the passage's place, the opening as a paragraph and the rules as a list ("Setup", "Question 2 of 4 about this setup"), the same element across a game's questions. The part reads two games (6 to 8 questions; a third only when fewer than five were answered), as Reading Comprehension reads two passages. **Testlet treatment (§3 row 3, §7.1):** selection counts a 2PL-testlet question at 0.8 of its information (phase 2); scoring treats each question as a 2PL, as for passages: the testlet term with its random effect is still M3.9's. The bank's time prior of a logic-game question (78 to 84 s) includes reading the setup, because it was written for one question of a setup per session; now that a game is served whole the later questions take less (simulated 55 s and 25 s of reading on the first).
    - *Word links (CRE).* The triad entry, the typed word, the confidence slider (tier a). Creative Thinking is the word links alone (the alternate-uses task is suspended, M6.4).
    - *Emotion Reading (EMO).* Vignettes (`emotion_vignette_mc`, an `{index, emotion}` key, 2PL, already scored by the index branch) and situational judgments (`sjt_rating`): four whole ratings, score 1 − Σ|u − k|/12 against the key profile the bank's records carry (`key.ratings`: the panel's w^AI, or the author's provisional one for the three rejected items), binned into the GRM's four categories at 0.625, 0.75 and 0.875 as `hb.sjt.scoring` bins it. No model at scoring time. **The gap:** §5.2's blend with expert and population ratings does not exist yet (λ = 0 for every item: no expert rating, no population rating), so the score is agreement with a Claude-model ensemble's judgment, which the skill tip says (R-5.6.2 and the SJT facet note). No confidence slider follows either kind (vignettes are tier c; a judgment has no right answer).
    - *Availability without a switch.* The build variable `HB_TEXT_AXES` is gone from `pages.yml` and the code. The app asks `live_axes` when the page loads; the welcome screen says no count and no length until the reply (the static shell of a server build says the same), then the longest turn of the rotation; the ready screen says the turn that comes. A failed call is tried again when the session opens; still failing, the session is the six parts.
    - *Parts and the rotation (`plan-table.ts`).* Emotion Reading and Creative Thinking after Working Memory, Logic Games and Fermi at the end (§7.4 ends "… Logic → Fermi"); a minimum of six answered questions each (Logic Games: two games). **Everything on does not fit**: sixteen parts, typically about 75 minutes; simulated (200 sessions, `npm run sim:session -- --mode online --text all`) median 57.0, 95th percentile 57.0, **100% at the hard stop** at the model's pace and at 1.25 times slower; Fermi, the last part, is never reached. **Built: the served parts take turns** (`ROTATION`, one table): three groups, one a session by the number of saves in the browser, each with the six parts about 45 minutes:

      | Turn | parts | typical: median / p95 / at the stop | 1.25 times slower: median / p95 / at the stop |
      |---|---|---|---|
      | 1 | Logical Reasoning, Reading Comprehension | 45.2 / 54.9 / 4% | 53.4 / 57.0 / 31% |
      | 2 | Logic Games, Vocabulary, STEM, Humanities | 44.5 / 53.8 / 3% | 52.4 / 57.0 / 25% |
      | 3 | Fermi, Emotion Reading, Creative Thinking, Arts & Practical | 45.6 / 54.5 / 4% | 53.1 / 57.0 / 29% |
      | (for comparison) everything at once | sixteen parts | 57.0 / 57.0 / 100% | 57.0 / 57.0 / 100% |

      Each turn is as long as the eleven-part session of phase 1 (45.6 / 54.4 / 3%; 1.25 times slower 29% at the stop). A slower taker still reaches the stop about one session in four; four turns would leave between one in sixteen and one in five (see "Owner decisions 2026-10-13", "Session length with the remaining families"). **Owner:** the groups, three or four turns, or none.
    - *Front end.* The renderers of the four families are fetched when a session with one of their parts starts (`session/served-renderers.ts`), not in the entry chunk; the entry grew 2.4 KB gzip (138.1 to 140.6) and its bound is 142 KB. A payload that does not fit its family is not drawn and the skip is offered.
    - *Tests.* DB: `families.db.test.ts` (golden parity, fuzz, selection, EMO balancing, EAP and `rescore` parity with the engine, `live_axes`, key secrecy with canaries) and the existing suites updated; unit and jsdom: the payload shapes, the answers sent, the confidence rule, the rotation, the copy, the AUT suspension, the flow of each family (`SessionApp.families.dom.test.ts`); `npm run e2e` (`e2e/families.spec.ts`, three browsers: axe, 320 px); `npm run e2e:db` (two new databases, "games" and "estimates", of made-up items; `e2e-db/families.spec.ts`).
    - *Servable item types* (for the bank's load list): `fermi_estimate`, `rat_triad`, `emotion_vignette_mc`, `sjt_rating`, `mc_logic_game` (and, as before, the M1 procedural types, `mc_text`/the authored multiple-choice types and `mc_passage`).
- [ ] **M3.12** — harder items at the upper end, on every axis (owner, 2026-10-13, after a full eleven-part session with 64 of 67 right; DESIGN §3, §4.2, §6.ii, §7.4, §7.7; ROADMAP A9, A11, M1.P). The owner: "many of the questions are too easy. or rather, not easy, but only moderate. i found very few of the logic, stem, vocab, spatial, quantitative, arts/practical, etc to be challenging, and almost none were highly challenging. so make a note in the plan that we need to add more questions at the upper end of the spectrum."
  - **Two causes, and this task is the second.** (1) Selection never reached the hard items the pool has: fixed by the start-up step and the wider aim of 2026-10-13 (`engine/startup.ts`, migration `20261014000100_startup_step.sql`). (2) The pool is thin or empty at the top, which no selection rule can fix. Measured by the lead on the live pool (`2026.10.12-b2`): strata 5 and 6 exist for LR, VOC, KST, KHU, KAP (b up to 3.0 to 3.25) and SPA (b up to 3.4); **MAT tops out at b ≈ 2.0 (no stratum 6) and QR at b ≈ 1.3 (strata 1 to 4 only)**. In simulation a taker at θ = +2.5 is shown a stratum 5 or 6 item among the first five Quantitative questions in 0% of sessions, with the rule or without it, because there is none to show.
  - **Procedural generators (pub and bank twins, A1, A11; a generator bump each, so the G7 waiver or audit again).** *Quantitative:* templates for strata 5 and 6 (multi-step algebra, combinatorics and probability, number theory, olympiad-style problems with one numeric answer; §3 row 6 names "arithmetic → algebra → olympiad"), with time priors and limits that fit (a stratum 6 problem is not a 60 s item: check the 57-minute session and the six-question minimum against them). *Matrix & Series:* a stratum 6 for matrices (three or more rules at once, rules across rows and columns, distractors that satisfy all but one rule) and for series (nested and interleaved rules, second differences, mixed operations). *Spatial:* the pool reaches 3.4, but the criterion's division by time lets the cheaper, easier rotations win once the start-up is over (simulated: mean b falls from 1.6 back toward 1.1 for a taker at +2.5); check the time priors of the hard rotations, and consider paper folding and 2D mirror items at the top (§3 row 7).
  - **Text banks (bank; G1 to G6 and the panel per item, G7 or the waiver's conditions per batch).** Author strata 5, 6 and above for LR, VOC, KST, KHU, KAP and, with M3.10, RC: enough per stratum that the exposure cap and the family exclusion of §7.7 still leave a strong taker a part's worth of questions for several sessions (§7.7's count per stratum applies at the top as in the middle). The difficulty priors of authored items are the author's stratum (§6.ii), so the claim "stratum 6" is unverified until M4 calibration: seed with the F-rule features and expect to re-band.
  - **Acceptance.** For each question axis: the pool holds at least the §7.7 number of live items in strata 5 and 6; `npm run sim:cat -- --part c` with that pool shows a taker at θ = +2.5 a stratum 5 or 6 item among the first five questions in at least three sessions of four, and their share correct over a part of eight near 65 to 75%, not 85 to 95%; the session lengths of `npm run sim:session` re-measured with the new time priors.
  - Deps: owner (which axes first; the waiver or an audit for the new generator versions and batches), M3.10 for RC, M4 for the real difficulties.
  - **Quantitative, built (2026-10-15/16, branch `feat/hard-qr` in both repos; not merged, nothing pushed).** The owner: "my ability to nearly ace the questions points towards gap at the right tail … in quantitative, the most complex questions were some basic algebra. keeping in mind that the user doesnt have a calculator, why weren't there any geometry questions? trigonometry? calculus? etc." Quant generator **1.4.0**: strata 5 (32 variants, b 1.7–2.4) and 6 (23 variants, b 2.6–3.7) over 45 new templates (`web/src/tasks/quant/hard1.ts` … `hard4.ts`; bank twins `hb.gen.quant.hard1` … `hard4`): Heron triangles, chords, coordinate geometry, cones and spheres, trigonometric values, angle sums, the law of cosines, tangents in a triangle; Vieta and Newton sums, logarithms, polynomial remainders, functional equations, periodic recurrences, telescoping series; stars and bars, lattice paths, Bayes, geometric probability, gambler's ruin, expectation by linearity, digit sums, necklaces up to rotation; divisors, the Chinese remainder theorem, Legendre's formula, last two digits, gcds of powers, towers mod a prime, lattice points on a circle, unit-fraction equations; derivatives, integrals, limits, optimisation, areas between curves, volumes of revolution, Beta integrals; candles and ferries. Every key is an exact integer or fraction (no answer-format change, no migration for scoring); every verifier has its own exact route; TS and Python agree on 2,750 cross-checked items and the 3,000-item dump. Priors: the b line continued (anchors 2 and 3; stratum 6 offsets −0.4 … +0.6), E[T] 120 s and 180 s plus the length term, caps about 315 s and 470 s. Strata 1–4 draw exactly as in 1.3.0, and 1.3.0 is kept whole for saved ids (TS `QUANT_LEGACY_FAMILIES`, bank `LEGACY_TWINS`, which still rebuilds the 400 live `1.3.0+py` items). Topic grouping g2: `quant/geometry_trig`, `quant/calculus` (migration `20261016000200_quant_hard_facets.sql` for `hb.drill_facet`). Panel (bank `panels/m312-qr-r1`, numeric entry added to `hb panel verdict`): 2 blind instances of each variant, 109 pass, 1 soft (a Sonnet slip), 0 hard. Pool: `items/pool-2026-10-15/quant/s5`, `s6`, 100 each. Session (`npm run sim:session`, 200 six-part sessions): θ = +2.5, Quantitative mean 9.0 min (median 8.8) against 6.4 for θ ~ N(0, 1), session mean 33.6 min, max 51.1, none at the hard stop; six answered remain the part's minimum. Acceptance (`npm run sim:cat -- --part c`, Quantitative, 200 takers per θ, with the start-up rule): at θ = +2.5 a stratum 5 or 6 item comes among the first five questions in 73% of sessions (0–1% before 1.4.0; the target is 75%) and 76% of eight are answered correctly (target 65–75%); at θ = +3, 84% and 80%. The mean b served plateaus near 1.3 after the start-up, since the criterion's division by time favours the shorter stratum 4 items: the selection workstream's question, not the pool's. **Owner:** the entry bound 143 → 160 KB gzip (the hard tables and their verifiers ride in the device bundle); merge and push; G7: `hb release` takes the 1.4.0 pool live with G7 not run (the 2026-10-12 waiver names quant 1.3.0 only), so whether that stands is the owner's call.
- [~] **M3.5** — authoring batches, per axis at S = 3: ≈ 162 items for each of the 7 finite v1 axes (LR, RC, VOC, KST, KHU, KAP, + LG pool), plus Fermi. Each batch passes G1–G6 and gets an audit-bound record (G7 needs the user). **Blocked by AI.2** (Phase AI, A23): each batch template emits the item tags of A23 (proposal §5.1) that apply to its axis: `topic`, `curriculum_level`, `notation[]` (LR/LG), private `jargon_terms[]`, and for LR/RC the `question_type` and `inference_steps`. *(2026-10-02: 972 draft items for LR/RC/VOC/KST/KHU/KAP with G4 panel records. 119 Fermi items are on branch `wf8/m35b`. The audit questions whether the panel records are truly independent; see PROGRESS. The LG pool is still to do.)*

## M5 — Tier (b) Fermi + calibration UI
- [~] **M5.1** — Fermi items (≥ 2 sources, uncertainty in dex, down-weighting above 0.15 dex, reject above 0.3), the magnitude + unit entry UI, 80% intervals, server-side Brier. *(library, Python/TS scoring parity, entry UI and dev fixtures are done; 2026-10-13: served and scored on the server (Gaussian, parity 1e-6), M3.11 phase 3. Interval hits feeding θ_CAL waits on M4.8)*

## M6 — Tier (c) (v2)
- [x] **M6.1** — appraisal vignettes + rule engine (100% rule-key agreement; AI-vs-theory ≥ 85% or reject), R-5.6.2 label and tooltip. *(merged 2026-10-03: 60 vignettes, the rule engine, the panel gate and the UI. 5 vignettes whose text changed need a panel re-run. 2026-10-13: served in the Emotion Reading part, M3.11 phase 3)*
- [~] **M6.2** — SJT + key blending (§5.2), circularity guard, F6 check (expert ratings need the user or recruited raters). *(built 2026-10-06: 60 SJT drafts, 57 panel-keyed. Expert ratings are owner-pending. 2026-10-13: served and scored on the server (the rating score against the record's key profile, binned for the GRM), M3.11 phase 3; the blend with expert and population ratings has nothing to blend yet)*
- [~] **M6.3** — RAT with a compound check (corpus licensing is the user's call) and spelling variants. *(2026-10-06: real permissive resources; 146 triads, G4 146 pass, G6 145 + 1 soft. Open-compound frequency is a flagged proxy, because Google 2-grams are 324 GB, over the cap. Stratum 1 is empty under prior v2. 2026-10-13: served and scored on the server against the accept list, M3.11 phase 3)*
- [ ] **M6.4** — **suspended by owner decision (2026-10-13): "suspend the alternate uses family. i don't want to use a model for any scoring. nothing against it, i just don't want to pay for hosting a scoring model right now."** AUT with in-browser MiniLM, the "don't type personal info" warning, opt-in Ocsai consent, hatch rendering. *(built: in-browser MiniLM scoring, aut-v0 parameters provisional; Ocsai off; dev route only. The code stays; no session plans or asks for it, no served item is drawn by it, Creative Thinking is measured by the word links alone, and no screen of a session mentions it: `tasks/aut/suspended.test.ts`)*

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
- **M2.6 deploy (2026-10-11/12):** the backend is deployed to the owner's Supabase project: 18 migrations, the signing key in the Vault, and the security checks passed as anon. **Owner decisions:**
  - Accept that the platform's `service_role` can read the Vault. It isn't reachable through the public API, and the service-role key stays secret. The README and local-shim claims should be corrected to say so.
  - CAPTCHA is skipped for now, since rate limits are active.
  - `graphql_public` will be removed from the exposed schemas by the owner.
  - **Not wired:** the site isn't connected to the backend until the procedural pool is loaded, and that needs the owner's G7 audit records.

## Owner decisions 2026-10-12
- **G7 waiver extended to the finite banks.** The owner: "extend the waiver". Recorded in the bank as a second waiver (`g7-finite-2026-10-12`, by the owner, `is_audit: false`): an owner decision, **not an audit**. The owner looked informally at a sparse handful of items, among them two reading-comprehension sets; that is not the §4.4 sample and no audit result is recorded. Gate G7 reports a covered item as `waived`, never as passed.
  - **What it covers, checked by code per item:** an authored item of a batch the record names (LR, RC, VOC, KST, KHU, KAP, Fermi and the RAT triads; a new bank or batch needs a new decision) whose gates G1–G6 all pass and on whose key all three panel models agree with no flag.
  - **Held back:** anything a panel model flagged (a G4 soft or hard flag, a G6 soft flag), anything retired, and **all** situational-judgement and emotion items, which still need expert ratings and rewrites. Rule F9 is not waived. A recorded human G7 fail still fails; a real audit still counts as an audit.
  - **What it changed today: nothing is served on it.** Counted on the day: Fermi 119 of 119 in play and RAT 143 of 145 meet the waiver's conditions (one RAT triad has a G4 soft flag, one a G6 soft flag); none of the 1,937 items in play of the six multiple-choice axes do, because their G2 and G3 were never recorded. None can be promoted while F9 reads `not_run`, and neither the server (Fermi, RAT) nor the front end (every finite type) can serve them yet: M3.11. No finite item was loaded; the live pool is still the 1,800 procedural items of `2026.10.12-b1`.
  - **The owner's note with the decision** is the follow-up M3.10 (RC rework toward interpretation, inference, theme, motive and purpose).
- **The Quantitative part: six questions (A15 amended; DESIGN §7.4).** The owner: "go to six questions". Background: the server publishes a skill only from a session with at least five scored answers on it (`rescore.min_axis_items`), and the part's share of the session bought about four (three to seven in simulated sessions), so the skill was withheld from the profile in most sessions. Done on branch `feat/qr-six` (not merged, nothing pushed, the live project not touched, no server change):
  - **The rule** is the one the text parts have (M3.11 phase 1), in the online version and the device-only version alike: the part goes on past its time until six questions are answered, and shows at most two more to get there when some run out of time (`web/src/engine/plan-table.ts`, `A15_MINIMUMS`; `web/src/session/run.ts`). Six answered leaves the five the server asks for with one to spare. A count was chosen over a larger time share because a share buys a number of answers that depends on the person's pace and on how long the timed tasks before it ran, which is what left the part short. Skipping the part, "finish early", the hard stop and the precision stop work as before; a focus session has no minimum. Matrix & Series, Spatial, Working Memory, Reaction Time and Processing & Reading Speed are unchanged: their shares are worked out from the 27.5 minutes as before (tested), and the break is where it was.
  - **Length.** The part is planned at its share plus a minute (about 6 minutes; its "Up next" screen says "About 6 minutes" however little shared time is left), so the six-part session is planned at **28.5 minutes** and still says "six parts, about 30 minutes"; with all five text parts **42 minutes**, "up to eleven parts, about 40 minutes".
  - **Simulated** (`npm run sim:session`, 400 sessions each, timed tasks at 1 to 1.6 times their model time; `--mode online --text all` plays the eleven parts against a stand-in server with made-up questions at the bank's expected times): answered Quantitative questions 6 / 6 / 9 (least, median, most) in the six-part session and 6 / 6 / 10 in the eleven-part one, five or more in every session (before: about 4). Six parts: median 30.6 minutes, 95th percentile 35.3, longest 40.5 (online 31.3 / 35.9 / 39.8); none at the hard stop. Eleven parts: median 45.3, 95th percentile 50.0, longest 53.8; none at the hard stop. A taker who is 1.25 times slower at everything: six parts 35.3 / 41.4 / 46.5 and none at the hard stop, eleven parts 51.2 / 57 / 57 with 7% at the hard stop; 1.5 times slower: six parts 39.8 / 47.2 / 53.9 and none, eleven parts 64% at the hard stop (what they lose is at the end of the session). With one question in ten left to run out of time: six parts 32.9 / 39.0 / 45.3, five or more Quantitative answers in every session.
- **Session length.** The owner: "41 is acceptable, it can stretch up to 60 min max." So the planned 42 minutes with all five text parts stands, and the ceiling is 60. **The hard stop stays at 57 active minutes** (`web/src/session/constants.ts`): it is under the ceiling and nothing forced a change. Active minutes leave out the time on "Up next" screens, a break and the waits for the server, so a session that reaches the hard stop takes somewhat longer than 57 minutes by the wall clock. **For the owner to weigh:** the typical simulated eleven-part session is 45 minutes, not 40, because the timed tasks run longer than their model time; the words say "about 40 minutes", from the plan (42). And a slow taker of the eleven-part session reaches the hard stop often (above); the remedy would be smaller shares for the text parts, not a later stop.

## Owner decisions 2026-10-13
The owner took a full eleven-part session on the live site on 2026-10-12 (67 served questions: 64 right, 2 wrong, 1 run out of time; 54.2 active minutes on the session clock, 56.1 by the server's start-to-finish time) and gave four pieces of feedback. What was decided, what was proposed and built on it, and what is still the owner's to decide. Built on branch `feat/session-fixes` (worktree `~/code/wt/sessfix/humanbench`, stacked on `feat/m311-passages`) and `feat/span-reactive` in the bank; **not merged, nothing pushed, the live project not touched**.

- **A timer on every question that can run out of time (DESIGN §10, §13; A18).** The owner: "if we have a timer and are going to time out questions if the test taker takes too long, then we should show the timer (the math problem i timed out on i was verifying was correct and i had concluded my answer was correct when it timed me out unexpectedly."
  - *Built.* The time left as `m:ss` above the question for the whole time it waits for an answer, on device-made and served questions and beside a passage alike (`session/ItemTimer.svelte`): small, no animation; a `role="timer"` a screen reader can read on demand and that is not read out as it counts; in the last 30 seconds the words "Time is nearly up", a mark and a frame (not colour alone) and one status line that changes once. A typed-answer question adds "An answer counts only once you have entered it." The confidence slider is not timed. The limit rule (max(180 s, 2.5 · E[T]), or the server's) is unchanged.
  - *Proposed, not built (owner).* For a typed answer that is in the box and not yet entered when the time ends, three options: (a) leave it as it is now: no answer (the warning now says so 30 seconds before); (b) **enter what is in the box at the time-out** and score it as an answer: it would have saved the answer in the owner's case, and it scores a half-typed number as wrong where today it is left out of the scores on the server; (c) a one-time grace of 30 seconds on a typed question whose box is not empty, said on screen. (b) changes what the server counts as an answer and (c) the §13 cap, so neither was done without the owner. **Decided 2026-10-13 (owner): (b),** "yes, submit any answer currently typed, if nothing is typed or selected, nothing is submitted." Built on `feat/inline-confidence`: see "Owner decision 2026-10-13: the confidence on the question screen", *The answer at the time-out*.
- **Reactive memory blocks (DESIGN §3 row 8; A10).** The owner: "the memory tests take too long, the number and block repitition get monotonous because it increases difficulty with two tries at each length. 3,3,4,4,5,5,6,6,7,7,8,8 etc. lets change all of those to be reactive. one try at each length unless the user gets it wrong, then they get a second attempt … this should also help to reduce the total time."
  - *Built* for digits forward, digits backward and Corsi (span 1.2.0; the Python twins `1.2.0+py`): one trial per length; a miss gives one second attempt at that length; a second miss ends the block. The instructions state the rule and the pause before a second attempt says "One more of the same length."
  - *Scoring.* A length is passed by one exactly correct trial. With p the chance of one trial, that is 1 − (1 − p)² under two fixed trials and p + (1 − p)p = 1 − (1 − p)² under the reactive rule: the same, at every length, so the longest passed length (the thing that is scored, a graded response) has one distribution under both. The GRM, its thresholds, the block's information and SE, the difficulty prior and the provisional parameters (A10, M1.P) stand; a block of 1.1.0 and one of 1.2.0 are observations of one model. Checked exactly (every path of both state machines, arbitrary p), with the families' own GRM, and by θ recovery (r ≈ .848, RMSE ≈ .53, mean posterior SD .525 under both; N = 6,000). What changes is the trial record (not scored today): fewer trials, stopped on outcomes, so a trial-level model (M4.8) must be fitted by likelihood, and a plain proportion correct per length over-states p. The independence of the two trials of a length is the assumption §3 already made; a second attempt now tells the person the first was missed, which M4.8 can test.
  - *Old saves.* The 1.1.0 generators are kept whole (unregistered, never served), so a save made before the change keeps its Working Memory score when it is re-scored.
  - *Time* (simulated, both procedures on one clock): a taker at θ = 0 saves about 43 s, 28 s and 33 s a block (forward, backward, Corsi; about a quarter), 1.7 minutes over the part; at θ = +2 about 79, 73 and 66 s, 3.6 minutes (about a third). Trials given at θ = 0: 7.3, 5.6 and 6.2 against 11.0, 7.6 and 9.0.
  - *The G7 waiver.* The procedural waiver on file names the span blocks at 1.1.0; at 1.2.0 they are outside it and gate G7 reads `not_run` for them (no waiver file was changed). Nothing is blocked by that: they are device-only block families that are never loaded into the server pool or promoted. **Owner:** extend the waiver to 1.2.0 or leave it.
- **Adaptivity that can be felt (DESIGN §7.4; M2.2, M1.14).** The owner: "was the test i took adaptive? … i couldnt tell, it seemed like it didnt?" It was: the difficulty rose on every part, but from b ≈ −1 to 0 only as far as b ≈ +1.0 to +1.2 with a perfect record, while the pool held items to b = 3 and above. The next item was placed at the posterior mean under the N(0, 1) prior, which ten correct answers move by about a stratum, and the criterion divides by time.
  - *Proposed and built (the owner can switch either off: `selection.startup_step = 0`, `selection.aim_prior_sd_factor = 1`; in the app `SelectorOptions.startup`).* (1) A start-up step: after each correct answer the next question is aimed a stratum above the last, after each miss a stratum below, until the first reversal on the skill; (2) after it, the criterion's information is evaluated at the estimate under a prior twice as wide. Scoring, exposure, family and sibling rules, the floor, pretest slots are untouched; a passage is one unit. One new migration, **`supabase/migrations/20261014000100_startup_step.sql`** (not applied; after `20261013000100_item_sets.sql`).
  - *Simulated* (`npm run sim:cat -- --part c`; 200 takers per θ, eight questions; a served text part on a stand-in pool shaped like the live banks):

    | Taker | | mean b at questions 1 to 8 | first question within 0.5 of θ (median; share who get one) | shown stratum 5 or 6 in the first five | correct |
    |---|---|---|---|---|---|
    | θ = −2, text | before | 0.0, 0.0, −0.7, −0.5, −0.9, −1.1, −1.1, −1.2 | none in eight; 29% | 0% | 23% |
    | | after | 0.0, −0.8, −1.3, −1.1, −1.5, −1.4, −1.6, −1.6 | 3rd; 82% | 1% | 32% |
    | θ = 0, text | before | 0.0 throughout | 1st; 100% | 0% | 49% |
    | | after | 0.0 throughout | 1st; 100% | 14% | 49% |
    | θ = +1, text | before | 0.0, 0.0, 0.5, 0.3, 0.6, 0.5, 0.6, 0.6 | 3rd; 82% | 0% | 65% |
    | | after | 0.0, 0.5, 0.7, 0.8, 0.8, 0.7, 0.9, 0.9 | 2nd; 91% | 41% | 58% |
    | θ = +2, text | before | 0.0, 0.0, 0.8, 0.6, 0.9, 1.2, 1.1, 1.3 | none in eight; 37% | 0% | 78% |
    | | after | 0.0, 0.8, 1.4, 1.6, 1.6, 1.6, 1.8, 1.8 | 3rd; 84% | 69% | 65% |
    | θ = +2.5, text | before | 0.0, 0.0, 0.9, 0.7, 1.0, 1.4, 1.3, 1.4 | none in eight; 45% | 0% | 83% |
    | | after | 0.0, 0.9, 1.5, 1.8, 1.8, 1.9, 2.0, 2.1 | 3rd; 91% | 74% | 70% |
    | θ = +3, text | before | 0.0, 0.0, 0.9, 0.8, 1.0, 1.5, 1.4, 1.6 | none in eight; 0% | 0% | 87% |
    | | after | 0.0, 0.9, 1.7, 2.1, 2.0, 2.1, 2.3, 2.3 | 4th; 67% | 85% | 74% |
    | θ = +2.5, Matrix & Series | before / after | 0.5 to 0.9 from the 4th / 1.0 to 1.3 from the 3rd | none / none (the pool ends at 2.0) | 11% / 78% | 86% / 80% |
    | θ = +2.5, Spatial | before / after | to 0.3 by the 8th / 1.3 to 1.6 at the 3rd to 5th, then 1.1 | none / 4th; 64% | 0% / 81% | 94% / 82% |
    | θ = +2.5, Quantitative | before / after | to 0.6 / 0.7 to 0.9 | none / none | 0% / 0% (the pool ends at 1.3) | 88% / 84% |

    Recovery of the part's own estimate over a N(0, 1) population (300 takers, eight questions; the sampling SE of r is about .02): text r .820 → .817 and RMSE .580 → .585; Matrix & Series .806 → .819, .623 → .603; Spatial .709 → .709, .665 → .664; Quantitative .823 → .811, .612 → .628. No change beyond sampling error: items of discrimination 1 are about as informative a stratum off target, so the rule changes what is asked, not how well it measures. That also bounds what it can do for a strong taker's score: the error at θ = +3 after eight questions is still about 1.3 (it was 1.4); a harder pool and more discriminating items are what reduce it (M3.12).
  - *What it cannot do.* Quantitative has no item above b ≈ 1.3 and Matrix & Series none above ≈ 2.0: M3.12. On Spatial the criterion's division by time pulls the difficulty back down after the start-up (cheaper, easier rotations win). **Owner:** keep §7.4's "information per second" inside a part, or rank by information alone once a part's minimum decides its length.
  - *The accepted adaptive channel (A24-sec)* is plainer during the start-up (a harder item follows a correct answer); no reply gains a field and the bounds are unchanged.
- **A minimum of questions in every part (DESIGN §7.4; A15).** The owner: "its ok to have more questions if there is time, but each section should have a minimum number of questions asked, even if running over the originally estimated time for that section." (Matrix & Series had served five.)
  - *Proposed and built:* six answered questions for Matrix & Series, Spatial, Quantitative, Logical Reasoning, Vocabulary and the three knowledge parts; Reading Comprehension stays two passages (6 to 8 questions; a third only when fewer than five of those were answered). One table, `web/src/engine/plan-table.ts` `PART_MINIMUMS`. At most two more than six are shown when questions run out of time; more questions when time remains; skip, finish early, the hard stop and the precision stop as before; a focus session has none. Logical Reasoning's share is now 6 minutes (six questions at the bank's 60 s). **Owner:** the number (six everywhere), and whether Vocabulary and the knowledge parts should have more than six (they are 15 to 20 s a question).
- **Where the time goes (the simulator had said 45 minutes for that session).** From the session's own record: 19.0 minutes in the seven timed tasks (reaction time 3.5, Working Memory 12.1, coding and reading 3.5), 29.9 minutes answering the 67 questions, and 5.4 minutes between an answer and the next question (4.8 s each: the confidence slider). The simulator had the timed tasks at their [SPEC] model time times a blanket 1 to 1.6 (the Working Memory blocks at about 5 minutes, not 12) and 2 s for the slider.
  - *Fixed* (`scripts/sim-session.ts`, "Where the time goes"): each block's own time model on the trials given, the span model re-estimated from that session (it gives 172, 277 and 226 s for the trials that took 173, 319 and 233 s), 25 s for what the other blocks' screens take over their model, 4.8 s after each answer, and a ±15% spread of pace between takers ([SPEC]: there is one real session). The question times are the items' expected times, **not rescaled**: the owner was quicker than those on text questions (0.65 to 0.85) and at or over them on the others. Put on that session's own trials and questions the model gives 53.4 minutes against 54.2 (the rest is the backward block's entry time at lengths 8 and 9). This is an accounting on the record, not a re-run of the rules of that day.
  - *That session against a typical simulated one, part by part* (minutes; the session's own figures are its answer times plus 4.8 s a question; simulated medians of 400 eleven-part sessions under the rules of today, θ ~ N(0, 1)):

    | Part | the owner's session | typical, simulated | why they differ |
    |---|---|---|---|
    | Reaction Time | 3.5 | 3.6 | |
    | Matrix & Series | 5.1 (5 questions) | 5.4 (8) | six at least now; one series took 151 s |
    | Logical Reasoning | 6.6 (8) | 6.7 (6) | 45 s a question against the bank's 60 |
    | STEM knowledge | 2.7 (9) | 2.5 (6) | 13 s against 20 |
    | Spatial | 5.4 (13) | 5.1 (10) | 20 s a question; harder ones take longer |
    | Vocabulary | 2.6 (10) | 2.2 (7) | 11 s against 15 |
    | Working Memory | 12.1 | 5.2 | the reactive procedure, and a typical taker stops at shorter lengths (a taker at θ = +2: 7.5) |
    | Quantitative | 8.0 (7) | 6.4 (6) | one question ran its 180 s out |
    | Humanities | 2.6 (7) | 2.5 (6) | |
    | Arts & Practical | 2.5 (8) | 2.5 (6) | |
    | Processing & Reading Speed | 3.5 | 3.9 | a typical reader is slower than 310 words a minute |
    | **Session** | **54.2** | **45.6** | |

  - *Lengths with the reactive blocks and the minimums* (`npm run sim:session`, 400 sessions each, active minutes; the hard stop is at 57):

    | Session | taker | median | 95th percentile | at the hard stop |
    |---|---|---|---|---|
    | six parts | typical | 29.5 | 35.2 | none |
    | | 1.25 times slower | 33.6 | 42.3 | none |
    | | 1.5 times slower | 39.3 | 50.8 | 1% |
    | eleven parts | typical | 45.6 | 54.4 | 3% |
    | | 1.25 times slower | 53.3 | 57.0 | 29% |
    | | 1.5 times slower | 57.0 | 57.0 | 74% |
    | twelve parts (with Reading Comprehension) | typical | 54.5 | 57.0 | 35% |
    | | 1.25 times slower | 57.0 | 57.0 | 83% |
    | | 1.5 times slower | 57.0 | 57.0 | 98% |

    The device-only six parts: 28.8 / 34.6. With one question in ten left to run out of time (each costs its whole limit, three minutes or more): eleven parts 60% at the hard stop, twelve 95%. A taker at θ = +2 on everything, eleven parts: 48.2 / 57.0 / 6%.
  - *What is said.* Six parts "about 30 minutes" (typical 29.5), the eleven "about 45" (45.6), with Reading Comprehension "about 55" (54.5; `plan-table.ts`). The words are true of the typical session; the twelve-part one is not safe:
  - **Twelve parts do not fit a typical taker with margin** (a third reach the hard stop, and what they lose is the end of the session). The hard stop was not moved. Options, simulated on the same people (typical: median / at the stop; 1.25 times slower: at the stop):

    | | typical | 1.25 times slower |
    |---|---|---|
    | as built, twelve parts | 54.5 / 35% | 83% |
    | T: the six parts planned three minutes shorter when text parts are on (Matrix & Series and Spatial fall to their six) | 52.7 / 24% | 78% |
    | E: two of the three knowledge parts per session | 52.1 / 21% | 73% |
    | F: Reading Comprehension in place of Logical Reasoning (eleven parts), the two in alternate sessions | 48.2 / 7% | 47% |
    | eleven parts, no Reading Comprehension (today's live set) | 45.6 / 3% | 29% |

    Recommended: **F** (or leave Reading Comprehension off): it is the only one that leaves a typical taker ten minutes. None makes a taker a quarter slower than typical safe; that needs fewer parts in a session. Before a build of this branch reaches `main`, the repository variable `HB_TEXT_AXES` must not be `all` unless that is decided (it is `all` today; ROADMAP M3.11 phase 2).
- **The save's label.** The owner's save said `bank_version: m1-static` at the top although its questions were served from `2026.10.12-b2`: the label was the build's constant. *Fixed:* a file that holds a served session says the server's bank version, a merge keeps the latest, and a file made on the device alone says `m1-static` (DESIGN §8; `save/bank-version.ts`). It is a label only; files written before keep theirs.
- **Harder items at the upper end:** the owner's note is the new backlog task **M3.12**.
- **The remaining families (M3.11 phase 3; branch `feat/served-families`).** The owner: "work on the fermi estimation scoring, and the logic games screen, the remaining families. suspend the alternate uses family. i don't want to use a model for any scoring. nothing against it, i just don't want to pay for hosting a scoring model right now." Built: Fermi Estimation, Logic Games, Emotion Reading (vignettes and situational judgments) and Creative Thinking (word links) served, scored on the server without any model, and planned when the server has their questions (`live_axes`; the build variable `HB_TEXT_AXES` is removed, per "the site is live and i want any edits we make to go live as soon as we push it. stop setting up artificial roadblocks"). The alternate-uses task is suspended (M6.4). Details under M3.11 phase 3.
  - **Session length with the remaining families.** All sixteen parts in one session do not fit: typically about 75 minutes, and simulated every session reaches the 57-minute stop, at the model's pace and 1.25 times slower (Fermi, last, is never reached). *Built:* the served parts take turns, three groups, one a session (`plan-table.ts` `ROTATION`): typical 44.5 to 45.6 minutes (p95 53.8 to 54.9, 3 to 4% at the stop), 1.25 times slower 52.4 to 53.4 (25 to 31% at the stop), the same as the eleven-part session of phase 1. *Proposed, not built:* four turns, e.g. {Logical Reasoning, Creative Thinking}, {Reading Comprehension, Arts & Practical}, {Logic Games, Vocabulary, STEM}, {Fermi, Emotion Reading, Humanities}: typical median 43.1 and 1% at the stop for the longest; 1.25 times slower 45.0 to 50.1, 6 to 19% at the stop (200 simulated sessions each). Each skill is then asked every fourth session. Changing it is one table.
  - *Open:* (8) the rotation (three turns as built, four, or none); (9) apply `20261015000100_rat_answers.sql`, `20261015000200_continuous_items.sql`, `20261015000300_live_axes.sql` after the two of phase 2; (10) the SJT key is the model ensemble's until expert or population ratings exist (§5.2); (11) whether Fermi interval hits enter Calibration (M4.8).
- **Open, for the owner:** (1) the typed-answer grace at a time-out (options above); (2) the start-up step and the wider aim as built, or off; (3) "information per second" inside a part (Spatial); (4) six as the minimum everywhere; (5) Reading Comprehension as a twelfth part, or option F; (6) the G7 waiver for span 1.2.0; (7) applying the two migrations, in order: `20261013000100_item_sets.sql`, `20261014000100_startup_step.sql`.


## Owner decision 2026-10-13: the confidence on the question screen
The owner, after the full session: "I'm thinking about dropping the confidence question, i see the value in it, but it honestly adds a lot of delay to taking the test because it is a constant interruption. perhaps for now we change it to being part of each question submission rather than a followup after submitting each answer. the test taker can click on the confidence scale to set their confidence between random and certain, but if they dont then no confidence score is recorded. and only one button press for submission is required." (In that session the step after each answer averaged 4.8 s, about 5.4 minutes.) Built on branch `feat/inline-confidence` (worktree `~/code/wt/conf/humanbench`, from `dev`); **not merged, nothing pushed, the live project not touched, no server change** (DESIGN §3 row 12, §7.1 "Calibration", §10, §13, §14.6 ex. 9; R-5.6.x; M1.15, A15).

- *Built.* Every counted question (device-made and served; multiple choice, passage questions and typed entry) carries a small optional scale, "How sure are you? Optional", just above its own Confirm or Submit button and inside its form (`session/ConfidenceScale.svelte`, drawn there by the renderers through `render/common/answer-slot.ts`). Five points from the chance level, "a guess" (1/k for k options, 0% for typed entry), to 100%, "certain" (`session/calibration.ts` `confidenceLevels`). It starts unset and says "Not set"; one click, tap, Space or arrow key sets it; "Clear" unsets it. **One press of the question's button sends the answer and, if set, the confidence**; there is no step after the answer. Unset means `confidence_pct` null, never a default. Keyboard: the scale is one tab stop after the answer; option keys typed on it do not change the answer; Enter on it submits (a held Enter does not). Native radios with names ("25%, a guess", "100%, certain"), a description for screen readers, 44 px pills that wrap at 320 px and with large text, the second tap of a double tap on the previous question's button sets nothing (`render/common/double-tap.ts`, shared with the option cards). The follow-up slider (`Confidence.svelte`) is gone.
- *Practice.* The practice questions show the same scale, so it is met first where nothing counts; what is set there is not kept. The instructions say it once: "Each question also has a small optional scale for how sure you are of your answer. Set it before you submit if you like, or leave it." (Ready screen, both versions; the privacy notice says the confidence is kept "when you set the optional scale").
- *Calibration.* Over rated answers only. **At least 10 rated answers in a session (`CAL_NORMS.min_responses`, unchanged) or Calibration is "not measured" for it.** Why ten (`tasks/priors.ts`): at ten the session's observation carries about 0.6 of the prior's information (posterior SD 0.79 from 1; five: 0.87; twenty: 0.69), and the session's own SE of B is stable enough to use (about 24% relative error at ten, 35% at five, and with few answers often exactly 0, which would overstate the weight about ninefold); a six-part session asks about 25 counted questions, so rating about half of them is enough. The UX-063 flag `confidence_untouched_n` is retired: leaving the scale unset is normal and nothing flags it; old saves that carry it stay valid and score as before. The save format is unchanged (`confidence_pct` was already nullable; schema version unchanged).
- *Time.* The answer's response time now includes setting the scale when it is set (about a tap). The simulator (`scripts/sim-session.ts`) replaces the 4.8 s step with 0.5 s for the screen change to the next question (a served question's fetch is off the clock) and 1 s for the tap on the scale, which the simulated taker makes on every question (the upper end). Lengths (400 sessions each, active minutes; the hard stop is at 57):

    | Session | taker | median | 95th percentile | at the hard stop | before (with the 4.8 s step) |
    |---|---|---|---|---|---|
    | six parts | typical | 29.3 | 34.5 | none | 29.5 / 35.2 / none |
    | | 1.25 times slower | 32.9 | 41.3 | none | 33.6 / 42.3 / none |
    | eleven parts | typical | 45.0 | 52.2 | 1% | 45.6 / 54.4 / 3% |
    | | 1.25 times slower | 50.7 | 57.0 | 18% | 53.3 / 57.0 / 29% |
    | twelve parts (with Reading Comprehension) | typical | 53.6 | 57.0 | 23% | 54.5 / 57.0 / 35% |

    The session is barely shorter in the middle: the parts that end on their time (Matrix & Series, Spatial past their minimum) fit more questions into it rather than ending sooner; the parts that end on their minimum (the text parts, Quantitative) and the slow tail get shorter. In 200 simulated eleven-part sessions the time around the answers is 1.5 minutes a session (it was about 5 with the step), and Spatial answers a median of 12 questions (10 before). Text part typical lengths re-measured (`plan-table.ts` `typical_s`): Logical Reasoning 369 s (389), the knowledge parts 151 (149, one more question now fits), Vocabulary 132 (139), Reading Comprehension 526 (549); the six parts 1,760 s (1,769). The words stay "about 30" and "about 45 minutes".
- *Server.* `submit` already takes a null confidence, stores NULL, and validates only a non-null value (0 to 100).
- *Calibration on the server (owner decision 2026-10-13: "yeah, lets add calibration to the live score if they submit sufficient confidence data.").* New migration **`supabase/migrations/20261015000100_server_calibration.sql`** (not applied; after `20261014000100_startup_step.sql`): `rescore` scores Calibration (CAL) from each counted session's rated, scored answers (valid, not pretest, with a server verdict and a confidence) with the app's observation model (x = −Brier, σ = √(SE² + τ_res²), λ = brier_sd·√reliability, d = −brier_mean, the practice gain as for every axis), only from 10 rated answers a session (`app_config` `rescore.min_cal_items` = 10; the norms in `cal.norms` = `CAL_NORMS`; removing that row turns it off). The reply has the same keys: `eap.CAL` (rounded like every axis) when some session measured it, else the count of rated answers under `withheld.eap.CAL`; nothing per answer. `finish` returns no scores and is unchanged. The profile shows Calibration for an online session when the server returns it (no client change was needed: any published axis is shown). Cross-checked against the app's engine on the same rows: CAL mean and SD agree to under 1e-9 (`scripts/db/calibration.db.test.ts`, 7 tests). The device still never computes Calibration from served answers (it has no verdicts).
  - **Owner: a verdict channel.** The client chooses the weights of this sum: an answer rated 50% adds 0.25 whatever its verdict, so nine 50% answers and one 100% answer give a published Calibration that moves by about 0.1 Brier (about 0.8 θ) with that one verdict. No minimum or rounding hides it. It is of the kind of the accepted adaptive-selection channel (A24-sec), bounded by `rescore`'s per-anon-id and per-address limits; documented in the migration and `supabase/README.md`. Options: accept it like A24-sec (as built); turn server Calibration off (remove `cal.norms`); or publish it only combined over several sessions.
- *The answer at the time-out (owner decision 2026-10-13: "yes, submit any answer currently typed, if nothing is typed or selected, nothing is submitted.").* The renderers report the answer as it stands (the option chosen, or the typed text when the question's parser reads it; `render/common/answer-slot.ts` `draft`), and when the question's time runs out that answer is sent, with the confidence if set, scored as any answer (right or wrong), its response time the limit, marked `submitted_at_timeout` (device: the tuple's `extra`; served: the answer's client flag). Nothing chosen or typed, a choice taken back, or a text the question cannot read: a time-out with no answer, as before. The notice says "That question ran out of time. Your answer was sent as it stood."; the timer's warning now says "When the time is up, what you have chosen or typed is sent as your answer." (the old "An answer counts only once you have entered it." is gone) for every question. Server: `submit` takes such an answer as it is (no rule on the response time against the limit; unknown client flags are kept and count for nothing in the integrity checks); a DB test covers it. The minimums count such an answer as answered.
- *Merged with `feat/served-families` (local `dev`, 2026-10-14).* The families that are not rated (a Fermi range, a situational judgment, an emotion vignette; `backend/items.ts` `asksConfidence`) show no scale and send no confidence; word links (typed word: `render/rat/RatRenderer.svelte` now carries the scale and the time-out draft) and logic games (drawn as passage questions) are rated. The Ready text in a session with an unrated part says "Most questions also have a small optional scale…". The server's Calibration migration is renumbered **`20261015000400_server_calibration.sql`**, after `20261015000300_live_axes.sql`, and its `rescore` is the families body (`20261015000200_continuous_items.sql`) plus the Calibration edits (Gaussian and GRM answers have no 0/1 verdict and are not rated). The new parts' typical lengths re-measured without the follow-up step: Logic Games 446 s (469), Fermi 363 (372), Emotion Reading 243 (252), word links 151 (149).
- **Open, for the owner:** (1) five points or a finer scale; (2) whether practice should show the scale; (3) the verdict channel of server Calibration (above); (4) a minimum of ten rated answers, or another number; (5) whether a session whose ratings are all alike (e.g. all 100% and all right) should get a floor on its SE (today ten such answers give an observation of about τ_res alone).

## Owner decisions 2026-10-15: the cross-skill start of a part
The owner: "use cross-subject correlations to start each part at a better difficulty without asking more questions … a user does very well on the quantitative series of questions, so when we shift over to science or logic or other similar families of questions, we start at a higher difficulty level. if they get it wrong, of course the adaptive nature drops the difficulty down from there. but not every test taker needs to start every family of questions at the same difficulty level." Plan approved: (1) start each part from the cross-skill estimate, app and server; (2) bold borrowing for selection, today's model for reported scores; (3) change the order of the parts only if simulation shows a clear gain; (4) the selection must follow Σ when it is re-estimated; (5) returning people start each part from their previous results. Built on branch `feat/cross-skill-start` (worktree `~/code/wt/xskill/humanbench`, from `dev`); **not merged, nothing pushed, the live project not touched.**

- *Cause (why the owner, near-perfect on every part, began every part at stratum 2 to 3).* The first item of a part is chosen by the §7.4 criterion at the aim (`selector.ts` `selectionAim`, server `hb.session_aims`), and the aim of 2026-10-13 was the per-skill EAP of the skill's OWN answers under N(0, 2²): with no answer on the skill it is the prior mean, 0, whatever the other parts showed. The in-session estimator ignores the other skills by design (`scorer.ts` eapAxis, §11.2: "correlations with other axes are ignored"), and nothing in selection read Σ (it was used only by the correlated MAP of the results). So borrowing was **absent** from selection; neither the prior's width nor Σ's size was the cause. With the aim at 0 the candidate strata are those nearest 0 (3, then 2 and 4) and the criterion divides by time, which favours the quicker, easier stratum 2 to 3 items: the owner's evidence exactly. Returning people too: the device's session started from an empty posterior (`run.ts` passed only this session's observations; `retest.ts` `nextSessionPrior` exists and is used nowhere), and the server's session state started empty (`start_session` kept only the seen lists).
- *Built (1, 2, 4).* The aim is the EAP of a skill's own answers under the **conditional** prior of the skill given every other skill's answers, through Σ_sel = f²·R(s): the scoring Σ's correlations times the borrowing strength s, widened by f = 2 (`engine/xskill.ts`; each other skill's answers become a Gaussian message, its grid posterior with the grid prior divided out; the conditional prior is the Gaussian regression on them). A part's first question is aimed at that conditional mean; the start-up step of 2026-10-13 then steps from it, so a miss drops a stratum at once. **Selection only:** the session's posterior, the criterion's variance, the per-skill stop, `finish`, `rescore` and the app's results are untouched, so a profile with peaks and dips is reported as measured. Σ is the scoring Σ: on the server `app_config` `scoring.sigma`, read at every call, so the nightly re-estimate (§3) is used as soon as it is written; in the app Σ_init (pinned, `SIGMA_VERSION`). With s = 0 the aim is exactly that of 2026-10-13 (tested).
- *Built (5).* A returning person's earlier sessions are evidence for the aim: per session and skill one Gaussian term carrying what that session's own posterior says beyond the prior (`xskill.ts` `sessionEvidence`). Server: `start_session` adds `state.prior` ({n, lam, x} a skill, summed over the 10 most recent sessions of the ids the save proves, from the {n, mean, sd} that `finish` keeps, or the grid of a session never finished; no key when there is nothing). App (device-made questions, the static version): `session/earlier.ts` re-scores the save's last 10 sessions from their raw answers. Never a score.
- *Default strength s = 0.75 (`XSKILL_BORROW`, `selection.borrow_strength`), by simulation.* `npm run sim:cat -- --part d` (new; `src/sim/xskill.ts`): ten question parts in the session's order (MAT LR KST SPA VOC RC QR KHU KAP LG), six questions each, by the server's rule (criterion at the aim, start-up, top five) over stand-in pools (b −2.5 … 3.5 evenly, a = 1, the skill's own time), 1,000 takers a row. "To within 0.5": questions until one is within 0.5 of θ (7 when none of six is), mean over parts; "|b1 − θ|": the first question's distance, all parts / parts 2 to 10; reported scores of the answers a profile is made from (a returning taker: both sessions, as the results re-score them), the per-skill EAP (the server's `rescore` model) and the correlated MAP over Σ (the app's results):

  | Takers | s | to within 0.5 | none in six | \|b1 − θ\| all / later | per-skill r, RMSE | joint r, RMSE | spiky skill: to within, mean error, RMSE |
  |---|---|---|---|---|---|---|---|
  | θ ~ N(0, Σ) | 0 (before) | 2.51 | 10% | 0.80 / 0.80 | .747, 0.665 | .806, 0.592 | |
  | | 0.5 | 2.32 | 9% | 0.70 / 0.68 | .752, 0.659 | .809, 0.588 | |
  | | **0.75** | 2.34 | 9% | 0.70 / 0.69 | .750, 0.662 | .808, 0.590 | |
  | | 1 | 2.43 | 10% | 0.71 / 0.71 | .748, 0.664 | .808, 0.589 | |
  | +2.5 on every skill (the owner) | 0 | 5.36 | 36% | 2.51 / 2.51 | –, 1.254 | –, 0.609 | |
  | | 0.5 | 3.99 | 23% | 1.41 / 1.29 | –, 1.216 | –, 0.575 | |
  | | **0.75** | 3.48 | 19% | 1.15 / 0.99 | –, 1.213 | –, 0.565 | |
  | | 1 | 3.07 | 16% | 0.97 / 0.80 | –, 1.214 | –, 0.561 | |
  | one skill 2.5 below the rest (a dip) | 0 | 2.76 | 14% | 0.96 / 0.98 | .805, 0.760 | .799, 0.760 | 5.18, +1.17, 1.384 |
  | | **0.75** | 2.69 | 14% | 0.89 / 0.90 | .807, 0.757 | .800, 0.758 | 5.53, +1.17, 1.376 |
  | | 1 | 2.79 | 15% | 0.91 / 0.92 | .806, 0.759 | .798, 0.760 | 5.69, +1.18, 1.387 |
  | one skill 2.5 above (a peak) | 0 | 2.78 | 14% | 0.98 / 1.00 | .803, 0.781 | .803, 0.771 | 5.19, −1.22, 1.417 |
  | | **0.75** | 2.71 | 14% | 0.90 / 0.91 | .805, 0.778 | .803, 0.769 | 5.46, −1.22, 1.411 |
  | | 1 | 2.83 | 16% | 0.92 / 0.94 | .804, 0.780 | .801, 0.771 | 5.64, −1.22, 1.419 |
  | returning (2nd session, aimed with the 1st) | 0 | 2.51 | 11% | 0.79 / 0.79 | .842, 0.534 | .868, 0.490 | |
  | | **0.75** | 2.36 | 13% | 0.57 / 0.57 | .846, 0.526 | .872, 0.483 | |
  | | 1 | 2.31 | 12% | 0.55 / 0.55 | .846, 0.526 | .872, 0.483 | |

  Why 0.75: the owner's profile gains most at 1, a Σ-shaped population at 0.5; 0.75 keeps most of both (owner 5.36 → 3.48 questions a part, about 17 questions sooner over the nine later parts; population 2.51 → 2.34) and costs a dip or a peak less than 1 (+0.3 questions on that one skill, against +0.5). **Reported scores do not get worse** in any group at any s, and **spiky profiles are not flattened**: the error on the dipped (peaked) skill is +1.17 (−1.22) with and without borrowing, which is the scoring prior's own shrinkage after six answers. (Measured along the way: the score of the SECOND session alone gets slightly worse for a returning taker, RMSE 0.665 → 0.677 at s = 1, because its items were placed with information that score does not hold; the profile, which re-scores both sessions, gets better, as in the table.) Each part run until SD < 0.5 (at most 20 questions; 400 takers): questions a session 142.7 → 141.9 (population), 146.1 → 143.0 (owner), 142.8 → 142.4 (dip).
- *Session length* (`npm run sim:session`, new `--correlated yes` and `--borrow`; 400 sessions each; active minutes, mean / median / 95th percentile): device six parts, typical takers 28.88 / 28.52 / 34.2 before, 28.93 / 28.42 / 34.6 after; a taker at +2.5 31.51 / 31.31 / 37.8 before, 31.94 / 31.59 / 38.3 after (the Quantitative part, which ends on its six-question minimum, takes 0.5 minutes longer because its harder questions take longer); online with Logic Games, Vocabulary and the two knowledge parts, typical 44.15 / 43.58 / 51.0 → 44.17 / 43.49 / 51.2; at +2.5 46.50 / 46.11 / 54.6 → 46.83 / 46.53 / 55.5, hard stop 3% → 4%. The made-up text questions of the simulator have no difficulty, so the online figures move only through the three device parts.
- *Order of the parts (3): not changed.* Sorting the ten parts by how much each says about the others (sum of squared correlations in Σ: KHU MAT LR RC LG KAP KST VOC QR SPA) against the session's order (MAT LR KST SPA VOC RC QR KHU KAP LG), at s = 0.75 with the same 400 takers: population 2.33 against 2.35 questions to within 0.5, the owner's profile 3.60 against 3.46. No gain; the session already opens with Matrix & Series, the most correlated of the six parts every session has, and the rotation groups are left as they are.
- *Server.* New migration **`supabase/migrations/20261016000100_cross_skill_aim.sql`** (not applied; after `20261015000400_server_calibration.sql`): `hb.session_aims(state, axes)` (replaces the one-argument one; works out the aims of the axes asked for), `hb.prior_state`, `hb.rank_live` re-created with one change (passes its axes), `start_session` re-created with one change (`state.prior`), two settings (`selection.borrow_strength` 0.75, `selection.prior_sessions` 10; 0 and 0 switch it off). Cost: `hb.session_aims` for one axis of a session with answers on nine skills about 8 ms against 5 ms with borrowing off (local Postgres). Key secrecy: no reply gains a field; the adaptive channel of A24-sec now runs across parts and from earlier sessions (whose scores `rescore` publishes, rounded). `scripts/db/xskill.db.test.ts` holds the SQL to the app's aim on random answers over four skills, for a returning person, a stranger's file, the switches and a re-estimated Σ.
- **Open, for the owner:** (1) s = 0.75, or 1 for strong takers' sake (the table); (2) whether the earlier sessions should be moved to today's practice level (§7.8 ρ, about a third of an SD at the second session) before they aim this one (not done: the aim starts that much low, and the start-up step climbs a stratum a question from there); (3) in the online version the server does not see the device's timed tasks (memory, reaction time, coding), so they lend nothing to the served parts' aim; sending their summaries would need an RPC change; (4) the stand-in pools are evenly filled to b = 3.5: with the live banks thin at the top (M3.12) a strong taker's early start is capped by what the pool holds.
