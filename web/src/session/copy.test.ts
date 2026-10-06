import { describe, expect, it } from 'vitest'
import design from '../../../docs/DESIGN.md?raw'
import * as copy from './copy'

/** The quoted honour-code sentence of DESIGN §13. */
function designHonourCode(md: string): string {
  const match = /\*\*Honour code\*\*[^"\n]*"([^"\n]+)"/.exec(md)
  if (!match?.[1]) throw new Error('DESIGN §13 honour code not found in docs/DESIGN.md')
  return match[1]
}

describe('session copy (M1.15; DESIGN §13)', () => {
  it('the honour code is word for word DESIGN §13', () => {
    expect(copy.HONOUR_TEXT).toBe(designHonourCode(design))
  })

  it('the gate says 18 or older, and the privacy notice covers what DESIGN §13 lists', () => {
    expect(copy.GATE_AGREE).toContain('18 or older')
    expect(copy.GATE_POINTS).toHaveLength(3) // "a terms/privacy summary (3 bullets + link)"
    const notice = copy.PRIVACY_SECTIONS.flatMap((s) => [s.heading, ...s.paragraphs]).join('\n')
    // Owner decision 2026-10-05 (UX-REVIEW D1): no personally identifiable information, all responses anonymous,
    // no controller or contact named, and no placeholder left.
    expect(notice).toContain('HumanBench collects no personally identifiable information, and all responses are anonymous.')
    expect(notice).not.toMatch(/TODO|Controller:|Contact:|to be confirmed|draft/i)
    expect(notice).toMatch(/24 months/) // the retention of DESIGN §13 (purpose, retention and consent; the controller is left out by the owner)
    expect(notice).toMatch(/consent/)
    expect(notice).toMatch(/18 or older/)
    expect(notice).toContain('Nothing is sent to a server.')
    expect(notice).toContain('They leave it only if you share them yourself')
  })

  it('the honour screen keeps the §13 sentence and adds, apart from it, a lead-in and the paper and tools rule (UX-REVIEW D10, D26)', () => {
    expect(copy.HONOUR_LEAD).toContain('blob')
    expect(copy.HONOUR_LEAD).not.toContain(copy.HONOUR_TEXT)
    // Owner decision 2026-10-05 (D10): paper and pencil yes; calculators and AI chatbots no.
    expect(copy.HONOUR_TOOLS).toMatch(/scratch paper and a pencil/)
    expect(copy.HONOUR_TOOLS).toMatch(/calculator/)
    expect(copy.HONOUR_TOOLS).toMatch(/AI chatbot/)
    // "Assistive technology" means screen readers, which people must keep using: it is never what is banned.
    expect(copy.HONOUR_TOOLS).not.toMatch(/assistive/i)
    expect(copy.HONOUR_TOOLS).toMatch(/Screen readers, zoom and other accessibility settings are fine/)
  })

  it('the welcome says what the session is in plain words, not what it says about the person (UX-REVIEW D26)', () => {
    for (const t of [copy.WELCOME_TAGLINE, copy.WELCOME_INTRO]) {
      expect(t).not.toMatch(/jagged|how you think|honest picture|cannot do/i)
      expect(t).not.toMatch(/[&<>"]/) // the static shell of index.html holds them as plain text (UX-100)
    }
    expect(copy.WELCOME_TAGLINE).toMatch(/not as a single score/)
    expect(copy.WELCOME_TAGLINE).toMatch(/ranges/)
    expect(copy.WELCOME_INTRO).toMatch(/save file/)
  })

  it('gives every skip and finish confirmation a way to keep going, and explains what skipping does', () => {
    expect(copy.SKIP_CONFIRM_NO).toBe('Keep going')
    expect(copy.FINISH_CONFIRM_NO).toBe('Keep going')
    expect(copy.SKIP_CONFIRM_TEXT).toMatch(/not measured/)
    expect(copy.noticeUnavailable('Spatial')).toMatch(/skip Spatial/)
  })

  it('never comments on a counted answer (DESIGN §10): only practice copy speaks of right or wrong', () => {
    const counted = [copy.CONFIDENCE_LEGEND, copy.confidenceHint(25, 4), copy.confidenceHint(0, null), copy.NOTICE_TIMEOUT, copy.NOTICE_TIMEOUT_SERVED, copy.NOTICE_MALFORMED]
    for (const t of counted) expect(t).not.toMatch(/\bcorrect\b(?!ly)|incorrect|wrong/i)
    // The legend asks how sure the person is; the time-out notice says the item counts as not answered correctly.
    // On the server a time-out is no answer at all, left out of the scores (R-11.1), and its notice says so.
    expect(copy.NOTICE_TIMEOUT_SERVED).toMatch(/left out/)
    expect(copy.NOTICE_TIMEOUT_SERVED).not.toMatch(/counts as/)
    expect(copy.PRACTICE_CORRECT).toMatch(/correct/)
  })
})

describe('summaryLine', () => {
  it('counts in the singular and the plural', () => {
    expect(copy.summaryLine(1, 1, 1)).toBe('You answered 1 question and completed 1 timed task in about 1 minute.')
    expect(copy.summaryLine(0, 7, 28)).toBe('You answered 0 questions and completed 7 timed tasks in about 28 minutes.')
  })
})

/** Every string the module exports (a constant, a list of them, the result of a function given plain arguments). */
function allStrings(): [string, string][] {
  const out: [string, string][] = []
  const add = (name: string, v: unknown): void => {
    if (typeof v === 'string') out.push([name, v])
    else if (Array.isArray(v)) v.forEach((x, i) => add(`${name}[${i}]`, x))
    else if (typeof v === 'function') {
      for (const args of [['Spatial'], [3], [25, 4], [0, null], [1, 1, 1], ['a', 1]]) {
        try {
          add(`${name}(${args.join(',')})`, (v as (...a: unknown[]) => unknown)(...args))
        } catch {
          // a function that takes other arguments is not one of these
        }
      }
    } else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) add(`${name}.${k}`, x)
    }
  }
  for (const [name, v] of Object.entries(copy)) add(name, v)
  return out
}

describe('no session copy claims a benefit (A22, R-5.6.4; UX-018a)', () => {
  /** What a claim of an effect sounds like: the break text said a break "can help you stay sharp". */
  const BENEFIT = /\b(?:helps?|helped|helpful|improves?|improved|boosts?|sharp(?:en|er)?|better results?|works better|more accurate|learn faster|proven|proves?|guarantee\w*|effective|performs? better|recharge\w*)\b/i

  it('the break offer says what the break does to the clock and nothing about what it does to the person', () => {
    expect(copy.BREAK_OFFER_TEXT).toBe('You have been working for about 30 minutes. You can take a short break now. The clock pauses while you rest.')
    expect(copy.BREAK_OFFER_TEXT).not.toMatch(BENEFIT)
  })

  it('no string of the session copy does', () => {
    const strings = allStrings()
    expect(strings.length).toBeGreaterThan(150)
    // Left out: the honour code, which is DESIGN §13's sentence word for word ("... or help": a rule about conduct), and the
    // privacy notice, which says why a server would want answers ("to improve the questions": its purpose, not a claim to the person).
    for (const [name, text] of strings.filter(([name]) => name !== 'HONOUR_TEXT' && !name.startsWith('PRIVACY_SECTIONS'))) expect(text, name).not.toMatch(BENEFIT)
  })
})

describe('the figures the person is told (UX-008)', () => {
  it('say minutes the same way everywhere', () => {
    expect(copy.aboutMinutes(1)).toBe('About 1 minute.')
    expect(copy.aboutMinutes(6)).toBe('About 6 minutes.')
    expect(copy.progressText(12, 30)).toBe('12 of about 30 min')
    expect(copy.OVER_PLANNED).toBe('Over the planned time')
    expect(copy.OVER_TARGET).toBe('Almost there')
  })

  it('the welcome and ready screens promise the figure the ring shows', () => {
    expect(copy.WELCOME_INTRO).toContain('about 30 minutes')
    expect(copy.READY_TEXT).toContain('about 30 minutes')
  })
})

describe('the confidence hint (UX-014)', () => {
  it('says what guessing would give in words, then what the top of the scale means', () => {
    expect(copy.confidenceHint(17, 6)).toBe('With 6 options, guessing would be right about 17% of the time. 100% means you are certain.')
    expect(copy.confidenceHint(0, null)).toBe('0% means you have no idea. 100% means you are certain.')
  })
})

describe('the ready screen’s lines (UX-012a, UX-010)', () => {
  it('speak of questions and sessions in the singular and the plural', () => {
    expect(copy.savedAtLine('today at 14:03', 1)).toBe('Last saved today at 14:03, 1 question answered.')
    expect(copy.savedAtLine('yesterday at 09:30', 12)).toBe('Last saved yesterday at 09:30, 12 questions answered.')
    expect(copy.savedAtLine('3 October at 08:00', 0)).toBe('Last saved 3 October at 08:00.')
    expect(copy.addedToLine(1)).toBe('Your new session will be added to 1 earlier session.')
    expect(copy.addedToLine(3)).toBe('Your new session will be added to 3 earlier sessions.')
    expect(copy.viewLine(2)).toBe('Your profile from 2 earlier sessions.')
    expect(copy.noNewAnswersLine(1)).toBe('This visit added no new answers. Your profile below comes from 1 earlier session.')
    expect(copy.combinesLine(3)).toBe('This profile combines 3 sessions.')
  })

  it('names the parts skipped in plain grammar', () => {
    expect(copy.reachedEndLine(['Reaction Time'])).toBe('You reached the end of the session. You skipped 1 part: Reaction Time.')
    expect(copy.reachedEndLine(['Reaction Time', 'Spatial'])).toBe('You reached the end of the session. You skipped 2 parts: Reaction Time and Spatial.')
    expect(copy.reachedEndLine(['A', 'B', 'C'])).toBe('You reached the end of the session. You skipped 3 parts: A, B and C.')
  })

  it('the practice screens’ new buttons, and the verdict told to a screen reader, never repeat the visible sentences', () => {
    expect(copy.PRACTICE_STOP).toBe('Stop practice')
    expect(copy.PRACTICE_DONE_CONTINUE).toBe('Continue')
    expect(copy.practiceVerdict(true, 'C')).toBe('Your answer was correct. The right answer is C.')
    expect(copy.practiceVerdict(false, '12')).toBe('Your answer was not correct. The right answer is 12.')
    for (const t of [copy.practiceVerdict(true, 'C'), copy.practiceVerdict(false, 'C')]) expect(t).not.toMatch(/That was (not )?correct\./)
  })
})

describe('the interstitials use the nouns of the questions (UX-016)', () => {
  it('the blurbs speak of cells, objects, blocks and shapes, as the items do', async () => {
    const { SEGMENT_INFO } = await import('./segments')
    expect(SEGMENT_INFO.matrix_series.blurb).toBe('Find the pattern. Pick the cell that completes a grid, or type the next term of a sequence.')
    expect(SEGMENT_INFO.spatial.blurb).toBe(
      'Turn objects in your mind. Decide which option is the same object as the target, rotated. This part needs you to see the screen. If you use a screen reader or cannot see the figures, choose “Skip this part”: it will show as not measured.',
    )
    expect(SEGMENT_INFO.memory.blurb).toBe('Repeat short sequences of digits forwards and backwards, then the order in which blocks light up.')
    expect(SEGMENT_INFO.coding_reading.blurb).toBe('Match shapes to digits against the clock, then read a short passage and answer a few questions about it.')
  })

  it('the privacy notice has straight apostrophes, and keeps its terms version', () => {
    const text = copy.PRIVACY_SECTIONS.flatMap((x) => x.paragraphs).join('\n')
    expect(text).not.toContain('\u2019')
    expect(text).toContain("your browser's local storage")
  })
})

describe('the interstitials say what is allowed and which parts need sight (UX-REVIEW D10, D20)', () => {
  it('Quantitative allows paper and a pencil and rules out a calculator and an AI chatbot, as the honour screen does', async () => {
    const { SEGMENT_INFO } = await import('./segments')
    expect(SEGMENT_INFO.quant.blurb).toBe('Solve short number problems and type your answer. Scratch paper and a pencil are fine; please do not use a calculator or an AI chatbot.')
    expect(SEGMENT_INFO.quant.blurb).not.toMatch(/out of reach/)
  })

  it('Reaction Time and Spatial, and only they, point to the Skip button of their interstitial', async () => {
    const { SEGMENT_INFO } = await import('./segments')
    const sight = /This part needs you to see the screen\. If you use a screen reader or cannot see [^,]+, choose “Skip this part”: it will show as not measured\.$/
    expect(copy.INTERSTITIAL_SKIP).toBe('Skip this part')
    expect(SEGMENT_INFO.rt.blurb).toMatch(sight)
    expect(SEGMENT_INFO.rt.blurb).toMatch(/^A target appears on the screen\. /)
    expect(SEGMENT_INFO.spatial.blurb).toMatch(sight)
    for (const id of ['matrix_series', 'memory', 'quant', 'coding_reading'] as const) expect(SEGMENT_INFO[id].blurb).not.toMatch(/see the screen/)
  })
})
