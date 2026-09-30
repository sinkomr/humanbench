/**
 * Phase AI plan docs (ROADMAP AI.1; DESIGN D13, §16 F12–F21-K, §17 with R-17.1–R-17.14 and the copy
 * drafts in §17.7; ADRs A20–A24). The docs are the spec for the whole phase, so this pins their
 * structure: the rows and requirements exist once and in order, every requirement is cited by a
 * Part 1 task, every task and milestone reference resolves, the amendments to existing tasks are
 * in place (AI.2 blocks M3.5/M3.6/M3.7; AI.26 amends M2.1/M2.3/M2.4/M2.7), the dependency graph
 * has no cycle, and every new string passes the A13 language lint (`language-lint.ts`). When the
 * sibling bank repo is present, the transcription from the proposal is checked word for word
 * (the A17 pattern: skip when the sibling is absent).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT, lintText } from './language-lint'

const design = readFileSync(join(REPO_ROOT, 'docs/DESIGN.md'), 'utf8')
const roadmap = readFileSync(join(REPO_ROOT, 'docs/ROADMAP.md'), 'utf8')

/** The proposal annex in the sibling bank repo (`~/code/humanbench-bank` next to this repo). */
const PROPOSAL = join(REPO_ROOT, '..', 'humanbench-bank', 'docs', 'proposals', 'ai-notes-v2.md')
const hasProposal = existsSync(PROPOSAL)

const lines = (text: string): string[] => text.split('\n')
/** Cells of a Markdown table row (no cell in the docs Phase AI adds contains a pipe). */
const cellsOf = (row: string): string[] =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
const cell = (cells: readonly string[], i: number): string => cells[i] ?? ''
const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)]

// --- DESIGN ---------------------------------------------------------------------------------

const S17_START = design.indexOf('\n## 17. Notes for your AI')
const section17 = S17_START < 0 ? '' : design.slice(S17_START)
const s16Rows = lines(design).filter((l) => /^\| F\d+(?:-K)? \|/.test(l))
const s16Ids = s16Rows.map((r) => cell(cellsOf(r), 0))
const F_NEW = ['F12', 'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F21-K'] as const
const s16Row = (id: string): string => s16Rows.find((r) => cell(cellsOf(r), 0) === id) ?? ''

/** DESIGN §17.5 requirements, id → text. */
const requirements = new Map<string, string>()
for (const l of lines(section17)) {
  const m = /^- R-(17\.\d+): (.+)$/.exec(l)
  if (m?.[1] !== undefined && m[2] !== undefined) requirements.set(m[1], m[2])
}
const R_IDS = Array.from({ length: 14 }, (_, i) => `17.${i + 1}`)

/** DESIGN §17.7 copy drafts, key → { text, task }. */
const copy = new Map<string, { text: string; task: string }>()
for (const l of lines(section17)) {
  const m = /^\| ([a-z0-9-]+) \| (.+) \| (AI\.[0-9a-z]+) \|$/.exec(l)
  if (m?.[1] !== undefined && m[2] !== undefined && m[3] !== undefined) copy.set(m[1], { text: m[2], task: m[3] })
}

// --- ROADMAP --------------------------------------------------------------------------------

const ADR_START = roadmap.indexOf('- **A20 ')
const ADR_END = roadmap.indexOf('\n## M0')
const adrBlock = roadmap.slice(ADR_START, ADR_END)
const PHASE_START = roadmap.indexOf('\n## Phase AI')
const phase = PHASE_START < 0 ? '' : roadmap.slice(PHASE_START)
const P1 = phase.indexOf('\n### Part 1')
const P2 = phase.indexOf('\n### Part 2')
const ORDERING = phase.indexOf('\n### Ordering at a glance')

interface Task {
  readonly id: string
  readonly repo: string
  readonly size: string
  readonly mark: string
  readonly block: string
  readonly deps: readonly string[]
}

