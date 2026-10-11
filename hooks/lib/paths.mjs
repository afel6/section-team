import { execFileSync } from 'node:child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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

export function latestSummary(root) {
  const base = join(root, '.team', 'reports')
  if (!existsSync(base)) return null
  const days = readdirSync(base).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()
  for (const day of days) {
    const file = readdirSync(join(base, day)).filter(n => n.endsWith('-supervisor-summary.md')).sort().reverse()[0]
    if (file) return join(base, day, file)
  }
  return null
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
