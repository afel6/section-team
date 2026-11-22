// Run hygiene shared by run.mjs, preflight.mjs and judge.mjs (spec: docs/specs/2026-11-01-mode-round-design.md):
// the round's pinned model and effort, the child environment, the clean --settings, reading claude's output, and the
// init and transcript checks that void a run whose setup differs from the one the preflight pinned.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAbsolutePath, isUnder, samePath } from './os-paths.mjs'

export { isUnder } from './os-paths.mjs'

export const PLUGIN_KEY = 'section-team@inline'
export const BENCH_MODEL = 'claude-opus-5-5'
export const BENCH_EFFORT = 'medium'
// The CLI version the round runs (spec: Pinned CLI): every preflight pins this version's binary, whatever is on PATH.
export const ROUND_CLI_VERSION = '2.1.318'
export const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const HARNESS_CHECKOUT = dirname(dirname(fileURLToPath(import.meta.url)))
// On Linux (the cloud machine) the user's checkout is the one running the harness: its plugin files are not the pinned
// worktree's. live is the user's own checkout (liveCheckoutOf), when there is one.
export const liveCheckouts = (platform = process.platform, live = null) => [...(live ? [live] : []), ...(platform === 'win32' ? [] : [HARNESS_CHECKOUT])]
const PLUGIN_AUTHORING = 'cc-plugin-plugin-authoring@builtin'
const SETUPS = ['solo', 'lean', 'team', 'max', 'base', 'judge']
// base: the round's control arm, an older section-team loaded from its own worktree, held to the same rules.
const BUILDERS = ['lean', 'team', 'max', 'base']
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

// The user's own checkout, from which no round run may load anything: SECTION_TEAM_LIVE_CHECKOUT, an absolute path. The
// repo names no default (it is the user's folder): required on Windows, optional on Linux, where liveCheckouts adds this
// checkout anyway. Read in each entry point's main, never at import.
export function liveCheckoutOf(env = process.env, platform = process.platform) {
  const value = env.SECTION_TEAM_LIVE_CHECKOUT ?? ''
  if (value === '') {
    if (platform !== 'win32') return null
    throw new Error('set SECTION_TEAM_LIVE_CHECKOUT to the absolute path of your own section-team checkout: no round run may load anything from it')
  }
  if (!isAbsolutePath(value, platform)) throw new Error(`SECTION_TEAM_LIVE_CHECKOUT takes an absolute path, got "${value}"`)
  return value
}

// Before any paid run: a plugin worktree at or inside the live checkout would void every builder run (sectionTeamProblems).
export function checkLiveCheckout(live, worktrees) {
  if (live === null) return
  const inside = worktrees.find(dir => isUnder(dir, live))
  if (inside !== undefined) throw new Error(`${inside} is the live checkout ${live} (SECTION_TEAM_LIVE_CHECKOUT) or inside it: a round loads the plugin from a worktree outside it`)
}

// SECTION_TEAM_MEMORY_LIMIT_MB from the harness's own environment: the plugin's memory guard limit, in whole megabytes,
// given to every child after the strip (solo has no plugin to read it). null when unset; anything else stops the batch
// before a paid run, since the guard would only say so in a hook line.
export function memoryLimitOf(env = process.env) {
  const value = env.SECTION_TEAM_MEMORY_LIMIT_MB ?? ''
  if (value === '') return null
  if (!/^[1-9]\d*$/.test(value)) throw new RangeError(`SECTION_TEAM_MEMORY_LIMIT_MB takes a whole number of megabytes such as 12288, got "${value}"`)
  return value
}

// The version the plugin under test says it is, so one harness can measure 0.2.2 and 0.2.3. Read once per batch, at the
// boundary, before any paid run; one line naming the manifest when it is missing or invalid.
export function pluginVersionOf(pluginDir) {
  const path = join(pluginDir, '.claude-plugin', 'plugin.json')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`cannot read the plugin version from ${path} (${err.code ?? err.name})`, { cause: err })
  }
  if (typeof manifest?.version !== 'string' || !VERSION_PATTERN.test(manifest.version)) throw new Error(`cannot read the plugin version from ${path} (no version)`)
  // Before 0.2.0 sections had `memory: user`, and the harness no longer moves the user's notes out of their way.
  if (/^0\.[01]\./.test(manifest.version)) throw new Error(`section-team ${manifest.version} keeps section memory in ~/.claude/agent-memory, where a run would read and write your real notes: the harness runs 0.2.0 or later`)
  return manifest.version
}

