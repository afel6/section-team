import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { assembleBrief } from './lib/brief.mjs'
import { DEFAULT_MODE, assertMode, readMode } from './lib/mode.mjs'
import { ensureExcluded, ensureNotes, excludeFile, isMainModule, latestSummary, projectRoot, pruneStatus, readStdinJson } from './lib/paths.mjs'
import { statusDir } from './sessions-model.mjs'

// Opt-in: by default the supervisor asks before installing a skill a section suggested.
export const AUTO_INSTALL_ENV = 'SECTION_TEAM_AUTO_INSTALL_SKILLS'
const MODE_FILE = '.team/mode.json'
const MESSAGE_PREFIX = 'section-team session-start'
// The id becomes a file name, so only plain characters pass.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

const autoInstallNote = source => [
  '## Skill installs',
  `- Automatic skill installs are on (${source}), which replaces asking first: install a section's \`Suggested skill:\` with \`section-team:add-skill\` without asking when the add-skill safety review finds no red flag. A red flag stops the install and you tell the user. List every skill you installed in your summary.`,
].join('\n')

// The display name of a mode: 'max' → 'Max'.
const modeName = mode => mode[0].toUpperCase() + mode.slice(1)

// Where each session's mode is kept, so a later hook can tell when the project's mode changed.
export function modeRecordDir(home) {
  return `${home}/.claude/section-team/modes`
}

// Saves the mode a session runs in as {"mode":"<mode>"}. Throws one line on a bad session id or an unknown mode.
export function recordMode(home, sessionId, mode) {
  if (typeof sessionId !== 'string' || !SESSION_ID_PATTERN.test(sessionId)) throw new Error('no usable session id (letters, digits, - and _ only)')
  assertMode(mode)
  const dir = modeRecordDir(home)
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/${sessionId}.json`, JSON.stringify({ mode }))
}

// Whether skill installs are automatic, and where that came from: the mode file wins over the environment.
function skillSetting(autoInstallSkills, env) {
  if (autoInstallSkills !== null) return { on: autoInstallSkills, from: MODE_FILE }
  return env[AUTO_INSTALL_ENV] === '1' ? { on: true, from: AUTO_INSTALL_ENV } : { on: false, from: null }
}

function modeSection(mode, skills, problem) {
  return [
    '## Mode',
    `- This project runs in ${modeName(mode)} mode (${mode === DEFAULT_MODE ? 'default' : `from ${MODE_FILE}`}).`,
    `- Automatic skill installs: ${skills.on ? 'on' : 'off'} (${skills.from === null ? 'default' : `from ${skills.from}`}).`,
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
    return { value: null, warning: `${label} failed: ${err?.code ?? detail}` }
  }
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
  const summary = attempt('summary lookup', () => latestSummary(root))
  const warnings = [setting.problem, ...stepWarnings, summary.warning].filter(warning => warning !== null)
  return { context: composeContext(setting, env, summary.value), warnings }
}

export function buildContext(cwd, home = homedir(), env = process.env, sessionId) {
  return startContext(cwd, home, env, sessionId).context
}

async function main() {
  const input = await readStdinJson()
  if (typeof input?.cwd !== 'string') return
  const { context, warnings } = startContext(input.cwd, homedir(), process.env, input.session_id ?? null)
  const output = { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }
  process.stdout.write(JSON.stringify(warnings.length === 0 ? output : { systemMessage: `${MESSAGE_PREFIX}: ${warnings.join('; ')}`, ...output }))
}

if (isMainModule(import.meta.url)) {
  main().catch(err => process.stderr.write(`${MESSAGE_PREFIX}: ${err.message}\n`))
}
