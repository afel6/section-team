import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { modeRules } from './lib/brief.mjs'
import { activeMode, modeName, readMode } from './lib/mode.mjs'
import { assertSessionId, readRecord, recordMode } from './lib/mode-record.mjs'
import { excludeFile, isMainModule, lineOf, projectDirOf, projectRoot, readStdinJson, writeReport } from './lib/paths.mjs'

const MESSAGE_PREFIX = 'section-team user-prompt-submit'
const SKIPPED = 'mode switch check skipped'
// The notice's sections take the place of the same-headed ones in the brief, so a switch back to Balanced cancels Max rules.
const REPLACES = "These sections replace the ones with the same headings in your brief; your next job message to a section states this mode's gate."
// The 2026-11-09 p1 round: the supervisor re-typed each pasted spec into notes, because sections cannot see its conversation.
export const LONG_PROMPT = 3000

function attempt(label, fn) {
  try {
    return { value: fn(), warning: null }
  } catch (err) {
    return { value: null, warning: `${label} failed: ${lineOf(err)}` }
  }
}

const noticeText = (previous, mode) => `Mode is now ${modeName(mode)} (was ${modeName(previous)}). From your next step on:\n${REPLACES}\n\n${modeRules(mode)}`
const pointerText = path => `The user's message is saved word for word in \`${path}\`: point sections to that file instead of re-typing it, and quote only the lines a job needs.`
const isLong = prompt => typeof prompt === 'string' && prompt.length >= LONG_PROMPT

// A session with a record keeps its mode while the file is unusable (the handback gate does the same), so the problem line says so.
const keptModeEnding = previous => (previous === null ? undefined : `so this session stays in ${modeName(previous)} mode`)

// What this prompt does: the notice (or null), the mode to keep in the record (null keeps nothing) and a warning (or null).
// A mode the file cannot give skips the check and keeps the mode the session runs in; a usable mode still passes on its problem
// line (a bad autoInstallSkills). The notice is built before the record changes, so a brief part that cannot be read throws
// with the old record still in place, and the next prompt tries again.
function decide(previous, setting) {
  if (!setting.modeUsable) return { notice: null, keep: previous, warning: `${SKIPPED}: ${setting.problem}` }
  const warning = setting.problem
  if (previous === null || previous === setting.mode) return { notice: null, keep: setting.mode, warning }
  return { notice: noticeText(previous, setting.mode), keep: setting.mode, warning }
}

// The notice for the supervisor (once, on the first prompt after the project's mode changed) and the one-line warnings for the user.
// The record is rewritten on every prompt, so a quiet session is not pruned after 7 days; the notice is held back unless it was saved.
function modeCheck(root, sessionId, home) {
  try {
    assertSessionId(sessionId)
  } catch (err) {
    return { notice: null, warnings: [`${SKIPPED}: ${err.message}`] }
  }
  const read = attempt('mode record read', () => activeMode(readRecord(home, sessionId)))
  const decision = decide(read.value, readMode(root, keptModeEnding(read.value)))
  const saved = decision.keep === null ? { warning: null } : attempt('mode record', () => recordMode(home, sessionId, decision.keep))
  const warnings = [read.warning, decision.warning, saved.warning].filter(warning => warning !== null)
  return { notice: saved.warning === null ? decision.notice : null, warnings }
}

// Saves a long prompt word for word as .team/reports/<date>/<time>-user-request.md and returns that path relative to root,
// with forward slashes; null when the prompt is short or not a string, outside git, without a .team/ folder, or when
// .team/keep-in-git puts .team/ in git. Throws when the file cannot be written.
export function saveRequest(root, prompt, inGit, now = new Date()) {
  if (!isLong(prompt) || !inGit) return null
  const team = join(root, '.team')
  if (statSync(team, { throwIfNoEntry: false })?.isDirectory() !== true) return null
  if (existsSync(join(team, 'keep-in-git'))) return null
  return relative(root, writeReport(root, 'user-request', prompt, now)).split(sep).join('/')
}

// The mode check and the saved request: the notice and the pointer join with a blank line, and a failed save is one more warning.
// git is asked whether the folder is in a repo only for a long prompt, so a short one costs no extra process.
export function promptCheck({ cwd, session_id: sessionId, prompt }, home = homedir()) {
  const root = projectRoot(cwd)
  const mode = modeCheck(root, sessionId, home)
  const request = attempt('request save', () => saveRequest(root, prompt, isLong(prompt) && excludeFile(cwd) !== null))
  const parts = [mode.notice, request.value === null ? null : pointerText(request.value)].filter(part => part !== null)
  const warnings = request.warning === null ? mode.warnings : [...mode.warnings, request.warning]
  return { notice: parts.length === 0 ? null : parts.join('\n\n'), warnings }
}

export function modeSwitch(e, home = homedir()) {
  return promptCheck(e, home).notice
}

function hookOutput({ notice, warnings }) {
  return {
    ...(warnings.length === 0 ? {} : { systemMessage: `${MESSAGE_PREFIX}: ${warnings.join('; ')}` }),
    ...(notice === null ? {} : { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notice } }),
  }
}

async function main() {
  const input = await readStdinJson()
  const dir = projectDirOf(input)
  const result = dir === null
    ? { notice: null, warnings: [`${SKIPPED}: the hook input has no absolute cwd`] }
    : promptCheck({ cwd: dir, session_id: input?.session_id, prompt: input?.prompt }, homedir())
  const output = hookOutput(result)
  if (Object.keys(output).length > 0) process.stdout.write(JSON.stringify(output))
}

if (isMainModule(import.meta.url)) {
  main().catch(err => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: mode switch check failed: ${lineOf(err)}` })))
}
