// The plugin under test: --plugin-ref, the worktree checks and a batch's hold to its pin; run.test.mjs has the rest of run.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { SECTION_TEAM_VERSION } from './clean-run.mjs'
import { tempRoot } from './run-fixtures.mjs'
import { DEFAULT_PLUGIN_REF, batchPlugin, checkPluginWorktree, parseArgs, pinnedTarget, pluginCommitOf } from './run.mjs'

test('parseArgs reads --plugin-ref, empty when it is not passed, and refuses what is not a git ref', () => {
  assert.equal(parseArgs([]).pluginRef, '')
  for (const ref of ['v0.2.2', 'fix/fresh-section-per-job', 'eaee8fd']) assert.equal(parseArgs([`--plugin-ref=${ref}`]).pluginRef, ref)
  for (const bad of ['', '--output=x', '-x', 'a b', 'a;b', 'HEAD~1']) {
    assert.throws(() => parseArgs([`--plugin-ref=${bad}`]), { name: 'RangeError', message: `--plugin-ref takes a branch, tag or commit, got "${bad}"` })
  }
})

test('pluginCommitOf with the real git says in one line that a worktree does not exist', t => {
  const missing = join(tempRoot(t), 'no-such-worktree')
  assert.throws(() => pluginCommitOf(missing), err => {
    assert.match(err.message, /^git -C .*no-such-worktree rev-parse HEAD failed: fatal: /)
    assert.doesNotMatch(err.message, /\n/)
    return true
  })
})

test('pluginCommitOf refuses a missing or relative --plugin and a worktree not at v0.2.1, and returns its commit', () => {
  const worktree = join(tmpdir(), 'section-team-v0.2.1')
  const calls = []
  const gitWith = ({ head, tagged }) => args => { calls.push(args); return args.includes('HEAD') ? head : tagged }
  for (const bad of ['', 'section-team-v0.2.1', './w']) {
    assert.throws(() => pluginCommitOf(bad, { git: gitWith({}) }), { message: `--plugin= takes the absolute path of the v0.2.1 worktree, got "${bad}"` })
  }
  assert.deepEqual(calls, [], 'refused before any git call')
  assert.throws(() => pluginCommitOf(worktree, { git: gitWith({ head: 'aaa', tagged: 'bbb' }) }), { message: `${worktree} is at aaa, not at v0.2.1 (bbb)` })
  calls.length = 0
  assert.equal(pluginCommitOf(worktree, { git: gitWith({ head: 'bbb', tagged: 'bbb' }) }), 'bbb')
  assert.deepEqual(calls, [['-C', worktree, 'rev-parse', 'HEAD'], ['rev-parse', 'v0.2.1^{commit}']])
})

test('the default plugin ref stays the tag of the round version', () => {
  assert.equal(DEFAULT_PLUGIN_REF, `v${SECTION_TEAM_VERSION}`)
})

test('pluginCommitOf and checkPluginWorktree use a passed ref and name it', () => {
  const top = 'C:/Users/Asus/section-team-next'
  const calls = []
  const gitWith = ({ head = 'bbb', status = '', diff = '' } = {}) => args => {
    calls.push(args)
    if (args.includes('--show-toplevel')) return top
    if (args.includes('HEAD')) return head
    if (args.includes('status')) return status
    return args.includes('diff') ? diff : 'bbb'
  }
  const ref = 'fix/fresh'
  assert.equal(pluginCommitOf(top, { ref, git: gitWith() }), 'bbb')
  assert.doesNotThrow(() => checkPluginWorktree(top, { ref, git: gitWith() }))
  assert.deepEqual(calls.filter(args => args.includes('rev-parse') && !args.includes('--show-toplevel') && !args.includes('HEAD')), [['rev-parse', 'fix/fresh^{commit}']])
  assert.deepEqual(calls.at(-1), ['-C', top, 'diff', '--stat', 'fix/fresh'])
  assert.throws(() => pluginCommitOf('relative', { ref, git: gitWith() }), { message: '--plugin= takes the absolute path of the fix/fresh worktree, got "relative"' })
  assert.throws(() => pluginCommitOf(top, { ref, git: gitWith({ head: 'aaa' }) }), { message: `${top} is at aaa, not at fix/fresh (bbb)` })
  assert.throws(() => checkPluginWorktree(top, { ref, git: gitWith({ status: '?? x' }) }), { message: `${top} has uncommitted changes: a batch needs a clean fix/fresh worktree` })
  assert.throws(() => checkPluginWorktree(top, { ref, git: gitWith({ diff: ' x | 1 +' }) }), { message: `${top} differs from fix/fresh: a batch needs a clean fix/fresh worktree` })
})

