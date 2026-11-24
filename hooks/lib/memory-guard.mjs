// The session memory guard's logic: the limit, the process table, the session's root and the processes it started.
// Pure: no process access. The hook (pre-tool-use.mjs) and the runner (memory-guard.mjs) bind the real effects.

export const MB = 1024 * 1024
export const LIMIT_VAR = 'SECTION_TEAM_MEMORY_LIMIT_MB'
// The platforms where the guard is on when the variable is unset. None: the guard stops processes, so it runs only when the user sets a limit.
export const DEFAULT_ON_PLATFORMS = []
const DEFAULT_SHARE = 0.75
const FLOOR_MB = 4096
// The lowest limit the guard uses: under it the guard would stop nearly every process the session starts, a node or git call included.
export const LIMIT_FLOOR_MB = 1024
// The runner scans this often; a record touched within FRESH_SCANS intervals means a guard is running.
export const INTERVAL_MS = 5000
export const FRESH_SCANS = 3
export const FRESH_MS = FRESH_SCANS * INTERVAL_MS
// The longest one table may take. The runner touches its record before and after each table, so a scan this slow, plus the stops
// after it, still ends well inside FRESH_MS and no second guard starts.
export const SCAN_TIMEOUT_MS = FRESH_MS - INTERVAL_MS
const WHOLE_MB = /^\d+$/

const unsetLimit = (totalBytes, platform) =>
  DEFAULT_ON_PLATFORMS.includes(platform) ? Math.max(Math.floor(totalBytes * DEFAULT_SHARE), FLOOR_MB * MB) : null

// The limit in bytes, or null when the guard is off; problem is one line when the variable holds something other than a whole number of MB,
// or a number under LIMIT_FLOOR_MB, which is raised to the floor.
export function limitBytes(env, totalBytes, platform) {
  const value = env[LIMIT_VAR]
  if (value === undefined || value === '') return { bytes: unsetLimit(totalBytes, platform), problem: null }
  if (!WHOLE_MB.test(value)) {
    return { bytes: unsetLimit(totalBytes, platform), problem: `${LIMIT_VAR} is not a whole number of MB, so the default applies (off unless a platform turns it on)` }
  }
  const mb = Number(value)
  if (mb === 0) return { bytes: null, problem: null }
  if (mb < LIMIT_FLOOR_MB) {
    return { bytes: LIMIT_FLOOR_MB * MB, problem: `${LIMIT_VAR} is ${mb} MB, under the ${LIMIT_FLOOR_MB} MB floor, so the memory guard uses ${LIMIT_FLOOR_MB} MB` }
  }
  return { bytes: mb * MB, problem: null }
}

// The lister each platform uses. Windows: one PowerShell that prints one JSON table for each line it reads, and ends with its input.
const WINDOWS_LISTER = `
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
while ($null -ne [Console]::In.ReadLine()) {
  try {
    $rows = foreach ($p in Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,PrivatePageCount,Name,CommandLine) {
      [pscustomobject]@{ pid = $p.ProcessId; ppid = $p.ParentProcessId; started = $(if ($p.CreationDate) { ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() } else { $null }); bytes = $p.PrivatePageCount; name = $p.Name; command = $p.CommandLine }
    }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($rows) -Compress))
  } catch {
    # An empty line fails this scan on the Node side, where failed scans are counted and logged.
    [Console]::Out.WriteLine('')
  }
  [Console]::Out.Flush()
}
`
const PS_COLUMNS = 'pid=,ppid=,rss=,lstart=,command='

// { file, args, env } for the platform's lister; env is what to add to the caller's own.
export function listerCommand(platform) {
  if (platform === 'win32') {
    const encoded = Buffer.from(WINDOWS_LISTER, 'utf16le').toString('base64')
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], env: {} }
  }
  // lstart's format follows the locale; C keeps it one shape.
  return { file: 'ps', args: ['-axo', PS_COLUMNS], env: { LC_ALL: 'C' } }
}

const isCount = n => Number.isSafeInteger(n) && n >= 0

