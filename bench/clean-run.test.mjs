import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  BENCH_EFFORT, BENCH_MODEL, PLUGIN_KEY, ROUND_CLI_VERSION, SECTION_TEAM_VERSION, advisorProblems, checkLiveCheckout, checkRoundSettings, childEnv, cleanSettings,
  commonArgs, compacted, effortProblems, envNames, initOf, initProblems, installedPluginKeys, isUnder, liveCheckoutOf, liveCheckouts, memoryLimitOf,
  outputMessages, pluginVersionOf, readPin, resultOf,
} from './clean-run.mjs'

// The user's own checkout in these tests (SECTION_TEAM_LIVE_CHECKOUT on a real round).
const LIVE_CHECKOUT = 'C:/Users/Asus/claude-team'

// A batch runs on what its preflight pinned: the same profile, memory limit, run-folder root and setups.
test('checkRoundSettings holds a batch to the pin\'s profile, memory limit, runs root and setups; an older pin to none of them', () => {
  const pin = { conds: ['solo', 'base', 'team'], configDir: 'C:/bench-profile-nx', memoryLimitMb: '12288', runsRoot: 'C:/bench-runs-nx' }
  const batch = { conds: ['solo', 'base', 'team'], configDir: 'C:/Bench-Profile-NX/', memoryLimitMb: '12288', runsRoot: 'C:/bench-runs-nx' }
  assert.doesNotThrow(() => checkRoundSettings(batch, pin))
  assert.doesNotThrow(() => checkRoundSettings({ ...batch, conds: ['team'] }, pin), 'a batch may run some of the pinned setups')
  const cases = [
    [{ configDir: null }, '--config-dir= is not the profile the round pinned (C:/bench-profile-nx): pass --config-dir=C:/bench-profile-nx'],
    [{ configDir: 'C:/other' }, '--config-dir=C:/other is not the profile the round pinned (C:/bench-profile-nx): pass --config-dir=C:/bench-profile-nx'],
    [{ memoryLimitMb: null }, 'SECTION_TEAM_MEMORY_LIMIT_MB is unset, but the round pinned 12288: set it as the preflight had it'],
    [{ memoryLimitMb: '8192' }, 'SECTION_TEAM_MEMORY_LIMIT_MB is 8192, but the round pinned 12288: set it as the preflight had it'],
    [{ runsRoot: 'C:/Users/me/bench-runs' }, 'the run folders\' root is C:/Users/me/bench-runs, but the round pinned C:/bench-runs-nx: set BENCH_RUNS as the preflight had it'],
    [{ conds: ['solo', 'max'] }, '--conds names max, which the round\'s preflight did not run'],
  ]
  for (const [change, message] of cases) assert.throws(() => checkRoundSettings({ ...batch, ...change }, pin), { message }, message)
  const older = { binary: 'b' }
  assert.doesNotThrow(() => checkRoundSettings({ conds: ['solo', 'team', 'max'], configDir: null, memoryLimitMb: null, runsRoot: 'C:/anywhere' }, older))
  assert.throws(() => checkRoundSettings({ conds: ['team'], configDir: 'C:/p', memoryLimitMb: null, runsRoot: 'C:/r' }, older),
    { message: '--config-dir=C:/p is not the profile the round pinned (none): leave --config-dir out' })
})

// A temp folder removed after the test, even when the test fails.
function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-clean-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  return root
}

const PLUGIN_DIR = 'C:/Users/Asus/section-team-v0.2.1'
const BUILTINS = [
  { name: 'cc-plugin-agents-md', path: 'builtin', source: 'cc-plugin-agents-md@builtin' },
  { name: 'cc-plugin-telemetry', path: 'builtin', source: 'cc-plugin-telemetry@builtin' },
]
// The init writes Windows paths with backslashes; the pin's plugin dir uses forward slashes.
const SECTION_TEAM = { name: 'section-team', path: 'C:\\Users\\Asus\\section-team-v0.2.1', source: PLUGIN_KEY, version: '0.2.1' }
const TEAM_LISTS = { agents: ['general-purpose', 'section-team:backend'], skills: ['tdd-workflow', 'section-team:add-skill'] }
const SOLO_LISTS = { agents: ['general-purpose'], skills: ['tdd-workflow'] }
const PIN = {
  version: '2.1.296', binary: 'C:/Users/Asus/bench-runs/claude-2.1.296.exe', apiKeySource: 'none', builtins: BUILTINS.map(p => p.source), pluginDir: PLUGIN_DIR,
  setups: { solo: SOLO_LISTS, lean: TEAM_LISTS, team: TEAM_LISTS, max: TEAM_LISTS, base: TEAM_LISTS }, liveCheckouts: [LIVE_CHECKOUT],
}

// A team init as Claude Code 2.1.296 writes it, with any fields replaced.
function init(fields = {}) {
  return {
    type: 'system', subtype: 'init', session_id: 's-1', model: BENCH_MODEL, claude_code_version: '2.1.296', apiKeySource: 'none',
    plugins: [...BUILTINS, SECTION_TEAM], mcp_servers: [], ...TEAM_LISTS, ...fields,
  }
}

const jsonl = messages => messages.map(m => JSON.stringify(m)).join('\n')

