import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildContext } from '../hooks/session-start.mjs'
import { writeReport, excludeFile } from '../hooks/lib/paths.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/session-start.mjs', import.meta.url))
const BRIEF = fileURLToPath(new URL('../brief/supervisor.md', import.meta.url))
const repo = () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['-C', dir, 'init', '-q'])
  return dir
}
const run = input => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })

test('brief starts with the marker and fits the limit', () => {
  const brief = readFileSync(BRIEF, 'utf8')
  assert.ok(brief.startsWith('[section-team supervisor]'))
  assert.ok(brief.length < 10000, `brief is ${brief.length} chars`)
})

test('brief sets the small-task threshold and sends bigger tasks to builders plus testing', () => {
  const brief = readFileSync(BRIEF, 'utf8')
  assert.ok(brief.includes('about 150 lines'))
  assert.ok(brief.includes('plus the testing section'))
  assert.ok(!brief.includes('touches at most 1 file'))
})

test('brief wakes testing with a single builder, and testing and docs do not count toward the 3-builder plan gate', () => {
  const brief = readFileSync(BRIEF, 'utf8')
  assert.ok(brief.includes('wake that builder plus the testing section'))
  assert.ok(brief.includes('testing, docs and advisors not counted'))
})

test('context names the latest summary and excludes .team/', () => {
  const dir = repo()
  const summary = writeReport(dir, 'supervisor-summary', 'x', new Date(2026, 9, 12, 9, 0, 0))
  const context = buildContext(dir)
  assert.ok(context.startsWith('[section-team supervisor]'))
  assert.ok(context.includes(summary))
  assert.ok(readFileSync(excludeFile(dir), 'utf8').includes('.team/'))
})

test('hook prints SessionStart additionalContext', () => {
  const dir = repo()
  const result = run(JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: dir }))
  assert.equal(result.status, 0)
  const out = JSON.parse(result.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith('[section-team supervisor]'))
})

test('empty or malformed stdin: exit 0, no output', () => {
  for (const input of ['', 'not json', '{}']) {
    const result = run(input)
    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
  }
})

const MARKER = '[section-team supervisor]'
const startInput = cwd => JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd })
const quietStderr = fn => {
  const lines = []
  const original = process.stderr.write
  process.stderr.write = chunk => { lines.push(String(chunk)); return true }
  try {
    return { value: fn(), lines }
  } finally {
    process.stderr.write = original
  }
}
const breakExclude = dir => {
  const file = excludeFile(dir)
  rmSync(file, { force: true })
  mkdirSync(file, { recursive: true })
}
const breakSummaryScan = dir => {
  mkdirSync(join(dir, '.team', 'reports'), { recursive: true })
  writeFileSync(join(dir, '.team', 'reports', '2026-01-01'), 'a file where a day folder should be')
}

test('a failing exclude update still returns the brief, with one line on stderr', () => {
  const dir = repo()
  breakExclude(dir)
  const { value, lines } = quietStderr(() => buildContext(dir))
  assert.ok(value.startsWith(MARKER))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^section-team session-start: [^\n]+\n$/)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('a failing summary scan still returns the brief, with one line on stderr', () => {
  const dir = repo()
  breakSummaryScan(dir)
  const { value, lines } = quietStderr(() => buildContext(dir))
  assert.ok(value.startsWith(MARKER))
  assert.ok(!value.includes('Last team summary'))
  assert.equal(lines.length, 1)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  const out = JSON.parse(result.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart')
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('the hook leaves .team/notes/INDEX.md behind', () => {
  const dir = repo()
  assert.equal(run(startInput(dir)).status, 0)
  assert.ok(readFileSync(join(dir, '.team', 'notes', 'INDEX.md'), 'utf8').startsWith('# Team notes'))
})

test('a notes folder that cannot be created still returns the brief, with one line on stderr', () => {
  const dir = repo()
  mkdirSync(join(dir, '.team'), { recursive: true })
  writeFileSync(join(dir, '.team', 'notes'), 'a file where the notes folder should be')
  const { value, lines } = quietStderr(() => buildContext(dir))
  assert.ok(value.startsWith(MARKER))
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^section-team session-start: notes folder failed: [^\n]+\n$/)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(result.stderr.trim().split('\n').length, 1)
})

test('a healthy run writes nothing to stderr', () => {
  const dir = repo()
  assert.equal(run(startInput(dir)).stderr, '')
})
