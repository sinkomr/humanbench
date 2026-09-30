/**
 * Destinations, install and removal steps (R-17.10; proposal §3.3 step 5, §7.2): the data is
 * complete, the staleness warning fires after 120 days, and the command blocks contain no `#`, use
 * the refuse-to-overwrite form and never `rm -rf`.
 */

import { describe, expect, it } from 'vitest'
import { PRESET_INFO } from './contexts'
import {
  DESTINATIONS,
  SURFACES,
  STALE_AFTER_DAYS,
  commandBlocks,
  daysBetween,
  destination,
  downloadName,
  resolveForm,
  surfacesStaleness,
} from './surfaces'
import { FORM_LIMITS, PRESETS } from './types'
import { lintLine } from './lint'

describe('surfaces.json', () => {
  it('names each destination once, with steps, a form and a smoke slot', () => {
    expect(new Set(DESTINATIONS.map((d) => d.id)).size).toBe(DESTINATIONS.length)
    for (const d of DESTINATIONS) {
      expect(d.id, d.id).toMatch(/^[a-z][a-z0-9_]*$/)
      expect(d.forms, d.id).toContain(d.default_form)
      expect(d.install.length, d.id).toBeGreaterThan(0)
      expect(d.smoke.result, d.id).toBe('not_run')
      expect(d.limit_note.length, d.id).toBeGreaterThan(10)
    }
  })

  it('has removal steps for every destination that installs something, memory review for assistants, and nothing to remove for "just me"', () => {
    for (const d of DESTINATIONS) {
      if (d.id === 'just_me') expect(d.remove).toEqual([])
      else expect(d.remove.length, d.id).toBeGreaterThan(0)
      if (d.group === 'assistant') expect(d.remove.join(' '), d.id).toMatch(/memory|saved info|saved memories/i)
    }
  })

  it('covers the destinations of proposal 3.1 and gives every preset a real default', () => {
    for (const id of ['chatgpt_instructions', 'chatgpt_project', 'claude_preferences', 'claude_project', 'gemini_instructions', 'gemini_gem', 'microsoft_copilot', 'claude_code_skill', 'claude_code_rules', 'codex_agents', 'gemini_cli', 'cursor', 'github_copilot', 'own_app', 'just_me']) {
      expect(destination(id), id).toBeDefined()
    }
    for (const p of PRESETS) expect(destination(PRESET_INFO[p].destination), p).toBeDefined()
    expect(PRESET_INFO.coding.destination).toBe('claude_code_skill')
  })

  it('uses the same limits as the forms, and takes the Skill form only in the Skill destination', () => {
    expect(SURFACES.limits).toEqual(FORM_LIMITS)
    expect(DESTINATIONS.filter((d) => d.forms.includes('skill')).map((d) => d.id)).toEqual(['claude_code_skill'])
    expect(destination('own_app')?.output).toBe('json')
    expect(DESTINATIONS.filter((d) => d.group === 'agent' && d.file?.kind === 'shared_file').map((d) => d.id)).toEqual(['codex_agents', 'gemini_cli'])
  })

  it('tells people to paste into a shared personal file, never to replace it', () => {
    for (const id of ['codex_agents', 'gemini_cli']) {
      const steps = destination(id)?.install.join(' ') ?? ''
      expect(steps, id).toMatch(/never replace/i)
    }
  })

  it('keeps copy clean of clinical words (A13)', () => {
    for (const d of DESTINATIONS) {
      for (const t of [d.label, d.limit_note, ...d.install, ...d.remove]) expect(lintLine(t).filter((h) => h.rule === 'a13'), t).toEqual([])
    }
  })

  it('resolves the form a destination takes', () => {
    const chat = destination('chatgpt_instructions')!
    expect(resolveForm(chat)).toBe('short')
    expect(resolveForm(chat, 'long')).toBe('long')
    expect(resolveForm(chat, 'skill')).toBe('short')
    expect(resolveForm(destination('claude_code_skill')!, 'short')).toBe('skill')
    expect(resolveForm(destination('gemini_instructions')!, 'long')).toBe('short')
  })
})

