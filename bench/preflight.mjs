// Paid preflight before a round (about $1, needs the user's yes). It pins the CLI: `claude --version` (the binary on
// PATH) names the version, and ~/.local/share/claude/versions/<v> is copied to ~/bench-runs/claude-<v>.exe. Where that
// versions folder is missing off Windows (the cloud machine's npm install), the npm package's binary under `npm root -g`
// is pinned in place, at the round's version, with its SHA-256 and its npm package, so a fresh machine can install it
// again. `claude` on PATH is never used there: the cloud environment relinks it to its own CLI at every session
// start. Then one
// run per setup (solo, lean, team, max), each in a run folder from prepareRun, on that copy with exactly the builders'
// arguments and environment, proves from its init, its mode record and its answer that a run starts clean and in its
// mode. Only a preflight without problems writes the round's pin, results/preflight-<round>.json.
// Spec: docs/specs/2026-11-01-mode-round-design.md (Pinned CLI, Preflight).
// Usage: node bench/preflight.mjs --round=mo --plugin=<absolute path of the worktree at the ref> [--plugin-ref=<git ref>] [--sync=<branch> --redact-email | --no-sync]
//        (--plugin-ref defaults to v<SECTION_TEAM_VERSION>; the pin records it and its commit, and run.mjs holds a batch to them.)
//        (--sync pushes the pin to the results branch at once; required off Windows, as for run.mjs. The cloud round
//        passes --redact-email to every run, push and preflight command; the scan stays on.)
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { readRecord } from '../hooks/lib/mode-record.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { ROUND_CLI_VERSION, VERSION_PATTERN, claudeListing, initOf, initProblems, installedPluginKeys, outputMessages, pluginVersionOf, resultOf, sha256Of } from './clean-run.mjs'
import { REAL_SYNC, publishItems, syncReady } from './cloud-sync.mjs'
import {
  DEFAULT_PLUGIN_REF, NAME, RESULTS, ROUND_CONDS as SETUPS, RUNS, builderArgs, builderEnv, checkPluginWorktree, parseArgs, pluginCommitOf, prepareRun, runFolder, syncBranchOf,
} from './run.mjs'
import { required } from './section-memory.mjs'

// The mode record each setup's session leaves; solo runs with section-team off, so it leaves none.
const RECORD = { solo: null, lean: 'lean', team: 'balanced', max: 'max' }
const PROMPT = "Reply with exactly one word: YES if your context contains the text 'Automatic skill installs are on', otherwise NO."
const RUN_TIMEOUT_MS = 300_000
const VERSION_TIMEOUT_MS = 60_000
// A verbose stream-json init lists every agent and skill: far more than spawnSync's 1 MB default.
const MAX_BUFFER = 64 * 1024 * 1024
const SYNCED = ['plugins/synced', 'skills/synced']

const firstLine = text => String(text ?? '').split(/\r?\n/)[0].trim()
const runVersion = (run, command) => run(command, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: VERSION_TIMEOUT_MS })
const NPM_PACKAGE = '@anthropic-ai/claude-code'

// The pinned binary must start and print its own version.
function checkVersion(run, binary, version) {
  const r = runVersion(run, binary)
  if (r.error) throw new Error(`could not run ${binary} (${r.error.code ?? r.error.message})`)
  if (r.status !== 0 || !String(r.stdout).startsWith(`${version} `)) {
    throw new Error(`${binary} --version printed "${firstLine(r.stdout)}" (exit ${r.status}), expected ${version}`)
  }
}

// The x.y.z at the start of `claude --version`, which prints "2.1.296 (Claude Code)".
export function versionOf(stdout) {
  const match = /^(\d+\.\d+\.\d+)/.exec(String(stdout))
  if (!match) throw new Error(`claude --version printed "${firstLine(stdout)}", expected a version like 2.1.296`)
  return match[1]
}

// Copies the version's executable to the path every round run starts. A copy from an earlier preflight is kept, never
// overwritten (a run may still hold it open), so it must match the source byte for byte like a fresh one.
export function copyBinary({ home, version, run = spawnSync }) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) throw new RangeError(`copyBinary takes a version like 2.1.296, got "${version}"`)
  const source = join(home, '.local', 'share', 'claude', 'versions', version)
  const binary = join(home, 'bench-runs', `claude-${version}.exe`)
  const expected = sha256Of(source)
  if (!existsSync(binary)) {
    mkdirSync(dirname(binary), { recursive: true })
    copyFileSync(source, binary)
  }
  const sha256 = sha256Of(binary)
  if (sha256 !== expected) throw new Error(`${binary} differs from ${source}: delete it and run the preflight again`)
  checkVersion(run, binary, version)
  return { binary, sha256 }
}

