import { execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
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

// Each wanted exclude line, with the forms that already count as it: Claude Code's own runtime block writes the memory pattern without the slash.
// The memory pattern starts with **/ because a pattern with a slash in the middle only matches at the repo root, and sessions start in subfolders too.
const TEAM_FORMS = ['.team/']
const MEMORY_FORMS = ['**/.claude/agent-memory-local/', '**/.claude/agent-memory-local']

// Appends the missing lines (.team/ unless .team/keep-in-git exists, and the section memory folders always) in one write,
// in the file's own line ending; existing lines are never rewritten. True when something was added; false outside git.
export function ensureExcluded(cwd, root) {
  const file = excludeFile(cwd)
  if (!file) return false
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  const present = new Set(current.split(/\r?\n/).map(line => line.trim()))
  const wanted = existsSync(join(root, '.team', 'keep-in-git')) ? [MEMORY_FORMS] : [TEAM_FORMS, MEMORY_FORMS]
  const missing = wanted.filter(forms => !forms.some(form => present.has(form))).map(([line]) => line)
  if (missing.length === 0) return false
  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, (current === '' || current.endsWith('\n') ? '' : eol) + missing.map(line => line + eol).join(''))
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

// Only names shaped like writeReport's, with a collision suffix of at most 3 digits: the path goes into trusted session context, so a committed file must not shape or lengthen it.
const SUMMARY_NAME = /^(\d{6})-supervisor-summary(?:-(\d{1,3}))?\.md$/

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

// The folder a hook works from: the project the session started in (CLAUDE_PROJECT_DIR, which Claude Code sets for hooks),
// else the hook input's cwd, which moves when the session changes folder; null when neither is usable.
// Only an absolute path counts: a relative one ('', '.') would follow the hook process's own folder.
export function projectDirOf(input, env = process.env) {
  const usable = dir => typeof dir === 'string' && isAbsolute(dir)
  if (usable(env.CLAUDE_PROJECT_DIR)) return env.CLAUDE_PROJECT_DIR
  return usable(input?.cwd) ? input.cwd : null
}

// One line for the user: the error code alone (so no path reaches the screen), or the message on one line.
export const lineOf = err => err?.code ?? String(err?.message ?? err).replace(/\s+/g, ' ').trim()

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
