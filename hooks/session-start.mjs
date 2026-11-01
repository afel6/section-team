import { homedir } from 'node:os'
import { relative, sep } from 'node:path'
import { assembleBrief } from './lib/brief.mjs'
import { DEFAULT_MODE, MODE_FILE, modeName, readMode } from './lib/mode.mjs'
import { modeRecordDir, recordMode } from './lib/mode-record.mjs'
import { ensureExcluded, ensureNotes, excludeFile, isMainModule, latestSummary, lineOf, projectDirOf, projectRoot, pruneStatus, readStdinJson } from './lib/paths.mjs'
import { statusDir } from './sessions-model.mjs'

// Opt-in: by default the supervisor asks before installing a skill a section suggested.
export const AUTO_INSTALL_ENV = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'
const MESSAGE_PREFIX = 'section-team session-start'

const autoInstallNote = source => [
  '## Skill installs',
  `- Automatic skill installs are on (${source}), which replaces asking first: install a section's \`Suggested skill:\` with \`section-team:add-skill\` without asking when the add-skill safety review finds no red flag. A red flag stops the install and you tell the user. List every skill you installed in your summary.`,
].join('\n')

// Whether skill installs are automatic, and where that came from: the mode file wins, then the environment when it is set
// (only exactly '1' turns installs on, and any other set value is named as the source of off), else off by default.
function skillSetting(autoInstallSkills, env) {
  if (autoInstallSkills !== null) return { on: autoInstallSkills, from: MODE_FILE }
  if (env[AUTO_INSTALL_ENV] === undefined) return { on: false, from: null }
  return { on: env[AUTO_INSTALL_ENV] === '1', from: AUTO_INSTALL_ENV }
}

// Every mode: a section that could not run its gate hands back ungraded work, which the supervisor grades from outside.
const UNGRADED_LINE = "A section REPORT with `Status: ungraded` could not run its reviewer gate: run `section-team:reviewer` on its changed files with this mode's gate before you call that work done."

function modeSection(mode, skills, problem) {
  return [
    '## Mode',
    `- This project runs in ${modeName(mode)} mode (${mode === DEFAULT_MODE ? 'default' : `from ${MODE_FILE}`}).`,
    `- Automatic skill installs: ${skills.on ? 'on' : 'off'} (${skills.from === null ? 'default' : `from ${skills.from}`}).`,
    `- ${UNGRADED_LINE}`,
    ...(problem === null ? [] : [`- ${problem}.`]),
  ].join('\n')
}

// The session context from readMode's answer: the mode's brief, the install note when installs are automatic, the last summary, then the Mode section.
export function composeContext({ mode, autoInstallSkills, problem }, env, summary) {
  const skills = skillSetting(autoInstallSkills, env)
  return [
    assembleBrief(mode),
    skills.on ? autoInstallNote(skills.from === AUTO_INSTALL_ENV ? `${AUTO_INSTALL_ENV}=1` : MODE_FILE) : null,
    summary ? `Last team summary for this project: ${summary}. Read it before new team work.` : null,
    modeSection(mode, skills, problem),
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

// The session context, and the one-line warnings for the user: the mode file's problem, then each failed side effect.
// sessionId undefined (a direct caller) skips the mode record; any other value is recorded, and a bad one (null from a hook input without an id) becomes a warning.
export function startContext(cwd, home = homedir(), env = process.env, sessionId) {
  const root = projectRoot(cwd)
  const setting = readMode(root)
  const steps = [
    ['git exclude update', () => ensureExcluded(cwd, root)],
    ...(excludeFile(cwd) ? [['notes folder', () => ensureNotes(root)]] : []), // a plain folder gets no .team/ until a section writes a note
    ['status prune', () => pruneStatus(statusDir(home))],
    ['mode record prune', () => pruneStatus(modeRecordDir(home))],
    ...(sessionId === undefined ? [] : [['mode record', () => recordMode(home, sessionId, setting.mode)]]),
  ]
  const stepWarnings = steps.map(([label, fn]) => attempt(label, fn).warning)
  const summary = attempt('summary lookup', () => summaryPath(root))
  const warnings = [setting.problem, ...stepWarnings, summary.warning].filter(warning => warning !== null)
  return { context: composeContext(setting, env, summary.value), warnings }
}

export function buildContext(cwd, home = homedir(), env = process.env, sessionId) {
  return startContext(cwd, home, env, sessionId).context
}

const skipped = why => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: skipped: ${why}, so the team brief was not added` }))

async function main() {
  const input = await readStdinJson()
  const dir = projectDirOf(input)
  if (dir === null) return skipped(input === null ? 'the hook input is not JSON' : 'the hook input has no absolute cwd')
  const { context, warnings } = startContext(dir, homedir(), process.env, input?.session_id ?? null)
  const output = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }
  process.stdout.write(JSON.stringify(warnings.length === 0 ? output : { systemMessage: `${MESSAGE_PREFIX}: ${warnings.join('; ')}`, ...output }))
}

if (isMainModule(import.meta.url)) {
  main().catch(err => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: ${lineOf(err)}` })))
}
