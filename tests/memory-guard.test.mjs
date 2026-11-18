import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { FRESH_MS, INTERVAL_MS, MB, SCAN_TIMEOUT_MS, limitBytes, oversized, parseTable, rootAlive, sessionRoot, track } from '../hooks/lib/memory-guard.mjs'
import { heartbeat, runGuard } from '../hooks/memory-guard.mjs'

const GB = 1024 * MB
const VAR = 'SECTION_TEAM_MEMORY_LIMIT_MB'
const made = []
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }) })
const tempDir = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-memguard-')))
  made.push(dir)
  return dir
}

// One Windows row; started is the creation time in ms, bytes the private bytes.
const row = (pid, ppid, started, name, bytes = 10 * MB, command = name) => ({ pid, ppid, started, bytes, name, command })

test('limitBytes: unset is 75% of memory on win32 with a 4096 MB floor, and off on linux and darwin', () => {
  assert.deepEqual(limitBytes({}, 16 * GB, 'win32'), { bytes: 12 * GB, problem: null })
  assert.deepEqual(limitBytes({}, 4 * GB, 'win32'), { bytes: 4096 * MB, problem: null })
  for (const platform of ['linux', 'darwin']) assert.deepEqual(limitBytes({}, 16 * GB, platform), { bytes: null, problem: null }, platform)
})

test('limitBytes: a whole number of MB sets the limit on every platform, with no floor, and 0 turns it off', () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    assert.deepEqual(limitBytes({ [VAR]: '300' }, 16 * GB, platform), { bytes: 300 * MB, problem: null }, platform)
    assert.deepEqual(limitBytes({ [VAR]: '0' }, 16 * GB, platform), { bytes: null, problem: null }, platform)
  }
})

test('limitBytes: a bad value gives the unset answer and a one-line problem naming the variable', () => {
  for (const bad of ['12GB', '-1', '1.5', ' 300', 'off', '1e4']) {
    const win = limitBytes({ [VAR]: bad }, 16 * GB, 'win32')
    assert.equal(win.bytes, 12 * GB, bad)
    assert.ok(win.problem.includes(VAR) && !win.problem.includes('\n'), bad)
    const linux = limitBytes({ [VAR]: bad }, 16 * GB, 'linux')
    assert.equal(linux.bytes, null, bad)
    assert.ok(linux.problem.includes(VAR), bad)
  }
})

const WIN_TABLE = JSON.stringify([
  { pid: 0, ppid: 0, started: null, bytes: 0, name: 'System Idle Process', command: null },
  { pid: 100, ppid: 4, started: 1000, bytes: 200 * MB, name: 'claude.exe', command: 'claude.exe --resume' },
  { pid: 300, ppid: 100, started: 3000, bytes: 40 * MB, name: 'node.exe', command: null },
])

test('parseTable reads a Windows table and drops rows with no start time', () => {
  assert.deepEqual(parseTable('win32', WIN_TABLE), [
    row(100, 4, 1000, 'claude.exe', 200 * MB, 'claude.exe --resume'),
    row(300, 100, 3000, 'node.exe', 40 * MB, ''),
  ])
  assert.throws(() => parseTable('win32', 'not json'), err => !err.message.includes('\n'))
})

const PS_TABLE = [
  '    1     0  1024 Wed Nov 12 09:00:00 2026 /sbin/init splash',
  '  200     1  2048 Wed Nov  2 09:01:00 2026 -bash',
  '  300   200 307200 Wed Nov 12 09:02:00 2026 /usr/bin/node /x/cli.js --flag',
  '',
].join('\n')

test('parseTable reads a ps table, rss in KB and lstart kept as text', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(parseTable(platform, PS_TABLE), [
      { pid: 1, ppid: 0, started: 'Wed Nov 12 09:00:00 2026', bytes: 1024 * 1024, name: 'init', command: '/sbin/init splash' },
      { pid: 200, ppid: 1, started: 'Wed Nov  2 09:01:00 2026', bytes: 2048 * 1024, name: 'bash', command: '-bash' },
      { pid: 300, ppid: 200, started: 'Wed Nov 12 09:02:00 2026', bytes: 307200 * 1024, name: 'node', command: '/usr/bin/node /x/cli.js --flag' },
    ], platform)
  }
})

test('parseTable throws one line for a ps table without start times', () => {
  const busybox = '    1     0  1024 /sbin/init\n  200     1  2048 -sh\n'
  assert.throws(() => parseTable('linux', busybox), err => /start time/.test(err.message) && !err.message.includes('\n'))
})

