// The session memory guard's runner: started detached by the PreToolUse hook with its record file, it scans the process table every
// few seconds and stops any process the session started that holds more memory than the limit. It exits when the session's root is gone,
// when its record file is removed, or after too many failed scans.
import { execFile, spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { createInterface } from 'node:readline'
import { INTERVAL_MS, MB, listerCommand, oversized, parseTable, rootAlive, track } from './lib/memory-guard.mjs'
import { isMainModule, lineOf } from './lib/paths.mjs'

const ROOT_GONE_SCANS = 2
const MAX_FAILED_SCANS = 10
const COMMAND_CLIP = 400
const SCAN_TIMEOUT_MS = 30 * 1000
const LIST_BUFFER = 64 * MB
const EFFECTS = ['list', 'kill', 'log', 'sleep', 'touch', 'state', 'limit', 'own']

const clip = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, COMMAND_CLIP)

async function stopOversized({ kill, log, limit, own }, state, table) {
  const byPid = new Map(table.map(r => [r.pid, r]))
  for (const row of oversized(state, table, limit, own)) {
    let outcome = 'stopped'
    try {
      await kill(row.pid)
    } catch (err) {
      outcome = `could not stop (${lineOf(err)})`
    }
    const parent = byPid.get(row.ppid)
    await log(`${new Date().toISOString()} ${outcome} pid ${row.pid} at ${Math.round(row.bytes / MB)} MB (limit ${Math.round(limit / MB)} MB): ${clip(row.command)} | parent: ${parent ? clip(parent.command) : 'gone'}`)
  }
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
    if (!(await touch())) return 'record removed'
    const { table, error } = await scan(list)
    if (error) {
      failed += 1
      if (failed >= MAX_FAILED_SCANS) {
        await args.log(`${new Date().toISOString()} ${MAX_FAILED_SCANS} scans in a row failed (${lineOf(error)}), so the guard stopped`)
        return 'failed'
      }
    } else {
      failed = 0
      gone = rootAlive(table, state.root) ? 0 : gone + 1
      if (gone >= ROOT_GONE_SCANS) return 'root gone'
      state = track(state, table)
      await stopOversized(args, state, table)
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

// The record the hook wrote: the root, the limit and the log file. Throws one line when it is not one.
function readGuardRecord(file) {
  if (typeof file !== 'string' || !isAbsolute(file) || !file.endsWith('.guard.json')) throw new Error('no guard record given')
  const record = JSON.parse(readFileSync(file, 'utf8'))
  const root = record?.root
  const valid = Number.isSafeInteger(root?.pid) && ['number', 'string'].includes(typeof root.started)
    && Number.isSafeInteger(record.limit) && record.limit > 0 && typeof record.log === 'string' && isAbsolute(record.log)
  if (!valid) throw new Error('the guard record is not valid')
  return record
}

// The heartbeat: false once the record file is gone.
function touchRecord(file) {
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

// A guard that stopped on failed scans says so in its record, so the hook does not start another for 10 minutes.
function recordFailure(file, problem) {
  if (touchRecord(file)) writeFileSync(file, JSON.stringify({ failed: { at: Date.now(), problem } }))
}

async function main() {
  const file = process.argv[2]
  const record = readGuardRecord(file)
  const command = listerCommand(process.platform)
  const lister = process.platform === 'win32' ? powershellLister(command) : psLister(command, process.platform)
  const reason = await runGuard({
    list: lister.list,
    kill: pid => process.kill(pid, 'SIGKILL'),
    log: line => appendLog(record.log, line),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    touch: () => touchRecord(file),
    state: { root: record.root, tracked: [] },
    limit: record.limit,
    own: [process.pid, lister.pid].filter(Number.isSafeInteger),
  })
  if (reason === 'failed') recordFailure(file, 'the process list failed 10 times in a row')
  lister.close()
}

if (isMainModule(import.meta.url)) {
  // Detached with no output: a guard that cannot run says so in its record, where the hook reads it.
  main().then(() => process.exit(0), err => {
    try {
      recordFailure(process.argv[2], lineOf(err))
    } finally {
      process.exit(1)
    }
  })
}
