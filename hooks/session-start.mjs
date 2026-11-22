import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { assembleBrief, briefHash } from './lib/brief.mjs'
import { DEFAULT_MODE, MODE_FILE, OFF_MODE, RETIRED_LINE, modeName, readMode } from './lib/mode.mjs'
import { isSessionId, modeRecordDir, readBriefHash, recordBriefHash, recordMode } from './lib/mode-record.mjs'
import { ensureExcluded, ensureNotes, excludeFile, isMainModule, latestSummary, lineOf, projectDirOf, projectRoot, pruneStatus, readStdinJson } from './lib/paths.mjs'
import { statusDir } from './sessions-model.mjs'

// Opt-in: by default the supervisor asks before installing a skill a section suggested.
export const AUTO_INSTALL_ENV = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'
const MESSAGE_PREFIX = 'section-team session-start'

const AUTO_INSTALL_NOTE = [
  '## Skill installs',
  `- Automatic skill installs are on (${AUTO_INSTALL_ENV}=1): install a section's \`Suggested skill:\` with \`section-team:add-skill\` without asking when the add-skill safety review finds no red flag. A red flag stops the install and you tell the user. List every skill you installed in your summary.`,
].join('\n')

export const FILE_ON_IGNORED = `${MODE_FILE}: autoInstallSkills true is ignored, because a project file cannot turn on automatic skill installs; set ${AUTO_INSTALL_ENV}=1 in your user settings instead`

// Whether skill installs are automatic, and where that came from. Only the environment's exact '1' turns them on (any other set value
// is named as the source of off). The mode file, which a cloned repo can commit, may turn them off but never on: its true is ignored,
// with a notice when the environment does not turn them on anyway.
function skillSetting(autoInstallSkills, env) {
  if (autoInstallSkills === false) return { on: false, from: MODE_FILE, notice: null }
  const on = env[AUTO_INSTALL_ENV] === '1'
  const from = env[AUTO_INSTALL_ENV] === undefined ? null : AUTO_INSTALL_ENV
  return { on, from, notice: autoInstallSkills === true && !on ? FILE_ON_IGNORED : null }
}

// Every mode: a section that could not run its gate hands back ungraded work, which the supervisor grades from outside.
const UNGRADED_LINE = "A section REPORT with `Status: ungraded` could not run its reviewer gate: run `section-team:reviewer` on its changed files with this mode's gate before you call that work done."

// The 2026-11-09 p1 round: each --resume re-sent the whole brief, which the resumed history already holds.
const BRIEF_KEPT_LINE = 'Your team brief from the start of this session still applies.'

export const OFF_LINE = `section-team is off in this project (${MODE_FILE} says "${OFF_MODE}"), so the team brief was not added; /team mode balanced turns it back on from your next session`

const PLAN_LINE = '`.team/notes/plan.md` exists: read it first. `.team/` is at the project root, which is the main checkout in a worktree session.'

function modeSection(mode, skills, problem, retired) {
  return [
    '## Mode',
    `- This project runs in ${modeName(mode)} mode (${mode === DEFAULT_MODE ? 'default' : `from ${MODE_FILE}`}).`,
    ...(retired === undefined ? [] : [`- ${RETIRED_LINE}`]),
    `- Automatic skill installs: ${skills.on ? 'on' : 'off'} (${skills.from === null ? 'default' : `from ${skills.from}`}).`,
    ...(skills.notice === null ? [] : [`- ${skills.notice}.`]),
    `- ${UNGRADED_LINE}`,
    ...(problem === null ? [] : [`- ${problem}.`]),
  ].join('\n')
}

// The session context from readMode's answer: the mode's brief, the install note when installs are automatic, the last summary, the plan line when a plan exists, then the Mode section.
// briefKept: the session already holds this brief (a resume), so one line stands in for it.
export function composeContext({ mode, autoInstallSkills, problem, retired }, env, summary, hasPlan = false, { briefKept = false } = {}) {
  const skills = skillSetting(autoInstallSkills, env)
  return [
    briefKept ? BRIEF_KEPT_LINE : assembleBrief(mode),
    skills.on ? AUTO_INSTALL_NOTE : null,
    summary ? `Last team summary: ${summary}. Read it first.` : null,
    hasPlan ? PLAN_LINE : null,
    modeSection(mode, skills, problem, retired),
  ].filter(part => part !== null).join('\n\n')
}

