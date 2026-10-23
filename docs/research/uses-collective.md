# What can be done with HumanBench results: collective, social and product uses

*Research study, 2026-10-22. Lens: collective, social and product uses (open research data, social and fun features, communities, a public findings page, sustainability). Companion to `docs/research/phase-ai-2-study.md`, which covered the "notes for your AI" use. Scope documents read: DESIGN §3, §6–§7, §9, §10, §11–§13, R-5.6.x, §17; the online privacy notice in `web/src/backend/copy.ts`; ROADMAP A12, A13, M1.R, M1.18. This document contains no item text, keys or bank data. It is a reading of precedents and literature, not a requirement. Anything here that would change DESIGN, ROADMAP or the privacy notice still needs the owner's approval.*

**Evidence labels** (same scheme as the Phase AI Part 2 study): **MA** meta-analysis or systematic review; **RCT** randomised trial; **LAB** experiment that is not a full trial; **OBS** observational, survey or large-sample correlational study; **DATA** a published dataset or data paper; **PP** project page or a project's own description of itself; **NEWS** news or science-media briefing; **REG** statute, case law, regulator guidance; **OP** opinion, template or narrative review; **CALC** a derivation in this document; **INF** an inference by this study, not a finding.

**Method and limits.** Two helper passes (precedents of online volunteer cognitive testing; social comparison, privacy law, misuse, consent and sustainability) plus a pass over the HumanBench docs. The session's web-search quota was used up, so sources were found through the OpenAlex, Crossref and PubMed APIs and fetched by URL. Several pages refused the fetcher; claims from those are marked "not re-fetched" in the source table. Most journal claims rest on abstracts. Legal points are a reading of statutes and guidance by a non-lawyer, not legal advice.

---

## Executive summary

**The short answer.** The individual-advice use (notes for an AI) is weak for most axes, as the earlier study found. The *collective* uses are stronger, because aggregation removes the problem that sank the individual use: one person's per-axis estimate is noisy (SE ≈ 0.55σ after one session, DESIGN §7.6), but averages and correlations over thousands of people are not. Every successful precedent (TestMyBrain, LabintheWild, the Great British Intelligence Test, SAPA/ICAR, Project Implicit) ran on the same deal HumanBench already offers: *your results in exchange for your data*, and its value came out at the collective level, as papers, open datasets and public findings. The precedents also show what goes wrong: headline overclaiming ("IQ is a myth", "ten years of ageing"), self-selected samples treated as population norms, individual feedback presented with more certainty than the measure has, and "anonymised" data that was not.

Social comparison is the riskiest category. The best meta-analysis finds that comparing yourself with someone better mostly lowers both your self-rating and your mood, and that ability is the domain where this is strongest. That rules out leaderboards and makes any friend comparison something to design carefully, not by default.

**Ranked ideas** (value × evidence × feasibility × risk; each scored 1–5, risk scored so that 5 = safest; the reasoning is in each section):

| Rank | Idea | Value | Evidence | Feasible now | Risk (5 = low) | Verdict |
|---|---|---|---|---|---|---|
| 1 | **A public "What we learned" page**: aggregate findings, pre-registered questions, nulls published | 4 | 4 | 4 | 5 | Build first; the first post can go out at a few hundred sessions |
| 2 | **Item parameters, generators and calibration code as a public good** (procedural families only) | 3 | 4 | 5 | 5 | Build; mostly packaging of what exists |
| 3 | **"Guess your blob"**: predict your own profile before the reveal, and optionally have a friend predict it | 4 | 3 | 4 | 4 | Build; fun, adds self-knowledge, produces a novel research question |
| 4 | **A daily or weekly puzzle with a spoiler-free share grid** (procedural, unscored) | 3 | 2 | 5 | 4 | Build cheaply, outside the scored bank |
| 5 | **Opt-in research release in tiers** (CC0 aggregates; row-level data behind a click-through agreement) | 5 | 4 | 2 | 2 | Plan now (consent text), release only after thousands of opt-ins and a written risk assessment |
| 6 | **Citizen-science study modules** (short, opt-in, pre-registered add-on studies) | 4 | 4 | 2 | 3 | Later; needs a study partner and per-study consent |
| 7 | **Private friend or group blobs** (overlay, "group spread", no ranks) | 3 | 2 | 3 | 3 | Prototype only, with the guardrails in §7; do not ship a ranked version |
| 8 | **Clubs and adult-learner groups** (a group code, group aggregate only) | 2 | 2 | 3 | 2 | Defer; the workplace-misuse path is hard to close |
| 9 | **"People like me" norms** (by age band etc.) | 3 | 2 | 1 | 2 | Not now; the current notice forbids it and self-selected norms mislead |
| — | **Public leaderboards, rankings, a single score** | 1 | 1 (against) | 4 | 1 | Do not build (DESIGN §9, CLAUDE.md, and the evidence) |
| — | **Sustainability**: open source, donations, small grants; no ads, no data sales | — | — | — | — | Recommended model (§10) |

**What to do first, in order:**

1. **Close the misuse door before adding anything social** (cross-cutting, §11): a share-card footer that says the card is self-reported and not valid for selection, terms that forbid using results for hiring, admissions, insurance or credit and forbid asking anyone for them, and no "verified" or signed export meant for third parties. The privacy notice already says the save file is "not valid for decisions about hiring, admissions, grades or anything like them"; the share card does not yet carry that.
2. **Write the open-data consent now, use it later.** The current notice gives consent for scoring and for improving the questions only. Publishing anything at row level is a new purpose and needs a separate, unticked opt-in that says published rows cannot be recalled. Collect that opt-in from launch so the dataset is not empty when it is ready. Sessions without it are never released at row level.
3. **Publish the procedural item parameters and the difficulty model** (idea 2) when the first calibration run replaces a prior (from 100 answers per item, DESIGN §6.iii).
4. **Launch "What we learned"** with two or three pre-registered questions the data can answer at modest N (idea 1).
5. **Ship "Guess your blob"** (idea 3) and the **daily puzzle** (idea 4) as the fun layer, since both work without comparing people with each other.
6. Revisit the research release (idea 5) and study modules (idea 6) when N reaches the thousands, with a short data-protection impact assessment written first.

**What not to do.** No leaderboards. No population norms from self-selected takers ("you are in the top 5% of adults"). No group-difference claims about protected groups. No "IQ points" translation anywhere, including the findings page. No research use that asks about health, diagnoses or medication (R-5.6.3 forbids it, and it would turn the data into special-category data). No advertising networks, because they would break the notice's promise that network addresses are not linked to answers.

---
## 0. What HumanBench's data can and cannot support

This section fixes the facts each idea below is checked against.

