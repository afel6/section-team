import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildContext } from '../hooks/session-start.mjs'
import { writeReport, excludeFile } from '../hooks/lib/paths.mjs'
import { PASS_RULE } from '../scripts/gen-agents.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/session-start.mjs', import.meta.url))
const BRIEF = fileURLToPath(new URL('../brief/supervisor.md', import.meta.url))
const SPIKES = fileURLToPath(new URL('../docs/v3-spikes.md', import.meta.url))
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

test('brief: single-area work up to about 600 lines is built by the supervisor and gated; multi-area work wakes builders plus testing', () => {
  const brief = readFileSync(BRIEF, 'utf8')
  assert.ok(brief.includes('Single-area task'))
  assert.ok(brief.includes('about 600 lines'))
  assert.ok(brief.includes('build the code yourself'))
  assert.ok(brief.includes('wake only the testing section to write and run the tests'))
  assert.ok(brief.includes('then run the reviewer gate on your own changed files'))
  assert.ok(brief.includes('Multi-area work'))
  assert.ok(brief.includes('plus the testing section'))
  assert.ok(!brief.includes('about 150 lines'))
  assert.ok(!brief.includes('Do not build bigger tasks yourself'))
})

test('brief: testing and docs do not count toward the 3-builder plan gate', () => {
  const brief = readFileSync(BRIEF, 'utf8')
  assert.ok(brief.includes('testing, docs and advisors not counted'))
})

test('the injected brief hands per-job skills, uses notes, gates its own code and describes the board commands', () => {
  const brief = buildContext(repo())
  assert.ok(brief.startsWith('[section-team supervisor]'))
  assert.ok(brief.length < 10000, `brief is ${brief.length} chars`)
  for (const phrase of ['Skills for this job:', 'at most 4', '`.team/notes/`', 'Do not relay anything that belongs in a note.', '`section-team:reviewer`', '`section-team:reviewer` replaces `code-reviewer` for your own code.', PASS_RULE, '/chats', '/team']) {
    assert.ok(brief.includes(phrase), `brief lacks: ${phrase}`)
  }
  assert.ok(!brief.includes('opens automatically'))
  assert.ok(brief.includes("include the asker's agent id so the owner replies to it directly"))
  assert.ok(brief.includes("reply with the note's name"))
  assert.ok(!brief.includes('Sections cannot message each other'))
})

test('with S2 direct the brief tells the supervisor to list the awake agent ids in every job', () => {
  if (!/^S2: direct$/m.test(readFileSync(SPIKES, 'utf8'))) return
  const brief = buildContext(repo())
  assert.ok(brief.includes('the agent ids of the awake builder sections'))
  assert.ok(!brief.includes('the agent ids of the sections that are awake'))
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

test('a folder outside any git repo gets no .team/ folder, but still gets the brief', () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ct-nogit-'))), 'plain')
  mkdirSync(dir, { recursive: true })
  assert.equal(excludeFile(dir), null, 'the temp folder is inside a git repo')
  assert.ok(buildContext(dir).startsWith(MARKER))
  assert.equal(existsSync(join(dir, '.team')), false)
  const result = run(startInput(dir))
  assert.equal(result.status, 0)
  assert.ok(JSON.parse(result.stdout).hookSpecificOutput.additionalContext.startsWith(MARKER))
  assert.equal(existsSync(join(dir, '.team')), false)
  assert.equal(result.stderr, '')
})

test('session start deletes status files older than 7 days and nothing else', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ct-home-')))
  const dir = join(home, '.claude', 'section-team', 'sessions')
  mkdirSync(join(dir, 'old-dir.json'), { recursive: true })
  const DAY = 24 * 60 * 60 * 1000
  for (const [name, days] of [['old.json', 8], ['fresh.json', 1], ['old.txt', 8]]) {
    writeFileSync(join(dir, name), '{}')
    utimesSync(join(dir, name), new Date(Date.now() - days * DAY), new Date(Date.now() - days * DAY))
  }
  utimesSync(join(dir, 'old-dir.json'), new Date(Date.now() - 8 * DAY), new Date(Date.now() - 8 * DAY))
  assert.ok(buildContext(repo(), home).startsWith(MARKER))
  assert.equal(existsSync(join(dir, 'old.json')), false)
  for (const kept of ['fresh.json', 'old.txt', 'old-dir.json']) assert.ok(existsSync(join(dir, kept)), `${kept} was removed`)
  assert.ok(buildContext(repo(), join(home, 'no-such-home')).startsWith(MARKER))
})