// claude.exe 100 (under the app Claude.exe 50) -> bash.exe 200 -> node.exe 300 (the hook).
const CHAIN = [
  row(50, 4, 500, 'Claude.exe'),
  row(100, 50, 1000, 'claude.exe', 300 * MB, 'claude.exe --session'),
  row(200, 100, 2000, 'bash.exe'),
  row(300, 200, 3000, 'node.exe'),
]

test('sessionRoot: node.exe under bash.exe under claude.exe gives that claude.exe', () => {
  assert.deepEqual(sessionRoot(CHAIN, 300), { pid: 100, started: 1000, name: 'claude.exe', command: 'claude.exe --session' })
})

test('sessionRoot skips several shells, in any case, with and without .exe, and stops at the inner claude.exe, not the app', () => {
  const table = [
    row(50, 4, 500, 'Claude.exe'),
    row(100, 50, 1000, 'claude.exe'),
    row(150, 100, 1500, 'CMD.EXE'),
    row(160, 150, 1600, 'PowerShell.exe'),
    row(170, 160, 1700, 'pwsh'),
    row(180, 170, 1800, 'Bash'),
    row(190, 180, 1900, 'sh.exe'),
    row(195, 190, 1950, 'zsh'),
    row(196, 195, 1960, 'dash'),
    row(197, 196, 1970, 'fish'),
    row(300, 197, 3000, 'node.exe'),
  ]
  assert.equal(sessionRoot(table, 300).pid, 100)
  assert.equal(sessionRoot([row(100, 50, 1000, 'claude.exe'), row(150, 100, 1500, 'cmd.exe'), row(300, 150, 3000, 'node.exe')], 300).pid, 100)
})

test('sessionRoot: a node root counts, an unknown host or a broken chain gives null', () => {
  assert.equal(sessionRoot([row(90, 1, 900, 'node'), row(200, 90, 2000, 'bash'), row(300, 200, 3000, 'node')], 300).pid, 90)
  assert.equal(sessionRoot([row(90, 1, 900, 'Code.exe'), row(200, 90, 2000, 'bash.exe'), row(300, 200, 3000, 'node.exe')], 300), null)
  assert.equal(sessionRoot([row(200, 90, 2000, 'bash.exe'), row(300, 200, 3000, 'node.exe')], 300), null)
  assert.equal(sessionRoot([row(300, 200, 3000, 'node.exe')], 300), null)
  assert.equal(sessionRoot(CHAIN, 999), null)
  // The parent's pid was reused by a later process: the chain is broken.
  assert.equal(sessionRoot([row(200, 1, 5000, 'claude.exe'), row(300, 200, 3000, 'node.exe')], 300), null)
})

// A Claude Code binary kept under its version's name (the benchmark's pinned claude-2.1.318.exe) is the root too.
test('sessionRoot: a claude binary named with its version is the root; a name that only starts with claude is not', () => {
  const under = name => sessionRoot([row(100, 1, 1000, name), row(200, 100, 2000, 'bash.exe'), row(300, 200, 3000, 'node.exe')], 300)
  for (const name of ['claude-2.1.318.exe', 'Claude-2.1.318.EXE', 'claude_2.1.318', 'claude-v2.exe']) assert.equal(under(name)?.pid, 100, name)
  for (const name of ['claudette.exe', 'claude-desktop-helper.exe', 'claude-.exe', 'my-claude-2.1.exe']) assert.equal(under(name), null, name)
})

const ROOT = { pid: 100, started: 1000, name: 'claude.exe', command: 'claude.exe' }
const ROW_ROOT = row(100, 50, 1000, 'claude.exe')

test('rootAlive needs the same pid and the same start time', () => {
  assert.equal(rootAlive(CHAIN, ROOT), true)
  assert.equal(rootAlive([row(100, 50, 7000, 'claude.exe')], ROOT), false)
  assert.equal(rootAlive([], ROOT), false)
})

const trackedPids = state => state.tracked.map(t => t.pid).sort((a, b) => a - b)

test('track: a process present at the first scan is tracked, a process outside the root is not, and the state is new', () => {
  const state = { root: ROOT, tracked: [] }
  const table = [...CHAIN, row(400, 100, 4000, 'node.exe'), row(500, 50, 5000, 'node.exe'), row(600, 1, 6000, 'node.exe')]
  const next = track(state, table)
  assert.deepEqual(trackedPids(next), [200, 300, 400])
  assert.deepEqual(state, { root: ROOT, tracked: [] }, 'the old state is unchanged')
})

