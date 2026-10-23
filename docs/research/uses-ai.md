# What HumanBench results can do with AI, beyond prompt notes

*Research study, 2026-10-22. Lens: AI-related and comparative uses of HumanBench results and items, other than the "Notes for your AI" of DESIGN §17. Companion to `docs/research/phase-ai-2-study.md`, which found that result-based prompt notes are weakly supported except depth by topic knowledge. Scope references: DESIGN §3 (construct map), §7 (scoring), §10 (UX, practice mode), §17 (R-17.x), R-5.6.x (non-diagnostic language), decisions D1 and D13 ("no human-vs-AI overlay"). This document holds no item text, keys or bank data: it cites the private bank only by directory name and aggregate counts. It is a reading of the literature and of what HumanBench already has, not a requirement. Anything here that would change DESIGN or ROADMAP needs the owner's approval; idea 4 in particular would reopen decision D1.*

**Evidence labels** (the same as the Part 2 study): **MA** meta-analysis or systematic review; **RCT** randomised trial; **LAB** laboratory or online experiment; **OBS** observational or survey; **BENCH** benchmark or automatic evaluation of models; **OP** position paper, framework or narrative review. **[recall]** marks a figure taken from background reading and not re-checked in this session (the web-search quota was used up; sources were checked through the arXiv, OpenAlex and Crossref APIs, mostly at the abstract level). Every claim is keyed to the source table at the end (S1, S2, ...).

**Method.** One lead pass plus two helper passes (human-AI collaboration, reliance and tutoring; LLM psychometrics, contamination and comparison). The search was broad, not systematic. Several figures rest on abstracts only.

---

## Executive summary

**The short answer.** The origin idea, "a human benchmark written by AI should feed back into AI", has better outlets than prompt notes. The strongest ones do not use the profile to describe the person to an AI at all. They use HumanBench's *machinery* (items with proved keys, calibrated difficulty, a confidence scale, practice mode) to train the skill that matters most when people work with AI: **knowing when the AI is right**. The research on human-AI teams is blunt. On average, human-AI combinations do *worse* than the better of the two alone (g = -0.23 over 106 experiments, S1). Teams gain when the person can tell good AI output from bad (S2, S3, S4). Explanations make people accept AI answers whether or not they are right (S5, S6). HumanBench can build exactly the practice that targets this, for $0, offline, from generators it already has.

