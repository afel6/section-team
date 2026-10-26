import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { ADVISOR_HELPERS, ADVISOR_IDS, BUILDER_IDS, PASS_OVERALL, PREFIX, extractReport, failsGate, needsGate, parseReport, sectionIdFromType } from './lib/report.mjs'
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

const GATE_REASON = 'section-team: your REPORT lists changed code but no reviewer grade, so it cannot be handed back yet. Run Agent `section-team:reviewer` on your changed files with `run_in_background: false` (do not pass `model`) and wait for its GRADE. If it fails, have a coder apply the fix list and grade again, at most 2 fix rounds. Then hand back with `Quality: <overall>/10 (reviewer, <n> fix rounds)`. The testing section\'s final review does not replace your own gate. If the gate truly cannot run, hand back with `Status: partial` and say why.'

const FAILING_REASON = `section-team: your REPORT says done, but its reviewer grade is under the pass mark (${PASS_OVERALL}/10). Give the fix list to a coder and grade again with a new Agent \`section-team:reviewer\` call with \`run_in_background: false\` (do not pass \`model\`), at most 2 fix rounds in all. Never SendMessage the earlier reviewer: that resumes it in the background and you are made to hand back unfinished. If it still fails, hand back with \`Status: partial\` and the grade; start the Quality line with the final grade.`

// The clean-code gate, enforced where the REPORT leaves the section: a code REPORT that is ungraded, or claims done under the pass mark, is refused.
function handbackGate(id, e) {
  if (e.tool_name !== 'SubagentHandback' || !BUILDER_IDS.includes(id)) return null
  const block = extractReport(e.tool_input?.message)
  if (!block) return null
  const report = parseReport(block)
  if (needsGate(report)) return GATE_REASON
  return failsGate(report) ? FAILING_REASON : null
}

const FOREGROUND_REASON = 'section-team: run helpers in the foreground: pass `run_in_background: false` (or leave it out), never `true`. Independent helpers launched together in one message still run in parallel. A section that ends its turn while a helper runs is made to hand back unfinished.'

// A section that waits on a background helper ends its turn, and the harness then forces an unfinished handback.
// Only an explicit request is refused: some Agent tools (the desktop app's) have no run_in_background option and strip it.
function foregroundRule(e) {
  return e.tool_name === 'Agent' && e.tool_input?.run_in_background === true ? FOREGROUND_REASON : null
}

function advisorRule(id, e, home) {
  if (!ADVISOR_IDS.includes(id)) return null
  const tool = e.tool_name
  if (SHELL_TOOLS.has(tool)) return `section-team: the ${id} advisor is read-only; ${tool} is not allowed.`
  if (WRITE_TOOLS.has(tool)) {
    return isInMemory(e.tool_input?.file_path, id, e.cwd, home) ? null : `section-team: the ${id} advisor may only write inside its memory folder.`
  }
  if (tool === 'Agent' && !READ_ONLY_HELPERS.has(e.tool_input?.subagent_type)) {
    return `section-team: the ${id} advisor may only use read-only helpers (${ADVISOR_HELPERS.join(', ')}).`
  }
  return null
}

export function decide(e, home = homedir()) {
  if (typeof e?.agent_type !== 'string' || !e.agent_type.startsWith(PREFIX)) return null
  const id = sectionIdFromType(e.agent_type)
  if (!id) return null
  return handbackGate(id, e) ?? advisorRule(id, e, home) ?? foregroundRule(e)
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
