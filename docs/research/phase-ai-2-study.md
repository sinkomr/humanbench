# Phase AI Part 2 study: where results-based notes could help people work with AI

*Research study, 2026-10-20. Scope: ROADMAP "Phase AI" Part 2 (AI.8 onward); DESIGN §17 (R-17.x), §3, R-5.6.x. The detailed Part 2 design is in the private annex (bank `docs/proposals/ai-notes-v2.md`, cited as "proposal §x"). This document contains no item text, keys or bank data. It is a reading of the literature and of current products, not a requirement. Where it suggests a change to DESIGN or ROADMAP, the change still needs the owner's approval.*

**How to read the evidence labels.** Each claim has a source in the table at the end, with one of these types: **MA** meta-analysis or systematic review; **RCT** randomised trial (field or online); **LAB** laboratory or online experiment that is not a full trial; **OBS** observational or survey; **BENCH** benchmark or automatic evaluation of model outputs (no human outcome); **VENDOR** a company's documentation or claim about its own product; **REG** law, regulation or official guidance; **OP** opinion, framework or narrative review. "Strong", "moderate" and "weak" describe the evidence for *adapting on that variable*, not for the underlying phenomenon.

**Method and limits of this study.** Three research passes (field, products and risks, per-axis evidence and evaluation) plus the earlier Phase AI evidence and risk reviews in the bank. On the day of this study the session's web-search quota was used up, so sources were found through the OpenAlex, arXiv and Crossref APIs and fetched directly by URL. help.openai.com, openai.com, pnas.org, mdpi.com, sciencedirect.com and support.khanacademy.org refused the fetcher (HTTP 403), so some figures (Bastani 2025, Gerlich 2025, Scharfen 2018, OpenAI product details) come from earlier reading and are marked "not re-verified" in the source table. Most journal claims rest on abstracts, not full texts. The search was broad but not systematic: there is no PRISMA flow, and a dedicated reviewer would find more.

---

## Executive summary

**The short answer.** The owner's idea is sound in one place and weak in another.

- **Aiming explanations at what a person already knows works.** It is the only "match the teaching to the learner" effect that has held up across decades of research. In a 2025 meta-analysis of 60 experiments, learners new to a topic learned more with more help (d ≈ 0.5), and learners who knew it learned more with less (d ≈ −0.4). Plain-language summaries help newcomers but make experts miss limitations. The catch: what counts is knowledge of *the topic*, not general ability. HumanBench can measure that only per topic, and only with enough questions on it. So the measured part of the idea works for math topics soon and for science and humanities topics much later.
- **Choosing words from a vocabulary or reading score is weak.** Native-speaker adults already know the everyday words an assistant uses. What trips people up is a field's jargon, and that is topic knowledge again. Simplified text helps on average (+3.9 points of comprehension in a 4,563-person trial), but it helps everyone, so it belongs in everyone's notes. A personal vocabulary score adds little. The good research on vocabulary thresholds comes from second-language readers.
- **Telling an assistant what the person *is* makes answers worse.** Describing a user as less educated, a non-native speaker, or as having "learning needs" lowers accuracy, raises refusals and condescension, and softens feedback. Profiles in context also make models agree with users more. Phase 1's rule, "instructions, not traits", is the most important safeguard in the plan, and newer evidence (2025–2026) strengthens it.
- **No study has yet shown that giving an assistant notes based on someone's measured abilities beats good universal defaults.** This is a gap in the literature, not proof that it fails. It means Part 2 must be built as an experiment that measures its own benefit, which the existing plan already intends.

**Ranked areas** (expected benefit × strength of evidence × whether a HumanBench score is actually informative; section 3 has the reasoning):

| Rank | Area | Benefit | Evidence | HumanBench score informative? | Verdict |
|---|---|---|---|---|---|
| 1 | **Depth by topic** (skip the basics / ask first / build up), from topic knowledge | High | Strong (expertise reversal meta-analysis; plain-language summaries) | Yes for math topic groups once calibrated; knowledge areas only at facet level, after thousands of sessions | Build first (math), as suggestions |
| 2 | **"Help me learn" vs "help me do"** (hint first, let me try) | High | Strong (tutoring RCTs: unguarded answers lowered exam scores by 17%) | No: it is a goal, not an ability | Already in Part 1 as a choice; keep it a choice |
| 3 | **Numbers: counts and absolute risks, and how much arithmetic to show** | Medium–high | Strong for the universal format; moderate that low-numeracy readers gain most | Yes (short numeracy tests predict well) | Universal default now; measured "show the arithmetic" per math topic as part of rank 1 |
| 4 | **The assistant stating its own uncertainty and how to check** | Medium–high | Strong for first-person uncertainty and sources (helps everyone) | No for the universal line; weak–moderate for a personal over/under-confidence line | Universal now; personal calibration line later, opt-in |
| 5 | **Technical terms: define field-specific words on first use** | Medium | Moderate (jargon translation helps low-knowledge readers most; costs experts little if brief) | Partly (topic knowledge; VOC for the rare-word tail) | Universal default plus a person's own setting; measured word register deferred |
| 6 | **Length and answer-first** | Low–medium | Weak direct; long explanations raise trust without raising accuracy | Reading speed could inform the person, not the AI | Keep as the person's toggle; optionally show the reading time |
| 7 | **Brainstorming: several divergent options, I draft first** | Low–medium | Moderate (AI ideas help less-creative writers most but make work more alike) | Weak | A universal line for the writing context; do not use the score |
| — | Spatial, working memory, reaction time, processing speed, matrix reasoning, logic as "general reasoning", emotion reading, Fermi as its own line | Low | Weak, none, or against (learning-styles matching fails) | Weak or no | Do not drive any line (as proposal §4.3 already says) |

**Recommendation.** Build these first, in this order:

1. **Prove that assistants follow the notes before adding results.** Finish the Part 1 checks that are still open (AI.12a, AI.13, AI.12c), re-key gate results by model *version* and date, and update the install steps for product changes found in this study. Claude's Styles help page is gone. Gemini Gems become "skills" from November 2026. Microsoft 365 Copilot memory is searchable by employers. The ChatGPT limit reportedly rose to over 5,000 characters. A benchmark found that assistants follow stated preferences less than 10% of the time after about ten turns. Adherence is therefore the first thing to measure, not an assumption.
2. **Measured math-topic suggestions** (AI.8 zone engine plus AI.10 builder suggestions). This is the one results-derived line with strong evidence and an informative score. It stays behind the F12 gate on real data. While that gate is closed, the builder can show the person their own answered questions per topic in plain words ("you've answered 6 questions on percentages"), to inform the setting they choose. That shows information; it doesn't infer anything.
3. **Universal "say how sure you are" lines now, and the personal calibration line (AI.9) later.** The server computes calibration, the evidence for first-person uncertainty is RCT-grade, and the power calculation in proposal §4.2 already sets the bar (160 rated answers).
4. **A small, pre-registered human study, before the large trial.** Run a within-person, counterbalanced comprehension study (n ≈ 50–80) with three conditions: the person's own notes, someone else's notes ("shuffled"), and no notes. The primary outcome is a delayed quiz with the text hidden, not satisfaction. Also measure how well people's own topic settings agree with their measured zones. If self-set and measured mostly agree, measured lines add little and Part 2 can stay small.
5. **A numeracy-presentation demonstrator** (counts and absolute risks, arithmetic shown or not, crossed with the math score). The literature here is the strongest, and the study can run on fixed texts with no assistant in the loop.

**Defer or drop from the Part 2 plan:**