- **What is stored** (`copy.ts`, DESIGN §12): per session, under a random `hb_` identifier, the counted answers with response times, optional confidence, coarse device details (class, input type, system and browser family, window size, refresh rate, timer precision), the questions shown and when, the server's scores, and integrity checks. The timed tasks (Reaction Time, Working Memory, Processing & Reading Speed) stay on the device unless the person backs up the save file; only a per-skill estimate with its uncertainty may be sent. Two optional questions (age group; English as first language) are stored apart from the answers. No name, email or network address is stored with answers.
- **What the consent covers.** The notice says answers are kept "to improve the questions" and the survey answers are "used only to check that the questions are fair" and are "never shown with your results". Consent is the legal basis. **Any new purpose below (publishing, research studies, comparisons by age group) is outside that consent** and needs either a notice change for future sessions or a separate opt-in. Sessions already collected stay under the old terms [INF].
- **Deletion has a known gap.** Sessions older than 30 days are copied into an encrypted archive keyed by session code, which deletion does not reach. A public release built from that archive would include people who later asked to be deleted. Any release must be built from the live database after deletions, or must honour a deletion list [INF].
- **Precision.** One session gives SE ≈ 0.55σ per axis; about five sessions give ≈ 0.30σ (DESIGN §7.6). Individual estimates are fuzzy; averages over many people are not. Correlations between axes need N ≥ 500 people with ≥ 3 items on both axes before Σ is re-estimated (DESIGN §3), percentiles need M4 linking and N ≥ 500 (ROADMAP A12), and an item's prior is replaced only from 100 answers (DESIGN §6.iii). As far as the docs show, none of these thresholds has been reached yet; the live project has been run by the owner and testers.
- **Who will take it.** Self-selected, English-reading adults on the web. Every precedent below found these samples skew young, educated and internet-heavy [OBS, Hartshorne & Germine 2015; Reinecke & Gajos 2015]. Their data are good for *within-sample structure* (how skills relate, how practice and confidence behave) and poor for *population levels* ("the average adult scores X").
- **What may never be published.** CLAUDE.md: no answer keys, `item_keys` data, service-role keys or finite-bank items in the public repo. Procedural generators are public already. So anything item-level that is published is limited to the procedural families; finite banks can appear only as axis-level summaries.

---

## 1. A public "What we learned" page (rank 1)

**What it is.** A page on the site, updated a few times a year, with short findings from everyone's pooled answers, each with its sample size, its uncertainty and the sentence "people who take HumanBench are a self-selected group, not a sample of all adults". Questions are written down (pre-registered) before the data are looked at, and results that come out null are posted too.

