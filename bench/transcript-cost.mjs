// What a run cost, computed from its transcripts' token usage: the fallback for a run whose CLI never wrote
// total_cost_usd (a timeout). The result is a lower bound: a transcript can record a message's output count
// from when streaming began, below what was billed.
import { outputMessages } from './clean-run.mjs'

// USD per million tokens, priced the way the pinned CLI bills, since a computed cost stands in for its total_cost_usd.
// Sources, per value:
// - "CLI 2.1.296 billing, derived from bench/data/heldout": a least-squares fit of every held-out run's per-model
//   modelUsage costUSD on its tokens (cache writes split by tier from the runs' transcripts), exact to 1e-14 USD.
//   Opus: all five values (18 runs). Sonnet: input, output, cacheRead and cacheWrite5m (5 runs). The CLI bills
//   Sonnet cache reads at $0.10, half the skill's $0.20.
// - "claude-api skill, 2026-11-01" (shared/model-migration.md pricing lines), where the held-out data has no tokens
//   of that kind: Sonnet cacheWrite1h, and all of Haiku. For Haiku that is its card for prompts of 100K tokens or
//   fewer ($0.50 / $2.50 above), with cache reads at 0.1x, 5-minute writes at 1.25x and 1-hour writes at 2x input.
export const RATES = Object.freeze({
  'claude-opus-5-5': Object.freeze({ input: 4, output: 20, cacheRead: 0.2, cacheWrite5m: 5, cacheWrite1h: 8 }), // CLI 2.1.296 billing, derived from bench/data/heldout
  'claude-sonnet-5-5': Object.freeze({
    input: 2, output: 10, cacheRead: 0.1, cacheWrite5m: 2.5, // CLI 2.1.296 billing, derived from bench/data/heldout
    cacheWrite1h: 4, // claude-api skill, 2026-11-01
  }),
  'claude-haiku-5-5': Object.freeze({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite5m: 0.125, cacheWrite1h: 0.2 }), // claude-api skill, 2026-11-01
})

// The usage fields priced, by rate name. cache_creation_input_tokens is the two write tiers' total, so it is not priced.
const FIELDS = [
  ['input', u => u.input_tokens],
  ['output', u => u.output_tokens],
  ['cacheRead', u => u.cache_read_input_tokens],
  ['cacheWrite5m', u => u.cache_creation?.ephemeral_5m_input_tokens],
  ['cacheWrite1h', u => u.cache_creation?.ephemeral_1h_input_tokens],
]
const tokenCount = n => (Number.isFinite(n) && n > 0 ? n : 0)

// One entry per API message. The CLI writes a message once per content block, a subagent file can replay one,
// and an early line can hold the output count from when streaming began: each field keeps the largest value seen.
function usageById(jsonlTexts) {
  const byId = new Map()
  for (const line of jsonlTexts.flatMap(outputMessages)) {
    const message = line?.type === 'assistant' ? line.message : null
    if (!message || message.model === '<synthetic>') continue
    // A message without an id cannot be matched to its other lines, so it counts on its own.
    const key = message.id ?? Symbol('message without id')
    const seen = byId.get(key) ?? { model: message.model, tokens: {} }
    const tokens = Object.fromEntries(FIELDS.map(([name, read]) => [name, Math.max(seen.tokens[name] ?? 0, tokenCount(read(message.usage ?? {})))]))
    byId.set(key, { model: seen.model, tokens })
  }
  return [...byId.values()]
}

// jsonlTexts: the session's transcript and each subagent transcript, as text. A model without rates makes the
// cost NaN and is listed in unknownModels, so an unpriced model never reads as free.
export function transcriptCost(jsonlTexts, rates = RATES) {
  if (!Array.isArray(jsonlTexts)) throw new TypeError('transcriptCost needs a list of JSONL texts')
  const entries = usageById(jsonlTexts)
  const unknownModels = [...new Set(entries.map(e => String(e.model)).filter(model => !Object.hasOwn(rates, model)))].sort()
  const microDollars = entries.reduce((sum, { model, tokens }) => sum + messageCost(rates[model], tokens), 0)
  return { costUSD: unknownModels.length ? NaN : microDollars / 1e6, unknownModels, outputMayBeLow: true }
}

// Tokens times USD per million tokens, so the sum is in millionths of a dollar; a missing rate gives NaN.
const messageCost = (rate, tokens) => FIELDS.reduce((sum, [name]) => sum + tokens[name] * (rate?.[name] ?? NaN), 0)