test('childEnv strips session, model and key variables and sets the round switches and plugin dir', () => {
  const parent = {
    PATH: 'C:/bin', CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: 'http://proxy.test',
    DISABLE_MICROCOMPACT: '1', SECTION_TEAM_AUTO_INSTALL_SKILLS: '1', CLAUDE_CODE_PLUGIN_DIRS: 'live',
  }
  const before = structuredClone(parent)
  assert.deepEqual(childEnv(parent, { pluginDir: 'C:/w' }), {
    PATH: 'C:/bin', SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_PLUGIN_DIRS: 'C:/w',
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0', CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1',
  })
  assert.deepEqual(parent, before)
  // The pattern is anchored: names that only contain a stripped prefix stay.
  const kept = { CLAUDECODE_HOME: 'x', MY_ANTHROPIC_KEY: 'y' }
  assert.deepEqual(childEnv(kept, { pluginDir: 'C:/w' }), { ...kept, ...childEnv({}, { pluginDir: 'C:/w' }) })
  assert.throws(() => childEnv(parent, {}), { name: 'TypeError', message: 'childEnv needs a pluginDir' })
})

test('childEnv and envNames ignore the case of variable names, as Windows does', () => {
  const parent = {
    Path: 'C:/bin', anthropic_api_key: 'test-key', Claude_Code_Entrypoint: 'cli', claudecode: '1', Disable_Telemetry: '1',
    section_team_mode: 'max', claude_code_plugin_dirs: 'live',
  }
  // The child gets one spelling of each round variable: the parent's other spellings are dropped.
  assert.deepEqual(childEnv(parent, { pluginDir: 'C:/w' }), { Path: 'C:/bin', ...childEnv({}, { pluginDir: 'C:/w' }) })
  assert.deepEqual(envNames({ Path: 'p', anthropic_api_key: 'k', Claude_Code_Entrypoint: 'cli', enable_claudeai_mcp_servers: 'true' }),
    ['Claude_Code_Entrypoint', 'anthropic_api_key', 'enable_claudeai_mcp_servers'])
})

// claude -p stops background subagents 10 minutes after the last turn unless this is 0 (a probe saw it cut off the
// testing section's final review); the run's own time limit still bounds the run. The parent's value, in any case, is
// stripped first, so the child always gets exactly one spelling, set to 0.
test('childEnv sets CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS to 0 after the strip, whatever the parent set', () => {
  for (const parent of [{}, { CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '600000' }, { claude_code_print_bg_wait_ceiling_ms: '1' }]) {
    const child = childEnv({ PATH: '/bin', ...parent }, { pluginDir: '/root/section-team-v0.2.1' })
    assert.deepEqual(Object.keys(child).filter(name => /^claude_code_print_bg_wait_ceiling_ms$/i.test(name)), ['CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS'])
    assert.equal(child.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, '0')
  }
  assert.equal(cleanSettings({ installedKeys: [], sectionTeam: false, pluginDir: 'C:/w' }).env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, '0')
})

// The user's /advisor choice is saved in ~/.claude/settings.json (advisorModel) and a running claude picks it up at once:
// round tk's runs got an advisor mid-round. CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 makes claude ignore advisorModel, so the
// child always gets exactly one spelling, set to 1, whatever the parent set, and --settings carries it too.
test('childEnv sets CLAUDE_CODE_DISABLE_ADVISOR_TOOL to 1 after the strip, whatever the parent set', () => {
  for (const parent of [{}, { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '0' }, { claude_code_disable_advisor_tool: '' }]) {
    const child = childEnv({ PATH: '/bin', ...parent }, { pluginDir: '/root/section-team-v0.2.1' })
    assert.deepEqual(Object.keys(child).filter(name => /^claude_code_disable_advisor_tool$/i.test(name)), ['CLAUDE_CODE_DISABLE_ADVISOR_TOOL'])
    assert.equal(child.CLAUDE_CODE_DISABLE_ADVISOR_TOOL, '1')
  }
  assert.equal(cleanSettings({ installedKeys: [], sectionTeam: true, pluginDir: 'C:/w' }).env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL, '1')
})

// Host-session variables a shell inside the desktop app sets: the child never sees them, run.json names them.
test('childEnv strips the OAuth, MCP, thinking and Bash timeout variables, in any case, and envNames records them', () => {
  const host = [
    'USE_STAGING_OAUTH', 'USE_LOCAL_OAUTH', 'MCP_CONNECTION_NONBLOCKING', 'MCP_SERVER_CONNECTION_BATCH_SIZE', 'MAX_THINKING_TOKENS',
    'BASH_DEFAULT_TIMEOUT_MS', 'BASH_MAX_TIMEOUT_MS', 'use_local_oauth', 'mcp_timeout', 'Max_Thinking_Tokens', 'bash_max_timeout_ms',
  ]
  const kept = { PATH: 'C:/bin', USE_STAGING_OAUTH_X: '1', MY_MCP_X: '1', MAX_THINKING_TOKENS_X: '1', BASH_TIMEOUT_MS: '1', XBASH_MAX_TIMEOUT_MS: '1' }
  for (const name of host) {
    assert.deepEqual(childEnv({ ...kept, [name]: '1' }, { pluginDir: 'C:/w' }), childEnv(kept, { pluginDir: 'C:/w' }), `${name} is stripped`)
    assert.deepEqual(envNames({ ...kept, [name]: '1' }), [name], `${name} is recorded, and only it`)
  }
})