// Only the tag of a pin from before --plugin-ref (the mode round's, which run.mjs and cloud-sync.mjs restore by it): every
// arm's expected version is its own worktree's manifest's (pluginVersionOf), and a round with two refs names both.
export const SECTION_TEAM_VERSION = '0.2.1'

// The round's switches, set both in the child environment and in --settings. They are added after the strip, so the
// parent's own values never reach the child. CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0: claude -p otherwise stops
// background subagents 10 minutes after the last turn (a probe on 2026-11-02 saw it cut off the testing section's
// final review); each builder run's time limit still bounds the run. CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1: claude
// otherwise reads the user's advisorModel from ~/.claude/settings.json, even mid-run (round tk got an advisor that way).
// SECTION_TEAM_MEMORY_LIMIT_MB: the round's memory-guard limit (memoryLimitOf), when it has one.
const roundEnv = (pluginDir, memoryLimitMb = null) => ({
  SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_PLUGIN_DIRS: pluginDir,
  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0', CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1',
  ...(memoryLimitMb === null ? {} : { SECTION_TEAM_MEMORY_LIMIT_MB: memoryLimitMb }),
})

// configDir: the round's clean profile, as CLAUDE_CONFIG_DIR in the environment only (it picks the folder settings are
// read from, so --settings cannot carry it). Both are set after the strip, so the parent's own values never reach the child.
export function childEnv(parent, { pluginDir, memoryLimitMb = null, configDir = null } = {}) {
  requirePluginDir(pluginDir, 'childEnv')
  const kept = Object.entries(parent).filter(([name]) => !STRIPPED.test(name))
  return { ...Object.fromEntries(kept), ...roundEnv(pluginDir, memoryLimitMb), ...(configDir === null ? {} : { CLAUDE_CONFIG_DIR: configDir }) }
}

// The names (never the values) that run.json records.
export const envNames = env => Object.keys(env).filter(name => RECORDED.test(name)).sort()

// A clean Linux home (the cloud machine) and a fresh profile (configDir, the round's CLAUDE_CONFIG_DIR) have never
// installed a plugin and have no installed_plugins.json: no keys there. On Windows a missing ~/.claude file still fails.
export function installedPluginKeys(home = homedir(), { platform = process.platform, configDir = null } = {}) {
  const path = join(configDir ?? join(home, '.claude'), 'plugins', 'installed_plugins.json')
  let plugins
  try {
    plugins = JSON.parse(readFileSync(path, 'utf8'))?.plugins
  } catch (err) {
    if (err.code === 'ENOENT' && (platform !== 'win32' || configDir !== null)) return []
    throw new Error(`cannot read installed plugins: ${path} (${err.code ?? err.name})`, { cause: err })
  }
  if (!isObject(plugins)) throw new Error(`cannot read installed plugins: ${path} (no plugins object)`)
  return Object.keys(plugins)
}

// --settings for one run: every installed and synced plugin off, section-team as the setup says.
export function cleanSettings({ installedKeys, sectionTeam, pluginDir, memoryLimitMb = null } = {}) {
  requirePluginDir(pluginDir, 'cleanSettings')
  if (!Array.isArray(installedKeys)) throw new TypeError('cleanSettings needs the installed plugin keys')
  if (typeof sectionTeam !== 'boolean') throw new TypeError('cleanSettings needs sectionTeam true or false')
  return {
    syncClaudeAiPlugins: false,
    syncClaudeAiSkills: false,
    enabledPlugins: { ...Object.fromEntries(installedKeys.map(key => [key, false])), [PLUGIN_AUTHORING]: false, [PLUGIN_KEY]: sectionTeam },
    env: roundEnv(pluginDir, memoryLimitMb),
  }
}