// The brief must reach the session even when a side effect fails (EISDIR, ENOTDIR, EACCES): the failure becomes one stderr line with the details
// and one warning for the user that names only the error code (or our own one-line message), never a path.
function attempt(label, fn) {
  try {
    return { value: fn(), warning: null }
  } catch (err) {
    const detail = String(err?.message ?? err).replace(/\s+/g, ' ').trim()
    process.stderr.write(`${MESSAGE_PREFIX}: ${label} failed: ${detail}\n`)
    return { value: null, warning: `${label} failed: ${lineOf(err)}` }
  }
}

// The latest summary from the project root, with forward slashes: short and bounded, and no home folder in the context.
function summaryPath(root) {
  const file = latestSummary(root)
  return file === null ? null : relative(root, file).split(sep).join('/')
}

// On resume, whether the session's recorded brief hash is the hash of the brief for the project's current mode. A failed read means no, with its warning.
// No usable session id means no and no warning: the mode record already says so.
function briefStillHeld(source, home, sessionId, hash) {
  if (source !== 'resume' || !isSessionId(sessionId)) return { value: false, warning: null }
  return attempt('brief record read', () => readBriefHash(home, sessionId) === hash)
}

// The session context, and the one-line warnings for the user: the mode file's problem, the retired-mode line, then each failed side effect.
// sessionId undefined (a direct caller) skips the mode record; any other value is recorded, and a bad one (null from a hook input without an id) becomes a warning.
// source is the SessionStart source: on 'resume' an unchanged brief is left out; otherwise the full brief goes in and its hash is recorded.
// now is the clock the prunes compare file times with.
export function startContext(cwd, home = homedir(), env = process.env, sessionId, { source, now = Date.now() } = {}) {
  const root = projectRoot(cwd)
  const setting = readMode(root)
  // The prunes only delete old files under the home folder, so they run in an off project too: a user whose projects are all off still prunes.
  const pruneWarnings = [
    ['status prune', () => pruneStatus(statusDir(home), now)],
    ['mode record prune', () => pruneStatus(modeRecordDir(home), now)],
  ].map(([label, fn]) => attempt(label, fn).warning)
  // A project switched off gets no brief and nothing else written: no git exclude edit, no notes folder, no records.
  if (setting.off) return { context: null, warnings: [OFF_LINE, ...pruneWarnings].filter(warning => warning !== null) }
  const steps = [
    ['git exclude update', () => ensureExcluded(cwd, root)],
    ...(excludeFile(cwd) ? [['notes folder', () => ensureNotes(root)]] : []), // a plain folder gets no .team/ until a section writes a note
    ...(sessionId === undefined ? [] : [['mode record', () => recordMode(home, sessionId, setting.mode)]]),
  ]
  const stepWarnings = [...pruneWarnings, ...steps.map(([label, fn]) => attempt(label, fn).warning)]
  const summary = attempt('summary lookup', () => summaryPath(root))
  const hasPlan = existsSync(join(root, '.team', 'notes', 'plan.md'))
  // A saved lean is told to the user as well as to the supervisor (the Mode section).
  const retired = setting.retired === undefined ? null : RETIRED_LINE
  const hash = briefHash(setting.mode)
  const held = briefStillHeld(source, home, sessionId, hash)
  const context = composeContext(setting, env, summary.value, hasPlan, { briefKept: held.value === true })
  const recorded = held.value === true || !isSessionId(sessionId) ? { warning: null } : attempt('brief record', () => recordBriefHash(home, sessionId, hash))
  const skillNotice = skillSetting(setting.autoInstallSkills, env).notice
  const warnings = [setting.problem, skillNotice, retired, ...stepWarnings, summary.warning, held.warning, recorded.warning].filter(warning => warning !== null)
  return { context, warnings }
}

export function buildContext(cwd, home = homedir(), env = process.env, sessionId, options) {
  return startContext(cwd, home, env, sessionId, options).context
}

const skipped = why => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: skipped: ${why}, so the team brief was not added` }))

async function main() {
  const input = await readStdinJson()
  const dir = projectDirOf(input)
  if (dir === null) return skipped(input === null ? 'the hook input is not JSON' : 'the hook input has no absolute cwd')
  const { context, warnings } = startContext(dir, homedir(), process.env, input?.session_id ?? null, { source: input?.source })
  const output = context === null ? {} : { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }
  process.stdout.write(JSON.stringify(warnings.length === 0 ? output : { systemMessage: `${MESSAGE_PREFIX}: ${warnings.join('; ')}`, ...output }))
}

if (isMainModule(import.meta.url)) {
  main().catch(err => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: ${lineOf(err)}` })))
}
