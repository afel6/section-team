import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { constants } from 'node:buffer'
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HEAD_CONTEXT_LIMIT, headContextRule } from '../hooks/lib/head-context.mjs'
import { ADVISOR_IDS, BUILDER_IDS } from '../hooks/lib/report.mjs'

const SESSION = 'sid-1'
const TARGET = 'a1b2c3'
const KB = 1024
const OVER = 450000
const HANDBACK_ID = 'toolu_hb'
const READ_ID = 'toolu_read'

const made = []
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }) })

const usageOf = (input, read = 0, created = 0) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: created, output_tokens: 7 })
const TEXT = { type: 'text', text: 'All done.' }
const THINKING = { type: 'thinking', thinking: '' }
const READ_CALL = { type: 'tool_use', id: READ_ID, name: 'Read', input: { file_path: 'a.js' } }
const HANDBACK_CALL = { type: 'tool_use', id: HANDBACK_ID, name: 'SubagentHandback', input: { message: 'done' } }

const turn = (content, message = {}) => JSON.stringify({ type: 'assistant', message: { model: 'claude-opus-5-5', content, usage: usageOf(OVER), ...message } })
const assistant = (input, read = 0, created = 0) => turn([TEXT], { stop_reason: 'end_turn', usage: usageOf(input, read, created) })
const synthetic = (input = 0) => turn([TEXT], { model: '<synthetic>', stop_reason: 'stop_sequence', usage: usageOf(input) })
const toolResult = (id, extra = {}) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...extra }] } })
const handedBack = [turn([HANDBACK_CALL], { stop_reason: 'tool_use' }), toolResult(HANDBACK_ID)]
const refusedHandback = [turn([HANDBACK_CALL], { stop_reason: 'tool_use' }), toolResult(HANDBACK_ID, { is_error: true })]
const readCall = turn([READ_CALL], { stop_reason: 'tool_use' })
const user = (size = 10) => JSON.stringify({ type: 'user', text: 'x'.repeat(size) })
const userSays = content => JSON.stringify({ type: 'user', message: { content } })
const attachment = (size = 10) => JSON.stringify({ type: 'attachment', attachment: { type: 'note', text: 'x'.repeat(size) } })
const API_REQUEST = JSON.stringify({ type: 'api-request', request: { model: 'claude-opus-5-5' } })
const metaOf = agentType => JSON.stringify({ agentType })
const lines = (...all) => `${all.flat().join('\n')}\n`

function subagentsDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-head-'))
  made.push(dir)
  const subagents = join(dir, SESSION, 'subagents')
  mkdirSync(subagents, { recursive: true })
  return { dir, subagents }
}

const sendMessage = dir => ({ tool_name: 'SendMessage', tool_input: { to: TARGET, message: 'one more job' }, session_id: SESSION, transcript_path: join(dir, `${SESSION}.jsonl`) })

// Lays out a session as Claude Code does; a null part leaves that file out.
function eventFor({ jsonl = lines(assistant(OVER)), meta = metaOf('section-team:backend') } = {}) {
  const { dir, subagents } = subagentsDir()
  if (jsonl !== null) writeFileSync(join(subagents, `agent-${TARGET}.jsonl`), jsonl)
  if (meta !== null) writeFileSync(join(subagents, `agent-${TARGET}.meta.json`), meta)
  return sendMessage(dir)
}

test('the limit is the planned 300000 tokens', () => {
  assert.equal(HEAD_CONTEXT_LIMIT, 300000)
})

test('the supervisor, whose call has no agent_type, is told to start a fresh Agent call', () => {
  const said = 'section-team: the backend section has finished at 450K tokens of context, so resuming it costs far more than starting over. Start a fresh Agent call for this work and point it to the notes, its REPORT if it left one, and its changed files (`git status`).'
  assert.equal(headContextRule(eventFor()), said)
  assert.equal(headContextRule({ ...eventFor(), agent_type: '' }), said)
})

test('a section or helper, whose call has an agent_type, is sent to main and never told to start a section', () => {
  for (const agentType of ['section-team:frontend', 'section-team:coder']) {
    assert.equal(headContextRule({ ...eventFor(), agent_type: agentType }), 'section-team: the backend section has finished at 450K tokens of context, so resuming it costs far more than starting over. Do not wake it or another section yourself: SendMessage `main` with your request, and the supervisor starts a fresh section.', agentType)
  }
})

test('every builder head is guarded', () => {
  for (const id of BUILDER_IDS) {
    const reason = headContextRule(eventFor({ meta: metaOf(`section-team:${id}`) }))
    assert.ok(reason?.startsWith(`section-team: the ${id} section has finished at 450K`), id)
  }
})

test('every shape a head finishes in is refused over the limit', () => {
  const finished = {
    'text that ended the turn': lines(assistant(OVER)),
    'text with no stop reason': lines(turn([TEXT])),
    'text with a null stop reason': lines(turn([TEXT], { stop_reason: null })),
    'thinking and text in one row': lines(turn([THINKING, TEXT], { stop_reason: 'end_turn' })),
    'text after tools': lines(readCall, toolResult(READ_ID), assistant(OVER)),
    'a handback and its result': lines(handedBack),
    'a handback after a refused one': lines(refusedHandback, handedBack),
  }
  for (const [name, jsonl] of Object.entries(finished)) assert.match(headContextRule(eventFor({ jsonl })) ?? '', /has finished at 450K/, name)
})