// A resume names the session it continues with --resume: --session-id would ask for a new session of that id.
export function commonArgs({ sessionId, resume = false } = {}) {
  if (typeof sessionId !== 'string' || sessionId === '') throw new TypeError('commonArgs needs a sessionId')
  return ['--model', BENCH_MODEL, '--effort', BENCH_EFFORT, '--verbose', '--strict-mcp-config', resume ? '--resume' : '--session-id', sessionId]
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

// Builders load exactly one section-team, from the plugin dir itself, at the version its manifest says.
function loadedOnceProblems(entries, { pluginDir, pluginVersion }) {
  if (entries.length !== 1) return [`expected 1 section-team plugin, found ${entries.length}`]
  const [{ path, version }] = entries
  return [
    ...(isAbsolutePath(path) && samePath(path, pluginDir) ? [] : [`section-team path ${path}, expected ${pluginDir}`]),
    ...(version === pluginVersion ? [] : [`section-team version ${version}, expected ${pluginVersion}`]),
  ]
}

// Any plugin entry under a live checkout fails, whatever its source (the stricter reading of the spec). The pin records
// the live checkouts its round named; a pin from before that has only the ones this process knows.
function sectionTeamProblems(plugins, setup, plugin, pin) {
  const entries = plugins.filter(p => p?.source === PLUGIN_KEY)
  const live = pin.liveCheckouts ?? liveCheckouts(process.platform, process.env.SECTION_TEAM_LIVE_CHECKOUT || null)
  const fromLive = live.flatMap(dir => {
    const live = plugins.filter(p => isUnder(p?.path, dir))
    return live.length > 0 ? [`loaded from the live checkout ${dir}: ${live.map(p => p.source).join(', ')}`] : []
  })
  if (BUILDERS.includes(setup)) return [...loadedOnceProblems(entries, plugin), ...fromLive]
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
export function initProblems(init, { setup, pin, pluginDir, pluginVersion } = {}) {
  if (!SETUPS.includes(setup)) throw new RangeError(`initProblems takes a setup of ${SETUPS.join(', ')}, got "${setup}"`)
  if (!isObject(pin)) throw new TypeError('initProblems needs a pin')
  if (BUILDERS.includes(setup)) {
    requirePluginDir(pluginDir, 'initProblems')
    if (typeof pluginVersion !== 'string' || pluginVersion === '') throw new TypeError('initProblems needs a pluginVersion')
  }
  if (!init) return ['no init message']
  const plugins = listOr(init.plugins, [])
  return [
    ...(Array.isArray(init.plugins) ? [] : ['the init has no plugins list']),
    ...sectionTeamProblems(plugins, setup, { pluginDir, pluginVersion }, pin),
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

// A tool definition of the advisor anywhere in a value: an object named advisor whose type is advisor_<version>.
const definesAdvisor = value => (Array.isArray(value)
  ? value.some(definesAdvisor)
  : isObject(value) && ((value.name === 'advisor' && /^advisor_/.test(String(value.type))) || Object.values(value).some(definesAdvisor)))

// The advisor in a run's transcripts: defined in a request (even deferred: the switch did not reach claude), offered to
// the model (an advisor_tool attachment that makes it available) or called (a server_tool_use block named advisor,
// counted once per id: a streamed message repeats its blocks).
export function advisorProblems(jsonlTexts) {
  if (!Array.isArray(jsonlTexts) || jsonlTexts.some(text => typeof text !== 'string')) {
    throw new TypeError('advisorProblems takes a list of transcript texts')
  }
  const lines = jsonlTexts.flatMap(jsonLines)
  // Only lines that name an advisor_ type are searched in depth: transcripts run to many megabytes.
  const defined = jsonlTexts.flatMap(text => text.split(/\r?\n/).filter(line => line.includes('"advisor_'))).map(parseOrUndefined).some(definesAdvisor)
  const offered = lines.map(m => m.attachment).filter(a => a?.type === 'advisor_tool' && a.available !== false).map(a => a.model ?? 'unknown model')
  // A call without an id is its own call.
  const calls = new Set(lines.filter(m => m.type === 'assistant').flatMap(m => listOr(m.message?.content, []))
    .filter(b => b?.type === 'server_tool_use' && b.name === 'advisor').map((b, i) => b.id ?? `no id ${i}`)).size
  return [
    ...(defined ? ['advisor tool defined'] : []),
    ...[...new Set(offered)].map(model => `advisor tool offered (${model})`),
    ...(calls > 0 ? [`advisor called ${calls} ${calls === 1 ? 'time' : 'times'}`] : []),
  ]
}

export function compacted(jsonlText) {
  if (typeof jsonlText !== 'string') throw new TypeError('compacted takes a transcript text')
  return jsonLines(jsonlText).some(m => m.type === 'system' && m.subtype === 'compact_boundary')
}

// What Claude Code reads as instructions from the folder a session starts in and every folder above it (ctx7 lookup of
// the Claude Code docs, 2026-11-23: "Parent directories ... root/CLAUDE.md ... pulled in automatically"; AGENTS.md is
// the plan's addition). .mcp.json is not listed: every run passes --strict-mcp-config.
const INSTRUCTION_FILES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', join('.claude', 'CLAUDE.md')]

// Every instruction file in dir and the folders above it, up to the drive root, nearest first.
export function instructionFilesAbove(dir) {
  const here = INSTRUCTION_FILES.map(name => join(dir, name)).filter(path => existsSync(path))
  const parent = dirname(dir)
  return parent === dir ? here : [...here, ...instructionFilesAbove(parent)]
}

// Before any paid run: the run folders' root is absolute and no instruction file sits above it, since every run, solo
// included, would read it. found lists them (tests pass a clean tree's).
export function checkRunsRoot(root, { found = instructionFilesAbove } = {}) {
  if (!isAbsolutePath(root)) throw new Error(`BENCH_RUNS takes an absolute path, got "${root}"`)
  const [first, ...rest] = found(resolve(root))
  if (first === undefined) return
  const more = rest.length > 0 ? ` (and ${rest.length} more)` : ''
  throw new Error(`${first} sits above the run folders${more}, and Claude Code reads it as instructions in every run: set BENCH_RUNS to a folder with no CLAUDE.md, CLAUDE.local.md or AGENTS.md above it`)
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

// Everything under the given folders of claudeDir (~/.claude, or the round's profile) as sorted claudeDir-relative paths,
// without the folder-relative paths skip names: the preflight's synced listing and the batch's user skills and agents.
export const claudeListing = (claudeDir, folders, skip = () => false) => folders
  .flatMap(folder => listUnder(join(claudeDir, folder)).filter(path => !skip(path)).map(path => `${folder}/${path}`)).sort()

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

// A batch runs on what its preflight pinned: the same profile, memory limit, run-folder root and setups (a subset of
// them). A pin from before these fields pinned no profile and no limit, and any root and setups.
export function checkRoundSettings({ conds, configDir, memoryLimitMb, runsRoot }, pin) {
  const profile = pin.configDir ?? null
  if (configDir === null ? profile !== null : profile === null || !samePath(configDir, profile)) {
    const fix = profile === null ? 'leave --config-dir out' : `pass --config-dir=${profile}`
    throw new Error(`--config-dir=${configDir ?? ''} is not the profile the round pinned (${profile ?? 'none'}): ${fix}`)
  }
  const limit = pin.memoryLimitMb ?? null
  if (memoryLimitMb !== limit) throw new Error(`SECTION_TEAM_MEMORY_LIMIT_MB is ${memoryLimitMb ?? 'unset'}, but the round pinned ${limit ?? 'none'}: set it as the preflight had it`)
  if (pin.runsRoot !== undefined && !samePath(runsRoot, pin.runsRoot)) {
    throw new Error(`the run folders' root is ${runsRoot}, but the round pinned ${pin.runsRoot}: set BENCH_RUNS as the preflight had it`)
  }
  const unpinned = Array.isArray(pin.conds) ? conds.filter(cond => !pin.conds.includes(cond)) : []
  if (unpinned.length > 0) throw new Error(`--conds names ${unpinned.join(', ')}, which the round's preflight did not run`)
}
