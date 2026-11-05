// Puts back section memory an older harness moved aside. Before 0.2.0 sections loaded memory from ~/.claude/agent-memory, so a
// round moved the user's folders into a backup; every agent now has `memory: local`, so nothing moves them any more, and only
// this way back remains (node bench/run.mjs --restore-memory). Nothing is ever deleted: every step is a rename.
// The backup holds manifest.json { names, pid, startedAt }: the names are the user's folders, written before any move,
// so a restore can always tell the user's folders from run notes, however often it is run and wherever it stopped.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const MEMORY_ROOT = join(homedir(), '.claude', 'agent-memory')
export const MEMORY_BACKUP = join(homedir(), 'bench-section-memory-backup')
const MANIFEST = 'manifest.json'
const SECTION = /^section-team-[a-z0-9-]+$/
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES'])
const RETRIES = 5
const RETRY_MS = 200

// Folders and links (a junction is moved as a link, never followed) named section-team-*, sorted.
const sectionFolders = dir => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).filter(e => (e.isDirectory() || e.isSymbolicLink()) && SECTION.test(e.name)).map(e => e.name).sort()
  : []

// What moves, deletes or pushes real data names its target, with no default: a caller that forgets throws here
// instead of reaching the user's folders. A test once lost the user's notes through a default (no-real-data.test.mjs).
export function required(named) {
  for (const [name, value] of Object.entries(named)) {
    if (value === undefined || value === null) throw new TypeError(`${name} is required`)
  }
}

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Windows briefly locks a folder after a process exits (antivirus, the indexer): retry before giving up.
export function renameRetry(from, to, { rename = renameSync, wait = sleep } = {}) {
  required({ from, to })
  for (let attempt = 1; ; attempt++) {
    try {
      return rename(from, to)
    } catch (err) {
      if (!BUSY.has(err.code) || attempt >= RETRIES) throw err
      wait(RETRY_MS * attempt)
    }
  }
}

function moveAll(names, from, to, rename) {
  if (names.length > 0) mkdirSync(to, { recursive: true })
  for (const name of names) renameRetry(join(from, name), join(to, name), { rename })
  return names
}

// True when both paths sit on the same volume, so a rename between them cannot fail with EXDEV.
export function sameVolume(a, b) {
  required({ a, b })
  return statSync(a).dev === statSync(b).dev
}

const isAlive = pid => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}

// The manifest is written (atomically) before any folder moves, so no manifest means the backup stopped before
// moving anything: every section folder in root is then the user's, and only what sits in the backup goes back.
function readManifest(backup) {
  const path = join(backup, MANIFEST)
  if (!existsSync(path)) return { names: null, pid: null }
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err.message}): remove it and run node bench/run.mjs --restore-memory again; with no manifest, only the folders in the backup move back`, { cause: err })
  }
}

// Puts the user's folders back: every folder still in the backup returns to root, and any section folder in root
// that is not the user's (a run note, or a run's folder of the same name as one still in the backup) is filed
// under leftovers first. Safe to run again after it stopped half way. Refuses while the round that made the
// backup is still running, unless force.
export function restoreSectionMemory({ root, backup, leftovers, force = false, alive = isAlive, rename = renameSync } = {}) {
  required({ root, backup, leftovers })
  if (!existsSync(backup)) throw new Error(`no backup at ${backup}: nothing to restore`)
  const manifest = readManifest(backup)
  if (!force && manifest.pid && manifest.pid !== process.pid && alive(manifest.pid)) {
    throw new Error(`the round that moved your section memory aside (pid ${manifest.pid}) is still running: stop it first, or add --force`)
  }
  const away = sectionFolders(backup)
  const isNote = manifest.names === null ? () => false : name => !manifest.names.includes(name) || away.includes(name)
  const notes = moveAll(sectionFolders(root).filter(isNote), root, leftovers, rename)
  const restored = moveAll(away, backup, root, rename)
  // Only the manifest (and files such as desktop.ini) can be left: every section folder has moved out.
  if (sectionFolders(backup).length === 0) rmSync(backup, { recursive: true, force: true })
  return { restored, notes }
}

// The --restore-memory and end-of-round message: what came back, and where run notes were filed.
export const restoreMessage = ({ restored, notes }, leftovers) =>
  `section memory restored: ${restored.join(' ') || '(none)'}` + (notes.length ? `; run notes filed under ${leftovers}: ${notes.join(' ')}` : '')
