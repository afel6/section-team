import nodePath from 'node:path'
import { ADVISOR_HELPERS, ADVISOR_IDS, BUILDER_IDS, PREFIX, extractReport, failsGate, needsGate, parseReport, sectionIdFromType } from './lib/report.mjs'
import { DEFAULT_MODE, GATES, readMode } from './lib/mode.mjs'
import { isMainModule, lineOf, projectDirOf, projectRoot, readStdinJson } from './lib/paths.mjs'

const MESSAGE_PREFIX = 'section-team pre-tool-use'
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'NotebookEdit'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const READ_ONLY_HELPERS = new Set(ADVISOR_HELPERS)

// The advisor's own memory folder (memory: local) under one root: <cwd>/.claude/agent-memory-local/<id or section-team-<id>>/.
// Claude Code builds that path from the agent's working folder, never the git main root; a missing or relative root allows nothing.
// path is injectable so tests can apply POSIX rules on any OS, where a backslash is part of a file name, not a separator.
export function isInMemory(target, id, cwd, path = nodePath) {
  if (typeof target !== 'string' || target === '' || typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false
  const parts = path.relative(path.join(cwd, '.claude', 'agent-memory-local'), path.resolve(cwd, target)).split(path.sep)
  // The folder, then something inside it: a file named like the folder is not memory. '..' or another drive never equals the id.
  return parts.length >= 2 && (parts[0] === id || parts[0] === `section-team-${id}`)
}

const CANNOT_RUN = 'If the gate truly cannot run, hand back with `Status: ungraded` and say why.'
const fixRounds = n => `${n} fix round${n === 1 ? '' : 's'}`
const passRule = gate => `Pass: overall at least ${gate.passOverall}${gate.minItem === null ? '' : ` and no item under ${gate.minItem}`}.`
// Lean names the reviewer's model; the other modes leave it to the reviewer's own file.
const reviewerCall = gate => `\`run_in_background: false\` ${gate.reviewerModel === null ? '(do not pass `model`)' : `and \`model: "${gate.reviewerModel}"\``}`

// The handback gate's two refusals, worded from one mode's GATES entry.
export function gateReasons(gate) {
  return {
    ungraded: `section-team: your REPORT lists changed code but no reviewer grade, so it cannot be handed back yet. Run Agent \`section-team:reviewer\` on your changed files with ${reviewerCall(gate)} and wait for its GRADE. ${passRule(gate)} If it fails, have a coder apply the fix list and grade again, at most ${fixRounds(gate.fixRounds)}. Then hand back with \`Quality: <overall>/10 (reviewer, <n> fix rounds)\`. The testing section's final review does not replace your own gate. ${CANNOT_RUN}`,
    failing: `section-team: your REPORT says done, but its reviewer grade is under the pass mark (${gate.passOverall}/10). Give the fix list to a coder and grade again with a new Agent \`section-team:reviewer\` call with ${reviewerCall(gate)}, at most ${fixRounds(gate.fixRounds)} in all. Never SendMessage the earlier reviewer: that resumes it in the background and you are made to hand back unfinished. ${CANNOT_RUN} If it still fails, hand back with \`Status: partial\` and the grade; start the Quality line with the final grade.`,
  }
}

// The gate of the session's project (CLAUDE_PROJECT_DIR, else the event's cwd); Balanced when there is no folder or its mode file is unusable.
function projectGate(e, env) {
  const dir = projectDirOf(e, env)
  return GATES[dir === null ? DEFAULT_MODE : readMode(projectRoot(dir)).mode]
}

// The clean-code gate, enforced where the REPORT leaves the section: a code REPORT that is ungraded, or claims done under the mode's pass mark, is refused.
function handbackGate(id, e, env) {
  if (e.tool_name !== 'SubagentHandback' || !BUILDER_IDS.includes(id)) return null
  const block = extractReport(e.tool_input?.message)
  if (!block) return null
  const report = parseReport(block)
  const gate = projectGate(e, env)
  if (needsGate(report)) return gateReasons(gate).ungraded
  return failsGate(report, gate.passOverall) ? gateReasons(gate).failing : null
}

const FOREGROUND_REASON = 'section-team: run helpers in the foreground: pass `run_in_background: false` (or leave it out), never `true`. Independent helpers launched together in one message still run in parallel. A section that ends its turn while a helper runs is made to hand back unfinished.'

// A section that waits on a background helper ends its turn, and the harness then forces an unfinished handback.
// Only an explicit request is refused: some Agent tools (the desktop app's) have no run_in_background option and strip it.
function foregroundRule(e) {
  return e.tool_name === 'Agent' && e.tool_input?.run_in_background === true ? FOREGROUND_REASON : null
}

function advisorRule(id, e, env) {
  if (!ADVISOR_IDS.includes(id)) return null
  const tool = e.tool_name
  if (SHELL_TOOLS.has(tool)) return `section-team: the ${id} advisor is read-only; ${tool} is not allowed.`
  if (WRITE_TOOLS.has(tool)) {
    // Claude Code builds local memory from the agent's working folder (the event's cwd); the session's project dir counts too.
    const inMemory = [e.cwd, projectDirOf(e, env)].some(root => isInMemory(e.tool_input?.file_path, id, root))
    return inMemory ? null : `section-team: the ${id} advisor may only write inside its memory folder.`
  }
  if (tool === 'Agent' && !READ_ONLY_HELPERS.has(e.tool_input?.subagent_type)) {
    return `section-team: the ${id} advisor may only use read-only helpers (${ADVISOR_HELPERS.join(', ')}).`
  }
  return null
}

export function decide(e, env = process.env) {
  if (typeof e?.agent_type !== 'string' || !e.agent_type.startsWith(PREFIX)) return null
  const id = sectionIdFromType(e.agent_type)
  if (!id) return null
  return handbackGate(id, e, env) ?? advisorRule(id, e, env) ?? foregroundRule(e)
}

const notice = text => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: ${text}` }))

// A hook that cannot check says so in one line and denies nothing.
async function main() {
  const e = await readStdinJson()
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return notice('the hook input is not a JSON object, so no rule was checked')
  const reason = decide(e)
  if (reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }))
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(err => notice(`no rule was checked: ${lineOf(err)}`))
}
