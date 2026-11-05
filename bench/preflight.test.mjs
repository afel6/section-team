import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { modeRecordFile, recordMode } from '../hooks/lib/mode-record.mjs'
import { BENCH_MODEL, PLUGIN_KEY, SECTION_TEAM_VERSION } from './clean-run.mjs'
import { builderArgs } from './run.mjs'
import { ROUND_CLI_VERSION } from './clean-run.mjs'
import { copyBinary, npmClaude, pinFor, pinInstalled, preflight, preflightProblems, publishPin, syncedListing, versionOf } from './preflight.mjs'

// A temp folder removed after the test, even when the test fails.
function tempRoot(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'bench-preflight-')))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  return root
}

const writeFile = (file, text) => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const sha256 = text => createHash('sha256').update(text).digest('hex')
const VERSION = '2.1.296'
const PLUGIN_DIR = 'C:/Users/Asus/section-team-v0.2.1'
const BUILTINS = [
  { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
  { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
]
const BUILTIN_SOURCES = BUILTINS.map(p => p.source)
const SECTION_TEAM = { name: 'section-team', path: 'C:\\Users\\Asus\\section-team-v0.2.1', source: PLUGIN_KEY, version: '0.2.1' }
const SOLO_LISTS = { agents: ['general-purpose'], skills: ['tdd-workflow'] }
const TEAM_LISTS = { agents: ['general-purpose', 'section-team:backend'], skills: ['tdd-workflow', 'section-team:add-skill'] }
const SETUPS = ['solo', 'lean', 'team', 'max']
const EXPECTED_RECORD = { solo: null, lean: 'lean', team: 'balanced', max: 'max' }

// One setup's init as Claude Code 2.1.296 writes it, with any fields replaced.
function init(setup, fields = {}) {
  const team = setup !== 'solo'
  return {
    type: 'system', subtype: 'init', model: BENCH_MODEL, claude_code_version: VERSION, apiKeySource: 'none',
    plugins: [...BUILTINS, ...(team ? [SECTION_TEAM] : [])], mcp_servers: [], ...(team ? TEAM_LISTS : SOLO_LISTS), ...fields,
  }
}
const answer = (text, fields = {}) => ({ type: 'result', is_error: false, result: text, ...fields })

function problemsOf(setup, { initMessage = init(setup), result = answer('NO'), record = EXPECTED_RECORD[setup] } = {}) {
  const messages = [initMessage, result].filter(Boolean)
  return preflightProblems({ setup, messages, record, pluginDir: PLUGIN_DIR, version: VERSION, pluginVersion: '0.2.1' })
}

test('versionOf reads 2.1.296 from "2.1.296 (Claude Code)"', () => {
  assert.equal(versionOf('2.1.296 (Claude Code)\n'), '2.1.296')
  assert.throws(() => versionOf('claude 2.1.296'), { message: 'claude --version printed "claude 2.1.296", expected a version like 2.1.296' })
  assert.throws(() => versionOf('claude: command not found\n'), { message: 'claude --version printed "claude: command not found", expected a version like 2.1.296' })
})

test('each setup\'s expected mode record', () => {
  for (const setup of SETUPS) assert.deepEqual(problemsOf(setup), [], setup)
  assert.deepEqual(problemsOf('solo', { record: 'balanced' }), ['solo: mode record balanced, expected none'])
  assert.deepEqual(problemsOf('team', { record: null }), ['team: mode record none, expected balanced'])
  assert.deepEqual(problemsOf('lean', { record: 'max' }), ['lean: mode record max, expected lean'])
  assert.deepEqual(problemsOf('max', { record: 'balanced' }), ['max: mode record balanced, expected max'])
  assert.throws(() => problemsOf('forced'), { message: 'preflightProblems takes a setup of solo, lean, team, max, got "forced"' })
})

test('a stray plugin, an MCP server or plugin-authoring fails', () => {
  const stray = { name: 'caveman', path: 'C:\\Users\\Asus\\.claude\\plugins\\cache\\caveman', source: 'caveman@caveman' }
  const authoring = { name: 'cc-plugin-plugin-authoring', path: 'builtin', source: 'cc-plugin-plugin-authoring@builtin' }
  assert.deepEqual(problemsOf('solo', { initMessage: init('solo', { plugins: [...BUILTINS, stray] }) }), ['solo: plugins that are not built-ins: caveman@caveman'])
  assert.deepEqual(problemsOf('team', { initMessage: init('team', { mcp_servers: [{ name: 'notion', status: 'connected' }] }) }), ['team: MCP servers loaded: notion'])
  assert.deepEqual(problemsOf('max', { initMessage: init('max', { plugins: [...BUILTINS, SECTION_TEAM, authoring] }) }), ['max: cc-plugin-plugin-authoring@builtin is loaded'])
  assert.deepEqual(problemsOf('lean', { initMessage: init('lean', { plugins: BUILTINS }) }), ['lean: expected 1 section-team plugin, found 0'])
  assert.deepEqual(problemsOf('lean', { initMessage: init('lean', { model: 'claude-haiku-5-5', claude_code_version: '2.1.297' }) }), [
    'lean: model claude-haiku-5-5, expected claude-opus-5-5', 'lean: claude_code_version 2.1.297, expected 2.1.296',
  ])
})

test('the answer must say NO to automatic skill installs, from a result that is not an error, after a full init', () => {
  assert.deepEqual(problemsOf('team', { result: answer('YES') }), ['team: the answer about automatic skill installs is "YES", expected NO'])
  assert.deepEqual(problemsOf('team', { result: answer('YES or NO') }), ['team: the answer about automatic skill installs is "YES or NO", expected NO'])
  for (const text of ['Maybe', '', 'UNKNOWN']) {
    assert.deepEqual(problemsOf('lean', { result: answer(text) }), [`lean: the answer about automatic skill installs is "${text}", expected NO`])
  }
  assert.deepEqual(problemsOf('solo', { result: answer('No.') }), [])
  assert.deepEqual(problemsOf('team', { result: answer('API Error: overloaded\nmore', { is_error: true }) }), ['team: claude ended on an error: API Error: overloaded'])
  assert.deepEqual(problemsOf('team', { result: null }), ['team: no result message'])
  assert.deepEqual(problemsOf('solo', { initMessage: null }), ['solo: no init message'])
  assert.deepEqual(problemsOf('max', { initMessage: init('max', { agents: undefined, apiKeySource: undefined }) }), [
    'max: the init has no agents list', 'max: the init has no apiKeySource',
  ])
})

test('copyBinary refuses differing bytes and a wrong --version', t => {
  const home = tempRoot(t)
  const source = join(home, '.local', 'share', 'claude', 'versions', VERSION)
  const binary = join(home, 'bench-runs', `claude-${VERSION}.exe`)
  writeFile(source, 'claude bytes')
  const calls = []
  const printing = stdout => (command, args, options) => {
    calls.push([command, args, options.encoding])
    return { status: 0, stdout, stderr: '' }
  }
  assert.throws(() => copyBinary({ home, version: VERSION, run: printing('2.1.2960 (Claude Code)\n') }),
    { message: `${binary} --version printed "2.1.2960 (Claude Code)" (exit 0), expected ${VERSION}` })
  assert.deepEqual(calls, [[binary, ['--version'], 'utf8']], 'the copy runs, never claude from PATH')
  assert.deepEqual(copyBinary({ home, version: VERSION, run: printing(`${VERSION} (Claude Code)\n`) }), { binary, sha256: sha256('claude bytes') })
  assert.equal(readFileSync(binary, 'utf8'), 'claude bytes')
  writeFileSync(binary, 'other bytes')
  assert.throws(() => copyBinary({ home, version: VERSION, run: printing(`${VERSION} (Claude Code)\n`) }),
    { message: `${binary} differs from ${source}: delete it and run the preflight again` })
  assert.equal(calls.length, 2, 'a copy with other bytes is never run')
})

test('copyBinary names a missing version, a copy that cannot start and a version that is not x.y.z', t => {
  const home = tempRoot(t)
  const missing = join(home, '.local', 'share', 'claude', 'versions', '2.1.297')
  assert.throws(() => copyBinary({ home, version: '2.1.297', run: () => assert.fail('no run') }), { message: `cannot read ${missing} (ENOENT)` })
  writeFile(join(home, '.local', 'share', 'claude', 'versions', VERSION), 'claude bytes')
  const binary = join(home, 'bench-runs', `claude-${VERSION}.exe`)
  const noStart = () => ({ error: Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }), status: null, stdout: null })
  assert.throws(() => copyBinary({ home, version: VERSION, run: noStart }), { message: `could not run ${binary} (EACCES)` })
  const failing = () => ({ status: 1, stdout: `${VERSION} (Claude Code)\n`, stderr: 'crashed' })
  assert.throws(() => copyBinary({ home, version: VERSION, run: failing }), { message: `${binary} --version printed "${VERSION} (Claude Code)" (exit 1), expected ${VERSION}` })
  assert.throws(() => copyBinary({ home, version: '../2', run: noStart }), { message: 'copyBinary takes a version like 2.1.296, got "../2"' })
})

