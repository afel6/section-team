import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { mkdtempSync, rmdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'code-explorer', run_in_background: false }), HOME), null)
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'planner', run_in_background: false }), HOME), null)
  assert.match(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'Explore' }), HOME), /read-only helpers/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'Plan' }), HOME), /read-only helpers/)
  assert.equal(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'architect', run_in_background: false }), HOME), null)
  assert.equal(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'section-team:scout', run_in_background: false }), HOME), null)
  assert.equal(decide(ev('section-team:data-scientist', 'Agent', { subagent_type: 'section-team:scout', run_in_background: false }), HOME), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'section-team:coder' }), HOME), /read-only helpers/)
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

test('guard still runs when the script is reached through a junction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ct-junction-'))
  const link = join(dir, 'hooks-link')
  symlinkSync(fileURLToPath(new URL('../hooks', import.meta.url)), link, 'junction')
  try {
    const run = spawnSync(process.execPath, [join(link, 'pre-tool-use.mjs')], { input: JSON.stringify(ev('section-team:ai-engineer', 'Bash', { command: 'ls' })), encoding: 'utf8' })
    assert.equal(run.status, 0)
    assert.match(run.stdout, /"permissionDecision":"deny"/)
  } finally {
    rmdirSync(link)
    rmdirSync(dir)
  }
})

test('bare-named agents are not advisors; only section-team: prefixed types are guarded', () => {
  assert.equal(decide(ev('ai-engineer', 'Bash'), HOME), null)
  assert.equal(decide(ev('data-scientist', 'Write', { file_path: join(PROJECT, 'src', 'a.ts') }), HOME), null)
})

test('memory folder must be exactly <id> or section-team-<id>', () => {
  assert.equal(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'ai-engineer', 'x.md') }), HOME), null)
  assert.equal(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'section-team-ai-engineer', 'x.md') }), HOME), null)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'foo-ai-engineer', 'x.md') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory', 'xai-engineer', 'x.md') }), HOME), /memory folder/)
  assert.match(decide(ev('section-team:ai-engineer', 'Write', { file_path: join(HOME, '.claude', 'agent-memory') + '/ai-engineer/../backend/x.md' }), HOME), /memory folder/)
})

const handback = (agent_type, report) => ev(agent_type, 'SubagentHandback', { message: `work notes\n${report}` })
const REPORT_WITH = (status, changed, quality) => `## REPORT · backend · 2026-10-25 10:00\nStatus: ${status}\nJob: api\nChanged: ${changed}\n${quality ? `Quality: ${quality}\n` : ''}`

test('a builder cannot hand back changed code without a reviewer grade', () => {
  for (const reason of [
    decide(handback('section-team:backend', REPORT_WITH('done', 'src/api.mjs', 'n/a (no code)')), HOME),
    decide(handback('section-team:testing', REPORT_WITH('done', 'test/api.test.mjs', null)), HOME),
  ]) {
    assert.match(reason, /no reviewer grade/)
    assert.match(reason, /run_in_background: false/)
    assert.doesNotMatch(reason, /under the pass mark/)
  }
})

test('a builder cannot hand back a failing grade as done', () => {
  const reason = decide(handback('section-team:frontend', REPORT_WITH('done', 'public/app.js', '7/10 (reviewer, 1 fix round)')), HOME)
  assert.match(reason, /under the pass mark/)
  assert.match(reason, /Never SendMessage the earlier reviewer/)
  assert.match(reason, /start the Quality line with the final grade/)
  assert.doesNotMatch(reason, /no reviewer grade/)
  assert.equal(decide(handback('section-team:frontend', REPORT_WITH('partial', 'public/app.js', '7/10 (reviewer, 2 fix rounds)')), HOME), null)
  assert.equal(decide(handback('section-team:ai-engineer', REPORT_WITH('done', 'src/a.mjs', '7/10 (reviewer)')), HOME), null)
})

test('the handback gate lets graded, partial, blocked, docs-only, advisor and report-less handbacks through', () => {
  assert.equal(decide(handback('section-team:backend', REPORT_WITH('done', 'src/api.mjs', '8.5/10 (reviewer, 1 fix rounds)')), HOME), null)
  assert.equal(decide(handback('section-team:backend', REPORT_WITH('partial', 'src/api.mjs', 'not graded: reviewer unavailable')), HOME), null)
  assert.equal(decide(handback('section-team:backend', REPORT_WITH('blocked', 'src/api.mjs', null)), HOME), null)
  assert.equal(decide(handback('section-team:docs', REPORT_WITH('done', 'README.md', 'n/a (no code)')), HOME), null)
  assert.equal(decide(handback('section-team:ai-engineer', REPORT_WITH('done', 'src/api.mjs', null)), HOME), null)
  assert.equal(decide(ev('section-team:backend', 'SubagentHandback', { message: 'no report here' }), HOME), null)
  assert.equal(decide(ev(undefined, 'SubagentHandback', { message: REPORT_WITH('done', 'src/api.mjs', null) }), HOME), null)
})

test('a section must run its helpers in the foreground, so it never idles into a forced handback', () => {
  for (const who of ['section-team:testing', 'section-team:backend', 'section-team:ai-engineer']) {
    const helper = who === 'section-team:ai-engineer' ? 'section-team:scout' : 'section-team:coder'
    assert.match(decide(ev(who, 'Agent', { subagent_type: helper }), HOME), /run_in_background: false/)
    assert.match(decide(ev(who, 'Agent', { subagent_type: helper, run_in_background: true }), HOME), /run_in_background: false/)
    assert.equal(decide(ev(who, 'Agent', { subagent_type: helper, run_in_background: false }), HOME), null)
  }
  assert.match(decide(ev('section-team:frontend', 'Agent', { subagent_type: 'react-reviewer', model: 'sonnet' }), HOME), /run helpers in the foreground/)
  assert.equal(decide(ev(undefined, 'Agent', { subagent_type: 'section-team:backend' }), HOME), null)
  for (const helper of ['section-team:coder', 'section-team:reviewer', 'section-team:scout']) assert.equal(decide(ev(helper, 'Agent', { subagent_type: 'Explore' }), HOME), null)
  assert.match(decide(ev('section-team:backend', 'Agent', { subagent_type: 'section-team:coder', run_in_background: 'false' }), HOME), /run_in_background: false/)
  assert.match(decide(ev('section-team:ai-engineer', 'Agent', { subagent_type: 'section-team:coder', run_in_background: false }), HOME), /read-only helpers/)
})
