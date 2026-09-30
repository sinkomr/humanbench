# HumanBench — Design Study and Implementation Spec (v1.0, September 2026)

HumanBench cannot run on GitHub Pages alone, because Pages only serves static files. The recommended build keeps the front end on GitHub Pages (free, and it works with your own subdomain) and adds a free Supabase Postgres backend. That backend keeps answer keys and scoring on the server. A nightly Python job in GitHub Actions re-calibrates item difficulty from real users' responses.

## TL;DR
- **Architecture:** GitHub Pages serves the static TypeScript app and Supabase (Postgres + row-level security + SQL RPC functions) stores keys, scores responses and holds data. A GitHub Actions cron runs the Python calibration jobs and also stops Supabase's 7-day inactivity pause. Everything fits free tiers up to roughly 10^4 users. A fully static MVP (procedurally generated items only, with a local save file) can ship first with no backend at all.
- **Psychometrics:** 16 leaf axes in 5 clusters, each item loading on one primary axis, scored with a correlated-factor Bayesian IRT model and chosen adaptively by *information per second*. One hour gives a fuzzy blob (per-axis SE ≈ 0.55σ). The save file carries the posterior forward, so SE falls to ≈ 0.30σ after about 5 sessions, but practice effects of about +0.33 SD must be modelled.
- **Where the evidence overrides your instincts:** (1) Emotion-recognition tests cannot responsibly flag autism. Even the large RMET group difference (d ≈ 1.15) would give a positive predictive value of about 9% at population base rates, and alexithymia, not autism, drives much of that difference. Build the emotion axis as a non-diagnostic skill measure. (2) Released SAT/ACT/LSAT/GRE/MCAT items are copyrighted and must not be served. Use them at most as private difficulty anchors, and seed difficulty from public-domain or openly licensed sources (NAEP, OpenStax), plus ICAR's published statistics (ICAR itself is academic-use only).

---

## 0. Decisions table (from the interview)

| # | Topic | Decision | Source |
|---|---|---|---|
| D1 | Purpose | Self-knowledge; engaging, shareable, "good-enough" psychometrics. No research-grade norms and no human-vs-AI overlay in v1 | User |
| D2 | Gold standard | Tier (a) strict key; tier (b) scored against a verified truth value; tier (c) consensus/expert-keyed | User |
| D3 | Session | ~1 hour, plus a save file that accumulates evidence and excludes items (and item families) already seen | User |
| D4 | Difficulty | Seeded from public tests, then calibrated online from users; users act as the pilot sample | User |
| D5 | Budget | $0; paid parts are optional and costed | User |
| D6 | Hosting | Needs a backend; GitHub Pages preferred if possible | User |
| D7 | Axes | Thinking processes crossed with knowledge domains; ~12–20 axes, hierarchical, correlated | Accepted default |
| D8 | Scoring | Correlated-factor MIRT, adaptive, uncertainty bands, no headline number | Accepted default |
| D9 | Items | AI-authored in template/isomorph families with provenance; gold = multi-solver + programmatic + human audit | Accepted default |
| D10 | Range | Middle school to olympiad | Accepted default |
| D11 | Integrity | Closed book; honor code plus anomaly flags | Accepted default |
| D12 | Population | Adults 18+, English, web; Python for backend/offline | Accepted default |
| D13 | Purpose (extension) | Self-knowledge, plus optional notes the person gives their own AI assistant. The notes are built on the device and contain instructions only. Results feed in only as suggestions, after checks on real data. No human-vs-AI overlay (D1 unchanged) | User (Part 1 approved 2026-09-29; Part 2 pending) |

**Epistemic tags.**
- **[EST]** = established and sourced in this study.
- **[EST†]** = standard literature result drawn from background knowledge and not re-fetched here; Claude Code should verify it before quoting it in user-facing text.
- **[CALC]** = a derivation.
- **[SPEC]** = a hypothesis.

---

## 1. Executive summary

**Key design decisions**
1. **16 leaf axes in 5 clusters** (Reasoning, Verbal, Spatial/Memory, Speed, Knowledge, Social-Creative), with a drill-down from 5 clusters → 16 axes → sub-facets. Knowledge splits into 5 domain axes. No global score is shown.
2. **Simple-structure correlated-factor IRT.** Each item loads on exactly one axis, and axes are tied together by a learned correlation matrix Σ. Scoring then factorises into per-axis likelihoods times a multivariate-normal prior. That makes MIRT cheap and sparse-data-friendly and lets strongly measured axes "borrow strength" for weakly measured ones [CALC, §7].
3. **Item sources:**
   - **Procedural families**, generated in Python and verified by construction: rotation, matrices, series, arithmetic/algebra, logic games, span, RT, reading-speed passages. These are effectively unlimited.
   - **Finite AI-authored banks:** knowledge, reading comprehension, logical reasoning, Fermi, emotion, situational judgment, remote associates.
3. **All keys live on the server, all generation is in Python, and the front end is TypeScript.** The browser never receives a key for a finite-bank item.
4. **Adaptive selection maximises Fisher information per expected second**, with randomesque exposure control and a coverage floor for every axis.
5. **The save file is signed JSON (HMAC).** It holds seen item IDs and family IDs, raw responses, and posterior means and covariances. It is merged by re-scoring from raw responses, never by averaging scores.
6. **Tier (c) ships in v2:**
   - text emotion understanding keyed by appraisal theory (STEU-style, newly written);
   - situational judgment keyed by an expert/AI ensemble, later blended with population consensus;
   - Remote Associates (tier a);
   - Alternate Uses scored by in-browser embedding semantic distance.

**Recommended stack.** Vite + TypeScript + Svelte + D3 front end on GitHub Pages; Supabase free tier (Postgres 15+, RLS, PL/pgSQL RPCs); Python 3.12 offline pipeline (SymPy, Z3, NumPy/SciPy, girth, catsim) run locally and by GitHub Actions cron; two repos (public `sinkomr/humanbench` app, private `sinkomr/humanbench-bank` items and keys).

**Can this be served from GitHub Pages?** Only the front end. [EST] GitHub Pages hosts static files only, with these limits: 1 GB published site, a soft bandwidth limit of 100 GB/month, a soft limit of 10 builds/hour (not applied to custom Actions workflows), and possible HTTP 429 rate limiting. GitHub also says Pages is "not intended for or allowed to be used as a free web-hosting service to run your online business … or … SaaS", and sites "shouldn't be used for sensitive transactions like sending passwords or credit card numbers." A free, non-commercial, anonymous test app is compatible with those terms. The database has to live somewhere else (Supabase).

---

## 2. Prior art and reuse

### 2.1 Theory: CHC and clinical batteries
- [EST†] **CHC (Cattell–Horn–Carroll)** is a three-stratum hierarchy: g → broad abilities → narrow abilities. The broad abilities are Gf (fluid), Gc (comprehension-knowledge), Gq (quantitative knowledge), Grw (reading/writing), Gwm (working memory), Gl/Gr (learning efficiency/retrieval fluency), Gv (visual), Ga (auditory), Gs (processing speed), Gt (reaction/decision time) and Gkn (domain-specific knowledge). Schneider & McGrew (2018) discuss adding emotional intelligence (Gei). HumanBench's axes map onto these directly, which gives each axis a literature anchor.
- [EST†] **WAIS-5 (2024)** reports five primary indices: Verbal Comprehension, Visual-Spatial, Fluid Reasoning, Working Memory and Processing Speed. **Woodcock-Johnson IV/V COG** is organised explicitly around CHC broad abilities. HumanBench copies the *structure*, not the items, which are proprietary.
- **Design implication:** broad abilities typically intercorrelate positively at r ≈ .3–.7 (the positive manifold) [EST†]. This is why the blob axes are "not orthogonal" and why Σ must be estimated.

### 2.2 ICAR — the primary reusable resource
- [EST] Condon & Revelle (2014, *Intelligence* 43:52–64) built the original 60 items in 4 types:
  - Matrix Reasoning: 3×3 arrays of geometric shapes with one missing and 6 answer choices;
  - Letter-Number Series;
  - Verbal Reasoning: logic, vocabulary and general knowledge;
  - Three-Dimensional Rotation: cube renderings, "which is a possible rotation".
- [EST] Mean proportion correct in the SAPA sample: Rotation 0.19 (SD .08), Matrix 0.52 (.15), Series 0.59 (.13), Verbal 0.64 (.22). None of the items were timed.
- [EST] The pool has since grown to "more than 1,000 items" across 19 lower-level constructs. ICAR is described as a public-domain, open-source resource used in 200+ studies. The ICAR-16 sample test is widely used, and data are available as `iqitems` in R `psych` and on Harvard Dataverse.
- **Use in HumanBench:**
  1. Anchor-item calibration. ICAR items with published proportion-correct values are the best free difficulty seeds for the matrix, series, rotation and verbal axes.
  2. Direct serving is not permitted for this project. [EST] icar-project.com states "ICAR is intended for academic use exclusively," and its PsychArchives listing says it avoided a public-use license because that "feels less likely to preserve the integrity of the item material (e.g., the scoring keys)" (a registration requirement is not confirmed). Default: never serve ICAR items; use only the published proportion-correct statistics as difficulty anchors, and ask the ICAR team for permission before any other use.

### 2.3 Existing web batteries (what to copy, what to avoid)

| Tool | What it does | Lesson for HumanBench |
|---|---|---|
| humanbenchmark.com | Reaction time, sequence/number/verbal/visual memory, chimp test, typing, aim; per-test histograms | Proves the appeal of short speed and memory games; name collision (§2.6); its RT norms include device lag [EST†] |
| TestMyBrain (Germine et al. 2012) | Showed web-collected cognitive data match lab data in reliability and norms [EST†] | Supports web-based measurement; gives personalised feedback as the incentive |
| Cambridge Brain Sciences (Hampshire et al. 2012, *Neuron*) | 12 tasks, ~45k online participants; found ≥3 separable components (reasoning, short-term memory, verbal) rather than a single g [EST†] | Direct precedent for a multidimensional profile |
| Great British Intelligence Test (BBC/Imperial, Hampshire) | Online battery with hundreds of thousands of UK participants, used in COVID cognition studies [EST†] | Shows viral scale is plausible; plan the cost-escalation path (§11) |

### 2.4 Open-source adaptive and experiment tools
- **Concerto** (Cambridge Psychometrics Centre): open-source R-based CAT platform [EST†]. Too heavy for free hosting; borrow its concepts.
- **mirtCAT** (R, Chalmers): reference MIRT CAT implementation [EST†]. Use it offline to cross-check the Python engine.
- **catsim** (Python): CAT simulation (selectors, stopping rules, estimators) [EST†]. Use it for the §7 simulations.
- **jsCAT** (Stanford ROAR, JS): lightweight client CAT [EST†]. Its selection code is a useful reference, but selection runs server-side here.
- **jsPsych / lab.js / PsychoJS**: browser experiment frameworks. [EST] Bridges et al. (2020, *PeerJ* 8:e9414) found PsychoJS 2020.1 achieved inter-trial variability "under 5 ms in nearly all browsers for nearly all measures". Recommendation: custom Svelte components for the test flow, with jsPsych-style timing practice (rAF-locked onset, `performance.now()`).

### 2.5 The "jagged" meme
- [EST] **Dell'Acqua et al. (2023), HBS Working Paper 24-013:** a pre-registered experiment with 758 BCG consultants (≈7% of individual contributors). On 18 tasks inside the AI frontier, consultants with GPT-4 completed 12.2% more tasks, 25.1% faster, at >40% higher quality. On a task outside the frontier they were 19 percentage points less likely to be correct. The paper coined the "jagged technological frontier". Ethan Mollick is a co-author and popularised the image.
- [EST] **Karpathy** (X, 25 July 2024) introduced "Jagged Intelligence" for LLMs that solve hard math yet say 9.11 > 9.9, contrasting this with humans, where abilities "are all highly correlated and improve linearly all together".
- **Design implication [SPEC]:** Karpathy's contrast is itself a testable claim about humans. Human profiles *should* look less jagged than LLM profiles because of the positive manifold. HumanBench's blob will show whatever jaggedness really exists, but only if the uncertainty bands are honest; otherwise noise looks like jaggedness (§9).

### 2.6 Name collision — advice
- [EST] "Human Benchmark" (humanbenchmark.com) is a well-known cognitive-games site in exactly this space.
- [EST] "HumanBench" is already an arXiv/CVPR-2023 human-centric perception benchmark (arXiv 2303.05675) and a Go tool (`kevinburke/humanbench`).
- [EST] "HumaneBench" (Building Humane Technology, 24 Nov 2025) is an AI-wellbeing benchmark.
- **Advice:** "HumanBench" is legally usable as a descriptive hobby-project name (I did not run a trademark search, so that is a gap), but it will be confused with humanbenchmark.com in search and on social media. Recommendation: keep `humanbench` as the repo name and ship under a distinct public brand, e.g. **"HumanBench: Jagged"** or **"Jagged Mind"**. Also check USPTO TESS and domain availability before buying a domain.

---

## 3. Construct map

**Hierarchy:** 6 clusters → 16 scored leaf axes (plus sub-facets reported only in drill-down). Per-session minutes are for a 60-minute session and sum to 55 minutes plus about 5 minutes of onboarding and reveal.