// The cloud machine installs the round's CLI with npm i -g @anthropic-ai/claude-code@2.1.296, but its environment
// relinks `claude` on PATH to its own CLI at every session start: the pin is the npm package's binary, never PATH's.
test('npmClaude finds the npm package\'s binary under npm root -g, links resolved, and names the install when it is missing', t => {
  const root = tempRoot(t)
  const real = join(root, 'store', 'claude.exe')
  writeFile(real, 'claude bytes')
  const bin = join(root, 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'bin')
  mkdirSync(bin, { recursive: true })
  symlinkSync(real, join(bin, 'claude.exe'))
  const calls = []
  const npm = stdout => (command, args) => { calls.push([command, args]); return { status: 0, stdout } }
  assert.equal(npmClaude({ run: npm(`${join(root, 'lib', 'node_modules')}\n`) }), real)
  assert.deepEqual(calls, [['npm', ['root', '-g']]])
  assert.throws(() => npmClaude({ run: npm(`${join(root, 'other')}\n`) }),
    { message: `no npm-installed CLI at ${join(root, 'other', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')}: run npm i -g @anthropic-ai/claude-code@${VERSION}` })
  assert.throws(() => npmClaude({ run: () => ({ status: 1, stdout: '' }) }), { message: 'npm root -g failed (exit 1): is npm installed?' })
})

