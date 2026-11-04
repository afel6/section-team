import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RATES, transcriptCost } from './transcript-cost.mjs'

const HELDOUT = fileURLToPath(new URL('./data/heldout/', import.meta.url))
const say = (id, model, usage) => ({ type: 'assistant', message: { id, model, usage } })
const jsonl = (...rows) => rows.map(r => JSON.stringify(r)).join('\n') + '\n'
const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not ${expected}`)

test('RATES holds the per-million prices the CLI bills (the claude-api skill where held-out data has none)', () => {
  assert.deepEqual(RATES, {
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, cacheWrite1h: 4 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 },
  })
})

const fixtureTexts = id => {
  const folder = join(HELDOUT, 'transcripts', id)
  return readdirSync(folder).sort().map(name => readFileSync(join(folder, name), 'utf8'))
}
const heldoutRow = id => JSON.parse(readFileSync(join(HELDOUT, 'summary.json'), 'utf8')).find(row => row.id === id)

// An independent oracle for the rates: the fixtures' input and cache tokens, plus the output the CLI billed
// (modelUsage), priced with RATES, must give the CLI's own total_cost_usd.
test("RATES reproduce the CLI's billing on the held-out fixtures once output comes from modelUsage", () => {
  const withoutOutput = Object.fromEntries(Object.entries(RATES).map(([model, rate]) => [model, { ...rate, output: 0 }]))
  for (const id of ['h1-team-ho-r1', 'h3-solo-ho-r1']) {
    const { costUSD, modelUsage } = heldoutRow(id)
    const billedOutput = Object.entries(modelUsage).reduce((sum, [model, u]) => sum + u.output * RATES[model].output, 0) / 1e6
    near(transcriptCost(fixtureTexts(id), withoutOutput).costUSD + billedOutput, costUSD, 1e-9)
  }
})

test('transcriptCost takes the largest output per message id and prices the cache tiers', () => {
  const rates = { m: { input: 1, output: 10, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 } }
  // cache_creation_input_tokens is the two tiers' total: pricing it as well would count the writes twice.
  const usage = output => ({ input_tokens: 4, output_tokens: output, cache_read_input_tokens: 1000, cache_creation_input_tokens: 300, cache_creation: { ephemeral_5m_input_tokens: 200, ephemeral_1h_input_tokens: 100 } })
  const main = jsonl(say('a', 'm', usage(10)), { type: 'user' }, say('a', 'm', usage(600)), say('a', 'm', usage(10)))
  // A subagent file that replays message a, then a line cut off by a kill.
  const sub = jsonl(say('b', 'm', { output_tokens: 5 }), say('a', 'm', usage(10))) + '{"type":"assistant","mess'
  // Message c's largest output and largest input sit on different lines: each field takes its own maximum.
  const split = jsonl(say('c', 'm', { output_tokens: 600 }), say('c', 'm', { output_tokens: 10, input_tokens: 7 }))
  // a: 4×1 + 600×10 + 1000×0.1 + 200×1.25 + 100×2 = 6554; b: 5×10 = 50; c: 600×10 + 7×1 = 6007.
  const r = transcriptCost([main, sub, split], rates)
  near(r.costUSD, 12611 / 1e6)
  assert.deepEqual({ ...r, costUSD: 0 }, { costUSD: 0, unknownModels: [], outputMayBeLow: true })
})

test('transcriptCost flags an unknown model and skips <synthetic>', () => {
  const known = jsonl(say('s', '<synthetic>', { output_tokens: 99 }), say('x', 'claude-opus-5-5', { input_tokens: 1_000_000 }))
  assert.deepEqual(transcriptCost([known]), { costUSD: 4, unknownModels: [], outputMayBeLow: true })
  const other = jsonl(say('y', 'claude-other-9', { input_tokens: 1 }), say('z', 'claude-new-1', {}), say('w', 'claude-other-9', {}))
  const r = transcriptCost([known, other])
  assert.ok(Number.isNaN(r.costUSD))
  assert.deepEqual(r.unknownModels, ['claude-new-1', 'claude-other-9'])
  assert.throws(() => transcriptCost('one text'), /list of JSONL texts/)
})

// Real data: usage-only copies of two held-out runs' session and subagent transcripts, against the
// total_cost_usd in summary.json. Input, cache-read and cache-write totals match modelUsage exactly in both
// runs; the gap is output the transcripts undercount (h1: 10,069 of 28,898 Opus output tokens), so the
// computed cost is a lower bound. The pin is ±0.01 of the measured ratio: the fixtures are fixed, so only a
// change in method or rates moves it, and every single-rate mistake moves h1 by more (a 5m/1h swap: 0.054).
test('transcriptCost on two held-out runs is a lower bound within 0.01 of the measured ratio', () => {
  for (const [id, measured] of [['h1-team-ho-r1', 0.8261], ['h3-solo-ho-r1', 0.9638]]) {
    const ratio = transcriptCost(fixtureTexts(id)).costUSD / heldoutRow(id).costUSD
    assert.ok(ratio <= 1, `${id}: computed is above total_cost_usd (ratio ${ratio})`)
    near(ratio, measured, 0.01)
  }
})