| # | Cluster → Axis (CHC) | Definition / item types | Gold tier | Scoring model | Min/session |
|---|---|---|---|---|---|
| 1 | Reasoning → **Matrix & Series (Gf)** | 3×3 procedural matrices; letter/number series | a | 2PL (MC with ≥6 options, so no 3PL needed) | 5 |
| 2 | Reasoning → **Logical Reasoning (Gf-verbal)** | LSAT-style LR stimulus + question (flaw, assumption, inference, strengthen/weaken); formal syllogisms | a | 2PL / 3PL (5 options) | 5 |
| 3 | Reasoning → **Analytical/Logic Games (Gf-RQ)** | Ordering/grouping games with 3–4 questions per setup; Z3-verified | a | 2PL with a testlet effect | 4 |
| 4 | Verbal → **Reading Comprehension (Grw)** | 200–450-word passages (OpenStax/Gutenberg/AI-authored) + 3–4 questions; passage-dependence tested | a | 2PL testlet | 5 |
| 5 | Verbal → **Vocabulary & Verbal Analogies (Gc)** | Synonyms, analogies, odd-one-out | a | 2PL | 2 |
| 6 | Quantitative → **Quantitative Reasoning (Gq/RQ)** | Arithmetic → algebra → olympiad; numeric entry with tolerance | a | 2PL (entry items, so no guessing) | 5 |
| 7 | Spatial/Memory → **Spatial (Gv)** | 3D mental rotation (Shepard-Metzler polycubes), 2D rotation/mirror, paper folding | a | 2PL + RT covariate | 4 |
| 8 | Spatial/Memory → **Working Memory (Gwm)** | Digit forward/backward, spatial Corsi | b | Span: graded response model on max span; trials as binomial | 3 |
| 9 | Speed → **Reaction Time (Gt)** | Simple RT (30 trials), 4-choice RT (40 trials) | b | Lognormal/ex-Gaussian; person parameter = median log-RT | 2 |
| 10 | Speed → **Processing & Reading Speed (Gs)** | Symbol-digit-style coding (90 s); reading speed (wpm) gated by 3 comprehension questions | b | Log-rate normal model; wpm counts only if gate ≥ 2/3 | 3 |
| 11 | Estimation → **Fermi Estimation (Gq × Gkn)** | Order-of-magnitude questions against a cited true value | b | Continuous: score = −\|log10(est/true)\|, Gaussian latent model | 3 |
| 12 | Estimation → **Calibration/Metacognition** | 50–100% confidence on every tier-a answer, plus 80% intervals on Fermi items | b | Brier score and calibration slope; interval hit rate | 0 (embedded) |
| 13 | Knowledge → **STEM knowledge** (math facts, physics, chemistry, biology, earth/space, computing) | Mixed-difficulty MC/numeric, cited | a | 2PL | 3 |
| 14 | Knowledge → **Humanities knowledge** (history, geography, civics, literature, philosophy, religion) | Cited MC | a | 2PL | 3 |
| 15 | Knowledge → **Arts & Practical/Life** (music, visual arts, film; personal finance, health literacy, law/civics basics, home/mechanical) | Cited MC; numeric finance items | a | 2PL | 3 |
| 16 | Social-Creative → **Emotion Understanding & Social Judgment (Gei)** | STEU-style appraisal vignettes; SJT (emotion management, interpersonal) | c (appraisal items are closer to a) | 2PL on the key, later nominal-response/consensus | 3 (v2) |
| 17 | Social-Creative → **Creative Thinking** | Remote Associates (tier a) + Alternate Uses (semantic distance) | a + c | 2PL (RAT); continuous (AUT) | 2 (v2) |

(17 rows: 16 cognitive/knowledge axes plus Calibration, which is embedded and costs no separate time. The blob shows 16 or 17 spokes. In v1, rows 16–17 appear as "not yet measured".)

**Note on the LSAT format.** [EST] LSAC removed Analytical Reasoning ("Logic Games") starting with the August 2024 LSAT, following a 2019 ADA settlement with blind test-takers. The test now has two scored Logical Reasoning sections, one Reading Comprehension section and one unscored section. HumanBench keeps logic games anyway, as a separate axis: they are the most *programmatically verifiable* reasoning items available (Z3), and they measure deductive ordering/grouping distinct from LR. Tag them "LSAT-classic style (pre-2024)".

**Expected intercorrelations.** These initialise Σ; values are [EST†] literature ranges.

| Pair | Expected r | Basis |
|---|---|---|
| Matrix/Series ↔ Quant, Logic Games | .5–.7 | Gf–Gq overlap |
| Matrix ↔ Spatial | .4–.6 | Gf–Gv |
| Reading Comp ↔ Vocabulary ↔ Humanities knowledge | .5–.7 | Gc cluster |
| Logical Reasoning ↔ Reading Comp | .5–.7 | LSAT section intercorrelations |
| Working Memory ↔ Gf | .3–.5 | WMC–Gf literature |
| Choice RT ↔ g | −.2 to −.35 (for speed, faster = higher) | Sheppard & Vernon (2008) meta-analysis |
| Reading speed ↔ Reading comp | .2–.4 | Speed and comprehension are partly dissociable |
| Fermi ↔ Quant, STEM knowledge | .3–.5 | [SPEC] little literature |
| Calibration ↔ ability | .1–.3 | Metacognition is only weakly related to ability |
| Emotion understanding (STEU) ↔ Gc | .3–.5 | MacCann & Roberts 2008 family |
| Divergent thinking ↔ g | .15–.3 | Kim 2005; later meta-analyses |

Initial Σ: set all within-cluster correlations to .55, Reasoning↔Knowledge .45, Speed↔others .2, Social-Creative↔others .3. Then re-estimate Σ nightly from disattenuated person posteriors once N ≥ 500 users have ≥ 3 items on both axes of a pair.

---

## 4. Gold-verification pipeline

### 4.1 Common gates (every item)

A finite-bank item must pass every gate below before it reaches `status = 'live'`. Procedural families pass gates G1–G3 at the family level, and each instance is checked automatically.

