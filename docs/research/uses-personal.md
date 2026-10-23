# What HumanBench results can do for the person who took the test

*Research study, 2026-10-22. Lens: uses that serve the person themselves (self-understanding, learning and practice, tracking change, goals, choosing resources, curiosity and enjoyment). Companion to `docs/research/phase-ai-2-study.md`, which found that turning results into AI prompt notes is weakly supported except for topic-knowledge depth. Scope: DESIGN §3, §7 (§7.6, §7.8), §9, §10, §13, R-5.6.x; ROADMAP M1.R, M1.Q, M4.7, M5.1, A23, AI.16. This document contains no item text, keys or bank data. It is a reading of the literature and of the current code, not a requirement. Any change to DESIGN or ROADMAP still needs the owner's approval.*

**Evidence labels** (as in the Phase AI Part 2 study): **MA** meta-analysis or systematic review; **RCT** randomised trial; **LAB** laboratory or online experiment that is not a full trial; **OBS** observational or big-data study; **OP** narrative review, framework or opinion; **REG** regulator action; **CALC** a derivation in this document from HumanBench's own numbers.

**Method and limits.** The session's web-search quota was used up, so sources were found through the OpenAlex and Crossref APIs and checked by DOI. Two helper passes compiled notes on learning science and on feedback and self-assessment. Most claims rest on abstracts and well-known summaries, not full texts; figures marked "verify" in the source table should be re-checked before they appear in user-facing copy (CLAUDE.md, DESIGN's [EST†] rule). The review is broad but not systematic.

---

## Executive summary

**The short answer.** The results are most useful to the person as *a mirror and a starting point*, not as a verdict or a lever. Three things have good evidence and fit the data HumanBench already has:

1. **Showing people how well they know what they know** (calibration). The app already collects confidence ratings and Fermi intervals and scores them on the server. Self-assessment of ability is poor on average (r ≈ .29 between self-ratings and performance across 22 meta-analyses), and calibration is one of the few metacognitive skills that improves with feedback and short training. This is the most distinctive thing HumanBench can give a person that a quiz site does not.
2. **Practice that is honest about what it trains.** Retrieval practice and spacing are the two best-supported learning techniques (Dunlosky et al. 2013 rated only these two "high utility"; testing beats restudy at g ≈ 0.5). HumanBench already generates unlimited procedural items with worked solutions. A practice mode can use them, but the evidence is equally clear that practice improves *the practised task and close relatives*, not general ability (far transfer from cognitive training is near zero). So practice is worth offering for quant topics a person wants to learn, and for fun on puzzle types, but never as "train your brain".
3. **Tracking change honestly.** People will retest and want to see change. The evidence on retest gains (+0.26 to +0.33 SD from practice alone) and HumanBench's own error bands mean that, for one axis, two single sessions must differ by about 1.3 SD before the change is more than noise (CALC, section 3). The useful product is a history view that *mostly says "no clear change"*, credits practice, and teaches regression to the mean. That is valuable precisely because almost no consumer test does it.

Things that sound good but are weak or hype: brain training (an FTC settlement and a 2016 consensus review), matching study methods to a "cognitive style" (learning styles; the meshing hypothesis has failed every proper test), growth-mindset messaging as a performance booster (d ≈ 0.05–0.10 in 2018–2023 meta-analyses), goals set on the score itself (Goodhart, practice effects), and course or career choices made from a one-hour profile.

**Ranked ideas.** Score = value to the person × strength of evidence × feasibility with the data HumanBench actually has × (inverse) risk. Each is rated High/Medium/Low; rank is the overall judgement, not an arithmetic product.

