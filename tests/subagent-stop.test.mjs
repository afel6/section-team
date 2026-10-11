import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { saveFromEvent, finalAgentText } from '../hooks/subagent-stop.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/subagent-stop.mjs', import.meta.url))
const tempDir = () => {
  const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'ct-'))), 'with space')
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