test('pinInstalled pins the installed CLI in place: its real path, its SHA-256, its npm package; it must print the version', t => {
  const root = tempRoot(t)
  const binary = join(root, 'claude.exe')
  writeFile(binary, 'claude bytes')
  const which = () => binary
  const calls = []
  const printing = stdout => (command, args) => { calls.push([command, args]); return { status: 0, stdout } }
  assert.deepEqual(pinInstalled({ version: VERSION, run: printing(`${VERSION} (Claude Code)\n`), which }),
    { binary, sha256: sha256('claude bytes'), npmPackage: `@anthropic-ai/claude-code@${VERSION}` })
  assert.deepEqual(calls, [[binary, ['--version']]])
  assert.throws(() => pinInstalled({ version: VERSION, run: printing('2.1.316 (Claude Code)\n'), which }),
    { message: `${binary} --version printed "2.1.316 (Claude Code)" (exit 0), expected ${VERSION}` })
  const noStart = () => ({ error: Object.assign(new Error('spawn EACCES'), { code: 'EACCES' }) })
  assert.throws(() => pinInstalled({ version: VERSION, run: noStart, which }), { message: `could not run ${binary} (EACCES)` })
  assert.throws(() => pinInstalled({ version: '../2', run: noStart, which }), { message: 'pinInstalled takes a version like 2.1.296, got "../2"' })
})

// A resume on a fresh machine starts from the pushed pin (cloud-sync.mjs restore), so the preflight pushes it at once.
test('publishPin pushes the round\'s pin file under results/ on the sync branch, and nothing without one', () => {
  const calls = []
  const publish = (what, options) => { calls.push([what, options]); return { committed: true, pushed: true } }
  assert.equal(publishPin({ file: '/x/bench/results/preflight-mo.json', round: 'mo', branch: null, redactEmail: true }, { publish }), false)
  assert.equal(publishPin({ file: '/x/bench/results/preflight-mo.json', round: 'mo', branch: 'bench/mode-round-cloud-results', redactEmail: true }, { publish }), true)
  assert.deepEqual(calls, [[
    { items: [{ from: '/x/bench/results/preflight-mo.json', to: 'results/preflight-mo.json' }], message: 'chore(results): pin round mo' },
    { branch: 'bench/mode-round-cloud-results', redactEmail: true },
  ]])
})