test('envNames lists the names of the round variables, sorted, never their values', () => {
  assert.deepEqual(envNames(childEnv({ PATH: 'p', HOME: 'h', CLAUDECODE: '1' }, { pluginDir: 'C:/w' })),
    ['CLAUDE_CODE_DISABLE_ADVISOR_TOOL', 'CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'DISABLE_AUTOUPDATER', 'ENABLE_CLAUDEAI_MCP_SERVERS', 'SECTION_TEAM_AUTO_INSTALL_SKILLS'])
  assert.deepEqual(envNames({ PATH: 'p', CLAUDECODE: '1', ANTHROPIC_MODEL: 'm' }), ['ANTHROPIC_MODEL', 'CLAUDECODE'])
})

test('cleanSettings: every installed key and plugin-authoring off, synced off, section-team per setup, plugin dir always set', () => {
  const installedKeys = ['caveman@caveman', 'ponytail@ponytail']
  const env = {
    SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_PLUGIN_DIRS: PLUGIN_DIR,
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0', CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1',
  }
  for (const sectionTeam of [true, false]) {
    assert.deepEqual(cleanSettings({ installedKeys, sectionTeam, pluginDir: PLUGIN_DIR }), {
      syncClaudeAiPlugins: false,
      syncClaudeAiSkills: false,
      enabledPlugins: { 'caveman@caveman': false, 'ponytail@ponytail': false, 'cc-plugin-plugin-authoring@builtin': false, [PLUGIN_KEY]: sectionTeam },
      env,
    })
  }
  // An installed entry under the same key never overrides the setup's choice.
  assert.equal(cleanSettings({ installedKeys: [PLUGIN_KEY], sectionTeam: true, pluginDir: PLUGIN_DIR }).enabledPlugins[PLUGIN_KEY], true)
  assert.throws(() => cleanSettings({ installedKeys, sectionTeam: false }), { message: 'cleanSettings needs a pluginDir' })
  assert.throws(() => cleanSettings({ installedKeys, pluginDir: PLUGIN_DIR }), TypeError)
  assert.throws(() => cleanSettings({ sectionTeam: true, pluginDir: PLUGIN_DIR }), TypeError)
})

test('commonArgs pins the model, effort, verbose output, no MCP config and the session id; the round constants', () => {
  assert.deepEqual(commonArgs({ sessionId: 'abc' }),
    ['--model', 'claude-opus-5-5', '--effort', 'medium', '--verbose', '--strict-mcp-config', '--session-id', 'abc'])
  assert.deepEqual([PLUGIN_KEY, BENCH_MODEL, BENCH_EFFORT, ROUND_CLI_VERSION], ['section-team@inline', 'claude-opus-5-5', 'medium', '2.1.318'])
  assert.throws(() => commonArgs({}), { message: 'commonArgs needs a sessionId' })
})

test('outputMessages reads a json array, one object, and stream-json cut off mid-line, and finds the init', () => {
  const start = init()
  const assistant = { type: 'assistant', effort: 'medium', message: { model: BENCH_MODEL, content: [] } }
  const result = { type: 'result', subtype: 'success', is_error: false, result: 'done' }
  assert.deepEqual(outputMessages(JSON.stringify([start, assistant, result])), [start, assistant, result])
  assert.deepEqual(outputMessages(JSON.stringify(result)), [result])
  const killed = `${JSON.stringify(start)}\r\n\r\n${JSON.stringify(assistant)}\r\n{"type":"assistant","mess`
  assert.deepEqual(outputMessages(killed), [start, assistant])
  assert.deepEqual(initOf(outputMessages(killed)), start)
  assert.equal(resultOf(outputMessages(killed)), null)
  // The first init and the last result count.
  const again = { ...result, result: 'again' }
  const both = outputMessages(jsonl([start, result, init({ session_id: 's-2' }), again]))
  assert.equal(initOf(both).session_id, 's-1')
  assert.equal(resultOf(both).result, 'again')
  assert.deepEqual(outputMessages('not json\n\n42\n[1]\nnull'), [])
  assert.deepEqual(outputMessages(''), [])
  assert.equal(initOf([]), null)
})

test('isUnder: builtin and C:/Users/Asus/claude-team-moderound/x are not under the live checkout; C:/Users/Asus/Claude-Team/hooks is', () => {
  assert.equal(isUnder('builtin', LIVE_CHECKOUT), false)
  assert.equal(isUnder('C:/Users/Asus/claude-team-moderound/x', LIVE_CHECKOUT), false)
  assert.equal(isUnder('C:/Users/Asus/Claude-Team/hooks', LIVE_CHECKOUT), true)
  assert.equal(isUnder('C:\\Users\\Asus\\claude-team', LIVE_CHECKOUT), true)
  assert.equal(isUnder('C:/Users/Asus', LIVE_CHECKOUT), false)
  // On another drive, path.relative returns an absolute path.
  assert.equal(isUnder('D:/Users/Asus/claude-team/hooks', LIVE_CHECKOUT), false)
  assert.equal(isUnder(undefined, LIVE_CHECKOUT), false)
})

test('initProblems accepts a team init (built-ins with path builtin) and names each mismatch', () => {
  const ctx = { setup: 'team', pin: PIN, pluginDir: PLUGIN_DIR, pluginVersion: '0.2.1' }
  assert.deepEqual(initProblems(init(), ctx), [])
  const stray = { name: 'caveman', path: 'C:\\Users\\Asus\\.claude\\plugins\\cache\\caveman', source: 'caveman@caveman', version: '1.0.0' }
  const live = { name: 'section-team', path: 'C:\\Users\\Asus\\claude-team', source: PLUGIN_KEY, version: '0.1.1' }
  const cases = [
    [{ plugins: [...BUILTINS, SECTION_TEAM, stray] }, ['plugins differ from the pin (extra: caveman@caveman; missing: none)']],
    [{ plugins: [BUILTINS[0], SECTION_TEAM] }, ['plugins differ from the pin (extra: none; missing: cc-plugin-telemetry@builtin)']],
    [{ plugins: [...BUILTINS, { ...SECTION_TEAM, path: 'C:\\Users\\Asus\\section-team-v0.2.1\\hooks' }] },
      ['section-team path C:\\Users\\Asus\\section-team-v0.2.1\\hooks, expected C:/Users/Asus/section-team-v0.2.1']],
    [{ plugins: [...BUILTINS, { ...SECTION_TEAM, version: '0.2.0' }] }, ['section-team version 0.2.0, expected 0.2.1']],
    [{ plugins: [...BUILTINS, live] }, [
      'section-team path C:\\Users\\Asus\\claude-team, expected C:/Users/Asus/section-team-v0.2.1',
      'section-team version 0.1.1, expected 0.2.1',
      'loaded from the live checkout C:/Users/Asus/claude-team: section-team@inline',
    ]],
    [{ plugins: BUILTINS }, ['expected 1 section-team plugin, found 0']],
    [{ plugins: [...BUILTINS, SECTION_TEAM, SECTION_TEAM] }, ['expected 1 section-team plugin, found 2']],
    [{ mcp_servers: [{ name: 'github', status: 'connected', source: 'user' }] }, ['MCP servers loaded: github']],
    [{ mcp_servers: undefined }, ['the init has no mcp_servers list']],
    [{ claude_code_version: '2.1.297' }, ['claude_code_version 2.1.297, expected 2.1.296']],
    [{ model: 'claude-sonnet-5-5' }, ['model claude-sonnet-5-5, expected claude-opus-5-5']],
    [{ apiKeySource: 'ANTHROPIC_API_KEY' }, ['apiKeySource ANTHROPIC_API_KEY, expected none']],
    [{ skills: ['section-team:add-skill', 'brag'] }, ['skills differ from the pin (extra: brag; missing: tdd-workflow)']],
    [{ agents: ['general-purpose'] }, ['agents differ from the pin (extra: none; missing: section-team:backend)']],
  ]
  for (const [fields, expected] of cases) assert.deepEqual(initProblems(init(fields), ctx), expected, JSON.stringify(fields))
  // The control arm (base) is held to the same rules, from its own worktree.
  assert.deepEqual(initProblems(init(), { ...ctx, setup: 'base' }), [])
  assert.deepEqual(initProblems(init({ plugins: BUILTINS }), { ...ctx, setup: 'base' }), ['expected 1 section-team plugin, found 0'])
  assert.deepEqual(initProblems(null, ctx), ['no init message'])
  assert.deepEqual(initProblems(init(), { ...ctx, setup: 'max', pin: { ...PIN, setups: { solo: SOLO_LISTS } } }), ['the pin has no max setup'])
  assert.throws(() => initProblems(init(), { ...ctx, setup: 'forced' }), RangeError)
  assert.throws(() => initProblems(init(), { ...ctx, pin: undefined }), { message: 'initProblems needs a pin' })
  assert.throws(() => initProblems(init(), { setup: 'lean', pin: PIN }), { message: 'initProblems needs a pluginDir' })
  assert.throws(() => initProblems(init(), { setup: 'lean', pin: PIN, pluginDir: PLUGIN_DIR }), { message: 'initProblems needs a pluginVersion' })
})

// One harness measures 0.2.2 and 0.2.3: the version a builder must load is the plugin under test's, not a constant.
test('initProblems holds a builder to the plugin under test\'s version, and still to exactly one section-team from that path', () => {
  const ctx = { setup: 'team', pin: PIN, pluginDir: PLUGIN_DIR, pluginVersion: '0.2.3' }
  const at = version => init({ plugins: [...BUILTINS, { ...SECTION_TEAM, version }] })
  assert.deepEqual(initProblems(at('0.2.3'), ctx), [])
  assert.deepEqual(initProblems(at('0.2.1'), ctx), ['section-team version 0.2.1, expected 0.2.3'])
  assert.deepEqual(initProblems(init({ plugins: BUILTINS }), ctx), ['expected 1 section-team plugin, found 0'])
  const twice = { ...SECTION_TEAM, version: '0.2.3' }
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, twice, twice] }), ctx), ['expected 1 section-team plugin, found 2'])
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, { ...twice, path: 'C:\\Users\\Asus\\other' }] }), ctx), [`section-team path C:\\Users\\Asus\\other, expected ${PLUGIN_DIR}`])
})

