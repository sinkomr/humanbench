# HumanBench house style

Provisional default, UX-REVIEW D26 (option A, 2026-10-05). The owner has not confirmed it yet.

This page sets the tone of the words HumanBench shows. Every string also follows ROADMAP A13 and DESIGN R-5.6.x (non-diagnostic, no clinical terms; `npm run lint:language`), and the fixed texts of DESIGN §13 and R-5.6.x are kept word for word.

## Two registers

HumanBench writes in two registers. Both are plain, literal and in the second person.

### 1. Product voice

Used in: the welcome tagline and intro (`session/copy.ts` WELCOME_TAGLINE, WELCOME_INTRO), the page's meta description (`copy.ts` META_DESCRIPTION, kept the same as `index.html`), the lead-in before the honour sentence (HONOUR_LEAD), and headings such as "Ready when you are".

- Say what the session **is**: short tasks of reasoning, memory and speed; about 30 minutes; a profile with ranges, not a single score; a save file you keep.
- Never describe the person ("how you think", "who you are") and never promise what the results mean or what the session will do for them (A22, R-5.6.4). No "honest picture", no "discover", no "unlock".
- No figures of speech in the product description. "Blob" is the name of the results figure: introduce it before you use it (HONOUR_LEAD comes before "Your blob is only meaningful if it's yours.").
- Headings may be friendly ("Ready when you are"). Body text stays literal.
- The welcome text is also the static first-paint shell of `index.html` (UX-100), so it is plain text: no markup, and no `&`, `<`, `>` or `"`.

### 2. Instructions

Used in: the gate, the honour screen, the device check, the interstitials (`session/segments.ts`), task prompts, notices, errors, the privacy notice and the data page.

- Say what to do and what happens next, in that order: "Press Load to add your new session to it."
- Name the control exactly as it is labelled, in quotation marks when it sits inside a sentence: choose “Skip this part”.
- Say what something costs before the person chooses it: "It will show as not measured."
- State rules once, up front, and repeat them only where they apply (the Quantitative interstitial repeats the paper and calculator rule of the honour screen, and says the same thing).
- Never comment on a counted answer as right or wrong (DESIGN §10). Only practice copy does.

## Fixed points

- Tools. Scratch paper and a pencil are allowed. Calculators and AI chatbots are not (owner decision, UX-REVIEW D10). Do not write "assistive technology" for what is banned: in accessibility it means screen readers and similar tools, which people must keep using. Name the banned tools, and say that screen readers, zoom and other accessibility settings are fine.
- Part and skill names (provisional default, UX-REVIEW D25): one form everywhere, Title Case ("Reaction Time", "Working Memory", "Skip Reaction Time"). Take a name from `src/axis-names.ts` (`axisName`), never from the engine registry, which keeps the DESIGN §3 names. Two skills have plain display names: "Logic Games" and "Confidence Calibration". The emotion skill keeps its R-5.6.2 name word for word, "(text scenarios)" included. Chart labels are cuts of these names in the same case ("Reading Comp.", "Calibration"). In running text, a part is named as a name ("the parts Matrix & Series, Spatial and Quantitative Reasoning"); a measure in general stays lower case ("your typical simple reaction time").
- Parts that need sight (Reaction Time, Spatial) say so on their interstitial and point to “Skip this part” (provisional default, UX-REVIEW D20).
- Privacy. The notice says plainly that no personally identifiable information is collected and that all responses are anonymous (owner decision, UX-REVIEW D1). Every other sentence must stay true of the build it ships with: the static notice says nothing leaves the device unless the person shares their save file; the server notice says what the server and its host do keep. No placeholder ("TODO") may reach a page: `src/no-todo.test.ts` and the DOM and e2e tests check for it.
- Apostrophes and quotation marks: the static privacy notice uses straight apostrophes (`session/copy.test.ts` pins this). Other copy may use typographic quotes (“ ”) around the names of controls and pages.
- Numbers: "about 30 minutes" in sentences, "12 of about 30 min" in the progress ring (UX-008).