| Rank | Idea | Value to person | Evidence | Feasible with current data | Risk | Verdict |
|---|---|---|---|---|---|---|
| 1 | **Calibration mirror**: "how sure you were vs how often you were right", plus Fermi interval hit rate, with a short practice loop (§1) | High | Moderate–strong (self-assessment meta-synthesis; forecasting training RCT; calibration feedback studies) | **High**: CAL is scored now (DESIGN §7.1, M5.1 `state.fermi_intervals`) | Low | **Build first** |
| 2 | **Predict-your-profile game** before the reveal, then compare (§2) | High (fun + self-knowledge) | Moderate (self-assessment r ≈ .29; feedback as a path to self-knowledge) | **High**: a pre-reveal screen; no new items | Low–medium (ego threat; handle with intervals) | **Build first** |
| 3 | **Honest history view**: change across sessions, practice-adjusted, with a reliable-change band (§3) | Medium–high | Strong for the caveats (retest meta-analyses; RCI; regression to the mean) | **High**: raw responses per session in the save, `rescoreSessions`, `retest.ts` | Medium (people over-read change) | **Build** |
| 4 | **"See your own testing effect"**: a two-visit personal experiment, retrieval vs restudy on made-up material (§4) | Medium–high (a skill for life) | Strong (testing effect MA; a 2021 two-experiment study found personal feedback on one's own testing effect raised later use of retrieval practice) | **High**: procedural material only, no bank keys | Low | **Build (cheap, distinctive)** |
| 5 | **Practice mode on quant topics** at the edge of ability, spaced and interleaved, with worked solutions (§5) | High for learners | Strong for the techniques (retrieval, spacing, interleaving in math, adaptive practice, ITS MAs); weak for any transfer claim | Medium: generators and worked solutions exist; needs AI.16 practice-only families so practice never uses up or inflates measured families | Medium (practice inflating measured θ) | **Build after AI.16** |
| 6 | **Puzzle practice and personal bests** for the game-like parts (speed, span, matrices, rotation) (§6) | Medium (enjoyment) | Moderate for enjoyment/gamification (g ≈ 0.25–0.5, fragile); none for "getting smarter" | High: immediate stats are already allowed for speed/memory (§10) | Medium (brain-training framing; inflating RT/span retests) | **Build, framed as play** |
| 7 | **"What to explore next"**: topics by the person's interest and measured knowledge, with free open resources, after a session (pretest benefit) (§7) | Medium | Moderate (pretesting effect; curiosity and memory) | Low–medium: knowledge facets need many items; topic tags exist (A23) | Low–medium (looks like advice) | **Later; start interest-led, not score-led** |
| 8 | **Process goals and plans**: "3 practice sessions this month", calendar file, implementation intentions (§8) | Medium | Strong for goals and plans in general (progress monitoring MA d ≈ 0.40; implementation intentions MA d ≈ 0.65) | High: a local reminder file; no server | Low if goals are on behaviour, high if on θ | **Small add-on to 4–6** |
| 9 | **Results wording that teaches** (task-level feedback, "current estimate", no traits) (§9) | Medium | Strong against self-level feedback (Kluger & DeNisi: ~1/3 of feedback interventions harm) | High: copy only | Low | **Adopt as a rule, not a feature** |
| 10 | **Choosing courses or resources from the profile** (§10) | Low–medium | Weak (placement tests misplace; profile differences unreliable at one session) | Low | High (looks like a decision tool; DESIGN §13 disclaimer) | **Do not build beyond §7** |
| — | Brain-training claims, learning-style matching, growth-mindset intervention, score targets, leaderboards on ability, "strengths" from one session | — | Against or weak | — | High | **Do not build** |

**What to build first** (smallest valuable slice, all on existing data, no bank keys):

1. A calibration mirror on the results page from the CAL data already scored (§1), with a two-minute "calibration practice" on procedural items.
2. A pre-reveal "guess your profile" step stored in the save file only (§2), shown against the result with its fuzz.
3. A "Your sessions" history view that leads with "no clear change" unless the practice-adjusted change clears the band (§3).
4. The personal testing-effect experiment as an optional two-visit activity (§4).

Then, once AI.16 lands, a quant practice mode (§5). Everything else waits for evidence from the cheap tests listed per idea.

**Cross-cutting safeguards.** Practice is kept apart from measurement (practice-only families, never scored, never feeding calibration, DESIGN §7.7 exclusion unchanged). Everything personal stays on the device or in the save file unless the person uploads it (R-17.1-style local-first). No clinical words (R-5.6.1), no emotion-axis lows highlighted (R-5.6.4), no "total" or single number (§9), and the DESIGN §13 disclaimer on every new screen. No feature claims to raise ability; copy claims only "practice this kind of question", backed by the evidence for the practised task.

---
## 1. Calibration mirror: how well you know what you know

**What it is.** A results section, and later a short practice loop, built on data HumanBench already collects. On every tier-a question the person may set a confidence (five points from "a guess" to "certain", DESIGN §3 row 12), and on Fermi items they give an 80% interval. The mirror shows:

- a reliability diagram in plain words: "When you said *fairly sure*, you were right 6 times out of 10" for each confidence point the person used, with the count of answers behind each point and an interval around each proportion;
- the Fermi interval hit rate: "Your 80% ranges held the true value 5 times out of 9", with the target of 80% and the interval for 9 tries;
- one sentence of interpretation only when the data support it (for example, "Across these answers you were more often sure than right"), and otherwise "Too few rated answers to tell yet".

The optional **calibration practice** (later) is a 2–3 minute loop on *procedural* items (matrices, series, quant), where keys are trivial and feedback is allowed (DESIGN §10): give an answer and a confidence, see the outcome at once, and see the running diagram fill in. Practice items are never scored on any axis.

**Evidence.**
- People's self-evaluations track their performance only modestly: mean r ≈ .29 across 22 meta-analyses, lower for broad intellectual abilities than for specific, familiar tasks [MA, Zell & Krizan 2014]. Self-views relate "tenuously to modestly" to behaviour and people overrate themselves on average [OP, Dunning, Heath & Suls 2004]. So a person learns something real by seeing their own calibration.
- The classic "unskilled and unaware" quartile graph is largely produced by regression to the mean plus the better-than-average effect [OBS, Nuhfer et al. 2016; Gignac & Zajenkowski 2020], with a small residual insensitivity to evidence in low performers [OBS, Jansen, Rafferty & Griffiths 2021]. HumanBench should therefore show the *person's own* diagram, never a "you are in the overconfident group" label, and never infer anything from one session's quartile.
- Calibration improves with training and outcome feedback: about an hour of probabilistic-reasoning training improved forecasters' Brier scores by roughly 10% over a year in the Good Judgment Project [RCT, Mellers et al. 2014]. Self-regulated-learning interventions with a metacognitive component show moderate effects on achievement [MA, Dignath, Büttner & Langfeldt 2008]. Calibration gains are often domain-specific and fade, and low performers often stay overconfident [OP, notes on Hacker/Bol line of studies; verify].
- Feedback that keeps attention on the task, rather than the self, is the kind that helps; about a third of feedback interventions reduce performance, mostly those that shift attention to the self [MA, Kluger & DeNisi 1996; MA, Wisniewski, Zierer & Hattie 2020].

**What HumanBench would need to build.**
- Data: already present. Confidence per rated answer is in the session responses; the server scores Brier, calibration-in-the-large and the Fermi hit rate (`rescore`, DESIGN §7.1; M5.1 stores `state.fermi_intervals`). For a device-only session the device scores CAL from its own answers (`web/src/tasks/calibration.ts`).
- One gap: a reliability diagram needs per-answer outcomes (right/wrong per confidence point). For served finite-bank items, the server must not return single-answer verdicts (the M2.1 note: "rescore must not leak single-answer verdicts"). So the served path returns *aggregated counts per confidence point* only when each point has, say, at least 5 answers across at least 2 parts, which reveals no single key. Device-scored procedural answers can be counted on the device.
- A `CalibrationSection.svelte` in `web/src/reveal/` beside `NumbersSection.svelte`, with a text table as the primary form and a small D3 diagram (dataviz rules; no colour-only meaning).
- Copy in `reveal/copy.ts`, passing the M1.20 language lint.
- The practice loop: a route that draws procedural items flagged practice-only (see §5 on AI.16), shows feedback and keeps its counts in the save file under a separate key that the scorer ignores.

**Risks and safeguards.**
- Over-reading small samples: show counts and intervals on every proportion; hide the interpretive sentence below a minimum (the existing `CAL_NORMS.min_responses` = 10 is a floor for the score; the diagram needs ≥ 5 per point shown).
- Key leakage: aggregated counts only for served items, as above.
- Self-level labels: never "you are overconfident" as a trait; say "on these answers".
- Calibration is not a clinical or character measure; no language about "insight" in a clinical sense (R-5.6.1).

**Cheap test.** On the owner's own and a few volunteers' sessions, show the mirror and ask two questions afterwards: "Did anything surprise you?" and "Will you rate your confidence differently next time?" Then, among people who return, compare calibration-in-the-large between session 1 and 2 for those who saw the mirror and those who did not (a feature flag split at random). The outcome is the change in |mean confidence − accuracy|, which is already computed.

---

## 2. Predict your profile, then compare

**What it is.** Just before the reveal, an optional screen: "Before you see your results, where do you think you'll land?" The person drags a point on each measured spoke, or picks "lower / middle / higher" per skill. The reveal then shows their guess as a thin outline over the fuzzy blob, and a short summary: "Your guesses were within the likely range on 9 of 12 skills. Biggest surprise: Spatial (you guessed lower)." A guess is stored only in the save file.

**Evidence.**
- Same base as §1: self-ratings of intellectual abilities correlate weakly with measured performance [MA, Zell & Krizan 2014], so most people will find a surprise, which is the point of a self-knowledge test.
- Explicit feedback is an under-used route to self-knowledge, compared with introspection [OP, Bollich, Johannet & Vazire 2011]. Curiosity is strongest when people notice a gap between what they think and what is true (information-gap account) [OP, Loewenstein 1994], and states of curiosity improve memory for the answer and nearby material [LAB, Gruber, Gelman & Ranganath 2014; Kang et al. 2009]. A prediction creates exactly that gap before the reveal.
- The "predict then see" structure is standard in calibration training and in the self-assessment research above; it costs the person about a minute.
- People accept vague, flattering profiles as accurate, more so when the source looks scientific [LAB, Forer 1949; OP, Dickson & Kelly 1985]. A guess-then-compare step works against that: the person sees concretely where the result agreed or disagreed with their own view, rather than nodding along.
- Volunteers on uncompensated research sites come mainly for self-learning, comparison and fun, and personalised feedback is what they are "paid" in [OBS, Germine et al. 2012; OBS, Reinecke & Gajos 2015; OBS, Jun, Hsieh & Reinecke 2017, N = 7,674].

**What HumanBench would need to build.**
- A pre-reveal step in the reveal flow (`web/src/reveal/Reveal.svelte`, before the axis-by-axis build). The guess UI reuses the blob geometry from `web/src/viz/` (radius linear in θ, rings in SD units, §9) so the guess is on the same scale. A bar view with per-skill sliders is the accessible default.
- A new optional save-file field, for example `self_guess[session_id][axis] = θ_guess` (a §8 schema change, with migration; never uploaded, as `brief_prefs` is not).
- Comparison: for each axis, whether the guess lies inside the 90% posterior interval; report counts and the single largest standardized gap, using the posterior SD (no new statistics).
- Optional research value: the Phase AI Part 2 study proposed a self-vs-measured agreement check for topic settings; this step gives the same data for skills if the person later uploads it under consent.

**Risks and safeguards.**
- Ego threat when a guess is far above the result: phrase surprises in both directions with equal weight, lead with the result's uncertainty ("the result could be anywhere in the shaded band"), and never phrase a gap as a flaw ("You underestimate yourself" is a trait claim; say "Your guess was below the likely range").
- Emotion axis: never highlight a guess-above-result gap on Emotion Reading (R-5.6.4); the comparison for that axis can be hidden by default.
- Anchoring: the guess comes *before* any result, and must be optional and skippable in one action.

**Cheap test.** A/B on the reveal: with or without the guess step. Outcomes: time spent on the results page, whether the person opens the drill-down and the "About these numbers" section, the retest rate at 30 days, and a one-question rating ("I learned something about myself", 1–5). Pre-register that a drop in the rating among people with large negative gaps is a stop signal.

---

## 3. Honest history: change over time

**What it is.** A "Your sessions" view for returning people: each axis as a row of points with intervals, one point per session (or per sitting), practice-adjusted, plus the pooled estimate. Above it, one line per axis in plain words, from three options only:

- "No clear change" (the default and, per the numbers below, by far the most common);
- "Probably higher than at first" / "Probably lower than at first", only when the practice-adjusted difference clears a reliable-change band;
- "Too little data".

A short explainer ("Why scores move between sessions") covers practice gains, day-to-day variation (sleep, device, time of day) and regression to the mean.

**Evidence.**
- Retest gains on cognitive tests are real and substantial: adjusted d ≈ 0.26 across 107 samples [MA, Hausknecht et al. 2007]; about 1/3 SD from test 1 to 2, rising to about 0.5 SD and plateauing after the third test [MA, Scharfen, Peters & Holling 2018, already used in DESIGN §7.8]; g ≈ 0.28 for working-memory tests, rising to the fourth administration [MA, Scharfen, Jansen & Holling 2018]; RT gains keep growing across four sessions without a plateau [MA, Scharfen, Blum & Holling 2018]. So a raw improvement on HumanBench is mostly expected practice, and speed axes need their own ρ (M4.7 estimates ρ per axis; the speed prior of 0.45 may be too low over more than three sessions).
- The reliable change index treats a change as real only if it exceeds what measurement error alone would produce, with practice-adjusted variants that subtract the expected retest gain [OP/method, Jacobson & Truax 1991].
- Extreme first scores move toward the mean on retest because of imperfect reliability [OP/method, Barnett, van der Pols & Dobson 2005].
- In-session or between-session performance is an unreliable index of learning [OP, Soderstrom & Bjork 2015].
- **CALC, HumanBench's own band.** From §7.6, one session gives SE ≈ 0.57 on a question-based axis. The difference between two independent single-session estimates has SE ≈ √2 × 0.57 ≈ 0.80, so a 90% band is ±1.32 SD. Even comparing the pooled first two sessions with the pooled next two (SE ≈ 0.44 each) gives a band of about ±1.0 SD. Real adult change in a skill over months is usually far smaller than that. **The honest history view will say "no clear change" for nearly everyone on nearly every axis**, except knowledge areas a person studies hard and the speed axes, where practice moves scores a lot (and is subtracted). The same arithmetic applies to "peaks" within one profile: two axes at one session need a gap of about 1.3 SD before the difference is credible, which is why the existing peaks logic (A12) is conservative and should stay so.

**What HumanBench would need to build.**
- Data: present. The save file holds raw responses per session and re-scores from them (§8, M1.17); `web/src/save/rescore.ts` and `web/src/engine/retest.ts` apply ρ_k(s) (M1.Q); `web/src/save/sittings.ts` groups sessions into sittings.
- New: per-session (or per-sitting) posteriors from the same re-score, holding item parameters fixed at the current `param_version`, so old sessions are re-scored on today's scale (§7.8 rule: always re-score from raw responses).
- A `HistorySection.svelte` in `web/src/reveal/` (the returning-person start screen and results), with a lollipop-with-intervals chart per axis (bar view is already the accessible default, §9 5c) and the three-option sentence. A unit test pins the band rule with fast-check (a property: identical response patterns in two sessions never produce "probably higher").
- Speed axes: show raw change separately from the practice-adjusted estimate ("you are faster at this task; much of that is familiarity with it").

**Risks and safeguards.**
- Over-reading change, which is the central risk: lead with "no clear change", never show an arrow or a percentage change, never plot a trend line through fewer than four points.
- Motivated retesting to "beat" a score (inflating practice effects and degrading calibration data): keep the ≥ 7-day spacing advice (`SPACING_DAYS`, `reveal/next.ts`) and say plainly that retesting soon mostly measures familiarity.
- No high-stakes use: the history view must not be framed as tracking decline or recovery. No health language, no age-related wording (R-5.6.1, R-5.6.3). This is also why change is never phrased as "decline".

**Cheap test.** Simulation first, using the existing θ-recovery simulees (M1.4a) with zero true change and the current ρ priors: the share of axes labelled "probably higher/lower" must be at most about 10% (the nominal false-alarm rate of a 90% band, two-sided split). Then a five-person comprehension check: show a history and ask "Did your skill change?"; the view passes if people with simulated zero change answer "probably not" or "can't tell".

---

## 4. See your own testing effect

**What it is.** An optional two-visit activity that teaches the most useful study fact there is, using the person's own data. Visit 1 (about 8 minutes): learn 24 made-up items, for example invented word–meaning pairs or symbol–number pairs generated procedurally, half by re-reading and half by recalling with feedback. Visit 2 (2–7 days later, about 3 minutes): a recall test on all 24. The result: "You remembered 9 of 12 that you practised recalling, and 5 of 12 that you re-read." Then a short paragraph on retrieval practice and spacing, and links to free tools that use them.

**Evidence.**
- Retrieval practice beats restudy for later retention: g ≈ 0.50 [MA, Rowland 2014]; g ≈ 0.61 overall and ≈ 0.51 against restudy across 272 effect sizes, in lab and classroom [MA, Adesope, Trevisan & Sundararajan 2017]. Practice testing and distributed practice are the only two techniques rated "high utility" for students [OP, Dunlosky et al. 2013].
- People do not believe it: restudy wins at five minutes and loses at a week, and learners predict the opposite [LAB, Roediger & Karpicke 2006]; most people also believe massing beats interleaving when the reverse is true [LAB, Kornell & Bjork 2008]. Learners avoid effortful strategies partly because the effort feels like poor learning and the benefit comes later [OP, de Bruin et al. 2023].
- **The direct test of this idea exists.** In two experiments, students who received individual feedback showing how their own 7-day delayed scores differed after retrieval practice versus restudy appreciated retrieval practice more and used it more afterwards; the study also compared personal feedback with general instruction about the testing effect [LAB, Hui, de Bruin, Donkers & van Merriënboer 2021, *Educ Psychol Rev*]. This is close to exactly the proposed feature.
- Spacing: the best gap between study and review grows with how long the material must be kept, about 10–20% of a one-week retention interval [LAB, Cepeda et al. 2008; MA, Cepeda et al. 2006], so a 2–7 day gap between visits suits the demonstration.

**What HumanBench would need to build.**
- A procedural generator of arbitrary pairs (no finite bank, no keys to protect; CLAUDE.md allows procedural generators in the public repo), seeded per person, with the restudy/recall split counterbalanced within person.
- A small activity route (`web/src/practice/` or similar) and a save-file field holding the visit-1 timestamps and the visit-2 results. A downloadable calendar reminder (`.ics`, generated on the device) for visit 2.
- No server work and no effect on any axis or on calibration data.

**Risks and safeguards.**
- A person may not show the effect (noise with 12 items per condition, or a short gap): say in advance "most people remember more of the ones they practised recalling, but not everyone does on one try", and show the result with its uncertainty.
- No claim beyond the material: copy says "for remembering facts and words", which is where the evidence is strongest (transfer to new kinds of questions is smaller, d ≈ 0.40 overall [MA, Pan & Rickard 2018]).
- Privacy: everything stays on the device.

**Cheap test.** Run it on the owner and 10–20 volunteers. Outcomes: the share who show a retrieval advantage (expected: most), and a one-month follow-up question on whether they used self-testing for something they were learning. It is cheap enough to ship as an experiment with a "Was this useful?" button.

---
## 5. Quant practice mode at the edge of ability

**What it is.** A separate "Practise" area, not a session, for the quantitative topic groups (the eight groups in `web/src/tasks/quant/topics.ts`, `QUANT_GROUP_VERSION` g2). The person picks a group ("percentages and ratios") or accepts a suggestion. The practice engine:

- serves procedural items from practice-only families of that group, aiming at about 75–85% success, with a "comfortable / stretch" switch the person controls;
- gives immediate feedback and the worked solution (`web/src/reveal/worked/quant.ts` already writes them), and asks for a confidence before the answer so a confident error gets a clear correction;
- interleaves two or three confusable groups once the person is past the first few items;
- schedules review of each practised group at expanding gaps (1, 3, 7, 21 days) and offers a downloadable reminder;
- shows the practice history only as "items practised" and "recent accuracy on practice", never as a θ.

**Evidence.**
- Techniques: retrieval with feedback (see §4); spacing [MA, Cepeda et al. 2006]; interleaving helps in math (g ≈ 0.34 overall in math, with large effects in a classroom RCT of interleaved homework, d ≈ 0.83 at one day and 1.05 at 30 days, partly confounded with spacing) but hurts for word lists [MA, Brunmair & Richter 2019; RCT, Rohrer, Dedrick & Stershic 2015]. Errors followed promptly by corrective feedback help, and high-confidence errors are corrected most (hypercorrection) [LAB, Butterfield & Metcalfe 2001; OP, Metcalfe 2017].
- Adaptive practice: Math Garden estimates ability and item difficulty on the fly with an Elo rule and targets about 75% success [OBS/system, Klinkenberg, Straatemeier & van der Maas 2011]; in a field experiment, easier settings led children to practise more, and the amount of practice related to gains [RCT, Jansen et al. 2013; verify details]. The "85% rule" is a theoretical result for a narrow class of learning models, not a human trial [theory, Wilson et al. 2019]; use it as a default, not a law. Step-based tutoring systems approach human tutoring (d ≈ 0.76 vs 0.79), answer-only feedback systems much less (d ≈ 0.31) [OP/MA, VanLehn 2011]; intelligent tutors show a median effect of about 0.66, but only about 0.13 on standardized tests rather than the system's own tests [MA, Kulik & Fletcher 2016]. Mastery learning ES ≈ 0.52 [MA, Kulik, Kulik & Bangert-Drowns 1990].
- Limits: practice explains about 4% of variance in performance in education [MA, Macnamara, Hambrick & Oswald 2014], and far transfer from practising one kind of task to general ability is close to zero [MA, Sala et al. 2019; Sala & Gobet 2019]. So the honest promise is "get better at these kinds of problems", which is real and is what the person wants when they pick a topic.

**What HumanBench would need to build.**
- **AI.16 first** (ROADMAP: "Adult-relevant quant templates and practice-only sets"). The family contract already has the `practice_only` flag for QR (`web/src/tasks/family.ts`; A23). This matters: quant has only about a dozen families per stratum (`reveal/worked/index.ts`), and the lifetime family exclusion (§7.7) means every family a person practises on is lost to their measurement and, worse, would inflate it. Practice must draw only on practice-only families, or on families the person has already used up.
- A practice engine: a one-dimensional Elo or grid posterior per quant group, kept on the device, *separate* from the scorer (never written into the session responses that `rescore` reads; a separate save-file key). The existing IRT math (`engine/irt.ts`) can choose the item whose predicted success is nearest the target.
- A review schedule per group: a simple expanding schedule is enough; there is no strong evidence that a model-based scheduler beats a reasonable expanding one on learning outcomes (FSRS and half-life regression are validated on predicting recall, not on learning gains [OBS, Settles & Meeder 2016; Ye, Su & Cao 2022]).
- Suggestions of which group to practise may use the measured quant facets only where the Phase AI zone rules allow (AI.8), and otherwise the person's choice. The topic list itself is the main value.

**Risks and safeguards.**
- Measurement contamination: practice families never served as counted items, practice responses never in calibration data, and a test that the scored selector never offers a practice-only family (a property test over seeds).
- Inflated retest: after practice, a later quant session will be higher partly from practice; the history view (§3) says so, and the save notes how many practice items preceded each session so M4.7 can model it (or exclude such sessions from ρ estimation).
- Frustration at the edge: the comfortable setting, and stopping suggestions after several misses in a row ("take a break, or switch to comfortable").
- Copy: "practise", never "train your brain"; no claims about other parts of the profile.

**Cheap test.** A within-person pilot with volunteers: practise one quant group for 3 short sessions over a week, not another; one week later, a short test on new items from both groups (practice-only families held out from the practice itself). The outcome is the difference between practised and unpractised groups, which should be positive, and the share who return to practise without prompting.

---

## 6. Play: personal bests on the game-like parts

**What it is.** A "Play" area with the parts that are already game-like and whose keys are trivial: reaction time, symbol coding, digit and Corsi span, mental rotation, matrices and series on practice-only seeds. It shows the person's own best and recent runs ("Longest backward span: 7"), daily seeds for a shared puzzle (no ranking), and the worked solution after each puzzle. Nothing here is scored or counted.

**Evidence.**
- Enjoyment and engagement: gamification has small positive effects on learning outcomes (cognitive g ≈ 0.49, stable in rigorous studies; motivational g ≈ 0.36 and behavioural g ≈ 0.25, less stable) [MA, Sailer & Homner 2020]. These are effects on learning in education, not on ability.
- Brain training does not work as advertised: training improves the trained tasks, a little the closely related ones, and shows little evidence of improving everyday cognition [OP/systematic, Simons et al. 2016]. The FTC fined the maker of Lumosity for claiming otherwise [REG, FTC 2016]. Working-memory training gives short-lived near transfer and no convincing far transfer [MA, Melby-Lervåg, Redick & Hulme 2016]. Repeated RT and speed tasks keep getting faster across sessions [MA, Scharfen, Blum & Holling 2018].
- People take online cognitive tests largely to learn about themselves and for fun, and personalised feedback is what draws them (the TestMyBrain model) [OBS, Germine et al. 2012; verify].

**What HumanBench would need to build.**
- A play route that wraps the existing task renderers (`web/src/render/`, `web/src/tasks/rt`, `span`, `coding`, `matrices`) in a no-score shell, with per-task bests in the save file under a separate key.
- Seeds that never collide with measured families: procedural families with a practice namespace, or the existing family exclusion run in reverse (families the person has played are added to `seen_families`, as the worked examples already do in `reveal/worked/index.ts`).
- For speed tasks there are no families to exclude; instead the save records play counts so the retest model can account for them, and the history view (§3) shows speed change as "familiarity".

**Risks and safeguards.**
- Brain-training framing: the page says plainly "This is for fun. Getting better at these games mostly means getting better at these games."
- Inflating later measurement, mainly on speed and span: the measured session copy notes how much play happened; ρ estimation excludes heavy players.
- Social comparison: no leaderboards on ability (normative, self-level feedback is the kind that backfires [MA, Kluger & DeNisi 1996]); a shared daily puzzle is fine if only completion is shared.

**Cheap test.** Ship it behind a link on the results page and log only on-device counts the person can choose to upload: the share who play at least twice, and whether play is followed by a measured session sooner than 7 days (a contamination signal).

---

## 7. What to explore next

**What it is.** After a session, a short "Explore next" list of topics, led by the person's own interests (a tick-list of topic areas from `schema/topics-v1.json`), with HumanBench's measured knowledge used only as a gentle second signal where it is informative. Each topic links to free, open material (OpenStax chapters for science and math, for example) and to the quant practice area (§5) where one exists. The list never says "you are weak in history"; it says "Topics you said interest you, and that this session touched on".

**Evidence.**
- A test before study helps later learning of the tested material, even when the pretest answers are wrong, provided the right answer comes later [LAB, Richland, Kornell & Kao 2009; OP, Pan & Carpenter 2023]; benefits for untested material are inconsistent. A HumanBench session is a pretest of sorts, but because finite-bank keys and items are never shown, the pretesting benefit is weak here unless the person goes on to study the same topics soon.
- Curiosity raises memory for what is learned while curious [LAB, Gruber, Gelman & Ranganath 2014; Kang et al. 2009]; interest is a better entry point than a deficit.
- Topic knowledge is the one result the Phase AI Part 2 study found informative, but only per topic and only with enough items: knowledge facets need thousands of sessions to calibrate (that study, section 3). Measured "gaps" in a knowledge area after one session are mostly noise.

**What HumanBench would need to build.**
- An interest picker (local only) and a static map from topics to open resources, kept in the public repo (no items, no keys).
- Use of measured facets only through the AI.8 zone rules and only for quant groups at first.
- The DESIGN §13 disclaimer on the list.

**Risks and safeguards.**
- Looking like advice or placement: no "you should", no difficulty labels, no "recommended course".
- License and quality of linked resources: open-licensed sources only, checked by the owner.

**Cheap test.** Offer the list to volunteers and ask a week later whether they opened any resource. If interest-only and interest-plus-measured lists do equally well (likely), keep interest-only.

---

## 8. Goals and plans on behaviour, not on the score

**What it is.** A small add-on to §4–§6: the person may set a process goal ("practise percentages three times this week", "come back for session 2 in a week"), add an if–then plan ("after dinner on Tuesday, I'll do one practice set"), and download a calendar file. Progress is shown as counts of the planned actions, on the device.

**Evidence.**
- Monitoring progress toward goals promotes attainment (d ≈ 0.40), more so when progress is recorded or reported [MA, Harkin et al. 2016]. Implementation intentions have a medium-to-large effect on goal attainment (d ≈ 0.65) [MA, Gollwitzer & Sheeran 2006]. Specific, challenging goals beat "do your best" in many settings [OP, Locke & Latham 2002].
- Goals set on the measured score are a bad idea: a score that becomes a target stops measuring well, retest gains alone would "achieve" many score goals (§3), and HumanBench's bands are too wide to show progress toward a score anyway.
- Information alone rarely changes behaviour: across 18 trials, telling people their DNA-based disease risk did not change smoking, diet or activity [MA, Hollands et al. 2016]. Tracking can even backfire: adding a wearable to a weight-loss programme led to *less* weight loss over 24 months [RCT, Jakicic et al. 2016]. People also avoid information about their own progress when they expect bad news (the "ostrich problem") [OP, Webb, Chang & Benn 2013]. So the profile alone will not make anyone practise; a chosen goal, a plan and a record are what carry the effect, and the person must be able to choose not to look.

**What HumanBench would need to build.** A goal object in the save file; `.ics` generation on the device; a counter on the practice and play areas.

**Risks and safeguards.** No score targets; no streak pressure that punishes a missed day; no reminders by email or push (no contact data is held, §13).

**Cheap test.** Among practice-mode users, a random half see the goal-and-plan prompt; compare return visits over two weeks.

---

## 9. Results wording that teaches (a rule, not a feature)

**What it is.** Copy rules for every results surface, existing and new:

- describe *results on tasks* ("on these questions"), never traits ("you are a spatial thinker");
- say "current estimate" and show the band; say what would change it (more sessions, sleep, device);
- give a "where next" with every result (a practice set, the history view, the testing-effect activity);
- no praise or ranking on the person ("great job", "top 10%"); percentiles stay hidden until A12 allows them.

**Evidence.**
- Feedback helps on average (d ≈ 0.41–0.48) but about a third of feedback effects are negative, mostly when feedback draws attention to the self rather than the task [MA, Kluger & DeNisi 1996; MA, Wisniewski, Zierer & Hattie 2020]. Feedback that answers "where am I going, how am I going, where to next" at task and process level works best; praise of the person works least [OP, Hattie & Timperley 2007].
- **Mindset, candidly.** Growth-mindset interventions have small average effects on achievement: d ≈ 0.08 in one 2018 meta-analysis [MA, Sisk et al. 2018], about 0.05 and close to zero in the best-designed studies in another 2023 meta-analysis [MA, Macnamara & Burgoyne 2023], small positive effects concentrated in groups expected to benefit in a third [MA, Burnette et al. 2023]. A national preregistered trial found a 0.10 grade-point gain for lower-achieving students that depended on school norms [RCT, Yeager et al. 2019]. HumanBench should not run a mindset intervention or promise one helps; it can simply say true things (test scores change with practice and conditions) without the motivational claim.
- Self-concept in a specific domain and achievement in that domain reinforce each other over time, unlike global self-esteem [OP/longitudinal, Marsh & Craven 2006]. That is an argument against global labels and for domain-specific, task-level wording.
- Grit as a construct largely overlaps conscientiousness and predicts performance only moderately [MA, Credé, Tynan & Harms 2017]; avoid grit or "persistence score" language.
- Labels act on their own: people randomly told they had a high genetic risk changed physiologically more than their actual genotype predicted [RCT, Turnwald et al. 2019], and people randomly told they had slept poorly scored lower on some cognitive tasks [LAB, Draganich & Erdal 2014]. This is the strongest reason never to hand out a trait label ("low working memory") from a noisy one-hour estimate. Praise for intelligence rather than effort reduced persistence after failure in the original studies [LAB, Mueller & Dweck 1998], though that literature's effects have since shrunk.
- Stereotype threat on test scores is small at most (d ≈ −0.14 in operational-like conditions, with publication bias) and a large preregistered replication found none [MA, Shewach, Sackett & Quint 2019; RCT, Flore, Mulder & Wicherts 2018]. It is still cheap to avoid: keep the optional survey (§13) away from the start of the tasks, and show no group comparison.

**What HumanBench would need to build.** Add these rules to the M1.20 language lint where they can be tested (for example, flag "you are a" followed by an adjective in results copy), and to the copy review checklist.

**Risks.** None beyond copy churn.

**Cheap test.** A lint run over current copy (`reveal/copy.ts`, `brief/copy.ts`) to count violations.

---

## 10. Choosing courses, resources or careers from the profile

**What it is.** The tempting step from "here is your profile" to "so take this course" or "so this field suits you".

**Evidence and why not.**
- One session's profile cannot carry it: between-axis differences need about 1.3 SD to be credible at one session (CALC, §3), and the population is self-selected with no external norms yet (A12).
- Matching instruction to a person's style or "type" has no support: the meshing hypothesis has failed adequate tests [OP/systematic, Pashler et al. 2008]. The Phase AI Part 2 study reached the same conclusion for AI notes.
- DESIGN §13 already rules out "a basis for decisions about education, employment, or health". Course or career suggestions would read as exactly that.

**What could be done instead.** §7's interest-led list, and the plain statement that a person choosing a course is better served by the course's own placement or prerequisite check than by a broad profile.

---

## 11. Things not to build, and why

| Idea | Why not | Source |
|---|---|---|
| "Train your brain" claims, or any claim that practice here raises reasoning, memory or speed in daily life | Far transfer ≈ 0 with active controls; FTC action against such claims | Simons et al. 2016; Sala et al. 2019; FTC 2016 |
| Study tips matched to the profile ("you're a visual learner") | Meshing hypothesis unsupported | Pashler et al. 2008 |
| A growth-mindset module | Average effects d ≈ 0–0.1, context-dependent | Sisk 2018; Macnamara & Burgoyne 2023; Burnette 2023 |
| Score targets, streaks, leaderboards on ability | Retest gains fake progress; normative self-level feedback backfires | Scharfen 2018; Kluger & DeNisi 1996 |
| "Strengths and weaknesses" from one session beyond the existing credible peaks | Differences need ~1.3 SD at one session | CALC §3 |
| Tracking decline, ageing or recovery | Health framing; R-5.6.1, R-5.6.3; not the purpose (D1) | DESIGN §5.6, §13 |
| Showing finite-bank answers after a session to aid study | Key leakage; would inflate later measurement | DESIGN §10 |

---

## 12. How these fit together and what to measure

The four "build first" ideas share one design: **show the person their own data with its uncertainty, and give them a next step that is about what they do, not what they are.** They all run on the device, use procedural material only where feedback is shown, and need no new server work except aggregated calibration counts for served items (§1).

A single small evaluation can cover them: 20–40 volunteers who take two sessions a week apart, randomised to see or not see each of §1–§3, plus the §4 activity for everyone. Outcomes: the one-question "I learned something about myself" rating; comprehension of the history view (§3 test); change in calibration-in-the-large; self-reported use of self-testing a month later. Report estimates with intervals, not p-values, at this size.

---
## Sources

Type codes as at the top. "Verify" marks figures taken from abstracts or from memory that should be re-checked against the full text before they appear in user-facing copy. DOIs were checked against Crossref or OpenAlex on 2026-10-22.

| # | Source | Type | Used for | Link |
|---|---|---|---|---|
| 1 | Zell & Krizan 2014, *Perspect Psychol Sci* 9:111. Self-evaluation vs performance, r ≈ .29 across 22 MAs | MA | §1, §2 | https://doi.org/10.1177/1745691613518075 |
| 2 | Dunning, Heath & Suls 2004, *Psychol Sci Public Interest* 5:69. Flawed self-assessment | OP | §1 | https://doi.org/10.1111/j.1529-1006.2004.00018.x |
| 3 | Nuhfer et al. 2016, *Numeracy* 9(1):4. DK graph from noise | OBS/sim | §1 | https://doi.org/10.5038/1936-4660.9.1.4 |
| 4 | Gignac & Zajenkowski 2020, *Intelligence* 80:101449. Little DK beyond artefact | OBS | §1 | https://doi.org/10.1016/j.intell.2020.101449 |
| 5 | Jansen, Rafferty & Griffiths 2021, *Nat Hum Behav* 5:756. Rational model, residual DK | OBS | §1 | https://doi.org/10.1038/s41562-021-01057-0 |
| 6 | Mellers et al. 2014, *Psychol Sci* 25:1106. Forecasting training improved Brier ~10% | RCT | §1 | https://doi.org/10.1177/0956797614524255 |
| 7 | Dignath, Büttner & Langfeldt 2008, *Metacogn Learn*. SRL interventions MA (verify d) | MA | §1 | https://doi.org/10.1007/s11409-008-9029-x |
| 8 | Kluger & DeNisi 1996, *Psychol Bull* 119:254. ~1/3 of feedback effects negative | MA | §1, §6, §9 | https://doi.org/10.1037/0033-2909.119.2.254 |
| 9 | Wisniewski, Zierer & Hattie 2020, *Front Psychol* 10:3087. Feedback d ≈ 0.48 | MA | §1, §9 | https://doi.org/10.3389/fpsyg.2019.03087 |
| 10 | Hattie & Timperley 2007, *Rev Educ Res* 77:81. Feedback levels | OP | §9 | https://doi.org/10.3102/003465430298487 |
| 11 | Bollich, Johannet & Vazire 2011, *Front Psychol* 2:312. Feedback as a path to self-knowledge | OP | §2 | https://doi.org/10.3389/fpsyg.2011.00312 |
| 12 | Loewenstein 1994, *Psychol Bull* 116:75. Information-gap curiosity | OP | §2 | https://doi.org/10.1037/0033-2909.116.1.75 |
| 13 | Kang et al. 2009, *Psychol Sci* 20:963. Curiosity and memory | LAB | §2, §7 | https://doi.org/10.1111/j.1467-9280.2009.02402.x |
| 14 | Gruber, Gelman & Ranganath 2014, *Neuron* 84:486. Curiosity states enhance memory | LAB | §2, §7 | https://doi.org/10.1016/j.neuron.2014.08.060 |
| 15 | Forer 1949, *J Abnorm Soc Psychol* 44:118. Barnum effect | LAB | §2 | https://doi.org/10.1037/h0059240 |
| 16 | Dickson & Kelly 1985, *Psychol Rep* 57:367. Barnum acceptance review | OP | §2 | https://doi.org/10.2466/pr0.1985.57.2.367 |
| 17 | Germine et al. 2012, *Psychon Bull Rev* 19:847. TestMyBrain data quality and feedback model | OBS | §2, §6 | https://doi.org/10.3758/s13423-012-0296-9 |
| 18 | Reinecke & Gajos 2015, CSCW. LabintheWild | OBS | §2 | https://doi.org/10.1145/2675133.2675246 |
| 19 | Jun, Hsieh & Reinecke 2017, *PACM HCI* 1(CSCW):56. Participation motives, N = 7,674 | OBS | §2 | https://doi.org/10.1145/3134691 |
| 20 | Hausknecht et al. 2007, *J Appl Psychol* 92:373. Retest d ≈ 0.26 | MA | §3 | https://doi.org/10.1037/0021-9010.92.2.373 |
| 21 | Scharfen, Peters & Holling 2018, *Intelligence* 67:44. Retest effects in ability tests (verify figures; abstract not accessible) | MA | §3, §11 | https://doi.org/10.1016/j.intell.2018.01.003 |
| 22 | Scharfen, Jansen & Holling 2018, *Psychon Bull Rev* 25:2175. WM retest g ≈ 0.28 | MA | §3 | https://doi.org/10.3758/s13423-018-1461-6 |
| 23 | Scharfen, Blum & Holling 2018, *J Intell* 6:6. Speed retest, no plateau over 4 sessions | MA | §3, §6 | https://doi.org/10.3390/jintelligence6010006 |
| 24 | Jacobson & Truax 1991, *J Consult Clin Psychol* 59:12. Reliable change index | OP/method | §3 | https://doi.org/10.1037/0022-006x.59.1.12 |
| 25 | Barnett, van der Pols & Dobson 2005, *Int J Epidemiol* 34:215. Regression to the mean | OP/method | §3 | https://doi.org/10.1093/ije/dyh299 |
| 26 | Soderstrom & Bjork 2015, *Perspect Psychol Sci* 10:176. Learning vs performance | OP | §3 | https://doi.org/10.1177/1745691615569000 |
| 27 | Rowland 2014, *Psychol Bull* 140:1432. Testing effect g ≈ 0.50 | MA | §4, §5 | https://doi.org/10.1037/a0037559 |
| 28 | Adesope, Trevisan & Sundararajan 2017, *Rev Educ Res* 87:659. Practice testing g ≈ 0.61 | MA | §4 | https://doi.org/10.3102/0034654316689306 |
| 29 | Dunlosky et al. 2013, *Psychol Sci Public Interest* 14:4. Ten techniques; two "high utility" | OP | §4 | https://doi.org/10.1177/1529100612453266 |
| 30 | Roediger & Karpicke 2006, *Psychol Sci* 17:249. Testing vs restudy; learners' wrong predictions | LAB | §4 | https://doi.org/10.1111/j.1467-9280.2006.01693.x |
| 31 | Kornell & Bjork 2008, *Psychol Sci* 19:585. Interleaving; learners prefer massing | LAB | §4 | https://doi.org/10.1111/j.1467-9280.2008.02127.x |
| 32 | **Hui, de Bruin, Donkers & van Merriënboer 2021**, *Educ Psychol Rev*. Personal feedback on own testing effect increased retrieval-practice use | LAB (2 experiments) | §4 | https://doi.org/10.1007/s10648-021-09604-x |
| 33 | de Bruin et al. 2023, *Educ Psychol Rev*. Why learners avoid effortful strategies (S2D2) | OP | §4 | https://doi.org/10.1007/s10648-023-09766-w |
| 34 | Cepeda et al. 2006, *Psychol Bull* 132:354. Distributed practice | MA | §4, §5 | https://doi.org/10.1037/0033-2909.132.3.354 |
| 35 | Cepeda et al. 2008, *Psychol Sci* 19:1095. Optimal gap ≈ 10–20% of retention interval | LAB (online, n ≈ 1,350) | §4 | https://doi.org/10.1111/j.1467-9280.2008.02209.x |
| 36 | Pan & Rickard 2018, *Psychol Bull* 144:710. Transfer of test-enhanced learning d ≈ 0.40 | MA | §4, §5 | https://doi.org/10.1037/bul0000151 |
| 37 | Brunmair & Richter 2019, *Psychol Bull* 145:1029. Interleaving g ≈ 0.42; math ≈ 0.34; words negative | MA | §5 | https://doi.org/10.1037/bul0000209 |
| 38 | Rohrer, Dedrick & Stershic 2015, *J Educ Psychol* 107:900. Interleaved math homework | RCT (classroom) | §5 | https://doi.org/10.1037/edu0000001 |
| 39 | Butterfield & Metcalfe 2001, *JEP:LMC* 27:1491. Hypercorrection | LAB | §5 | https://doi.org/10.1037/0278-7393.27.6.1491 |
| 40 | Metcalfe 2017, *Annu Rev Psychol* 68:465. Learning from errors | OP | §5 | https://doi.org/10.1146/annurev-psych-010416-044022 |
| 41 | Klinkenberg, Straatemeier & van der Maas 2011, *Comput Educ* 57:1813. Math Garden Elo, ~75% success | OBS/system | §5 | https://doi.org/10.1016/j.compedu.2011.02.003 |
| 42 | Jansen et al. 2013, *Learn Individ Differ*. Difficulty settings in Math Garden (verify details) | RCT (field) | §5 | https://doi.org/10.1016/j.lindif.2012.12.014 |
| 43 | Wilson et al. 2019, *Nat Commun* 10:4646. "85% rule" (theory) | theory/sim | §5 | https://doi.org/10.1038/s41467-019-12552-4 |
| 44 | VanLehn 2011, *Educ Psychol* 46:197. Tutoring granularity, d ≈ 0.76 step-based | OP/MA | §5 | https://doi.org/10.1080/00461520.2011.611369 |
| 45 | Kulik & Fletcher 2016, *Rev Educ Res* 86:42. ITS median 0.66; 0.13 on standardized tests | MA | §5 | https://doi.org/10.3102/0034654315581420 |
| 46 | Kulik, Kulik & Bangert-Drowns 1990, *Rev Educ Res* 60:265. Mastery learning ES ≈ 0.52 | MA | §5 | https://doi.org/10.3102/00346543060002265 |
| 47 | Macnamara, Hambrick & Oswald 2014, *Psychol Sci* 25:1608. Deliberate practice ~12% of variance, 4% in education | MA | §5 | https://doi.org/10.1177/0956797614535810 |
| 48 | Ericsson 2016, *Perspect Psychol Sci*. Rebuttal to [47] | OP | §5 (context) | https://doi.org/10.1177/1745691616635600 |
| 49 | Settles & Meeder 2016, ACL. Half-life regression (prediction, engagement +12%) | OBS/A-B | §5 | https://doi.org/10.18653/v1/p16-1174 |
| 50 | Ye, Su & Cao 2022, KDD. DSR scheduler (FSRS precursor) | BENCH | §5 | https://doi.org/10.1145/3534678.3539081 |
| 51 | Sala et al. 2019, *Collabra Psychol* 5:18. Second-order MA: far transfer ≈ 0 | MA | §5, §6, §11 | https://doi.org/10.1525/collabra.203 |
| 52 | Sala & Gobet 2019, *Trends Cogn Sci* 23:9. Cognitive training does not enhance general cognition | OP | §5, §11 | https://doi.org/10.1016/j.tics.2018.10.004 |
| 53 | Simons et al. 2016, *Psychol Sci Public Interest* 17:103. Do brain-training programs work? | OP (systematic) | §6, §11 | https://doi.org/10.1177/1529100616661983 |
| 54 | FTC 2016, Lumos Labs settlement ($2M) | REG | §6, §11 | https://www.ftc.gov/news-events/news/press-releases/2016/01/lumosity-pay-2-million-settle-ftc-deceptive-advertising-charges-its-brain-training-program |
| 55 | Melby-Lervåg, Redick & Hulme 2016, *Perspect Psychol Sci* 11:512. WM training, no far transfer | MA | §6 | https://doi.org/10.1177/1745691616635612 |
| 56 | Sailer & Homner 2020, *Educ Psychol Rev* 32:77. Gamification g ≈ 0.49 / 0.36 / 0.25 | MA | §6 | https://doi.org/10.1007/s10648-019-09498-w |
| 57 | Richland, Kornell & Kao 2009, *JEP: Applied* 15:243. Pretesting effect | LAB | §7 | https://doi.org/10.1037/a0016496 |
| 58 | Pan & Carpenter 2023, *Educ Psychol Rev*. Prequestion review | OP | §7 | https://doi.org/10.1007/s10648-023-09814-5 |
| 59 | Harkin et al. 2016, *Psychol Bull* 142:198. Progress monitoring d ≈ 0.40 | MA | §8 | https://doi.org/10.1037/bul0000025 |
| 60 | Gollwitzer & Sheeran 2006, *Adv Exp Soc Psychol* 38:69. Implementation intentions d ≈ 0.65 (later work suggests smaller) | MA | §8 | https://doi.org/10.1016/s0065-2601(06)38002-1 |
| 61 | Locke & Latham 2002, *Am Psychol* 57:705. Goal-setting theory | OP | §8 | https://doi.org/10.1037/0003-066x.57.9.705 |
| 62 | Hollands et al. 2016, *BMJ* 352:i1102. DNA risk communication does not change behaviour | MA (18 RCTs) | §8 | https://doi.org/10.1136/bmj.i1102 |
| 63 | Jakicic et al. 2016, *JAMA* 316:1161. IDEA trial: wearable led to less weight loss | RCT | §8 | https://doi.org/10.1001/jama.2016.12858 |
| 64 | Webb, Chang & Benn 2013, *Soc Personal Psychol Compass* 7:794. Ostrich problem | OP | §8 | https://doi.org/10.1111/spc3.12071 |
| 65 | Sisk et al. 2018, *Psychol Sci* 29:549. Mindset interventions d ≈ 0.08 | MA | §9, §11 | https://doi.org/10.1177/0956797617739704 |
| 66 | Macnamara & Burgoyne 2023, *Psychol Bull* 149:133. Mindset d ≈ 0.05, ≈ 0 in best studies | MA | §9, §11 | https://doi.org/10.1037/bul0000352 |
| 67 | Burnette et al. 2023, *Psychol Bull* 149:174. Mindset: small effects in focal groups | MA | §9, §11 | https://doi.org/10.1037/bul0000368 |
| 68 | Yeager et al. 2019, *Nature* 573:364. National Study of Learning Mindsets | RCT | §9 | https://doi.org/10.1038/s41586-019-1466-y |
| 69 | Marsh & Craven 2006, *Perspect Psychol Sci* 1:133. Reciprocal effects of domain self-concept and achievement | OP (longitudinal evidence) | §9 | https://doi.org/10.1111/j.1745-6916.2006.00010.x |
| 70 | Credé, Tynan & Harms 2017, *J Pers Soc Psychol* 113:492. Grit meta-analysis | MA | §9 | https://doi.org/10.1037/pspp0000102 |
| 71 | Turnwald et al. 2019, *Nat Hum Behav* 3:48. Genetic-risk labels change physiology | RCT (N = 223) | §9 | https://doi.org/10.1038/s41562-018-0483-4 |
| 72 | Draganich & Erdal 2014, *JEP:LMC* 40:857. Told sleep quality affects test scores | LAB (N = 164) | §9 | https://doi.org/10.1037/a0035546 |
| 73 | Mueller & Dweck 1998, *J Pers Soc Psychol* 75:33. Praise for intelligence | LAB | §9 | https://doi.org/10.1037/0022-3514.75.1.33 |
| 74 | Shewach, Sackett & Quint 2019, *J Appl Psychol* 104:1514. Stereotype threat d ≈ −0.14 in operational-like settings | MA | §9 | https://doi.org/10.1037/apl0000420 |
| 75 | Flore, Mulder & Wicherts 2018, *Compr Results Soc Psychol* 3:140. Registered report, no effect | RCT (N = 2,064) | §9 | https://doi.org/10.1080/23743603.2018.1559647 |
| 76 | Pashler, McDaniel, Rohrer & Bjork 2008, *Psychol Sci Public Interest* 9:105. Learning styles | OP (systematic) | §10, §11 | https://doi.org/10.1111/j.1539-6053.2009.01038.x |
| 77 | HumanBench DESIGN §3, §7.1, §7.6, §7.7, §7.8, §9, §10, §13, R-5.6.x; ROADMAP A12, A23, M1.Q, M4.7, M5.1, AI.8, AI.16 | internal | throughout | `docs/DESIGN.md`, `docs/ROADMAP.md` |
| 78 | Phase AI Part 2 study (2026-10-20) | internal | §7, §10 | `docs/research/phase-ai-2-study.md` |
