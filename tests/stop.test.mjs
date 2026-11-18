import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { saveSummary } from '../hooks/stop.mjs'

// The tests pick the project through each event's cwd or an explicit env; this also keeps spawned hooks off the session's project.
delete process.env.CLAUDE_PROJECT_DIR

const SCRIPT = fileURLToPath(new URL('../hooks/stop.mjs', import.meta.url))
const HOOKS_JSON = fileURLToPath(new URL('../hooks/hooks.json', import.meta.url))
const FIXTURE = fileURLToPath(new URL('./fixtures/main-transcript-tail.jsonl', import.meta.url))
// The fixture's last assistant text, and the status line it gave the user earlier, after a hand-back.
const FIXTURE_FINAL = '## Team summary\n- backend ✅ done: made-up cart endpoint, Quality 9/10\n- testing ✅ done: made-up checks pass, Quality 9/10\nAgreements: the cart total is in cents.\nNext steps: none.'
const FIXTURE_STATUS = 'Backend ✅ passed its gate (Quality 9); testing runs next.'
const NOW = new Date(2026, 9, 12, 14, 32, 5)
const LATER = new Date(2026, 9, 12, 14, 40, 0)
const SUMMARY = 'All done.\n\n## Team summary\n- backend ✅ done: login api, Quality 9/10\nNext steps: none.\n'
const temps = []

const tempDir = () => {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-stop-')))
  temps.push(parent)
  const dir = join(parent, 'with space')
  mkdirSync(dir)
  return dir
}
const summaries = dir => {
  const base = join(dir, '.team', 'reports')
  if (!existsSync(base)) return []
  return readdirSync(base).flatMap(day => readdirSync(join(base, day)).map(name => join(base, day, name)))
}
const runHook = (input, options = {}) => spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8', ...options })

after(() => temps.forEach(dir => rmSync(dir, { recursive: true, force: true })))

test('a main-session message with the heading is saved as one summary file holding exactly that text', () => {
  const dir = tempDir()
  const file = saveSummary({ hook_event_name: 'Stop', cwd: dir, last_assistant_message: SUMMARY }, NOW, {})
  assert.equal(file, join(dir, '.team', 'reports', '2026-10-12', '143205-supervisor-summary.md'))
  assert.equal(readFileSync(file, 'utf8'), SUMMARY)
  assert.deepEqual(summaries(dir), [file])
})

test('the heading is a line of one to three # and the words Team summary, nothing else on it', () => {
  for (const heading of ['# Team summary', '## Team summary', '### Team summary']) {
    const dir = tempDir()
    assert.notEqual(saveSummary({ cwd: dir, last_assistant_message: `Done.\r\n${heading}\r\n- docs ✅ done` }, NOW, {}), null, heading)
  }
  for (const text of ['#### Team summary\n- x', '## Team summary of the day\n- x', 'See ## Team summary\n- x', '## team summary\n- x', '##Team summary\n- x']) {
    const dir = tempDir()
    assert.equal(saveSummary({ cwd: dir, last_assistant_message: text }, NOW, {}), null, text)
    assert.equal(existsSync(join(dir, '.team')), false, text)
  }
})

test('an ordinary answer, a section event and an event with no usable project folder write nothing', () => {
  const dir = tempDir()
  assert.equal(saveSummary({ cwd: dir, last_assistant_message: 'Backend ✅ passed; testing runs next.' }, NOW, {}), null)
  assert.equal(saveSummary({ cwd: dir, agent_type: 'section-team:backend', last_assistant_message: SUMMARY }, NOW, {}), null)
  assert.equal(saveSummary({ cwd: dir, agent_type: 'section-team:testing', last_assistant_message: SUMMARY }, NOW, {}), null)
  assert.equal(existsSync(join(dir, '.team')), false)
  // Run from a fresh folder, so a wrong save lands there and not in the repo that runs the tests.
  const original = process.cwd()
  const folder = tempDir()
  process.chdir(folder)
  try {
    assert.equal(saveSummary({ last_assistant_message: SUMMARY }, NOW, {}), null)
    assert.equal(saveSummary({ cwd: '', last_assistant_message: SUMMARY }, NOW, {}), null)
    assert.equal(saveSummary({ cwd: '.', last_assistant_message: SUMMARY }, NOW, { CLAUDE_PROJECT_DIR: 'rel' }), null)
    assert.deepEqual(readdirSync(folder), [], 'a summary was written into the hook process folder')
  } finally {
    process.chdir(original)
  }
})

test('CLAUDE_PROJECT_DIR picks where the summary is saved, not the event cwd', () => {
  const project = tempDir()
  const elsewhere = tempDir()
  const file = saveSummary({ cwd: elsewhere, last_assistant_message: SUMMARY }, NOW, { CLAUDE_PROJECT_DIR: project })
  assert.equal(file, join(project, '.team', 'reports', '2026-10-12', '143205-supervisor-summary.md'))
  assert.equal(existsSync(join(elsewhere, '.team')), false)
})

