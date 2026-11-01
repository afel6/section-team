import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { saveFromEvent, finalAgentText } from '../hooks/subagent-stop.mjs'

// The tests pick the project through each event's cwd or an explicit env; this also keeps spawned hooks off the session's project.
delete process.env.CLAUDE_PROJECT_DIR

const SCRIPT = fileURLToPath(new URL('../hooks/subagent-stop.mjs', import.meta.url))
const tempDir = () => {
  const dir = join(realpathSync.native(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
  mkdirSync(dir, { recursive: true })
  return dir
}
const NOW = new Date(2026, 9, 12, 14, 32, 5)
const REPORT = '## REPORT · backend · 2026-10-12 14:32\nStatus: done\nJob: login api\n'

test('saves the REPORT of a team section', () => {
  const dir = tempDir()
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, last_assistant_message: `notes\n${REPORT}` }, NOW)
  assert.ok(file.endsWith(join('.team', 'reports', '2026-10-12', '143205-backend.md')))
  assert.equal(readFileSync(file, 'utf8'), REPORT)
})

test('ignores non-team agents, empty types and messages without a REPORT', () => {
  const dir = tempDir()
  assert.equal(saveFromEvent({ agent_type: 'general-purpose', cwd: dir, last_assistant_message: REPORT }, NOW), null)
  assert.equal(saveFromEvent({ agent_type: '', cwd: dir, last_assistant_message: REPORT }, NOW), null)
  assert.equal(saveFromEvent({ agent_type: 'security', cwd: dir, last_assistant_message: REPORT }, NOW), null)
  assert.equal(saveFromEvent({ agent_type: 'frontend', cwd: dir, last_assistant_message: REPORT }, NOW), null)
  assert.equal(saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, last_assistant_message: 'no report here' }, NOW), null)
  assert.equal(existsSync(join(dir, '.team')), false)
})

test('reads the SubagentHandback message from the transcript (no last_assistant_message)', () => {
  const dir = tempDir()
  const transcript = join(dir, 'agent.jsonl')
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'job' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working notes' }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }, { type: 'tool_use', name: 'SubagentHandback', input: { message: `notes\n${REPORT}` } }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
    '',
  ].join('\n'))
  assert.equal(finalAgentText(transcript), `notes\n${REPORT}`)
  assert.equal(finalAgentText(join(dir, 'missing.jsonl')), '')
  assert.equal(finalAgentText(undefined), '')
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, agent_transcript_path: transcript }, NOW)
  assert.equal(readFileSync(file, 'utf8'), REPORT)
})

test('without a handback, the last assistant text is used', () => {
  const dir = tempDir()
  const transcript = join(dir, 'agent.jsonl')
  writeFileSync(transcript, [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: REPORT }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } }),
    'not json',
  ].join('\n'))
  assert.equal(finalAgentText(transcript), REPORT)
})

const jsonl = (...rows) => rows.map(row => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n'
const user = content => ({ type: 'user', message: { content } })
const assistant = (...content) => ({ type: 'assistant', message: { content } })
const handback = message => ({ type: 'tool_use', name: 'SubagentHandback', input: { message } })
const toolResult = { type: 'tool_result', content: 'ok' }
const transcriptOf = (...rows) => {
  const file = join(tempDir(), 'agent.jsonl')
  writeFileSync(file, jsonl(...rows))
  return file
}

test('a reused agent does not hand back the previous job report', () => {
  const dir = tempDir()
  const transcript = transcriptOf(
    user('job 1'),
    assistant(handback(`notes\n${REPORT}`)),
    user([toolResult]),
    user('job 2 from the coordinator'),
    assistant({ type: 'text', text: 'job 2 answer, no report' }),
  )
  assert.equal(finalAgentText(transcript), 'job 2 answer, no report')
  assert.equal(saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, agent_transcript_path: transcript }, NOW), null)
  assert.equal(existsSync(join(dir, '.team')), false)
})

