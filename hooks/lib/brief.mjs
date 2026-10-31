import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertMode } from './mode.mjs'

const BRIEF_DIR = fileURLToPath(new URL('../../brief/', import.meta.url))

// Each marker line in core.md and the part that fills it: <part>-<mode>.md.
const SLOTS = Object.freeze([
  ['{{TIERS}}', 'tiers'],
  ['{{GATE}}', 'gate'],
])

// A part's text without its trailing newline; the error names the file but never the folder.
function readPart(briefDir, name) {
  try {
    return readFileSync(join(briefDir, `${name}.md`), 'utf8').trimEnd()
  } catch (err) {
    throw new Error(`brief part ${name}.md could not be read (${err?.code ?? 'unknown error'})`, { cause: err })
  }
}

const coreLines = briefDir => readPart(briefDir, 'core').split('\n')

// The index of the marker's line: it must appear once, on its own line, directly under a `## ` heading.
function slotAt(lines, marker) {
  const at = lines.indexOf(marker)
  if (at < 1 || !lines[at - 1].startsWith('## ') || lines.indexOf(marker, at + 1) !== -1) {
    throw new Error(`brief part core.md must hold ${marker} once, on its own line under a heading`)
  }
  return at
}

// The supervisor brief for a mode: core.md with each marker line replaced by that mode's part.
export function assembleBrief(mode, briefDir = BRIEF_DIR) {
  assertMode(mode)
  const filled = SLOTS.reduce(
    (lines, [marker, part]) => lines.with(slotAt(lines, marker), readPart(briefDir, `${part}-${mode}`)),
    coreLines(briefDir),
  )
  return filled.join('\n').trim()
}

// Only the mode's own rules (each part under its core heading), for announcing a mode switch mid-session.
export function modeRules(mode, briefDir = BRIEF_DIR) {
  assertMode(mode)
  const lines = coreLines(briefDir)
  return SLOTS.map(([marker, part]) => `${lines[slotAt(lines, marker) - 1]}\n${readPart(briefDir, `${part}-${mode}`)}`).join('\n\n')
}
