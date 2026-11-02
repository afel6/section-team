import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  BENCH_EFFORT, BENCH_MODEL, LIVE_CHECKOUT, PLUGIN_KEY, SECTION_TEAM_VERSION, childEnv, cleanSettings, commonArgs, compacted,
  effortProblems, envNames, initOf, initProblems, installedPluginKeys, isUnder, outputMessages, readPin, resultOf,
} from './clean-run.mjs'

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
  setups: { solo: SOLO_LISTS, lean: TEAM_LISTS, team: TEAM_LISTS, max: TEAM_LISTS },
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
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
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
    ['CLAUDE_CODE_PLUGIN_DIRS', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'DISABLE_AUTOUPDATER', 'ENABLE_CLAUDEAI_MCP_SERVERS', 'SECTION_TEAM_AUTO_INSTALL_SKILLS'])
  assert.deepEqual(envNames({ PATH: 'p', CLAUDECODE: '1', ANTHROPIC_MODEL: 'm' }), ['ANTHROPIC_MODEL', 'CLAUDECODE'])
})

test('cleanSettings: every installed key and plugin-authoring off, synced off, section-team per setup, plugin dir always set', () => {
  const installedKeys = ['caveman@caveman', 'ponytail@ponytail']
  const env = {
    SECTION_TEAM_AUTO_INSTALL_SKILLS: '0', DISABLE_AUTOUPDATER: '1', ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_PLUGIN_DIRS: PLUGIN_DIR,
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
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
  assert.deepEqual([PLUGIN_KEY, BENCH_MODEL, BENCH_EFFORT, SECTION_TEAM_VERSION, LIVE_CHECKOUT],
    ['section-team@inline', 'claude-opus-5-5', 'medium', '0.2.1', 'C:/Users/Asus/claude-team'])
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
  const ctx = { setup: 'team', pin: PIN, pluginDir: PLUGIN_DIR }
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
  assert.deepEqual(initProblems(null, ctx), ['no init message'])
  assert.deepEqual(initProblems(init(), { ...ctx, setup: 'max', pin: { ...PIN, setups: { solo: SOLO_LISTS } } }), ['the pin has no max setup'])
  assert.throws(() => initProblems(init(), { ...ctx, setup: 'forced' }), RangeError)
  assert.throws(() => initProblems(init(), { ...ctx, pin: undefined }), { message: 'initProblems needs a pin' })
  assert.throws(() => initProblems(init(), { setup: 'lean', pin: PIN }), { message: 'initProblems needs a pluginDir' })
})

test('initProblems for solo and judge refuses section-team and anything from the live checkout, and judges use the solo lists', () => {
  const soloInit = init({ plugins: BUILTINS, ...SOLO_LISTS })
  for (const setup of ['solo', 'judge']) {
    assert.deepEqual(initProblems(soloInit, { setup, pin: PIN, pluginDir: PLUGIN_DIR }), [])
    assert.deepEqual(initProblems(init(SOLO_LISTS), { setup, pin: PIN, pluginDir: PLUGIN_DIR }), [`section-team loaded in ${setup}`])
  }
  const fromLive = { name: 'other', path: 'C:/Users/Asus/claude-team/plugins/other', source: 'other@builtin' }
  assert.deepEqual(initProblems(init({ plugins: [...BUILTINS, fromLive], ...SOLO_LISTS }), { setup: 'solo', pin: { version: '2.1.296' } }),
    ['loaded from the live checkout C:/Users/Asus/claude-team: other@builtin'])
})

test('initProblems in preflight mode accepts only @builtin sources and refuses plugin-authoring', () => {
  const ctx = { setup: 'lean', pin: { version: '2.1.296' }, pluginDir: PLUGIN_DIR }
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
  assert.throws(() => installedPluginKeys(home), { message: `cannot read installed plugins: ${file} (ENOENT)` })
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '{ "version": 2, "plugins": ')
  assert.throws(() => installedPluginKeys(home), { message: `cannot read installed plugins: ${file} (SyntaxError)` })
  writeFileSync(file, JSON.stringify({ version: 2, plugins: [] }))
  assert.throws(() => installedPluginKeys(home), { message: `cannot read installed plugins: ${file} (no plugins object)` })
  writeFileSync(file, JSON.stringify({ version: 2, plugins: { 'caveman@caveman': [{ scope: 'user' }], 'ponytail@ponytail': [] } }))
  assert.deepEqual(installedPluginKeys(home), ['caveman@caveman', 'ponytail@ponytail'])
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
