import { existsSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { briefHash, modeRules } from './lib/brief.mjs'
import { isHarnessFrame } from './lib/frames.mjs'
import { activeMode, modeName, readMode } from './lib/mode.mjs'
import { assertSessionId, isSessionId, modeRecordDir, modeRecordFile, readRecord, recordBriefHash, recordMode } from './lib/mode-record.mjs'
import { statusDir } from './sessions-model.mjs'
import { isIgnored, isMainModule, lineOf, projectDirOf, projectRoot, readStdinJson, writeReport } from './lib/paths.mjs'
import { redact } from './lib/redact.mjs'

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
const pointerText = path => `The user's message is saved word for word, with recognised secrets shown as [redacted], in \`${path}\`: point sections to that file instead of re-typing it, and quote only the lines a job needs.`
const isLong = prompt => typeof prompt === 'string' && prompt.length >= LONG_PROMPT
const savable = prompt => isLong(prompt) && !isHarnessFrame(prompt)

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
  const notice = saved.warning === null ? decision.notice : null
  // The start brief plus the notice is the new mode's brief, so a resume in that mode can leave it out and one in another mode cannot.
  const briefSaved = notice === null ? { warning: null } : attempt('brief record', () => recordBriefHash(home, sessionId, briefHash(decision.keep)))
  const warnings = [read.warning, decision.warning, saved.warning, briefSaved.warning].filter(warning => warning !== null)
  return { notice, warnings }
}

// Saves a long prompt word for word, its secrets redacted, as .team/reports/<date>/<time>-user-request.md and returns that path relative to root,
// with forward slashes; null when the prompt is short, not a string or a harness frame, when git does not ignore the .team/ folder itself (outside git,
// with .team/keep-in-git, or before session-start excluded .team/), or without a .team/ folder. Throws when the file cannot be written.
export function saveRequest(root, prompt, ignored, now = new Date()) {
  if (!savable(prompt) || !ignored) return null
  if (statSync(join(root, '.team'), { throwIfNoEntry: false })?.isDirectory() !== true) return null
  return relative(root, writeReport(root, 'user-request', redact(prompt), now)).split(sep).join('/')
}

// The Team Board writes <statusDir>/<session id>.json on its first poll; Claude Code's early-access Mods API may not load it at all.
export const BOARD_GRACE_MS = 30000
const BOARD_LINE = "section-team: the Team Board did not load in this session (Claude Code's early-access Mods API); /team and the Mode picker are unavailable, and .team/mode.json still sets the mode."
// A line that starts this way is a whole sentence for the user, shown as it is rather than behind the hook's name.
const OWN_SENTENCE = 'section-team: '

// True the first time: the marker is made; false once it exists.
function claimOnce(file) {
  try {
    writeFileSync(file, '{}', { flag: 'wx' })
    return true
  } catch (err) {
    if (err.code === 'EEXIST') return false
    throw err
  }
}

// A file's mtimeMs, or undefined when it is missing. Node 20 and 22 throw ENOTDIR for a path under a file even with throwIfNoEntry: false.
export function mtimeOf(file, stat = statSync) {
  try {
    return stat(file).mtimeMs
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return undefined
    throw err
  }
}

// The board-load line once per session, or null. The session's mode record was last written at session start or by the previous prompt;
// read before this prompt rewrites it, a record at least BOARD_GRACE_MS old means the board has had that long. The marker ends in .json,
// so the modes folder's weekly prune removes it.
// ponytail: matches the status file by the hook's session id; if the board's $.session.id() differs, match the newest file whose cwd is the root.
export function boardCheck(home, sessionId, now = Date.now()) {
  if (!isSessionId(sessionId)) return null
  const written = mtimeOf(modeRecordFile(home, sessionId))
  if (written === undefined || now - written < BOARD_GRACE_MS) return null
  if (!claimOnce(join(modeRecordDir(home), `${sessionId}.board-checked.json`))) return null
  return existsSync(join(statusDir(home), `${sessionId}.json`)) ? null : BOARD_LINE
}

// The mode check, the saved request and the board check: the notice and the pointer join with a blank line, a failed save is one more warning,
// and the board line comes last. git is asked whether it ignores .team/ (so everything under it) only for a long prompt, so a short one costs no extra process.
export function promptCheck({ cwd, session_id: sessionId, prompt }, home = homedir()) {
  const root = projectRoot(cwd)
  // A project switched off is left alone: no notice, no record, no saved request. Switching off or back on applies from the next session.
  if (readMode(root).off) return { notice: null, warnings: [] }
  const board = attempt('board check', () => boardCheck(home, sessionId))
  const mode = modeCheck(root, sessionId, home)
  const request = attempt('request save', () => saveRequest(root, prompt, savable(prompt) && isIgnored(root, '.team/')))
  const parts = [mode.notice, request.value === null ? null : pointerText(request.value)].filter(part => part !== null)
  const warnings = [...mode.warnings, request.warning, board.warning, board.value].filter(warning => warning !== null)
  return { notice: parts.length === 0 ? null : parts.join('\n\n'), warnings }
}

export function modeSwitch(e, home = homedir()) {
  return promptCheck(e, home).notice
}

// The hook's own warnings behind its name, then each whole sentence as it is.
function systemMessageOf(warnings) {
  const own = warnings.filter(w => !w.startsWith(OWN_SENTENCE))
  return [own.length === 0 ? null : `${MESSAGE_PREFIX}: ${own.join('; ')}`, ...warnings.filter(w => w.startsWith(OWN_SENTENCE))].filter(Boolean).join(' ')
}

function hookOutput({ notice, warnings }) {
  return {
    ...(warnings.length === 0 ? {} : { systemMessage: systemMessageOf(warnings) }),
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