describe('staleness (checked date)', () => {
  it('warns when the data is more than 120 days old', () => {
    expect(STALE_AFTER_DAYS).toBe(120)
    expect(daysBetween('2026-09-28', '2026-09-29')).toBe(1)
    expect(surfacesStaleness('2026-09-29').stale).toBe(false)
    expect(surfacesStaleness('2027-01-26').stale).toBe(false) // 120 days
    const late = surfacesStaleness('2027-01-27') // 121 days
    expect(late.stale).toBe(true)
    expect(late.days).toBe(121)
    expect(late.warning).toContain(SURFACES.checked)
    expect(surfacesStaleness('2026-09-29').warning).toBe('')
  })

  it('treats a checked date in the future or an unreadable one sensibly', () => {
    expect(surfacesStaleness('2026-01-01').stale).toBe(false)
    expect(surfacesStaleness('not a date').stale).toBe(true)
  })

  it('is fresh at the date the data was assembled', () => {
    expect(surfacesStaleness(SURFACES.checked).stale).toBe(false)
  })
})

describe('download names and command blocks', () => {
  it('gives a unique-looking name per artifact', () => {
    const skill = destination('claude_code_skill')!
    expect(downloadName(skill, 'skill', '2026-11', 'k3f9')).toBe('hb-skill-2026-11-k3f9.md')
    expect(downloadName(destination('claude_code_rules')!, 'long', '2026-11', 'k3f9')).toBe('hb-rules-2026-11-k3f9.md')
    expect(downloadName(destination('chatgpt_instructions')!, 'short', '2026-11', 'k3f9')).toBe('hb-notes-2026-11-k3f9.txt')
    expect(downloadName(destination('claude_project')!, 'long', '2026-11', 'k3f9')).toBe('hb-notes-2026-11-k3f9.md')
    expect(downloadName(destination('own_app')!, 'long', '2026-11', 'k3f9')).toBe('hb-notes-2026-11-k3f9.json')
  })

  it('writes the Skill install exactly as the proposal shows, for macOS/Linux and PowerShell', () => {
    const [posix, win] = commandBlocks(destination('claude_code_skill')!, 'hb-skill-2026-11-k3f9.md')!
    expect(posix?.install).toBe(
      [
        'mkdir -p ~/.claude/skills/working-with-me',
        '[ -e ~/.claude/skills/working-with-me/SKILL.md ] && echo "A file with that name already exists; nothing was changed." || mv ~/Downloads/hb-skill-2026-11-k3f9.md ~/.claude/skills/working-with-me/SKILL.md',
      ].join('\n'),
    )
    expect(win?.install).toBe(
      [
        'New-Item -ItemType Directory -Force "$HOME\\.claude\\skills\\working-with-me" | Out-Null',
        'Move-Item "$HOME\\Downloads\\hb-skill-2026-11-k3f9.md" "$HOME\\.claude\\skills\\working-with-me\\SKILL.md"',
      ].join('\n'),
    )
  })

  it('has no "#" in any block, refuses to overwrite, and never removes recursively or forcibly', () => {
    for (const d of DESTINATIONS) {
      const blocks = commandBlocks(d, 'hb-x-2026-11-abcd.md')
      if (blocks === null) continue
      for (const b of blocks) {
        for (const text of [b.install, b.remove]) {
          expect(text, `${d.id} ${b.os}`).not.toContain('#')
          expect(text, `${d.id} ${b.os}`).not.toMatch(/rm\s+-\w*[rf]|Remove-Item[^\n]*-(?:Recurse|Force)|Move-Item[^\n]*-Force|mv\s+-f|cp\s|>\s*~/)
        }
        if (b.os === 'posix') {
          expect(b.install).toMatch(/\[ -e [^\n]+\] && echo "[^"]+" \|\| mv /)
          expect(b.remove).toMatch(/^rm /)
        } else {
          expect(b.install).toContain('Move-Item')
          expect(b.install).not.toMatch(/Force[^\n]*Move|Move-Item[^\n]*Force/)
        }
      }
    }
  })

  it('gives commands only to destinations that install a whole file', () => {
    expect(commandBlocks(destination('chatgpt_instructions')!, 'x.txt')).toBeNull()
    expect(commandBlocks(destination('codex_agents')!, 'x.md')).toBeNull()
    expect(commandBlocks(destination('claude_code_rules')!, 'x.md')![0]!.remove).toBe('rm ~/.claude/rules/working-with-me.md')
    expect(commandBlocks(destination('claude_code_skill')!, 'x.md')![0]!.remove).toBe('rm ~/.claude/skills/working-with-me/SKILL.md\nrmdir ~/.claude/skills/working-with-me')
  })
})