test('track: a later child, grandchild and orphan stay tracked; a reused pid with an earlier start is not adopted', () => {
  let state = track({ root: ROOT, tracked: [] }, [ROW_ROOT, row(400, 100, 4000, 'node.exe')])
  state = track(state, [ROW_ROOT, row(400, 100, 4000, 'node.exe'), row(410, 400, 4100, 'node.exe'), row(420, 410, 4200, 'node.exe')])
  assert.deepEqual(trackedPids(state), [400, 410, 420])
  // 410 exits: its child 420 keeps the stale parent id and stays tracked.
  state = track(state, [ROW_ROOT, row(400, 100, 4000, 'node.exe'), row(420, 410, 4200, 'node.exe')])
  assert.deepEqual(trackedPids(state), [400, 420])
  // 400 exits and its pid goes to a new child of the root; an older process whose parent id is 400 is not that child's.
  state = track(state, [ROW_ROOT, row(400, 100, 9000, 'node.exe'), row(420, 410, 4200, 'node.exe'), row(700, 400, 3500, 'node.exe')])
  assert.deepEqual(trackedPids(state), [400, 420])
  assert.equal(state.tracked.find(t => t.pid === 400).started, 9000)
})

// claude.exe 100 has exited and pid 100 now names an unrelated process with a big child: neither is the session's.
const REUSED_ROOT = [row(100, 50, 7000, 'other.exe'), row(450, 100, 7100, 'node.exe', 2 * GB)]

test("track: a root whose pid now names another process adopts none of that process's children", () => {
  const state = track({ root: ROOT, tracked: [] }, [ROW_ROOT])
  assert.deepEqual(trackedPids(track(state, REUSED_ROOT)), [])
})

test('oversized: only tracked rows over the limit, never the root, the guard or its lister', () => {
  const big = 2 * GB
  const table = [
    row(100, 50, 1000, 'claude.exe', big),
    row(400, 100, 4000, 'node.exe', big),
    row(410, 100, 4100, 'node.exe', 100 * MB),
    row(800, 100, 8000, 'node.exe', big),
    row(810, 800, 8100, 'powershell.exe', big),
    row(900, 1, 9000, 'node.exe', big),
  ]
  const state = track({ root: ROOT, tracked: [] }, table)
  assert.deepEqual(oversized(state, table, GB, [800, 810]).map(r => r.pid), [400])
})

// Fakes for every effect of the runner. A table can be an Error, which list throws.
function fakes(tables, { touch = () => true } = {}) {
  const calls = []
  let scan = 0
  let sleeps = 0
  return {
    calls,
    list: async () => {
      const table = tables[Math.min(scan++, tables.length - 1)]
      if (table instanceof Error) throw table
      return table
    },
    kill: async pid => { calls.push(['kill', pid]) },
    log: line => { calls.push(['log', line]) },
    sleep: async () => { if (++sleeps > 100) throw new Error('the loop did not end') },
    touch: () => touch(scan),
  }
}
const GUARD = { state: { root: ROOT, tracked: [] }, limit: GB, own: [800, 810] }
const GONE = [row(100, 50, 7000, 'claude.exe')]

test('runGuard stops a process over the limit in the very first table, kill before log, and never one outside the root', async () => {
  const long = 'node -e ' + 'x'.repeat(1000)
  const first = [ROW_ROOT, row(400, 100, 4000, 'node.exe', 2 * GB, long), row(900, 1, 9000, 'node.exe', 3 * GB), row(800, 100, 8000, 'node.exe', 3 * GB)]
  const f = fakes([first, GONE])
  const reason = await runGuard({ ...f, ...GUARD })
  assert.equal(reason, 'root gone')
  assert.deepEqual(f.calls.map(c => c[0]), ['kill', 'log'])
  assert.deepEqual(f.calls[0], ['kill', 400])
  const line = f.calls[1][1]
  assert.ok(line.includes('400') && line.includes('2048 MB') && line.includes('claude.exe'), line)
  assert.ok(line.includes('x'.repeat(392)) && !line.includes('x'.repeat(401)), 'command clipped to 400 characters')
  assert.ok(!line.includes('\n'))
})