test('with no last_assistant_message the summary comes from the transcript: its final message, not an earlier status line', () => {
  const dir = tempDir()
  const file = saveSummary({ hook_event_name: 'Stop', cwd: dir, transcript_path: FIXTURE }, NOW, {})
  assert.equal(readFileSync(file, 'utf8'), `${FIXTURE_FINAL}\n`)
  assert.ok(!readFileSync(file, 'utf8').includes(FIXTURE_STATUS))
  const empty = tempDir()
  assert.notEqual(saveSummary({ cwd: empty, last_assistant_message: '', transcript_path: FIXTURE }, NOW, {}), null, 'an empty message falls back to the transcript')
  const missing = tempDir()
  assert.equal(saveSummary({ cwd: missing, transcript_path: join(missing, 'none.jsonl') }, NOW, {}), null)
  assert.equal(existsSync(join(missing, '.team')), false)
})

test('the same text twice writes one file; a new text after it writes a second', () => {
  const dir = tempDir()
  const text = SUMMARY.trimEnd()
  assert.notEqual(saveSummary({ cwd: dir, last_assistant_message: text }, NOW, {}), null)
  assert.equal(saveSummary({ cwd: dir, last_assistant_message: text }, LATER, {}), null)
  assert.equal(saveSummary({ cwd: dir, last_assistant_message: text }, NOW, {}), null)
  assert.equal(summaries(dir).length, 1)
  const fromTranscript = tempDir()
  assert.notEqual(saveSummary({ cwd: fromTranscript, transcript_path: FIXTURE }, NOW, {}), null)
  assert.equal(saveSummary({ cwd: fromTranscript, transcript_path: FIXTURE }, LATER, {}), null)
  assert.equal(summaries(fromTranscript).length, 1)
  const next = saveSummary({ cwd: dir, last_assistant_message: `${text}\n- docs ✅ done` }, LATER, {})
  assert.equal(next, join(dir, '.team', 'reports', '2026-10-12', '144000-supervisor-summary.md'))
  assert.equal(summaries(dir).length, 2)
})

test('hook end to end: a summary is saved silently, an ordinary stop stays silent', () => {
  const dir = tempDir()
  const ok = runHook(JSON.stringify({ hook_event_name: 'Stop', cwd: dir, last_assistant_message: SUMMARY }))
  assert.equal(ok.status, 0)
  assert.equal(ok.stderr, '')
  assert.equal(ok.stdout, '')
  assert.deepEqual(summaries(dir).map(file => readFileSync(file, 'utf8')), [SUMMARY])
  for (const input of ['{}', JSON.stringify({ cwd: dir, last_assistant_message: 'just an answer ✅' })]) {
    const quiet = runHook(input)
    assert.equal(quiet.status, 0, input)
    assert.equal(quiet.stderr, '', input)
    assert.equal(quiet.stdout, '', input)
  }
  assert.equal(summaries(dir).length, 1)
})

test('input that is not JSON gives one notice line and exit 0', () => {
  for (const input of ['', 'not json']) {
    const run = runHook(input)
    assert.equal(run.status, 0, JSON.stringify(input))
    assert.equal(run.stderr, '', JSON.stringify(input))
    assert.equal(run.stdout, JSON.stringify({ systemMessage: 'section-team stop: skipped: the hook input is not JSON, so no summary was saved' }), JSON.stringify(input))
  }
})

test('a summary whose input has no absolute cwd gives one skip line and exit 0; other stops with no cwd stay silent', () => {
  // Run in a fresh folder, so a wrong save lands there and not in the repo that runs the tests.
  const folder = tempDir()
  const NO_CWD = JSON.stringify({ systemMessage: 'section-team stop: skipped: the hook input has no absolute cwd, so the summary was not saved' })
  for (const event of [{ last_assistant_message: SUMMARY }, { cwd: '', last_assistant_message: SUMMARY }, { cwd: 'rel', last_assistant_message: SUMMARY }, { transcript_path: FIXTURE }]) {
    const run = runHook(JSON.stringify({ hook_event_name: 'Stop', ...event }), { cwd: folder })
    assert.equal(run.status, 0, JSON.stringify(event))
    assert.equal(run.stderr, '', JSON.stringify(event))
    assert.equal(run.stdout, NO_CWD, JSON.stringify(event))
  }
  for (const event of [{ last_assistant_message: 'just an answer ✅' }, { agent_type: 'section-team:backend', last_assistant_message: SUMMARY }]) {
    const run = runHook(JSON.stringify(event), { cwd: folder })
    assert.equal(run.status, 0, JSON.stringify(event))
    assert.equal(run.stdout, '', JSON.stringify(event))
  }
  assert.deepEqual(readdirSync(folder), [], 'a summary was written into the hook process folder')
})

test('a save that fails (the reports path is a file) prints one notice line with no path, and exit 0', () => {
  const dir = tempDir()
  mkdirSync(join(dir, '.team'))
  writeFileSync(join(dir, '.team', 'reports'), 'a file where the reports folder should be')
  const run = runHook(JSON.stringify({ hook_event_name: 'Stop', cwd: dir, last_assistant_message: SUMMARY }))
  assert.equal(run.status, 0)
  assert.equal(run.stderr, '')
  assert.doesNotMatch(run.stdout, /\n/)
  const out = JSON.parse(run.stdout)
  assert.deepEqual(Object.keys(out), ['systemMessage'])
  assert.match(out.systemMessage, /^section-team stop: the summary was not saved: E[A-Z]+$/)
  assert.ok(!out.systemMessage.includes(dir), 'the message leaks the path')
})

test('hooks.json runs the script on Stop like the other hooks', () => {
  const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8')).hooks
  assert.deepEqual(hooks.Stop, [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs"' }] }])
})