test('syncedListing lists both synced folders, sorted, and treats a missing folder as empty', t => {
  const home = tempRoot(t)
  assert.deepEqual(syncedListing(home), [])
  writeFile(join(home, '.claude', 'skills', 'synced', 'b-skill', 'SKILL.md'), 'b')
  writeFile(join(home, '.claude', 'plugins', 'synced', 'b', 'plugin.json'), '{}')
  writeFile(join(home, '.claude', 'plugins', 'synced', 'a', 'plugin.json'), '{}')
  assert.deepEqual(syncedListing(home), [
    'plugins/synced/a', 'plugins/synced/a/plugin.json', 'plugins/synced/b', 'plugins/synced/b/plugin.json',
    'skills/synced/b-skill', 'skills/synced/b-skill/SKILL.md',
  ])
})

const BASE = { version: VERSION, binary: 'C:/Users/Asus/bench-runs/claude-2.1.296.exe', sha256: 'ab12', pluginDir: PLUGIN_DIR, pluginRef: 'v0.2.1', pluginCommit: 'tagged' }
const INITS = Object.fromEntries(SETUPS.map(setup => [setup, init(setup)]))

test('pinFor records the round\'s reference from the four inits', () => {
  const teamSetup = { plugins: [...BUILTIN_SOURCES, PLUGIN_KEY], ...TEAM_LISTS }
  assert.deepEqual(pinFor({ ...BASE, inits: INITS }), {
    problems: [],
    pin: {
      ...BASE, apiKeySource: 'none', builtins: BUILTIN_SOURCES, pluginDir: PLUGIN_DIR,
      setups: { solo: { plugins: BUILTIN_SOURCES, ...SOLO_LISTS }, lean: teamSetup, team: teamSetup, max: teamSetup },
    },
  })
  assert.deepEqual(Object.keys(pinFor({ ...BASE, inits: INITS }).pin), ['version', 'binary', 'sha256', 'apiKeySource', 'builtins', 'pluginDir', 'pluginRef', 'pluginCommit', 'setups'])
})

test('built-in sets that differ between setups fail', () => {
  const extra = { name: 'cc-plugin-x', path: 'builtin', source: 'cc-plugin-x@builtin' }
  const inits = { ...INITS, team: init('team', { plugins: [extra, ...BUILTINS, SECTION_TEAM] }) }
  const both = BUILTIN_SOURCES.join(', ')
  assert.deepEqual(pinFor({ ...BASE, inits }).problems, [
    `the built-in plugins differ between setups: solo ${both}; lean ${both}; team ${both}, cc-plugin-x@builtin; max ${both}`,
  ])
  assert.deepEqual(pinFor({ ...BASE, inits: { ...INITS, max: init('max', { apiKeySource: 'ANTHROPIC_API_KEY' }) } }).problems, [
    'the apiKeySource differs between setups: solo none; lean none; team none; max ANTHROPIC_API_KEY',
  ])
  assert.deepEqual(pinFor({ ...BASE, inits: { ...INITS, solo: null } }).problems, [], 'a setup without an init is reported by its own check')
})

// The git of a plugin worktree at v0.2.1 (head 'tagged'), or at another commit.
const gitAt = head => args => {
  if (args.includes('--show-toplevel')) return PLUGIN_DIR
  if (args.includes('HEAD')) return head
  return args.includes('rev-parse') ? 'tagged' : ''
}

// A fake home with the CLI's version file and installed plugins, and a fake CLI that answers like 2.1.296 would.
function fakeRound(t, { initFields = {}, during = {} } = {}) {
  const root = tempRoot(t)
  const home = join(root, 'home')
  writeFile(join(home, '.local', 'share', 'claude', 'versions', VERSION), 'claude bytes')
  writeFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'caveman@caveman': [] } }))
  const calls = { run: [], spawn: [] }
  const run = (command, args) => {
    calls.run.push([command, args])
    return { status: 0, stdout: `${VERSION} (Claude Code)\n`, stderr: '' }
  }
  const spawn = (binary, args, options) => {
    calls.spawn.push({ binary, args, options })
    const sessionId = args[args.indexOf('--session-id') + 1]
    const on = JSON.parse(args[args.indexOf('--settings') + 1]).enabledPlugins[PLUGIN_KEY]
    const modeFile = join(options.cwd, '.team', 'mode.json')
    const mode = existsSync(modeFile) ? JSON.parse(readFileSync(modeFile, 'utf8')).mode : 'balanced'
    const setup = on ? { balanced: 'team' }[mode] ?? mode : 'solo'
    if (on) recordMode(home, sessionId, mode)
    if (during[setup]) return during[setup]({ home, sessionId })
    const stdout = [init(setup, initFields[setup]), answer('NO')].map(m => JSON.stringify(m)).join('\n')
    return { status: 0, stdout: `${stdout}\n`, stderr: '' }
  }
  const runs = join(root, 'runs')
  const deps = { git: gitAt('tagged'), run, spawn, folder: r => join(runs, r.id), root: runs, readPluginVersion: () => '0.2.1' }
  return { home, results: join(root, 'results'), calls, deps, binary: join(home, 'bench-runs', `claude-${VERSION}.exe`) }
}