// The harness runs from this checkout; the plugin under test comes from a worktree of its own. Before --plugin-ref the
// commit check caught this; a branch ref would let it through.
test('checkPluginWorktree refuses this checkout, which runs the harness, before any git call', () => {
  const here = dirname(import.meta.dirname)
  assert.throws(() => checkPluginWorktree(here, { ref: 'fix/fresh', git: () => assert.fail('git ran') }),
    { message: `--plugin= must be a worktree of fix/fresh apart from this checkout, which runs the harness: got ${here}` })
})

test('pinnedTarget: a pin from before --plugin-ref means the default tag, a newer pin its commit under its ref\'s name, and a passed ref must be the pin\'s', () => {
  const tag = { ref: DEFAULT_PLUGIN_REF, name: DEFAULT_PLUGIN_REF }
  assert.deepEqual(pinnedTarget({}), tag)
  assert.deepEqual(pinnedTarget({}, DEFAULT_PLUGIN_REF), tag)
  const pin = { pluginRef: 'fix/fresh', pluginCommit: 'c0ffee1' }
  const target = { ref: 'c0ffee1', name: 'fix/fresh' }
  assert.deepEqual(pinnedTarget(pin), target, 'the pinned commit: a branch that moves after the preflight must not stop the round')
  assert.deepEqual(pinnedTarget(pin, 'fix/fresh'), target)
  assert.throws(() => pinnedTarget(pin, 'v0.2.2'), { message: '--plugin-ref=v0.2.2 is not the ref the round pinned: pass --plugin-ref=fix/fresh or leave it out' })
  assert.throws(() => pinnedTarget({}, 'v0.2.2'), { message: `--plugin-ref=v0.2.2 is not the ref the round pinned: pass --plugin-ref=${DEFAULT_PLUGIN_REF} or leave it out` })
})

test('batchPlugin checks the worktree against the pin, refuses a different ref, and gives the commit and the manifest\'s version', t => {
  const root = tempRoot(t)
  const binary = join(root, 'claude.exe')
  writeFileSync(binary, 'claude bytes')
  const plugin = 'C:/Users/Asus/section-team-next'
  const pin = { binary, sha256: createHash('sha256').update('claude bytes').digest('hex'), pluginDir: plugin, pluginRef: 'fix/fresh', pluginCommit: 'pinned' }
  const gitAt = head => args => {
    if (args.includes('--show-toplevel')) return plugin
    if (args.includes('HEAD')) return head
    if (args.includes('rev-parse')) return args.at(-1).replace('^{commit}', '')
    return ''
  }
  const readVersion = () => '0.2.3'
  assert.deepEqual(batchPlugin(plugin, pin, '', { git: gitAt('pinned'), readVersion }), { pluginCommit: 'pinned', pluginVersion: '0.2.3' })
  assert.deepEqual(batchPlugin(plugin, pin, 'fix/fresh', { git: gitAt('pinned'), readVersion }), { pluginCommit: 'pinned', pluginVersion: '0.2.3' })
  assert.throws(() => batchPlugin(plugin, pin, 'v0.2.2', { git: () => assert.fail('git ran'), readVersion }), { message: '--plugin-ref=v0.2.2 is not the ref the round pinned: pass --plugin-ref=fix/fresh or leave it out' })
  assert.throws(() => batchPlugin(plugin, pin, '', { git: gitAt('moved'), readVersion }), { message: `${plugin} is at moved, not at fix/fresh (pinned)` })
  assert.throws(() => batchPlugin('relative', pin, '', { git: gitAt('pinned'), readVersion }), { message: '--plugin= takes the absolute path of the fix/fresh worktree, got "relative"' })
  assert.throws(() => batchPlugin('C:/other', pin, '', { git: args => (args.includes('--show-toplevel') ? 'C:/other' : gitAt('pinned')(args)), readVersion }), { message: `--plugin=C:/other is not the worktree the round pinned: pass --plugin=${plugin}` })
})

