// Run hygiene shared by run.mjs, preflight.mjs and judge.mjs (spec: docs/specs/2026-11-01-mode-round-design.md):
// the round's pinned model and effort, the child environment, the clean --settings, reading claude's output, and the
// init and transcript checks that void a run whose setup differs from the one the preflight pinned.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAbsolutePath, isUnder, samePath } from './os-paths.mjs'

export { isUnder } from './os-paths.mjs'

export const PLUGIN_KEY = 'section-team@inline'
export const BENCH_MODEL = 'claude-opus-5-5'
export const BENCH_EFFORT = 'medium'
export const SECTION_TEAM_VERSION = '0.2.1'
// The user's own checkout: no round run may load anything from it.
export const LIVE_CHECKOUT = 'C:/Users/Asus/claude-team'
// On Linux (the cloud machine) the user's checkout is the one running the harness: its plugin files are not the pinned
// worktree's. The Windows path stays in the list, where nothing on Linux can be under it.
const HARNESS_CHECKOUT = dirname(dirname(fileURLToPath(import.meta.url)))
export const liveCheckouts = (platform = process.platform) => (platform === 'win32' ? [LIVE_CHECKOUT] : [LIVE_CHECKOUT, HARNESS_CHECKOUT])
const PLUGIN_AUTHORING = 'cc-plugin-plugin-authoring@builtin'
const SETUPS = ['solo', 'lean', 'team', 'max', 'judge']
const BUILDERS = ['lean', 'team', 'max']
// Session, model, key and switch variables from the parent: a round started inside a Claude Code session must behave
// like one started from a plain terminal. Case-insensitive, as variable names are on Windows. A shell inside the
// desktop app also sets OAuth, MCP, thinking and Bash timeout variables: they go too.
const HOST_SESSION = 'USE_(STAGING|LOCAL)_OAUTH$|MCP_|MAX_THINKING_TOKENS$|BASH_(DEFAULT|MAX)_TIMEOUT_MS$'
const STRIPPED = new RegExp(`^(CLAUDECODE$|CLAUDE_|ANTHROPIC_|DISABLE_|SECTION_TEAM_|${HOST_SESSION})`, 'i')
const RECORDED = new RegExp(`^(CLAUDE|ANTHROPIC|DISABLE_|SECTION_TEAM_|ENABLE_CLAUDEAI|${HOST_SESSION})`, 'i')

const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
const listOr = (value, fallback) => (Array.isArray(value) ? value : fallback)

function requirePluginDir(pluginDir, caller) {
  if (typeof pluginDir !== 'string' || pluginDir === '') throw new TypeError(`${caller} needs a pluginDir`)
}

// The round's switches, set both in the child environment and in --settings. They are added after the strip, so the
// parent's own values never reach the child. CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0: claude -p otherwise stops
// background subagents 10 minutes after the last turn (a probe on 2026-11-02 saw it cut off the testing section's
// final review); each builder run's time limit still bounds the run.
const roundEnv = pluginDir => ({
  SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_PLUGIN_DIRS: pluginDir,
  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
})

export function childEnv(parent, { pluginDir } = {}) {
  requirePluginDir(pluginDir, 'childEnv')
  const kept = Object.entries(parent).filter(([name]) => !STRIPPED.test(name))
  return { ...Object.fromEntries(kept), ...roundEnv(pluginDir) }
}

// The names (never the values) that run.json records.
export const envNames = env => Object.keys(env).filter(name => RECORDED.test(name)).sort()

// A clean Linux home (the cloud machine) has never installed a plugin and has no installed_plugins.json: no keys there.
// On Windows a missing file still fails, as before.
export function installedPluginKeys(home = homedir(), { platform = process.platform } = {}) {
  const path = join(home, '.claude', 'plugins', 'installed_plugins.json')
  let plugins
  try {
    plugins = JSON.parse(readFileSync(path, 'utf8'))?.plugins
  } catch (err) {
    if (err.code === 'ENOENT' && platform !== 'win32') return []
    throw new Error(`cannot read installed plugins: ${path} (${err.code ?? err.name})`, { cause: err })
  }
  if (!isObject(plugins)) throw new Error(`cannot read installed plugins: ${path} (no plugins object)`)
  return Object.keys(plugins)
}