test('preflight runs the four setups on the copied binary with the builders\' arguments and writes the pin', t => {
  const { home, results, calls, deps, binary } = fakeRound(t)
  const { problems, pin, file } = preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, deps)
  assert.deepEqual(problems, [])
  assert.equal(file, join(results, 'preflight-mo.json'))
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), pin)
  assert.deepEqual({ version: pin.version, binary: pin.binary, sha256: pin.sha256 }, { version: VERSION, binary, sha256: sha256('claude bytes') })
  assert.deepEqual(calls.run, [['claude', ['--version']], [binary, ['--version']]])
  assert.equal(calls.spawn.length, 4)
  for (const [i, { binary: command, args, options }] of calls.spawn.entries()) {
    const sessionId = args[args.indexOf('--session-id') + 1]
    const expected = builderArgs(SETUPS[i], args[1], { sessionId, installedKeys: ['caveman@caveman'], pluginDir: PLUGIN_DIR })
    assert.equal(command, binary)
    assert.deepEqual(args, expected, `${SETUPS[i]} gets exactly the builders' arguments`)
    assert.match(args[1], /YES/)
    assert.equal(options.env.CLAUDE_CODE_PLUGIN_DIRS, PLUGIN_DIR)
    assert.equal(options.env.SECTION_TEAM_AUTO_INSTALL_SKILLS, '0')
  }
  assert.deepEqual(Object.keys(pin.setups), SETUPS)
})

// Where ~/.local/share/claude/versions is missing (not on Windows), the round runs the npm-installed CLI itself, at the
// round's version, whatever `claude` on PATH is.
test('preflight on Linux without a versions folder pins the npm-installed CLI in place and runs every setup on it', t => {
  const { home, results, calls, deps } = fakeRound(t)
  rmSync(join(home, '.local'), { recursive: true })
  const installed = join(dirname(home), 'npm', 'bin', 'claude.exe')
  writeFile(installed, 'npm claude bytes')
  const { problems, pin } = preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, { ...deps, which: () => installed, platform: 'linux' })
  assert.deepEqual(problems, [])
  assert.deepEqual({ binary: pin.binary, sha256: pin.sha256, npmPackage: pin.npmPackage }, { binary: installed, sha256: sha256('npm claude bytes'), npmPackage: `@anthropic-ai/claude-code@${VERSION}` })
  assert.deepEqual(Object.keys(pin), ['version', 'binary', 'sha256', 'npmPackage', 'apiKeySource', 'builtins', 'pluginDir', 'pluginRef', 'pluginCommit', 'setups'])
  assert.deepEqual(calls.run, [[installed, ['--version']]], 'claude on PATH is never asked')
  assert.deepEqual(calls.spawn.map(s => s.binary), [installed, installed, installed, installed])
  assert.equal(existsSync(join(home, 'bench-runs')), false, 'nothing is copied')
  assert.equal(ROUND_CLI_VERSION, VERSION)
})

test('preflight on Linux refuses an npm-installed CLI at another version before any paid run', t => {
  const { home, results, calls, deps } = fakeRound(t)
  rmSync(join(home, '.local'), { recursive: true })
  const installed = join(dirname(home), 'npm', 'bin', 'claude.exe')
  writeFile(installed, 'other claude')
  const run = (command, args) => { calls.run.push([command, args]); return { status: 0, stdout: '2.1.316 (Claude Code)\n' } }
  assert.throws(() => preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, { ...deps, run, which: () => installed, platform: 'linux' }),
    { message: `${installed} --version printed "2.1.316 (Claude Code)" (exit 0), expected ${VERSION}` })
  assert.deepEqual(calls.spawn, [])
})

