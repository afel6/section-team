// Keeps the user's section-team agent memory out of the benchmark. Section agents load their memory from
// <config>/agent-memory/section-team-<id>/, so a team run would otherwise see notes from the user's own work
// (including notes about the benchmark tasks) and from earlier team runs. A round moves the user's folders into a
// backup, gives every team run empty section memory, files each run's new notes under its results folder, and moves
// the user's folders back at the end. Nothing is ever deleted: every step is a rename.
// The backup holds manifest.json { names, pid, startedAt }: the names are the user's folders, written before any move,
// so a restore can always tell the user's folders from run notes, however often it is run and wherever it stopped.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
export const MEMORY_ROOT = join(CONFIG_DIR, 'agent-memory')
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

const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Windows briefly locks a folder after a process exits (antivirus, the indexer): retry before giving up.
export function renameRetry(from, to, { rename = renameSync, wait = sleep } = {}) {
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
export const sameVolume = (a, b) => statSync(a).dev === statSync(b).dev

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
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeManifest(backup, manifest) {
  const path = join(backup, MANIFEST)
  writeFileSync(`${path}.tmp`, JSON.stringify(manifest))
  renameSync(`${path}.tmp`, path)
}

// Moves the user's section folders into backup and returns their names. Refuses while an earlier backup exists.
// If a move fails, the folders already moved are put back before the error is thrown.
export function backupSectionMemory({ root = MEMORY_ROOT, backup = MEMORY_BACKUP, pid = process.pid, rename = renameSync } = {}) {
  mkdirSync(dirname(backup), { recursive: true })
  try {
    mkdirSync(backup)
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
    throw new Error(`${backup} holds your section memory from an earlier round: run node bench/run.mjs --restore-memory first`)
  }
  const names = sectionFolders(root)
  writeManifest(backup, { names, pid, startedAt: new Date().toISOString() })
  try {
    return moveAll(names, root, backup, rename)
  } catch (err) {
    // No run has started, so root holds only the user's folders: the rollback files nothing as run notes.
    try {
      restoreSectionMemory({ root, backup, leftovers: `${backup}-leftover-${Date.now()}`, force: true, rename })
    } catch (rollbackErr) {
      throw new Error(`could not move your section memory aside (${err.code ?? err.message}) nor back (${rollbackErr.code ?? rollbackErr.message}): run node bench/run.mjs --restore-memory`, { cause: err })
    }
    throw new Error(`could not move your section memory aside (${err.code ?? err.message}); it is back in ${root}`, { cause: err })
  }
}

// Files the notes a team run wrote under <into>/section-memory/ (-2, -3 … on a rerun), so the next team run starts empty.
export function stashRunMemory({ root = MEMORY_ROOT, into, rename = renameSync }) {
  const names = sectionFolders(root)
  if (names.length === 0) return []
  let target = join(into, 'section-memory')
  for (let n = 2; existsSync(target); n++) target = join(into, `section-memory-${n}`)
  return moveAll(names, root, target, rename)
}

// Puts the user's folders back: every folder still in the backup returns to root, and any section folder in root
// that is not the user's (a run note, or a run's folder of the same name as one still in the backup) is filed
// under leftovers first. Safe to run again after it stopped half way. Refuses while the round that made the
// backup is still running, unless force.
export function restoreSectionMemory({ root = MEMORY_ROOT, backup = MEMORY_BACKUP, leftovers, force = false, alive = isAlive, rename = renameSync }) {
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