test('runGuard calls kill once per oversized process in each scan', async () => {
  const table = [ROW_ROOT, row(400, 100, 4000, 'node.exe', 2 * GB), row(410, 400, 4100, 'node.exe', 2 * GB), row(420, 100, 4200, 'node.exe', 10 * MB)]
  const f = fakes([table, GONE])
  await runGuard({ ...f, ...GUARD })
  assert.deepEqual(f.calls.filter(c => c[0] === 'kill').map(c => c[1]).sort(), [400, 410])
})

test('a stop that fails is logged as such and the guard keeps going', async () => {
  const f = fakes([[ROW_ROOT, row(400, 100, 4000, 'node.exe', 2 * GB)], GONE])
  f.kill = async () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) }
  assert.equal(await runGuard({ ...f, ...GUARD }), 'root gone')
  assert.equal(f.calls.length, 1)
  assert.match(f.calls[0][1], /could not stop \(ESRCH\) pid 400/)
})

test('runGuard ends after two scans with the root showing another start time, not after one', async () => {
  const f = fakes([[ROW_ROOT], GONE, [ROW_ROOT], GONE, GONE, [ROW_ROOT]])
  assert.equal(await runGuard({ ...f, ...GUARD }), 'root gone')
  let lists = 0
  const counted = { ...f, list: async () => { lists++; return lists === 1 ? [ROW_ROOT] : GONE } }
  await runGuard({ ...counted, ...GUARD })
  assert.equal(lists, 3)
})

test('runGuard never stops a child of a process that took the root pid, in the scan that finds the root gone', async () => {
  const f = fakes([[ROW_ROOT], REUSED_ROOT, REUSED_ROOT])
  assert.equal(await runGuard({ ...f, ...GUARD }), 'root gone')
  assert.deepEqual(f.calls, [])
})

test('runGuard ends when the record is removed', async () => {
  const f = fakes([[ROW_ROOT]], { touch: scan => scan < 3 })
  assert.equal(await runGuard({ ...f, ...GUARD }), 'record removed')
  assert.deepEqual(f.calls, [])
})

// A fake clock: every list takes the longest a scan may take, and every stop takes a second. The hook calls a record stale after FRESH_MS,
// so a gap between two touches that reaches it would let a second guard start.
test('a scan as slow as the timeout never leaves the record stale long enough for a second guard to start', async () => {
  assert.ok(Number.isFinite(SCAN_TIMEOUT_MS) && SCAN_TIMEOUT_MS > 0, 'the scan timeout is a named constant')
  let clock = 0
  const touches = []
  const f = fakes([[ROW_ROOT, row(400, 100, 4000, 'node.exe', 2 * GB)], [ROW_ROOT], [ROW_ROOT], GONE])
  const list = f.list
  f.list = async () => { clock += SCAN_TIMEOUT_MS; return list() }
  f.kill = async () => { clock += 1000 }
  f.sleep = async ms => { clock += ms }
  f.touch = () => { touches.push(clock); return true }
  assert.equal(await runGuard({ ...f, ...GUARD }), 'root gone')
  const gaps = touches.slice(1).map((t, i) => t - touches[i])
  assert.ok(Math.max(...gaps) < FRESH_MS, `touch gaps ${gaps} must stay under ${FRESH_MS} ms`)
  assert.ok(FRESH_MS > SCAN_TIMEOUT_MS + INTERVAL_MS / 2, 'a slow scan still fits the freshness window')
})

test('a runner whose record was taken over during a slow scan stops nothing and exits', async () => {
  let touches = 0
  const f = fakes([[ROW_ROOT, row(400, 100, 4000, 'node.exe', 2 * GB)]], { touch: () => ++touches < 2 })
  assert.equal(await runGuard({ ...f, ...GUARD }), 'record removed')
  assert.deepEqual(f.calls, [], 'the superseded runner stopped nothing')
})

// A whole-second time survives utimes and stat exactly. A time with a fraction of a second can read
// back a hair early (Node 20.16 and 22.3 on Linux returned ...303.999 for ...304), failing an exact check.
const minuteAgo = () => new Date(Math.floor(Date.now() / 1000) * 1000 - 60 * 1000)

test('heartbeat touches the record only while it names this guard', () => {
  const dir = tempDir()
  const file = join(dir, 's.guard.json')
  const old = minuteAgo()
  const write = text => { writeFileSync(file, text); utimesSync(file, old, old) }
  write(JSON.stringify({ claim: 'mine', root: {} }))
  assert.equal(heartbeat(file, 'mine'), true)
  assert.ok(Date.now() - statSync(file).mtimeMs < 10 * 1000, 'touched')
  for (const text of [JSON.stringify({ claim: 'theirs' }), '', '{"failed":{"at":1}}', 'not json']) {
    write(text)
    assert.equal(heartbeat(file, 'mine'), false, text)
    assert.equal(statSync(file).mtimeMs, old.getTime(), `not touched: ${text}`)
  }
  rmSync(file)
  assert.equal(heartbeat(file, 'mine'), false)
})