// The commit stays what is enforced: the ref alone would say a worktree on the branch's new tip "differs from fix/fresh".
test('a batch\'s worktree messages name the pin\'s ref with its commit in brackets, and git compares against the commit', () => {
  const plugin = 'C:/Users/Asus/section-team-next'
  const pin = { pluginDir: plugin, pluginRef: 'fix/fresh', pluginCommit: 'pinned' }
  const readVersion = () => assert.fail('the worktree check comes first')
  const calls = []
  const gitWith = ({ status = '', diff = '' }) => args => {
    calls.push(args)
    if (args.includes('--show-toplevel')) return plugin
    if (args.includes('status')) return status
    return args.includes('diff') ? diff : 'pinned'
  }
  assert.throws(() => batchPlugin(plugin, pin, '', { git: gitWith({ status: '?? x' }), readVersion }), { message: `${plugin} has uncommitted changes: a batch needs a clean fix/fresh (pinned) worktree` })
  assert.throws(() => batchPlugin(plugin, pin, '', { git: gitWith({ diff: ' x | 1 +' }), readVersion }), { message: `${plugin} differs from fix/fresh (pinned): a batch needs a clean fix/fresh (pinned) worktree` })
  assert.deepEqual(calls.filter(args => args.includes('--stat') || args.at(-1).endsWith('^{commit}')).slice(-2), [['rev-parse', 'pinned^{commit}'], ['-C', plugin, 'diff', '--stat', 'pinned']])
})

test('a pin from before --plugin-ref keeps the default tag in a batch\'s messages', () => {
  const plugin = 'C:/Users/Asus/section-team-next'
  const git = args => (args.includes('HEAD') ? 'moved' : 'tagged')
  assert.throws(() => batchPlugin(plugin, { pluginDir: plugin }, '', { git, readVersion: () => assert.fail('never read') }), { message: `${plugin} is at moved, not at ${DEFAULT_PLUGIN_REF} (tagged)` })
})

test('checkPluginWorktree accepts the clean worktree root, whatever its slashes or case', () => {
  const calls = []
  const plugin = 'C:\\Users\\Asus\\Section-Team-v0.2.1\\'
  const git = args => { calls.push(args); return args.includes('--show-toplevel') ? 'C:/Users/Asus/section-team-v0.2.1' : '' }
  assert.doesNotThrow(() => checkPluginWorktree(plugin, { git }))
  assert.deepEqual(calls, [['-C', plugin, 'rev-parse', '--show-toplevel'], ['-C', plugin, 'status', '--porcelain'], ['-C', plugin, 'diff', '--stat', 'v0.2.1']])
})

test('pluginCommitOf and checkPluginWorktree take a Linux worktree path and compare it case for case', { skip: process.platform === 'win32' && 'Linux paths' }, () => {
  const top = '/root/section-team-v0.2.1'
  const git = args => (args.includes('--show-toplevel') ? top : args.includes('HEAD') || args.includes('v0.2.1^{commit}') ? 'bbb' : '')
  assert.equal(pluginCommitOf(top, { git }), 'bbb')
  assert.throws(() => pluginCommitOf('\\rooted', { git }), { message: '--plugin= takes the absolute path of the v0.2.1 worktree, got "\\rooted"' })
  assert.doesNotThrow(() => checkPluginWorktree(`${top}/`, { git }))
  assert.throws(() => checkPluginWorktree('/root/Section-Team-v0.2.1', { git }),
    { message: `--plugin= must be the worktree's root folder ${top}, got /root/Section-Team-v0.2.1` })
})

