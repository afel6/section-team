import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gradeRule, senderOf } from '../hooks/lib/grade.mjs'

const SESSION = 'sid-1'
const SECTION = 'a1b2c3'
const REVIEWER = 'ad43ae'
const CALL = 'toolu_9'
const NO_CALL = 'section-team: your REPORT gives a grade, but no reviewer call is in your transcript. Run section-team:reviewer on your changed files.'
const mismatch = (a, b) => `section-team: your REPORT says ${a}/10, but the reviewer said ${b}/10. Report the reviewer's grade.`

const made = []
after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }) })

// Transcript lines in the shapes real section transcripts hold.
const agentCall = (subagent_type = 'section-team:reviewer', id = CALL, name = 'Agent') => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: { subagent_type, prompt: 'grade it' } }] } })
const otherTool = { type: 'assistant', message: { content: [{ type: 'text', text: 'working' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: 'a.mjs' } }] } }
const gradeBlock = overall => `[Subagent hand-back] The text below is the final report.\n\n  The changes hold up.\n  \n  ## GRADE\n  Overall: ${overall}/10\n  Verdict: pass\n  structure: 9 — small helpers\n  Fixes:\n  - none\n`
const toolResult = (text, id = CALL) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } })
const POINTER = `  This agent's report was delivered to you as a message from "${REVIEWER}" (its SubagentHandback call). Read it there; it is not repeated here.\n  \nagentId: ${REVIEWER} (use SendMessage with to: '${REVIEWER}', summary: '<5-10 word recap>' to continue this agent)\n<usage>subagent_tokens: 10</usage>`
const queued = prompt => ({ type: 'attachment', attachment: { type: 'queued_command', prompt } })
const agentMessage = (text, from = REVIEWER) => queued(`<agent-message from="${from}">\n${text}</agent-message>`)
const taskNotification = (text, id = REVIEWER) => queued(`<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>${CALL}</tool-use-id>\n<result>${text}</result>\n</task-notification>`)

// The two ways the reviewer's answer reaches a section.
const inToolResult = overall => [agentCall(), toolResult(`${gradeBlock(overall)}\nagentId: ${REVIEWER} (use SendMessage)`)]
const inAttachment = overall => [agentCall(), toolResult(POINTER), agentMessage(gradeBlock(overall))]
const FORMS = { 'a tool_result': inToolResult, 'a queued_command attachment': inAttachment }

const asLines = entries => entries.map(entry => (typeof entry === 'string' ? entry : JSON.stringify(entry))).join('\n') + '\n'

// Lays out a session as Claude Code does, with the section's transcript in place; null leaves the file out.
function eventWith(entries) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-grade-'))
  made.push(dir)
  const subagents = join(dir, SESSION, 'subagents')
  mkdirSync(subagents, { recursive: true })
  if (entries !== null) writeFileSync(join(subagents, `agent-${SECTION}.jsonl`), asLines(entries))
  return { agent_id: SECTION, session_id: SESSION, transcript_path: join(dir, `${SESSION}.jsonl`) }
}
const ruleFor = (entries, quality) => gradeRule(eventWith(entries), quality)

for (const [form, delivered] of Object.entries(FORMS)) {
  test(`a REPORT at or under the reviewer's grade passes, delivered in ${form}`, () => {
    assert.equal(ruleFor(delivered(9), 9), null)
    assert.equal(ruleFor(delivered(9), 8), null)
  })

  test(`a REPORT above the reviewer's grade is refused, delivered in ${form}`, () => {
    assert.equal(ruleFor(delivered(8), 9), mismatch(9, 8))
    assert.equal(ruleFor([otherTool, ...delivered(7), otherTool], 8.5), mismatch(8.5, 7))
  })
}

test('a task notification from the reviewer counts as delivery', () => {
  const entries = grade => [agentCall(), toolResult(`Async agent launched. agentId: ${REVIEWER}`), taskNotification(gradeBlock(grade))]
  assert.equal(ruleFor(entries(9), 9), null)
  assert.equal(ruleFor(entries(8), 9), mismatch(9, 8))
})

test('a tool_result whose content is a plain string is read', () => {
  const entry = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: CALL, content: gradeBlock(8) }] } }
  assert.equal(ruleFor([agentCall(), entry], 9), mismatch(9, 8))
})

test('no reviewer call at all is refused, with the exact wording', () => {
  assert.equal(ruleFor([otherTool], 9), NO_CALL)
  assert.equal(ruleFor([otherTool, agentCall('section-team:coder'), toolResult(gradeBlock(9))], 9), NO_CALL)
  assert.equal(ruleFor([agentCall('code-reviewer'), toolResult(gradeBlock(9))], 9), NO_CALL)
  assert.equal(ruleFor([agentCall('section-team:reviewer', CALL, 'Read'), toolResult(gradeBlock(9))], 9), NO_CALL)
})