// --settings for one run: every installed and synced plugin off, section-team as the setup says.
export function cleanSettings({ installedKeys, sectionTeam, pluginDir } = {}) {
  requirePluginDir(pluginDir, 'cleanSettings')
  if (!Array.isArray(installedKeys)) throw new TypeError('cleanSettings needs the installed plugin keys')
  if (typeof sectionTeam !== 'boolean') throw new TypeError('cleanSettings needs sectionTeam true or false')
  return {
    syncClaudeAiPlugins: false,
    syncClaudeAiSkills: false,
    enabledPlugins: { ...Object.fromEntries(installedKeys.map(key => [key, false])), [PLUGIN_AUTHORING]: false, [PLUGIN_KEY]: sectionTeam },
    env: roundEnv(pluginDir),
  }
}

export function commonArgs({ sessionId } = {}) {
  if (typeof sessionId !== 'string' || sessionId === '') throw new TypeError('commonArgs needs a sessionId')
  return ['--model', BENCH_MODEL, '--effort', BENCH_EFFORT, '--verbose', '--strict-mcp-config', '--session-id', sessionId]
}

// undefined when the text is not JSON: callers expect cut-off and non-JSON lines and skip them.
function parseOrUndefined(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// The JSON objects among a text's lines, in order; a line cut off by a kill does not parse and is left out.
const jsonLines = text => String(text).split(/\r?\n/).map(parseOrUndefined).filter(isObject)

// Messages from `--output-format json` (one array, or one object) or `stream-json` (one object per line).
export function outputMessages(stdout) {
  const whole = parseOrUndefined(stdout)
  if (Array.isArray(whole)) return whole
  if (isObject(whole)) return [whole]
  return jsonLines(stdout)
}

export const initOf = messages => messages.find(m => m?.type === 'system' && m.subtype === 'init') ?? null
export const resultOf = messages => messages.findLast(m => m?.type === 'result') ?? null

// One line when two lists differ as sets, naming what is extra and what is missing.
function setProblems(label, actual, expected) {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  const extra = [...actualSet].filter(item => !expectedSet.has(item))
  const missing = [...expectedSet].filter(item => !actualSet.has(item))
  if (extra.length === 0 && missing.length === 0) return []
  return [`${label} differ from the pin (extra: ${extra.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'})`]
}

// Builders load exactly one section-team, from the plugin dir itself, at the round's version.
function loadedOnceProblems(entries, pluginDir) {
  if (entries.length !== 1) return [`expected 1 section-team plugin, found ${entries.length}`]
  const [{ path, version }] = entries
  return [
    ...(isAbsolutePath(path) && samePath(path, pluginDir) ? [] : [`section-team path ${path}, expected ${pluginDir}`]),
    ...(version === SECTION_TEAM_VERSION ? [] : [`section-team version ${version}, expected ${SECTION_TEAM_VERSION}`]),
  ]
}

// Any plugin entry under a live checkout fails, whatever its source (the stricter reading of the spec).
function sectionTeamProblems(plugins, setup, pluginDir) {
  const entries = plugins.filter(p => p?.source === PLUGIN_KEY)
  const fromLive = liveCheckouts().flatMap(dir => {
    const live = plugins.filter(p => isUnder(p?.path, dir))
    return live.length > 0 ? [`loaded from the live checkout ${dir}: ${live.map(p => p.source).join(', ')}`] : []
  })
  if (BUILDERS.includes(setup)) return [...loadedOnceProblems(entries, pluginDir), ...fromLive]
  return [...(entries.length > 0 ? [`section-team loaded in ${setup}`] : []), ...fromLive]
}

// Without the pin's built-ins (the preflight), every other plugin must be a built-in other than plugin-authoring.
function otherPluginProblems(plugins, pin) {
  const sources = plugins.map(p => p?.source).filter(source => source !== PLUGIN_KEY)
  if (pin.builtins !== undefined) return setProblems('plugins', sources, pin.builtins)
  const stray = sources.filter(source => !String(source).endsWith('@builtin'))
  return [
    ...(stray.length > 0 ? [`plugins that are not built-ins: ${stray.join(', ')}`] : []),
    ...(sources.includes(PLUGIN_AUTHORING) ? [`${PLUGIN_AUTHORING} is loaded`] : []),
  ]
}

function mcpProblems(servers) {
  if (!Array.isArray(servers)) return ['the init has no mcp_servers list']
  return servers.length > 0 ? [`MCP servers loaded: ${servers.map(s => s?.name).join(', ')}`] : []
}

// Judges run with section-team off, so they are held to solo's lists.
function listProblems(init, setup, pin) {
  if (pin.setups === undefined) return []
  const key = setup === 'judge' ? 'solo' : setup
  const lists = pin.setups[key]
  if (!isObject(lists)) return [`the pin has no ${key} setup`]
  return ['agents', 'skills'].flatMap(name => setProblems(name, listOr(init[name], []), listOr(lists[name], [])))
}

function versionProblems(init, pin) {
  const pinned = [['model', BENCH_MODEL], ['claude_code_version', pin.version], ['apiKeySource', pin.apiKeySource]]
  return pinned.filter(([key, want]) => want !== undefined && init[key] !== want).map(([key, want]) => `${key} ${init[key]}, expected ${want}`)
}

// One line per failed rule; empty when the init matches the setup and the pin.
export function initProblems(init, { setup, pin, pluginDir } = {}) {
  if (!SETUPS.includes(setup)) throw new RangeError(`initProblems takes a setup of ${SETUPS.join(', ')}, got "${setup}"`)
  if (!isObject(pin)) throw new TypeError('initProblems needs a pin')
  if (BUILDERS.includes(setup)) requirePluginDir(pluginDir, 'initProblems')
  if (!init) return ['no init message']
  const plugins = listOr(init.plugins, [])
  return [
    ...(Array.isArray(init.plugins) ? [] : ['the init has no plugins list']),
    ...sectionTeamProblems(plugins, setup, pluginDir),
    ...otherPluginProblems(plugins, pin),
    ...mcpProblems(init.mcp_servers),
    ...listProblems(init, setup, pin),
    ...versionProblems(init, pin),
  ]
}

// One line per effort other than the round's on an assistant line. Lines that record no effort (synthetic messages)
// are skipped, but when no non-synthetic assistant line records one, the check could not run: 'no effort recorded'.
export function effortProblems(jsonlTexts, effort = BENCH_EFFORT) {
  if (!Array.isArray(jsonlTexts) || jsonlTexts.some(text => typeof text !== 'string')) {
    throw new TypeError('effortProblems takes a list of transcript texts')
  }
  const assistant = jsonlTexts.flatMap(jsonLines).filter(m => m.type === 'assistant')
  const real = assistant.filter(m => m.message?.model !== '<synthetic>')
  if (real.length > 0 && !real.some(m => 'effort' in m)) return ['no effort recorded']
  const others = assistant.filter(m => 'effort' in m && m.effort !== effort).map(m => m.effort)
  return [...new Set(others)].map(other => `assistant effort ${other}, expected ${effort}`)
}

export function compacted(jsonlText) {
  if (typeof jsonlText !== 'string') throw new TypeError('compacted takes a transcript text')
  return jsonLines(jsonlText).some(m => m.type === 'system' && m.subtype === 'compact_boundary')
}

// A file's SHA-256 in hex; one line naming the file when it cannot be read.
export function sha256Of(file) {
  let bytes
  try {
    bytes = readFileSync(file)
  } catch (err) {
    throw new Error(`cannot read ${file} (${err.code ?? err.name})`, { cause: err })
  }
  return createHash('sha256').update(bytes).digest('hex')
}

// Every path under dir, relative, with forward slashes; [] when dir does not exist.
function listUnder(dir) {
  try {
    return readdirSync(dir, { recursive: true }).map(path => path.replaceAll('\\', '/'))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

// Everything under the given ~/.claude folders as sorted ~/.claude-relative paths, without the folder-relative paths
// skip names: the preflight's synced listing and the batch's user skills and agents.
export const claudeListing = (home, folders, skip = () => false) => folders
  .flatMap(folder => listUnder(join(home, '.claude', folder)).filter(path => !skip(path)).map(path => `${folder}/${path}`)).sort()

export function readPin(results, round) {
  const path = join(results, `preflight-${round}.json`)
  let pin
  try {
    pin = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    const message = err.code === 'ENOENT' ? `missing ${path}: run node bench/preflight.mjs --round=${round} first` : `cannot read ${path} (${err.code ?? err.name})`
    throw new Error(message, { cause: err })
  }
  if (!isObject(pin)) throw new Error(`cannot read ${path} (no pin object)`)
  // run.mjs starts pin.binary (judge.mjs is to follow): a pin without one could only fail after a run folder was wiped.
  if (typeof pin.binary !== 'string' || pin.binary === '') throw new Error(`the round ${round} pin names no binary: run node bench/preflight.mjs --round=${round} again`)
  return pin
}