test('pluginVersionOf refuses a plugin from before 0.2.0, whose sections read and write the real notes', t => {
  const plugin = join(tempRoot(t), 'plugin')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  const at = version => {
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ version }))
    return () => pluginVersionOf(plugin)
  }
  for (const old of ['0.1.1', '0.0.9']) assert.throws(at(old), { message: `section-team ${old} keeps section memory in ~/.claude/agent-memory, where a run would read and write your real notes: the harness runs 0.2.0 or later` })
  for (const ok of ['0.2.0', '0.2.3', '0.10.0', '1.0.0']) assert.equal(at(ok)(), ok)
})

test('pluginVersionOf reads the version from the plugin\'s manifest, and says in one line when it is missing or invalid', t => {
  const plugin = tempRoot(t)
  const manifest = join(plugin, '.claude-plugin', 'plugin.json')
  assert.throws(() => pluginVersionOf(plugin), { message: `cannot read the plugin version from ${manifest} (ENOENT)` })
  mkdirSync(dirname(manifest))
  for (const [text, why] of [['{"version":', 'SyntaxError'], ['[]', 'no version'], ['{"name":"section-team"}', 'no version'], ['{"version":3}', 'no version'], ['{"version":"latest"}', 'no version'], ['{"version":["0.2.3"]}', 'no version']]) {
    writeFileSync(manifest, text)
    assert.throws(() => pluginVersionOf(plugin), { message: `cannot read the plugin version from ${manifest} (${why})` }, text)
  }
  writeFileSync(manifest, JSON.stringify({ name: 'section-team', version: '0.2.3' }))
  assert.equal(pluginVersionOf(plugin), '0.2.3')
})