test('a reviewer call with no readable result allows', () => {
  const cases = {
    'no result yet': [agentCall()],
    'the result of another call': [agentCall(), toolResult(gradeBlock(5), 'toolu_other')],
    'a pointer with nothing delivered': [agentCall(), toolResult(POINTER)],
    'a call the guard refused': [agentCall(), toolResult('section-team: run helpers in the foreground: pass `run_in_background: false`.')],
    'a result with no GRADE block': [agentCall(), toolResult('The changes pass: overall 5/10.')],
    'an answer without a number': [agentCall(), toolResult('## GRADE\nOverall: n/a\nVerdict: pass')],
    'a grade out of something else': [agentCall(), toolResult('Overall: 5/100')],
  }
  for (const [name, entries] of Object.entries(cases)) assert.equal(ruleFor(entries, 9), null, name)
})

test('only the last reviewer call counts', () => {
  assert.equal(ruleFor([...inToolResult(9), ...inToolResult(7)], 9), mismatch(9, 7))
  assert.equal(ruleFor([...inToolResult(7), ...inAttachment(9)], 9), null)
  assert.equal(ruleFor([...inToolResult(5), agentCall()], 9), null, 'the last call is still running, so the old grade says nothing')
  assert.equal(ruleFor([...inToolResult(9), otherTool, agentCall('section-team:coder', 'toolu_2'), toolResult('done', 'toolu_2')], 9), null, 'a later coder is no reviewer')
})

test('of two reviewer calls in one message, the last is the one read', () => {
  const both = { type: 'assistant', message: { content: [...agentCall('section-team:reviewer', 'toolu_a').message.content, ...agentCall('section-team:reviewer', 'toolu_b').message.content] } }
  assert.equal(ruleFor([both, toolResult(gradeBlock(5), 'toolu_b'), toolResult(gradeBlock(9), 'toolu_a')], 9), mismatch(9, 5))
})

test('text from anyone but that reviewer is not its grade', () => {
  const notTheReviewer = {
    'a coder quoting a grade': agentMessage('Applied the fixes.\nOverall: 5/10', 'acoder1'),
    'another task': taskNotification('Overall: 5/10', 'acoder1'),
    'the supervisor': queued('From main: the last round was\nOverall: 5/10'),
    'a message naming the reviewer in its text': queued(`From main: <agent-message from="${REVIEWER}">\nOverall: 5/10`),
    'a supervisor message naming the reviewer as a task id': queued(`From main: <task-id>${REVIEWER}</task-id>
Overall: 5/10`),
    'a reviewer-shaped prompt in an attachment that is not queued': { type: 'attachment', attachment: { type: 'hook_success', prompt: `<agent-message from="${REVIEWER}">
${gradeBlock(5)}</agent-message>` } },
  }
  for (const [name, entry] of Object.entries(notTheReviewer)) {
    assert.equal(ruleFor([...inAttachment(9), entry], 9), null, name)
    assert.equal(ruleFor([agentCall(), toolResult(POINTER), entry], 9), null, `${name}, with nothing from the reviewer`)
  }
  assert.equal(ruleFor([agentCall(), toolResult('no id here'), queued('From main:\nOverall: 5/10')], 9), null, 'no agent id matches a message with no sender')
})

test('a later answer from the same reviewer replaces its first', () => {
  assert.equal(ruleFor([...inToolResult(7), agentMessage(gradeBlock(9))], 9), null)
  assert.equal(ruleFor([...inToolResult(9), agentMessage(gradeBlock(7))], 9), mismatch(9, 7))
})

test('a reviewer resumed by SendMessage was asked again, so only what it said after that counts', () => {
  const resume = to => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu_s', name: 'SendMessage', input: { to, message: 'grade again' } }] } })
  assert.equal(ruleFor([...inToolResult(7), resume(REVIEWER), agentMessage(gradeBlock(9))], 9), null)
  assert.equal(ruleFor([...inToolResult(9), resume(REVIEWER), agentMessage(gradeBlock(7))], 9), mismatch(9, 7))
  // A real section: the second grade reached it only as the supervisor's relay, which is no readable result.
  assert.equal(ruleFor([...inToolResult(7), resume(REVIEWER), queued('From main: your reviewer re-graded the wave at 9/10, a pass.')], 9), null)
  assert.equal(ruleFor([...inToolResult(7), resume(REVIEWER), { type: 'user', message: { content: 'From main: your reviewer re-graded the wave at 9/10.' } }], 9), null)
  assert.equal(ruleFor([...inToolResult(7), resume('acoder1')], 9), mismatch(9, 7), 'resuming a coder asks the reviewer nothing')
  assert.equal(ruleFor([agentCall(), toolResult(POINTER), agentMessage(gradeBlock(5)), resume(REVIEWER)], 9), null, 'the answer to the new ask has not come yet')
})

