import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
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