test('initProblems for solo and judge refuses section-team and anything from the live checkout, and judges use the solo lists', () => {
  const soloInit = init({ plugins: BUILTINS, ...SOLO_LISTS })
  for (const setup of ['solo', 'judge']) {
    assert.deepEqual(initProblems(soloInit, { setup, pin: PIN, pluginDir: PLUGIN_DIR }), [])
    assert.deepEqual(initProblems(init(SOLO_LISTS), { setup, pin: PIN, pluginDir: PLUGIN_DIR }), [`section-team loaded in ${setup}`])
  }
  const fromLive = { name: 'other', path: 'C:/Users/Asus/claude-team/plugins/other', source: 'other@builtin' }
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, fromLive], ...SOLO_LISTS }), { setup: 'solo', pin: { version: '2.1.296', liveCheckouts: [LIVE_CHECKOUT] } }),
    ['loaded from the live checkout C:/Users/Asus/claude-team: other@builtin'])
})

test('initProblems in preflight mode accepts only @builtin sources and refuses plugin-authoring', () => {
  const ctx = { setup: 'lean', pin: { version: '2.1.296' }, pluginDir: PLUGIN_DIR, pluginVersion: '0.2.1' }
  // Without pin lists and apiKeySource, those are recorded, not compared.
  assert.deepEqual(initProblems(init({ agents: ['any'], skills: [], apiKeySource: 'other' }), ctx), [])
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, { name: 'x', path: 'builtin', source: 'x@builtin' }, SECTION_TEAM] }), ctx), [])
  const stray = { name: 'caveman', path: 'C:/c', source: 'caveman@caveman' }
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, SECTION_TEAM, stray] }), ctx), ['plugins that are not built-ins: caveman@caveman'])
  const authoring = { name: 'cc-plugin-plugin-authoring', path: 'builtin', source: 'cc-plugin-plugin-authoring@builtin' }
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, SECTION_TEAM, authoring] }), ctx), ['cc-plugin-plugin-authoring@builtin is loaded'])
  assert.deepEqual(initProblems(init({ plugins: BUILTINS }), { ...ctx, setup: 'solo' }), [])
  assert.deepEqual(initProblems(init({ plugins: undefined }), { ...ctx, setup: 'solo' }), ['the init has no plugins list'])
  assert.deepEqual(initProblems(init({ claude_code_version: '2.1.300' }), ctx), ['claude_code_version 2.1.300, expected 2.1.296'])
})

test('effortProblems flags a high-effort assistant line', () => {
  const session = jsonl([
    { type: 'user', message: { content: 'go' } },
    { type: 'assistant', effort: 'medium', message: { model: BENCH_MODEL } },
    // Synthetic messages (an API error, say) record no effort.
    { type: 'assistant', message: { model: '<synthetic>' } },
  ])
  const subagent = `${jsonl([
    { type: 'assistant', effort: 'high', message: { model: BENCH_MODEL } },
    { type: 'assistant', effort: 'high', message: { model: BENCH_MODEL } },
    { type: 'user', effort: 'low' },
  ]).replaceAll('\n', '\r\n')}\r\n{"type":"assistant","effort":"xh`
  assert.deepEqual(effortProblems([session]), [])
  assert.deepEqual(effortProblems([session, subagent]), ['assistant effort high, expected medium'])
  assert.deepEqual(effortProblems([session], 'xhigh'), ['assistant effort medium, expected xhigh'])
  assert.throws(() => effortProblems([session, undefined]), TypeError)
})

test('effortProblems reports no effort recorded when no assistant line records one', () => {
  const real = { type: 'assistant', message: { model: BENCH_MODEL } }
  const synthetic = { type: 'assistant', message: { model: '<synthetic>' } }
  assert.deepEqual(effortProblems([jsonl([real, synthetic]), jsonl([real])]), ['no effort recorded'])
  // One line recording the effort is enough: other lines without one are skipped.
  assert.deepEqual(effortProblems([jsonl([real]), jsonl([{ ...real, effort: 'medium' }])]), [])
  // With no non-synthetic assistant line there is nothing to check.
  assert.deepEqual(effortProblems([jsonl([synthetic, { type: 'user' }])]), [])
})