test('preflight on Windows still copies from the versions folder, and a missing one still stops it', t => {
  const { home, results, calls, deps } = fakeRound(t)
  rmSync(join(home, '.local'), { recursive: true })
  const which = () => assert.fail('Windows never pins the installed CLI in place')
  assert.throws(() => preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, { ...deps, which, platform: 'win32' }),
    { message: `cannot read ${join(home, '.local', 'share', 'claude', 'versions', VERSION)} (ENOENT)` })
  assert.deepEqual(calls.spawn, [])
})

test('preflight refuses a plugin worktree that is not at v0.2.1 before any spawn', t => {
  const { home, results, calls, deps } = fakeRound(t)
  assert.throws(() => preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, { ...deps, git: gitAt('other') }),
    { message: `${PLUGIN_DIR} is at other, not at v0.2.1 (tagged)` })
  const dirty = args => (args.includes('status') ? ' M agents/backend.md' : gitAt('tagged')(args))
  assert.throws(() => preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, { ...deps, git: dirty }),
    { message: `${PLUGIN_DIR} has uncommitted changes: a batch needs a clean v0.2.1 worktree` })
  assert.throws(() => preflight({ round: '', plugin: PLUGIN_DIR, home, results }, deps), { message: '--round= names the round in letters and digits, e.g. --round=mo' })
  assert.deepEqual(calls, { run: [], spawn: [] })
})

test('preflight with no --plugin-ref checks the default v<version> tag, and records it and its commit in the pin', t => {
  const { home, results, deps } = fakeRound(t)
  const calls = []
  const git = args => { calls.push(args.join(' ')); return gitAt('tagged')(args) }
  const { problems, pin, file } = preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, { ...deps, git })
  assert.deepEqual(problems, [])
  assert.deepEqual([pin.pluginRef, pin.pluginCommit], [`v${SECTION_TEAM_VERSION}`, 'tagged'])
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).pluginRef, `v${SECTION_TEAM_VERSION}`)
  assert.ok(calls.includes(`rev-parse v${SECTION_TEAM_VERSION}^{commit}`))
})

test('preflight uses a passed ref for both worktree checks, and records it and its commit in the pin', t => {
  const { home, results, deps } = fakeRound(t)
  const calls = []
  const git = args => { calls.push(args.join(' ')); return gitAt('tagged')(args) }
  const { problems, pin, file } = preflight({ round: 'mo', plugin: PLUGIN_DIR, pluginRef: 'fix/fresh', home, results }, { ...deps, git })
  assert.deepEqual(problems, [])
  assert.deepEqual([pin.pluginRef, pin.pluginCommit], ['fix/fresh', 'tagged'])
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), pin)
  assert.ok(calls.includes('rev-parse fix/fresh^{commit}'))
  assert.ok(calls.includes(`-C ${PLUGIN_DIR} diff --stat fix/fresh`))
})

test('preflight names a passed ref when the worktree is not at it, before any spawn', t => {
  const { home, results, calls, deps } = fakeRound(t)
  assert.throws(() => preflight({ round: 'mo', plugin: PLUGIN_DIR, pluginRef: 'fix/fresh', home, results }, { ...deps, git: gitAt('other') }),
    { message: `${PLUGIN_DIR} is at other, not at fix/fresh (tagged)` })
  assert.deepEqual(calls, { run: [], spawn: [] })
})

// A plugin folder with this manifest (null: none), whose builders' inits load it at loaded, on a fake round. The real
// manifest reader runs.
function otherVersionRound(t, { manifest, loaded }) {
  const plugin = tempRoot(t)
  if (manifest !== null) writeFile(join(plugin, '.claude-plugin', 'plugin.json'), manifest)
  const entry = { ...SECTION_TEAM, path: plugin, version: loaded }
  const builders = Object.fromEntries(['lean', 'team', 'max'].map(setup => [setup, { plugins: [...BUILTINS, entry] }]))
  const round = fakeRound(t, { initFields: builders })
  const { readPluginVersion, ...deps } = round.deps
  const git = args => (args.includes('--show-toplevel') ? plugin : gitAt('tagged')(args))
  return { ...round, plugin, deps: { ...deps, git } }
}

