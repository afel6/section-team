import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HEAD_CONTEXT_LIMIT, headContextRule } from '../hooks/lib/head-context.mjs'
import { ADVISOR_IDS, BUILDER_IDS } from '../hooks/lib/report.mjs'

const SESSION = 'sid-1'
const TARGET = 'a1b2c3'
const KB = 1024
const OVER = 450000

const made = []
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }) })

const assistant = (input, read = 0, created = 0) => JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: created, output_tokens: 7 } } })
const user = (size = 10) => JSON.stringify({ type: 'user', text: 'x'.repeat(size) })
const metaOf = agentType => JSON.stringify({ agentType })
const lines = (...all) => `${all.join('\n')}\n`

// Lays out a session as Claude Code does; a null part leaves that file out.
function eventFor({ jsonl = lines(assistant(OVER)), meta = metaOf('section-team:backend') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-head-'))
  made.push(dir)
  const subagents = join(dir, SESSION, 'subagents')
  mkdirSync(subagents, { recursive: true })
  if (jsonl !== null) writeFileSync(join(subagents, `agent-${TARGET}.jsonl`), jsonl)
  if (meta !== null) writeFileSync(join(subagents, `agent-${TARGET}.meta.json`), meta)
  return { tool_name: 'SendMessage', tool_input: { to: TARGET, message: 'one more job' }, session_id: SESSION, transcript_path: join(dir, `${SESSION}.jsonl`) }
}

test('the limit is the planned 300000 tokens', () => {
  assert.equal(HEAD_CONTEXT_LIMIT, 300000)
})

test('a builder head over the limit is refused, with the exact wording', () => {
  assert.equal(headContextRule(eventFor()), 'section-team: the backend section is at 450K tokens of context, so resuming it costs far more than starting over. Start a fresh Agent call for this work and point it to the notes and its REPORT.')
})

test('every builder head is guarded', () => {
  for (const id of BUILDER_IDS) {
    const reason = headContextRule(eventFor({ meta: metaOf(`section-team:${id}`) }))
    assert.ok(reason?.startsWith(`section-team: the ${id} section is at 450K`), id)
  }
})

test('context is input, cache read and cache creation added up, and only above the limit counts', () => {
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(100001, 100000, 100000)) })), /at 300K tokens/)
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(1, 300000, 0)) })), /at 300K tokens/)
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(1, 0, 300000)) })), /at 300K tokens/)
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(100000, 100000, 100000)) })), null)
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(1000, 2000, 3000)) })), null)
})

test('output tokens do not count', () => {
  const usage = { input_tokens: 10, cache_read_input_tokens: 10, cache_creation_input_tokens: 10, output_tokens: 999999 }
  assert.equal(headContextRule(eventFor({ jsonl: lines(JSON.stringify({ type: 'assistant', message: { usage } })) })), null)
})

test('only the last assistant turn counts, and later lines of other types do not hide it', () => {
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(OVER), assistant(5000)) })), null, 'a compacted head is small again')
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(5000), assistant(OVER)) })), /at 450K/)
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(OVER), user(), user()) })), /at 450K/)
  const noUsage = JSON.stringify({ type: 'assistant', message: {} })
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(OVER), noUsage) })), /at 450K/)
  const notAssistant = JSON.stringify({ type: 'user', message: { usage: { input_tokens: 1 } } })
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(OVER), notAssistant) })), /at 450K/)
})

test('reviewer, helper, advisor and foreign targets are allowed at any size', () => {
  const types = ['section-team:reviewer', 'section-team:scout', 'section-team:coder', ...ADVISOR_IDS.map(id => `section-team:${id}`), 'Explore', 'other:backend', 'backend']
  for (const type of types) assert.equal(headContextRule(eventFor({ meta: metaOf(type) })), null, type)
})

test('a missing transcript or meta file allows, as does a target with no files such as main', () => {
  assert.equal(headContextRule(eventFor({ jsonl: null })), null)
  assert.equal(headContextRule(eventFor({ meta: null })), null)
  assert.equal(headContextRule(eventFor({ jsonl: null, meta: null })), null)
  assert.equal(headContextRule({ ...eventFor(), tool_input: { to: 'main', message: 'hi' } }), null)
})

test('a malformed tail allows', () => {
  const cases = {
    'garbage after an over-limit turn': lines(assistant(OVER), '{not json'),
    'a half-written last line': `${assistant(OVER)}\n{"type":"assist`,
    'only garbage': '\u0000\u0001 nope\n',
    'an empty file': '',
    'no assistant turn': lines(user(), user()),
    'a null line': lines('null'),
    'a non-object usage': lines(JSON.stringify({ type: 'assistant', message: { usage: 'lots' } })),
    'non-number token counts': lines(JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: '900000', cache_read_input_tokens: null } } })),
    'a usage with no known field': lines(JSON.stringify({ type: 'assistant', message: { usage: { tokens: 900000 } } })),
  }
  for (const [name, jsonl] of Object.entries(cases)) assert.equal(headContextRule(eventFor({ jsonl })), null, name)
})

test('a malformed meta file allows', () => {
  for (const meta of ['{not json', '', 'null', '[]', '{}', '{"agentType":5}']) assert.equal(headContextRule(eventFor({ meta })), null, meta)
})

test('a target that is a folder allows', () => {
  const e = eventFor({ jsonl: null })
  mkdirSync(join(e.transcript_path.replace(/\.jsonl$/, ''), 'subagents', `agent-${TARGET}.jsonl`))
  assert.equal(headContextRule(e), null)
})

test('an event without what the path needs allows, and a target cannot leave the subagents folder', () => {
  const e = eventFor()
  const broken = [
    { ...e, tool_input: undefined },
    { ...e, tool_input: { to: 5 } },
    { ...e, tool_input: { to: '' } },
    { ...e, tool_input: { to: `../subagents/agent-${TARGET}` } },
    { ...e, session_id: undefined },
    { ...e, session_id: '../x' },
    { ...e, transcript_path: undefined },
    { ...e, transcript_path: 5 },
  ]
  for (const event of broken) assert.equal(headContextRule(event), null, JSON.stringify(event.tool_input))
  assert.equal(headContextRule(undefined), null)
  assert.equal(headContextRule(null), null)
})

test('a large file: an over-limit turn beyond the last 256 KB is not read', () => {
  const jsonl = lines(assistant(OVER), user(257 * KB), user())
  assert.equal(headContextRule(eventFor({ jsonl })), null)
})

test('a large file: an over-limit turn inside the last 256 KB is found', () => {
  const jsonl = lines(user(300 * KB), assistant(OVER), user(250 * KB))
  assert.match(headContextRule(eventFor({ jsonl })), /at 450K/)
})

test('a large file: broken bytes at the start are not read', () => {
  const jsonl = lines('{not json', user(257 * KB), assistant(OVER))
  assert.match(headContextRule(eventFor({ jsonl })), /at 450K/)
})

test('a large file: the line the cut falls inside is dropped, not read as bad JSON', () => {
  const jsonl = lines(user(400 * KB), assistant(OVER))
  assert.match(headContextRule(eventFor({ jsonl })), /at 450K/)
})

test('a last line longer than the 256 KB window allows', () => {
  const huge = JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: OVER }, content: 'x'.repeat(300 * KB) } })
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(OVER), huge) })), null)
})