// Round tk: the advisor reached runs through the user's advisorModel. Either sign voids the attempt, in any transcript.
test('advisorProblems flags an advisor offered to the model or called, in the session or a subagent', () => {
  const clean = jsonl([{ type: 'user', message: { content: 'the advisor tool, # Advisor Tool, in plain text' } }, { type: 'assistant', effort: 'medium', message: { model: BENCH_MODEL, content: [{ type: 'text', text: 'advisor' }] } }])
  const offered = jsonl([{ type: 'attachment', attachment: { type: 'advisor_tool', available: true, model: 'claude-fable-5-1', toolChange: 'add' } }])
  const withdrawn = jsonl([{ type: 'attachment', attachment: { type: 'advisor_tool', available: false, toolChange: 'remove' } }])
  const call = id => ({ type: 'assistant', message: { model: BENCH_MODEL, content: [{ type: 'server_tool_use', id, name: 'advisor', input: {} }] } })
  // A streamed message repeats its blocks on several lines: one call is counted once.
  const called = `${jsonl([call('srvtoolu_1'), call('srvtoolu_1'), call('srvtoolu_2')])}\r\n{"type":"assistant","mess`
  assert.deepEqual(advisorProblems([clean]), [])
  assert.deepEqual(advisorProblems([clean, withdrawn]), [])
  assert.deepEqual(advisorProblems([clean, offered]), ['advisor tool offered (claude-fable-5-1)'])
  assert.deepEqual(advisorProblems([called, clean]), ['advisor called 2 times'])
  // Calls without an id each count; one call reads "1 time".
  assert.deepEqual(advisorProblems([jsonl([call(undefined), call(undefined), call(undefined)])]), ['advisor called 3 times'])
  assert.deepEqual(advisorProblems([jsonl([call('srvtoolu_9')])]), ['advisor called 1 time'])
  assert.deepEqual(advisorProblems([offered, called]), ['advisor tool offered (claude-fable-5-1)', 'advisor called 2 times'])
  // Rounds up to tj sent a deferred advisor definition in every request; CLAUDE_CODE_DISABLE_ADVISOR_TOOL=1 removes it,
  // so a definition left in a request means the switch did not reach claude.
  // The shape of a real line (round tj, claude 2.1.318): api-request-shape with shape.tools.
  const defined = jsonl([{
    type: 'api-request-shape', sessionId: 'sid', agentId: 'a1', shapeHash: 'h', timestamp: '2026-11-15T10:00:00.000Z', version: '2.1.318',
    shape: { system: [{ type: 'text', text: 'x' }], tools: [{ name: 'Bash', description: 'd', input_schema: {}, eager_input_streaming: true }, { type: 'advisor_20260301', name: 'advisor', model: 'claude-opus-5-5', defer_loading: true }] },
  }])
  assert.deepEqual(advisorProblems([clean, defined]), ['advisor tool defined'])
  assert.deepEqual(advisorProblems([jsonl([{ tools: [{ type: 'custom', name: 'advisor' }, { type: 'advisor_20260301', name: 'reviewer' }] }])]), [], 'both the advisor_ type and the name are needed')
  assert.throws(() => advisorProblems([clean, undefined]), TypeError)
  assert.throws(() => advisorProblems(clean), TypeError)
})

test('effortProblems reports nothing when only <synthetic> lines lack effort', () => {
  const medium = { type: 'assistant', effort: 'medium', message: { model: BENCH_MODEL } }
  const synthetic = { type: 'assistant', message: { model: '<synthetic>' } }
  assert.deepEqual(effortProblems([jsonl([medium, synthetic]), jsonl([synthetic, medium])]), [])
})

test('compacted finds a compact_boundary line', () => {
  const boundary = { type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto' } }
  const user = { type: 'user', message: { content: JSON.stringify(boundary) } }
  assert.equal(compacted(jsonl([user, boundary])), true)
  assert.equal(compacted(jsonl([user, init()])), false)
  assert.equal(compacted(`${JSON.stringify(user)}\n{"type":"system","subtype":"compact_boun`), false)
  assert.equal(compacted(''), false)
  // A missing transcript is an error, not "not compacted".
  assert.throws(() => compacted(undefined), { name: 'TypeError', message: 'compacted takes a transcript text' })
})

test('installedPluginKeys fails with the path on a bad file', t => {
  const home = tempRoot(t)
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json')
  assert.throws(() => installedPluginKeys(home, { platform: 'win32' }), { message: `cannot read installed plugins: ${file} (ENOENT)` })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '{ "version": 2, "plugins": ')
  assert.throws(() => installedPluginKeys(home), { message: `cannot read installed plugins: ${file} (SyntaxError)` })
  writeFileSync(file, JSON.stringify({ version: 2, plugins: [] }))
  assert.throws(() => installedPluginKeys(home), { message: `cannot read installed plugins: ${file} (no plugins object)` })
  writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'caveman@caveman': [{ scope: 'user' }], 'ponytail@ponytail': [] } }))
  assert.deepEqual(installedPluginKeys(home), ['caveman@caveman', 'ponytail@ponytail'])
})

// A clean Linux home (the cloud machine) has never installed a plugin, so it has no installed_plugins.json: no keys.
// Windows keeps refusing a missing file. Only a missing file counts; a bad one still fails on every platform.
test('installedPluginKeys on Linux reads a missing file as no installed plugins', t => {
  const home = tempRoot(t)
  assert.deepEqual(installedPluginKeys(home, { platform: 'linux' }), [])
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '{')
  assert.throws(() => installedPluginKeys(home, { platform: 'linux' }), { message: `cannot read installed plugins: ${file} (SyntaxError)` })
})

// On Linux the harness's own checkout is the live checkout: the plugin files in it are the user's, not the pinned worktree.
test('liveCheckouts: the named live checkout everywhere, plus this checkout on Linux', () => {
  const repo = dirname(import.meta.dirname)
  assert.deepEqual(liveCheckouts('win32', LIVE_CHECKOUT), [LIVE_CHECKOUT])
  assert.deepEqual(liveCheckouts('linux', LIVE_CHECKOUT), [LIVE_CHECKOUT, repo])
  assert.deepEqual(liveCheckouts('linux', null), [repo])
  assert.deepEqual(liveCheckouts('win32', null), [])
})