// The npm package's binary (npm i -g @anthropic-ai/claude-code@<v> puts it there), links resolved. Never `claude` on PATH.
export function npmClaude({ run = spawnSync } = {}) {
  const r = run('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true, timeout: VERSION_TIMEOUT_MS })
  if (r.error || r.status !== 0) throw new Error(`npm root -g failed (${r.error?.code ?? `exit ${r.status}`}): is npm installed?`)
  const binary = join(String(r.stdout).trim(), '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  if (!existsSync(binary)) throw new Error(`no npm-installed CLI at ${binary}: run npm i -g ${NPM_PACKAGE}@${ROUND_CLI_VERSION}`)
  return realpathSync(binary)
}

// Pins the installed CLI where it is: no copy, since npm owns that path and the same package version installs the
// same bytes there on a fresh machine (cloud-sync.mjs restore checks the hash after installing it).
export function pinInstalled({ version, run = spawnSync, which = npmClaude }) {
  if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) throw new RangeError(`pinInstalled takes a version like 2.1.296, got "${version}"`)
  const binary = which({ run })
  const sha256 = sha256Of(binary)
  checkVersion(run, binary, version)
  return { binary, sha256, npmPackage: `${NPM_PACKAGE}@${version}` }
}

// What claude.ai has synced into ~/.claude, as sorted paths relative to it; a run must leave it unchanged.
export const syncedListing = home => claudeListing(home, SYNCED)

function answerProblems(result) {
  if (!result) return ['no result message']
  if (result.is_error) return [`claude ended on an error: ${firstLine(result.result)}`]
  const answer = String(result.result)
  if (/\bNO\b/i.test(answer) && !/\bYES\b/i.test(answer)) return []
  return [`the answer about automatic skill installs is "${firstLine(answer)}", expected NO`]
}

// The pin records these, but initProblems needs them only once a pin exists: a missing one is a problem here.
function recordedProblems(init) {
  if (!init) return []
  return [
    ...['agents', 'skills'].filter(name => !Array.isArray(init[name])).map(name => `the init has no ${name} list`),
    ...(typeof init.apiKeySource === 'string' ? [] : ['the init has no apiKeySource']),
  ]
}

// One line per failed check of one setup's run, each starting with the setup; empty when it passes.
export function preflightProblems({ setup, messages, record, pluginDir, version, pluginVersion }) {
  if (!SETUPS.includes(setup)) throw new RangeError(`preflightProblems takes a setup of ${SETUPS.join(', ')}, got "${setup}"`)
  const init = initOf(messages)
  const expected = RECORD[setup]
  return [
    ...initProblems(init, { setup, pin: { version }, pluginDir, pluginVersion }),
    ...recordedProblems(init),
    ...(record === expected ? [] : [`mode record ${record ?? 'none'}, expected ${expected ?? 'none'}`]),
    ...answerProblems(resultOf(messages)),
  ].map(line => `${setup}: ${line}`)
}

const sourcesOf = init => (Array.isArray(init.plugins) ? init.plugins : []).map(p => p?.source)
const builtinsOf = init => sourcesOf(init).filter(source => String(source).endsWith('@builtin')).sort()

// One line when the setups disagree on a value the pin holds once for the whole round.
function differProblems(label, values) {
  if (new Set(values.map(([, value]) => JSON.stringify(value))).size <= 1) return []
  return [`the ${label} between setups: ${values.map(([setup, value]) => `${setup} ${[value].flat().join(', ') || 'none'}`).join('; ')}`]
}

// The round's pin from each setup's init (null when a setup has none; its own check reports that), and the lines
// that keep it from being written.
export function pinFor({ version, binary, sha256, npmPackage, pluginDir, pluginRef, pluginCommit, inits }) {
  const present = SETUPS.filter(setup => inits[setup]).map(setup => [setup, inits[setup]])
  const builtins = present.map(([setup, init]) => [setup, builtinsOf(init)])
  const keySources = present.map(([setup, init]) => [setup, init.apiKeySource])
  const problems = [...differProblems('built-in plugins differ', builtins), ...differProblems('apiKeySource differs', keySources)]
  const setups = Object.fromEntries(present.map(([setup, init]) => [setup, { plugins: sourcesOf(init), agents: init.agents, skills: init.skills }]))
  const installed = npmPackage === undefined ? {} : { npmPackage }
  return { problems, pin: { version, binary, sha256, ...installed, apiKeySource: keySources[0]?.[1], builtins: builtins[0]?.[1] ?? [], pluginDir, pluginRef, pluginCommit, setups } }
}

// The session's mode record; an unreadable one still yields a line that names its setup.
function recordOf(home, sessionId) {
  try {
    return readRecord(home, sessionId)
  } catch (err) {
    return `unreadable (${err.message})`
  }
}

function exitProblems(setup, r) {
  if (r.status === 0) return []
  const exit = r.status === null ? `was stopped by ${r.signal}` : `exited ${r.status}`
  return [`${setup}: claude ${exit}: ${firstLine(r.stderr) || '(no stderr)'}`]
}

// One setup's run on the pinned copy in a fresh run folder: its problems, and its init (null without one).
function checkSetup(setup, { home, binary, version, pluginDir, pluginVersion, installedKeys }, { spawn, folder, root }) {
  const run = { id: `pf-${setup}`, task: 'pf', base: setup, cond: setup }
  const dir = prepareRun(run, { dir: folder(run), root })
  const sessionId = randomUUID()
  const before = syncedListing(home)
  const args = builderArgs(setup, PROMPT, { sessionId, installedKeys, pluginDir })
  const env = builderEnv(process.env, { pluginDir })
  const r = spawn(binary, args, { cwd: dir, env, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER, stdio: ['ignore', 'pipe', 'pipe'] })
  const synced = JSON.stringify(syncedListing(home)) === JSON.stringify(before) ? [] : [`${setup}: the synced plugins or skills changed during the run`]
  if (r.error) return { problems: [`${setup}: could not run claude (${r.error.code ?? r.error.message})`, ...synced], init: null }
  const messages = outputMessages(r.stdout)
  const checks = preflightProblems({ setup, messages, record: recordOf(home, sessionId), pluginDir, version, pluginVersion })
  return { problems: [...exitProblems(setup, r), ...checks, ...synced], init: initOf(messages) }
}

function versionOnPath(run) {
  const r = runVersion(run, 'claude')
  if (r.error) throw new Error(`could not run claude --version (${r.error.code ?? r.error.message})`)
  return versionOf(r.stdout)
}

// The whole preflight; deps replace git, the --version runs, the paid spawns and the run folders in tests.
// Returns every problem; the pin file is written only when there are none.
export function preflight({ round, plugin, pluginRef = '', home, results } = {}, deps = {}) {
  const { git, run = spawnSync, spawn = spawnSync, folder, root, which = npmClaude, platform = process.platform, readVersion = pluginVersionOf } = deps
  required({ home, results, folder, root })
  if (typeof round !== 'string' || !NAME.test(round)) throw new RangeError('--round= names the round in letters and digits, e.g. --round=mo')
  // Every run's init is checked against the pin, so a round's pin never changes: not here, and not at the write ('wx').
  const file = join(results, `preflight-${round}.json`)
  if (existsSync(file)) throw new Error(`${file} exists: round ${round} is already pinned; delete it only if no run of the round has started`)
  // No paid call with a plugin path the batches would refuse.
  const ref = pluginRef || DEFAULT_PLUGIN_REF
  const pluginCommit = pluginCommitOf(plugin, { ref, git })
  checkPluginWorktree(plugin, { ref, git })
  const pluginVersion = readVersion(plugin)
  const inPlace = platform !== 'win32' && !existsSync(join(home, '.local', 'share', 'claude', 'versions'))
  // In place, the round's version is fixed: PATH's claude may be another CLI. Windows reads it from PATH, as before.
  const version = inPlace ? ROUND_CLI_VERSION : versionOnPath(run)
  const { binary, sha256, npmPackage } = inPlace ? pinInstalled({ version, run, which }) : copyBinary({ home, version, run })
  const ctx = { home, binary, version, pluginDir: plugin, pluginVersion, installedKeys: installedPluginKeys(home, { platform }) }
  const checks = SETUPS.map(setup => checkSetup(setup, ctx, { spawn, folder, root }))
  const inits = Object.fromEntries(SETUPS.map((setup, i) => [setup, checks[i].init]))
  const { problems, pin } = pinFor({ version, binary, sha256, npmPackage, pluginDir: plugin, pluginRef: ref, pluginCommit, inits })
  const all = [...checks.flatMap(check => check.problems), ...problems]
  if (all.length === 0) {
    mkdirSync(results, { recursive: true })
    writeFileSync(file, `${JSON.stringify(pin, null, 2)}\n`, { flag: 'wx' })
  }
  return { problems: all, pin, file }
}

// The written pin goes to the sync branch at once; false without a branch.
export function publishPin({ file, round, branch, redactEmail = false }, { publish }) {
  if (branch === null) return false
  publish({ items: [{ from: file, to: `results/${basename(file)}` }], message: `chore(results): pin round ${round}` }, { branch, redactEmail })
  return true
}

function main() {
  const { round, plugin, pluginRef, sync, noSync, redactEmail } = parseArgs(process.argv.slice(2))
  // Before any paid call: off Windows the pin must reach the results branch, so the email variable and the remote are
  // checked first.
  const branch = syncBranchOf({ sync, noSync })
  if (branch !== null) syncReady({ ...REAL_SYNC, branch, redactEmail })
  const { problems, pin, file } = preflight({ round, plugin, pluginRef, home: homedir(), results: RESULTS }, { folder: runFolder, root: RUNS })
  for (const line of problems) console.error(`preflight: ${line}`)
  if (problems.length > 0) process.exitCode = 1
  else {
    console.log(`preflight ok: claude ${pin.version} pinned at ${pin.binary}; the round's reference is in ${file}`)
    const publish = (what, options) => publishItems(what, { ...REAL_SYNC, ...options })
    if (publishPin({ file, round, branch, redactEmail }, { publish })) console.log(`preflight: the pin is pushed to ${branch}`)
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (err) {
    // A failing git in prepareRun says "Command failed: ..." followed by its stderr: one line only.
    console.error(`preflight: ${err.code && err.path ? `${err.code} at ${err.path}` : firstLine(err.message)}`)
    process.exitCode = 1
  }
}