test('a user row with a text part starts a new job, tool results do not', () => {
  assert.equal(finalAgentText(transcriptOf(
    assistant(handback('old')), user([{ type: 'text', text: 'next job' }]), assistant({ type: 'text', text: 'fresh text' }),
  )), 'fresh text')
  assert.equal(finalAgentText(transcriptOf(
    user('job'), assistant(handback('mine')), user([toolResult, toolResult]), assistant({ type: 'text', text: 'wrapped up' }),
  )), 'mine')
  assert.equal(finalAgentText(transcriptOf(assistant(handback('old')), user('next job'))), '')
})

test('two handbacks in the same job: the last one wins', () => {
  assert.equal(finalAgentText(transcriptOf(
    user('job'), assistant(handback('first')), user([toolResult]), assistant(handback('second')), user([toolResult]),
  )), 'second')
})

const meta = content => ({ type: 'user', isMeta: true, message: { content } })
const coordinator = content => ({ type: 'user', isMeta: true, origin: { kind: 'coordinator' }, message: { content } })

test('a coordinator message starts a new job even though it is flagged isMeta', () => {
  const dir = tempDir()
  const transcript = transcriptOf(
    user('job 1'),
    assistant(handback(`notes\n${REPORT}`)),
    user([toolResult]),
    coordinator('The coordinator sent a message while you were working…'),
    assistant({ type: 'text', text: 'job 2 answer, no report' }),
  )
  assert.equal(finalAgentText(transcript), 'job 2 answer, no report')
  assert.equal(saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, agent_transcript_path: transcript }, NOW), null)
  assert.equal(finalAgentText(transcriptOf(assistant(handback('old')), { type: 'user', origin: { kind: 'coordinator' }, message: { content: [toolResult] } })), '')
})

test('hook feedback after a handback does not stop the scan (the report is still saved)', () => {
  const dir = tempDir()
  const transcript = transcriptOf(
    user('job'),
    assistant(handback(`notes\n${REPORT}`)),
    meta('[handback-send-enforce] You must hand your result back with SubagentHandback.'),
    assistant({ type: 'text', text: 'see above' }),
  )
  assert.equal(finalAgentText(transcript), `notes\n${REPORT}`)
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, agent_transcript_path: transcript }, NOW)
  assert.equal(readFileSync(file, 'utf8'), REPORT)
})

test('skill loads and system reminders mid-job are not job starts', () => {
  assert.equal(finalAgentText(transcriptOf(
    user('job'),
    assistant({ type: 'tool_use', name: 'Skill', input: {} }),
    user([toolResult]),
    meta([{ type: 'text', text: 'Base directory for this skill: C:\\skills\\x' }]),
    assistant(handback(`notes\n${REPORT}`)),
  )), `notes\n${REPORT}`)
  assert.equal(finalAgentText(transcriptOf(
    user('job'),
    assistant(handback('the handback')),
    user([toolResult]),
    meta('<system-reminder>be brief</system-reminder>'),
    meta([{ type: 'text', text: 'another reminder' }]),
  )), 'the handback')
  assert.equal(finalAgentText(transcriptOf(
    assistant(handback('job 1 handback')),
    user('job 2'),
    meta('<system-reminder>be brief</system-reminder>'),
    assistant({ type: 'text', text: 'job 2 text' }),
  )), 'job 2 text')
})

test('null rows and null parts are skipped without throwing', () => {
  const transcript = transcriptOf(
    { type: 'user', message: null },
    'null',
    '42',
    { type: 'assistant', message: null },
    assistant(null, { type: 'text', text: 'before' }),
    assistant(null, { type: 'text', text: 'last words' }, undefined),
    { type: 'user', message: { content: [null, toolResult] } },
  )
  assert.doesNotThrow(() => finalAgentText(transcript))
  assert.equal(finalAgentText(transcript), 'last words')
})

test('hook end to end, and malformed stdin exits 0 silently', () => {
  const dir = tempDir()
  const ok = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'section-team:docs', cwd: dir, last_assistant_message: '## REPORT · docs\nStatus: done\n' }), encoding: 'utf8' })
  assert.equal(ok.status, 0)
  assert.equal(ok.stdout, '')
  assert.ok(existsSync(join(dir, '.team', 'reports')))
  for (const input of ['', 'not json', '{}']) {
    const bad = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })
    assert.equal(bad.status, 0)
    assert.equal(bad.stdout, '')
  }
})


const UNGRADED = '## REPORT · backend · 2026-10-12 14:32\nStatus: done\nJob: login api\nChanged: src/api.mjs\nQuality: n/a (no code)\n'