test('checkPluginWorktree refuses a subfolder, uncommitted changes and a diff from v0.2.1, in one line each', () => {
  const top = 'C:/Users/Asus/section-team-v0.2.1'
  const gitWith = ({ status = '', diff = '' }) => args => (args.includes('--show-toplevel') ? top : args.includes('status') ? status : diff)
  const cases = [
    [`${top}/agents`, {}, `--plugin= must be the worktree's root folder ${top}, got ${top}/agents`],
    [top, { status: '?? stray.md' }, `${top} has uncommitted changes: a batch needs a clean v0.2.1 worktree`],
    [top, { diff: ' agents/backend.md | 2 +-' }, `${top} differs from v0.2.1: a batch needs a clean v0.2.1 worktree`],
  ]
  for (const [plugin, out, message] of cases) assert.throws(() => checkPluginWorktree(plugin, { git: gitWith(out) }), { message }, message)
})

// main's wiring, through the real command lines, on paths that refuse before any paid call. Nothing could reach claude
// even if they did not refuse: no PATH to find it on, a home with no CLI in it, no API key and a pinned binary that does
// not exist. A regression can only fail the test.
function refusingCli(t) {
  const home = tempRoot(t)
  const bare = join(home, 'empty-path')
  const results = join(home, 'results')
  mkdirSync(bare)
  mkdirSync(results)
  mkdirSync(join(home, '.claude', 'plugins'), { recursive: true })
  writeFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), '{"plugins":{}}')
  const env = { PATH: bare, HOME: home, USERPROFILE: home, SystemRoot: process.env.SystemRoot, BENCH_RESULTS: results }
  const run = (script, ...args) => spawnSync(process.execPath, [join(import.meta.dirname, script), ...args], { cwd: home, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  return { home, results, run }
}

const uniqueRound = () => `clitest${randomBytes(4).toString('hex')}`

// run.mjs reads its pin from the results folder BENCH_RESULTS names: a temp one, so these tests never touch bench/results.
function tempPin(results, fields) {
  const round = uniqueRound()
  writeFileSync(join(results, `preflight-${round}.json`), JSON.stringify(fields))
  return round
}

test('preflight.mjs with a relative --plugin says the --plugin-ref it was given and exits 1, writing no pin', t => {
  const { results, run } = refusingCli(t)
  const round = uniqueRound()
  const res = run('preflight.mjs', `--round=${round}`, '--plugin=relative/worktree', '--plugin-ref=fix/x', '--no-sync')
  assert.deepEqual([res.status, res.stdout, res.stderr], [1, '', 'preflight: --plugin= takes the absolute path of the fix/x worktree, got "relative/worktree"\n'])
  assert.equal(existsSync(join(results, `preflight-${round}.json`)), false)
})

test('run.mjs refuses a --plugin-ref that is not the pin\'s, and names the pin\'s ref for a relative --plugin', t => {
  const { home, results, run } = refusingCli(t)
  const plugin = join(home, 'worktree')
  const tag = tempPin(results, { binary: join(home, 'no-such-claude.exe'), sha256: 'none', pluginDir: plugin, pluginRef: 'fix/x', pluginCommit: 'c0ffee1' })
  const batch = ['--conds=solo', '--tasks=easy', '--reps=1', '--no-sync']
  const other = run('run.mjs', `--tag=${tag}`, `--plugin=${plugin}`, '--plugin-ref=v9.9.9', ...batch)
  assert.deepEqual([other.status, other.stdout, other.stderr], [1, '', '--plugin-ref=v9.9.9 is not the ref the round pinned: pass --plugin-ref=fix/x or leave it out\n'])
  const relative = run('run.mjs', `--tag=${tag}`, '--plugin=relative/worktree', ...batch)
  assert.deepEqual([relative.status, relative.stdout, relative.stderr], [1, '', '--plugin= takes the absolute path of the fix/x worktree, got "relative/worktree"\n'])
})
