import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { projectRoot, excludeFile, ensureExcluded, stamp, writeReport, latestSummary } from '../hooks/lib/paths.mjs'

const tempDir = () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
  mkdirSync(dir, { recursive: true })
  return dir
}
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
const repo = () => {
  const dir = tempDir()
  git(dir, 'init', '-q')
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}
const same = (a, b) => assert.equal(resolve(a).toLowerCase(), resolve(b).toLowerCase())
const NOW = new Date(2026, 9, 12, 14, 32, 5)

test('non-repo: root is cwd, no exclude', () => {
  const dir = tempDir()
  same(projectRoot(dir), dir)
  assert.equal(excludeFile(dir), null)
  assert.equal(ensureExcluded(dir, dir), false)
})

test('repo: root is the checkout and exclude is added once', () => {
  const dir = repo()
  const sub = join(dir, 'src', 'deep')
  mkdirSync(sub, { recursive: true })
  same(projectRoot(sub), dir)
  assert.equal(ensureExcluded(sub, dir), true)
  assert.equal(ensureExcluded(sub, dir), false)
  const lines = readFileSync(excludeFile(dir), 'utf8').split(/\r?\n/).filter(l => l.trim() === '.team/')
  assert.equal(lines.length, 1)
})

test('keep-in-git marker skips the exclude', () => {
  const dir = repo()
  mkdirSync(join(dir, '.team'), { recursive: true })
  writeFileSync(join(dir, '.team', 'keep-in-git'), '')
  assert.equal(ensureExcluded(dir, dir), false)
  assert.ok(!readFileSync(excludeFile(dir), 'utf8').includes('.team/'))
})

test('worktree: root and exclude point at the main checkout', () => {
  const dir = repo()
  const wt = join(dir, '..', 'wt')
  git(dir, 'worktree', 'add', '-q', wt)
  same(projectRoot(wt), dir)
  same(excludeFile(wt), excludeFile(dir))
})

test('stamp uses local time', () => {
  assert.deepEqual(stamp(NOW), { date: '2026-10-12', time: '143205' })
})

test('writeReport never overwrites', () => {
  const dir = tempDir()
  const a = writeReport(dir, 'backend', 'one', NOW)
  const b = writeReport(dir, 'backend', 'two', NOW)
  const c = writeReport(dir, 'backend', 'three', NOW)
  assert.ok(a.endsWith(join('2026-10-12', '143205-backend.md')))
  assert.ok(b.endsWith('143205-backend-2.md'))
  assert.ok(c.endsWith('143205-backend-3.md'))
  assert.equal(readFileSync(a, 'utf8'), 'one\n')
})

test('utf-8 report text is saved byte-exact', () => {
  const dir = tempDir()
  const text = '## REPORT · docs\nJob: توثيق واجهة الدخول ✓\n'
  assert.equal(readFileSync(writeReport(dir, 'docs', text, NOW), 'utf8'), text)
})

test('latestSummary picks the newest summary across days', () => {
  const dir = tempDir()
  assert.equal(latestSummary(dir), null)
  writeReport(dir, 'supervisor-summary', 'old', new Date(2026, 9, 11, 9, 0, 0))
  const newest = writeReport(dir, 'supervisor-summary', 'new', new Date(2026, 9, 12, 8, 0, 0))
  writeReport(dir, 'backend', 'not a summary', new Date(2026, 9, 12, 23, 0, 0))
  same(latestSummary(dir), newest)
  assert.ok(existsSync(newest))
})