/** Every Phase AI task in a slice of the section: the task line plus its indented lines. */
function tasksIn(text: string): Task[] {
  const out: Task[] = []
  const ls = lines(text)
  for (let i = 0; i < ls.length; i++) {
    const m = /^- \[([ x~!])\] \*\*(AI\.[0-9a-z-]+) ([^*]+)\*\* — \*\*\[(S|M|L)\]\*\*/.exec(ls[i] ?? '')
    if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined || m[4] === undefined) continue
    const body = [ls[i] ?? '']
    for (let j = i + 1; j < ls.length && /^ {2}/.test(ls[j] ?? ''); j++) body.push(ls[j] ?? '')
    const block = body.join('\n')
    const depText = /Deps?:([^\n]*)/.exec(block)?.[1] ?? ''
    out.push({ id: m[2], repo: m[3].trim(), size: m[4], mark: m[1], block, deps: unique(depText.match(/AI\.\d+[a-z]?(?:-(?:run|gate))?/g) ?? []) })
  }
  return out
}
const part1 = tasksIn(phase.slice(P1, P2))
const part2 = tasksIn(phase.slice(P2, ORDERING))
const allTasks = [...part1, ...part2]

const PART1_IDS = ['AI.1', 'AI.3', 'AI.2', 'AI.4', 'AI.5', 'AI.6', 'AI.6b', 'AI.7', 'AI.8s', 'AI.12s', 'AI.12a-run', 'AI.13', 'AI.12a-gate', 'AI.12c', 'AI.26']
const PART2_IDS = ['AI.8', 'AI.9', 'AI.10', 'AI.11', 'AI.14', 'AI.15', 'AI.16', 'AI.17', 'AI.18', 'AI.19', 'AI.20', 'AI.21', 'AI.21b', 'AI.12b', 'AI.22', 'AI.23', 'AI.24', 'AI.25', 'AI.27']

/** The ROADMAP task line of a milestone task such as `M3.5` (first list item that starts with it). */
const milestoneLine = (id: string): string => lines(roadmap).find((l) => l.startsWith(`- [`) && new RegExp(`^- \\[[ x~!]\\] \\*\\*${id.replace('.', '\\.')}[ *]`).test(l)) ?? ''
/** All milestone task ids defined in the ROADMAP (M0.1 … M6.4, M1.4b, M1.G7 …). */
const milestoneIds = new Set<string>()
for (const l of lines(roadmap)) {
  const id = /^- \[[ x~!]\] \*\*(M\d\.[0-9A-Za-z]+)[ *]/.exec(l)?.[1]
  if (id !== undefined) milestoneIds.add(id)
}

describe('DESIGN §0 and §16 (Phase AI rows)', () => {
  it('the D13 row follows D12 and extends the purpose without touching D1', () => {
    const ls = lines(design)
    const at = ls.findIndex((l) => l.startsWith('| D13 |'))
    expect(at).toBeGreaterThan(0)
    expect(ls[at - 1]?.startsWith('| D12 |')).toBe(true)
    const c = cellsOf(ls[at] ?? '')
    expect(c).toHaveLength(4)
    expect(cell(c, 1)).toBe('Purpose (extension)')
    expect(cell(c, 2)).toMatch(/instructions only/)
    expect(cell(c, 2)).toMatch(/D1 unchanged/)
    expect(cell(c, 2)).toMatch(/only as suggestions, after checks on real data/)
    expect(cell(c, 3)).toMatch(/Part 1 approved 2026-09-29/)
    expect(design.match(/^\| D1 \|.*\|$/m)?.[0]).toMatch(/no human-vs-AI overlay in v1/)
  })

  it('§16 lists F1–F11 then F12–F21 and F21-K, each with four non-empty cells', () => {
    expect(s16Ids).toEqual(Array.from({ length: 11 }, (_, i) => `F${i + 1}`).concat(F_NEW))
    for (const id of F_NEW) {
      const c = cellsOf(s16Row(id))
      expect(c, id).toHaveLength(4)
      expect(cell(c, 0)).toBe(id)
      for (const x of c.slice(1)) expect(x.length, id).toBeGreaterThan(20)
    }
  })

  it('§16 states the mechanical decision rules and that thresholds change only by a new versioned rule', () => {
    expect(design).toMatch(/F16 and F17 decide which line types exist/)
    expect(design).toMatch(/F12–F15 decide which inputs may drive them/)
    expect(design).toMatch(/F18 and F19 decide what the copy may claim/)
    expect(design).toMatch(/only through a new versioned rule \(`z2` for zones\) with a re-run, never by eye/)
  })

  it('the F-rows keep the proposal thresholds (F12: .75/.70, .50/.55, 2%, .07; F18: 5 pp; F20: n = 10, 200, 20%, 25%)', () => {
    expect(s16Row('F12')).toMatch(/accuracy ≥ \.75 with the 95% CI lower bound ≥ \.70/)
    expect(s16Row('F12')).toMatch(/accuracy ≤ \.50 with the upper bound ≤ \.55/)
    expect(s16Row('F12')).toMatch(/Gross errors ≤ 2% of cells\. ECE ≤ \.07/)
    expect(s16Row('F13')).toMatch(/≥ \.20 for the axis/)
    expect(s16Row('F18')).toMatch(/non-inferior at 5 pp \(one-sided α \.025\), then superior \(α \.05\)/)
    expect(s16Row('F20')).toMatch(/n = 10/)
    expect(s16Row('F20')).toMatch(/n ≥ 200/)
    expect(s16Row('F21')).toMatch(/median of ≥ 2 decided suggestions.*≤ 80%/)
    expect(s16Row('F21-K')).toMatch(/≥ 2 targeted sessions.*≥ 1 decided observed line/)
  })
})

