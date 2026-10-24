import { execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim() || null
  } catch {
    return null
  }
}

export function projectRoot(cwd) {
  const common = git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
  return common && /[\\/]\.git$/.test(common) ? resolve(dirname(common)) : resolve(cwd)
}

export function excludeFile(cwd) {
  return git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'])
}

export function ensureExcluded(cwd, root) {
  if (existsSync(join(root, '.team', 'keep-in-git'))) return false
  const file = excludeFile(cwd)
  if (!file) return false
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split(/\r?\n/).some(line => line.trim() === '.team/')) return false
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, (current === '' || current.endsWith('\n') ? '' : '\n') + '.team/\n')
  return true
}

const NOTES_HEADER = '# Team notes — one line per note: <file> — <owner section> — <one-line summary> — <date>\n'

// Creates the notes index only when missing (flag 'wx'), so a section's edits to it are never overwritten.
export function ensureNotes(root) {
  const dir = join(root, '.team', 'notes')
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(join(dir, 'INDEX.md'), NOTES_HEADER, { encoding: 'utf8', flag: 'wx' })
    return true
  } catch (err) {
    if (err.code === 'EEXIST') return false
    throw err
  }
}

export const PRUNE_MS = 7 * 24 * 60 * 60 * 1000

// Deletes only regular *.json files in the status folder that are older than PRUNE_MS. A missing folder, or a file another session removed first, is nothing to do.
export function pruneStatus(dir, now = Date.now()) {
  let names
  try {
    names = readdirSync(dir)
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  for (const name of names.filter(n => n.endsWith('.json'))) {
    const file = join(dir, name)
    try {
      const info = lstatSync(file)
      if (info.isFile() && now - info.mtimeMs > PRUNE_MS) unlinkSync(file)
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }
}

const pad = n => String(n).padStart(2, '0')

export function stamp(now) {
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`,
  }
}

export function writeReport(root, id, text, now = new Date()) {
  const { date, time } = stamp(now)
  const dir = join(root, '.team', 'reports', date)
  mkdirSync(dir, { recursive: true })
  const body = text.endsWith('\n') ? text : text + '\n'
  for (let n = 1; n < 1000; n++) {
    const file = join(dir, `${time}-${id}${n === 1 ? '' : `-${n}`}.md`)
    try {
      const fd = openSync(file, 'wx')
      writeSync(fd, body)
      closeSync(fd)
      return file
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }
  throw new Error(`section-team: over 999 reports for ${id} in one second`)
}

// Only names writeReport can produce: the path goes into trusted session context, so a committed file must not shape it.
const SUMMARY_NAME = /^(\d{6})-supervisor-summary(?:-(\d+))?\.md$/

export function latestSummary(root, now = new Date()) {
  const base = join(root, '.team', 'reports')
  if (!existsSync(base)) return null
  const today = stamp(now).date
  const days = readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today).sort().reverse()
  for (const day of days) {
    let best = null
    for (const name of readdirSync(join(base, day))) {
      const match = SUMMARY_NAME.exec(name)
      if (!match) continue
      const time = match[1]
      const n = Number(match[2] ?? 1)
      if (!best || time > best.time || (time === best.time && n > best.n)) best = { name, time, n }
    }
    if (best) return join(base, day, best.name)
  }
  return null
}

export function isMainModule(moduleUrl) {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return moduleUrl === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

export async function readStdinJson() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}