// The live checkout is the user's, so the repo names no default: SECTION_TEAM_LIVE_CHECKOUT is required on Windows.
test('liveCheckoutOf reads SECTION_TEAM_LIVE_CHECKOUT, required and absolute on Windows, optional on Linux', () => {
  assert.equal(liveCheckoutOf({ SECTION_TEAM_LIVE_CHECKOUT: 'D:/me/section-team' }, 'win32'), 'D:/me/section-team')
  assert.equal(liveCheckoutOf({ SECTION_TEAM_LIVE_CHECKOUT: '/home/me/section-team' }, 'linux'), '/home/me/section-team')
  assert.equal(liveCheckoutOf({}, 'linux'), null)
  const missing = /set SECTION_TEAM_LIVE_CHECKOUT to the absolute path of your own section-team checkout/
  for (const env of [{}, { SECTION_TEAM_LIVE_CHECKOUT: '' }]) assert.throws(() => liveCheckoutOf(env, 'win32'), { message: missing })
  assert.throws(() => liveCheckoutOf({ SECTION_TEAM_LIVE_CHECKOUT: 'claude-team' }, 'win32'), { message: 'SECTION_TEAM_LIVE_CHECKOUT takes an absolute path, got "claude-team"' })
})

test('checkLiveCheckout refuses a plugin worktree that is the live checkout or inside it', () => {
  const live = 'D:/me/claude-team'
  assert.doesNotThrow(() => checkLiveCheckout(live, ['D:/me/claude-team-cloud/wt/v0.5.1', 'E:/claude-team']))
  assert.doesNotThrow(() => checkLiveCheckout(null, [live]))
  for (const worktree of [live, 'D:\\me\\Claude-Team', 'D:/me/claude-team/.claude/worktrees/rc']) {
    assert.throws(() => checkLiveCheckout(live, ['C:/elsewhere', worktree]),
      { message: `${worktree} is the live checkout ${live} (SECTION_TEAM_LIVE_CHECKOUT) or inside it: a round loads the plugin from a worktree outside it` }, worktree)
  }
})

// The plugin's memory guard reads SECTION_TEAM_MEMORY_LIMIT_MB; the strip removes every SECTION_TEAM_ variable, so the
// round's value is set again after it, in the environment and in --settings, for every setup alike.
test('memoryLimitOf takes a plain whole number of megabytes, or nothing', () => {
  assert.equal(memoryLimitOf({ SECTION_TEAM_MEMORY_LIMIT_MB: '12288' }), '12288')
  for (const env of [{}, { SECTION_TEAM_MEMORY_LIMIT_MB: '' }]) assert.equal(memoryLimitOf(env), null)
  for (const bad of ['0', '12GB', '12288 ', '12,288', '-1', '1.5', '012288']) {
    assert.throws(() => memoryLimitOf({ SECTION_TEAM_MEMORY_LIMIT_MB: bad }),
      { name: 'RangeError', message: `SECTION_TEAM_MEMORY_LIMIT_MB takes a whole number of megabytes such as 12288, got "${bad}"` }, bad)
  }
})

test('childEnv sets the round\'s memory limit and config dir after the strip, whatever the parent set', () => {
  const parent = { PATH: '/bin', SECTION_TEAM_MEMORY_LIMIT_MB: '999', CLAUDE_CONFIG_DIR: 'C:/Users/me/.claude', claude_config_dir: 'x' }
  const child = childEnv(parent, { pluginDir: 'C:/w', memoryLimitMb: '12288', configDir: 'C:/bench-profile-nx' })
  assert.equal(child.SECTION_TEAM_MEMORY_LIMIT_MB, '12288')
  assert.equal(child.CLAUDE_CONFIG_DIR, 'C:/bench-profile-nx')
  assert.deepEqual(Object.keys(child).filter(name => /^claude_config_dir$/i.test(name)), ['CLAUDE_CONFIG_DIR'])
  const plain = childEnv(parent, { pluginDir: 'C:/w' })
  assert.equal('SECTION_TEAM_MEMORY_LIMIT_MB' in plain, false, 'without a round limit the parent\'s is stripped')
  assert.equal('CLAUDE_CONFIG_DIR' in plain, false, 'without a config dir the parent\'s is stripped')
  const settings = cleanSettings({ installedKeys: [], sectionTeam: true, pluginDir: 'C:/w', memoryLimitMb: '12288' })
  assert.equal(settings.env.SECTION_TEAM_MEMORY_LIMIT_MB, '12288')
  assert.equal('CLAUDE_CONFIG_DIR' in settings.env, false, 'the config dir goes in the environment only')
  assert.equal('SECTION_TEAM_MEMORY_LIMIT_MB' in cleanSettings({ installedKeys: [], sectionTeam: true, pluginDir: 'C:/w' }).env, false)
})

// The default ref only serves pins from before --plugin-ref, which name no ref of their own (the mode round's).
test('SECTION_TEAM_VERSION stays the mode round\'s tag', () => {
  assert.equal(SECTION_TEAM_VERSION, '0.2.1')
})