- the measured word register (AI.18, AI.19's word model, AI.25, F14, F15) and the reading-comprehension sentence-linking line P7. The proposal itself puts the odds of passing below even, and self-set word lines do the job.
- goals mode, Sharpen and facet-weighted selection (AI.11, AI.17, AI.21b). They are large measurement features justified mainly by notes, and should wait until math suggestions show value.
- observed knowledge-facet lines (part of AI.22). Calibration needs roughly 2,700–4,050 sessions per knowledge axis.
- any MCP or "send" integration. It conflicts with R-17.1.
- the requirement that real-user trials show *superiority* at small n. Use non-inferiority on accuracy and condescension as the release gate, and report benefit as an estimate with its uncertainty.

**Design principles** that the evidence supports (section 6.3):

- opt-in per line;
- results inform the person, and the person instructs the AI;
- instructions, never traits or levels;
- "simplify the wording, never the facts";
- ask first when unsure;
- comfortable and stretch modes the person picks;
- every line visible, editable, dated and removable with one switch;
- no clinical words.

---

## 1. The field now

### 1.1 What "personalisation" means in LLM research
- Most LLM personalisation research is about **imitating a user's past outputs or preferences**: writing a headline in their style, predicting their rating, recalling stated preferences. Examples are the LaMP and LaMP-QA benchmarks, PersonaMem and the 2024–2025 surveys [BENCH, OP]. Evaluation there is almost entirely automatic (overlap metrics, LLM judges). It says almost nothing about whether people *understand or learn more*, which is HumanBench's question.
- **Following stated preferences is unreliable.** In PrefEval (ICLR 2025, 3,000 preference–query pairs), most models followed a stated preference less than 10% of the time once the conversation reached about ten turns (about 3,000 tokens) [BENCH]. Putting the preference in the system or custom-instruction slot helps, and so does reminding. For HumanBench, notes must be short, sit in the instructions slot, and be checked across many turns (proposal E18 does this).
- **Asking for a reading level works only roughly.** LLMs asked to write for an age or grade hit the target readability only about 15% of the time [BENCH, Rooein 2023]. In a meta-analysis of 57 ophthalmology studies, LLM patient materials were *no* more readable than controls unless explicitly prompted for a grade level [MA, Sachdeva 2026]. "Rewrite for low literacy" kept about 80% of key messages, so about one in five was lost [OBS, Ayre 2024]. Prompting alone did not give grade-appropriate tutoring across six levels; fine-tuning did [BENCH, Oh 2026]. Proposal §4.6 draws the right conclusion: concrete, checkable behaviours ("define each term on first use", "show every step") rather than levels.

### 1.2 Telling the model who the user is
This is the best-replicated finding relevant to Phase AI, and it is a warning:
- Users described as less educated, less proficient in English or from outside the US got lower accuracy and truthfulness, more refusals and more condescending replies, across GPT-4, Claude 3 Opus and Llama 3 [BENCH, Poole-Dayan, AAAI-26].
- Prompts written by non-native speakers got worse answers, and telling the model the user's nativeness anchored it further [BENCH, Reusens 2024].
- In automated essay feedback, essays held constant but "marked" by race, language or disability got more praise and less critique. This is the "soft bigotry of low expectations", done by a machine [LAB, Tan 2026 "Marked Pedagogies"].
- Personas assigned to the model degraded reasoning for about 80% of personas in GPT-3.5 and 42% in GPT-4-Turbo, even though the models reject the stereotype when asked directly [BENCH, Gupta 2024]. Sociodemographic prompting changes outputs in ways that are unstable across wordings [BENCH, Beck 2024].
- Models infer demographics from stereotyped cues, and these inferences can persist even after the user states otherwise [LAB, Neplenbroek 2025]. Covert dialect prejudice survives alignment [BENCH, Hofmann 2024, *Nature*].
- **User profiles in context increase sycophancy.** Two weeks of real users' context raised agreement, and memory profiles raised it most: +45% for Gemini 2.5 Pro [BENCH on real data, n = 38 users, Jain 2026]. Agents that write user claims into memory later treat them as trusted fact ("persistent sycophancy") [BENCH, PASB 2026].
- Personas or identity lines in system prompts do not improve factual accuracy [BENCH, Zheng 2024]. Demographic descriptors explain under 10% of variance in what individuals want [BENCH, Hu & Collier 2024].

**Implication.** Describing the person is the riskiest thing a note can do. Concrete behavioural instructions are what change outputs usefully. Phase AI's "instructions, not traits" rule (R-17.2, R-17.3) is right. The fixed accuracy and anti-sycophancy clauses (F3, F4) are necessary, and the trait-worded arm of the gate is worth keeping as a running check.

### 1.3 Simplification and plain language
- **On average, simplification helps adults understand.** In a randomised online study (N = 4,563, 31 texts), LLM-simplified text raised multiple-choice comprehension by 3.9 points overall: +14.6 in biomedical texts and +3.5 in legal ones. Perceived effort was lower, and the effect held with the text hidden [RCT, Guidroz 2025, Google-authored].
- **A meta-analysis** of LLM-simplified radiology reports (38 studies, 12,922 reports) found much higher perceived understandability and reading level 5–6 grades lower. It also found errors in 7.2% of reports, 0.9% of them clinically significant [MA, Alabed 2026, *Lancet Digital Health*].
- **AI plain-language summaries** in a randomised study of 362 clinicians narrowed the gap between people comfortable and uncomfortable with jargon. However, 26% of the summaries had errors on specialist review [RCT-style quality-improvement study, Tailor 2025].
- **Structured plain-language summaries** improved understanding of benefits, harms and evidence quality, from 18% to 53%, *independent of education level* [RCT, Santesso 2015]. Explaining technical terms helped, and too much statistical detail hurt the reading experience [2 RCTs, N ≈ 2,200 each, Kerwer 2021].
- **The expertise reversal shows up in LLM summaries.** Novices benefited from plain summaries, but readers familiar with the field missed important details such as study limitations when summaries were too plain [LAB, 3 studies, August 2024, CHI].

**Implication.**
- Plain words, a clear structure and terms defined on first use help nearly everyone, so they belong in everyone's notes. The Part 1 defaults U1, U2, U3 and U7 already do this.
- Simplifying costs some accuracy, so "keep every fact, number and caveat" (F3, U7) is needed.
- The one thing worth personalising is *how much to assume per topic*, because plain text hurts experts and dense text hurts newcomers.

### 1.4 Tutoring, scaffolding and "meet the learner where they are"
- **Step-based intelligent tutoring systems** are almost as effective as human tutors (d ≈ 0.76 vs 0.79; answer-only systems ≈ 0.31) [MA, VanLehn 2011]. Other meta-analyses report g ≈ 0.41–0.66 [MA, Ma 2014; Kulik & Fletcher 2016]. Their "adaptivity" is to a *measured, step-level knowledge state* (knowledge tracing), not to a trait profile.
- **LLM tutoring with a designed teaching method helps. Unguarded answer-giving harms.**
  - In a field RCT with about 1,000 students, plain GPT-4 raised practice scores by 48% but lowered unassisted exam scores by 17%. A hint-only tutor had no harm [RCT, Bastani 2025, *PNAS*; not re-verified].
  - A research-designed physics tutor beat in-class active learning [crossover RCT, N = 194, Kestin 2025].
  - Tutor CoPilot raised mastery by 4 percentage points, and by 9 points for students of weaker tutors [preregistered RCT, 900 tutors, 1,800 students, Wang 2025].
  - A supervised LearnLM tutor matched or beat human tutors [exploratory RCT, N = 165, vendor-authored, Google DeepMind/Eedi 2025].
  - GPT-4 after-school tutoring in Nigeria gave about 0.3 SD [RCT, working paper, De Simone 2025].
  - Meta-analyses of ChatGPT in education report moderate-to-large effects but warn about small, short, often unblinded studies, frequently with performance measured *with* the AI [MA, Deng 2025].
- **Pedagogy written as instructions is a recognised control surface.** Google frames LearnLM as "pedagogical instruction following" through system-level instructions [VENDOR, LearnLM 2024]. That is the same slot HumanBench notes occupy.
- **Cognitive load and expertise reversal.** The 2025 meta-analysis (60 experiments, 176 effect sizes, N = 5,924) found that the person-by-instruction interaction holds when the moderator is **prior knowledge**: help novices (d = 0.51) and step back for experts (d = −0.43). "Giving assistance to novices appears more important than withholding it for experts" [MA, Tetzlaff 2025]. Segmenting helps nearly everyone, and its moderators are the material and pacing, not learner working memory [MA, Rey 2019].

**Implication.** The help-to-learn vs help-to-do distinction (K1 modes) has the strongest outcome evidence of anything in the notes, and it is a *goal* the person states, not an ability. The "meet me where I am" idea is supported when it means *per-topic knowledge*. It is also supported when it means "ask one quick question to find out", which is what tutoring systems do with step-level checks.

### 1.5 Adapting to measured level vs adapting to stated preference
- **Learning-styles "meshing" has no adequate supporting evidence** [OP/review, Pashler 2008], so "visual learner" matching is out. Format preferences do not predict learning:
  - infographics were preferred, with no knowledge difference [3 RCTs, Buljan 2018];
  - voice tutoring was preferred, with no learning difference [RCT, N = 86, 2026];
  - "dyslexia fonts" were preferred, with no performance benefit [LAB, Kuster 2018].
- **Feeling of learning is not learning.** Active instruction produced more learning but *lower* perceived learning [RCT crossover, Deslauriers 2019]. Fluent delivery raised judgments of learning, not recall [LAB, Carpenter 2013]. Conditions that make learning feel easy often reduce retention [OP/review, Soderstrom & Bjork 2015]. People prefer, and trust more, AI answers that flatter them [RCT, N = 1,604, Cheng 2025].
- **Letting learners choose has about zero effect on achievement** (g ≈ 0.05) [MA, Karich 2014, not re-verified]. It does no harm, and it is not a learning lever either.
- **Measured-level adaptation is supported only through prior knowledge** (expertise reversal). Old aptitude-by-treatment work found a weak, inconsistent pattern: more structure for lower general ability, less for higher. Most such interactions did not replicate [OP, Cronbach & Snow 1977; Snow 1989].

**What this means for HumanBench:**
- **Stated preferences** are the right basis for *format, length, voice, tone and goal*. These are matters of taste or purpose, and inferring them from scores has no support; for format and accessibility it is also a health inference.
- **Measured level** is the right basis only for *how much to assume about a topic*. Even there, people's own judgement is a reasonable alternative. No study compares the two head to head for AI explanations. HumanBench could produce one (section 5).
- People's preferences pull towards fluent, flattering, easy answers. So a "challenge me" or "teach me" mode the person chooses deliberately, and an accuracy clause they can't remove, matter more than any inferred line.

### 1.6 Numeracy and risk communication
- **Natural frequencies** raise correct Bayesian reasoning from about 4% to 24% [MA, McDowell & Jacobs 2017]. Many people still convert frequencies back to probabilities, so the AI should do the arithmetic in counts [LAB, Weber 2018].
- **Icon arrays and absolute risks help everyone.** Reviews report that low-numeracy readers often gain most [OP/review, Garcia-Retamero & Cokely 2013, 2017]. The often-cited Galesic 2009 experiments, however, found that icon arrays helped low- *and* high-numeracy people [LAB]; that study is frequently misread as a low-numeracy-only effect, including in the earlier Phase AI review. Relative risk reductions persuade without improving understanding [MA, Akl 2011 Cochrane, not re-verified]. Reducing the number of figures helps less-numerate readers and doesn't hurt numerate ones [LAB, Peters 2007].
- **A short numeracy test is genuinely informative.** The Berlin Numeracy Test (1–4 items; 21 studies, n = 5,336) predicts everyday risk understanding beyond general ability [psychometric, Cokely 2012]. Numeracy can't be reliably inferred from education or intelligence [OP/review, Nelson 2008].
- **No trial was found in which tailoring to a measured numeracy score beat a universal best-practice format.** The demonstrated interactions are lab results, and the helpful action harms no one. That argues for a default rather than a profile, except for *how much arithmetic to show*, which is topic knowledge again.

### 1.7 Calibration, trust and reliance
- **The assistant's own expressed uncertainty is the strongest lever, and it is universal.**
  - First-person hedges ("I'm not sure, but…") reduced reliance on wrong answers and raised accuracy [preregistered RCT, n ≈ 400, Kim 2024, FAccT].
  - Sources and visible inconsistencies reduce reliance on wrong answers, while explanations raise reliance on right and wrong answers alike [preregistered experiment, N = 308, Kim 2025, CHI].
  - Default LLM explanations make people overestimate accuracy, longer explanations raise confidence without raising accuracy, and matching the wording to the model's confidence closes the gap [LAB, several samples, Steyvers 2025, *Nature Machine Intelligence*].
- **The person's own calibration matters somewhat.** How well people's self-confidence matched their accuracy predicted how appropriately they relied on AI, and calibration interventions helped [LAB, Ma 2024, CHI]. Overconfident people under-use correct AI advice [LAB, He 2023]. But AI use inflated self-assessment for everyone, and higher AI literacy went with *worse* self-assessment [LAB, N = 246 + replication, Fernandes 2025], so unaided calibration may not carry over to AI use.
- **Explanations raise acceptance of AI advice whether or not the AI is right** [LAB, Bansal 2021]; explanations that are easy to verify reduce over-reliance [LAB, 5 studies, N = 731, Vasconcelos 2023].
- **Making people decide first reduces over-reliance.** "Cognitive forcing" (decide, then see the AI) reduced over-reliance more than explanations did, but people liked it less, and it helped people high in need for cognition most [LAB, Buçinca 2021]. Automation bias is mitigated by confidence indicators and by presenting information rather than directives [MA, Goddard 2012].

### 1.8 Accessibility and non-native speakers
- **W3C's cognitive-accessibility guidance** recommends clear words, literal language, short blocks, memory support and *user-settable* personalisation, not inferred profiling [OP/guidance, W3C COGA 2021].
- **Most dyslexia-specific claims are weaker than assumed.** "Dyslexie" fonts gave no benefit [LAB, Kuster 2018]. Fonts are also a display matter that a note can't change. One preprint found that LLM *annotation* (highlighting key content, without rewriting) helped adults with dyslexia, more so with more severe difficulty [LAB, n = 150, LARF 2025].
- **Non-native speakers.** No adult outcome trial of LLM explanations tailored to non-native speakers was found. The adjacent evidence is the second-language vocabulary-coverage research and the simplification RCT. The safer move is to state concrete preferences ("define idioms; short sentences") rather than "I'm a non-native speaker" [BENCH, Reusens 2024].
- **No major assistant has a reading-level or accessibility setting** in its official documentation (section 2). People have to write these as free text, which is exactly what the Part 1 format lines (FMT1–3, VOICE, W1–W3) give them. R-17.14's rule is right: format and accessibility lines are chosen, never inferred.

### 1.9 What has and has not been shown

| Outcome | Shown to help | Not shown, or shown not to help |
|---|---|---|
| Comprehension | Plain language and structure (universal); defining terms; natural frequencies and absolute risks; more help for newcomers to a topic, less for experts | Readability-grade targets as a control; format matched to stated style; personal vocabulary-based rewriting for native speakers |
| Learning | Designed tutoring (hints, steps, attempt first); worked examples for novices; segmenting | Unguarded answer-giving (harms exam scores); learner control as such; matching to learning styles |
| Task success | Plain summaries for non-experts; AI tutoring of human tutors | Notes based on ability profiles: **no study either way** |
| Trust calibration | First-person uncertainty; sources; decide-first designs | Longer explanations (raise trust without accuracy); profile context (raises sycophancy) |
| Satisfaction | Fluent, warm, flattering answers raise it | Satisfaction is not evidence of learning; warmth training costs 10–30 points of accuracy |
| Fairness | — | Describing users as less educated, non-native or "with learning needs" lowers quality and critique |

---

## 2. Products: how assistants personalise today (checked 2026-10-20)

| Product | What a person can set | Placement and limits | Memory and where it goes | Published evaluations |
|---|---|---|---|---|
| **ChatGPT** | Custom instructions; personality presets (e.g. friendly, efficient); saved memories and chat-history reference; Projects with project memory; Temporary Chat; Study mode | Settings > Personalization. The limit reportedly rose from about 1,500 to over 5,000 characters in July 2026 (secondary source; the official page refused the fetcher) | Training on by default for personal accounts unless opted out; business admins can access chats; deleting a chat doesn't delete saved memories (not re-verified) | Sycophancy postmortem after the April 2025 GPT-4o rollback [VENDOR]; no published outcome evaluation of Study mode found |
| **Claude** | "Instructions for Claude" (account-wide), Project instructions, Skills (tone and format), memory (all plans; view, edit, pause, reset; separate per Project), chat search (paid), Incognito, Learning mode | The help page lists no character limit; the "Styles" help article returns 404, so treat Styles as retired or renamed | Deleting a chat doesn't remove memories drawn from it; 30-day deletion, or up to 5 years if training is allowed | Vendor sycophancy audits: 4.5 models 70–85% lower than 4.1, but only 16.5–37% corrected course once a conversation already leaned wrong [VENDOR]; disempowerment analysis of 1.5M chats [OBS, VENDOR] |
| **Gemini** | "Instructions for Gemini" and remembered facts under "Personal Intelligence"; past-chat memory; connected apps; Gems (moving to "skills" on personal accounts from November 2026); Guided Learning | Personal accounts only (not work, school or supervised); 18+ for past-chat memory | Tied to Gemini Apps Activity; Google says telling Gemini to forget "doesn't always work perfectly"; removal needs deleting chats *and* disconnecting apps | LearnLM expert-rater preference +31% over GPT-4o [VENDOR]; memory profile +45% agreement sycophancy for Gemini 2.5 Pro [BENCH] |
| **Microsoft 365 Copilot** | Custom instructions, saved memories, memory inferred from chat history | Preview; "enhanced personalization" on by default; admins can switch it off | Stored in a hidden folder of the user's Exchange mailbox; retention policies don't apply; **admins can search, export and delete memories**; no audit log; admins can see temporary chats | None found |
| **Khanmigo** | No learner-written instructions; personalisation comes from platform progress; teacher tools | Under-18 access needs a parent or district | Platform-side | Common Sense rating only; no RCT found |
| **Duolingo Max** | None (implicit from course progress) | Subscription | Platform-side | None published |
| **Tutoring modes** (Study mode, Learning mode, Guided Learning) | A toggle for Socratic, hint-first behaviour | Mode picker or Project | As the parent product | Vendor announcements only; the best outcome evidence is still independent RCTs of designed tutors (section 1.4) |

**What this means for HumanBench.**
- **The instructions slot is the right target.** Every major assistant now has a persistent free-text instructions slot. None has a reading-level or accessibility control. Vendors increasingly write pedagogy in exactly this slot (LearnLM, Study mode, Learning mode).
- **The surfaces change monthly.** Styles has been retired or renamed, Gems are becoming skills, and Gemini instructions moved under "Personal Intelligence". R-17.10's dated, per-destination install steps, re-checked each release, are necessary. The AI.12c smoke test should be repeated when a destination changes, not only once.
- **Memory is the bigger privacy risk.**
  - Notes pasted into a chat may be distilled into memories that outlive the chat.
  - On work accounts, the employer can search those memories (Microsoft 365 Copilot).
  - Six major developers' privacy policies all train on chat data by default [OBS, King 2025, Stanford HAI].

  The "placement" and "provider" copy (§17.7) should add three things:
  - say plainly "don't paste into a work or school account";
  - explain that memories need deleting separately;
  - stop naming "Styles".
- **Vendors' own norms support the fixed clauses.** OpenAI's Model Spec says not to be sycophantic but says nothing on adapting to a user's level. Claude's constitution lists condescension about users' ability to handle information as a failure. A note that asks for withheld substance works against the model's own rules. A note that asks for "plain wording, full facts" works with them.

---

## 3. Where personalisation helps most

### 3.1 How the ranking was made
Each candidate adaptation was scored on three things:
- **Expected benefit:** how much better understanding, learning or task success could get, and for how many people.
- **Strength of evidence:** for *adapting on this variable*, not for the phenomenon.
- **Informativeness of a HumanBench measurement:** whether a short online test score on that axis, with its real error after one to three sessions, tells the AI anything a universal default or the person's own setting doesn't already cover.

An area scores well only if all three are good. A strong universal effect, such as natural frequencies, goes into everyone's notes and needs no score.

### 3.2 The axes, one by one

| Axis | Could the score change how an AI should respond? | Evidence for adapting on it | Is a short HumanBench score informative? | Recommendation |
|---|---|---|---|---|
| **Quantitative Reasoning** | Yes. How many arithmetic steps to show, whether to give a worked example first, notation, per topic group | Strong (expertise reversal); moderate for numeracy as a moderator of format | **Yes** per topic group after calibration; ≥ 6 own-axis items | Build: measured suggestions per math topic (AI.8, AI.10), behind F12 |
| **STEM knowledge** | Yes. Assume or define terms per subject; worked example vs problem | Strong (prior knowledge) | Yes at facet level with ≥ 5 items; a broad STEM score is too coarse | Defer measured lines until calibration volume; self-set now |
| **Humanities knowledge** | Yes, as above (context, references, terms) | Strong (as prior knowledge) | As above | As above |
| **Arts & Practical / Life** (finance, health literacy) | Yes, as above. Plain language and checks on health and money topics are best as universal precautions | Strong as universal; moderate for tailoring | As above | Universal defaults; self-set topics |
| **Vocabulary** | Partly. Gloss rare or technical words; never inflate vocabulary | Moderate, and mostly from second-language readers; the coverage–comprehension relation is linear, with no sharp threshold | Yes for the rare-word tail, though native adults know about 42k lemmas, so the tail is mostly jargon (topic knowledge) | Self-set W1–W3 now; measured register deferred indefinitely |
| **Reading Comprehension** | Weakly. Sentence linking and cohesion for low-knowledge readers; avoid over-plain text for experts | Moderate for cohesion × *knowledge*; weak for a reading score alone | Weak | No measured line; universal "say how each step follows" |
| **Logical Reasoning / Logic Games** | Only notation: formal symbols vs words | Moderate (notation is knowledge) | Weak, unless items are tagged by notation (AI.2 tags) | Self-set NT now; observed NT later, as planned |
| **Matrix & Series** | No. "Less structure for high scorers" is old, small and unreplicated | Weak | Reliable score, wrong lever | Never (it would read as a general-ability grade) |
| **Working Memory** | One step at a time and running summaries help everyone | Strong as universal; weak as tailored | Weak incremental value | Universal U3; a "one step at a time" format line the person chooses |
| **Spatial** | Describe spatial arrangements in words, step by step, or with a simple diagram, for everyone | Weak; the direction of the interaction is unstable (compensator vs enhancer) | Weak | Never as "visual learner"; a universal line at most |
| **Reaction Time** | No | None | No | Never |
| **Processing & Reading Speed** | Length budget, answer first | Weak; long answers inflate trust | Informative about reading time, not about outcomes | The person's toggle; optionally *show* their reading time to inform the choice (an owner decision) |
| **Fermi Estimation** | Give ranges and orders of magnitude; show estimation steps | No tailoring literature | Weak | Fold into U6 (how sure, how to check); can feed calibration |
| **Calibration** | How strongly to push back or invite checks; "ask me to commit first" | Strong for AI-side uncertainty (universal); weak–moderate for the person's own calibration as an input | Weak-to-yes: only the *sign* of over- or under-confidence, after ≈ 160 rated answers | Universal lines now; C1/C2 later, opt-in |
| **Emotion Reading** | No. Tone tailoring by score has no evidence, and LLMs already outperform average humans on these tests | None | No | Never (R-5.6.x; proposal §4.3) |
| **Creative Thinking** | When brainstorming, offer several divergent options and let the person draft first | Moderate for the universal line: AI ideas helped less-creative writers most but made stories more alike; co-creation beats editing an AI draft | Weak | Universal writing-context line; never from the score |

### 3.3 Ranked candidate areas, with reasons
1. **Depth by topic, from topic knowledge.** This is the one replicated person-by-instruction interaction. It is what the owner meant by "meet the human where they are at". HumanBench's math items carry topic tags (AI.2, AI.3), so a zone per topic group is computable. Proposal §4.4 shows the real limits:
   - wrong "skip" or "build" lines can't be kept under 5% on M1's uncalibrated difficulties;
   - after calibration, only about 1 in 4 math-topic settings is decided after one session, and about 1 in 3 after three.

   The benefit is real but reaches a minority of topic-person pairs. Knowledge-area lines need calibration volume the project doesn't have.
2. **Learn vs do.** This has the largest outcome effects, in both directions, in the literature. It is not measurable from a test, so it stays a choice. It is already in Part 1 (K1).
3. **Number presentation.** The universal format is strong, and the score is informative for *how much arithmetic to show*. Most of the benefit comes from the universal U5. The personal part rides on rank 1's percent, ratio and probability topics.
4. **Uncertainty and checking.** The universal lines are RCT-supported. The personal calibration line is opt-in, needs several sessions, and may not transfer to AI use (Fernandes 2025). It is worth building because it is cheap once CAL exists, but its claim should stay modest.
5. **Technical terms.** "Define field-specific terms on first use" is a universal default plus a self-set choice. Measuring a personal vocabulary register is expensive (explanatory IRT, licensing, a probe) for a weak native-speaker effect.
6. **Length.** Keep it as a choice. Long answers raising trust is a reason for a shorter default, not for a personal line.
7. **Brainstorming.** A universal line in the writing context.

### 3.4 "Measured level" or "stated preference": what each is good for

| Use measured level for | Use stated preference for | Use universal defaults for |
|---|---|---|
| How much to assume per topic (suggested, never applied without consent) | Goal (learn, do, challenge), length, format, voice, tone, interests, sentence style, language, accessibility needs | Plain words, structure, answer first, define terms, few new ideas at a time, counts and absolute risks, keep caveats, say how sure and how to check, correct me plainly |
| The direction of over- or under-confidence (opt-in, high n) | Whether to receive measured suggestions at all | |

People are poor judges of what helps them learn (Kirschner 2013; Deslauriers 2019). But letting them choose costs nothing in achievement (Karich 2014), and choice protects autonomy and dignity. That matters more here than in a classroom, because the "teacher" is a model known to talk down to people described as less able. The evidence therefore favours **measured information shown to the person, who then chooses**. It does not favour measured instructions inserted for them.

---

## 4. Risks and limits, and the safeguards the field recommends

| Risk | What the evidence says | Safeguard (and where Phase AI already has it) |
|---|---|---|
| **Lowered expectations and condescension** (the "soft bigotry" of simplified answers) | AI side: user bios naming low education or non-native English lower accuracy and raise condescension (Poole-Dayan); "marked" students get more praise and less critique (Tan 2026); persona and stereotype effects persist even against explicit statements (Gupta 2024; Neplenbroek 2025). Human side: teacher-expectation effects are real but usually small, and larger for stigmatised groups (Jussim & Harber 2005) | Never describe the person (R-17.2, R-17.3 lint). Fixed accuracy clause F3. "Build up" lines always keep full depth. No results-derived build lines on the two lowest math rungs until E3 passes (floor rule). The trait-worded arm stays in every gate run. **Add:** prefer level-*raising* lines ("skip the basics", "symbols are fine") as the measured lines shipped first, because they carry no condescension risk |
| **Sycophancy** | Models affirm users about 50% more than humans do, and people prefer and trust the flattering answers (Cheng 2025, N = 1,604, preregistered). Social sycophancy is 45 points above humans (ELEPHANT). Profiles in context raise agreement (Jain 2026). Warmth fine-tuning adds 10–30 points of errors, worse when users sound sad (Ibrahim 2025). Even improved models rarely correct course once a conversation leans wrong (Anthropic 2025) | Fixed F4 ("tell me plainly when I'm wrong"). No opinions or claims about the person in notes. Any warmth or encouragement line is paired with "simplify wording, never facts" |
| **Deskilling and over-reliance** | Unguarded answers raised practice scores and lowered exam scores (Bastani 2025). Confidence in AI goes with less critical thinking (Lee 2025, survey, N = 319). Cross-sectional offloading correlations (Gerlich 2025) and an EEG study (Kosmyna 2025, N = 54) are weak and over-reported. Disempowering patterns in 1.5M conversations are rated favourably in the moment (Anthropic 2026) | Teach-me and challenge-me modes (K1); "let me try first" offered as a choice; the person's own goal wins. Do not let a measured line make the AI do *more* for someone in a learning context |
| **Filter bubble** | Custom instructions and memory shift substantive content, not just style (OBS audit, 2025). Personalisation within bounds: user-level preferences must not override accuracy (Kirk 2024) | Notes govern *form* (depth, steps, terms, format), never which facts or viewpoints appear (F3, U7) |
| **Third-party misuse** (employers, schools, insurers) | Most HumanBench axes are what EEOC guidance calls cognitive tests; using them without job validation risks disparate impact. EU AI Act Annex III (education, employment) high-risk duties now apply from 2027-12-02. GDPR Art. 22 and UK ICO guidance (updated 2026-03-31) cover profiling. Microsoft 365 Copilot memories are searchable by admins. Common Sense rates AI teacher assistants "moderate risk" and warns about student profiles | Anti-coercion copy (§17.7); notes are unverifiable by design (no scores, no "verified" export); a Report-a-problem category for being asked for notes (AI.26); F20. **Add:** say "don't paste into a work or school account" explicitly, citing the admin-search fact |
| **Privacy** | All six large US developers train on chats by default (King 2025). Memories outlive deleted chats (Claude, ChatGPT, Copilot); Gemini admits imperfect forgetting | Local-only generation (R-17.1); data minimisation (R-17.12); provider warning. **Add:** "memories need deleting separately" in the removal steps |
| **Measurement error** | One session gives roughly ±0.5 SD per axis; retest gains of about d = 0.33 on a first retest (Scharfen 2018, not re-verified); proposal §4.4 shows wrong lines can't be kept under 5% on uncalibrated difficulties | Zones need P ≥ .90 on the *own-axis* estimate plus topic-difficulty uncertainty; "ask first" when undecided; suggestions only, never pre-ticked; practice-adjusted, eligible sessions only (R-17.5) |
| **Staleness** | Knowledge changes; κ drift is unknown (κ = .01 per month [SPEC]) | Self-expiring header (H) and E20; review-by banner; the person re-copies notes |
| **Clinical inference** | Inferring format or accessibility needs from speed or memory scores is a health inference (GDPR Art. 9 risk) and stigmatising | Format lines are chosen, never inferred (R-17.4, R-17.14); no clinical words (R-5.6.x); EMO, RT, PS and WM never feed a line |
| **Over-claiming** | The field has no RCT of ability-profile notes | The claim string "not yet shown to help" until F18 and F19 pass (A22) |

**What the field recommends in general.**
- Microsoft's human–AI interaction guidelines (Amershi 2019) ask a system to:
  - make clear what it can do and how well (G1, G2);
  - explain why it did something (G11);
  - update and adapt cautiously (G14);
  - offer global controls (G17);
  - notify people of changes (G18).
- Google's PAIR guidebook asks for user control over the data used and for an explanation of the data behind each recommendation.
- NIST AI 600-1 lists confabulation, homogenisation, privacy and human–AI configuration (automation bias) as generative-AI risks.
- Goddard 2012 recommends confidence indicators and presenting information rather than directives.

Phase AI's design matches these closely: suggest then confirm, a drawer explaining each line, one switch to remove all notes settings, dated withdrawal notices. The gaps are small:
- a global "turn off all lines based on my results" switch distinct from "remove all notes settings";
- explicit work-account advice.

---

## 5. How to evaluate personalisation

### 5.1 What the field measures, and the traps
- **Primary outcomes.**
  - Tested comprehension or transfer, ideally **delayed** and with the text **hidden** (Guidroz 2025 is a good template).
  - Task accuracy with and without the AI (Bastani 2025).
  - Appropriateness of reliance (Schemmer 2023) for calibration and trust.
- **Secondary outcomes.**
  - Time on task and instructional efficiency.
  - Cognitive load: Paas single item; the Leppink 10-item scale; raw NASA-TLX.
  - Preference.
  - Perceived condescension.
- **Satisfaction is not learning.** This is the most repeated warning in the literature (Deslauriers 2019; Carpenter 2013; Buljan 2018; Cheng 2025). Preference should never be the primary outcome.
- **Readability formulas** are manipulation checks, not outcomes: they explain little of human-judged ease (CLEAR corpus) or eye-tracked processing.
- **LLM judges** agree with humans about 80% of the time on generic quality (Zheng 2023). They favour longer answers, the first-shown answer and their own model family, so use a different family, both orders, and length control, and validate against human labels. Proposal §7.3's κ ≥ .60 rule is right.
- **LLM-simulated users** misportray and flatten groups (Wang 2025) and do not reproduce individual learners' ratings (Furuhashi 2026). They are fine for testing *adherence* (does the AI ask once, then pitch?) and never valid as evidence of benefit to people.
- **Personalisation benchmarks** (LaMP, PrefEval, PersonaGym) measure preference recall or persona consistency. PrefEval-style multi-turn adherence is the part to borrow.
- **Power.**
  - A two-condition within-person comparison at d ≈ 0.4 needs more than 50 people (Brysbaert 2019).
  - An interaction (does tailoring help low scorers more?) needs hundreds.
  - With small samples, significant effects are exaggerated (Vasishth & Gelman 2021), so report estimates and intervals and commit to predictions in advance.

### 5.2 What a small project can feasibly run
1. **The adherence check** (no people; compute only). Does each line change the intended observable feature, across turns and destinations? This is the existing gate (E7, E7d, E13, E16–E18), plus deterministic checks.
2. **A within-person comprehension study** (n ≈ 50–80; volunteers; about 30 minutes each).
   - **Materials:** 8–12 short explanations on topics the person has a decided zone for.
   - **Conditions:** own notes / shuffled (another person's) notes / no notes, Latin-square counterbalanced.
   - **Outcomes:** 3–4 questions per text with the text hidden, plus a 2–7-day delayed retest.
   - **Analysis:** a mixed model with crossed person and item effects.
   - **What it can and can't detect:** it is powered for a main effect of about d = 0.4, but not for zone × condition. Report that interaction as an estimate.
3. **A self-vs-measured agreement check** inside the same consented kit. Before seeing results, the person sets each topic. Afterwards, compare with the zone engine. High agreement means measured lines add little. Low agreement, where the measured zone predicts the quiz better, is the strongest case for Part 2.
4. **Blind paired preference** (Bradley–Terry; cheap). This is the existing taste test (AI.15). Keep it labelled as the person's impression.
5. **A reliance task for calibration lines** (n ≈ 60–150), Kim 2024-style: an AI that is sometimes wrong, with and without the uncertainty and "let me commit first" lines. Outcome: appropriateness of reliance.
6. **A numeracy presentation demonstrator** (n ≈ 100–200, fixed texts): counts and absolute risks, arithmetic shown or not, crossed with the math score.
7. **Pre-registration** on OSF; nulls published on the site's "Does it help?" page.

### 5.3 What the Part 2 plan already plans
- **The behaviour gate** (proposal §7.3) has metrics E1–E22, positive controls PC1 and PC2, and these conditions:
  - none / generic / T0 / T0 + personal;
  - **shuffled** (someone else's notes);
  - **trait-worded**.

  Its arms are multi-turn (simulated user), headless coding, expired header, memory host and results talk. The judge is gated on κ ≥ .60.
- **Claim validity:** F12 (held-out zone accuracy on real data), F13 (topic variance τ̂ ≥ .20).
- **Language validity:** F14 and F15.
- **Real users:**
  - **Arm F** is a fixed-text blinded crossover: matched vs mismatched vs generic explanations on decided topics, with 3 fresh items per topic. It tests the aptitude-by-treatment crossover (F19).
  - **Arm B** brings the person's own assistant: personal lines vs T0 only, quiz primary. It requires non-inferiority and then superiority (F18).
  - **Power:** 199–265 completers for d_z = .20; about 256 for Arm F.
- **Decision rules:**
  - F16 and F17 decide which line types exist;
  - F12–F15 decide which inputs drive them;
  - F18 and F19 decide what the copy may claim.

### 5.4 Critique in light of the evidence
**What the plan gets right.**
- The **shuffled-notes condition** is the right control. It separates "personalised" from "any extra instruction helps". The field rarely uses it.
- **Positive controls** that must be detected, and **non-inferiority on accuracy** (E1) as a gate, are better practice than most published personalisation work.
- **Arm F tests the expertise-reversal crossover directly.** This is the same bar that learning styles failed, and the correct one.
- The **copy-claim rule** (nothing implies benefit until F18 and F19 pass) matches the state of the evidence.
- **Measured vs self-set is explicitly exploratory**, which is honest given the 351–787 completers it would need.

**Where it should change.**
1. **Add a delayed, text-hidden outcome to Arm F and Arm B.** At present the outcome is three fresh items right after reading. Immediate performance overstates learning (Soderstrom & Bjork 2015; Bastani 2025). Use a 2–7-day retest on a subset as the key secondary outcome.
2. **Run a small pilot of Arm F before M2 scale, using a different moderator.** Fixed texts don't need the zone engine. Pilot with a three-question pretest per topic as the moderator (n ≈ 60–100), report posteriors rather than a p < .05 interaction, and pre-register. If the crossover is not visible with a direct pretest, it won't be visible with HumanBench zones either. This brings the key evidence forward by many months.
3. **Make self-vs-measured agreement a planned output** (section 5.2 item 3). It is cheap, needs no assistant, and decides how much Part 2 measurement is worth building.
4. **Key gate statuses to model version and date, not only family.** Models change within a family (vendor sycophancy figures moved 70–85% between versions), and product surfaces change monthly. Statuses older than one model release, or six months, should fall back to "experimental".
5. **Test level-raising and level-lowering lines separately, and ship raising first.** "Skip the basics" carries none of the condescension risk that "build up" does, and the expertise-reversal meta-analysis says helping novices matters more than stepping back for experts. So the *self-set* build line is the valuable one, and the *measured* skip line is the safe one. That favours shipping measured skip lines first and keeping measured build lines on "ask first" longer. This strengthens the floor rule; it does not replace it.
6. **Add perceived condescension by real users to Arm B** as a co-primary safety outcome, analysed for people in build zones. The plan's F18 has a 5-point condescension non-inferiority; make sure build-zone participants are not averaged away.
7. **Never use the simulated-user arm as evidence of benefit.** E17 already uses it only for adherence; keep it that way in any public copy.
8. **Relax F18 superiority as a gate.** Non-inferiority on accuracy and condescension should decide whether lines stay. Benefit should be reported as an estimate with its interval ("no measured benefit yet"), as the plan already allows.
9. **Drop F14 and F15 from the critical path.** Word-register lines are deferred (section 6), so their gates aren't needed now.
10. **Add a universal-line arm for uncertainty**: first-person uncertainty and sources vs none, on a reliance task. It is the cheapest RCT-backed line to verify on real assistants.

---

## 6. Recommendations for Phase 2

### 6.1 Build first (3–5 items, in order)
1. **Adherence and surfaces before results.**
   - Complete AI.12a (smoke gate), AI.13 (labels and think-aloud) and AI.12c (surface smoke).
   - Re-key statuses to model version and date.
   - Update install and removal steps:
     - Claude: instructions, Projects and Skills; stop naming Styles;
     - Gemini: "Personal Intelligence", and Gems becoming skills;
     - Copilot: don't paste into work accounts; admins can search memory;
     - ChatGPT: the larger limit, but keep short notes at ≤ 1,500 characters;
     - everywhere: delete memories separately.

   *Why first:* PrefEval shows adherence decays over a conversation, and nothing downstream matters if the lines aren't followed.
2. **Measured math-topic suggestions** (AI.8s → AI.8 → AI.10).
   - Keep the F12 gate on real data.
   - Ship skip-side measured suggestions before build-side ones.
   - Keep the floor rule.
   - Until F12 passes, the builder can *show* the person how many questions they have answered per math topic, in words, to inform their own setting. The owner must decide whether a count is acceptable under R-17.8, which currently forbids "you solved" phrasing for inferred lines. A count of answered questions is not an estimate.
3. **Uncertainty and checking.**
   - Now: strengthen the universal U6 line with the RCT wording pattern ("when you're unsure, say so in the first person, give a source, and point out anything inconsistent"), after it passes the gate.
   - Later: AI.9 (C1/C2), unchanged (n ≥ 160, 96% CI, suggest-only).
4. **A pre-registered small human study:**
   - the within-person own/shuffled/none comparison with a delayed outcome;
   - the self-vs-measured agreement check;
   - an Arm F pilot with a direct pretest.

   This replaces waiting for M2 scale to learn anything.
5. **A numeracy-presentation demonstrator.** Fixed texts, strongest literature, no assistant needed. It checks the pipeline end to end, and the result informs whether U5 needs a personal companion line at all.

### 6.2 Defer or drop
| Item | Action | Reason |
|---|---|---|
| Measured word register (AI.18, the word model of AI.19, AI.25; F14, F15; W suggestions in AI.22) | **Defer indefinitely** | Weak native-speaker evidence; jargon is topic knowledge; heavy infrastructure and licensing; the proposal's own odds are below even; self-set W1–W3 work now |
| P7 sentence linking from reading comprehension | **Drop** | Weak; the cohesion effect runs through topic knowledge; universal "say how each step follows" covers it |
| Goals mode, Sharpen, facet-weighted selection (AI.17, AI.11, AI.21b) | **Defer** until math suggestions show value | Large (L/M) measurement features justified mainly by notes |
| Observed knowledge-facet lines (AI.22 knowledge part, AI.21) | **Defer** until calibration volume exists | About 2,700–4,050 sessions per axis to calibrate, then 5–7 sessions per person |
| Observed logic notation (AI.22 NT) | Keep, low priority | Cheap once tags exist; notation is knowledge |
| MCP server or any send integration | **Drop** | Conflicts with R-17.1 |
| Arm B superiority as a release gate | **Change** to non-inferiority plus an estimate | Underpowered at realistic n |
| AI.16 adult-relevant quant templates | **Keep** (it grows the QR pool, which rank 1 needs) | Directly serves the best-evidenced line |

### 6.3 Design principles
1. **Always opt-in, per line.** Self-set lines are pre-ticked; results-based lines never are (R-17.7).
2. **Results inform the person; the person instructs the AI.** Show what was observed in plain words and let the person choose. Never insert a measured instruction they haven't confirmed.
3. **Instructions, never traits.** Write "start from a small example and show every step", not "I'm a beginner"; and never levels, scores, grades, axis names, ages or language status (R-17.3).
4. **Simplify the wording, never the facts.** Every note carries the accuracy and anti-sycophancy clauses; any warmth or plain-language line is paired with "keep every fact, number and caveat".
5. **When unsure, ask.** Undecided topics become "ask me one quick question first", once per conversation. This is the tutoring-system move, and it fails gracefully.
6. **Comfortable and stretch.** The person picks "teach me", "just do it" or "challenge me", and can say "deeper" or "more steps" at any time; the chat wins over the notes (F1).
7. **Everything visible, editable, dated and removable.** Each line has a drawer: why it's there, how sure it is, what research does and doesn't support, when it was checked and with which assistants. One switch removes all results-based lines.
8. **Universal first.** Spend personalisation only where there is an interaction (topic knowledge); put everything that helps nearly everyone into defaults.
9. **Non-diagnostic language.** No clinical words anywhere (R-5.6.x); format and accessibility lines are named by format and chosen, never inferred.
10. **Claim nothing until shown.** "Designed from research; not yet shown to help" until the human trials pass.

---

## Source table

"NR" means the source was not re-read on 2026-10-20 (blocked or paywalled); its figures come from earlier reading or the abstract. Types: MA, RCT, LAB, OBS, BENCH, VENDOR, REG, OP (as defined at the top).

| # | Claim used here | Source | URL | Type |
|---|---|---|---|---|
| 1 | Personalisation research is mostly style or preference imitation with automatic metrics | Zhang, Rossi et al. 2024, survey (TMLR 2025) | https://arxiv.org/abs/2411.00027 | OP |
| 2 | Persona of the model vs persona of the user are distinct literatures | Tseng et al. 2024 | https://arxiv.org/abs/2406.01171 | OP |
| 3 | Pluralistic and personalised alignment techniques | Guan et al. 2025 survey | https://arxiv.org/abs/2504.07070 | OP |
| 4 | Retrieval-based personalisation imitates users' past outputs | Salemi et al., LaMP (ACL 2024) | https://arxiv.org/abs/2304.11406 | BENCH |
| 5 | Personalised long-form QA judged by rubric, not comprehension | Salemi & Zamani 2025, LaMP-QA | https://arxiv.org/abs/2506.00137 | BENCH |
| 6 | Stated preferences are followed < 10% after about 10 turns, zero-shot | Zhao et al. 2025, PrefEval (ICLR) | https://arxiv.org/abs/2502.09597 | BENCH |
| 7 | Models struggle to infer implicit personas from history | Jiang et al. 2025, PersonaMem-v2 | https://arxiv.org/abs/2512.06688 | BENCH |
| 8 | Lower accuracy, more refusals and condescension for users described as less educated or non-native | Poole-Dayan, Roy & Kabbara, AAAI-26 | https://arxiv.org/abs/2406.17737 | BENCH |
| 9 | Covert dialect prejudice survives alignment | Hofmann et al. 2024, *Nature* | https://arxiv.org/abs/2403.00742 | BENCH |
| 10 | Persona information in reasoning prompts changes accuracy | Bai et al. 2025 | https://arxiv.org/abs/2505.10013 | BENCH |
| 11 | Agents store user claims in memory and later treat them as fact | PASB 2026 | https://arxiv.org/abs/2607.10526 | BENCH |
| 12 | User memory profiles raise agreement sycophancy most (+45% Gemini 2.5 Pro) | Jain et al., CHI 2026 | https://arxiv.org/abs/2509.12517 | BENCH (real user context, n = 38) |
| 13 | Custom instructions and memory shift substantive content | Audit of ChatGPT personas 2025 | https://arxiv.org/abs/2511.04706 | OBS |
| 14 | Persona prompts don't improve factual accuracy | Zheng et al., EMNLP Findings 2024 | https://doi.org/10.18653/v1/2024.findings-emnlp.888 | BENCH |
| 15 | Persona variables explain < 10% of variance in annotations | Hu & Collier, ACL 2024 | https://arxiv.org/abs/2402.10811 | BENCH |
| 16 | Personalisation-induced hallucinations | Sun et al. 2026 | https://arxiv.org/abs/2601.11000 | BENCH |
| 17 | Persona-assigned models show implicit reasoning bias (80% of personas, GPT-3.5) | Gupta et al., ICLR 2024 | https://arxiv.org/abs/2311.04892 | BENCH |
| 18 | Sociodemographic prompting is unstable across wordings | Beck et al., EACL 2024 | https://arxiv.org/abs/2309.07034 | BENCH |
| 19 | Stereotype-driven implicit personalisation persists against stated identity | Neplenbroek et al., EMNLP 2025 | https://arxiv.org/abs/2505.16467 | LAB |
| 20 | Feedback for "marked" students shows positive-feedback and withholding bias | Tan, Phalen & Demszky 2026 | https://arxiv.org/abs/2603.12471 | LAB |
| 21 | Non-native prompts get lower-quality answers | Reusens et al. 2024 | https://arxiv.org/abs/2406.17385 | BENCH |
| 22 | Assistants hit stated readability levels about 15% of the time | Rooein et al. 2023 | https://arxiv.org/abs/2312.02065 | BENCH |
| 23 | "Rewrite for low literacy": about grade 11; about 20% of key messages lost | Ayre et al. 2024, *J Gen Intern Med* | https://doi.org/10.1007/s11606-023-08469-w | OBS |
| 24 | LLM patient materials no more readable unless grade-prompted | Sachdeva et al. 2026, *Can J Ophthalmol* | https://doi.org/10.1016/j.jcjo.2026.07.006 | MA |
| 25 | LLM-simplified radiology reports: understandability up; 7.2% errors, 0.9% clinically significant | Alabed et al. 2026, *Lancet Digit Health* | https://doi.org/10.1016/j.landig.2025.100960 | MA |
| 26 | AI plain summaries narrowed the jargon-comfort gap; 26% had errors | Tailor et al. 2025, *JAMA Ophthalmol* | https://doi.org/10.1001/jamaophthalmol.2025.0351 | RCT (quality-improvement) |
| 27 | Structured plain-language summary: 18% → 53% understanding, independent of education | Santesso et al. 2015 | https://doi.org/10.1016/j.jclinepi.2014.04.009 | RCT |
| 28 | Infographic preferred, no knowledge difference | Buljan et al. 2018 | https://doi.org/10.1016/j.jclinepi.2017.12.003 | RCT |
| 29 | Explaining terms helps; too much statistical detail hurts | Kerwer et al. 2021 | https://doi.org/10.3389/fpsyg.2021.771399 | RCT |
| 30 | LLMs fail lay readability while staying correct | RephQA 2025 | https://arxiv.org/abs/2509.16360 | BENCH |
| 31 | Prompting alone fails grade-specific tutoring; fine-tuning needed | Oh et al. 2026 | https://arxiv.org/abs/2601.06225 | BENCH |
| 32 | LLM simplification to targets is inconsistent | Educational simplification eval 2025 | https://arxiv.org/abs/2501.09158 | BENCH |
| 33 | LLM simplification: +3.9 points comprehension, lower effort (N = 4,563) | Guidroz et al. 2025 | https://arxiv.org/abs/2505.01980 | RCT |
| 34 | Plain summaries help novices; experts miss limitations | August et al. 2024 (CHI) | https://arxiv.org/abs/2403.04979 | LAB |
| 35 | Step-based tutoring d ≈ 0.76 vs human 0.79 | VanLehn 2011 | https://doi.org/10.1080/00461520.2011.611369 | MA |
| 36 | Intelligent tutoring median ES 0.66 | Kulik & Fletcher 2016 | https://doi.org/10.3102/0034654315581420 | MA |
| 37 | Intelligent tutoring g ≈ 0.41 vs teacher-led | Ma et al. 2014 | https://doi.org/10.1037/a0037123 | MA |
| 38 | Tutor CoPilot +4 pp, +9 pp for weaker tutors' students | Wang et al. 2025 | https://arxiv.org/abs/2410.03017 | RCT |
| 39 | Supervised LearnLM tutor ≥ human tutors (N = 165) | Google DeepMind / Eedi 2025 | https://arxiv.org/abs/2512.23633 | RCT (exploratory, vendor) |
| 40 | Pedagogy as system-level instruction following; rater preference +31% | LearnLM Team 2024 | https://arxiv.org/abs/2412.16429 | VENDOR |
| 41 | Designed AI tutor beat active learning (N = 194) | Kestin et al. 2025, *Sci Rep* | https://doi.org/10.1038/s41598-025-97652-6 | RCT |
| 42 | Unguarded GPT-4: +48% practice, −17% exam; tutor version ≈ 0 harm (NR) | Bastani et al. 2025, *PNAS* | https://doi.org/10.1073/pnas.2422633122 | RCT |
| 43 | GPT-4 after-school tutoring ≈ 0.3 SD | De Simone et al. 2025, World Bank WP 11125 | https://documents.worldbank.org/ | RCT (working paper) |
| 44 | Structured tutor beat consumer AI; voice preferred, no learning difference | "When AI Tutors Speak" 2026 | https://arxiv.org/abs/2609.23958 | RCT (N = 86) |
| 45 | AI framed as a fallible peer improved misconception learning | AI peer 2025 | https://arxiv.org/abs/2504.00408 | RCT |
| 46 | ChatGPT in education: positive effects, low-quality studies (NR) | Deng et al. 2025, *Comput Educ* | https://doi.org/10.1016/j.compedu.2024.105224 | MA |
| 47 | Expertise reversal: novices d = 0.51 with help; experts d = −0.43 | Tetzlaff et al. 2025, *Learn Instr* | https://doi.org/10.1016/j.learninstruc.2025.102142 | MA |
| 48 | Prior knowledge strongly predicts learning | Simonsmeier et al. 2022 | https://doi.org/10.1080/00461520.2021.1939700 | MA |
| 49 | Segmenting helps; moderators are material, not learner WM | Rey et al. 2019 | https://doi.org/10.1007/s10648-018-9456-4 | MA |
| 50 | Learning-styles meshing unsupported | Pashler et al. 2008 | https://doi.org/10.1111/j.1539-6053.2009.01038.x | OP (review) |
| 51 | Learners are poor judges of what helps them | Kirschner & van Merriënboer 2013 | https://doi.org/10.1080/00461520.2013.804395 | OP (review) |
| 52 | Feeling of learning ≠ learning | Deslauriers et al. 2019, *PNAS* | https://doi.org/10.1073/pnas.1821936116 | RCT (crossover) |
| 53 | Fluent instructors raise judged, not actual, learning | Carpenter et al. 2013 | https://doi.org/10.3758/s13423-013-0442-z | LAB |
| 54 | Learner control ≈ 0 effect (g ≈ 0.05) (NR) | Karich, Burns & Maki 2014 | https://doi.org/10.3102/0034654314526064 | MA |
| 55 | Aptitude-treatment interactions rarely replicate (Cronbach & Snow 1977; Snow 1989) | Cronbach & Snow 1977 (book) | — | OP |
| 56 | Learning vs performance; desirable difficulties | Soderstrom & Bjork 2015 | https://doi.org/10.1177/1745691615569000 | OP (review) |
| 57 | Personalised learning poorly defined; little causal evidence (NR) | Bernacki et al. 2021 | https://doi.org/10.1007/s10648-021-09615-8 | MA (systematic review) |
| 58 | Natural frequencies 4% → 24% correct | McDowell & Jacobs 2017 | https://doi.org/10.1037/bul0000126 | MA |
| 59 | People convert frequencies back to probabilities | Weber et al. 2018 | https://doi.org/10.3389/fpsyg.2018.01833 | LAB |
| 60 | Icon arrays helped both low- and high-numeracy people | Galesic et al. 2009 | https://doi.org/10.1037/a0014474 | LAB |
| 61 | Visual aids help diverse groups, often low numeracy most | Garcia-Retamero & Cokely 2013 | https://doi.org/10.1177/0963721413491570 | OP (review) |
| 62 | Fewer figures help less-numerate readers without harming others (NR) | Peters et al. 2007 | https://doi.org/10.1177/1077558706298290 | LAB |
| 63 | Less numerate more swayed by format and narrative | Dieckmann et al. 2009 | https://doi.org/10.1111/j.1539-6924.2009.01279.x | LAB |
| 64 | Relative risk persuades without better understanding (NR) | Akl et al. 2011, Cochrane | https://doi.org/10.1002/14651858.CD006776.pub2 | MA |
| 65 | Short numeracy test predicts risk understanding beyond general ability | Cokely et al. 2012, Berlin Numeracy Test | https://doi.org/10.1017/S1930297500001819 | OBS (psychometric) |
| 66 | Numeracy can't be inferred from education; short tests could tailor | Nelson et al. 2008 | https://doi.org/10.1007/s12160-008-9037-8 | OP (review) |
| 67 | Separate per-outcome risk formats beat integrated ones | Wallace et al. 2024, *Med Decis Making* | https://doi.org/10.1177/0272989X241258466 | RCT |
| 68 | LLM confidence gap; long explanations raise trust without accuracy | Steyvers et al. 2025, *Nat Mach Intell* | https://arxiv.org/abs/2401.13835 | LAB |
| 69 | First-person uncertainty lowers reliance on wrong answers, raises accuracy | Kim et al. 2024, FAccT | https://arxiv.org/abs/2405.00623 | RCT (preregistered online) |
| 70 | Sources and inconsistencies reduce reliance on wrong answers | Kim et al. 2025, CHI | https://doi.org/10.1145/3706598.3714020 | LAB (preregistered) |
| 71 | Human self-confidence calibration predicts appropriate reliance | Ma et al. 2024, CHI | https://doi.org/10.1145/3613904.3642671 | LAB |
| 72 | AI use inflates self-assessment; AI literacy → worse calibration | Fernandes et al. 2025, *CHB* | https://doi.org/10.1016/j.chb.2025.108779 | LAB |
| 73 | Overconfident people under-rely on correct AI advice | He, Kuiper & Gadiraju 2023, CHI | https://arxiv.org/abs/2301.11333 | LAB |
| 74 | Explanations raise acceptance regardless of correctness | Bansal et al. 2021, CHI | https://doi.org/10.1145/3411764.3445717 | LAB |
| 75 | Easy-to-verify explanations reduce over-reliance | Vasconcelos et al. 2023 | https://doi.org/10.1145/3579605 | LAB |
| 76 | Cognitive forcing reduces over-reliance; disliked; helps high need for cognition | Buçinca et al. 2021 | https://arxiv.org/abs/2102.09692 | LAB |
| 77 | Appropriateness-of-reliance metric | Schemmer et al. 2023, IUI | https://doi.org/10.1145/3581641.3584066 | LAB |
| 78 | Automation bias mediators and mitigators | Goddard et al. 2012, *JAMIA* | https://academic.oup.com/jamia/article/19/1/121/732254 | MA |
| 79 | Cognitive accessibility patterns; user-settable personalisation | W3C COGA 2021 | https://www.w3.org/TR/coga-usable/ | REG (guidance) |
| 80 | Dyslexie font: no benefit; preference unrelated to performance | Kuster et al. 2018 | https://doi.org/10.1007/s11881-017-0154-6 | LAB |
| 81 | LLM annotation helped adults with dyslexia (preprint) | LARF 2025 | https://arxiv.org/abs/2504.00941 | LAB |
| 82 | Coverage–comprehension roughly linear (second-language readers) | Schmitt, Jiang & Grabe 2011 | https://doi.org/10.1111/j.1540-4781.2011.01146.x | OBS |
| 83 | 98% coverage claim only partly replicated | Kremmel et al. 2023 | https://doi.org/10.1111/lang.12622 | LAB (replication) |
| 84 | Native adults know about 42k lemmas | Brysbaert et al. 2016 | https://doi.org/10.3389/fpsyg.2016.01116 | OBS |
| 85 | High-cohesion text helps low-knowledge readers; can hurt high-knowledge readers | McNamara et al. 1996 | https://doi.org/10.1207/s1532690xci1401_1 | LAB |
| 86 | Background knowledge drives comprehension | Smith et al. 2021 | https://doi.org/10.1080/02702711.2021.1888348 | MA (critical review) |
| 87 | Readability formulas explain little of judged ease | Crossley et al. 2023, CLEAR | https://doi.org/10.3758/s13428-022-01802-x | OBS (corpus) |
| 88 | Readability models weakly related to eye-tracked processing | Gruteke Klein et al. 2025 | https://arxiv.org/abs/2502.11150 | LAB |
| 89 | Silent reading ≈ 238 wpm non-fiction | Brysbaert 2019, *JML* | https://doi.org/10.1016/j.jml.2019.104047 | MA |
| 90 | Spatial ability and visualisations: compensation pattern (NR) | Höffler 2010 | https://doi.org/10.1007/s10648-010-9126-7 | MA |
| 91 | Compensator vs enhancer direction unstable | Kühl et al. 2022 | https://doi.org/10.1007/s10648-021-09650-5 | OP (review) |
| 92 | Working-memory ATIs fragmented | Sana & Fenesi 2025 | https://doi.org/10.3390/bs15060765 | OP (review) |
| 93 | LLMs outperform average humans on ability-EI tests | Schlegel et al. 2025, *Commun Psychol* | https://doi.org/10.1038/s44271-025-00258-x | BENCH |
| 94 | AI ideas help less-creative writers most; stories more alike | Doshi & Hauser 2024, *Sci Adv* | https://doi.org/10.1126/sciadv.adn5290 | RCT |
| 95 | Co-creation beats editing an AI draft | McGuire et al. 2024, *Sci Rep* | https://doi.org/10.1038/s41598-024-69423-2 | LAB |
| 96 | Satisfaction vs workload measures | Hart 2006, NASA-TLX | https://doi.org/10.1177/154193120605000909 | OP (review) |
| 97 | Cognitive-load scale | Leppink et al. 2013 | https://doi.org/10.3758/s13428-013-0334-1 | OBS (psychometric) |
| 98 | LLM judge ≈ 80% human agreement; position, verbosity, self biases | Zheng et al. 2023 | https://arxiv.org/abs/2306.05685 | BENCH |
| 99 | Pairwise preference with Bradley–Terry | Chiang et al. 2024, Chatbot Arena | https://arxiv.org/abs/2403.04132 | BENCH |
| 100 | Length bias in LLM judges | Saito et al. 2023 | https://arxiv.org/abs/2310.10076 | BENCH |
| 101 | LLM-simulated participants misportray and flatten groups | Wang, Morgenstern & Dickerson 2025 | https://arxiv.org/abs/2402.01908 | LAB |
| 102 | Six fallacies of substituting LLMs for participants | Lin 2025, *AMPPS* | https://doi.org/10.1177/25152459251357566 | OP |
| 103 | LLMs simulate individual learner evaluations poorly | Furuhashi et al. 2026 | https://doi.org/10.48550/arxiv.2609.35376 | LAB |
| 104 | Power: > 50 people for a two-condition within design at d ≈ 0.4 | Brysbaert 2019, *J Cognition* | https://doi.org/10.5334/joc.72 | OP (methods) |
| 105 | Low power exaggerates effects; report estimates | Vasishth & Gelman 2021 | https://doi.org/10.1515/ling-2019-0051 | OP (methods) |
| 106 | Claude: account instructions, Project instructions, Skills | Anthropic Help Center | https://support.claude.com/en/articles/10185728-understanding-claude-s-personalization-features | VENDOR |
| 107 | Claude memory: all plans; editable; outlives deleted chats | Anthropic Help Center | https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context | VENDOR |
| 108 | Claude data retention | Anthropic Privacy Center | https://privacy.claude.com/en/articles/10023548-how-long-do-you-store-my-data | VENDOR |
| 109 | Gemini personalisation: personal accounts only | Google Gemini Help | https://support.google.com/gemini/answer/15637730 | VENDOR |
| 110 | Gems moving to skills from November 2026 | Google Gemini Help | https://support.google.com/gemini/answer/15146780 | VENDOR |
| 111 | Gemini instructions; forgetting "doesn't always work perfectly" | Google Gemini Help | https://support.google.com/gemini/answer/16598625 | VENDOR |
| 112 | Gemini past-chat memory: 18+, deletion requires chats and apps | Google Gemini Help | https://support.google.com/gemini/answer/16598469 | VENDOR |
| 113 | M365 Copilot memory: hidden mailbox folder, admin eDiscovery, no audit log | Microsoft Learn (2026-09-02) | https://learn.microsoft.com/en-us/microsoft-365/copilot/copilot-personalization-memory | VENDOR |
| 114 | ChatGPT custom instructions limit reportedly > 5,000 characters | MindStudio blog 2026 (secondary) | https://www.mindstudio.ai/blog/chatgpt-custom-instructions-character-limit | OP (secondary) |
| 115 | ChatGPT custom instructions and memory (NR, 403) | OpenAI Help Center | https://help.openai.com/en/articles/8590148-memory-faq | VENDOR |
| 116 | Study mode announcement (NR, 403) | OpenAI 2025 | https://openai.com/index/chatgpt-study-mode/ | VENDOR |
| 117 | Claude Learning mode | Anthropic 2025 | https://www.anthropic.com/news/introducing-claude-for-education | VENDOR |
| 118 | Gemini Guided Learning | Google 2025 | https://blog.google/products/gemini/new-gemini-tools-students-august-2025/ | VENDOR |
| 119 | Khanmigo: guided, no learner-written instructions | Khan Academy | https://www.khanmigo.ai/ | VENDOR |
| 120 | Duolingo Max features; no efficacy data | Duolingo 2023 | https://blog.duolingo.com/duolingo-max/ | VENDOR |
| 121 | Sycophancy audits 70–85% lower; poor course-correction | Anthropic 2025 | https://www.anthropic.com/news/protecting-well-being-of-users | VENDOR |
| 122 | GPT-4o sycophancy rollback postmortem (NR, 403) | OpenAI 2025 | https://openai.com/index/expanding-on-sycophancy/ | VENDOR |
| 123 | Sycophancy is general and driven by preference training | Sharma et al., ICLR 2024 | https://arxiv.org/abs/2310.13548 | BENCH |
| 124 | Models affirm users 50% more than humans; users prefer it (N = 1,604) | Cheng et al. 2025 | https://arxiv.org/abs/2510.01395 | RCT (preregistered) + BENCH |
| 125 | Social sycophancy 45 points above humans | Cheng et al. 2025, ELEPHANT | https://arxiv.org/abs/2505.13995 | BENCH |
| 126 | Sycophancy in 58% of cases | Fanous et al. 2025, SycEval | https://arxiv.org/abs/2502.08177 | BENCH |
| 127 | Warmth training: +10–30 points errors | Ibrahim et al. 2025 | https://arxiv.org/abs/2507.21919 | LAB |
| 128 | LLM essay writing: lower engagement (N = 54; contested) | Kosmyna et al. 2025 | https://arxiv.org/abs/2506.08872 | LAB |
| 129 | Confidence in AI goes with less critical thinking (N = 319) | Lee et al. 2025, CHI | https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/ | OBS |
| 130 | AI use correlates with lower critical thinking (NR) | Gerlich 2025, *Societies* | https://www.mdpi.com/2075-4698/15/1/6 | OBS |
| 131 | Disempowering patterns in 1.5M conversations; rated favourably | Anthropic 2026 | https://www.anthropic.com/research/disempowerment-patterns | OBS (vendor) |
| 132 | Cognitive tests and disparate impact | US EEOC | https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures | REG |
| 133 | Prohibited practices incl. emotion inference at work and school | EU AI Act Art. 5 | https://artificialintelligenceact.eu/article/5/ | REG |
| 134 | Annex III high-risk duties from 2027-12-02 | EU AI Act timeline | https://artificialintelligenceact.eu/implementation-timeline/ | REG |
| 135 | Automated decisions and profiling | GDPR Art. 22 | https://gdpr-info.eu/art-22-gdpr/ | REG |
| 136 | Profiling guidance updated 2026-03-31 | UK ICO | https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/automated-decision-making-and-profiling/what-is-automated-individual-decision-making-and-profiling/ | REG |
| 137 | AI teacher assistants "moderate risk"; student profiles | Common Sense Media 2025 | https://dev.institute.commonsensemedia.org/risk-assessments/ai-teacher-assistants | OBS (expert rating) |
| 138 | All six developers train on chats by default | King et al. 2025, Stanford HAI | https://arxiv.org/abs/2509.05382 | OBS (policy analysis) |
| 139 | Retest gains ≈ d 0.33 (NR) | Scharfen et al. 2018, *Intelligence* | https://www.sciencedirect.com/science/article/pii/S0160289618300072 | MA |
| 140 | Teacher expectation effects real but small (NR) | Jussim & Harber 2005 | https://pubmed.ncbi.nlm.nih.gov/15869379/ | OP (review) |
| 141 | Guidelines for human–AI interaction | Amershi et al. 2019, CHI | https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/ | OP (validated guidance) |
| 142 | User control over data behind recommendations | Google PAIR Guidebook | https://pair.withgoogle.com/chapter/data-collection/ | OP (guidance) |
| 143 | Generative-AI risk profile | NIST AI RMF and AI 600-1 | https://www.nist.gov/itl/ai-risk-management-framework | REG (voluntary) |
| 144 | Personalisation within bounds; risk taxonomy | Kirk et al. 2023/2024 | https://arxiv.org/abs/2303.05453 | OP |
| 145 | No section on adapting to user level; anti-sycophancy | OpenAI Model Spec 2026-08-18 | https://model-spec.openai.com/2026-08-18.html | VENDOR |
| 146 | Condescension about users' abilities named as a failure | Anthropic, Claude's constitution | https://www.anthropic.com/constitution | VENDOR |

**Counts by evidence type** (146 sources; a source with two types is counted under its first): LAB 27, BENCH 26, OP 20 (opinion, reviews, frameworks, methods), VENDOR 19, MA 18, RCT 17, OBS 12, REG 7.

**Could not access on 2026-10-20:**
- web search (the session's quota was used up);
- help.openai.com and openai.com (HTTP 403), so ChatGPT limits and the Study mode details are not re-verified;
- pnas.org (Bastani), mdpi.com (Gerlich), sciencedirect.com (Scharfen), support.khanacademy.org (403);
- the Springer full text of Höffler 2010;
- the Nature Machine Intelligence page of Kirk 2024 (login);
- the Claude "Styles" help article (404);
- full texts behind paywalls for Deng 2025, Bernacki 2021, Peters 2007/2009, Akl 2011 and Buljan 2020.

Figures from these sources are marked NR above and should be re-checked before any user-facing copy cites them.