test('the copies a transcript keeps of an API request are not calls', () => {
  const blob = entry => ({ ...entry, type: 'api-request-blob' })
  assert.equal(ruleFor([...inToolResult(8), blob(agentCall())], 9), mismatch(9, 8), 'a copy after the result must not hide the result')
  assert.equal(ruleFor([otherTool, blob(agentCall()), toolResult(gradeBlock(9))], 9), NO_CALL, 'a copy alone is no call')
  assert.equal(ruleFor([blob(otherTool)], 9), null, 'a copy alone is no tool call either')
  const resent = blob({ message: { content: [{ type: 'tool_use', id: 'toolu_s', name: 'SendMessage', input: { to: REVIEWER } }] } })
  assert.equal(ruleFor([...inAttachment(8), resent], 9), mismatch(9, 8), 'a copied SendMessage is no new ask')
})

test('an agent id quoted in the review does not stand in for the real one at its end', () => {
  const quoting = `agentId: acoder1 came up in the diff.\n${POINTER}`
  assert.equal(ruleFor([agentCall(), toolResult(quoting), agentMessage(gradeBlock(8))], 9), mismatch(9, 8))
})

test('the last Overall line is the grade, however it is spaced or marked, and only a line that starts with it counts', () => {
  const said = text => ruleFor([agentCall(), toolResult(text)], 9.5)
  assert.equal(said(`Overall: 5/10 last round.\n${gradeBlock(8)}`), mismatch(9.5, 8))
  assert.equal(said('## GRADE\n  Overall: 8.5/10'), mismatch(9.5, 8.5))
  assert.equal(said('## GRADE\nOverall: 8 / 10'), mismatch(9.5, 8))
  assert.equal(said('## GRADE\n**Overall:** 8/10'), mismatch(9.5, 8))
  assert.equal(said('## GRADE\n**Overall: 8/10**'), mismatch(9.5, 8))
  assert.equal(said('## GRADE\r\noverall: 8/10\r\nVerdict: fail'), mismatch(9.5, 8))
  assert.equal(said('naming: 5 — clear overall: 3/10'), null)
  assert.equal(said('- the overall: 3/10 mark'), null)
  assert.equal(said('Overall:\n3/10 of the files are new'), null)
})

test('a reviewer call far from the end of a huge transcript is still found', () => {
  const padding = { type: 'user', message: { content: 'x'.repeat(400 * 1024) } }
  assert.equal(ruleFor([...inToolResult(9), padding], 9), null)
  assert.equal(ruleFor([...inToolResult(8), padding], 9), mismatch(9, 8))
  assert.equal(ruleFor([agentCall(), padding, toolResult(POINTER), padding, agentMessage(gradeBlock(8))], 9), mismatch(9, 8))
})

test('a transcript that cannot be read or understood allows', () => {
  const cases = {
    'no file': null,
    'an empty file': [],
    'bad JSON before the call': ['{not json', ...inToolResult(5)],
    'bad JSON after the call': [...inToolResult(5), '{not json'],
    'a half-written last line': [otherTool, '{"type":"assist'],
    'no tool call at all': [{ type: 'assistant', message: { content: 'hello' } }, { type: 'user', message: { content: 'hi' } }, { type: 'assistant' }, 5, []],
    'odd content parts': [{ type: 'assistant', message: { content: [null, 5, 'text'] } }],
  }
  for (const [name, entries] of Object.entries(cases)) assert.equal(ruleFor(entries, 9), null, name)
})

test('a null line is valid JSON and does not hide the rest', () => {
  assert.equal(ruleFor(['null', ...inToolResult(5)], 9), mismatch(9, 5))
})

test('a transcript path that is a folder allows', () => {
  const e = eventWith(null)
  mkdirSync(join(e.transcript_path.replace(/\.jsonl$/, ''), 'subagents', `agent-${SECTION}.jsonl`))
  assert.equal(gradeRule(e, 9), null)
})

test('an event without what the path needs allows, and an agent id cannot leave the subagents folder', () => {
  const e = eventWith([otherTool])
  assert.equal(gradeRule(e, 9), NO_CALL, 'control: the same transcript refuses when it can be found')
  const broken = [
    { ...e, agent_id: undefined },
    { ...e, agent_id: 5 },
    { ...e, agent_id: '' },
    { ...e, agent_id: `../subagents/agent-${SECTION}` },
    { ...e, session_id: undefined },
    { ...e, session_id: '../x' },
    { ...e, transcript_path: undefined },
    { ...e, transcript_path: 5 },
  ]
  for (const event of broken) assert.equal(gradeRule(event, 9), null, JSON.stringify(event))
})

test('a reviewer call made through the Task tool name counts like one made through Agent', () => {
  const entries = grade => [agentCall('section-team:reviewer', CALL, 'Task'), toolResult(gradeBlock(grade))]
  assert.equal(ruleFor(entries(8), 9), mismatch(9, 8))
  assert.equal(ruleFor(entries(9), 9), null)
})

test('senderOf names the agent behind a queued hand-back, and nobody for anything else', () => {
  assert.equal(senderOf(`<agent-message from="${REVIEWER}">
hi`), REVIEWER)
  assert.equal(senderOf(`<task-notification>
<task-id>${REVIEWER}</task-id>`), REVIEWER)
  assert.equal(senderOf(`From main: <task-id>${REVIEWER}</task-id>`), undefined)
  assert.equal(senderOf('plain job'), undefined)
})
