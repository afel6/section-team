import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentModelSplit, parseTranscript } from './score.mjs'

const mainOpus = {
  type: 'assistant',
  message: {
    id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 30, output_tokens: 7 },
    content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'section-team:backend' } }],
  },
}
const nestedSonnet = {
  type: 'assistant', parent_tool_use_id: 't1',
  message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 5 } }, // no id, no content: still counted
}

test('agentModelSplit: tokens per role (main, subagent_type) and short model name', () => {
  const split = agentModelSplit([{ type: 'system' }, mainOpus, nestedSonnet, { type: 'result' }])
  assert.deepEqual(split['section-team:backend'].sonnet, { input: 10, output: 5 })
  assert.deepEqual(split.main.opus, { input: 132, output: 7 })
})

test('agentModelSplit: counts a repeated message id once, Task calls name the role, an unmatched parent is unknown', () => {
  const task = { type: 'assistant', message: { id: 'm3', model: 'claude-opus-5-5', usage: {}, content: [{ type: 'tool_use', id: 't2', name: 'Task', input: {} }] } }
  const split = agentModelSplit([
    mainOpus, { ...mainOpus, message: { ...mainOpus.message, content: [] } }, task,
    { type: 'assistant', parent_tool_use_id: 't2', message: { id: 'm4', model: 'claude-haiku-5', usage: { input_tokens: 1, output_tokens: 1 }, content: [] } },
    { type: 'assistant', parent_tool_use_id: 'gone', message: { id: 'm5', model: 'claude-haiku-5', usage: { input_tokens: 4, output_tokens: 2 }, content: [] } },
  ])
  assert.deepEqual(split.main.opus, { input: 132, output: 7 })
  assert.deepEqual(split['general-purpose'].haiku, { input: 1, output: 1 })
  assert.deepEqual(split.unknown.haiku, { input: 4, output: 2 })
})

test('parseTranscript carries the split next to its existing fields', () => {
  const t = parseTranscript(JSON.stringify([mainOpus, nestedSonnet, { type: 'result', total_cost_usd: 1 }]))
  assert.equal(t.costUSD, 1)
  assert.deepEqual(t.split['section-team:backend'].sonnet, { input: 10, output: 5 })
})