describe('DESIGN §17 (Notes for your AI)', () => {
  it('has the subsections 17.1–17.7 in order, after §16', () => {
    expect(S17_START).toBeGreaterThan(design.indexOf('## 16. Risks'))
    const at = ['17.1 Purpose.', '17.2 Principles.', '17.3 Forms.', '17.4 Settings.', '17.5 Requirements.', '17.6 Evaluation.', '17.7 Copy drafts.'].map((h) => section17.indexOf(`**${h}**`))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('defines R-17.1–R-17.14 exactly once each, in order', () => {
    expect([...requirements.keys()]).toEqual(R_IDS)
    expect(section17.match(/^- R-17\.\d+:/gm)).toHaveLength(14)
    for (const [id, text] of requirements) expect(text.length, id).toBeGreaterThan(20)
  })

  it('states the status: Part 1 approved, Part 2 needing a separate approval', () => {
    expect(section17).toMatch(/Part 1 is approved \(2026-09-29\)/)
    expect(section17).toMatch(/Part 2 needs a separate approval/)
    expect(section17).toMatch(/Part 2 starts only if F12 passes on real data and the behaviour gate passes/)
  })

  it('keeps the core requirements: local only, closed grammar, allowed inputs, the header, the 18+ gate, the results-talk preamble', () => {
    expect(requirements.get('17.1')).toMatch(/never stored on a server, logged or transmitted/)
    expect(requirements.get('17.1')).toMatch(/`toUploadPayload\(\)`/)
    expect(requirements.get('17.3')).toMatch(/ASCII; digits only in YYYY-MM; no URLs/)
    expect(requirements.get('17.3')).toMatch(/"my own preferences, not an assessment of me"/)
    expect(requirements.get('17.4')).toMatch(/Never: MAT, SPA, LR\/LG as general reasoning/)
    expect(requirements.get('17.5')).toMatch(/No results-derived lines on uncalibrated priors/)
    expect(requirements.get('17.6')).toMatch(/fixed clauses F1–F4/)
    expect(requirements.get('17.6')).toMatch(/not the §16 checks of the same name/)
    expect(requirements.get('17.7')).toMatch(/results-derived lines never are/)
    expect(requirements.get('17.12')).toMatch(/the under-18 path writes nothing/)
    expect(requirements.get('17.13')).toMatch(/say never to paste the save file/)
    expect(requirements.get('17.14')).toMatch(/M1\.21/)
  })

  it('every F-check and A-decision that §17 and the new rows cite exists', () => {
    const cited = unique(`${section17}\n${F_NEW.map(s16Row).join('\n')}`.match(/\bF\d+(?:-K)?\b/g) ?? [])
    for (const f of cited) expect(s16Ids, f).toContain(f)
    for (const a of unique(section17.match(/\bA2\d\b/g) ?? [])) expect(adrBlock, a).toContain(`- **${a}`)
  })
})

describe('DESIGN §17.7 copy drafts', () => {
  it('has the drafts, each with a distinct key, non-empty text and a task that exists', () => {
    expect(copy.size).toBeGreaterThanOrEqual(29)
    for (const key of ['trust', 'provider', 'anti-coercion', 'placement', 'claim', 'floor-rule', 'remove', 'mirror', 'withdrawal', 'results-talk', 'results-preamble', 'reveal-card']) {
      expect(copy.has(key), key).toBe(true)
    }
    for (const [key, { text, task }] of copy) {
      expect(text.length, key).toBeGreaterThan(20)
      expect(allTasks.map((t) => t.id), key).toContain(task)
    }
  })

  it('every draft passes the A13 language lint', () => {
    for (const [key, { text }] of copy) expect(lintText(text, `${key}.txt`), key).toEqual([])
    expect(lintText('An autism screening.', 'x.txt').length).toBeGreaterThan(0)
  })

  it('the results-talk preamble is 340 characters of ASCII, without digits, IQ or clinical wording (R-17.13)', () => {
    const t = copy.get('results-preamble')?.text ?? ''
    expect(t).toHaveLength(340)
    expect(/^[\x20-\x7e]+$/.test(t)).toBe(true)
    expect(t).not.toMatch(/\d/)
    expect(t).toMatch(/intelligence number/)
    expect(t).toMatch(/Don't guess at health or medical explanations/)
    expect(copy.get('results-talk')?.text).toMatch(/Never paste your save file/)
  })

  it('only the claim string says benefit, and it says "not yet shown" (A22 copy-claim rule)', () => {
    expect(copy.get('claim')?.text).toBe('Designed from research on explanations; not yet shown to help HumanBench users.')
    expect(roadmap).toContain('"Designed from research on explanations; not yet shown to help HumanBench users"')
    const allowed = new Set(['claim', 'results-preamble', 'part2-taste-test'])
    for (const [key, { text }] of copy) {
      if (!allowed.has(key)) expect(text, key).not.toMatch(/\b(help|helps|improve|improves|better|benefit|benefits)\b/i)
    }
    expect(copy.get('part2-taste-test')?.text).toMatch(/not evidence that the notes help/)
  })

  it('Part 2 drafts are marked, and the floor-rule and science notes say what is not yet available', () => {
    for (const [key, { text }] of copy) expect(/\(Part 2\)$/.test(text), key).toBe(key.startsWith('part2-'))
    expect(copy.get('floor-rule')?.text).toMatch(/still checking that assistants handle this line respectfully/)
    expect(copy.get('science')?.text).toMatch(/set these topics yourself/)
  })

  it('the provider warning is dated (R-17.10) and the notes say to re-check dated statements', () => {
    expect(copy.get('provider')?.text).toMatch(/\(Checked \d{4}-\d{2}\.\)$/)
    expect(section17).toMatch(/re-check every dated statement, before release \(R-17\.10\)/)
  })
})

describe('ROADMAP ADRs A20–A24', () => {
  const adrLine = (n: number): string => lines(adrBlock).find((l) => l.startsWith(`- **A${n} `)) ?? ''

  it('adds A20–A23 and the draft A24 once each, in order, after A19', () => {
    const ids = lines(roadmap)
      .filter((l) => /^- \*\*A\d+ /.test(l))
      .map((l) => /^- \*\*A(\d+) /.exec(l)?.[1])
    expect(ids).toEqual(Array.from({ length: 24 }, (_, i) => String(i + 1)))
    expect(adrLine(24)).toMatch(/draft; adopt with Part 2/)
    expect(adrLine(21)).toMatch(/Part 2/)
    expect(adrLine(20)).toMatch(/Part 1 approved 2026-09-29/)
  })

  it('A21 keeps the zone rule: the own-axis posterior, S², z = 1.282, the .80 and .50 cuts, and no M1 results-derived lines', () => {
    expect(adrBlock).toMatch(/never the correlated MAP/)
    expect(adrBlock).toMatch(/S² = s² \+ σ_rel² \+ κ·m/)
    expect(adrBlock).toMatch(/skip if TCC\(μ − 1\.282·S\) ≥ \.80; build up if TCC\(μ \+ 1\.282·S\) ≤ \.50/)
    expect(adrBlock).toMatch(/No results-derived lines on uncalibrated \(M1\) priors/)
    expect(adrBlock).toMatch(/≤ 2 inferred lines per note/)
  })

  it('A22 and A23 keep the release gate, the statuses-only rule and the item tags', () => {
    expect(adrBlock).toMatch(/Changing the wording resets the gate/)
    expect(adrBlock).toMatch(/Pub's gates file carries statuses only/)
    expect(adrBlock).toMatch(/`topic`, `curriculum_level` \(never exported into notes\), `notation\[\]`, `question_type`, `inference_steps`/)
    expect(adrBlock).toMatch(/This lands before M3\.5, M3\.6 and M3\.7/)
    expect(adrBlock).toMatch(/`ladder_probe` and `practice_only`/)
  })

  it('A20–A23 are each cited by a Part 1 task and A24 by a Part 2 task', () => {
    for (const a of ['A20', 'A21', 'A22', 'A23']) expect(part1.filter((t) => t.id !== 'AI.1').some((t) => t.block.includes(a)), a).toBe(true)
    expect(part2.some((t) => t.block.includes('A24'))).toBe(true)
  })
})

describe('ROADMAP Phase AI backlog', () => {
  it('has Part 1 (approved) and Part 2 (needs separate approval) as separate backlogs, Part 1 first', () => {
    expect(P1).toBeGreaterThan(0)
    expect(P2).toBeGreaterThan(P1)
    expect(phase.slice(P1, P1 + 60)).toMatch(/^\n### Part 1 \(approved 2026-09-29\)/)
    expect(phase.slice(P2, P2 + 80)).toMatch(/^\n### Part 2 \((needs separate approval|approved [0-9-]+)\)/)
    expect(phase).toMatch(/Entry conditions:\*\* Part 1 is done; F12 passes on real data/)
  })

  it('Part 1 is the 15 tasks (5 M, 10 S; AI.13 and AI.12c are the user\'s) and Part 2 the 19', () => {
    expect(part1.map((t) => t.id)).toEqual(PART1_IDS)
    expect(part2.map((t) => t.id)).toEqual(PART2_IDS)
    expect(part1.filter((t) => t.size === 'M').map((t) => t.id).sort()).toEqual(['AI.12a-run', 'AI.2', 'AI.4', 'AI.5', 'AI.8s'])
    expect(part1.filter((t) => t.size === 'S')).toHaveLength(10)
    expect(part1.filter((t) => t.repo.startsWith('user')).map((t) => t.id)).toEqual(['AI.13', 'AI.12c'])
    expect(unique(allTasks.map((t) => t.id))).toHaveLength(34)
  })

  it('AI.1 is done and no other Phase AI task is; Part 2 stays unticked while it needs approval', () => {
    expect(part1.find((t) => t.id === 'AI.1')?.mark).toBe('x')
    expect(part1.filter((t) => t.id !== 'AI.1' && t.mark === 'x')).toEqual([])
    if (/### Part 2 \(needs separate approval\)/.test(phase)) expect(part2.filter((t) => t.mark !== ' ')).toEqual([])
  })

  it('every task names a repo tag from pub / bank / both / user', () => {
    for (const t of allTasks) expect(t.repo, t.id).toMatch(/^(pub|bank|both|user|user \+ Claude)$/)
  })

  it('every R-17.1–R-17.14 is cited by at least one Part 1 task other than AI.1', () => {
    const cited = new Set(part1.filter((t) => t.id !== 'AI.1').flatMap((t) => t.block.match(/R-17\.\d+/g) ?? []))
    for (const id of R_IDS) expect(cited.has(`R-${id}`), `R-${id}`).toBe(true)
  })

  it('every R-17.x and F-check the ROADMAP cites exists in DESIGN', () => {
    for (const r of unique(roadmap.match(/R-17\.\d+/g) ?? [])) expect(R_IDS, r).toContain(r.slice(2))
    const cited = unique(phase.match(/\bF(?:1[2-9]|2[01])(?:-K)?\b/g) ?? [])
    for (const f of cited) expect(s16Ids, f).toContain(f)
    for (const f of F_NEW) expect(phase + adrBlock, f).toContain(f)
  })

  it('AI.2 blocks M3.5, M3.6 and M3.7, and each of them says it is blocked by AI.2 (A23)', () => {
    const ai2 = part1.find((t) => t.id === 'AI.2')
    expect(ai2?.block).toMatch(/\*\*Blocks M3\.5, M3\.6 and M3\.7\.\*\*/)
    expect(ai2?.deps).toEqual(['AI.3'])
    for (const m of ['M3.5', 'M3.6', 'M3.7']) expect(milestoneLine(m), m).toMatch(/\*\*Blocked by AI\.2\*\* \(Phase AI, A23\)/)
    expect(roadmap).toMatch(/- \*M3\.1b\* \(Phase AI, A23\) is task \*\*AI\.2\*\*/)
    // AI.3 then AI.2 before the bank batches: AI.3 has no dependency on them.
    expect(part1.find((t) => t.id === 'AI.3')?.deps).toEqual(['AI.1'])
  })

  it('AI.26 amends M2.1, M2.3, M2.4 and M2.7, which carry the amendment', () => {
    const ai26 = part1.find((t) => t.id === 'AI.26')
    for (const m of ['M2.1', 'M2.3', 'M2.4', 'M2.7']) {
      expect(ai26?.block, m).toContain(m)
      expect(milestoneLine(m), m).toMatch(/\*Amended \(Phase AI, AI\.26\):\*/)
    }
    expect(milestoneLine('M2.7')).toMatch(/"someone asked me for my notes" \(6 in all\)/)
  })

  it('the other amendments to existing tasks are in place', () => {
    expect(milestoneLine('M1.R')).toMatch(/\*Amended \(Phase AI, AI\.6b\):\*.*after the required save download, never on share cards/)
    expect(milestoneLine('M1.18')).toMatch(/\*Amended \(Phase AI, AI\.6b\):\*.*notes text never appears on the card/)
    expect(milestoneLine('M1.21')).toMatch(/\*Amended \(Phase AI, AI\.5\):\*.*route list/)
    expect(milestoneLine('M1.22')).toMatch(/\*Amended \(Phase AI, AI\.7\):\*.*`brief_prefs`/)
    expect(milestoneLine('M2.1')).toMatch(/\*Amended \(Phase AI Part 2;.*`rescore\(save\)` also returns `eap\[axis\]`/)
    expect(milestoneLine('M2.2')).toMatch(/\*Amended \(Phase AI Part 2, AI\.21b\):\*.*0\.25 exposure cap/)
    expect(milestoneLine('M1.15')).toMatch(/\*Amended \(Phase AI Part 2, only if approved\):\*.*honour-code sentence/)
    expect(milestoneLine('M4.7')).toMatch(/\*Amended \(Phase AI Part 2, AI\.20\):\*.*κ/)
    expect(milestoneLine('M4.9')).toMatch(/\*Amended \(Phase AI Part 2, AI\.20\):\*.*F12, F13, F21 and F21-K/)
  })

  it('every amendment marker in the ROADMAP names a task that exists, and the summary lists the same tasks', () => {
    const ids = allTasks.map((t) => t.id)
    const markers = [...roadmap.matchAll(/\*Amended \(Phase AI[^)]*?(AI\.[0-9a-z]+)?\):\*/g)]
    expect(markers.length).toBe(13)
    for (const m of markers) if (m[1] !== undefined) expect(ids, m[0]).toContain(m[1])
    const summary = phase.slice(phase.indexOf('### Amendments to existing tasks'), phase.indexOf('### Fallbacks'))
    for (const m of ['M3.5', 'M1.R', 'M1.18', 'M1.21', 'M1.22', 'M2.1', 'M2.3', 'M2.4', 'M2.7', 'M2.2', 'M1.15', 'M4.7', 'M4.9']) expect(summary, m).toContain(m)
  })

  it('every AI task id mentioned anywhere is defined, and every milestone id in Phase AI text exists', () => {
    const defined = new Set(allTasks.map((t) => t.id))
    const mentioned = unique(roadmap.match(/\bAI\.\d+[a-z]?(?:-(?:run|gate))?\b/g) ?? [])
    for (const id of mentioned) expect(defined.has(id), id).toBe(true)
    const text = `${adrBlock}\n${phase}`
    for (const m of unique(text.match(/\bM\d\.[0-9A-Za-z]+\b/g) ?? [])) {
      if (m === 'M3.1b') continue // the alias of AI.2, defined in the M3.1 note
      expect(milestoneIds.has(m), m).toBe(true)
    }
  })

  it('Part 1 depends only on Part 1, and the dependency graph has no cycle', () => {
    const part1Ids = new Set(part1.map((t) => t.id))
    for (const t of part1) for (const d of t.deps) expect(part1Ids.has(d), `${t.id} -> ${d}`).toBe(true)
    const deps = new Map(allTasks.map((t) => [t.id, t.deps] as const))
    const state = new Map<string, 1 | 2>()
    const visit = (id: string, path: string[]): void => {
      if (state.get(id) === 2) return
      expect(state.get(id), `cycle ${[...path, id].join(' -> ')}`).toBeUndefined()
      state.set(id, 1)
      for (const d of deps.get(id) ?? []) visit(d, [...path, id])
      state.set(id, 2)
    }
    for (const id of deps.keys()) visit(id, [])
  })

  it('the critical path is stated: AI.1, AI.3, AI.2 before M3.5/M3.6/M3.7', () => {
    expect(phase).toMatch(/AI\.3 then AI\.2 land before any bank batch that emits ItemRecords \(M3\.5, M3\.6, M3\.7\)/)
    expect(phase).toMatch(/AI\.1 - AI\.3 - AI\.2 -> M3\.5 \/ M3\.6 \/ M3\.7/)
  })

  it('the open questions Q3, Q11, Q12, Q14 and Q15 that tasks cite are defined, and the M1.4b decision is recorded', () => {
    const qs = phase.slice(phase.indexOf('### Phase AI open questions'))
    expect(lines(qs).filter((l) => /^\d+\. /.test(l))).toHaveLength(16)
    for (const q of unique(phase.match(/\bQ\d+\b/g) ?? [])) {
      const n = Number(q.slice(1))
      expect(n, q).toBeGreaterThanOrEqual(1)
      expect(n, q).toBeLessThanOrEqual(16)
      expect(qs, q).toMatch(new RegExp(`^${n}\\. `, 'm'))
    }
    expect(qs).toMatch(/^5\. The M1\.4b criterion: \*\*decided 2026-09-29, option 1\*\*/m)
  })
})

describe('A13 language lint on the new Phase AI text', () => {
  const fragments = (): Record<string, string> => {
    const ls = lines(design)
    const d13 = ls.find((l) => l.startsWith('| D13 |')) ?? ''
    const s16Start = design.indexOf('| F12 |')
    const s16End = design.indexOf('**Open questions and flagged gaps')
    const amended = [...roadmap.matchAll(/\*Amended \(Phase AI[^\n]*|\*\*Blocked by AI\.2\*\*[^\n]*|- \*M3\.1b\*[^\n]*/g)].map((m) => m[0])
    return {
      'DESIGN D13 row': d13,
      'DESIGN F12–F21-K rows and rules': design.slice(s16Start, s16End),
      'DESIGN §17': section17,
      'ROADMAP A20–A24': adrBlock,
      'ROADMAP Phase AI section': phase,
      'ROADMAP amendments': amended.join('\n'),
    }
  }

  it('every fragment is non-trivial (the slicing found the text)', () => {
    const f = fragments()
    expect(f['DESIGN D13 row']?.length).toBeGreaterThan(100)
    expect(f['DESIGN F12–F21-K rows and rules']?.length).toBeGreaterThan(2000)
    expect(f['DESIGN §17']?.length).toBeGreaterThan(8000)
    expect(f['ROADMAP A20–A24']?.length).toBeGreaterThan(5000)
    expect(f['ROADMAP Phase AI section']?.length).toBeGreaterThan(15000)
    expect(f['ROADMAP amendments']?.length).toBeGreaterThan(1500)
  })

  it('has no banned clinical or diagnostic term in any new text', () => {
    for (const [name, text] of Object.entries(fragments())) expect(lintText(text, 'x.md'), name).toEqual([])
  })
})

/** The proposal annex, when the sibling bank repo is present (the A17 pattern). */
describe.skipIf(!hasProposal)('transcription from the proposal annex (bank docs/proposals/ai-notes-v2.md)', () => {
  const proposal = hasProposal ? readFileSync(PROPOSAL, 'utf8') : ''

  it('R-17.1–R-17.14 are the proposal §10 requirements word for word (R-17.6 only adds the F1–F4 disambiguation)', () => {
    const theirs = new Map<string, string>()
    for (const l of lines(proposal)) {
      const m = /^> - \*\*R-(17\.\d+)\*\* (.+)$/.exec(l)
      if (m?.[1] !== undefined && m[2] !== undefined) theirs.set(m[1], m[2])
    }
    expect([...theirs.keys()]).toEqual(R_IDS)
    for (const id of R_IDS) {
      const ours = requirements.get(id) ?? ''
      const t = theirs.get(id) ?? ''
      if (id === '17.6') {
        expect(ours.startsWith(t)).toBe(true)
        expect(ours.slice(t.length)).toBe(' F1–F4 are line IDs of the notes grammar, not the §16 checks of the same name.')
      } else {
        expect(ours, id).toBe(t)
      }
    }
  })

  it('the copy drafts of proposal §6 appear word for word in §17.7', () => {
    const labels: Record<string, string> = {
      trust: 'Trust line',
      provider: 'Provider warning',
      'anti-coercion': 'Anti-coercion',
      placement: 'Placement',
      claim: 'Claim',
      'results-talk': 'Results talk',
      'part2-banner': 'Part 2 banner',
      'part2-downward': 'Downward move',
      withdrawal: 'Withdrawal',
      'floor-rule': 'Floor rule',
      science: 'Science',
      remove: 'Remove',
      mirror: 'Mirror',
      'fit-log': 'Fit log',
      interests: 'Interests',
      'part2-integrity': 'Integrity (generic)',
    }
    for (const [key, label] of Object.entries(labels)) {
      const escaped = label.replace(/[()]/g, '\\$&')
      const theirs = new RegExp(`^- \\*\\*${escaped}:\\*\\* "(.+?)"`, 'm').exec(proposal)?.[1]
      expect(theirs, label).toBeDefined()
      const ours = (copy.get(key)?.text ?? '').replace(/ \(Part 2\)$/, '')
      expect(ours, key).toBe(theirs)
    }
    const pre = /The preamble \(340 characters[^\n]*\n\s*```\n([^\n]+)\n\s*```/.exec(proposal)?.[1]
    expect(pre).toBeDefined()
    expect(copy.get('results-preamble')?.text).toBe(pre?.trim())
  })

  it('the numbers of the F12–F21-K rows of proposal §7.8 all appear in the DESIGN §16 rows', () => {
    const start = proposal.indexOf('| **F12** |')
    expect(start).toBeGreaterThan(0)
    const rows = lines(proposal.slice(start)).filter((l) => /^\| \*\*F\d+(?:-K)?\*\* \|/.test(l))
    expect(rows.map((r) => cell(cellsOf(r), 0).replace(/\*/g, ''))).toEqual([...F_NEW])
    for (const r of rows) {
      const c = cellsOf(r)
      const id = cell(c, 0).replace(/\*/g, '')
      const mine = s16Row(id)
      for (const tok of unique(`${cell(c, 1)} ${cell(c, 2)}`.match(/\d*\.\d+|\d+/g) ?? [])) expect(mine, `${id} ${tok}`).toContain(tok)
    }
  })

  it('the ADR A20–A24 headings and the task ids match proposal §8 and §9', () => {
    for (const a of ['A20 — Notes for your AI: contract', 'A21 — Topic zones', 'A22 — Evidence and release gate; copy claims', 'A23 — Topics, quant groups and item tags', 'A24 (draft; adopt with Part 2) — Goals mode as classification sessions']) {
      expect(proposal, a).toContain(`**${a}`)
      expect(adrBlock, a).toContain(`**${a}`)
    }
    const theirs = unique(proposal.slice(proposal.indexOf('## 8. Task breakdown')).match(/^- \[ \] \*\*(AI\.[0-9a-z-]+) /gm)?.map((l) => /\*\*(AI\.[0-9a-z-]+) /.exec(l)?.[1] ?? '') ?? [])
    expect(theirs.sort()).toEqual([...PART1_IDS, ...PART2_IDS].sort())
  })
})