test('preflight passes a plugin at another version when its manifest matches, and fails when the init disagrees', t => {
  const matching = otherVersionRound(t, { manifest: JSON.stringify({ version: '0.2.3' }), loaded: '0.2.3' })
  const { problems: none } = preflight({ round: 'mo', plugin: matching.plugin, pluginRef: 'fix/fresh', home: matching.home, results: matching.results }, matching.deps)
  assert.deepEqual(none, [])
  const other = otherVersionRound(t, { manifest: JSON.stringify({ version: '0.2.3' }), loaded: '0.2.2' })
  const { problems, file } = preflight({ round: 'mo', plugin: other.plugin, pluginRef: 'fix/fresh', home: other.home, results: other.results }, other.deps)
  assert.deepEqual(problems, ['lean', 'team', 'max'].map(setup => `${setup}: section-team version 0.2.2, expected 0.2.3`))
  assert.equal(existsSync(file), false)
})

test('preflight stops in one line on a missing or invalid manifest, before any spawn', t => {
  for (const [manifest, why] of [[null, 'ENOENT'], ['{"version":', 'SyntaxError'], ['{}', 'no version']]) {
    const { plugin, home, results, calls, deps } = otherVersionRound(t, { manifest, loaded: '0.2.3' })
    const path = join(plugin, '.claude-plugin', 'plugin.json')
    assert.throws(() => preflight({ round: 'mo', plugin, home, results }, deps), { message: `cannot read the plugin version from ${path} (${why})` })
    assert.deepEqual(calls.spawn, [])
  }
})

test('preflight never overwrites a round\'s pin: an existing one stops it before any spawn', t => {
  const { home, results, calls, deps } = fakeRound(t)
  const file = join(results, 'preflight-mo.json')
  writeFile(file, '{"binary":"earlier"}\n')
  assert.throws(() => preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, { ...deps, git: () => assert.fail('git ran') }),
    { message: `${file} exists: round mo is already pinned; delete it only if no run of the round has started` })
  assert.deepEqual(calls, { run: [], spawn: [] })
  assert.equal(readFileSync(file, 'utf8'), '{"binary":"earlier"}\n')
})

test('preflight never overwrites a pin that appeared while its setups ran', t => {
  const file = (results => join(results, 'preflight-mo.json'))
  const appears = ({ home }) => {
    writeFile(file(join(dirname(home), 'results')), 'other\n')
    return { status: 0, stdout: [init('max'), answer('NO')].map(m => JSON.stringify(m)).join('\n'), stderr: '' }
  }
  const { home, results, deps } = fakeRound(t, { during: { max: appears } })
  assert.throws(() => preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, deps), { code: 'EEXIST' })
  assert.equal(readFileSync(file(results), 'utf8'), 'other\n')
})

test('preflight reports every problem, one line each, and writes no pin', t => {
  const timedOut = () => ({ error: Object.assign(new Error('spawnSync ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null, stdout: '', stderr: '' })
  const syncs = ({ home }) => {
    writeFile(join(home, '.claude', 'skills', 'synced', 'new-skill', 'SKILL.md'), 'x')
    return { status: 1, stdout: [init('team'), answer('NO')].map(m => JSON.stringify(m)).join('\n'), stderr: 'Error: hook failed\nmore' }
  }
  const badRecord = ({ home, sessionId }) => {
    writeFileSync(modeRecordFile(home, sessionId), '{"mode":"turbo"}')
    return { status: 0, stdout: [init('max'), answer('NO')].map(m => JSON.stringify(m)).join('\n'), stderr: '' }
  }
  const { home, results, deps } = fakeRound(t, { initFields: { lean: { mcp_servers: [{ name: 'notion' }] } }, during: { solo: timedOut, team: syncs, max: badRecord } })
  const { problems, file } = preflight({ round: 'mo', plugin: PLUGIN_DIR, home, results }, deps)
  assert.deepEqual(problems, [
    'solo: could not run claude (ETIMEDOUT)',
    'lean: MCP servers loaded: notion',
    'team: claude exited 1: Error: hook failed',
    'team: the synced plugins or skills changed during the run',
    'max: mode record unreadable (mode record is not valid), expected max',
  ])
  assert.equal(existsSync(file), false)
})
