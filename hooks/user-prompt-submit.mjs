import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { modeRules } from './lib/brief.mjs'
import { MODES, modeName, readMode } from './lib/mode.mjs'
import { isMainModule, lineOf, projectDirOf, projectRoot, readStdinJson } from './lib/paths.mjs'
import { modeRecordFile, recordMode } from './session-start.mjs'

const MESSAGE_PREFIX = 'section-team user-prompt-submit'
const SKIPPED = 'mode switch check skipped'

function attempt(label, fn) {
  try {
    return { value: fn(), warning: null }
  } catch (err) {
    return { value: null, warning: `${label} failed: ${lineOf(err)}` }
  }
}

// The mode in a record's text. Throws one line when the text is not a record recordMode could have written.
function parseRecord(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = null // not JSON: reported just below as an invalid record
  }
  if (!MODES.includes(data?.mode)) throw new Error('mode record is not valid')
  return data.mode
}

// The mode the session last ran in, or null when it has no record yet (a session from before 0.2.0, or a record never written).
function readRecord(file) {
  try {
    return parseRecord(readFileSync(file, 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw err
  }
}

const noticeText = (previous, mode) => `Mode is now ${modeName(mode)} (was ${modeName(previous)}). From your next step on:\n\n${modeRules(mode)}`

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
export function promptCheck({ cwd, session_id: sessionId }, home = homedir()) {
  let file
  try {
    file = modeRecordFile(home, sessionId)
  } catch (err) {
    return { notice: null, warnings: [`${SKIPPED}: ${err.message}`] }
  }
  const read = attempt('mode record read', () => readRecord(file))
  const decision = decide(read.value, readMode(projectRoot(cwd)))
  const saved = decision.keep === null ? { warning: null } : attempt('mode record', () => recordMode(home, sessionId, decision.keep))
  const warnings = [read.warning, decision.warning, saved.warning].filter(warning => warning !== null)
  return { notice: saved.warning === null ? decision.notice : null, warnings }
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
    : promptCheck({ cwd: dir, session_id: input?.session_id }, homedir())
  const output = hookOutput(result)
  if (Object.keys(output).length > 0) process.stdout.write(JSON.stringify(output))
}

if (isMainModule(import.meta.url)) {
  main().catch(err => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: mode switch check failed: ${lineOf(err)}` })))
}
