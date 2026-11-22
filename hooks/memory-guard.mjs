// The session memory guard's runner: started detached by the PreToolUse hook with its record file, it scans the process table every
// few seconds and stops any process the session started that holds more memory than the limit. It exits when the session's root is gone,
// when its record file is removed or names another guard, or after too many failed scans.
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'
import { INTERVAL_MS, MB, SCAN_TIMEOUT_MS, listerCommand, oversized, parseTable, rootAlive, track } from './lib/memory-guard.mjs'
import { isMainModule, lineOf } from './lib/paths.mjs'

const ROOT_GONE_SCANS = 2
const MAX_FAILED_SCANS = 10
const COMMAND_CLIP = 400
const LIST_BUFFER = 64 * MB
// How long a process has after SIGTERM to exit before SIGKILL. Scans are INTERVAL_MS apart, so the SIGKILL goes out at the first scan past it.
export const KILL_GRACE_MS = 5000
const EFFECTS = ['list', 'kill', 'log', 'sleep', 'now', 'touch', 'state', 'limit', 'own']

const clip = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, COMMAND_CLIP)
const key = p => `${p.pid}:${p.started}`
const stampOf = now => new Date(now()).toISOString()

// Sends one signal: null when it went out, else the error as one line.
async function signal(kill, pid, name) {
  try {
    await kill(pid, name)
    return null
  } catch (err) {
    return lineOf(err)
  }
}

// SIGKILL to each process still listed (same pid and start time) KILL_GRACE_MS after its SIGTERM; each is sent once.
async function killLingering({ kill, log, now }, due, listed) {
  for (const t of due) {
    const failed = await signal(kill, t.pid, 'SIGKILL')
    const outcome = failed === null ? 'sent SIGKILL to' : `could not kill (${failed})`
    await log(`${stampOf(now)} ${outcome} pid ${t.pid}, still running ${KILL_GRACE_MS / 1000} s after SIGTERM: ${clip(listed.get(key(t)).command)}`)
  }
}

// SIGTERM to each row; returns the ones it reached, with when.
async function termOversized({ kill, log, limit, now }, rows, table) {
  const byPid = new Map(table.map(r => [r.pid, r]))
  const sent = []
  for (const row of rows) {
    const failed = await signal(kill, row.pid, 'SIGTERM')
    const parent = byPid.get(row.ppid)
    await log(`${stampOf(now)} ${failed === null ? 'sent SIGTERM to' : `could not stop (${failed})`} pid ${row.pid} at ${Math.round(row.bytes / MB)} MB (limit ${Math.round(limit / MB)} MB): ${clip(row.command)} | parent: ${parent ? clip(parent.command) : 'gone'}`)
    if (failed === null) sent.push({ pid: row.pid, started: row.started, at: now() })
  }
  return sent
}

// A graceful stop that spans scans, so no scan waits and the record's heartbeat keeps its pace: SIGTERM to each tracked process over the
// limit, then SIGKILL at a later scan to each that is still listed KILL_GRACE_MS after it. A pid that names a new start is not the same process.
// Returns the new state.
async function stopOversized(args, state, table) {
  const listed = new Map(table.map(r => [key(r), r]))
  const termed = (state.termed ?? []).filter(t => listed.has(key(t)))
  const due = termed.filter(t => args.now() - t.at >= KILL_GRACE_MS)
  await killLingering(args, due, listed)
  const fresh = oversized(state, table, args.limit, args.own).filter(r => !termed.some(t => key(t) === key(r)))
  const sent = await termOversized(args, fresh, table)
  return { ...state, termed: [...termed.filter(t => !due.includes(t)), ...sent] }
}

// One table, or the error that kept it from being read.
async function scan(list) {
  try {
    return { table: await list() }
  } catch (err) {
    return { error: err }
  }
}

// The loop. Every effect is an argument with no default; it resolves with why it ended: 'root gone', 'record removed' or 'failed'.
export async function runGuard(args) {
  const missing = EFFECTS.filter(key => args?.[key] === undefined)
  if (missing.length > 0) throw new Error(`runGuard needs ${missing.join(', ')}`)
  const { list, sleep, touch } = args
  let state = args.state
  let gone = 0
  let failed = 0
  for (;;) {
    // Touched before and after each table, so even a table that takes SCAN_TIMEOUT_MS leaves the record fresh, and a runner whose
    // record another guard took over meanwhile stops nothing.
    if (!(await touch())) return 'record removed'
    const { table, error } = await scan(list)
    if (!(await touch())) return 'record removed'
    if (error) {
      failed += 1
      if (failed >= MAX_FAILED_SCANS) {
        await args.log(`${stampOf(args.now)} ${MAX_FAILED_SCANS} scans in a row failed (${lineOf(error)}), so the guard stopped`)
        return 'failed'
      }
    } else {
      failed = 0
      gone = rootAlive(table, state.root) ? 0 : gone + 1
      if (gone >= ROOT_GONE_SCANS) return 'root gone'
      state = await stopOversized(args, track(state, table), table)
    }
    await sleep(INTERVAL_MS)
  }
}

