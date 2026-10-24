import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ADVISOR_HELPERS, ADVISOR_IDS, BUILDER_IDS, PREFIX, extractReport, needsGate, parseReport, sectionIdFromType } from './lib/report.mjs'
import { isMainModule, readStdinJson } from './lib/paths.mjs'

const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'NotebookEdit'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const READ_ONLY_HELPERS = new Set(ADVISOR_HELPERS)

export function isInMemory(target, id, cwd, home) {
  if (typeof target !== 'string' || target === '') return false
  const rel = relative(join(home, '.claude', 'agent-memory'), resolve(cwd ?? '.', target))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false
  const folder = rel.split(/[\\/]/)[0]
  return folder === id || folder === `section-team-${id}`
}

const GATE_REASON = 'section-team: your REPORT lists changed code but no reviewer grade, so it cannot be handed back yet. Run Agent `section-team:reviewer` on your changed files in the foreground (do not pass `model`, do not run it in the background) and wait for its GRADE. If it fails, have a coder apply the fix list and grade again, at most 2 fix rounds. Then hand back with `Quality: <overall>/10 (reviewer, <n> fix rounds)`. The testing section\'s final review does not replace your own gate. If the gate truly cannot run, hand back with `Status: partial` and say why.'

// The clean-code gate, enforced where the REPORT leaves the section: an ungraded REPORT that changed code is refused.
function handbackGate(id, e) {
  if (e.tool_name !== 'SubagentHandback' || !BUILDER_IDS.includes(id)) return null
  const block = extractReport(e.tool_input?.message)
  return block && needsGate(parseReport(block)) ? GATE_REASON : null
}

export function decide(e, home = homedir()) {
  if (typeof e?.agent_type !== 'string' || !e.agent_type.startsWith(PREFIX)) return null
  const id = sectionIdFromType(e.agent_type)
  if (!id) return null
  const gate = handbackGate(id, e)
  if (gate) return gate
  if (!ADVISOR_IDS.includes(id)) return null
  const tool = e.tool_name
  if (SHELL_TOOLS.has(tool)) return `section-team: the ${id} advisor is read-only; ${tool} is not allowed.`
  if (WRITE_TOOLS.has(tool)) {
    return isInMemory(e.tool_input?.file_path, id, e.cwd, home) ? null : `section-team: the ${id} advisor may only write inside its memory folder.`
  }
  if (tool === 'Agent') {
    return READ_ONLY_HELPERS.has(e.tool_input?.subagent_type) ? null : `section-team: the ${id} advisor may only use read-only helpers (${ADVISOR_HELPERS.join(', ')}).`
  }
  return null
}

if (isMainModule(import.meta.url)) {
  readStdinJson()
    .then(e => {
      const reason = decide(e)
      if (reason) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }))
      }
    })
    .catch(err => process.stderr.write(`section-team pre-tool-use: ${err.message}\n`))
}
