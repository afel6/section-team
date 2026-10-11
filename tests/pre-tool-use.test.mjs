import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { decide } from '../hooks/pre-tool-use.mjs'

const SCRIPT = fileURLToPath(new URL('../hooks/pre-tool-use.mjs', import.meta.url))
const HOME = join('C:', 'Users', 'Tester')
const PROJECT = join('C:', 'work', 'my app')
const MEMORY = join(HOME, '.claude', 'agent-memory', 'ai-engineer', 'MEMORY.md')
const ev = (agent_type, tool_name, tool_input = {}) => ({ agent_type, tool_name, tool_input, cwd: PROJECT })

test('builders and the main session are never blocked', () => {
  assert.equal(decide(ev('section-team:backend', 'Bash', { command: 'rm -rf x' }), HOME), null)
  assert.equal(decide(ev(undefined, 'Write', { file_path: 'a.txt' }), HOME), null)
})

test('advisors cannot use shell or notebook tools', () => {
  for (const tool of ['Bash', 'PowerShell', 'NotebookEdit']) assert.match(decide(ev('section-team:ai-engineer', tool), HOME), /read-only/)
})

test('advisors may write only inside their own memory folder', () => {
  assert.equal(decide(ev('section-team:ai-engineer', 'Write', { file_path: MEMORY }), HOME), null)
  assert.equal(decide(ev('section-team:ai-engineer', 'Edit', { file_path: join(HOME, '.claude', 'agent-memory', 'section-team-ai-engineer', 'x.md') }), HOME), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(PROJECT, 'src', 'a.ts') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'data-scientist', 'x.md') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:data-scientist', 'Edit', { file_path: join(HOME, '.claude', 'agent-memory', '..', 'settings.json') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:data-scientist', 'Write', {}), HOME), /memory folder/)
})

test('advisors may only spawn read-only helper types', () => {
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'code-explorer' }), HOME), null)
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'planner' }), HOME), null)
  assert.match(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'Explore' }), HOME), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'Plan' }), HOME), /read-only helpers/)
  assert.equal(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'architect' }), HOME), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'general-purpose' }), HOME), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', {}), HOME), /read-only helpers/)
})

test('hook prints a deny decision, and stays silent otherwise', () => {
  const deny = spawnSync(process.execPath, [SCRIPT], { input: JSON.stringify({ hook_event_name: 'PreToolUse', ...ev('section-team:ai-engineer', 'Bash', { command: 'ls' }) }), encoding: 'utf8' })
  assert.equal(deny.status, 0)
  const out = JSON.parse(deny.stdout)
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse')
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny')
  for (const input of ['', 'not json', JSON.stringify(ev('section-team:backend', 'Bash'))]) {
    const quiet = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' })
    assert.equal(quiet.status, 0)
    assert.equal(quiet.stdout, '')
  }
})