function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('the process list timed out')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Windows: one long-lived PowerShell that prints a table for each line it reads, and ends when its input ends, so it ends with the guard.
function powershellLister(command) {
  const child = spawn(command.file, command.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  // A lister that failed to start or has ended shows up as the end of its output, which fails each scan; these events add nothing to that.
  child.on('error', () => child.stdout.destroy())
  child.stdin.on('error', () => child.stdout.destroy())
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  const list = async () => {
    child.stdin.write('\n')
    const next = await withTimeout(lines.next(), SCAN_TIMEOUT_MS)
    if (next.done) throw new Error('the process lister ended')
    return parseTable('win32', next.value)
  }
  return { pid: child.pid, list, close: () => child.stdin.end() }
}

// macOS and Linux: one ps per scan.
function psLister(command, platform) {
  const options = { env: { ...process.env, ...command.env }, timeout: SCAN_TIMEOUT_MS, maxBuffer: LIST_BUFFER }
  const list = () => new Promise((resolve, reject) => {
    execFile(command.file, command.args, options, (err, out) => (err ? reject(err) : resolve(parseTable(platform, out))))
  })
  return { pid: undefined, list, close: () => {} }
}

const isClaim = claim => typeof claim === 'string' && claim !== ''

// This guard's claim once its record is read; until then a failure is written nowhere.
let ownClaim = null

// The record the hook wrote: the root, the limit and the log file. Throws one line when it is not one. Its claim is kept first, so a
// record the runner cannot use still takes its failure, and no other file ever does.
function readGuardRecord(file) {
  if (typeof file !== 'string' || !isAbsolute(file) || !file.endsWith('.guard.json')) throw new Error('no guard record given')
  const record = JSON.parse(readFileSync(file, 'utf8'))
  if (isClaim(record?.claim)) ownClaim = record.claim
  const root = record?.root
  const valid = Number.isSafeInteger(root?.pid) && ['number', 'string'].includes(typeof root.started)
    && Number.isSafeInteger(record.limit) && record.limit > 0 && typeof record.log === 'string' && isAbsolute(record.log)
    && isClaim(record.claim)
  if (!valid) throw new Error('the guard record is not valid')
  return record
}

// The record's claim, or null when it is gone or names no guard (a failed start, or a new claimer still writing it).
function claimOf(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))?.claim ?? null
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return null
    throw err
  }
}

// The heartbeat: touches the record while it names this guard; false once it is gone or another guard has taken it over, and always
// false without a claim.
export function heartbeat(file, claim) {
  if (!isClaim(claim) || claimOf(file) !== claim) return false
  try {
    const now = new Date()
    utimesSync(file, now, now)
    return true
  } catch (err) {
    if (err.code === 'ENOENT') return false
    throw err
  }
}

function appendLog(file, line) {
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${line}\n`)
}

// A guard that stopped on failed scans says so in its record, so the hook does not start another for 10 minutes; never in a record
// another guard has taken over.
function recordFailure(file, problem, claim) {
  if (heartbeat(file, claim)) writeFileSync(file, JSON.stringify({ failed: { at: Date.now(), problem } }))
}

async function main() {
  const file = process.argv[2]
  const record = readGuardRecord(file)
  const command = listerCommand(process.platform)
  const lister = process.platform === 'win32' ? powershellLister(command) : psLister(command, process.platform)
  const reason = await runGuard({
    list: lister.list,
    // On Windows every signal ends the process at once, so SIGTERM already stops it there.
    kill: (pid, name) => process.kill(pid, name),
    log: line => appendLog(record.log, line),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: Date.now,
    touch: () => heartbeat(file, record.claim),
    state: { root: record.root, tracked: [] },
    limit: record.limit,
    own: [process.pid, lister.pid].filter(Number.isSafeInteger),
  })
  if (reason === 'failed') recordFailure(file, 'the process list failed 10 times in a row', record.claim)
  lister.close()
}

if (isMainModule(import.meta.url)) {
  // Detached with no output: a guard that cannot run says so in its record, where the hook reads it.
  main().then(() => process.exit(0), err => {
    try {
      recordFailure(process.argv[2], lineOf(err), ownClaim)
    } finally {
      process.exit(1)
    }
  })
}