function windowsRows(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('the process list is not readable')
  }
  return [].concat(data)
    .filter(r => isCount(r?.pid) && isCount(r.ppid) && Number.isFinite(r.started) && Number.isFinite(r.bytes) && typeof r.name === 'string')
    .map(r => ({ pid: r.pid, ppid: r.ppid, started: r.started, bytes: r.bytes, name: r.name, command: typeof r.command === 'string' ? r.command : '' }))
}

// pid, ppid, rss (KB), lstart (five words, such as "Wed Nov 12 09:00:00 2026"), then the command.
const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/
const KB = 1024

function psRows(text) {
  return text.split('\n').map(line => PS_ROW.exec(line.trimEnd())).filter(Boolean).map(([, pid, ppid, rss, started, command]) => ({
    pid: Number(pid), ppid: Number(ppid), started, bytes: Number(rss) * KB,
    name: command.split(/\s+/)[0].split('/').pop().replace(/^-/, ''), command,
  }))
}

// Rows { pid, ppid, started, bytes, name, command } from the lister's output. Throws one line when no row has a start time.
export function parseTable(platform, text) {
  const rows = platform === 'win32' ? windowsRows(text) : psRows(text)
  if (rows.length === 0) throw new Error('the process list has no rows with a start time')
  return rows
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'fish', 'cmd', 'powershell', 'pwsh'])
// claude, node, or a claude binary kept under its version's name (claude-2.1.318.exe).
const ROOT_NAME = /^(?:node|claude(?:[-_]v?\d[\w.]*)?)$/
const baseName = name => name.toLowerCase().replace(/\.exe$/, '')

// A child started no earlier than its parent. Windows start times are numbers; ps start times are text, only compared for equality
// (an orphan moves to pid 1 there, so a stale parent id never points at a reused pid).
const startedAfter = (child, parent) => typeof child.started !== 'number' || typeof parent.started !== 'number' || child.started >= parent.started

// The nearest live ancestor of pid that is not a shell, or null when the chain is broken or that ancestor is neither claude nor node.
export function sessionRoot(table, pid) {
  const byPid = new Map(table.map(r => [r.pid, r]))
  const seen = new Set()
  let row = byPid.get(pid)
  while (row && !seen.has(row.pid)) {
    seen.add(row.pid)
    const parent = byPid.get(row.ppid)
    if (!parent || parent.pid === row.pid || !startedAfter(row, parent)) return null
    const name = baseName(parent.name)
    if (!SHELLS.has(name)) return ROOT_NAME.test(name) ?{ pid: parent.pid, started: parent.started, name: parent.name, command: parent.command } : null
    row = parent
  }
  return null
}

const sameProcess = (a, b) => a.pid === b.pid && a.started === b.started

export const rootAlive = (table, root) => table.some(r => sameProcess(r, root))

// The new state: every row whose parent chain reaches the root or a process already tracked (started no earlier than that parent),
// plus every tracked process still listed with the same start time, after its parent exits too. A root that is gone adopts nothing:
// its pid may already name another process.
export function track(state, table) {
  const key = p => `${p.pid}:${p.started}`
  const children = new Map()
  for (const r of table) children.set(r.ppid, [...(children.get(r.ppid) ?? []), r])
  const listed = new Set(table.map(key))
  const kept = state.tracked.filter(t => listed.has(key(t)))
  const known = new Set([key(state.root), ...kept.map(key)])
  const queue = [...(listed.has(key(state.root)) ? [state.root] : []), ...kept]
  const added = []
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i].pid) ?? []) {
      if (known.has(key(child)) || !startedAfter(child, queue[i])) continue
      known.add(key(child))
      added.push({ pid: child.pid, started: child.started })
      queue.push(child)
    }
  }
  return { ...state, tracked: [...kept, ...added] }
}

// Tracked rows over the limit; never the root and never a pid in own (the guard and its lister).
export function oversized(state, table, limit, own) {
  return table.filter(r => r.bytes > limit && r.pid !== state.root.pid && !own.includes(r.pid) && state.tracked.some(t => sameProcess(t, r)))
}