test('every section REPORT is saved, graded or not: the gate runs at handback, not at stop', () => {
  const dir = tempDir()
  const run = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'section-team:backend', stop_hook_active: false, cwd: dir, last_assistant_message: UNGRADED }), encoding: 'utf8' })
  assert.equal(run.status, 0)
  assert.equal(run.stdout, '')
  assert.ok(existsSync(join(dir, '.team', 'reports')))
})

const UNGRADED_STATUS = '## REPORT · backend · 2026-10-12 14:32\nStatus: ungraded\nJob: login api\nChanged: src/api.mjs\nProblems: no Agent tool, so the reviewer gate could not run\n'
const runHook = event => spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ hook_event_name: 'SubagentStop', agent_type: 'section-team:backend', ...event }), encoding: 'utf8' })

test('a REPORT with Status: ungraded is saved as is, by the function and by the hook', () => {
  const dir = tempDir()
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: dir, last_assistant_message: `notes\n${UNGRADED_STATUS}` }, NOW)
  assert.equal(readFileSync(file, 'utf8'), UNGRADED_STATUS)
  const dir2 = tempDir()
  const run = runHook({ cwd: dir2, last_assistant_message: UNGRADED_STATUS })
  assert.equal(run.status, 0)
  assert.equal(run.stdout, '')
  const days = readdirSync(join(dir2, '.team', 'reports'))
  assert.equal(days.length, 1)
  const files = readdirSync(join(dir2, '.team', 'reports', days[0]))
  assert.equal(files.length, 1)
  assert.equal(readFileSync(join(dir2, '.team', 'reports', days[0], files[0]), 'utf8'), UNGRADED_STATUS)
})

test('a save that fails (the reports path is a file) prints one systemMessage line instead of failing silently', () => {
  const dir = tempDir()
  mkdirSync(join(dir, '.team'))
  writeFileSync(join(dir, '.team', 'reports'), 'a file where the reports folder should be')
  const run = runHook({ cwd: dir, last_assistant_message: REPORT })
  assert.equal(run.status, 0)
  assert.equal(run.stderr, '')
  assert.doesNotMatch(run.stdout, /\n/)
  const out = JSON.parse(run.stdout)
  assert.deepEqual(Object.keys(out), ['systemMessage'])
  assert.match(out.systemMessage, /^section-team subagent-stop: the REPORT was not saved: E[A-Z]+$/)
  assert.ok(!out.systemMessage.includes(dir), 'the message leaks the path')
})

test('CLAUDE_PROJECT_DIR picks where the REPORT is saved, not the event cwd', () => {
  const expected = project => join(project, '.team', 'reports', '2026-10-12', '143205-backend.md')
  const project = tempDir()
  const elsewhere = tempDir()
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: elsewhere, last_assistant_message: REPORT }, NOW, { CLAUDE_PROJECT_DIR: project })
  assert.equal(file, expected(project))
  assert.equal(existsSync(join(elsewhere, '.team')), false)
  const project2 = tempDir()
  assert.equal(saveFromEvent({ agent_type: 'section-team:backend', last_assistant_message: REPORT }, NOW, { CLAUDE_PROJECT_DIR: project2 }), expected(project2))
  const cwd = tempDir()
  assert.equal(saveFromEvent({ agent_type: 'section-team:backend', cwd, last_assistant_message: REPORT }, NOW, { CLAUDE_PROJECT_DIR: '' }), expected(cwd))
  assert.equal(saveFromEvent({ agent_type: 'section-team:backend', last_assistant_message: REPORT }, NOW, {}), null)
})

test('without CLAUDE_PROJECT_DIR a session in a repo subfolder saves at the repo root', () => {
  const root = tempDir()
  execFileSync('git', ['-C', root, 'init', '-q'])
  const sub = join(root, 'src')
  mkdirSync(sub)
  const file = saveFromEvent({ agent_type: 'section-team:backend', cwd: sub, last_assistant_message: REPORT }, NOW, {})
  assert.equal(file, join(root, '.team', 'reports', '2026-10-12', '143205-backend.md'))
  assert.equal(existsSync(join(sub, '.team')), false)
})
