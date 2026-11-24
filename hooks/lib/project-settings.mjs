import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { projectRoot } from './paths.mjs'

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

// The variables os.homedir() reads: USERPROFILE on Windows (in any letter case; HOME, HOMEDRIVE and HOMEPATH are ignored there), HOME elsewhere.
const HOME_VARS = ['HOME', 'USERPROFILE']

// HOME or USERPROFILE when any of the folders' .claude settings set it, or null; throws as projectEnvSets does. No folder is skipped as
// home: settings that set one choose the home folder, so they could make the checkout the home that projectFoldersSet skips, and its
// committed .claude files pass for the user's own.
export function projectHomeVar(folders) {
  return HOME_VARS.find(name => folders.some(folder => projectEnvSets(folder, name))) ?? null
}

// Whether dir or a folder above it holds a .git: a folder, or the file a linked worktree or submodule has.
const gitAbove = dir => existsSync(join(dir, '.git')) || (dirname(dir) !== dir && gitAbove(dirname(dir)))

// git's location variables. A project's .claude settings env reaches the hook, and with one of these set git answers for another repo.
const GIT_LOCATION_VARS = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_CEILING_DIRECTORIES']

// A copy of the process env without them, in any letter case (Windows reads Git_Dir as GIT_DIR).
const gitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => !GIT_LOCATION_VARS.includes(key.toUpperCase())))

// The checkout's top folder (in a linked worktree, the worktree itself, which projectRoot never gives), or null with no repository
// here. Throws one line naming no path when a .git is there but git cannot answer (no git, a timeout, a .git it cannot read): the
// callers count that as set.
function topFolder(dir) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, env: gitEnv() }).trim() || null
  } catch {
    if (!gitAbove(resolve(dir))) return null // no repository, so no top folder to read settings from
    throw new Error("git could not name this checkout's top folder")
  }
}

// The folders Claude Code may read .claude settings from for a session in cwd: cwd itself, its checkout's top folder and the main
// checkout, each once. Throws as topFolder does.
export function settingsFolders(cwd) {
  const folders = [cwd, topFolder(cwd), projectRoot(cwd)].filter(folder => folder !== null).map(folder => resolve(folder))
  return folders.filter((folder, i) => folders.findIndex(other => sameFolder(folder, other)) === i)
}

// The variable for which the project's .claude settings around cwd veto, or null: HOME or USERPROFILE first (they decide which folder
// is home), then name in any of those folders but the home folder. Throws as settingsFolders and projectEnvSets do; a caller counts a
// throw as set.
export function settingsVeto(cwd, name, home) {
  const folders = settingsFolders(cwd)
  return projectHomeVar(folders) ?? (projectFoldersSet(folders, name, home) ? name : null)
}