The literal "human benchmark" comparison (your profile beside the models' profiles on the same questions) is the most on-brand idea and the least honest one as a per-person overlay. HumanBench's own gate makes it circular: a finite-bank item is released only when all three panel models agree with its key (ROADMAP A6 amended), so models score near 100% on served text items *by construction*, and the emotion and judgment keys *are* a Claude-model ensemble's ratings. It can be done honestly only as a separate, family-level explainer on fresh procedural items, and only if the owner reopens D1.

**Ranked ideas** (value to the person × strength of evidence × feasibility with HumanBench's data at $0 × risk; one line each, details in sections 1 to 8):

| Rank | Idea | Value | Evidence | Feasibility ($0, offline) | Risk | Verdict |
|---|---|---|---|---|---|---|
| 1 | **"Check the AI" practice**: worked solutions to procedural items, some with planted errors; the person judges right/wrong with a confidence, then sees the proof | High | Moderate to strong for the problem (overreliance, error boundaries, calibration gap); moderate for training it | High: procedural keys are proved; flawed solutions can be made by code, no model needed; Claude Code can write natural-sounding ones at build time | Low (practice only, no score) | **Build first, as a practice mode** |
| 2 | **Results → a practice queue and a pasteable tutoring plan** grounded in measured topic gaps (procedural families, at the person's level, spaced), instead of notes about the person | High | Strong for knowledge-state tailoring, retrieval and spacing; strong that guarded AI tutoring helps and unguarded hurts | High for math topics (facets exist); low for knowledge axes until calibrated | Medium (practice effects on the measure; must not imply ability tailoring) | **Build second, math first** |
| 3 | **Calibration training with feedback**, then "how sure are you vs how often you're right" carried into AI use | Medium-high | Moderate (trained calibration improves; transfer is weak) | High: the confidence scale and Brier scoring exist | Low | **Build with 1** (shared screens) |
| 4 | **"Same questions, given to AI"**: a family-level explainer of how current models do on fresh HumanBench-style items, with what it can't mean | Medium (engagement, origin story) | Weak for any person-level meaning; strong evidence of the pitfalls | Medium: panel harness exists, but released panel data are selection-biased | High (misleading comparison, D1) | **Only as a separate page, procedural only, after the owner reopens D1; never on the blob or share card** |
| 5 | **Explanation-quality harness**: proved-key items + calibrated difficulty to test whether an AI's explanations are right and pitched as asked | Medium (internal: it is how Phase AI proves its notes work) | Moderate (LLM-judge limits are known; readability prompting is unreliable) | High: extends AI.12a with automatic correctness checks | Low | **Fold into AI.12a-run** |
| 6 | **AI panel answers as item-quality and difficulty features** (internal) | Low-medium (better items, faster calibration) | Moderate (LLM-derived difficulty correlates moderately with human difficulty) | High: 1,198 raw panel files already exist | Low | **Use as a prior feature, never as a key or a norm** |
| 7 | **"Where you and AI complement each other"**, per person | Low | Weak to against at person level | Low | High (career-advice tone, high-stakes drift) | **Don't build per person**; a general explainer at most |
| — | Hosted model calls, an MCP/"send" integration, live AI feedback in the app | — | — | Conflicts with $0 and R-17.1 | — | **Drop** |

**What to do next, in order** (each has a cheap test in its section):

1. Prototype idea 1 on two families with proved keys (quantitative entry items and number series): 40 worked solutions, half with a planted error, made by code. Pilot on the owner and a few friends: does detection accuracy and confidence calibration improve over 3 rounds, and do people accept fluent wrong solutions?
2. Prototype idea 2 as a "Practise this next" card on the reveal screen for math topic groups only, plus a fixed, guarded tutoring prompt the person can paste ("give me a hint first; don't solve it for me").
3. Run idea 4's cheap test privately (fresh procedural items, all strata, under matched conditions) before deciding whether any comparison page is worth the owner reopening D1.

---

## 1. "Check the AI": practice at judging AI answers

**What it is.** A practice mode (DESIGN §10: practice mode shows feedback and does not count) where the person sees a procedural item *and* a worked solution "written by an AI assistant". Some solutions are right; some contain one planted, realistic error (a slipped sign, a misread condition, a plausible but wrong rule in a series, an off-by-one count). The person answers: right or wrong, how sure (the existing five-point scale), and, if wrong, where. Then they see the proof (the verifier's own route) and their running record: how often they caught errors, how often they "caught" errors that weren't there, and whether long, confident explanations fooled them more.

**Why this is the best fit.** It turns the origin story ("a human benchmark made by AI should feed back into AI") into the one human skill the collaboration literature says decides whether AI helps:

- Human-AI combinations underperform the best of human or AI alone on average (g = -0.23; losses on decision tasks, gains on creation tasks; combinations gain when the human beats the AI and lose when the AI beats the human) [MA, S1].
- Team performance depends on the person's model of *when the AI errs* (its error boundary), not just the AI's accuracy [LAB, S2]. Complementarity needs errors that are not strongly correlated and confidence that is calibrated [LAB + model, S3; OP, S4].
- Explanations raise acceptance of AI advice whether or not the advice is right [LAB, S5]; they reduce overreliance only when verifying is cheap [LAB, S7]. People overestimate an LLM's accuracy from its default explanations, and *longer* explanations raise confidence without raising accuracy [LAB, S8].
- Larger, more instructable models give "apparently sensible yet wrong" answers more often, including on hard questions where human supervisors frequently miss the error; there is no difficulty region where the model never errs [BENCH + human study, S9].
- Cognitive forcing (answer first, then see the AI) cuts overreliance, though people like it less [LAB, S10]. A tutorial showing the AI's fallibility improved self-assessment and reliance for people who overrated themselves [LAB, S11].
- Unguarded GPT-4 help during practice lowered later exam scores by 17% once access was removed; a guarded tutor largely avoided this [RCT, S12]. Knowledge workers who trusted AI more reported less critical thinking [OBS, S13].

Evidence for *training* error detection with feedback specifically is thinner than evidence for the problem: S11 is one lab study, and the transfer from puzzle-style items to real assistant use is untested. That is why this ships as practice, with a pilot, not as a claim.

**What to build** (concrete, from what exists):

- **Items.** Procedural families only, where the key is proved on every instance (DESIGN §4.1 G2/G3): quantitative entry items (`web/src/tasks/quant/`, generator 1.4.0 with strata 1-6 and an exact verifier per template), number series (`web/src/tasks/series/`), and later logic games (Z3-verified). No finite-bank items: their keys must never reach the browser (CLAUDE.md, DESIGN §1 item 3), and a worked solution is a key.
- **Flawed solutions by code.** Each template's verifier already computes the answer by its own exact route. A "solution renderer" writes the route's steps as text, and a "mutator" corrupts one step (sign, operand, misapplied rule, dropped case) and carries the error forward, so the wrong final answer is consistent with the shown work. This needs no model and costs nothing at run time. Property tests (fast-check): every unmutated solution ends in the key; every mutated one doesn't; exactly one step differs.
- **Optional AI-written versions, offline.** To get the fluent, confident style that fools people (S8), Claude Code can rewrite a sample of rendered solutions at build time, the way the panel runs already work (fresh subagents, each reads only its packet and writes only its raw file; ROADMAP A6). The rewritten text is re-verified by code (the final answer must still be the planted one). This also yields *naturally occurring* model errors: the hard-strata panels already logged real slips (bank `panels/m312-r1`: one Sonnet XOR miss in 58; `panels/m312-qr-r1`: one Sonnet slip in 110).
- **Screens.** Reuse the question screen and the five-point confidence scale (§3 row 12; `web/src/tasks/calibration.ts`). Add a right/wrong choice and an optional "which step". Feedback: the proof, then a small running tally ("errors caught 7 of 10; false alarms 2 of 10"). Show the solution's length as a variable the person can notice, since length is a known trust cue (S8).
- **Not a scored axis.** Keep it out of the blob and the share card. If it later becomes a measured facet ("checking worked solutions"), that needs its own validity work (DIF by math ability, since detecting an arithmetic slip is partly quantitative ability).

**Risks.** It could teach "AI is always wrong" (under-reliance hurts too; S1, S11): keep the planted-error rate near the real error rate the person would meet (say 30-50% in practice, stated plainly) and score false alarms as errors. Puzzle transfer is uncertain: the copy must not claim it makes people better at using AI (the A22 copy-claim rule applies by analogy). Code-planted errors may look unlike real ones: LLM-made math distractors are valid but miss real students' errors [BENCH, S47], so draw the mutation types from real slips (the panel's logged misses, common arithmetic errors) and check realism in the pilot. It needs a stated author: "worked solutions written by code or by an AI model; some contain a deliberate mistake", so it never deceives.

**Cheap test.** Owner plus 5-10 volunteers, 3 rounds of 12 quant/series solutions (half flawed), feedback after each round. Measures: detection d' and false-alarm rate per round; calibration (Brier) of the right/wrong judgments; acceptance of flawed solutions by length (short vs long rendering of the same error). Pass if d' rises and long-flawed acceptance falls across rounds. Cost: one generator script and a practice route; no model at run time.

---

## 2. Results → a practice queue and a guarded tutoring plan

**What it is.** Instead of telling an AI what the person is like, use results to choose *what to practise next*: topic groups where the person's answered math items show a gap, at a difficulty they will mostly get right, spaced over days. Two outputs: (a) a "Practise this next" queue inside HumanBench's practice mode (procedural items, feedback on, not counted), and (b) a short, fixed tutoring prompt the person can paste into any assistant, naming *topics and a teaching behaviour*, not traits ("I'm practising percentages and ratios. Give me one problem at a time. Hint first; don't show the full solution unless I ask; check my answer.").

**Evidence.**
- Intelligent tutoring works: step-based ITS d = 0.76 vs no tutoring, close to human tutoring [MA, S14]; g = 0.42 vs teacher-led instruction [MA, S15]; median 0.66 SD, smaller on standardised tests [MA, S16]. A research-based AI tutor beat active learning in a Harvard physics RCT [RCT, S17]; an LLM coach for human tutors raised mastery by about 4 points, more for weaker tutors [RCT, S18, recall].
- The gains come from tailoring to *knowledge state* (what is mastered, step feedback, mastery and spacing), not to ability or learning-style profiles. Matching instruction to styles has essentially no support, and aptitude-treatment interactions replicate poorly [OP, S19]. Practice testing and spacing are the two "high utility" techniques [OP review, S20]; practice tests beat restudy (g ≈ 0.6) [MA, S21, recall].
- Guardrails matter: an unguarded assistant harmed learning, a hint-first tutor did not [RCT, S12]. This is why the pasteable prompt is fixed, guarded and topic-based.
- The Part 2 study's finding carries over: topic knowledge is the one personal variable worth adapting on (expertise reversal), and HumanBench measures it per math topic first.

**What to build.**
- **Inputs.** The person's own answered items per topic group (`web/src/tasks/topics.ts`, topic groups g2 such as `quant/geometry_trig` and `quant/calculus`; the server's `hb.drill_facet`), and the axis posterior for Quantitative and Matrix & Series. Use counts and observed accuracy per topic ("you answered 6 on percentages, 2 right") until per-topic calibration exists, the same "show information, don't infer" rule the Part 2 study proposed.
- **Selection.** Pick the stratum where predicted success is about 70-85% (the 2PL prior already gives P(correct | θ, b)); prefer topics with the most misses; space repeats ≥ 1 day; vary instances (the families are unlimited).
- **The tutoring prompt.** A fixed template from a closed grammar, like the notes (R-17.3): topic names, the hint-first behaviour, no scores, no axis names, no traits. It is not a results-derived *note about the person*; it is a list of topics the person chose to practise, so it stays within the spirit of R-17.4 (the person ticks the topics; nothing is pre-ticked).
- **Measurement hygiene.** Practice on scored families inflates later scores (DESIGN §7.8 models about +0.33 SD retest gain). Either practise on sibling templates excluded from scoring, or record practice exposure in the save file and keep the "practice-adjusted" label honest. This is the main design cost.

**Risks.** Implying the profile says *how* someone learns (S19): copy says "topics to practise", never "your learning type". Low-score topics are not "weaknesses" on any share surface (R-5.6.4 by analogy). Knowledge axes (STEM, Humanities, Arts) are not ready: calibration needs thousands of sessions per axis (Part 2 study), so math only.

**Cheap test.** Within-person, 2 weeks, owner plus volunteers: half the math topic groups get the queue, half don't; a short fresh test on all groups at the end. Look for a bigger gain on practised groups than unpractised (a practice-on-different-instances effect is expected; the point is checking the queue picks useful topics and difficulties). Cost: a selector function and a card.

---

## 3. Calibration training, aimed at AI use

**What it is.** HumanBench already asks for an optional confidence on every tier-a question and scores Brier and calibration slope (§3 row 12). In practice mode, give immediate calibration feedback ("when you said 'certain' you were right 7 of 10 times") over many items, then connect it to AI use in one plain sentence: knowing how sure you should be is what lets you decide when to check an assistant.

**Evidence.** About an hour of probability training plus scored feedback improved forecasters' calibration and resolution in a field RCT [RCT, S22]. Intensive feedback improves calibration quickly, then plateaus [LAB, S23, recall]. Classroom calibration feedback helps modestly, mostly high performers, and transfers poorly across domains [OBS/OP, S24, recall]. Link to AI: people who overrate themselves under-rely on a good AI, and fixing self-assessment improved reliance [LAB, S11]; self-confidence went with more critical thinking about AI output [OBS, S13]. Models' own stated confidence is often calibrated on multiple choice when asked the right way [BENCH, S25], but people misread it from explanations [LAB, S8].

**What to build.** A practice-mode calibration round (procedural items, feedback on), a reliability diagram the person can read without numbers (dots near the diagonal; DESIGN §9 rules on uncertainty apply), and the "Check the AI" rounds of idea 1 scored the same way. The calibration line of Part 2 (AI.9, n ≥ 160) stays separate and gated.

**Risks.** Low. Do not claim transfer to real AI use. Keep it out of the blob until it is a measured axis with enough ratings (it already is one, embedded).

**Cheap test.** Owner plus volunteers: 3 rounds of 20 rated procedural items with feedback; does Brier fall and slope approach 1? Then a fresh family without feedback (transfer check).

---

## 4. "Same questions, given to AI": the literal human benchmark

**What it is.** Show people how current AI models do on HumanBench questions, so "a human benchmark made by AI" is literally both. The owner earlier ruled out a human-vs-AI overlay in v1 (D1, D13); this section says what an honest version would need, so the owner can decide whether to reopen it.

**What HumanBench's own data can and can't say.**
- **The released finite banks are filtered on model agreement.** Gate G4 (ROADMAP A6 amended) releases a finite item only if Sonnet 5.5, Opus 5.5 and Fable 5.1 all agree with its key, and the G7 waiver covers only items "on whose key all three panel models agree with no flag". So a "model score" on served LR, RC, VOC, KST, KHU, KAP and Fermi items is close to 100% by selection. Comparing a person to it would be comparing them with the item filter.
- **Emotion Reading and situational judgment keys are the panel's own ratings** (ROADMAP line on EMO/SJT: "the score is agreement with a Claude-model ensemble's judgment"). A model "scores well" there by definition.
- **Speed, span and reaction time** are trivially superhuman for a computer and say nothing about a model's thinking; matrices and rotation were given to the panel *as text* (cell attributes, cube coordinates), which hands the model what a person must read off a picture (bank `panels/m312-r1/README.md`). Panel solves are untimed and open to long reasoning, while people are timed and closed-book.
- **The raw records hold no confidence**: each answer has `id`, `answer`, `ambiguous`, `evidence` (bank `panels/*/raw-*.json`, 1,198 files), so a calibration comparison would need new runs.

**What the literature says.**
- Human tests given to LLMs need evidence of validity *for the model population*; human norms and constructs don't transfer automatically [OP, S26, S27, S28]. Use novel, controlled items and matched conditions [OP, S28]. Same score, possibly different mechanism [OP, S29].
- Model accuracy tracks the probability of the text, not human difficulty: items easy for people can be hard for models and vice versa [BENCH, S30]. Yet on average human-easy items are also model-easy, without a "safe" zone [BENCH, S9]. Analogy and matrix successes in text form [BENCH, S31] weakened on counterfactual variants [recall, S31].
- Contamination is real and detectable; fresh, matched items reveal drops of up to 8% for some families [BENCH, S32, S33, S34]; procedurally generated items reduce variance problems but also show models varying across instances of one template [BENCH, S35, S36]. HumanBench's generators are the field's recommended antidote, as long as the *instances* are fresh.
- Aggregate scores hide failure patterns; report instance-level breakdowns [OP, S37]. A review of 115 human baselines in model evaluations found most lack adequate samples, matched conditions (same instructions, time, tools) and uncertainty, so "superhuman" claims are weakly supported [OP + review, S43].
- Being outperformed by a purported AI on a visual reasoning task lowered people's sense of agency and task self-efficacy and raised AI anxiety [LAB, S44; small evidence base]. A "you vs AI" headline has a plausible cost to the person. A field experiment found AI helped on tasks inside its "jagged frontier" (+12.2% tasks, 25.1% faster, better quality) and hurt outside it (19% less likely to be correct) [RCT, S38]: the honest message is *task*-level jaggedness, not a person-vs-model ranking.

**What to build, if D1 is reopened.** A separate, static "How AI does on questions like these" page, built offline, family by family, never on the blob, the reveal or the share card:
- Fresh procedural instances only (new seeds per run; quant, series, matrices, rotation, logic games), every stratum 1-6, dated and naming the model versions.
- Matched conditions stated plainly: the model saw a text description, not the picture; untimed; one attempt; no tools. Better still, a second arm with images for multimodal models and a time-capped arm.
- Show accuracy by stratum next to the human difficulty *in words* ("questions most people find hard") once M4 calibration gives b values, and highlight the interesting part: where model and human difficulty disagree (S9, S30). No single number, no "AI beats you", no person-level percentile (the blob rules of CLAUDE.md apply in spirit).
- Leave out the finite banks, EMO, SJT, RT, span and speed, with one sentence each on why.

**Risks.** High. A person-vs-model chart invites "AI is smarter than me" readings, ranks people, and dates fast. It could also nudge the item pipeline to prefer items models fail, which is a different construct. Keep it informational, family-level and procedural.

**Cheap test (private, no UI).** Claude Code runs the three models blind on 50 fresh instances per procedural family and stratum (the `hb.verify.procedural_panel` harness, about 1,500 solves), with a time-capped prompt arm. Output: accuracy by stratum per model, and the rank correlation with the author's strata (later with calibrated b). If accuracy is flat near 100% on all strata, the page has nothing to say and D1 can stay closed.

---

## 5. An explanation-quality harness on proved keys

**What it is.** HumanBench's procedural items have proved keys and (after M4) calibrated difficulty. That makes them a clean test bed for checking whether an assistant's explanations are *correct* and *pitched as asked* (for example "build up" vs "skip the basics" from the notes grammar). This is internal: it is how Phase AI can show its notes change behaviour usefully.

**Evidence.** LLMs asked for a reading level hit it only about 15% of the time; concrete behaviours work better than levels (Part 2 study §1.1). LLM-as-judge agrees with human preferences about 80% of the time, but has position, verbosity and self-preference biases [BENCH, S39]; LLMs asked to write for an age or education level stay in their own readability range [BENCH, S46]; only 70% of ChatGPT algebra hints passed manual quality checks, and human hints gave larger learning gains [LAB, S45]. Item difficulty from LLM signals correlates moderately with human difficulty, not perfectly [BENCH, S40, S41].

**What to build.** Extend AI.12a-run (bank harness): for each notes arm, ask the model to explain a fresh procedural item; check by code that the final answer equals the key (no judge needed for correctness), count steps shown, terms defined, and whether it asked a question first; reserve the LLM judge for tone and condescension. Report correctness × pitch per arm with CIs (E-metrics of proposal §7.3).

**Risks.** Low. Don't present harness results to users as benefit (A22).

**Cheap test.** 20 items × 3 arms (build up, skip basics, no notes) × 1 model, run by Claude Code: is answer correctness unchanged across arms (non-inferiority) and do step counts differ as instructed?

---

## 6. AI panel answers as item features (internal)

**What it is.** Use the existing panel records (which model missed what; the no-passage probes `rc2-np*` that test whether a question can be answered without its passage) as features for item difficulty priors and quality flags, never as keys or norms.

**Evidence.** Item parameters from an *ensemble* of LLM respondents correlated > 0.8 with human calibrations in college algebra; single models are too uniform to mimic students [BENCH, S40]. Model uncertainty is a weak-to-moderate proxy for human MCQ difficulty [BENCH, S41]. LLM-derived difficulty is a pretest aid at best and fails most on the hardest items [BENCH, S42].

**What to build.** In the bank's calibration job (DESIGN §6.ii, §6.iii), add panel disagreement and no-passage success as covariates of the difficulty prior; check against M4's calibrated b. Note the selection problem: released items are those all models solved, so the feature has little variance in the released set; it is more useful at the draft stage.

**Risks.** Low; circularity if model-solved items crowd out items that are hard for people for human reasons.

**Cheap test.** When M4 gives b for ≥ 200 items, regress b on author stratum ± panel features; keep the feature only if it adds out-of-sample R².

---

## 7. "Where you and AI complement each other", per person

**What it is.** Telling a person which kinds of tasks they add most value on relative to AI, from their profile.

**Evidence against doing it per person.** Complementarity is the exception, not the rule (S1, S4); where it exists it is *task*-level (S38) and depends on the person's ability to verify (S2, S7), not on stable ability profiles. HumanBench measures closed-book puzzle and knowledge items, not work tasks; no study links a cognitive profile to where a person adds value beside AI. Profile-based advice drifts toward career or hiring advice, which the anti-coercion copy rules out (§17.7 "anti-coercion": results aren't valid for hiring, admissions or grades).

**What to build instead.** Nothing per person. Ideas 1 and 3 give the person the transferable part (judging AI output, knowing how sure to be). A general, research-cited explainer on the jagged frontier is fine.

**Cheap test.** None needed; revisit only if a study links profiles to human-AI team outcomes.

---

## 8. Constraints that apply to every idea

- **$0.** All model runs happen offline at build time through Claude Code subagents (as the panel and AI.12a already do). No hosted API, no in-app model call, no MCP or send integration (R-17.1).
- **Keys stay private.** Worked solutions are keys: only procedural families (keys proved, generators public by ROADMAP A1) can show them in the browser.
- **Non-diagnostic language** (R-5.6.x). No clinical words; no "weakness" framing; no single score or rank anywhere, including any AI comparison.
- **No high-stakes use.** Every new surface repeats the anti-coercion line.
- **Claims.** Until a trial shows benefit, copy says what a feature does, not that it helps (A22's rule, applied by analogy).

---

## Source table

"Checked" says how the claim was verified in this session: **abs** = abstract read through arXiv, OpenAlex or Crossref; **recall** = from background reading, not re-checked (verify before quoting in user-facing text).

| # | Source | Type | Claim used | Checked |
|---|---|---|---|---|
| S1 | Vaccaro, Almaatouq & Malone (2024), When combinations of humans and AI are useful, *Nature Human Behaviour*. https://doi.org/10.1038/s41562-024-02024-1 | MA | 106 experiments, 370 effects: human-AI combinations worse than the best alone, g = -0.23 (CI -0.39 to -0.07); losses on decisions, gains on creation; gains when the human beats the AI | abs |
| S2 | Bansal et al. (2019), Beyond Accuracy: the role of mental models in human-AI team performance, HCOMP. https://doi.org/10.1609/hcomp.v7i1.5285 | LAB | Team performance depends on the human's model of the AI's error boundary | abs |
| S3 | Steyvers, Tejeda, Kerrigan & Smyth (2022), Bayesian modeling of human-AI complementarity, *PNAS*. https://doi.org/10.1073/pnas.2111547119 | LAB + model | Hybrids beat either alone when errors are weakly correlated and confidence is calibrated | abs (detail recall) |
| S4 | Hemmer et al. (2024), Complementarity in human-AI collaboration. https://doi.org/10.48550/arxiv.2404.00029 | OP | Defines complementarity; evidence for it is thin | abs |
| S5 | Bansal et al. (2021), Does the whole exceed its parts?, CHI. https://doi.org/10.1145/3411764.3445717 | LAB | Explanations raised acceptance of AI advice whether right or wrong; no added complementarity | abs |
| S6 | Fok & Weld (2024), In search of verifiability, *AI Magazine*. https://doi.org/10.1002/aaai.12182 | OP | Explanations help only when they let the human verify the answer | abs |
| S7 | Vasconcelos et al. (2023), Explanations can reduce overreliance on AI systems during decision-making, PACM HCI. https://doi.org/10.1145/3579605 | LAB | Overreliance is a cost-benefit choice; explanations help when verifying is cheap | abs |
| S8 | Steyvers et al. (2024/2025), What large language models know and what people think they know. https://arxiv.org/abs/2401.13835 | LAB | People overestimate LLM accuracy from default explanations; longer explanations raise confidence without accuracy; confidence-matched explanations narrow the gap | abs |
| S9 | Zhou et al. (2024), Larger and more instructable language models become less reliable, *Nature*. https://doi.org/10.1038/s41586-024-07930-y | BENCH + human study | Human-easy items are model-easy on average, but no error-free region; scaled models give sensible-looking wrong answers that supervisors often miss | abs |
| S10 | Buçinca, Malaya & Gajos (2021), To trust or to think, PACM HCI. https://doi.org/10.1145/3449287 | LAB | Cognitive forcing cuts overreliance; least liked; helps high Need for Cognition more | abs |
| S11 | He, Kuiper & Gadiraju (2023), Knowing about knowing: Dunning-Kruger and reliance on AI, CHI. https://doi.org/10.1145/3544548.3581025 | LAB | Over-estimators under-rely on AI; a fallibility tutorial improved self-assessment and reliance | abs |
| S12 | Bastani et al. (2025), Generative AI without guardrails can harm learning, *PNAS*. https://doi.org/10.1073/pnas.2422633122 | RCT | ~1,000 students: unguarded GPT-4 practice, -17% on exams after removal; guarded tutor largely avoided harm | abs (figures recall) |
| S13 | Lee et al. (2025), The impact of generative AI on critical thinking, CHI. https://doi.org/10.1145/3706598.3713778 | OBS | 319 workers: confidence in AI went with less critical thinking, self-confidence with more | abs |
| S14 | VanLehn (2011), The relative effectiveness of human tutoring, ITS and other tutoring systems, *Educational Psychologist*. https://doi.org/10.1080/00461520.2011.611369 | MA | Step-based ITS d = 0.76, human tutoring 0.79 | abs |
| S15 | Ma, Adesope, Nesbit & Liu (2014), ITS and learning outcomes, *J. Educ. Psych.* https://doi.org/10.1037/a0037123 | MA | ITS vs teacher-led g = 0.42 | abs |
| S16 | Kulik & Fletcher (2016), Effectiveness of intelligent tutoring systems, *Rev. Educ. Res.* https://doi.org/10.3102/0034654315581420 | MA | Median 0.66 SD; smaller on standardised tests | abs |
| S17 | Kestin et al. (2025), AI tutoring outperforms in-class active learning, *Scientific Reports*. https://doi.org/10.1038/s41598-025-97652-6 | RCT | Research-based AI tutor beat active learning in less time | abs (size recall) |
| S18 | Wang et al. (2024), Tutor CoPilot. https://doi.org/10.21203/rs.3.rs-5363154/v1 (arXiv 2410.03017) | RCT | LLM guidance to human tutors, +4 pp mastery, +9 pp for weaker tutors | recall |
| S19 | Pashler, McDaniel, Rohrer & Bjork (2008), Learning styles: concepts and evidence, *PSPI*. https://doi.org/10.1111/j.1539-6053.2009.01038.x | OP (review) | No support for matching instruction to styles; ATIs weak | abs |
| S20 | Dunlosky et al. (2013), Improving students' learning with effective techniques, *PSPI*. https://doi.org/10.1177/1529100612453266 | OP (review) | Practice testing and spacing are the high-utility techniques | abs |
| S21 | Adesope, Trevisan & Sundararajan (2017), Rethinking the use of tests, *Rev. Educ. Res.* https://doi.org/10.3102/0034654316689306 | MA | Practice tests beat restudy (g ≈ 0.6) | abs (g recall) |
| S22 | Mellers et al. (2014), Psychological strategies for winning a geopolitical forecasting tournament, *Psych. Science*. https://doi.org/10.1177/0956797614524255 | RCT | Probability training improved calibration and resolution | abs (size recall) |
| S23 | Lichtenstein & Fischhoff (1980), Training for calibration, *OBHP*. https://doi.org/10.1016/0030-5073(80)90052-5 | LAB | Feedback improves calibration fast, then plateaus | recall |
| S24 | Hacker, Bol et al. (2000) *J. Educ. Psych.* https://doi.org/10.1037/0022-0663.92.1.160 ; Bol & Hacker (2012) calibration review, *Frontiers in Psychology* | OBS / OP | Classroom calibration gains modest, mostly high performers, weak transfer | recall |
| S25 | Kadavath et al. (2022), Language models (mostly) know what they know. https://arxiv.org/abs/2207.05221 | BENCH | Large models are well calibrated on MC/true-false in the right format | abs |
| S26 | Hagendorff et al. (2023), Machine psychology. https://arxiv.org/abs/2303.13988 | OP | Human methods on LLMs need caveats (prompt sensitivity, contamination, no assumed mechanism) | abs |
| S27 | Wang et al. (2023), Evaluating general-purpose AI with psychometrics. https://arxiv.org/abs/2310.16379 ; Löhn et al. (2024), Is machine psychology here? (INLG) | OP | Constructs and validity from humans don't transfer automatically | abs / recall |
| S28 | Ivanova (2023), Toward best research practices in AI psychology. https://arxiv.org/abs/2312.01276 | OP | Novel controlled items, matched conditions, don't over-read one test | abs |
| S29 | Mitchell & Krakauer (2023), The debate over understanding in AI's LLMs, *PNAS*. https://doi.org/10.1073/pnas.2215907120 | OP | Same score may rest on different mechanisms | DOI checked; claim recall |
| S30 | McCoy et al. (2023/2024), Embers of autoregression. https://arxiv.org/abs/2309.13638 | BENCH | Accuracy tracks text probability; human-easy can be model-hard | abs |
| S31 | Webb, Holyoak & Lu (2023), Emergent analogical reasoning in LLMs. https://arxiv.org/abs/2212.09196 ; counterfactual critiques (Lewis & Mitchell 2024) | BENCH | Text matrix/analogy success; weaker on counterfactual variants | abs / recall |
| S32 | Oren et al. (2023), Proving test set contamination in black box LMs. https://arxiv.org/abs/2310.17623 ; Sainz et al. (2023) https://arxiv.org/abs/2310.18018 ; Golchin & Surdeanu (2023) https://arxiv.org/abs/2308.08493 | BENCH / OP | Contamination inflates scores and is detectable | abs |
| S33 | Deng et al. (2023), Investigating data contamination in modern benchmarks. https://arxiv.org/abs/2311.09783 | BENCH | Models guess masked MMLU options at ~50%+ | abs (figures recall) |
| S34 | Zhang et al. (2024), GSM1k. https://arxiv.org/abs/2405.00332 | BENCH | Fresh matched items: drops up to 8%; r² = 0.36 with memorisation | abs |
| S35 | Mirzadeh et al. (2024), GSM-Symbolic. https://doi.org/10.48550/arxiv.2410.05229 | BENCH | Accuracy varies across instances of the same template | abs |
| S36 | Zhu et al. (2023), DyVal. https://arxiv.org/abs/2309.17167 ; White et al. (2024), LiveBench. https://arxiv.org/abs/2406.19314 | BENCH | Freshly generated items as the contamination remedy | abs |
| S37 | Burnell et al. (2023), Rethink reporting of evaluation results in AI, *Science*. https://doi.org/10.1126/science.adf6369 | OP | Report instance-level breakdowns, not aggregates | recall |
| S38 | Dell'Acqua et al. (2023/2026), Navigating the jagged technological frontier, *Organization Science*. https://doi.org/10.1287/orsc.2025.21838 | RCT | 758 consultants: inside frontier +12.2% tasks, 25.1% faster, better quality; outside, 19% less likely correct | abs |
| S39 | Zheng et al. (2023), Judging LLM-as-a-judge. https://arxiv.org/abs/2306.05685 | BENCH | ~80% agreement with humans; position, verbosity, self-preference biases | abs |
| S40 | Liu, Bhandari & Pardos (2024), Leveraging LLM-respondents for item evaluation. https://arxiv.org/abs/2407.10899 | BENCH | Ensemble LLM item parameters r > 0.8 with human; single models too uniform | abs |
| S41 | Zotos, van Rijn & Nissim (2024), Can model uncertainty proxy MCQ item difficulty? https://arxiv.org/abs/2407.05327 | BENCH | Weak-to-moderate correlation with human difficulty | abs (strength recall) |
| S42 | Razavi & Powers (2025). https://arxiv.org/abs/2504.08804 ; arXiv 2607.28634 (2026) | BENCH | LLM difficulty estimates moderate; worst on hard items | abs |
| S43 | Wei et al. (2025), Position: human baselines in model evaluations need rigor and transparency. https://arxiv.org/abs/2506.13776 | OP + review | 115 human baselines: most lack samples, matched conditions, uncertainty | abs (detail recall) |
| S44 | Schaap, van de Sande & Schraffenberger (2026), Being human in the age of superhuman AI, CHI EA. https://doi.org/10.1145/3772363.3799056 | LAB | Being outperformed by AI lowered agency and self-efficacy, raised AI anxiety | abs |
| S45 | Pardos & Bhandari (2023), Learning gain differences between ChatGPT and human tutor hints. https://arxiv.org/abs/2302.06871 | LAB | 70% of ChatGPT hints passed QA; human hints gave larger gains | abs |
| S46 | Rooein et al. (2023), Know your audience. https://arxiv.org/abs/2312.02065 | BENCH | LLMs don't adapt readability to the prompted audience | abs |
| S47 | Feng et al. (2024), Exploring automated distractor generation for math MCQs via LLMs. https://arxiv.org/abs/2404.02124 | BENCH | LLM distractors valid but miss real student errors | abs |

**HumanBench sources (internal, private bank cited by path only).** ROADMAP A6 amended (G4 panel rule) and the G7 waiver of 2026-10-12 (release requires all three panel models to agree with the key); ROADMAP M6.1/M6.2 and the EMO/SJT scoring note (keys from the panel); bank `panels/` (69 runs, 1,198 raw answer files with fields `id`, `answer`, `ambiguous`, `evidence`; no confidence); bank `panels/m312-r1/README.md` and `panels/m312-qr-r1` (text descriptions of pictures, the logged model slips); DESIGN §3, §4.1, §7.8, §10, §17, R-5.6.x, D1, D13.