test('heartbeat without a claim of its own touches nothing, even a file that names no guard', () => {
  const dir = tempDir()
  const file = join(dir, 's.guard.json')
  const old = minuteAgo()
  for (const text of [JSON.stringify({ root: {} }), '', '{"failed":{"at":1}}', 'not json']) {
    for (const claim of [null, undefined, '']) {
      writeFileSync(file, text)
      utimesSync(file, old, old)
      assert.equal(heartbeat(file, claim), false, `${text} ${claim}`)
      assert.equal(statSync(file).mtimeMs, old.getTime(), `not touched: ${text} ${claim}`)
    }
  }
})

// Every way to start or stop a process throws, so a module that tried would fail the run.
const BLOCK = "import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module'; for (const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) cp[k] = () => { throw new Error('started ' + k) }; process.kill = () => { throw new Error('kill') }; syncBuiltinESMExports()"
const BLOCK_IMPORT = `data:text/javascript,${encodeURIComponent(BLOCK)}`
const RUNNER = join(import.meta.dirname, '..', 'hooks', 'memory-guard.mjs')

test('a runner that cannot use what it was given writes no file but a record that names it', () => {
  const dir = tempDir()
  const keep = {
    'notes.txt': 'keep me',
    'config.json': '{"a":1}',
    // A new claimer has opened this record and is still listing: the runner must not write its failure there.
    'claimed.guard.json': '',
    'half-written.guard.json': JSON.stringify({ root: {}, claim: 'another-guard' }).slice(0, -1),
  }
  for (const [name, text] of Object.entries(keep)) writeFileSync(join(dir, name), text)
  // A record the hook wrote for this runner, with a limit it cannot use: its failure goes there, so the hook waits 10 minutes.
  const own = join(dir, 'own.guard.json')
  writeFileSync(own, JSON.stringify({ root: { pid: 1, started: 1 }, limit: 1e300, log: join(dir, 'x.log'), claim: 'mine' }))
  for (const name of [...Object.keys(keep), 'own.guard.json']) {
    const run = spawnSync(process.execPath, ['--import', BLOCK_IMPORT, RUNNER, join(dir, name)], { cwd: dir, encoding: 'utf8', timeout: 20000 })
    assert.equal(run.status, 1, `${name}: ${run.stderr}`)
  }
  for (const [name, text] of Object.entries(keep)) assert.equal(readFileSync(join(dir, name), 'utf8'), text, name)
  assert.ok(JSON.parse(readFileSync(own, 'utf8')).failed, 'the runner recorded its own failure')
})

test('runGuard ends after 10 failed scans in a row and logs that once; a good scan resets the count', async () => {
  const fail = new Error('lister broke')
  const f = fakes([...Array(9).fill(fail), [ROW_ROOT], ...Array(10).fill(fail)])
  assert.equal(await runGuard({ ...f, ...GUARD }), 'failed')
  assert.equal(f.calls.length, 1)
  assert.ok(f.calls[0][0] === 'log' && f.calls[0][1].includes('10'), f.calls[0][1])
})

test('runGuard needs every effect: a missing one throws before any scan', async () => {
  for (const key of ['list', 'kill', 'log', 'sleep', 'touch', 'state', 'limit', 'own']) {
    const f = fakes([[ROW_ROOT]])
    const args = { ...f, ...GUARD }
    delete args[key]
    await assert.rejects(runGuard(args), key)
  }
})

test('importing either module starts nothing: no spawn, no kill, no file written', () => {
  const home = tempDir()
  const cwd = tempDir()
  const lib = pathToFileURL(join(import.meta.dirname, '..', 'hooks', 'lib', 'memory-guard.mjs')).href
  const runner = pathToFileURL(RUNNER).href
  const run = spawnSync(process.execPath, ['--import', BLOCK_IMPORT, '--input-type=module', '-e', `await import(${JSON.stringify(lib)}); await import(${JSON.stringify(runner)})`], {
    cwd, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 20000,
  })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(readdirSync(home), [])
  assert.deepEqual(readdirSync(cwd), [])
})