1. **G1 Schema validation:** JSON Schema plus pydantic.
2. **G2 Programmatic key check,** by type (§4.2).
3. **G3 Uniqueness/ambiguity check:** exactly one option satisfies the checker. Every distractor fails for a documented reason (`distractor_rationale[]`).
4. **G4 Independent multi-solver unanimity:**
   - Solvers see the item *without* the key.
   - A Claude Code session plus ≥2 local open-weight models via Ollama (e.g. a Qwen-family 14–32B model and a Llama/Gemma-family model, sized to the Mac's RAM).
   - All solvers must agree with the key. If any solver disagrees, the item goes to human review; if any solver produces a *different defensible* answer with a rationale, the item is rejected.
   - A solver scoring 100% on a family is *not* evidence the items are easy for humans (§6.ii).
5. **G5 Source check** (knowledge, Fermi):
   - At least one authoritative citation (URL + retrieved date + verbatim supporting quote) stored in `verification.evidence`.
   - A second independent source for anything numeric.
   - Wikipedia is acceptable only as a pointer to a primary source.
6. **G6 Sensitivity/bias lint:** an LLM pass plus keyword rules flag culture-bound references, regional knowledge (US-only facts marked `region: US`), gendered stereotypes, and distressing content (SJT/emotion).
7. **G7 Human spot audit** (§4.4).

### 4.2 Per-type construction and verification

**Mental rotation (Shepard–Metzler polycubes).**
- The target is a random connected polycube of 8–10 cubes with at least 3 arm segments.
- Options are the target under random SO(3) rotations (the correct answer) plus distractors that are the *mirror image* or a *one-cube-moved* variant, each also randomly rotated.
- Correctness check: canonicalise each shape under the 24-element chiral octahedral rotation group and compare.

```python
import itertools, numpy as np

def rotation_group():
    mats = []
    for perm in itertools.permutations(range(3)):
        for signs in itertools.product([1, -1], repeat=3):
            m = np.zeros((3, 3), dtype=int)
            for i, (p, s) in enumerate(zip(perm, signs)):
                m[i, p] = s
            if round(np.linalg.det(m)) == 1:
                mats.append(m)
    assert len(mats) == 24
    return mats

G = rotation_group()

def canon(cubes):
    pts = np.array(cubes, dtype=int)
    best = None
    for R in G:
        q = pts @ R.T
        q = q - q.min(axis=0)
        key = tuple(sorted(map(tuple, q)))
        if best is None or key < best:
            best = key
    return best

def verify_rotation_item(target, options, key_index):
    ct = canon(target)
    matches = [i for i, o in enumerate(options) if canon(o) == ct]
    if matches != [key_index]:
        return False, f"rotation-equivalent options: {matches}"
    mirror = canon([(-x, y, z) for x, y, z in target])
    if mirror == ct:
        return False, "target is achiral; mirror distractor invalid"
    return True, "ok"
```

- Edge cases: achiral targets are rejected. Two distractors that are rotations of *each other* are also rejected, because a test-taker could eliminate them in pairs.
- Rendering: the Python spec is `{cubes, rotation quaternion, camera}`. The client renders it with Three.js at a fixed isometric camera, so no key appears in the payload beyond the geometry.
- Difficulty drivers: angular disparity (0–180°), in-depth vs picture-plane rotation, and mirror vs structural distractors [EST†, Shepard & Metzler 1971].

**Matrices.**
- Grammar-based generation in the style of Carpenter/RPM rules: attributes (shape, count, size, color, orientation, position) × rules (constant, progression, arithmetic, distribution-of-3, XOR).
- Verification: a rule-inference solver enumerates *all* rule assignments consistent with the 8 visible cells. Accept only if every consistent assignment predicts the same 9th cell and exactly one option equals it.
- Distractors are generated by violating one rule each (so each is "one attribute off"). This avoids the known flaw in which the answer is the modal option: check that the key is not uniquely identifiable by an option-only frequency heuristic, and reject if a classifier that sees only the options picks the key more than 1.5× chance.

**Series.**
- Candidate rule families: arithmetic, geometric, alternating/interleaved, second-difference polynomial, Fibonacci-type, letter-position arithmetic mod 26, and composite operations.
- Uniqueness check: fit every family up to complexity k ≤ 3 against the visible terms. If more than one *minimum-description-length* rule predicts different next terms, reject. Also run the OEIS-free local check "polynomial of degree ≤ n−2 always fits" and require the key rule to be strictly simpler.

**Math (quantitative, STEM numeric).**
- The generator emits a symbolic problem and a solution.
- SymPy verification: `simplify(expr - key) == 0`, or a numeric check at 1,000 random points to within 1e-9 relative.
- Numeric-entry tolerance is stored per item (e.g. ±0.5% or exact integer).
- Word problems additionally need the multi-solver check to confirm the *interpretation*.

**Logic games and formal logic (Z3).**

```python
from z3 import Solver, Int, Distinct, And, Or, sat

def count_models(constraints, vars_, cap=10_000):
    s = Solver(); s.add(constraints); n = 0; models = []
    while s.check() == sat and n < cap:
        m = s.model(); models.append({v: m[v].as_long() for v in vars_})
        s.add(Or([v != m[v] for v in vars_])); n += 1
    return n, models

def verify_mc_question(base, vars_, options, key_index, kind):
    ok = []
    for i, opt in enumerate(options):
        if kind == "could_be_true":
            s = Solver(); s.add(base + [opt]); ok.append(s.check() == sat)
        elif kind == "must_be_true":
            s = Solver(); s.add(base + [z3_not(opt)]); ok.append(s.check() != sat)
    return [i for i, v in enumerate(ok) if v] == [key_index]

def z3_not(e):
    from z3 import Not
    return Not(e)
```

- The game setup must have ≥2 models (otherwise it is trivial) and ≤ ~500 models (otherwise it is under-constrained).
- Each question must have exactly one option satisfying its semantics.
- For LR (argument) items, which cannot be fully formalised, use the multi-solver gate plus a required `reasoning_type` tag. For formal-logic sub-items (syllogisms, conditionals), check validity with Z3 or a propositional truth table.

**Reading comprehension: passage-dependence test.**
1. **No-passage test:** give each question and its options *without* the passage to ≥2 models, 5 samples each at temperature 0.7. If any model is correct at a rate above 1.5× chance (e.g. >30% on 5 options), reject the question. This is the standard known weakness of RC items (answerable from world knowledge).
2. **With-passage test:** unanimous agreement with the key.
3. **Span check:** the key must be supported by a quoted span (`evidence_span`), and each distractor must be contradicted by a span or unsupported.

**Knowledge facts.** G5 citations. Prefer:
- government and intergovernmental sources (NIST, NASA, USGS, CIA World Factbook, UN data);
- OpenStax textbooks (CC BY 4.0) [EST†];
- encyclopaedias of record.

Store `fact_volatility` (static / slow / fast). Fast facts, such as "current population", are banned from knowledge items and allowed only as Fermi items with a dated truth value.

**Fermi truth values.**
- Each item stores `true_value`, `unit`, `as_of_date`, ≥2 sources, and `true_value_uncertainty_log10`.
- Scoring uses the log error, so truths uncertain by more than ±0.15 dex (≈ ±40%) are allowed but down-weighted, and items with uncertainty above 0.3 dex are rejected.

### 4.3 Distractor quality and ambiguity checks after launch
- Nightly, per option: selection rate, and the point-biserial of choosing that option with the axis θ.
- A distractor chosen by <2% of users after n ≥ 300 is "dead": regenerate it.
- A distractor with positive point-biserial is a probable second correct answer: quarantine the item.

### 4.4 Human spot-audit plan [CALC]

If you audit n items drawn at random from a family or batch and find zero defects, the one-sided 95% upper bound on the defect rate p is

$$p_{95} = 1 - 0.05^{1/n} \approx \frac{3}{n}\quad(\text{rule of three}).$$

With k > 0 defects, use the Clopper–Pearson bound `scipy.stats.beta.ppf(0.95, k+1, n-k)`.

| Audit size n (0 defects found) | 95% upper bound on defect rate | Exact | Your time at 1 min/item |
|---|---|---|---|
| 10 | 30% | 25.9% | 10 min |
| 30 | 10% | 9.5% | 30 min |
| 60 | 5% | 4.9% | 1 h |
| 100 | 3% | 3.0% | 1.7 h |
| 300 | 1% | 1.0% | 5 h |
| 1,000 | 0.3% | 0.30% | 17 h |

Sanity check: for n = 100, 1 − 0.05^{0.01} = 1 − e^{−0.02996} = 0.0295 ✓.

**Policy.**
- Procedural families: 30 instances per family per generator version, which certifies < 10% even before the construction proofs. Construction proofs are the real guarantee; the audit catches rendering and wording bugs.
- Finite banks: 60 per batch of ≤ 500 items (certifies < 5%).
- Any defect found means the whole batch is re-audited after the fix.
- Post-launch the users act as a large implicit audit (§4.5).

### 4.5 Post-launch QA

| Signal | Rule (nightly job) | Action |
|---|---|---|
| Negative discrimination | Estimated a < 0 with n ≥ 150, or point-biserial < 0 with 95% CI excluding 0 | Auto-quarantine: probable key error |
| Item misfit | Standardised S-X² p < .001 after n ≥ 300, or infit/outfit MSQ outside [0.7, 1.4] | Flag for review |
| User reports | "Report a problem" button (item categories: wrong key / ambiguous / typo / offensive / broken; the separate non-item category "someone asked me for my notes" (R-17.10, AI.26) carries no item and never counts here) | ≥3 reports, or ≥1% of exposures with ≥2 reports, triggers auto-quarantine |
| Solve rate far off prior | \|b̂ − b_prior\| > 1.5 after n ≥ 100 | Re-review; inform the difficulty model (§6) |
| Distractor anomaly | §4.3 | Quarantine or regenerate |

Quarantined items stop being served immediately (`status='quarantined'`). Responses to them are excluded from scoring when sessions are next re-scored, and their weight is removed from affected users' posteriors on the next save-file load.

### 4.6 Review tool
`hb review` (Python, Typer + a local FastAPI page on `localhost:8765`):
- Shows the rendered item exactly as a user sees it, with solver outputs, evidence and flags.
- Keys: `a` approve, `r` reject (reason required), `e` edit (opens the JSON in `$EDITOR`), `s` skip.
- `hb review --take` runs a blind self-test on 20 items, recording your answers and times as `pilot` responses (weight 1, flagged as author).

---

## 5. Tier (c) implementation (the "how would you implement part C" answer)

**Principle:** tier (c) is only as trustworthy as its key. Every tier-(c) item therefore carries a *key-source vector* (`theory`, `expert`, `ai_ensemble`, `population`) with agreement statistics, and the blob draws tier-(c) axes hatched (§9).

### 5.1 Emotion understanding (text-first)
- **Recommended item type:** appraisal-theory-keyed vignettes. [EST] MacCann & Roberts (2008, *Emotion* 8:540–551) built:
  - the **STEU**: 42 items, choose which of 5 emotions a situation most likely produces, keyed by Roseman's (2001) appraisal theory, α ≈ .71;
  - the **STEM**: 44 items, choose the most effective management response, expert-keyed, α ≈ .68.
- [EST] A brief IRT-based STEM-B (18 items, α = .84) and a STEU-B exist.
- **Licensing:** the item and scoring protocols are posted publicly by the authors for research, but I found no explicit license permitting a public website. **Do not copy STEU/STEM items.** Write new items with the same *appraisal-keyed method*. That method can then be verified by rule: the appraisal profile (goal congruence, agency, certainty, control, …) maps to an emotion by a Roseman-style table. This moves such items close to tier (a), since the key is derived from a stated theory and checked by a rule engine plus solver unanimity.
- Optional: email Carolyn MacCann to ask whether the STEU-B may be used with attribution, and use it as an anchor set if so.

**Pictures and faces — licensing status:**
- [EST] NimStim downloads require agreeing to use stimuli "solely for approved institutional research or educational purposes", plus institutional and PI details. That is incompatible with a public hobby site.
- [EST†/flag] KDEF and RaFD also require registration and restrict use to non-commercial research. Publishing the images on a public site is not generally allowed without permission.
- [EST†] RMET images are copyrighted by the Autism Research Centre.
- **Conclusion: none of the standard face databases can be served publicly without explicit written permission.**

**AI-generated expression images (v2.5, optional):**
- Generate synthetic faces (no real identity) with a local diffusion model on the Mac.
- Validate each image in three steps:
  1. automated facial action unit detection (e.g. py-feat/OpenFace) must match the prototypical AU pattern for the intended emotion (e.g. AU6+AU12 for happiness);
  2. ≥2 vision-language models must classify it unanimously;
  3. post-launch, the agreement rate among users must be ≥ 70% for basic emotions (the typical range for validated databases is 70–90% [EST†]); otherwise quarantine.
- Include intensity morphs to create difficulty. Label the axis "recognising *posed* expressions", because posed prototypes are known to overstate real-world recognisability [EST†, Barrett et al. 2019].
- **Voice/prosody (optional, v3):** the licensing problem is the same; synthetic TTS with emotional style is possible but validation is weaker. Defer.

### 5.2 Consensus scoring and bootstrapping from zero users
- **Option weights.** For an item with options j, each option gets a weight $w_j$: the MSCEIT-style proportion of a reference group choosing j [EST†]. A user's item score is $w_{choice}$.
- **Key sources, in order of availability:**
  1. **Theory key** (appraisal rules), available at authoring time.
  2. **AI-ensemble key:** ≥3 models × 5 samples produce a probability distribution over options, $w^{AI}$.
  3. **Author/expert key:** you, or recruited volunteers with relevant training, rate options 1–5.
  4. **Population consensus** $w^{pop}$, estimated from users in the top half of the Verbal/Gc posterior only (limits noise).
- **Blend:** $w = \lambda_n w^{pop} + (1-\lambda_n)\,w^{prior}$, with $\lambda_n = n/(n+200)$ [SPEC: shrinkage constant 200].
- **Circularity guard:** if $w^{pop}$ and $w^{prior}$ disagree on the top option at n ≥ 300, freeze the item and review it. Never let the population alone redefine a key the theory contradicts.
- [EST†] Expert and consensus keys on the MSCEIT correlate very highly (≈ .9), which justifies the blend but also shows that consensus scoring rewards *conventionality*. The UI must say so: "measures agreement with typical and expert judgments".

### 5.3 Situational judgment tests
- Format: scenario + 4 responses; the user either picks the most and least effective, or rates each response 1–4.
- Key: expert/AI-ensemble effectiveness ratings, then blended with consensus (§5.2).
- Scoring: the distance between the user's ratings and the key profile, or a nominal-response IRT once n ≥ 500.
- Validity: SJTs typically correlate .2–.4 with job performance and substantially with Gc and personality [EST†]; the SJT axis therefore overlaps Verbal. Report that honestly in the tooltip.

### 5.4 Creativity without human raters
- **Remote Associates Test (tier a):** three cue words with a single solution word (e.g. *cottage / swiss / cake → cheese*) [EST†, Mednick 1962; Bowden & Jung-Beeman 2003 norms].
  - Author new triads, verified by corpus: the solution must form common compounds with all three cues (checked in a word-frequency list or n-gram data).
  - Solver unanimity must hold, and no alternative word may form compounds with all three above a frequency threshold.
  - Accepted answers include spelling variants.
- **Alternate Uses Task (tier c-automated):** 2 objects × 90 s each.
  - Score: mean of the top-3 responses' semantic distance from the prompt, computed in-browser with a small sentence-embedding model (e.g. all-MiniLM-L6-v2 via Transformers.js, ~25 MB, downloaded once, zero API cost). Flexibility = number of embedding clusters.
  - [EST] Organisciak et al. (2023) showed fine-tuned LLM scoring (Ocsai) reaches up to r = .81 with human raters, vs r = .12–.26 for earlier semantic-distance systems in their benchmark.
  - Implication: the in-browser distance score is noisy. Label this axis "experimental".
  - Optionally call the free Ocsai API at openscoring.du.edu *with user consent* (text leaves the site), or use a local LLM judge in the nightly batch.
  - Guard against gaming: responses longer than 12 words and lists of random nouns get penalised by a "use-plausibility" check (embedding similarity to a "a use for X" template must exceed a floor).

### 5.5 Validity limits (summary)

| Tier-(c) axis | Best achievable claim | Key threat |
|---|---|---|
| Emotion understanding (text) | Appraisal-reasoning skill; moderate correlation with Gc | Verbal ability confound; cultural display rules |
| Faces (posed, synthetic) | Recognition of prototypical posed expressions | Ecological validity; synthetic artefacts |
| SJT | Agreement with expert/consensus effectiveness | Conventionality ≠ skill; circularity |
| RAT | Convergent associative thinking (tier a) | Vocabulary confound |
| AUT | Rough divergent-thinking index | Automated scoring noise; fluency/elaboration gaming |

### 5.6 The autism question — direct answer
**Your instinct conflicts with the evidence.** Emotion-recognition tests are *not* a reasonable way to "tease out" autistic people, and HumanBench should not attempt it.

- [EST] **Group differences are real but overlapping.** A meta-analysis of 18 studies (Peñuelas-Calvo et al. 2019) found autistic adults score lower on the RMET than IQ-matched controls, d = 1.15.
- [CALC] **Screening maths.** Overlap of two normals at d = 1.15: $OVL = 2\Phi(-d/2) = 2\Phi(-0.575) \approx 0.57$, so 57% overlap. Now set the cutoff at the control 10th percentile (z = −1.28):
  - sensitivity = $\Phi(-1.28 + 1.15) = \Phi(-0.13) \approx 0.45$;
  - specificity = 0.90;
  - adult prevalence ≈ 2.21% [EST, Dietz et al. 2020 (CDC): 95% SI 1.95–2.45%, 2017 data modelled from child parent-report data rather than adult surveillance].

  $$PPV = \frac{0.45 \times 0.022}{0.45\times0.022 + 0.10\times0.978} = \frac{0.0099}{0.1077} \approx 9\%.$$

  About 91% of people "flagged" would not be autistic. That calculation uses a test *better* than anything a 3-minute web module can deliver.
- [EST] **Alexithymia confound.** Oakley et al. (2016) found alexithymia, *not* autism diagnosis, predicted RMET performance; ASD and control groups matched on alexithymia did not differ on the RMET.
- [EST] **Psychometric weakness.** Higgins et al. (2023) found poor fit for every factor model in a representative US sample (N = 1,181) and that nearly a quarter of RMET items failed the test's own original inclusion criteria.
- [EST] **What the RMET measures.** A scoping review notes the ToM-deficit account of autism is contested. Kittel et al. (2021, as reported) found the RMET relates more to emotion perception than to other ToM measures.
- [EST†] **Double-empathy problem** (Milton 2012; Crompton et al. 2020): mutual misunderstanding between autistic and non-autistic people is bidirectional. Autistic-autistic information transfer was as effective as non-autistic-non-autistic transfer. A "deficit" score measured against a neurotypical key partly measures *mismatch*.

**Guardrails (requirements):**
- R-5.6.1: No autism, ADHD, alexithymia or other clinical terms appear in results, share cards or marketing copy.
- R-5.6.2: The emotion axis is called "Emotion Reading (text scenarios)", with the tooltip: "Measures agreement with appraisal-theory and consensus keys. Not a diagnostic or clinical measure; scores are strongly affected by vocabulary, culture and test familiarity."
- R-5.6.3: No questions about diagnoses, symptoms or health are asked or stored anywhere (this also keeps the app clear of GDPR Art. 9 special-category data).
- R-5.6.4: Low emotion scores are never highlighted as "weaknesses" on the share card (users may hide any axis).
- R-5.6.5: The results page links to a neutral resource: "If you're curious about autism or social-communication differences, a qualified clinician is the right route; online tests can't tell you."
- **Better alternative:** frame the social axis as one of many skills in the blob, which is honest and still interesting.

---

## 6. Difficulty seeding and online calibration

### 6.i What public material can be used legally

| Source | Status | Use in HumanBench |
|---|---|---|
| SAT/PSAT (College Board), ACT, LSAT (LSAC), GRE (ETS), MCAT (AAMC) released items | Copyrighted; practice tests are licensed for personal prep only [EST†] | **Never serve.** Optional *private* anchor: you may read released items and their published percent-correct to set difficulty targets for AI-written *new* items that test the same skill. Copyright protects expression, not ideas or skills, but do not paraphrase closely. No items in the repo. |
| NAEP released items (NCES Questions Tool) with national percent-correct | U.S. government works are generally public domain (17 U.S.C. §105) [EST†]; **flag:** some reading passages and images are third-party copyrighted and marked | Best free difficulty anchors for middle/high-school math, science, reading, civics, history and geography; serve items only after a per-item rights check |
| ICAR | Academic use only per icar-project.com ("ICAR is intended for academic use exclusively") [EST] | Published p-values as anchors only (§2.2); do not serve items |
| PISA (OECD) / TIMSS (IEA) released items | Copyrighted; released for educational use with conditions [EST†/flag] | Anchor only, unless written permission is obtained |
| NY Regents exams (NYSED) | State-published; reuse terms unclear [flag] | Anchor only |
| GPQA | CC BY 4.0 with a request not to reveal examples online (canary) [EST†/flag] | Do not serve (item-security request); optional expert-tier anchor, offline only |
| Humanity's Last Exam | Openly released for AI evaluation [EST†/flag—verify license] | Not suitable for humans (designed to be at or above expert frontier); skip |
| OpenStax | CC BY 4.0 [EST†] | Source text for RC/knowledge items, with attribution in `source` |
| Project Gutenberg | Public-domain texts in the U.S.; strip the Gutenberg header/trademark if redistributing [EST†] | RC passages (older prose raises difficulty; tag the era) |

### 6.ii Predicting difficulty of AI-written items
- [EST] **BEA 2024 shared task** (NBME): 667 retired USMLE MCQs, 17 teams, 12 system papers. Simpler models (Lasso, random forests on linguistic and embedding features) often beat complex ones. The NBME findings paper (Yaneva et al.) reports that "even the best solution outperformed the baseline by only a small margin" (RMSE 0.299 for the winner, EduTec, vs 0.311 for a DummyRegressor); 48 teams enrolled and 17 submitted. **Expect weak prediction.**
- [SPEC] For HumanBench's much more heterogeneous items (middle school → olympiad), predictions will be better *across* strata than *within* them. Prior assumption: r ≈ .5–.7 between predicted and observed b across the whole range, r ≈ .2–.4 within a stratum.
- **Method:**
  1. Each item carries an authored `difficulty_stratum` (1–6: MS, HS, college-entry, college, graduate/professional, olympiad/expert).
  2. Solver-based features: fraction of small local models (e.g. 1B–8B) that solve it, and token count of the solution.
  3. Text features: length, readability, number of reasoning steps.
  4. Procedural parameters: rotation angle, number of rules, number of constraints/models.
  5. Calibrate this regression on anchor items (NAEP/ICAR p-values converted to b via $b \approx -\text{logit}(p)/1.0$ with an assumed mean anchor-population θ, a [SPEC] link).
- **Prior on b:** $N(\hat b, \sigma_b^2)$ with $\sigma_b = 1.0$ initially, shrinking as the predictor's validity is measured (§16 check F1).

### 6.iii Online calibration

**Algorithms.**
- [EST] **Elo-style systems** (Klinkenberg et al. 2011, Math Garden): abilities and item difficulties update after every response, allowing on-the-fly calibration. Items were sampled at a target success probability of .75. Over ten months, 3,648 children answered 3.5 million problems. A "high speed, high stakes" rule combined accuracy with RT.
- [EST†] **CAT online calibration:**
  - Stocking (1988) Method A treats θ as known (biased); Method B corrects via anchors.
  - OEM (one EM cycle) and MEM (multiple EM cycles) (Wainer & Mislevy; Ban et al. 2001). MEM is generally the most accurate of the classic methods.
  - Fully Bayesian updating with θ uncertainty is the modern option.

**HumanBench calibration job (nightly, Python):**
1. Pull responses from `status='calibration_eligible'` persons (person-fit OK, no anomaly flags, not the author).
2. **Phase A (n < 200 per item):** Bayesian 1-parameter update of b with a fixed at the family mean. Use a grid posterior over b, integrating over each respondent's θ posterior (the MEM-like step).
3. **Phase B (n ≥ 200):** 2PL marginal-ML per axis with anchor items fixed (fixed-parameter calibration), via `girth` or a custom EM. a gets a lognormal(0, 0.3) prior around the family mean.
4. **Linking:** 10–20 anchor items per axis keep fixed parameters. After every refit, check anchor drift: if the mean |Δb| over anchors exceeds 0.1, apply a Stocking–Lord transformation.
5. Write new `item_parameters` rows (versioned), re-score recent sessions, and publish `bank_version`.

**SE(b) vs n [CALC].** For a Rasch-type item with respondents spread around b, the Fisher information per response is P(1−P) ≈ 0.20 on average, so $SE(b) \approx 1/\sqrt{0.20\,n}$. Uncertainty in θ inflates this by about 10–20% [SPEC].

| n responses | SE(b), θ known | ×1.15 (θ uncertain) | Usable for |
|---|---|---|---|
| 25 | 0.45 | 0.51 | Coarse stratum check |
| 50 | 0.32 | 0.36 | Quarantine decisions |
| 100 | 0.22 | 0.26 | Serving with a wide prior |
| 200 | 0.16 | 0.18 | Fix b; begin estimating a |
| 500 | 0.10 | 0.12 | Stable 2PL (a SE ≈ 0.1–0.15) |
| 1,000 | 0.07 | 0.08 | Anchor candidate |

**Seeding new items (exploration).**
- Each session reserves ≤ 10% of item slots (~12 items) for "pretest" items: served, but given near-zero weight in scoring until n ≥ 100. This is the same practice as the LSAT's unscored section.
- Pretest items are chosen by Thompson sampling on expected information gain about b.

**Exposure control.**
- Randomesque selection: pick at random from the top 5 by information/second.
- Hard cap: an item's exposure rate may not exceed 0.25 of sessions (Sympson–Hetter-lite).
- Family exclusion: families the user has seen are excluded (§7.7).

---

## 7. Scoring and adaptive engine

### 7.1 Measurement models per data type

| Data | Model | Person parameter |
|---|---|---|
| Keyed MC/entry | 2PL: $P = \sigma(a(\theta - b))$; 3PL with $c = 1/k$ fixed only for ≤ 4-option items | θ_axis |
| Testlets (RC passage, logic game) | 2PL + passage random effect $\gamma \sim N(0, 0.3^2)$ (i.e. discount the information of dependent items by about 20%) [SPEC] | θ_axis |
| Graded (span length, partial credit) | Samejima GRM | θ_WM |
| RT (simple/choice) | $\log T_{ij} \sim N(\beta_j - \tau_i, \sigma_j^2)$ (van der Linden lognormal); robust: trim < 150 ms and > 1,500 ms (simple) | τ = speed |
| Reading speed | $\log(\text{wpm}_i) \sim N(\mu_i, 0.15^2)$ per passage, valid only if comprehension gate ≥ 2/3 | μ |
| Processing speed (coding) | Correct items per 90 s ~ Poisson/log-normal rate | log rate |
| Fermi | $e_{ij} = \log_{10}(\text{est}/\text{true})$; $-\lvert e_{ij}\rvert = \theta_F - \delta_j + \epsilon$, Gaussian | θ_F |
| Calibration | Brier $= \frac{1}{N}\sum (c_i - y_i)^2$; also calibration-in-the-large (mean confidence − accuracy) and 80%-interval hit rate on Fermi items | Score = −Brier, standardised within user population |
| AUT | Continuous, Gaussian on standardised semantic distance | θ_AUT |

**Joint speed–accuracy.** [EST†] van der Linden's (2007) hierarchical framework models (θ, τ) jointly, with a person-level correlation. **Decision:** RTs on power items (reasoning, knowledge) are *not* used to score ability, because rewarding speed on power items changes the construct and punishes careful people. They *are* used for:
1. item time-cost estimates (for selection);
2. anomaly detection;
3. a separate "Pace" tooltip.

RTs are scored only on the Speed cluster.

### 7.2 Correlated-factor MIRT vs multidimensional Elo

| | Correlated-factor Bayesian IRT (simple structure) | Multidimensional Elo |
|---|---|---|
| Uncertainty | Full posterior covariance → honest bands | None by default (needs ad hoc extensions) |
| Sparse data | Prior Σ borrows strength across axes | Each axis is on its own |
| Item calibration | Nightly batch (MEM/MML) | Online, real-time |
| Stability | Deterministic re-scoring from raw data | Path-dependent (order of responses matters) |
| Complexity | Moderate (K ≤ 17 dims, Laplace approximation) | Very low |

**Decision:** hybrid.
- Elo-like updates of *item* b for pretest items in Phase A.
- Bayesian correlated-factor scoring for *persons*.

With simple structure, the log-posterior is

$$\log p(\boldsymbol\theta \mid \mathbf y) = \sum_{k}\sum_{j\in k} \log p(y_j \mid \theta_k) - \tfrac12 (\boldsymbol\theta-\boldsymbol\mu)^\top \Sigma^{-1}(\boldsymbol\theta-\boldsymbol\mu) + C,$$

maximised by Newton's method, with the Hessian giving the covariance (Laplace approximation). K ≤ 17, so this takes milliseconds.

```python
import numpy as np

def map_theta(items_by_axis, mu, Sigma, iters=30):
    K = len(mu); th = mu.copy(); Sinv = np.linalg.inv(Sigma)
    for _ in range(iters):
        g = -Sinv @ (th - mu); H = -Sinv.copy()
        for k, obs in items_by_axis.items():
            for a, b, y in obs:
                p = 1 / (1 + np.exp(-a * (th[k] - b)))
                g[k] += a * (y - p); H[k, k] -= a * a * p * (1 - p)
        step = np.linalg.solve(H, g); th = th - step
        if np.max(np.abs(step)) < 1e-6: break
    cov = np.linalg.inv(-H)
    return th, cov
```

Edge cases:
- An all-correct or all-wrong axis is handled by the prior, so estimates stay finite.
- Continuous-model axes add Gaussian terms $-\frac{(x-\theta_k+\delta)^2}{2\sigma^2}$ to g and H.
- Σ must be positive definite, so project it with nearest-PD (eigenvalue floor 0.05) after each re-estimate.

### 7.3 A common blob scale
- **Internal scale:** θ in "HumanBench-population SD units", with each axis's calibration population mean = 0 and SD = 1 (set by the anchor linking).
- **Display:** radius linear in θ, clamped to [−3, +3] (see §9).
- **Tooltips:** user-population percentile $\Phi(\theta)$ (labelled "among HumanBench takers"), plus **external norms** where they exist:
  - [EST] reading speed vs Brysbaert (2019): 190 studies, silent reading 238 wpm for non-fiction (95% CI 230–246; SD across studies 51) and 260 wpm for fiction;
  - [EST†] digit span (typical adult forward ≈ 6–7, backward ≈ 4–5);
  - [EST†] simple RT (lab ≈ 200–250 ms; web adds tens of ms of device lag, so show web-relative norms only).
- Because the user population is self-selected, the tooltip says "vs other HumanBench takers (a self-selected, likely above-average group)".

### 7.4 Item selection: information per second [CALC]
Criterion for candidate item j on axis k:

$$\text{score}_j = w_k \cdot \frac{a_j^2 P_j(1-P_j)\,\operatorname{Var}(\theta_k)}{\mathbb E[T_j]}\,,$$

- where $\mathbb E[T_j]$ is the item's median time from the lognormal RT model (the prior is length-based: 25 s + 4 s per 50 words);
- where multiplying by the current posterior variance targets the axes that are most uncertain (roughly the expected reduction in posterior variance per second);
- with $w_k$ the axis weight (1.0 by default; 0 for axes the user skipped).

Then apply randomesque top-5, exposure caps and family exclusion.

**Session composition (60 min), requirement R-7.4.**
1. Onboarding + honour code + device check: 3 min.
2. Blocks of 6–10 min alternating clusters, in this order: Speed warm-up (RT, 2 min) → Reasoning → Knowledge → Spatial → Verbal/RC → Memory → Quant → Knowledge → Logic → Fermi (calibration embedded throughout). This order breaks up fatigue and varies the modality.
3. Within a block the engine picks axes by the criterion, subject to a floor of ≥ 3 scored items per axis in session 1.
4. Stopping:
   - hard stop at 57 min, then reveal;
   - a "finish early" button at any time (partial blob);
   - per-axis early stop once SD(θ_k) < 0.3.

### 7.5 Items and time needed [CALC]
Posterior precision for an axis: $1/SE^2 = 1/\sigma_{prior}^2 + n\bar I$, with prior variance 1 (Σ borrowing ignored, which makes this conservative).

| Target | Reliability $1-SE^2$ | $n\bar I$ needed | n items if $\bar I$=0.40 (well-targeted, a≈1.3) | n if $\bar I$=0.25 (typical) |
|---|---|---|---|---|
| SE 0.50 | .75 | 3.0 | 8 | 12 |
| SE 0.40 | .84 | 5.25 | 13 | 21 |
| SE 0.30 | .91 | 10.1 | 25 | 40 |
| SE 0.20 | .96 | 24 | 60 | 96 |

Check against your earlier estimate:
- **Rough precision:** 12 power axes × 8–12 items = 96–144 items. At 45 s each that is 72–108 min, consistent with "70–180 items ≈ 1–2 h".
- **Tight precision:** 12 × 25–40 = 300–480 items, 3.75–6 h, consistent with "3–7 h".
- **Speed and memory axes are cheap:** RT reaches reliability ≥ .85 in ~2 min [EST†]. That is why 60 minutes can cover 16 axes at the rough level only if power items average ≈ 35–40 s.

[SPEC] The correlated prior (r ≈ .5) adds roughly the equivalent of 2–4 items of information per axis once other axes are measured.

### 7.6 Projected SE per axis vs sessions [CALC]
Assumes about 6 scored items per power axis per session at $\bar I$ = 0.35, giving 2.1 precision units per session. The Σ gain is ignored and the retest-drift variance is ignored.

| Sessions | 1 | 2 | 3 | 4 | 5 | 7 | 10 |
|---|---|---|---|---|---|---|---|
| Precision (1 + 2.1s) | 3.1 | 5.2 | 7.3 | 9.4 | 11.5 | 15.7 | 22 |
| SE (σ) | 0.57 | 0.44 | 0.37 | 0.33 | 0.29 | 0.25 | 0.21 |
| Reliability | .68 | .81 | .86 | .89 | .91 | .94 | .95 |

Sensitivity: if items are poorly targeted ($\bar I$ = 0.2, giving 1.2 per session), SE after 5 sessions ≈ 0.38. Retest drift (§7.8) sets a floor of about 0.15 unless it is modelled.

### 7.7 Bank size needed [CALC]
Family exclusion means a user must never see two instances of the same *family* (for finite banks, each family is 1–3 isomorphs). Unique families a user needs per axis = items/session × sessions = 6S. Because the engine targets difficulty near θ, a user draws mostly from about 2 of the 6 difficulty strata. Users spread across all strata, so each stratum needs ≈ 6S × (share of the user's draws from that stratum ≈ 0.5), times a safety factor of 2 for exposure control:

$$N_{\text{families/stratum}} \approx 6S \times 0.5 \times 2 = 6S, \qquad N_{\text{axis}} \approx 6 \text{ strata} \times 6S = 36S.$$

| Sessions per user S | 1 | 2 | 3 | 5 | 10 |
|---|---|---|---|---|---|
| Families per stratum | 6 | 12 | 18 | 30 | 60 |
| Families per axis (6 strata) | 36 | 72 | 108 | 180 | 360 |
| Items, 9 finite-bank axes (×1.5 for quarantine loss) | ≈490 | ≈970 | ≈1,460 | ≈2,430 | ≈4,860 |

**Procedurally generated (effectively unlimited):** Matrix & Series, Spatial, Quant (template families with random parameters), Logic Games (random constraint sets, Z3-filtered), Working Memory, RT, Processing speed, Reading speed (passages are finite, but questions are simple gates), and the RAT (limited by the corpus to maybe ~1–2k triads).

**Finite (the cost driver):** Logical Reasoning, Reading Comprehension, Vocabulary, 3 Knowledge axes, Fermi, Emotion/SJT.

**Target for v1 launch:** S = 3, so ≈1,500 finite items.

### 7.8 Retest effects and aggregating sessions
- [EST] Scharfen, Peters & Holling (2018, *Intelligence* 67:44–66): gains are about 1/3 SD from test 1 to test 2, rise to about 0.5 SD over multiple retests, and plateau after the third test. Effects vary with the test, whether the form is identical or alternate, the test-retest interval and age. Other meta-analyses report 0.23–0.42 SD for the first retest [EST].
- **Model:** $\theta_{k,s} = \theta_k + \rho_k(s)$ with $\rho_k(s) = \rho_k^{\max}(1 - e^{-(s-1)/1.2})$. Priors: $\rho^{\max}$ = 0.45 for reasoning/spatial/speed, 0.25 for knowledge (alternate forms). Estimate $\rho$ from the population's session-over-session change once N ≥ 300 returning users.
- **Aggregation:** always **re-score from raw responses** with current item parameters and ρ. The stored posterior in the save file is a cache used only if the raw data fail to validate.
- Report the retest-*adjusted* θ, and show "practice-adjusted" in the UI.

---

## 8. Save file specification

**Format:** `humanbench-<shortid>-<date>.hbsave.json` (UTF-8 JSON; optional gzip + base64 for the "copy code" route).

```json
{
  "$schema": "https://sinkomr.github.io/humanbench/schema/save-v1.json",
  "schema_version": "1.0.0",
  "bank_version": "2026.10.03-b17",
  "anon_id": "hb_7Q3m9Kx2Vw5rT8pL",
  "created_utc": "2026-10-03T18:22:11Z",
  "sessions": [
    {
      "session_id": "s_01J9ZK3Q",
      "started_utc": "2026-10-03T17:20:02Z",
      "duration_s": 3411,
      "device": {"class": "desktop", "input": "mouse", "os_family": "macOS", "browser_family": "Safari", "refresh_hz_est": 120, "timer_res_ms": 0.1, "viewport": [1512, 861]},
      "flags": {"visibility_hidden_s": 14, "paste_events": 0, "fast_guess_n": 1},
      "responses": [
        ["i:mat:f0182:v3", 1, "C", 1, 41250, 80],
        ["i:rt:simple", 0, "trials", null, 18211, null, [243, 251, 238]]
      ]
    }
  ],
  "seen_items": ["i:mat:f0182:v3"],
  "seen_families": ["f:mat:0182"],
  "posterior_cache": {"param_version": "p2026.10.03", "axes": ["MAT", "LR", "..."], "mean": [0.41, -0.12], "cov_lower": [0.31, 0.08, 0.29]},
  "sig": {"alg": "HMAC-SHA256", "kid": "k2026a", "mac": "base64..."}
}
```

- **Response tuple:** `[item_id, pretest(0/1), response, correct(0/1/null), rt_ms, confidence_pct, extra?]`.
- **Correctness for finite-bank items:** filled from the server's scoring RPC. It is stored so that offline re-scoring works, and it is covered by the HMAC.

**Size [CALC].**
- ~150 responses × ~60 bytes ≈ 9 KB per session.
- RT trial arrays (70 trials × 4 bytes) ≈ 0.4 KB.
- Seen lists ~150 × 20 bytes = 3 KB.
- So ≈ 12–15 KB per session, ≈ 150 KB after 10 sessions (≈ 30 KB gzipped). Trivial.

**Merging (R-8.1):**
1. Union sessions by `session_id` (ignore duplicates).
2. Union `seen_*`.
3. Re-score everything from `responses` with current parameters.
4. Discard `posterior_cache` if its `param_version` ≠ current.
5. If `schema_version` is older, run the migrations `migrate_v1_to_v2()` etc. (pure functions, unit-tested).

**Tamper evidence and the trust tradeoff.**
- At session end the server computes `mac = HMAC(K_server, canonical_json(file without sig))` (RFC 8785 canonical JSON). The key lives in the Supabase Vault and is rotated via `kid`.
- On upload the server verifies the MAC:
  - Valid → the file counts toward calibration data.
  - Invalid or unsigned (e.g. hand-edited, or from the offline MVP) → still accepted for *personal* display, marked "unverified", and never used for calibration.
- Tradeoff: HMAC only proves the file was issued by the server. It cannot stop someone replaying their own old file, which is harmless. Your main risk is corrupted calibration data, which the flag resolves.

**Privacy.**
- `anon_id` is 96 random bits (base62).
- No name, email, IP, precise user agent, or location. Device info is coarse class only.
- The file contains no free text except AUT responses; the user is warned: "don't type personal info".

**Download and upload compatibility.**
- Download: `new Blob([json], {type: "application/json"})` + `URL.createObjectURL` + `<a download>`. [EST†] iOS Safari (13+) saves to Files/Downloads.
- Fallbacks:
  1. Web Share API with `files` (`navigator.canShare({files})`), which is best on iOS;
  2. a "Copy save code" button (gzip + base64url, ~40 KB) that can be pasted into Notes.
- Upload: `<input type="file" accept=".json,.hbsave,application/json,text/plain">`. iOS may rename the file with a `.txt` suffix, so parse by content, not extension. Also allow "paste code".
- Also autosave to `localStorage` after every item (crash recovery), keyed by session_id.

**Optional server mirror:**
- On the first session the user can opt in: "Keep a backup on the server".
- The server stores the file keyed by `anon_id` and returns a 12-word recovery phrase. Only SHA-256(phrase) is stored; retrieval requires the phrase.
- No accounts and no email.

---

## 9. Visualisation spec: the "jagged blob"

1. **Layout:** K spokes at angles $\phi_k = 2\pi k/K$. Radius $r_k = R\,(\theta_k + 3)/6$, clamped to [0.04R, R].
   - Rings are drawn at θ = −2, −1, 0, +1, +2 and labelled with user-population percentiles (2%, 16%, 50%, 84%, 98%).
   - **The centre is θ = −3, not zero ability**, and the caption says so.
   - The dashed ring θ = 0 is labelled "typical HumanBench taker".
2. **Curve:** closed Catmull-Rom spline (`d3.curveCatmullRomClosed.alpha(0.5)`) through the $(r_k, \phi_k)$ points. It must not overshoot beyond ±0.1 of a ring between spokes; if it does, fall back to `curveCardinalClosed.tension(0.6)`.
3. **Uncertainty:**
   - 20 nested closed curves at radii $\theta_k \pm z\,SD_k$ for z ∈ [−1.64, 1.64], filled with opacity ∝ normal density, giving a fuzzy edge.
   - Plus a crisp stroke at the posterior mean.
   - Accessible fallback: a light band (±1 SD) and error whiskers on the spokes.
4. **Axis ordering (seriation):** order spokes to maximise the sum of adjacent correlations in Σ. This is a TSP on a cycle with distance $1 - r_{ij}$; K ≤ 17, so solve by exact dynamic programming or 2-opt. Clusters stay contiguous.
5. **Radar pitfalls and mitigations:**
   - Area grows with $r^2$ and depends on ordering, and people read area as "total ability" [EST†].
     - (a) No area or "total" number is ever shown.
     - (b) The ordering is fixed by Σ, so all users share one ordering, which makes comparison fair.
     - (c) A toggle switches to a "bar view" (lollipop with CIs), which is the default for screen readers.
     - (d) A linear radius, not area-proportional.
   - Noise looks jagged: spikes whose 90% interval crosses the θ = 0 ring are drawn in muted tone, so only *credible* jaggedness stands out.
6. **Drill-down:** clicking a cluster wedge animates into a sub-blob of its facets (e.g. Knowledge → 12 subjects, from the same posterior using facet-level items). Facets with < 5 items show "insufficient data".
7. **Tier marks:**
   - Tier (c) axes: hatched fill and a ◇ glyph on the label.
   - Tier (b): ○ glyph.
   - Unmeasured or skipped axes: a grey stub at the centre with "not measured" and a dashed spoke. They are never interpolated through; the curve dips to the centre with a gap marker.
8. **Palette:** Okabe–Ito (color-blind safe): blob #0072B2, band #56B4E9, tier-c hatch #E69F00, muted #999999. Contrast ≥ 4.5:1 for text.
9. **Export:**
   - SVG via serialisation of the D3 node.
   - PNG via canvas at 2× (1200×630 social card: blob + 3 top strengths + "n sessions, SE ±").
   - Share card text never includes emotion-axis lows (R-5.6.4).
   - Everything happens client-side; no image server.
10. **Library:** D3 v7 (d3-shape, d3-scale). Three.js is used only for the rotation stimuli.

---

## 10. UX and engagement

- **Pacing:**
  - 6–10 minute blocks with a 1-screen interstitial ("Up next: Spatial. ~6 min").
  - A progress ring shows *time*, not items, because adaptive item counts vary.
  - A per-cluster checklist is shown.
  - A break is suggested at 30 min.
- **Per-item feedback:**
  - No correctness feedback on finite-bank items (key leakage, and it would inflate practice effects).
  - Speed/memory games show immediate stats (they are designed to be game-like and their keys are trivial).
  - Procedural items show feedback only in an optional "practice mode" that doesn't count.
  - At the end, reveal performance per axis, plus 3 *procedural* items with worked solutions.
- **Reveal flow:** animated blob build-up, axis by axis → "your most distinctive peaks" (credible only) → drill-down → download the save file (prominent, and required before leaving; a `beforeunload` warning is shown) → share card.
- **Retest motivation:**
  - Show predicted shrinkage: "Session 2 will tighten your blob by ~25%" (from §7.6).
  - Show which axes are fuzziest.
  - Offer "focus sessions" of 20 minutes that target chosen axes.
  - Recommend a spacing of ≥ 7 days (reduces practice effects and matches the literature on intervals).

---

## 11. Architecture and hosting

### 11.1 Options compared (free-tier limits verified September 2026 unless marked)

| Option | Free limits (key) | Fit for HumanBench |
|---|---|---|
| **GitHub Pages + Supabase** | Pages: 1 GB site, 100 GB/mo soft bandwidth [EST]. Supabase Free: 500 MB DB, 5 GB egress, 1 GB file storage, 50k MAU, unlimited API requests, 2 active projects, **paused after 1 week of inactivity**, no backups [EST, supabase.com/pricing: "Free projects are paused after 1 week of inactivity. Limit of 2 active projects."]; Edge Functions 500k invocations/mo [third-party only, e.g. itpathsolutions.com, designrevision.com] | **Recommended.** Postgres + RLS + PL/pgSQL RPC keeps keys and scoring server-side with no request cap; Python connects natively; the pause is solved by a daily cron |
| Cloudflare Pages + Workers + D1 | Workers Free: 100,000 requests/day, 10 ms CPU per invocation. Pages: 500 builds/mo. D1: 5M rows read/day, 100k rows written/day, 5 GB storage. **Since 1 Sep 2026, D1 queries on the Free plan fail once daily limits are exceeded** until 00:00 UTC [EST] | Strong runner-up: no inactivity pause, 5 GB. But 100k requests/day ≈ 660 sessions/day at 150 requests/session, the 10 ms CPU limit constrains server-side selection, the backend is JS-only, and hard daily failures are possible |
| Firebase (Spark) | Firestore: 1 GiB stored, 50K reads/day, 20K writes/day; **Cloud Functions require the Blaze (pay-as-you-go) plan** [EST] | Poor: without functions, keys cannot be scored server-side securely on free |
| Netlify / Vercel functions + Neon / Turso | Vercel Hobby: 1M function invocations/mo, **"non-commercial, personal use only"** [EST]. Netlify Free: 300 credits/mo, then projects pause (e.g. 20 credits/GB bandwidth, 10 credits/GB-hour compute) [EST]. Neon Free: 0.5 GB/project, 100 CU-hours/mo, scale-to-zero after 5 min [EST]. Turso Free: 5 GB, 500M rows read/mo, 10M rows written/mo [EST] | Workable but more moving parts (two vendors, cold starts); Turso's write allowance is generous |
| Python FastAPI on Render / Fly.io / Railway | Render Free: spins down after 15 min idle (~1 min to spin up), 750 instance-hours/mo, free Postgres **expires after 30 days** [EST]. Fly.io: new accounts get only a trial (2 h of machine runtime or 7 days) [EST]. Railway: $5 one-time trial, then a $1/mo free credit plan [EST] | Python everywhere is attractive, but cold starts break the test flow and free databases expire. Use as the paid escalation path, not v1 |
| Your own website/subdomain | DNS CNAME `test.yourdomain.com → sinkomr.github.io` + Pages custom domain (free HTTPS) [EST†] | Yes: combine with option 1 |

### 11.2 Recommended architecture

```
[Browser: Svelte+TS app on GitHub Pages]
   | HTTPS (supabase-js, anon key; RLS denies all table access)
   v
[Supabase Postgres]
   - RPC start_session(device) -> session_token
   - RPC next_item(session_token) -> item payload (no key)
   - RPC submit(session_token, item_id, response, rt_ms, conf) -> {ack, next}
   - RPC finish(session_token) -> {posterior, signed save file}
   - RPC report_problem(...)
   - tables: items, item_keys (no anon access), item_parameters, sessions, responses, ...
   ^
   | nightly (GitHub Actions cron, Python, service-role key in GH secrets)
[Calibration job: pull -> fit -> write item_parameters -> re-score -> backup]
```

- **Keys stay server-side (R-11.1).**
  - `item_keys` is a separate table with RLS enabled and **no** policies for `anon` or `authenticated`. It is read only by `SECURITY DEFINER` RPCs owned by a restricted role.
  - Payloads never include keys, rationales or parameters for finite-bank items.
  - Procedural items are pre-generated in Python into the DB (e.g. 20k rotation, 20k matrix, 10k series instances). Their keys are therefore also server-side; the client gets only render specs.
  - The render spec implicitly determines the answer for someone who reimplements the solver. That is accepted, because the pool is effectively unlimited.
- **Server-side scoring:**
  - `submit` scores correctness in SQL and updates a per-session, per-axis EAP on a 61-point grid, stored in `sessions.state jsonb`. This is ~50 lines of PL/pgSQL.
  - `next_item` picks by the §7.4 criterion using SQL over eligible items: axis weight, not seen by this session or save file, exposure < cap, `ORDER BY score DESC LIMIT 5`, then a random pick.
  - The correlated-MIRT posterior is computed at `finish` (a PL/pgSQL port of §7.2 with K ≤ 17) and again in the nightly Python re-score.
- **Anti-scraping and rate limiting:**
  - `start_session` is limited to 5 per hashed(IP + daily salt) per day.
  - Each session is limited to 200 items and must be ≥ 2 s per item on average.
  - Session tokens are opaque 128-bit values.
  - Item exposure is logged, and any pattern of sessions that "see many, answer instantly" is blocked.
  - The hashed IP rate table is purged every 48 h.
  - Turn on Supabase's built-in API rate limits and CAPTCHA (hCaptcha/Turnstile free) at `start_session`.

### 11.3 Storage vs quota [CALC]
Assumptions:
- Compact `responses` rows: ~120 bytes, plus index overhead, ×2 → 240 bytes.
- 150 responses per session → 36 KB/session. Add a session row plus a mirrored save file of 15 KB → ~50 KB/session.
- An average of 2 sessions per user → 100 KB/user.

| Users | DB size | Supabase 500 MB | D1 5 GB | Egress (~400 KB/session incl. item payloads) vs Supabase 5 GB/mo |
|---|---|---|---|---|
| 10^2 | 10 MB | 2% | 0.2% | 80 MB total |
| 10^3 | 100 MB | 20% | 2% | 0.8 GB |
| 10^4 | 1.0 GB | **over** → prune/archive | 20% | 8 GB → **over if all in one month** |
| 10^5 | 10 GB | over | over (50k users max) | 80 GB |

**Mitigations:**
1. Nightly archive: responses older than 30 days are exported (Parquet) to the private GitHub repo or a GitHub release asset, then compacted in the DB to one JSONB array per session (~8 KB/session). That gives ~6,000+ users per 100 MB.
2. Serve static item media (rotation specs render client-side; images, if any) from GitHub Pages, not Supabase.

Breakeven: the free tier comfortably handles about 5–10k users/month.

### 11.4 Scheduled jobs and backups
- `.github/workflows/calibrate.yml` runs on cron `17 7 * * *` (daily 07:17 UTC). It checks out the private bank repo, installs Python, and runs `hb calibrate --since 24h` using the `SUPABASE_DB_URL` secret. Its queries also keep Supabase from hitting the 7-day inactivity pause.
- `backup.yml` runs weekly `pg_dump` → gzip → age-encrypted → uploaded as a GitHub release asset in the private repo; the last 8 are retained.
- [EST] GitHub's plans page says GitHub Free includes "2,000 minutes per month" of Actions for private repos (public repos on standard runners are free and unlimited). The calibration job should take < 5 min/day ≈ 150 min/mo.

### 11.5 Cost-escalation path if it goes viral

| Trigger | Action | Cost |
|---|---|---|
| DB > 400 MB or egress > 4 GB/mo | Archive + compaction (free) | $0 |
| Sustained > 10k users/mo | Supabase Pro | From $25/month [EST, supabase.com/pricing] |
| Pages bandwidth > 100 GB/mo | Move the front end to Cloudflare Pages (static bandwidth not metered in docs) | $0 |
| API spikes | Cloudflare Workers Paid for caching/rate limiting | $5/mo minimum [EST] |

### 11.6 Front-end language and timing
- **TypeScript**, not Pyodide/PyScript. Pyodide adds a multi-MB download and a startup delay of seconds, and GC pauses in the WASM Python runtime add unpredictable jitter to RT tasks [EST†]. Python stays offline and in the pipeline. The only logic duplicated in TS is the display-side blob math.
- **Timing evidence:**
  - [EST] Bridges et al. (2020): the best web packages achieve inter-trial RT variability of a few ms, with a mean lag that varies by package and browser.
  - [EST] Anwyl-Irvine et al. (2021, *Behavior Research Methods* 53) measured realistic devices and found larger, device-dependent delays in some cases. They recommend relative RTs and within-participant designs.
- **Implications:**
  1. Onset is locked to `requestAnimationFrame`, and RT is measured with `performance.now()` from the rAF timestamp.
  2. Store the device class, input type (touch/mouse/keyboard) and estimated refresh rate (measured from 60 rAF deltas).
  3. Norm RT *within device class* and show only relative standing.
  4. Treat changes of ≤ 20 ms as noise.
  5. Touchscreens add latency, so a separate RT norm table is kept per input type.

### 11.7 One stack (decision)
**GitHub Pages (Vite + TS + Svelte + D3 + Three.js) + Supabase Free (Postgres, RLS, PL/pgSQL RPCs, Vault) + GitHub Actions (Python 3.12) + a custom subdomain.**

Justification:
- the only free combination that keeps keys server-side with no request caps;
- Python-native offline pipeline;
- one vendor for data;
- SQL is easy to inspect and back up;
- the pause risk is solved by the cron;
- a clean upgrade to Pro ($25) if needed.

---

## 12. Data model

```sql
create table item_families (
  family_id text primary key, axis text not null, facet text,
  generator text, generator_version text, gold_tier char(1) check (gold_tier in ('a','b','c')),
  difficulty_stratum int check (difficulty_stratum between 1 and 6),
  source jsonb not null, license text not null, created_by text not null, created_at timestamptz default now());

create table items (
  item_id text primary key, family_id text references item_families,
  item_type text not null, payload jsonb not null,
  time_limit_s int, status text not null default 'draft'
    check (status in ('draft','review','pretest','live','quarantined','retired')),
  verification jsonb not null, provenance jsonb not null, created_at timestamptz default now());

create table item_keys (
  item_id text primary key references items, key jsonb not null, tolerance jsonb,
  option_weights jsonb, rationale jsonb);
alter table item_keys enable row level security;

create table item_parameters (
  item_id text references items, param_version text, model text,
  a real, b real, c real, extra jsonb, n_resp int, se_b real,
  prior_source text, created_at timestamptz default now(),
  primary key (item_id, param_version));

create table sessions (
  session_id text primary key, anon_id text not null, bank_version text,
  param_version text, device jsonb, flags jsonb, state jsonb,
  started_at timestamptz default now(), finished_at timestamptz,
  calibration_eligible boolean default false);

create table responses (
  session_id text references sessions, seq int, item_id text references items,
  response jsonb, correct smallint, score real, rt_ms int, confidence smallint,
  pretest boolean, client_flags jsonb, created_at timestamptz default now(),
  primary key (session_id, seq));

create table calibration_runs (
  run_id bigserial primary key, param_version text, started_at timestamptz,
  finished_at timestamptz, n_responses int, anchor_drift real, sigma jsonb,
  report jsonb, git_sha text);

create table flags (
  flag_id bigserial primary key, item_id text references items, session_id text,
  kind text, detail text, source text check (source in ('user','auto')),
  created_at timestamptz default now(), resolved boolean default false);

alter table items enable row level security;
alter table item_parameters enable row level security;
alter table sessions enable row level security;
alter table responses enable row level security;
alter table flags enable row level security;
```

No RLS policies are created for `anon`, so all access goes through `SECURITY DEFINER` RPCs that validate `session_token` (R-12.1). `revoke all on all tables in schema public from anon, authenticated;` goes in the migration.

**Item record format (bank repo, one JSON per item, pydantic-validated):**

```json
{
  "item_id": "i:rot:f0042:v1",
  "family_id": "f:rot:0042",
  "axis": "SPATIAL", "facet": "3d_rotation", "loadings": {"SPATIAL": 1.0},
  "item_type": "mc_image_spec",
  "stem": "Which figure is the same object as the one on the left, rotated? (Not mirror-imaged.)",
  "media": {"renderer": "polycube_v1", "target": [[0,0,0],[1,0,0],[2,0,0],[2,1,0],[2,2,0],[2,2,1],[2,2,2],[3,2,2]], "option_specs": ["q1","q2","q3","q4"]},
  "options": ["A","B","C","D"],
  "key": {"index": 2},
  "gold_tier": "a",
  "verification": {
    "method": "canonical_form_SO3_24",
    "checks": {"unique_rotation_match": true, "target_chiral": true, "distractors": ["mirror","mirror","one_cube_moved"], "distractor_pairwise_distinct": true},
    "solvers": {"claude_code": "C", "ollama:qwen-32b": "C", "ollama:gemma-27b": "C"},
    "human_audit": {"by": "sinkomr", "date": "2026-10-01", "result": "pass"}
  },
  "source": {"type": "procedural", "generator": "hb.gen.rotation", "version": "1.2.0", "seed": 918273},
  "license": "CC BY 4.0 (HumanBench original)",
  "difficulty_prior": {"b": 0.6, "sd": 0.8, "provenance": "regression v0.3 on angle=150deg, depth-rotation, mirror distractors; anchored to ICAR R3D mean p=.19"},
  "time_limit_s": 60, "expected_time_s": 28
}
```

---

## 13. Integrity, ethics, privacy, accessibility

- **Honour code** (checkbox at start): "No AI tools, search, calculators (except where provided), or help. Your blob is only meaningful if it's yours."
- **Anomaly heuristics** (each sets `client_flags`; ≥2 flags in a session, or lz* < −2, makes the session `calibration_eligible = false`, but the user still gets results):
  - RT < 25% of the item's median, with a correct answer, on items with median > 20 s (the "too fast for reading").
  - `paste` events in entry fields.
  - `visibilitychange` hidden > 10 s during an item (tab switching).
  - Accuracy on hard (b > θ + 1.5) items far above the model's expectation.
  - A person-fit statistic lz* below −2 [EST†, Snijders 2001]. Implausible time profiles: uniform RT across items of very different lengths.
- **Consent and age gate:** first screen, "I am 18 or older" + a terms/privacy summary (3 bullets + link). Under-18s are blocked with no data stored.
- **Non-diagnostic disclaimer** on every results page: "For curiosity and self-reflection. Not an IQ test, a clinical assessment, or a basis for decisions about education, employment, or health."
- **GDPR/CCPA basics:**
  - A random ID linked to responses is still pseudonymous personal data under GDPR if it can be linked back to a person (Recital 26) [EST†], and Supabase logs process IPs.
  - Therefore publish a privacy notice (controller = you, purpose, retention 24 months, legal basis = consent), provide deletion by anon_id + recovery phrase (or by uploading a save file), and don't store IPs in app tables.
  - CCPA's applicability thresholds (revenue/volume) almost certainly aren't met by a free hobby site [EST†/flag], but follow the same practices.
  - Choose the Supabase region `us-east` or `eu-central`; either is fine for anonymous data.
- **Accessibility (WCAG 2.2 AA):**
  - keyboard navigation for everything;
  - screen-reader labels;
  - no color-only information;
  - adjustable text size, with timing unaffected for power items (no time limits on power items beyond a generous cap).
  - Users can **skip any axis** ("I can't do this one", e.g. colour vision, motor, visual impairment); the blob then shows "not measured".
  - RT tasks offer a keyboard or touch mode; the mode is stored and normed separately.
- **Fairness/DIF without demographics:**
  - Run DIF on what you *do* have: device class, input type, session number, and an **optional** two-question survey (age band; English as first language, y/n), explicitly voluntary and stored separately.
  - Mantel–Haenszel DIF nightly on items with n ≥ 200 per group; |Δ_MH| > 1.5 → review.
  - The tension: without demographics you cannot detect gender or ethnicity DIF. Mitigate at authoring time with G6 bias review and by not making claims about group comparisons.

---

## 14. Build plan for Claude Code

### 14.1 Repo layout

```
humanbench/                      (public; GitHub Pages)
  CLAUDE.md
  web/  (Vite + Svelte + TS)
    src/engine/  (blob math, save file, timing)
    src/tasks/   (rotation, matrix, series, span, rt, reading, fermi, mc)
    src/viz/     (blob.ts, bars.ts, export.ts)
  supabase/migrations/  (SQL, RPCs; no keys)
  schema/save-v1.json
  .github/workflows/pages.yml
humanbench-bank/                 (private)
  CLAUDE.md
  hb/ (Python package)
    gen/ (rotation.py, matrices.py, series.py, quant.py, logic_games.py, fermi.py)
    verify/ (sympy_check.py, z3_check.py, rc_passage_dependence.py, solvers.py, citations.py)
    calib/ (elo.py, mml.py, mirt_score.py, linking.py, qa.py)
    review/ (cli.py, server.py)
    load/ (push_to_supabase.py)
  items/ (json per item, git-tracked)
  tests/
  .github/workflows/calibrate.yml, backup.yml
```

### 14.2 CLAUDE.md starter (public repo)

```markdown
# HumanBench — rules for Claude Code
- Read docs/DESIGN.md (this document) before any change. Requirements are R-x.y; cite them in commits.
- NEVER commit answer keys, item_keys data, service-role keys, or bank items to this public repo.
- Front end: TypeScript strict, Svelte, D3. No Pyodide.
- Timing code: rAF-locked onset, performance.now(); never Date.now() for RT.
- Every feature needs tests: vitest (unit), Playwright (e2e incl. iOS Safari emulation for save/upload).
- Terminal instructions written for the user: macOS zsh, and NO '#' comments inside command blocks.
- Blob: radius linear in theta [-3,3]; show uncertainty; never show total area or a single score.
- Non-diagnostic language only (R-5.6.x).
```

The private repo's CLAUDE.md adds:
- Python 3.12, `uv`, `ruff`, `pytest`, `hypothesis` for generators.
- Every generator ships a verifier and a property test ("10,000 random instances all pass verify()").
- Items reach `live` only via `hb promote` after gates G1–G7.

### 14.3 Milestones and acceptance criteria

| Milestone | Scope | Acceptance criteria (tests) |
|---|---|---|
| **M0 Scaffolding** (½ day) | Repos, Pages deploy, CI | Pages URL serves "hello"; CI runs vitest + pytest green |
| **M1 Static MVP** (1–2 wk) | Procedural tasks generated client-side from a seeded TS port *or* a pre-generated static JSON pool (keys client-side acceptable here): rotation, matrices, series, arithmetic, digit/Corsi span, simple/choice RT, reading speed; per-axis EAP in TS; blob; save file (unsigned); export PNG/SVG | (1) 10k generated instances per family pass verify; (2) simulated users (catsim) recover θ with r ≥ .85 at 20 items/axis; (3) save → reload → merge is idempotent (property test); (4) iOS Safari emulation downloads and uploads a save; (5) RT inter-trial jitter < 5 ms on a 120 Hz Mac in a self-test |
| **M2 Backend** (2 wk) | Supabase schema, RPCs, server scoring/selection, HMAC-signed saves, rate limits, report button | (1) `anon` cannot `select` any table (automated negative test); (2) no response payload contains `key` (fuzz test over 1,000 items); (3) p95 RPC latency < 300 ms; (4) tampered save → "unverified" |
| **M3 Knowledge & verbal banks** (3–4 wk, ongoing) | Generation workflow, gates G1–G7, review tool, 1,500 finite items | Audit table §4.4 met per batch; RC no-passage test pass rate logged; 0 items without citations in knowledge axes |
| **M4 Calibration** (1–2 wk) | Nightly job: Phase A/B, linking, QA quarantine, Σ re-estimate, backups | Simulation: with 300 simulated users, recovered b correlates r ≥ .9 with truth; anchor drift < 0.1; negative-a item auto-quarantined in an injected-error test |
| **M5 Tier (b)** | Fermi + calibration UI, interval questions | Brier computed server-side; Fermi truth values have 2 sources |
| **M6 Tier (c)** (v2) | STEU-style appraisal items, SJT with key blending, RAT, AUT with in-browser embeddings | Rule-engine key agreement 100%; AI-ensemble vs theory key agreement ≥ 85% or item rejected; hatch rendering; disclaimer tests (string lint for banned clinical terms) |

### 14.4 Libraries
- **Python:** `sympy`, `z3-solver`, `numpy`, `scipy`, `pydantic`, `typer`, `fastapi`, `uvicorn`, `psycopg[binary]`, `pandas`, `pyarrow`, `girth` (unidimensional 2PL/GRM MML), `catsim` (CAT simulation), optional `py-irt` (Pyro-based Bayesian IRT), `trimesh` or plain NumPy for polycubes, `ollama` (client), `hypothesis`, `pytest`.
- **Front end:** `svelte`, `vite`, `typescript`, `d3`, `three`, `@supabase/supabase-js`, `@huggingface/transformers` (v2, for AUT embeddings), `vitest`, `playwright`. jsPsych is not required (timing is implemented directly), but its timing notes are the reference.

### 14.5 No-budget item-generation workflow
1. In Claude Code (your subscription), run `hb gen --family knowledge.history --stratum 3 --n 50`. Claude writes items to `items/drafts/` with citations it has checked via web fetch.
2. `hb verify drafts/` runs the programmatic checks and then the local solvers via Ollama (e.g. `ollama pull` a ~14–32B model sized to your RAM). The key is hidden from solvers.
3. `hb review` for your audit sample (§4.4), then `hb promote` → `hb push` (to Supabase as `pretest`).

Throughput [SPEC]: roughly 100–300 verified finite items per evening of mostly-waiting, so ~1,500 items in 1–3 weeks of evenings.

**API cost if you use the paid API instead [CALC; September 2026 prices per third-party trackers citing anthropic.com/pricing (benchlm.ai, aipricing.guru): Haiku 4.5 $1/$5, Sonnet 5 $2/$10, Opus 5 $5/$25 per M tokens].** Assume ~3k input + 1.5k output tokens to author an item, plus ~2× that for an API-based verification solve, i.e. ≈ 9k input + 4.5k output per item.

| Items | Tokens (in / out) | Haiku 4.5 @ $1/$5 per M | Sonnet 5 @ $2/$10 per M | Opus 5 @ $5/$25 per M |
|---|---|---|---|---|
| 1,000 | 9M / 4.5M | $31.5 | $63 | $157.5 |
| 5,000 | 45M / 22.5M | $158 | $315 | $788 |
| 10,000 | 90M / 45M | $315 | $630 | $1,575 |

The Batch API cuts prices by 50%, and cache reads cost 10% of the input price.

### 14.6 Worked example items
All of these follow the §12 schema; fields not shown default to that example.

1. **Matrix (tier a).** `{"item_id":"i:mat:f0182:v3","item_type":"mc_matrix_spec","media":{"grid":[["1 circle small","2 circle med","3 circle large"],["1 square small","2 square med","3 square large"],["1 triangle small","2 triangle med","?"]]},"options":["3 triangle large","3 triangle small","2 triangle large","3 square large","1 triangle large","3 circle large"],"key":{"index":0},"verification":{"method":"rule_enumeration","consistent_rule_sets":1,"rules":{"count":"progression+1 by column","shape":"constant by row","size":"progression by column"},"distractor_violations":["size","count","shape","count","shape"],"option_only_heuristic_hit":false}}`. This one is easy (b prior −1.2).
2. **Series.** `{"item_id":"i:ser:f0077:v1","stem":"2, 6, 12, 20, 30, ?","item_type":"numeric","key":{"value":42,"tol":0},"verification":{"rule":"n(n+1)","alt_rule_families_checked":["arith","geom","2nd-diff const","fib-like","interleave"],"competing_min_mdl_rules":0,"note":"2nd-difference-constant rule gives same 42 (equivalent)"}}`.
3. **Quantitative.** `{"item_id":"i:qnt:f0310:v2","stem":"If x + 1/x = 3, what is x^3 + 1/x^3?","key":{"value":18,"tol":0},"verification":{"sympy":"expand((x+1/x)**3) - 3*(x+1/x) at x+1/x=3 -> 27-9=18; numeric check at both roots x=(3±√5)/2 -> 18.000000000","solvers":{"claude_code":18,"ollama:qwen":18,"ollama:gemma":18}},"difficulty_prior":{"b":0.3,"provenance":"stratum 3 (college-entry)"}}`.
4. **Logic game (Z3).** Setup: "Six talks F, G, H, J, K, L are scheduled one per slot in slots 1–6. G is earlier than J. H is immediately before or after K. F is in slot 3 or 4. L is not in slot 1 or 6." Question: "If K is in slot 1, which must be true?" Options: A: H is 2nd; B: F is 3rd; C: G is 2nd; D: J is 6th; E: L is 5th. Key A. `verification: {"z3_models_setup": >=2 (counted), "must_be_true_options": ["A"], "setup_model_count_given_K1": >1}`. Claude Code must run `count_models` to fill in the exact counts; the item must be rejected if any other option is forced.
5. **Logical reasoning (LR).** Stimulus: "Every city that adopted congestion pricing saw downtown traffic fall. Therefore congestion pricing reduces downtown traffic." Question: "Which, if true, most weakens the argument?" Key: "Cities adopted congestion pricing only after traffic had already begun falling due to a transit expansion." `verification: {"reasoning_type":"causal-alternative cause","solver_unanimity":true,"distractor_rationales":["irrelevant comparison","strengthens","out of scope","restates premise"]}`.
6. **Reading comprehension.** Passage: 320 words from OpenStax *Biology 2e*, "osmosis" section (CC BY 4.0, attribution in `source`). Q: "According to the passage, water moves across the membrane toward…". Key: "the region of higher solute concentration". `verification: {"evidence_span":"…water moves from an area of low solute concentration to an area of high solute concentration…","no_passage_test":{"models":2,"samples":10,"correct_rate":0.6},"decision":"REJECT (answerable without passage)"}`. This is a worked *rejection* example; the replacement asks about a passage-specific example instead.
7. **Knowledge (humanities).** "Which treaty ended the Thirty Years' War in 1648?" Key: Peace of Westphalia. `verification: {"sources":[{"name":"Encyclopaedia Britannica, 'Peace of Westphalia'","quote":"…ended the Thirty Years' War…1648"}, {"name":"second source required"}],"fact_volatility":"static"}`. The Britannica quote must be fetched and pasted verbatim by the pipeline.
8. **Fermi (tier b).** "How many seconds are in a year?" true = 3.156e7, unit s, uncertainty 0 dex, source = arithmetic (365.25 × 86,400). Scoring: estimate 3e7 → |log10(3e7/3.156e7)| = 0.022 dex. `verification: {"computation":"365.25*86400=31,557,600"}`. Real items use data sources (e.g. BTS, USGS) with an `as_of_date`.
9. **Calibration.** Attached to any tier-a item: confidence slider 20/50–100% (chance-adjusted floor = 1/k). Brier per response = (c − y)². Worked case: c = 0.9, y = 0 → 0.81; c = 0.6, y = 1 → 0.16.
10. **Digit span.** Server-sent sequence `[7,2,9,4,1]`, backward. Key `[1,4,9,2,7]`. Scoring: GRM on the longest length passed with 2 trials per length; truth = the sequence itself (tier b).
11. **Corsi.** 9-block layout fixed; sequence `[3,8,1,6]`; response positions are compared exactly.
12. **Choice RT.** 4 positions; stimulus onset jitter 800–2,000 ms; key = position. Score = median log RT of correct trials (≥ 30 valid trials), with the device class stored.
13. **Reading speed.** 350-word public-domain passage (Gutenberg, pre-1928). Timer starts on reveal and stops on "Done". Gate: 3 literal questions, ≥ 2 correct required. wpm = 350 / (t/60). Flag if wpm > 900 (skimming).
14. **Emotion understanding (tier c→a, new item).** "Maya's manager publicly credits Maya's colleague for work Maya did. Maya believes the manager did it deliberately. Maya most likely feels:" Options: anger, sadness, guilt, fear, surprise. Key: anger. `verification: {"appraisal":{"goal_congruence":"incongruent","agency":"other","intent":"deliberate","control":"moderate"},"rule_engine":"Roseman-style table -> anger","ai_ensemble":{"anger":0.93,"sadness":0.05,"other":0.02},"key_source":"theory+ai","population_blend":"lambda=n/(n+200)"}`.
15. **SJT.** "A teammate misses a deadline that delays your work. Rate each response 1–4." Options: (a) raise it privately and ask what happened; (b) tell the manager immediately; (c) say nothing and redo it yourself; (d) mention it in the team channel. Expert/AI key ratings = [4, 2, 1, 1.5]. Score = 1 − mean|user − key|/3.
16. **RAT.** "cottage / swiss / cake → ?" Key: cheese. `verification: {"compound_check":{"cottage cheese":true,"swiss cheese":true,"cheesecake":true},"alt_solutions_above_freq_threshold":0}`. This is a classic public example; production triads are newly authored.
17. **AUT.** "List unusual uses for a brick (90 s)." Scoring: embedding distance from "brick" for each response, mean of the top 3, standardised within prompt. `verification: n/a (continuous, tier c-auto)`; validity note per §5.4.

---

## 15. Step-by-step terminal instructions (macOS, zsh)

Install the tools with Homebrew. If `brew` isn't installed, get it from brew.sh first. This installs git, the GitHub CLI, Node, Python and the Supabase CLI:

```
brew install git gh node python@3.12 uv supabase/tap/supabase
```

Log in to GitHub from the terminal (choose GitHub.com, HTTPS, and browser login):

```
gh auth login
```

Set your git identity. Replace the name and email with yours; GitHub's noreply address keeps your email private:

```
git config --global user.name "sinkomr"
git config --global user.email "sinkomr@users.noreply.github.com"
```

Create the public app repo and the private bank repo, then clone both into `~/code`:

```
mkdir -p ~/code
cd ~/code
gh repo create sinkomr/humanbench --public --clone --description "HumanBench: a jagged-blob cognitive profile"
gh repo create sinkomr/humanbench-bank --private --clone
```

Put this design document into the app repo and make the first commit. Save this file as `DESIGN.md` in Downloads first:

```
cd ~/code/humanbench
mkdir -p docs
cp ~/Downloads/DESIGN.md docs/DESIGN.md
git add docs/DESIGN.md
git commit -m "Add HumanBench design study"
git push -u origin main
```

If `git push` says the branch is `master`, run `git branch -M main` and then repeat the push.

Start Claude Code in the repo and ask it to do milestone M0 (scaffold Vite + Svelte + TS, CLAUDE.md, and a Pages workflow):

```
cd ~/code/humanbench
claude
```

After Claude Code has created files, review and commit them. `git status` shows what changed and `git diff` shows the details:

```
git status
git diff
git add -A
git commit -m "M0: scaffold web app, CLAUDE.md, Pages workflow"
git push
```

Enable GitHub Pages with the "GitHub Actions" source. The first command enables it; the second shows the site URL:

```
gh api -X POST repos/sinkomr/humanbench/pages -f build_type=workflow
gh api repos/sinkomr/humanbench/pages
```

Watch the deploy run until it finishes:

```
gh run list --limit 3
gh run watch
```

Your site is then at `https://sinkomr.github.io/humanbench/`.

**Supabase.** Create a free account at supabase.com and a new project (choose a region and save the database password). In Project Settings, copy the project reference ID, then link and push the migrations. In the commands below, replace `YOUR_PROJECT_REF` with it:

```
cd ~/code/humanbench
supabase login
supabase init
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

Commit the migration files Claude Code wrote (SQL only; no keys or items):

```
git add supabase
git commit -m "M2: database schema and RPCs"
git push
```

Store the database connection string as a secret in the **private** repo so the nightly Python job can reach the database. Copy it from Supabase → Connect → "Session pooler" and replace `YOUR_DB_URL`, keeping the quotes:

```
cd ~/code/humanbench-bank
gh secret set SUPABASE_DB_URL --body "YOUR_DB_URL"
gh secret list
```

The front end needs only the public URL and the anon key; RLS makes the anon key safe to expose. Add them as repository variables for the Pages build:

```
cd ~/code/humanbench
gh variable set VITE_SUPABASE_URL --body "https://YOUR_PROJECT_REF.supabase.co"
gh variable set VITE_SUPABASE_ANON_KEY --body "YOUR_ANON_KEY"
```

Set up the Python pipeline in the bank repo and make its first commit:

```
cd ~/code/humanbench-bank
uv init --package hb
uv add sympy z3-solver numpy scipy pydantic typer fastapi uvicorn "psycopg[binary]" pandas pyarrow girth catsim hypothesis pytest
git add -A
git commit -m "Init Python item pipeline"
git push -u origin main
```

Run the nightly calibration job once by hand to test it:

```
gh workflow run calibrate.yml
gh run watch
```

**Custom subdomain (optional).** At your DNS provider, create a `CNAME` record with name `test` (or any name you like) and target `sinkomr.github.io`. Then tell GitHub about it and enforce HTTPS, replacing the domain:

```
gh api -X PUT repos/sinkomr/humanbench/pages -f cname=test.YOURDOMAIN.com
gh api -X PUT repos/sinkomr/humanbench/pages -F https_enforced=true
```

DNS and the certificate can take up to about an hour. If `https_enforced` fails at first, wait and repeat it.

Everyday loop after any change:

```
git pull
git add -A
git commit -m "Describe the change"
git push
```

---

## 16. Risks, open questions and falsifiable checks

| ID | Risk | Falsifiable check | If it fails |
|---|---|---|---|
| F1 | AI-predicted difficulty is poor | After n ≥ 100 responses on ≥ 200 items, compute r(b_prior, b̂). If r < .40 across strata or < .20 within strata | Drop text-feature predictions, use stratum means only, and widen σ_b to 1.3 |
| F2 | Self-selected norms | Compare HumanBench users' ICAR anchor p-values with ICAR's published values (e.g. rotation .19, matrix .52). If users exceed them by > 0.5 SD | Label percentiles "vs HumanBench takers" (already required); never claim population percentiles |
| F3 | Practice effects | Among returning users, if the mean session-2 gain on alternate-form items exceeds 0.45 SD, or does not plateau by session 4 | Increase ρ priors; enforce ≥ 7-day spacing for calibration eligibility |
| F4 | AI-assisted cheating | If > 5% of sessions carry ≥ 2 anomaly flags, or high-b items' observed p exceeds the model by > .15 among flagged users | Add a CAPTCHA, remove flagged sessions from calibration, rotate exposed items |
| F5 | Item leakage | Weekly web search of 20 random live item stems (exact phrase). If ≥ 1 is found | Retire the family; add canary strings; increase the procedural share |
| F6 | Consensus-key circularity | For tier-c items with n ≥ 300, if the population top option disagrees with the theory/expert key on > 15% of items | Freeze the blend at λ ≤ 0.5; review keys; label the axis "agreement with consensus" |
| F7 | Short-form reliability | Split-session reliability (odd/even items) per axis after N ≥ 500 users. If Spearman-Brown reliability < .65 at session 1 | Merge the weakest axes (e.g. fold Vocabulary into Reading) or allocate more time |
| F8 | Axis distinctness | If an estimated latent correlation > .90 between two axes | Merge them in the blob (the "jaggedness" between them is noise) |
| F9 | Copyright exposure | CI lint: fail if any item `source.license` is not in an allow-list (CC0, CC BY, public domain, original) or if an item's text has > 40% 8-gram overlap with the anchor corpus | Block promotion |
| F10 | Device effects on RT | If the difference in desktop-vs-touch median RT exceeds 50 ms after N ≥ 300 per class | Keep separate norms (already planned); never compare across classes |
| F11 | Supabase pause or limits | Cron missed for 6 days, or DB > 400 MB | Alert via Actions failure email; archive; consider Pro ($25/mo) |
| F12 | Topic zones (skip, ask first, build up) are wrong for the person (§17, A21) | Before real data: the AI.8s sweep passes at the chosen σ_rel. On real data: held-out ladder probes and next-session items, ≥ 200 topic-instances per zone. Skip: accuracy ≥ .75 with the 95% CI lower bound ≥ .70. Build: accuracy ≤ .50 with the upper bound ≤ .55. Gross errors ≤ 2% of cells. ECE ≤ .07 | Raise the posterior requirement to .95 and widen σ_rel. If it still fails, no inferred lines |
| F13 | A person's knowledge varies by topic too little for topic lines | The person-by-facet variance model (AI.20) gives τ̂ ≥ .20 for the axis | Review the taxonomy; no observed lines for that axis |
| F14 | Word features do not predict vocabulary and reading item difficulty | VOC R²_cv ≥ .25 and the prevalence slope's 95% CI excludes 0; RC R²_cv ≥ .15; the VOC slope differs by < 50% across English-first-language groups | No measured word suggestions |
| F15 | Modelled word knowledge does not match what people report knowing | A pseudoword-corrected yes/no probe with n ≥ 300: calibration slope .80–1.25 and ECE ≤ .07 | No measured word suggestions |
| F16 | Assistants do not follow a line type (steerability, per line type, family and destination) | E7, E7d (K2), E13 and E17 pass, and the destination's surface smoke passes | Reword, or drop the type for that family or destination |
| F17 | A line type makes assistants less accurate, more condescending or more intrusive (safety invariance) | E1–E6, E8, E10, E14–E16, E18 and E20–E22 pass (E19 for results-derived types); positive controls are detected; E9 and the trait-worded arm are reported | Type blocked. If all personal types fail, ship T0 only |
| F18 | The notes do not help real users (Arm B, bring your own assistant) | Quiz score non-inferior at 5 pp (one-sided α .025), then superior (α .05); condescension non-inferior within 0.3 on the 5-point scale | Non-inferiority fails: withdraw topic suggestions. Superiority fails: keep them labelled "no measured benefit yet" |
| F19 | Matched explanations do not beat mismatched ones (Arm F, aptitude-by-treatment crossover) | Condition × zone interaction p < .05, and matched > mismatched in both groups (at least one simple effect significant) | Keep results-derived lines as drawer-only information; say so publicly |
| F20 | Misreading and coercion: notes read as an ability report, or demanded by others | n = 10 think-aloud as a qualitative screen (any ability-report reading leads to a copy fix). M2 re-check: a consented one-question item after copying, n ≥ 200, with ≤ 20% reading the notes as an ability report and the 95% CI upper bound ≤ 25%. Any credible report that an employer or school asked for notes | Topic lines off by default; add friction (download only, interstitial); publish a statement |
| F21 | Suggestions rarely settle, or saturate at "ask first" (QR) | Users with ≥ 3 sessions or ≥ 1 goals session have a median of ≥ 2 decided suggestions, and "ask first" is ≤ 80% of their lines | Fix topic granularity and the bank (AI.16), not the thresholds |
| F21-K | Knowledge suggestions rarely settle | Among users with ≥ 2 targeted sessions on a subject, the median has ≥ 1 decided observed line on it | Raise per-facet counts or targeting weight (AI.20, AI.21b) |

F12–F21-K belong to Phase AI (§17) and decide mechanically:
- F16 and F17 decide which line types exist;
- F12–F15 decide which inputs may drive them;
- F18 and F19 decide what the copy may claim.

Thresholds change only through a new versioned rule (`z2` for zones) with a re-run, never by eye. F12, F13, F21 and F21-K are computed by the M4.9 nightly report from recomputed zones, and never read notes or preferences. F14 comes from AI.19 and F15 from AI.25. F16 and F17 come from the bank behaviour gate, and F18 to F20 from the pre-registered trials and the think-aloud (ROADMAP Phase AI). The metrics E1–E22 are defined in the Phase AI proposal (proposal §7.3; see §17.6).

**Open questions and flagged gaps (these affect the design):**
1. ICAR's terms say academic use only (icar-project.com); permission for a hobby site is unconfirmed, so the default is to use published statistics only.
2. Exact licensing for KDEF/RaFD public display is not confirmed. The default is no real-face databases.
3. The STEU/STEM license for public use is not confirmed. The default is newly written items using the same method.
4. The GPQA/HLE/PISA/TIMSS/Regents terms are flagged. The default is not to serve them.
5. The Supabase free Edge Function quota (500k/mo) comes only from third-party write-ups (itpathsolutions.com, designrevision.com), but the design does not depend on it (RPC only).
6. GitHub Actions minutes for private repos are 2,000/mo on GitHub Free (GitHub Docs), ≫ the need of ~150 min/mo.
7. The name collision: no trademark search was performed.
8. Claude API prices come from third-party trackers (benchlm.ai, aipricing.guru), not anthropic.com directly; re-check before spending.

---

## 17. Notes for your AI

Phase AI (ROADMAP "Phase AI", ADRs A20–A24, decision D13). The detailed design, the notes wording (proposal §4.2), the worked examples (proposal §4.9), the zone tables (proposal §4.4), the item tags (proposal §5.1) and the gate metrics E1–E22 (proposal §7.3) are in the annex, the bank file `docs/proposals/ai-notes-v2.md`, cited as "proposal §x". This section holds the requirements.

**17.1 Purpose.** An optional, user-controlled way to make short instructions that a person pastes into their own AI assistant, so it explains things the way they want (D13). In v1 the notes come from the person's own settings. Test results may add suggestions only after checks on real data. It makes no human-vs-AI comparison (D1).

**Status.** Part 1 is approved (2026-09-29): notes built from the person's own settings, the checker, the results-talk helper, the zone-rule simulation, the behaviour-gate smoke run, the surface smoke test and the M2 strip rule. Part 2 needs a separate approval: results-derived suggestions, the calibration line, Sharpen, goals mode, trials, the word register and the MCP server. Part 2 starts only if F12 passes on real data and the behaviour gate passes.

**17.2 Principles.** Instructions, not traits. Personalise depth by topic, and use universal defaults for everything that helps nearly everyone. Uncertainty becomes behaviour: when unsure, the assistant asks one quick question first. The person owns, edits and scopes every line. Nothing leaves the device.

**17.3 Forms.** Short text (≤ 1,500 characters), long Markdown (≤ 5,000), `SKILL.md` (the default for coding agents), a user-level rules file, and JSON `hb-brief/1`, all from one closed grammar. Also an in-app checker, and a results-talk preamble. Contexts: coding and data, learning, reading, everyday numbers, writing, general; at most 5 topics each.

**17.4 Settings.** Per topic: skip the basics, ask first, or build up; set by the person, and in Part 2 suggested by A21. Modes: teach me, just do it, challenge me. Three internal explanation settings define each by observable behaviours.

**17.5 Requirements.**
- R-17.1: Local only. Notes are generated client-side and never stored on a server, logged or transmitted. No send integration, deep link, API or LLM call. In M2, `brief_prefs` is removed by `toUploadPayload()` before every network call, rejected by the server, excluded from the mirror and outside the HMAC scope.
- R-17.2: Instructions, not traits, enforced by the brief lint.
- R-17.3: Closed grammar: ASCII; digits only in YYYY-MM; no URLs; no scores, estimates, percentiles, levels, school-level words, axis names or branding. The header reads "my own preferences, not an assessment of me", with a no-date fallback. Unverifiable by design.
- R-17.4: Allowed inputs: the person's own settings. Part 2 adds: QR topic groups (inferred, ≤ 2 per note, suggestions only, after F12); observed knowledge and notation facets; a VOC register suggestion (gated); CAL direction (n ≥ 160, opt-in). Never: MAT, SPA, LR/LG as general reasoning, WM, RT, PS or reading speed, FER, EMO, SJT, CRE, integrity flags, skipped or unmeasured axes, values borrowed through Σ, or any inferred format or accessibility need.
- R-17.5: Zones follow A21, using eligible sessions only. No results-derived lines on uncalibrated priors.
- R-17.6: The self-expiring header and fixed clauses F1–F4 are always present, first and locked; CC in coding contexts. F1–F4 are line IDs of the notes grammar, not the §16 checks of the same name.
- R-17.7: Tiers T0/T1/T2 with consent per line. Self-set lines are pre-ticked; results-derived lines never are. T2 never includes inferred lines. The floor rule applies to the two lowest quant groups. The person's own settings win.
- R-17.8: For each line, the person sees, in words tied to its basis: the basis, how sure it is, what research does and doesn't support, which model families and destinations it was checked with and when, and what would change it. Never estimates. Inferred-basis text never claims observed facts.
- R-17.9: The A22 release gate (positive controls, multi-turn, headless and surface arms) and the copy-claim rule.
- R-17.10: Provider warning, placement guide, anti-coercion copy, and per-destination install and removal steps, dated and re-checked each release.
- R-17.11: Checker and sanitisation; `parse(render(p)) = p`; all released versions parse; withdrawn lines trigger an in-app notice.
- R-17.12: Data minimisation: preferences as enums, IDs, versions and months; free text never persisted; never on share cards; no notes telemetry; the fit log never enters scoring; the builder is storageless until the 18+ gate, and the under-18 path writes nothing.
- R-17.13: The reveal and share-card screens offer a results-talk preamble and say never to paste the save file.
- R-17.14: Accessibility: the builder meets M1.21 (320 px reflow, 200% zoom, reduced motion, an announced copy confirmation). Format lines are chosen, never inferred, and named by format.

**17.6 Evaluation.** Generator properties in CI; an offline behaviour gate with positive controls and multi-turn, headless and memory arms; real-surface smoke tests; claim validity (F12, F13); language validity (F14, F15); real-user trials (F18, F19); misreading and saturation monitoring (F20, F21). See §16. The metric definitions E1–E22, the positive controls PC1 and PC2, and the rules that decide whether a line type is shipped, experimental or blocked for a destination are in proposal §7.3. The bank harness (AI.12a-run) implements them and its README restates them once it lands.

**17.7 Copy drafts.** User-facing strings for the builder, the reveal and the share-card screen. Each passes the A13 lint. The task named in the last column copies its strings word for word into `web/src/brief/` and pins them to this table in a test, the way `src/copy.ts` is pinned to §13. Where a row has a slot in braces (`{month}`, `{topic}`, `{k}`, `{n}`), the code fills it at render time and the test compares the template with the slot filled from a fixture, so an example value is never hardcoded. Change the table and the code together. Rows marked "Part 2" ship only with Part 2.

| Key | Text | Task |
|---|---|---|
| trust | Nothing on this page leaves your device. HumanBench doesn't send, store or log your notes. Copying them into an assistant is your choice. | AI.5 |
| provider | Before you paste: anything in an AI assistant's settings goes to that company with every chat. Depending on your settings it may be kept for years, used to train future models, read by reviewers, or used to personalise ads. On work or school accounts, administrators may be able to read it. Check your assistant's data settings, prefer a personal account, and only include lines you'd be fine with anyone reading. (Checked 2026-09.) | AI.5 |
| anti-coercion | This is yours. No employer, school or app should ask you for it, and you can always say no. HumanBench results aren't valid for decisions about hiring, admissions, grades, or anything like them. | AI.5 |
| placement | Put these in your personal settings, a personal Project, or your own rules folder. Never put them in a file inside a shared repository. Prefer instructions over memory: memory features rewrite what you give them. | AI.5 |
| claim | Designed from research on explanations; not yet shown to help HumanBench users. | AI.5 |
| drawer-self-set | Research on teaching supports matching depth to what you already know; not yet tested for AI notes. | AI.5 |
| floor-rule | We're still checking that assistants handle this line respectfully. For now your notes ask the assistant to check with you first. You can write your own line instead. | AI.5 |
| science | Measured science lines need many more people to take HumanBench first. Until then, set these topics yourself. | AI.5 |
| interests | Hobbies or subjects you like. Don't add health details or anything personal. This is never saved. | AI.5 |
| fit-log | Your fit notes change only these suggestions. They never change your results. | AI.5 |
| remove | Remove my notes settings. This deletes your notes preferences from this device. Your results stay. Download a fresh save afterwards if you keep one elsewhere. | AI.5 |
| troubleshooting | Your assistant may not be reading your notes. Check that they are in your personal instructions, not in a chat message, and start a new chat. | AI.5 |
| look-for-skip | On skip-the-basics topics it goes straight to the method and says when it skipped routine steps. | AI.5 |
| look-for-ask | On ask-first topics it asks you one quick question, once per conversation, then pitches to your answer. | AI.5 |
| look-for-build | On build-up topics it starts from a small example, shows every step and gives a way to check. | AI.5 |
| look-for-check | On answers that matter it says how sure it is and how to check. | AI.5 |
| look-for-voice | By voice, it speaks in short chunks, says symbols in words, and offers a written version of long steps. | AI.5 |
| look-for-agents | In coding agents, it doesn't put these preferences into code, comments or commit messages. | AI.5 |
| withdrawal | A line in notes you made in {month} has been withdrawn. Re-copy your notes to replace it. | AI.6 |
| reveal-card | Want your AI assistant to explain things your way? Make notes you control. For now they use your own settings. Lines based on your answers aren't available yet, because they need checks that only real results can provide. | AI.6b |
| results-talk | Talking about your results with an AI? Paste this first. Never paste your save file: it holds your raw answers, and assistants may keep or learn from what you paste. | AI.6b |
| results-preamble | These are rough, uncertain self-reflection results from a free online test. Ranges that overlap are not real differences. Don't turn them into an intelligence number, a rank against other people or one overall figure. Don't guess at health or medical explanations for them. Help me think about what I might practise or explore, if anything. | AI.6b |
| mirror | Your server backup doesn't include your notes settings. Keep your downloaded save if you want them on another device. | AI.26 |
| part2-banner | Most of your math topics say 'ask first' for now. Your results still have wide ranges, so your assistant will ask before it pitches. (Part 2) | AI.10 |
| part2-downward | Your notes for {topic} now say 'ask first'. Your newer answers left this topic less settled. (Part 2) | AI.10 |
| part2-integrity | Notes use only complete sessions. (Part 2) | AI.10 |
| part2-drawer-inferred | Why this line: based on your math answers overall and how hard these problems usually are, your notes ask first here. It isn't based on problems of this kind in particular. How sure: provisional. What would change it: new sessions, or marking two answers on this topic as 'too much' or 'too basic'. (Part 2) | AI.10 |
| part2-drawer-observed | Why this line: from the {topic} questions you've answered so far (at least five), typical {topic} questions are likely to be new ground for you, even allowing for how uncertain that still is. (Part 2) | AI.22 |
| part2-taste-test | You preferred the answer written with your notes in {k} of {n} comparisons. This is your own impression, not evidence that the notes help. (Part 2) | AI.15 |

Notes on the drafts:
- The results-preamble is exactly 340 characters of ASCII text (tested).
- The provider warning's claim about ad personalisation comes from secondary sources; verify it, and re-check every dated statement, before release (R-17.10).
- Until F18 and F19 pass, only the claim string may describe benefit, and it says "not yet shown" (A22). No other string may say or imply benefit.
