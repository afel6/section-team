// The modes a team can run in, cheapest first.
export const MODES = Object.freeze(['lean', 'balanced', 'max'])

// The mode used when no mode file says otherwise.
export const DEFAULT_MODE = 'balanced'

// The review gate settings for each mode, keyed in MODES order.
export const GATES = Object.freeze({
  lean: Object.freeze({ passOverall: 8, minItem: null, fixRounds: 1, reviewerModel: 'sonnet', nearMiss: false }),
  balanced: Object.freeze({ passOverall: 8, minItem: 6, fixRounds: 2, reviewerModel: null, nearMiss: false }),
  max: Object.freeze({ passOverall: 9, minItem: 7, fixRounds: 3, reviewerModel: null, nearMiss: true }),
})

// The picker label for each mode.
export const MODE_LABELS = Object.freeze({
  lean: 'Lean · ~1.3× usage (target)',
  balanced: 'Balanced · ~2.2× usage (measured 2026-10)',
  max: 'Max · ~3–4× usage (target)',
})

// Where a project keeps its mode, relative to the project root.
export const MODE_FILE = '.team/mode.json'
export const NOT_FOLDER = '.team is not a folder'
const codeOf = err => err?.code ?? 'unknown error'

// Node's fs, loaded on first use: the board UI imports this module where Node APIs do not exist and never calls readMode or writeMode.
const nodeFs = () => process.getBuiltinModule('node:fs')

// The problem line goes into the session brief, so only a short plain word from the file is shown.
const shown = value => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(value) ? `"${value}"` : '(not shown)')

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)

// Windows editors may start a file with a byte order mark, which JSON.parse rejects.
const withoutBom = text => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

// No mode file: the default mode, nothing to report.
const noFile = () => ({ mode: DEFAULT_MODE, autoInstallSkills: null, problem: null, modeUsable: true })

// The clause after an unusable mode's reason. A caller that keeps another mode (a session mid-way) passes its own.
const BALANCED_ENDING = 'so Balanced is used'

// The file's mode cannot be used, so Balanced stands in until the file is fixed.
export const balancedBecause = (reason, ending = BALANCED_ENDING) => ({
  mode: DEFAULT_MODE,
  autoInstallSkills: null,
  problem: `${MODE_FILE}: ${reason}, ${ending}`,
  modeUsable: false,
})

function modeOf(data, ending) {
  if (data.mode === undefined) return { mode: DEFAULT_MODE, fault: null }
  if (MODES.includes(data.mode)) return { mode: data.mode, fault: null }
  return { mode: DEFAULT_MODE, fault: `unknown mode ${shown(data.mode)}, ${ending}` }
}

function skillsOf(data) {
  const value = data.autoInstallSkills
  if (value === undefined) return { autoInstallSkills: null, fault: null }
  if (typeof value === 'boolean') return { autoInstallSkills: value, fault: null }
  return { autoInstallSkills: null, fault: 'autoInstallSkills must be true or false, so it is ignored' }
}

// The mode, the skill setting, one problem line (or null) and modeUsable from the text of a mode file (null when there is no file).
// modeUsable is false when the file's mode could not be used (bad JSON, not an object, an unknown mode), so Balanced is a stand-in;
// a bad autoInstallSkills alone leaves it true. ending replaces "so Balanced is used" after an unusable mode's reason.
// Never throws for any file text; a value that is not a string or null throws a TypeError.
export function parseModeFile(text, ending = BALANCED_ENDING) {
  if (text === null) return noFile()
  if (typeof text !== 'string') throw new TypeError('parseModeFile takes the file text or null')
  const json = withoutBom(text)
  let data
  try {
    data = JSON.parse(json)
  } catch {
    return balancedBecause('not valid JSON', ending)
  }
  if (!isPlainObject(data)) return balancedBecause('not a JSON object', ending)
  const { mode, fault: modeFault } = modeOf(data, ending)
  const { autoInstallSkills, fault: skillsFault } = skillsOf(data)
  const faults = [modeFault, skillsFault].filter(fault => fault !== null)
  const problem = faults.length === 0 ? null : `${MODE_FILE}: ${faults.join('; ')}`
  return { mode, autoInstallSkills, problem, modeUsable: modeFault === null }
}

// Throws one plain line unless mode is one of MODES.
export function assertMode(mode) {
  if (!MODES.includes(mode)) throw new Error(`unknown mode ${shown(mode)}: pick lean, balanced or max`)
}

// The display name of a mode: 'max' → 'Max'. Throws on an unknown mode.
export function modeName(mode) {
  assertMode(mode)
  return mode[0].toUpperCase() + mode.slice(1)
}

// The text to save for a mode: compact JSON that keeps a valid autoInstallSkills from the previous text. Throws on an unknown mode.
export function serializeMode(previousText, mode) {
  assertMode(mode)
  const { autoInstallSkills } = parseModeFile(previousText)
  return JSON.stringify(autoInstallSkills === null ? { mode } : { mode, autoInstallSkills })
}

const teamDir = root => `${root}/.team`
const modeFile = root => `${teamDir(root)}/mode.json`

// Whether .team exists as something other than a folder (Windows reports a path under a file as ENOENT, so the error code cannot tell).
const teamIsNotFolder = root => {
  const info = nodeFs().statSync(teamDir(root), { throwIfNoEntry: false })
  return info !== undefined && !info.isDirectory()
}

export const readReason = err => (err?.code === 'ENOTDIR' ? NOT_FOLDER : `could not be read (${codeOf(err)})`)

function whenFileMissing(root, ending) {
  try {
    return teamIsNotFolder(root) ? balancedBecause(NOT_FOLDER, ending) : noFile()
  } catch (err) {
    return balancedBecause(readReason(err), ending)
  }
}

// parseModeFile's answer for a project root (ending as there); an unreadable file or a .team that is not a folder also gives modeUsable false.
// Never throws and never creates anything.
export function readMode(root, ending = BALANCED_ENDING) {
  let text
  try {
    text = nodeFs().readFileSync(modeFile(root), 'utf8')
  } catch (err) {
    return err?.code === 'ENOENT' ? whenFileMissing(root, ending) : balancedBecause(readReason(err), ending)
  }
  return parseModeFile(text, ending)
}

const saveError = (reason, cause) => new Error(`could not save ${MODE_FILE}: ${reason}`, cause === undefined ? undefined : { cause })

function assertTeamFolder(root) {
  let blocked
  try {
    blocked = teamIsNotFolder(root)
  } catch (err) {
    throw saveError(codeOf(err), err)
  }
  if (blocked) throw saveError(NOT_FOLDER)
}

function readPreviousText(file) {
  try {
    return nodeFs().readFileSync(file, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT') return null
    throw saveError(codeOf(err), err)
  }
}

function replaceFile(dir, file, text) {
  const fs = nodeFs()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, text, { encoding: 'utf8', flag: 'wx' })
    fs.renameSync(tmp, file)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // The save error is the one reported; a left-over .tmp file is harmless.
    }
    throw saveError(codeOf(err), err)
  }
}

// Saves the mode to .team/mode.json (keeping the skill setting) through a temp file in the same folder. Throws one plain line on failure; undefined on success.
export function writeMode(root, mode) {
  assertMode(mode)
  assertTeamFolder(root)
  const file = modeFile(root)
  replaceFile(teamDir(root), file, serializeMode(readPreviousText(file), mode))
}