// A fresh profile (CLAUDE_CONFIG_DIR) has never installed a plugin: its keys come from that folder, and a missing file is none.
test('installedPluginKeys reads a config dir\'s installed plugins, and a missing file there as none, on Windows too', t => {
  const home = tempRoot(t)
  const configDir = join(home, 'profile')
  assert.deepEqual(installedPluginKeys(home, { platform: 'win32', configDir }), [])
  const file = join(configDir, 'plugins', 'installed_plugins.json')
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'caveman@caveman': [] } }))
  assert.deepEqual(installedPluginKeys(home, { platform: 'win32', configDir }), ['caveman@caveman'])
  writeFileSync(file, '{')
  assert.throws(() => installedPluginKeys(home, { platform: 'win32', configDir }), { message: `cannot read installed plugins: ${file} (SyntaxError)` })
})

const LINUX_PLUGIN_DIR = '/root/section-team-v0.2.1'
const LINUX_SECTION_TEAM = { ...SECTION_TEAM, path: LINUX_PLUGIN_DIR }

test('initProblems accepts a Linux worktree path and compares it case for case', { skip: process.platform === 'win32' && 'Linux paths' }, () => {
  const linuxInit = init({ plugins: [...BUILTINS, LINUX_SECTION_TEAM] })
  const pin = { ...PIN, pluginDir: LINUX_PLUGIN_DIR }
  assert.deepEqual(initProblems(linuxInit, { setup: 'team', pin, pluginDir: LINUX_PLUGIN_DIR, pluginVersion: '0.2.1' }), [])
  assert.deepEqual(initProblems(linuxInit, { setup: 'team', pin, pluginDir: `${LINUX_PLUGIN_DIR}/`, pluginVersion: '0.2.1' }), [])
  assert.deepEqual(initProblems(linuxInit, { setup: 'team', pin, pluginDir: '/root/Section-Team-v0.2.1', pluginVersion: '0.2.1' }),
    [`section-team path ${LINUX_PLUGIN_DIR}, expected /root/Section-Team-v0.2.1`])
})

test('initProblems on Linux refuses a plugin loaded from this checkout, the live one there', { skip: process.platform === 'win32' && 'Linux paths' }, () => {
  const repo = dirname(import.meta.dirname)
  const fromRepo = { name: 'section-team', path: repo, source: 'section-team@local', version: '0.2.1' }
  const solo = init({ plugins: [...BUILTINS, fromRepo], ...SOLO_LISTS })
  assert.deepEqual(initProblems(solo, { setup: 'solo', pin: PIN, pluginDir: LINUX_PLUGIN_DIR }), [
    `loaded from the live checkout ${repo}: section-team@local`,
    'plugins differ from the pin (extra: section-team@local; missing: none)',
  ])
})

// SECTION_TEAM_LIVE_CHECKOUT for one test, restored (or removed) after it.
function withLiveEnv(t, value) {
  const before = process.env.SECTION_TEAM_LIVE_CHECKOUT
  t.after(() => {
    if (before === undefined) delete process.env.SECTION_TEAM_LIVE_CHECKOUT
    else process.env.SECTION_TEAM_LIVE_CHECKOUT = before
  })
  process.env.SECTION_TEAM_LIVE_CHECKOUT = value
}

// A pin restored on another machine names the first machine's checkout: this machine's is checked too.
test('initProblems checks the live checkout this process knows as well as the pin\'s', t => {
  const root = tempRoot(t)
  const envLive = join(root, 'env-live')
  withLiveEnv(t, envLive)
  const fromEnv = { name: 'other', path: join(envLive, 'plugins', 'other'), source: 'other@builtin' }
  const pin = { version: '2.1.296', liveCheckouts: [join(root, 'pinned')] }
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, fromEnv], ...SOLO_LISTS }), { setup: 'solo', pin }),
    [`loaded from the live checkout ${envLive}: other@builtin`])
})

test('initProblems names a live checkout once when the pin and the environment both name it', t => {
  const pinned = join(tempRoot(t), 'live')
  withLiveEnv(t, `${pinned}/`)
  const fromLive = { name: 'other', path: join(pinned, 'plugins', 'other'), source: 'other@builtin' }
  const pin = { version: '2.1.296', liveCheckouts: [pinned] }
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, fromLive], ...SOLO_LISTS }), { setup: 'solo', pin }),
    [`loaded from the live checkout ${pinned}: other@builtin`])
})

test('readPin reads the round pin and names the preflight command when it is missing', t => {
  const results = tempRoot(t)
  const file = join(results, 'preflight-mo.json')
  assert.throws(() => readPin(results, 'mo'), { message: `missing ${file}: run node bench/preflight.mjs --round=mo first` })
  writeFileSync(file, '{')
  assert.throws(() => readPin(results, 'mo'), { message: `cannot read ${file} (SyntaxError)` })
  for (const text of ['null', '[]']) {
    writeFileSync(file, text)
    assert.throws(() => readPin(results, 'mo'), { message: `cannot read ${file} (no pin object)` })
  }
  for (const binary of [undefined, '', 42]) {
    writeFileSync(file, JSON.stringify({ ...PIN, binary }))
    assert.throws(() => readPin(results, 'mo'), { message: 'the round mo pin names no binary: run node bench/preflight.mjs --round=mo again' })
  }
  writeFileSync(file, JSON.stringify(PIN))
  assert.deepEqual(readPin(results, 'mo'), PIN)
})

test('commonArgs on a resume names the session with --resume and never --session-id', () => {
  assert.deepEqual(commonArgs({ sessionId: 'abc', resume: true }),
    ['--model', BENCH_MODEL, '--effort', BENCH_EFFORT, '--verbose', '--strict-mcp-config', '--resume', 'abc'])
  assert.throws(() => commonArgs({ resume: true }), { message: 'commonArgs needs a sessionId' })
})
