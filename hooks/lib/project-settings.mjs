import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The settings files Claude Code reads from a project folder. A cloned repo can commit either one, and Claude Code hands their env to the
// hooks and to every command, so a value there cannot be told apart from one the user set in ~/.claude/settings.json.
const SETTINGS_FILES = ['settings.json', 'settings.local.json']

// Windows editors may start a file with a byte order mark, which JSON.parse rejects.
const withoutBom = text => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

// A settings file's text, or null when there is none (a .claude that is a file reads as ENOTDIR, or ENOENT on Windows); another read error throws.
function settingsText(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch (err) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return null
    throw err
  }
}

// Whether a settings file's text sets env[name] as an own key, to any value. Letter case is folded on every platform: Windows reads
// Section_Team_X as SECTION_TEAM_X, and elsewhere folding can only add refusals.
function textSets(text, name) {
  const upper = name.toUpperCase()
  let data
  try {
    data = JSON.parse(withoutBom(text))
  } catch {
    // ponytail: text that is not JSON counts when it names the variable at all; the hook cannot tell how Claude Code read it, so it refuses
    // rather than guesses. Parse JSON with comments here if Claude Code is found to accept them.
    return text.toUpperCase().includes(upper)
  }
  const env = data?.env
  return typeof env === 'object' && env !== null && !Array.isArray(env) && Object.keys(env).some(key => key.toUpperCase() === upper)
}

// True when <root>/.claude/settings.json or <root>/.claude/settings.local.json sets env[name]. Throws on a read error other than a missing file.
export function projectEnvSets(root, name) {
  return SETTINGS_FILES.some(file => {
    const text = settingsText(join(root, '.claude', file))
    return text !== null && textSets(text, name)
  })
}

// Whether two paths name one folder; Windows paths differ in letter case only.
const sameFolder = (a, b) => {
  const [x, y] = [resolve(a), resolve(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

// projectEnvSets for each project folder Claude Code may read settings from (the session's folder and the project root), skipping the
// home folder: its .claude/settings.json is the user's own ~/.claude/settings.json, which is where the variable belongs.
export function projectFoldersSet(folders, name, home) {
  return folders.filter(folder => !sameFolder(folder, home)).some(folder => projectEnvSets(folder, name))
}