**Evidence and precedents.**
- Giving people their results, and the project's results, is how every large volunteer cognitive-testing project recruited. TestMyBrain promises "a copy of your personalized results to keep (or share!)" and has reached over 3.7 million participants in about 2,200 studies [PP, testmybrain.org]. LabintheWild's model is "personalized feedback in exchange for participation" and it replicated lab findings with comparable data quality [LAB, Reinecke & Gajos 2015].
- Web samples are good enough for within-sample findings. In Germine et al. (2012), uncompensated anonymous web samples "did not differ systematically" from lab samples on mean performance, variance and reliability, even for demanding tasks [LAB]. Hartshorne & Germine (2015) used 48,537 web participants to show that different abilities peak at different ages (processing speed in the late teens, working memory around 30, vocabulary around 50–65) [OBS]. That is the kind of finding a HumanBench page could report: it is about *structure*, not about any one person.
- The Cambridge Brain Sciences/"Great British Intelligence Test" run of 2010–2012 (over 100,000 participants) found at least three separable components (short-term memory, reasoning, verbal) [OBS, Hampshire et al. 2012, Neuron]. This is the closest precedent to HumanBench's multi-axis profile.
- **What went wrong there.** Press turned the 2012 paper into "measuring IQ by a single test is highly misleading" and "IQ is a myth"; a published comment argued the same data fit a higher-order g model [OP, Ashton, Lee & Visser 2014, with the authors' reply]. The 2020 GBIT COVID study (n = 84,285) was reported as "ten years of ageing" before peer review; experts pointed out that COVID status was self-reported, there was no pre-illness baseline, and reverse causation was possible [NEWS, Science Media Centre briefing; the paper is OBS, Hampshire et al. 2021, EClinicalMedicine]. Lesson: the translation into everyday units ("IQ points", "years of ageing") is what gets repeated, and it is exactly what HumanBench must not supply.

**What to build.**
- A bank job, `hb report public` (bank side), that computes only aggregates from `calibration_eligible` sessions of the published parameter set, and writes a small JSON file of numbers with N and intervals. A page in the public app renders it. Only the JSON of aggregates enters the public repo; no rows, no item IDs of finite banks.
- **First questions that need only hundreds of sessions** (all within-sample, none about groups of people):
  1. *How well does confidence track accuracy?* A calibration curve (proportion correct by confidence level), and whether people are overconfident on hard questions and underconfident on easy ones (the hard–easy effect). The server already computes Calibration (DESIGN §3 row 12, §7.1).
  2. *How far off are Fermi estimates, and do 80% intervals contain the truth 80% of the time?* (Median absolute log10 error; interval hit rate.)
  3. *How big are practice effects between sessions?* DESIGN §7.8 assumes about +0.33 SD; measuring it is useful to the project and to readers.
  4. *Touch versus keyboard reaction times* (the device effect the design already models).
- **Questions that need thousands:** the correlation matrix of the 16 axes in self-selected adults ("does knowing a lot go with reasoning well?"), drawn as a heat map with intervals; how Calibration relates to ability; how self-estimates relate to measured scores (from idea 3).
- **Publishing rules:** each reported cell has at least 20 people (suppress smaller cells); no breakdown by age group, language or any demographic (the survey's stated purpose is fairness checking only); no "IQ", no percentiles of "adults", no rankings; every figure shows its interval; the A13 language lint runs over the page; pre-registrations on OSF with a date before the analysis; nulls posted.

**Risks and safeguards.**
- *Overclaiming and press translation.* Safeguard: each post carries a "what this does not show" box, and the page never converts to IQ points or ages.
- *Small-cell disclosure.* Even aggregates can leak individuals when cells are tiny (NIH moved GWAS summary statistics behind controlled access after Homer et al. 2008 showed people could be detected in them) [OBS]. Safeguard: the k ≥ 20 rule, no cross-tabulations, and figures from at least a few hundred people.
- *Group-difference claims.* Not collected, not published.
- *Open disagreement is a feature.* GamesWithWords' "Which English?" quiz (669,498 participants, shared more than 300,000 times on Facebook) published its data on OSF; other researchers re-analysed it and disputed the conclusion, and the authors posted a reproducible rebuttal [OBS, Hartshorne, Tenenbaum & Pinker 2018; van der Slik et al. 2021]. A findings page backed by the Tier 0 numbers (idea 5) invites the same.
- *Claims regulation.* The FTC's 2016 settlement with Lumosity ($2 million; claims that games improve work or school performance or delay cognitive decline) shows where findings copy must not go: no transfer, improvement, health or protection claims [REG, FTC press release].

**Cheap test.** Pre-register the calibration-curve question now (one paragraph on OSF). When 200 sessions with ten or more rated answers exist, publish one figure. Measure whether the page is visited and whether it brings people back (a single page counter with no identifier, or none at all).

---

## 2. Item parameters, generators and calibration code as a public good (rank 2)

**What it is.** A versioned, openly licensed release of what HumanBench learns about its *procedural* question families: for each family and generator version, the fitted difficulty and discrimination, the feature-to-difficulty regression (e.g. rotation angle and mirror distractors → b), expected solve times, and the calibration code. Item records already carry `"license": "CC BY 4.0 (HumanBench original)"` (DESIGN §12).

**Evidence and precedents.**
- **ICAR** set out to be a "public-domain measure" [OBS, Condon & Revelle 2014], and its response data are released CC0 on Harvard Dataverse (about 97,000 people, random subsets of 60 items) [DATA, doi:10.7910/DVN/AD9RVY]. But the item materials themselves are now under a scientific-use licence, "intended for academic use exclusively", with registration, to stop answers circulating [PP, icar-project.com]. So there is a gap: *no openly licensed, calibrated, generator-based ability item source* that anyone (including non-academics) can use. HumanBench's procedural families could fill part of it, because a generator produces unlimited new items and exposure stops mattering.
- **Open response data plus controlled item text** is an established split (ICAR, and Project Implicit's CC BY dataset of 2.36 million IAT sessions on OSF [DATA, Xu, Nosek & Greenwald 2014]). It matches the repository rule: generators public, finite banks private.
- Calibrating generated items from difficulty features is known to work only moderately (DESIGN §6.ii); publishing the fitted feature model with its error is itself useful evidence.

**What to build.**
- A `params/` release (in the public repo, or as a Zenodo/OSF deposit with a DOI) per published `param_version`: a CSV of procedural family × generator version × variant features → a, b, SE, n; a datasheet (what population, which sessions, what exclusions, which model); and the licence (CC BY 4.0 for parameters; the code already open).
- For finite banks: only axis-level distributions (how many items, the spread of b), never per-item rows. Item IDs of finite banks are not published, so nothing links back to the private bank.
- A citation file so that others who use it can cite it.

**Risks and safeguards.** Low. Publishing a generator's difficulty does not help anyone cheat, because the generator is already public and items are unlimited [INF]. The one real risk is that others use the parameters to build a *selection* test; the licence cannot forbid that if it is CC BY, but the datasheet should state that the parameters come from self-selected volunteers and have no validity evidence for selection.

**Cheap test.** Release v0 now with the authored priors only (labelled "prior, no data"), then replace it at the first calibration run that moves a parameter. Count downloads and citations after a year.

---

## 3. "Guess your blob": self-prediction, and a friend's prediction (rank 3)

**What it is.** Before the reveal (or at the very start), the person places a marker on each spoke for where they think they will land compared with other takers. After the reveal they see their guess next to the measured blob with its uncertainty band, and the spokes where they surprised themselves. Optionally they send a link so a friend can guess their blob; the comparison is shown only to the person.

**Why it fits.** It is social and playful without ranking anyone against anyone else: the comparison is between a person's *beliefs* and their *results*. It also extends the Calibration axis (confidence on single questions) to the level of whole skills.

**Evidence and precedents.**
- Self-estimates of ability are only moderately accurate: r = .33 across 41 studies and 154 effects [MA, Freund & Kasten 2012]. Accuracy is better when people rate themselves on a *relative scale against a stated comparison group* and for numerical ability, and worse for less familiar abilities such as reasoning speed. That is a direct design lesson (ask "compared with other HumanBench takers") and a ready-made research question: across 16 skills, where do people know themselves well and where not? No study has done this across this many skills in one sample, as far as this study found [INF].
- Social comparison with *better-performing others* lowers ability self-ratings and mood; "contrast was, by far, the dominant response", and ability estimates were the most affected domain [MA, Gerber, Wheeler & Suls 2018]. A self-versus-own-guess comparison avoids that mechanism.

**What to build.**
- On the device: 16 sliders on the blob frame (keyboard-accessible, with a "skip" per spoke), stored in the save file. A reveal panel "Where you surprised yourself": spokes where the guess lies outside the 90% interval, phrased neutrally ("higher than you guessed", "lower than you guessed"), never "you overrate yourself".
- Friend link: the guess form opens from a link that carries no results; the friend's guess comes back as a short code the person pastes in. No server is needed, and the friend never sees the results.
- For research (only with the opt-in of idea 5): the self-estimates as coarse enums sent with the session. This needs a notice change, because it is a new kind of data.

**Risks and safeguards.**
- A "lower than you guessed" spoke stings. Safeguard: emotion-axis lows are never highlighted (R-5.6.4 applies here too); show surprises in both directions; make the panel skippable.
- Friend guesses can be unkind or turn into a judgement of the person. Safeguard: the friend's guess is shown only to the person, and the person can delete it.
- Self-estimating before the test could change how people perform (a framing effect). The evidence that "this is diagnostic of ability" framing lowers scores is small and inflated by publication bias [MA, Flore & Wicherts 2015; Shewach, Sackett & Quint 2019]. Still, putting the guess *after* the test and *before* the reveal avoids the question.

**Cheap test.** A paper version with the owner and ten friends: guess, take a session, compare. Does the comparison panel get more attention (time, screenshots) than the plain reveal? Does anyone find it upsetting?

---

## 4. A daily puzzle with a spoiler-free share grid (rank 4)

**What it is.** One procedural puzzle a day (the same seed for everyone, e.g. one matrix, one series or one rotation), playable in a minute or two, unscored, with a share text in the Wordle style: squares for attempts and time, never the content.

**Evidence and precedents.** Wordle went from 90 players on 1 November 2021 to over 2 million weekly players by 9 January 2022, and about 1.2 million results were shared on Twitter in the first two weeks of January 2022. The share grid came from players, and it worked because it showed *how* you did without spoiling the puzzle. Its creator kept it to one puzzle a day to create scarcity [NEWS, Wikipedia "Wordle", secondary source]. Human Benchmark's short speed and memory games with per-test histograms show the appeal of quick tasks (DESIGN §2.3). There is no controlled evidence that daily puzzles improve learning or retention of a test site; this is a product bet [INF].

**What to build.** A `/daily` route using the public generators with a date-derived seed; a share string; a streak stored only on the device. Puzzles come from a "daily" variant of each family that is never served in scored sessions.

**Risks and safeguards.**
- *Practice effects.* Daily matrices are practice for the Matrix axis, and DESIGN §7.8 already models about +0.33 SD of retest gain. Safeguard: count daily plays in the save file and treat them as practice exposure in the practice model, or keep the daily puzzles to families that do not feed a scored axis.
- *Streak pressure.* Keep the streak on the device, never public, and never punishing (no "you lost your streak" warnings).

**Cheap test.** Ship a week of daily puzzles behind a hidden link and share it with a handful of people; count return visits on day 2 and day 7.

---
## 5. An opt-in research release in tiers (rank 5)

**What it is.** HumanBench's pooled answers made available to researchers, the way SAPA and Project Implicit did, but in tiers matched to how identifying each kind of data is.

**Evidence and precedents.**
- **SAPA/ICAR**: about 97,000 people's ICAR responses (2010–2013) released CC0 on Harvard Dataverse, with codebook and scoring key [DATA]. SAPA gave each visitor a random subset of a large item pool, so covariances were estimable from many partial responders ("synthetic aperture") [PP, sapa-project.org; OP]. The SAPA site itself has since closed.
- **Project Implicit**: 2,355,303 completed Race IATs (2002–2012) on OSF under CC BY 4.0, with no names or emails, US ZIP codes recoded to state and county, and non-US postcodes dropped [DATA, Xu, Nosek & Greenwald 2014].
- **Open-Source Psychometrics Project** publishes 40+ row-level CSVs with item responses, age, gender, country, sometimes race, native language and timestamps, after an end-of-test confirmation and with no licence or use agreement shown [PP, openpsychometrics.org/_rawdata]. It is a widely cited resource, and also an example of what HumanBench should not copy: rows like that are plausibly unique [INF].
- **High-dimensional rows are fingerprints.** 15 demographic attributes re-identify 99.98% of Americans in a dataset, and sampling does not make a release GDPR-anonymous [OBS, Rocher, Hendrickx & de Montjoye 2019]. A few movie ratings with approximate dates de-anonymised Netflix Prize records by linkage to public IMDb profiles [LAB, Narayanan & Shmatikov 2008]. ZIP, sex and birth date alone made about 87% of the 1990 US population unique [OBS, Sweeney 2000].
- **Controlled access** is the norm for individual-level data in genetics: dbGaP grants it after a Data Access Committee review and a data-use certification that forbids identifying participants [REG/agency page]; UK Biobank requires registered researchers and a transfer agreement [PP, not re-fetched].
- **Consent wording.** The Open Brain Consent template, written for open neuroimaging data, says plainly that data already shared "cannot be destroyed, withdrawn or recalled" and that linking with other data could "potentially associate" the record back to the person [OP, template]. Under GDPR, consent must be freely given and as easy to withdraw as to give, and bundling it with use of the service undermines "freely given" (Art. 7(3), 7(4)) [REG].

**The HumanBench-specific threat** [CALC/INF]. The share card shows the person's blob, i.e. the posterior means of every axis they did not hide, plus the number of sessions and an SE (DESIGN §9.9). Anyone who sees a card, and has a row-level release with per-person axis estimates, can match the card to its row by nearest neighbour on ten or more continuous values. With 16 axes even coarsened to half-SD bins over ±3 SD there are about 12^16 ≈ 2 × 10^17 cells, so at any realistic N almost every row is unique. The match would then reveal what the person *chose to hide*: hidden axes (for example a low Emotion Reading score, which R-5.6.4 keeps off cards), the survey answers, device details and session times. Everyone who posts a card would be exposed. So **per-person profiles must never be published at row level**, even "anonymised".

**What to build.**
- **Tier 0, public, CC0:** aggregates only, with small cells suppressed (k ≥ 20): per-axis distributions, the correlation matrix with intervals, practice-effect estimates, calibration curves. This is the data behind idea 1. Optionally computed with differential privacy (OpenDP is an open-source library [PP]); the US Census used DP for 2020 but found real utility costs and the need to fix a privacy budget in advance [OBS, Abowd 2018; Garfinkel et al. 2018], so at hobby scale simple suppression and coarsening are adequate [INF].
- **Tier 1, by click-through agreement, from opted-in sessions only:** item-level responses to *procedural* items, split by axis. Each released row holds one person's answers on **at most three axes**, with a fresh random row ID per row, no timestamps (month only), device class only, no survey answers, scores top-coded at ±2 SD. This is SAPA's planned-missingness idea used as a privacy tool: every axis pair still appears together in some rows, so researchers can estimate Σ, but no row carries enough of a profile to match a share card [INF; the uniqueness of three coarsened axes at a given N should be checked by simulation before release]. The agreement forbids re-identification, linkage with other data and any selection or diagnostic use, and asks for citation. It is not a real access committee, but it creates a record and a contractual hook [INF].
- **Never:** raw trial-level reaction-time streams with device details, exact timestamps, the `hb_` identifier or any session code, finite-bank items or their IDs, survey answers joined to scores.
- **Consent.** A separate, unticked choice on the consent screen (or at the end of the reveal): "Also let my answers be part of a public research dataset", with three plain sentences: what is published (as above), that published copies cannot be recalled though future releases stop, and that re-identification is unlikely but not impossible. The current notice and `TERMS_VERSION_SERVER` need a new version; only sessions with the opt-in, built from the live database after deletions (not from the 30-day archive deletion does not reach), are released.
- **A short data-protection impact assessment first.** Cognitive results are not health data in themselves, but GDPR covers data that "reveal information relating to ... mental health status" (Recital 35), the CJEU read special categories broadly to include data that disclose them indirectly (C-184/20, 2022), and Washington's My Health My Data Act covers health status "derived or extrapolated from non-health information", applies to anyone whose data are collected in Washington, and gives a private right of action [REG; the helper's reading, not legal advice]. A low memory or speed score tracked over time could be read as revealing a health state. Treat the data as possibly special category: explicit consent for research use, no sharing or sale, a short written impact assessment (GDPR Art. 35) before the first release [INF]. HIPAA does not apply to a direct-to-consumer app [REG, HHS, not re-fetched].

**What went wrong elsewhere.** The myPersonality dataset (Cambridge, millions of consented Facebook quiz takers) was shared with registered researchers under limited protections; a working login for it sat in a public GitHub repository for years, and Facebook banned the app in 2018 for sharing with "researchers as well as companies with only limited protections in place" [PP, Meta newsroom; NEWS, New Scientist, not re-fetched]. In 2016 researchers scraped 68,371 OkCupid profiles and posted them on OSF as "already public"; the data came down after a copyright claim and a Danish data-protection investigation followed [NEWS, secondary]. Lessons: sharing with "registered researchers" is still a release; credentials never go in a repo (CLAUDE.md already forbids service-role keys); "public" is not the same as "fair to republish".

**Risks and safeguards.** Summarised above: re-identification by share-card linkage (axis-split rows), deletion gaps (release from the live database), purpose creep (separate consent), misuse for selection (agreement and datasheet). A further risk is that a dataset of 16-axis profiles invites *group-difference* papers by others; HumanBench collects no protected characteristics, and the release should carry none.

**Cheap test.** Simulate first: generate synthetic profiles at N = 2,000 and 10,000 from the prior Σ, build the Tier 1 split, and measure how often a simulated share card (10 or more visible axes) matches its rows uniquely. Write the consent text and the impact assessment. Release Tier 0 only, and Tier 1 only after the simulation shows a match rate near chance.

---

## 6. Citizen-science study modules (rank 6)

**What it is.** Short optional add-ons (5–10 minutes) run as pre-registered studies with one clear question. The good candidates are *experiments on the test itself*, randomised within HumanBench, which need no new personal data: "Does a worked example before a logic game change accuracy?", "Does seeing the confidence scale change how fast you answer?", "Does doing the hard parts first change how tired people say they feel at the end?". Poor candidates ask about the person's life or body ("Does sleep change your reaction time?" is health-adjacent) or invite group claims ("Do fiction readers score higher on Emotion Reading?").

**Evidence and precedents.** LabintheWild ran many such studies on volunteers with personalised feedback as the only reward and replicated lab results [LAB, Reinecke & Gajos 2015]. TestMyBrain has hosted about 2,200 studies [PP]. Many Labs 2 (15,305 participants, 125 samples, 36 countries) showed the value and the sobering results of pre-registered large-sample replications: median effect d 0.15 against 0.60 originally [OBS, Klein et al. 2018]. Volunteer platforms are well suited to such replications [INF].

**What to build.** A module slot after the reveal; a study registry page listing each study, its pre-registration and its result; random assignment done on the device and recorded with the session; results posted to the "What we learned" page. Partner with a university researcher for anything meant for a journal, since journals expect ethics review, which a hobby project cannot provide itself [INF].

**Risks and safeguards.** Per-study consent; no health, diagnosis or medication questions (R-5.6.3); no demographic questions beyond the existing two, and those only for fairness checks unless the notice changes; studies that change the scored session (e.g. item order) must be ones the scoring model handles, or must be outside the scored part.

**Cheap test.** One within-HumanBench experiment that needs no new data: randomise whether the confidence scale is shown on a block and measure the effect on response time and accuracy. It informs the design and is a one-paragraph pre-registration.

---

## 7. Private friend or group blobs (rank 7)

**What it is.** Two or more people who choose to compare see their blobs overlaid, or a "group spread" view (on each spoke, the range across the group), with no ranks, no totals and every person's uncertainty band shown.

**Evidence.**
- Against: comparing with better others on *ability* mostly lowers self-ratings and mood, with ability the most affected domain [MA, Gerber, Wheeler & Suls 2018]; upward comparison on social media lowers self-evaluation and emotion, g = −0.24 over 118 experimental effects [MA, McComb et al. 2023]; passive scrolling makes comparison more frequent [OP, Verduyn et al. 2020].
- Mixed: gamification has small positive effects overall, and competition worked best combined with collaboration [MA, Sailer & Homner 2020]. In a survey on leaderboards, a person's rank strongly shaped how they felt about the leaderboard and the app, and leaderboards were least liked in social-networking contexts [OBS, Jia et al. 2017]. In physical-activity apps social comparison "may motivate ... for some people under some circumstances", and results are inconsistent [MA, Arigo et al. 2020 scoping meta-review].
- So the evidence supports *collaborative* framing (what the group covers together) over *competitive* framing (who is ahead) [INF].

**What to build (if prototyped).** Entirely on the device: each person exports a short "compare code" holding only the axes they choose (means and SDs, no session data), and the overlay is drawn locally. Views: "what we cover together" (the group's best spoke per axis, unlabelled by person) and "where we differ most". Axes where two people's intervals overlap are drawn as "about the same". No person-by-person list ordered by anything. Emotion-axis lows never highlighted. The friend-guess feature of idea 3 is the safer version of the same wish and should come first.

**Risks and safeguards.** Social pressure to share (a partner, a parent, a manager asking for the code). Safeguards: the code is opt-in per axis, the copy says "nobody should ask you for this", and there is no group of more than a handful of people (to keep it from becoming a team-assessment tool; see idea 8 and §11).

**Cheap test.** A paper or screenshot mock with three or four friend pairs, asking afterwards how each person felt; stop if people report feeling worse.

---

## 8. Clubs and adult-learner groups (rank 8)

**What it is.** A group code for a quiz league, a book club, an adult evening class or a puzzle society, so the group sees its *aggregate* (the group's spread per axis, only when at least five people have joined) and nobody sees individuals.

**Evidence.** No direct evidence was found for this use [INF]. TestMyBrain offers a "Cognitive Science Toolkit" to educators [PP], which shows demand for teaching use. Classroom use is ruled out for minors by the 18+ gate; adult learners are allowed.

**Why it ranks low.** The same feature works for a workplace team, and an employer asking staff to join a group code is the misuse path described in §11. US law treats employment tests with disparate impact as unlawful unless job-related and consistent with business necessity (*Griggs v. Duke Power*, 1971; EEOC guidance, including the *EEOC v. Ford* settlement over a verbal, numerical and spatial reasoning test) [REG]. The EU AI Act lists systems intended for recruitment or for evaluating learning outcomes as high-risk (Annex III points 3 and 4); high-risk status follows the provider's *intended* purpose [REG]. A group feature makes that intended purpose harder to keep clean.

**If built.** Aggregates only, k ≥ 5 with the same suppression as idea 1; no organiser view of individuals; terms that forbid workplace, school-admission or assessment use; the group page carries the non-diagnostic disclaimer. A safer substitute is a **teaching pack**: the public "What we learned" figures, the open generators and the worked solutions, for adult classes to discuss how skills relate, with nobody's results involved.

**Cheap test.** Offer the teaching pack (no data) to one adult-learning group or puzzle club and see whether they want anything more.

---

## 9. "How do I compare with people like me?" (rank 9)

**What it is.** Norms split by age group (or other traits), shown next to the person's result.

**Why not now.**
- The notice says the survey answers are "used only to check that the questions are fair" and are "never shown with your results". Using them for norms needs a notice change.
- Percentiles even against *all* takers wait for M4 linking and N ≥ 500 (A12). Splitting by age group divides that further.
- Self-selected norms are biased in level: web volunteers skew young and educated [OBS, Hartshorne & Germine 2015]. "Compared with other HumanBench takers your age" is honest; "compared with people your age" is not.
- Age-group comparisons on speed and memory would show the expected decline with age and invite health readings ("is this normal for my age?"), which moves the data toward health data (§5) and toward the clinical language R-5.6.x forbids.
- The "vs other HumanBench takers" wording already exists and is held back by A12, which is the right first step.

**If revisited.** Only "other HumanBench takers", only after A12 allows it, with the sample size shown, only on the skills where self-selection matters least (within-sample relative standing), and never for the speed axes by age.

---
## 10. Sustainability without selling data

**Costs first.** HumanBench is designed to run on free tiers up to roughly 10^4 users, with a costed escalation path (DESIGN §11, §11.5). The money question is therefore small: covering a paid database tier if it grows, and perhaps a domain.

**Precedents.**
- *Donations work only at huge reach.* Wikimedia raised $170.5 million from over 17.4 million donations in 2023–24, an average gift of about $10, mostly from banners and email [PP, Wikimedia fundraising report]. OpenStreetMap's foundation lives mainly on donations and memberships, spent largely on servers [PP]. LabintheWild shows a donate banner [PP].
- *Academic and grant models.* TestMyBrain grew from a grant-funded lab into a nonprofit (Many Brains Project) that provides tools to researchers [PP]. ICAR is funded by research councils (NSF, DFG, ESRC) and a philanthropic fund [PP]. Zooniverse is hosted by universities and a planetarium [PP].
- *Commercial models carry claims pressure.* Cambridge Brain Sciences became a company; Lumosity's subscription model led to the FTC's deceptive-advertising settlement [REG]. 16Personalities is freemium (paid profiles and guides) [PP]. Open Psychometrics runs Google AdSense alongside its tests [PP, its privacy policy].
- *Ads and results pages do not mix.* The FTC acted against GoodRx and BetterHelp in 2023 for sharing health information with advertisers through tracking pixels [REG, not re-fetched]. HumanBench's notice promises network addresses are not linked to answers; an ad network on the results page would break that promise in practice [INF].

**Recommended model** [INF]:
1. Keep the free-tier architecture; publish the monthly cost on the site.
2. GitHub Sponsors (no fee on sponsorships from personal accounts [PP, GitHub docs]) or Open Collective (a fiscal host with a public ledger [PP]), linked from the "What we learned" page and shown *after* results, never as a gate.
3. A small grant, if one fits. NLnet's NGI Zero funds give €5,000–50,000 to individuals for open-licensed work (next deadline 3 November 2026) but say they are "not interested in AI-generated projects or proposals" [PP, nlnet.nl]; a proposal would have to be the owner's own work and words and make the human role clear. A university partner (for norming or citizen-science studies, ideas 5–6) is the more realistic route to research funding and would also bring ethics review.
4. A public pledge on the about page: no sale or licensing of row-level data, no advertising or tracking pixels on test or results pages, no access for employers, insurers or schools.
5. Do not sell premium reports. A paid "full report" creates exactly the pressure toward stronger claims that the FTC targeted and that R-5.6.x and the no-single-score rule forbid.

One side finding: the name is close to humanbenchmark.com, an existing, popular site of short cognitive tests with global percentiles. DESIGN §2.6 already flags the collision; a name check before any public launch or grant application is worth doing [INF].

---

## 11. Cross-cutting safeguard: close the misuse door first

Every social or collective feature makes results more visible, and visible cognitive scores attract high-stakes uses. This section applies to all ideas above.

**The legal picture** (a reading of guidance, not legal advice).
- *Employment, US.* Tests that disproportionately exclude people by race, sex or other protected characteristics are unlawful unless job-related and consistent with business necessity; *Griggs v. Duke Power* (1971) struck down general intelligence tests used without that showing, and the EEOC cites a settlement with Ford over a reasoning test with disparate impact [REG]. An employer asking candidates for their HumanBench profile would be using an unvalidated cognitive test, the textbook case [INF]. Under the ADA, a test is a medical examination when it provides evidence that would lead to identifying a mental disorder or impairment; HumanBench's non-diagnostic framing keeps it on the non-medical side, and any "impaired" or "below normal" wording would move it [REG]. New York City's Local Law 144 adds bias-audit duties for automated employment decision tools [REG, not re-fetched].
- *EU.* AI systems intended for recruitment, admission or evaluating learning outcomes are high-risk (AI Act Annex III), and status follows the provider's intended purpose [REG]. The AI Act's ban on inferring emotions in workplaces and schools (Art. 5(1)(f)) covers systems working on biometric data (Art. 3(39)); HumanBench's Emotion Reading axis scores answers to written scenarios and does not infer the taker's emotions, so it is outside that ban as long as it never uses a camera or voice [REG; INF].
- *Insurance.* The US genetic non-discrimination law (GINA) covers genetic information only, not cognitive test results, and not life or long-term-care insurance [REG, not re-fetched]. Cognitive screens are used in some underwriting of older applicants [unverified].

**What to build** [INF]:
- **Share-card footer**, always drawn and not removable: "Self-reported puzzle results. Not valid for hiring, admissions or any decision about a person." (The notice already says this about save files; the card is the thing people actually see.) It must pass the A13 lint.
- **Terms**: no use of results, cards, save files or group codes for employment, admissions, grading, insurance, credit, housing or legal decisions, and no asking anyone to take HumanBench or disclose results as a condition of anything.
- **No verified export.** The server signs sessions so a save file can prove integrity to the *person's own* app (DESIGN §8). Do not build a public "verify this card" page or a signed PDF: an unverifiable result has little evidential value, and that is a feature here.
- **No public profile URLs** and no API that returns a person's profile by identifier.
- **Language.** No "IQ", no "impaired", no "for your age" on any surface (R-5.6.x, A13), and no webcam or microphone input ever.

---

## 12. Why not leaderboards

Leaderboards are the most-requested social feature in game-like sites, and the one this study recommends against without qualification.
- They require a single score or a single axis ranked across people, which DESIGN §9 and CLAUDE.md forbid ("never show total area or a single score").
- Social comparison on ability mostly lowers self-ratings and mood [MA, Gerber et al. 2018]. In a 16-week course, adding a leaderboard and badges lowered students' intrinsic motivation and satisfaction over time, and their final exam scores were lower than the comparison group's [LAB, Hanus & Fox 2015, not re-fetched]. Leaderboards act much like assigned difficult goals, so the benefit comes from the goal, not the ranking [LAB, Landers et al. 2017, not re-fetched], and points and leaderboards raised quantity of output without raising intrinsic motivation [LAB, Mekler et al. 2017, not re-fetched].
- The top of any public ranking of timed web tasks fills with scripted input, repeated attempts and hardware advantages [INF; no peer-reviewed source found for cognitive-test sites]. HumanBench's integrity checks are meant to keep data clean for calibration, not to adjudicate a contest.
- A per-axis estimate with SE 0.55σ cannot order people reliably: two people one SE apart overlap heavily [CALC].

**What to offer instead.** "You over time" (the blob's history across sessions, already planned in §7.8 and §10), personal bests on the speed games stored on the device (as Human Benchmark shows per-test histograms [PP]), the daily puzzle (idea 4) and the self-prediction game (idea 3).

---

## 13. Requirements this would touch (for the owner, if approved)

None of this changes code now. If ideas are approved, these are the places they land:
- **Privacy notice and `TERMS_VERSION_SERVER`**: a separate research-release opt-in (idea 5), self-estimates if sent (idea 3), study-module consent (idea 6), the no-ads and no-sale pledge (§10), terms forbidding high-stakes use (§11).
- **DESIGN §9.9 / ROADMAP M1.18**: the share-card footer (§11).
- **DESIGN §13**: a short data-protection impact assessment before any row-level release; the release-from-live-database rule (deletion gap, §0).
- **A12** stays as it is for norms (idea 9); idea 1's publishing rules (k ≥ 20, no demographic breakdowns) would be new requirements.
- **R-5.6.x and A13** apply unchanged to the findings page, the daily puzzle share text and any group view.

---

## Source table

| # | Source | Type | Used for | URL |
|---|---|---|---|---|
| 1 | Germine et al. 2012, "Is the web as good as the lab?", Psychon Bull Rev 19:847 | LAB | Web samples match lab on means, variance, reliability | https://doi.org/10.3758/s13423-012-0296-9 |
| 2 | Hartshorne & Germine 2015, "When does cognitive functioning peak?", Psych Science 26:433 | OBS | 48,537 web participants; abilities peak at different ages; self-selection limits | https://pmc.ncbi.nlm.nih.gov/articles/PMC4441622/ |
| 3 | TestMyBrain home page | PP | 3.7M participants, 2,200 studies; "personalized results to keep (or share!)"; educator toolkit | https://www.testmybrain.org/ |
| 4 | Many Brains Project | PP | TestMyBrain's nonprofit model | https://www.manybrains.net/ |
| 5 | Hampshire, Highfield, Parkin & Owen 2012, "Fractionating human intelligence", Neuron 76:1225 | OBS | ≥3 components in a large web sample | https://pubmed.ncbi.nlm.nih.gov/23259956/ |
| 6 | ScienceDaily release on Hampshire et al. 2012 | NEWS | >100,000 participants; "IQ ... highly misleading" framing | https://www.sciencedaily.com/releases/2012/12/121219133334.htm |
| 7 | Ashton, Lee & Visser 2014 comment, and Hampshire et al. reply, PAID | OP | Higher-order g fits the same data | https://doi.org/10.1016/j.paid.2013.10.032 ; https://doi.org/10.1016/j.paid.2013.11.013 |
| 8 | Hampshire et al. 2021, "Cognitive deficits in people who have recovered from COVID-19", EClinicalMedicine 39:101044 | OBS | n = 84,285 GBIT participants | https://doi.org/10.1016/j.eclinm.2021.101044 |
| 9 | Science Media Centre, expert reaction to the GBIT COVID preprint | NEWS | Self-report, no baseline, reverse causation, press before peer review | https://www.sciencemediacentre.org/expert-reaction-to-preprint-suggesting-patients-who-recovered-from-covid-19-could-suffer-serious-cognitive-decline/ |
| 10 | Condon & Revelle 2014, "The International Cognitive Ability Resource", Intelligence 43:52 | OBS | ICAR as a public-domain measure | https://doi.org/10.1016/j.intell.2014.01.004 |
| 11 | "Selected ICAR data from the SAPA-Project", Harvard Dataverse, CC0 | DATA | ~97,000 people, random 60-item subsets | https://doi.org/10.7910/DVN/AD9RVY |
| 12 | ICAR project site and PsychArchives licence | PP | Items for academic use only, registration; individual results "with great care" | https://icar-project.com/ ; https://www.psycharchives.org/en/item/7466aa16-69bd-49ea-baef-7f828f5b223f |
| 13 | SAPA project site | PP | Planned-missing design; project closed | https://www.sapa-project.org/ |
| 14 | Reinecke & Gajos 2015, "LabintheWild", CSCW | LAB | Feedback-for-participation; replications with comparable quality | https://doi.org/10.1145/2675133.2675246 |
| 15 | LabintheWild site | PP | Comparison framing; donate banner | https://www.labinthewild.org/ |
| 16 | Project Implicit test page | PP | Disclaimers on individual feedback; data made public without identifiers | https://implicit.harvard.edu/implicit/takeatest.html |
| 17 | Xu, Nosek & Greenwald 2014, Race IAT data, J Open Psychology Data | DATA | 2.36M sessions on OSF, CC BY 4.0, geography coarsened | https://doi.org/10.5334/jopd.ac |
| 18 | Oswald et al. 2013, JPSP | MA | IAT poor predictor; caution about individual verdicts | https://doi.org/10.1037/a0032734 |
| 19 | Klein et al. 2018, Many Labs 2, AMPPS | OBS | 15,305 participants; replication effects much smaller | https://doi.org/10.1177/2515245918810225 |
| 20 | Hartshorne, Tenenbaum & Pinker 2018, Cognition 177:263 | OBS | "Which English?" 669,498 participants, shared 300,000+ times, data on OSF | https://doi.org/10.1016/j.cognition.2018.04.007 |
| 21 | van der Slik et al. 2021, Language Learning; Hartshorne et al. rebuttal | OBS / OP | Open data invited re-analysis and rebuttal | https://doi.org/10.1111/lang.12470 ; https://doi.org/10.31234/osf.io/bvjys |
| 22 | Meta newsroom, app investigation update, 22 Aug 2018 | PP | myPersonality banned for sharing with limited protections | https://about.fb.com/news/2018/08/update-on-app-investigation/ |
| 23 | New Scientist, 14 May 2018, myPersonality exposure | NEWS (not re-fetched) | Login left in a public repo; re-identification concerns | https://www.newscientist.com/article/2168713-huge-new-facebook-data-leak-exposed-intimate-details-of-3m-users/ |
| 24 | Kosinski, Stillwell & Graepel 2013, PNAS | OBS | Sensitive traits predictable from digital records | https://doi.org/10.1073/pnas.1218772110 |
| 25 | OkCupid scrape coverage (Wired, May 2016; Wikipedia "OkCupid") | NEWS (secondary) | 68,371 profiles posted on OSF; takedown | https://www.wired.com/2016/05/okcupid-study-reveals-perils-big-data-science/ ; https://en.wikipedia.org/wiki/OkCupid |
| 26 | FTC, Lumosity settlement, 5 Jan 2016 | REG | $2M; unsupported cognitive-benefit claims | https://www.ftc.gov/news-events/news/press-releases/2016/01/lumosity-pay-2-million-settle-ftc-deceptive-advertising-charges-its-brain-training-program |
| 27 | Human Benchmark statistics page | PP (not readable by fetcher) | Per-test histograms from site users | https://humanbenchmark.com/tests/reactiontime/statistics |
| 28 | Wikipedia, "Wordle" | NEWS (secondary) | 90 → 2M+ weekly players; spoiler-free grid; one puzzle a day | https://en.wikipedia.org/wiki/Wordle |
| 29 | Freund & Kasten 2012, "How smart do you think you are?", Psych Bull | MA | Self-estimates r = .33; better on relative scales and numerical ability | https://doi.org/10.1037/a0026556 |
| 30 | Gerber, Wheeler & Suls 2018, Psych Bull | MA | Comparison mostly contrast; ability most affected | https://doi.org/10.1037/bul0000127 |
| 31 | McComb et al. 2023, Media Psychology | MA | Upward comparison on social media g = −0.24 | https://doi.org/10.1080/15213269.2023.2180647 |
| 32 | Verduyn et al. 2020, Curr Opin Psychol | OP | Passive use raises comparison | https://doi.org/10.1016/j.copsyc.2020.04.002 |
| 33 | Sailer & Homner 2020, Educ Psychol Rev | MA | Small gamification effects; competition plus collaboration | https://doi.org/10.1007/s10648-019-09498-w |
| 34 | Hanus & Fox 2015, Computers & Education | LAB (not re-fetched) | Leaderboard course: lower motivation and exam scores | https://doi.org/10.1016/j.compedu.2014.08.019 |
| 35 | Landers, Bauer & Callan 2017, Computers in Human Behavior | LAB (not re-fetched) | Leaderboards work like difficult goals | https://doi.org/10.1016/j.chb.2015.08.008 |
| 36 | Mekler et al. 2017, Computers in Human Behavior | LAB (not re-fetched) | Points/leaderboards raise quantity, not intrinsic motivation | https://doi.org/10.1016/j.chb.2015.08.048 |
| 37 | Jia et al. 2017, "Designing Leaderboards for Gamification", CHI | OBS | Rank shapes perception; least liked in social contexts | https://doi.org/10.1145/3025453.3025826 |
| 38 | Arigo et al. 2020, JMIR mHealth, scoping meta-review | MA | Social comparison in activity apps: inconsistent effects | https://doi.org/10.2196/15642 |
| 39 | Flore & Wicherts 2015, J School Psychol | MA | Stereotype threat d = −0.22 with publication bias | https://doi.org/10.1016/j.jsp.2014.10.002 |
| 40 | Shewach, Sackett & Quint 2019, J Appl Psychol | MA | Stereotype threat negligible to small in operational settings | https://doi.org/10.1037/apl0000420 |
| 41 | Rocher, Hendrickx & de Montjoye 2019, Nature Communications | OBS | 15 attributes re-identify 99.98% | https://doi.org/10.1038/s41467-019-10933-3 |
| 42 | Narayanan & Shmatikov 2008, IEEE S&P | LAB | Netflix Prize de-anonymisation by linkage | https://doi.org/10.1109/SP.2008.33 |
| 43 | Sweeney 2000 working paper; Sweeney 2002 (k-anonymity) | OBS | 87% unique on ZIP, sex, birth date | https://dataprivacylab.org/projects/identifiability/paper1.pdf ; https://doi.org/10.1142/S0218488502001648 |
| 44 | Homer et al. 2008, PLoS Genetics | OBS (not re-fetched) | Individuals detectable in summary statistics | https://doi.org/10.1371/journal.pgen.1000167 |
| 45 | Abowd 2018, KDD; Garfinkel et al. 2018 | OBS | Census DP deployment and its costs | https://doi.org/10.1145/3219819.3226070 ; https://doi.org/10.1145/3267323.3268949 |
| 46 | OpenDP | PP | Open-source DP library | https://opendp.org |
| 47 | GDPR Recital 35; Art. 7; Art. 35 | REG | Health data scope; consent conditions; impact assessments | https://gdpr-info.eu/recitals/no-35/ ; https://gdpr-info.eu/art-7-gdpr/ ; https://gdpr-info.eu/art-35-gdpr/ |
| 48 | CJEU C-184/20, OT v Vyriausioji tarnybinės etikos komisija, 2022 | REG (not re-fetched) | Indirect disclosure of special categories | https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62020CJ0184 |
| 49 | Washington My Health My Data Act, RCW 19.373.010 | REG | "Consumer health data" incl. inferred data; scope | https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.010 |
| 50 | Colorado HB24-1058; California SB 1223 (2024) | REG (SB 1223 not re-fetched) | "Neural data" defined as nervous-system measurement | https://leg.colorado.gov/bills/hb24-1058 ; https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=202320240SB1223 |
| 51 | HHS, HIPAA covered entities | REG (not re-fetched) | HIPAA does not reach a direct-to-consumer app | https://www.hhs.gov/hipaa/for-professionals/covered-entities/index.html |
| 52 | EEOC, employment tests and selection procedures; Griggs v. Duke Power, 401 U.S. 424 | REG | Disparate impact; Ford reasoning-test settlement | https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures ; https://supreme.justia.com/cases/federal/us/401/424/ |
| 53 | EEOC, pre-employment disability-related questions and medical exams | REG | When a psychological test is a medical exam | https://www.eeoc.gov/laws/guidance/enforcement-guidance-preemployment-disability-related-questions-and-medical |
| 54 | NYC Local Law 144 (AEDT) | REG (not re-fetched) | Bias audits for automated hiring tools | https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page |
| 55 | EU AI Act Annex III; Art. 5; Art. 3 | REG | High-risk uses; emotion-inference ban scope | https://artificialintelligenceact.eu/annex/3/ ; https://artificialintelligenceact.eu/article/5/ ; https://artificialintelligenceact.eu/article/3/ |
| 56 | EEOC, genetic information discrimination (GINA) | REG (not re-fetched) | GINA covers genetic information only | https://www.eeoc.gov/genetic-information-discrimination |
| 57 | Open Brain Consent template | OP | Irreversibility and residual-risk wording | https://open-brain-consent.readthedocs.io/en/stable/ultimate.html |
| 58 | dbGaP, about | REG/agency | Controlled access with data-use certification | https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/about.html |
| 59 | UK Biobank, apply for access | PP (not re-fetched) | Registered researchers, transfer agreement | https://www.ukbiobank.ac.uk/enable-your-research/apply-for-access |
| 60 | Open-Source Psychometrics raw data page; privacy policy | PP | Row-level data with demographics, no licence; AdSense | https://openpsychometrics.org/_rawdata/ ; https://openpsychometrics.org/privacy_policy |
| 61 | Wikimedia Fundraising 2023–24 report | PP | $170.5M from 17.4M donations | https://meta.wikimedia.org/wiki/Fundraising/2023-24_Report |
| 62 | OpenStreetMap Foundation finances | PP | Donations and memberships fund servers | https://osmfoundation.org/wiki/Finances |
| 63 | Zooniverse team page | PP | University and planetarium hosting | https://www.zooniverse.org/about/team |
| 64 | NLnet, how to propose | PP | €5k–50k; "not interested in AI-generated projects or proposals" | https://nlnet.nl/propose/ |
| 65 | GitHub Sponsors docs | PP | No fee on personal-account sponsorships | https://docs.github.com/en/sponsors/getting-started-with-github-sponsors/about-github-sponsors |
| 66 | Open Source Collective | PP | Fiscal host with public ledger | https://www.oscollective.org/ |
| 67 | 16Personalities terms | PP | Freemium model | https://www.16personalities.com/terms |
| 68 | FTC, GoodRx enforcement, Feb 2023 | REG (not re-fetched) | Pixel sharing of health information | https://www.ftc.gov/news-events/news/press-releases/2023/02/ftc-enforcement-action-bar-goodrx-sharing-consumers-sensitive-health-info-advertising |

HumanBench documents cited: `docs/DESIGN.md` §2.3, §3, §6.ii–§6.iii, §7.6, §7.8, §8, §9, §10, §11, §12, §13, R-5.6.1–R-5.6.5; `docs/ROADMAP.md` A12, A13, M1.R, M1.18; `web/src/backend/copy.ts` (server privacy notice, survey lead, delete text); `docs/research/phase-ai-2-study.md`.