test('rows after a finished shape that are neither assistant nor user do not hide it', () => {
  for (const shape of [[assistant(OVER)], handedBack]) {
    assert.match(headContextRule(eventFor({ jsonl: lines(shape, attachment(), attachment()) })), /has finished at 450K/)
    assert.match(headContextRule(eventFor({ jsonl: lines(shape, API_REQUEST, attachment(), API_REQUEST) })), /has finished at 450K/)
  }
})

test('every shape of a head still working is allowed over the limit', () => {
  const working = {
    'a tool call': lines(readCall),
    'text and a tool call in one row': lines(turn([TEXT, READ_CALL], { stop_reason: 'tool_use' })),
    'text and a tool call in one row, no stop reason': lines(turn([TEXT, READ_CALL])),
    'text about to be followed by its tool call': lines(turn([TEXT], { stop_reason: 'tool_use' })),
    'the result of another tool': lines(readCall, toolResult(READ_ID)),
    'just resumed, the message as a string': lines(assistant(OVER), userSays('a sibling replied')),
    'just resumed, the message as parts': lines(assistant(OVER), userSays([TEXT])),
    'resumed after a handback': lines(handedBack, userSays('one more thing')),
    'only thinking': lines(toolResult(READ_ID), turn([THINKING])),
    'a handback call with no result yet': lines(handedBack[0]),
    'a handback the gate refused': lines(refusedHandback),
    'work after a refused handback': lines(refusedHandback, readCall, toolResult(READ_ID)),
    'another result after an old handback': lines(handedBack, userSays('go on'), readCall, toolResult(READ_ID)),
    'a working shape with rows after it': lines(readCall, attachment(), API_REQUEST),
  }
  for (const [name, jsonl] of Object.entries(working)) assert.equal(headContextRule(eventFor({ jsonl })), null, name)
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
  assert.equal(headContextRule(eventFor({ jsonl: lines(turn([TEXT], { usage })) })), null)
})

test('only the last real assistant turn with usage counts', () => {
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(OVER), assistant(5000)) })), null, 'a compacted head is small again')
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(5000), assistant(OVER)) })), /at 450K/)
  const noUsage = JSON.stringify({ type: 'assistant', message: { content: [TEXT] } })
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(OVER), noUsage) })), /at 450K/)
  const notAssistant = JSON.stringify({ type: 'user', message: { usage: { input_tokens: 1 } } })
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(OVER), notAssistant, noUsage) })), /at 450K/)
})

test('a trailing synthetic row cannot hide an oversized head, and never counts itself', () => {
  assert.match(headContextRule(eventFor({ jsonl: lines(assistant(OVER), synthetic()) })), /has finished at 450K/)
  assert.match(headContextRule(eventFor({ jsonl: lines(handedBack, synthetic(), attachment()) })), /has finished at 450K/)
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(5000), synthetic()) })), null)
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(5000), synthetic(OVER)) })), null)
  assert.equal(headContextRule(eventFor({ jsonl: lines(synthetic(OVER)) })), null)
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
  const finishedWith = usage => lines(JSON.stringify({ type: 'assistant', message: { content: [TEXT], usage } }))
  const cases = {
    'garbage after an over-limit turn': lines(assistant(OVER), '{not json'),
    'a half-written last line': `${assistant(OVER)}\n{"type":"assist`,
    'only garbage': '\u0000\u0001 nope\n',
    'an empty file': '',
    'no assistant turn': lines(user(), user()),
    'a null line': lines('null'),
    'no content on the last row': lines(JSON.stringify({ type: 'assistant', message: { usage: usageOf(OVER) } })),
    'content of an unknown shape': lines(turn('All done.'), JSON.stringify({ type: 'assistant', message: { content: [null] } })),
    'a non-object usage': finishedWith('lots'),
    'non-number token counts': finishedWith({ input_tokens: '900000', cache_read_input_tokens: null }),
    'a usage with no known field': finishedWith({ tokens: 900000 }),
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
  const jsonl = lines(assistant(OVER), attachment(257 * KB), attachment())
  assert.equal(headContextRule(eventFor({ jsonl })), null)
})

test('a large file: an over-limit turn inside the last 256 KB is found', () => {
  const jsonl = lines(user(300 * KB), assistant(OVER), attachment(250 * KB))
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

// Past the longest string Node can hold, so reading it whole would throw and the guard would fail open. The bytes before the row are a hole.
test('a target file too large to read whole still denies, because the read stays on the tail', () => {
  const { dir, subagents } = subagentsDir()
  writeFileSync(join(subagents, `agent-${TARGET}.meta.json`), metaOf('section-team:backend'))
  const fd = openSync(join(subagents, `agent-${TARGET}.jsonl`), 'w')
  try {
    writeSync(fd, `\n${assistant(OVER)}\n`, constants.MAX_STRING_LENGTH + KB)
  } finally {
    closeSync(fd)
  }
  assert.match(headContextRule(sendMessage(dir)) ?? '', /has finished at 450K/)
})

test('a last line longer than the 256 KB window allows', () => {
  const huge = JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: OVER }, content: 'x'.repeat(300 * KB) } })
  assert.equal(headContextRule(eventFor({ jsonl: lines(assistant(OVER), huge) })), null)
})
