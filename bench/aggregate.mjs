// Combines results/summary.json (measured) and results/judge.json (blind judges, de-anonymized with blind-key.json)
// into results/report-data.json and prints a markdown table.
// Composite grade per run (0–100): correctness 40 (hidden-test pass rate) + quality 30 (judge mean / 10)
// + cost 15 (cheapest run of that task ÷ this run) + speed 15 (fastest run of that task ÷ this run).
// Usage: node bench/aggregate.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { RESULTS } from './run.mjs'

const DIMS = ['correctness', 'codeQuality', 'tests', 'robustnessSecurity', 'docsUsability']
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round = (n, d = 2) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d)

export function judgeScores(judgeRows, key) {
  // → { '<task>-<cond>-r<rep>': { quality: 1–10 mean over dims and judges, overall, wins (ranked 1st), losses (ranked last), rankPoints } }
  // Each judge row: { pair, X: scores, Y: scores, Z?: scores, ranking: ['Y', 'X', 'Z'] (best → worst) }
  const out = {}
  for (const row of judgeRows) {
    const map = key[row.pair]
    if (!map) continue
    const [task, repTag] = row.pair.split('-')
    const labels = Object.keys(map).filter(l => row[l])
    const ranking = Array.isArray(row.ranking) ? row.ranking : []
    for (const label of labels) {
      const id = `${task}-${map[label]}-${repTag}`
      const s = row[label]
      const entry = out[id] ?? { qualities: [], overalls: [], wins: 0, losses: 0, rankPoints: 0 }
      entry.qualities.push(mean(DIMS.map(d => Number(s[d]))))
      entry.overalls.push(Number(s.overall))
      const place = ranking.indexOf(label)
      if (place === 0) entry.wins++
      if (place === labels.length - 1) entry.losses++
      if (place >= 0) entry.rankPoints += labels.length - 1 - place
      out[id] = entry
    }
  }
  return Object.fromEntries(Object.entries(out).map(([id, e]) => [id, { quality: mean(e.qualities), overall: mean(e.overalls), wins: e.wins, losses: e.losses, rankPoints: e.rankPoints }]))
}

export function composite(rows, judged) {
  const byTask = {}
  for (const r of rows) (byTask[r.task] ??= []).push(r)
  return rows.map(r => {
    const peers = byTask[r.task]
    const minCost = Math.min(...peers.map(p => p.costUSD ?? Infinity))
    const minWall = Math.min(...peers.map(p => p.wallMs ?? Infinity))
    const j = judged[r.id]
    const correctness = 40 * (r.hidden?.rate ?? 0)
    const quality = j?.quality ? 30 * (j.quality / 10) : 0
    const cost = r.costUSD ? 15 * (minCost / r.costUSD) : 0
    const speed = r.wallMs ? 15 * (minWall / r.wallMs) : 0
    return { ...r, judge: j ?? null, grade: { correctness, quality, cost, speed, total: correctness + quality + cost + speed } }
  })
}

function main() {
  const rows = JSON.parse(readFileSync(join(RESULTS, 'summary.json'), 'utf8'))
  // --round=v2 reads judge-v2.json / blind-key-v2.json; without it, the first round's files.
  const round = process.argv.slice(2).find(a => a.startsWith('--round='))?.slice(8) ?? ''
  const suffix = round ? `-${round}` : ''
  const judgePath = join(RESULTS, `judge${suffix}.json`)
  const judged = existsSync(judgePath)
    ? judgeScores(JSON.parse(readFileSync(judgePath, 'utf8')), JSON.parse(readFileSync(join(RESULTS, `blind-key${suffix}.json`), 'utf8')))
    : {}
  const graded = composite(rows, judged)
  const groups = {}
  for (const r of graded) for (const k of [`${r.task}|${r.cond}`, `all|${r.cond}`]) (groups[k] ??= []).push(r)
  const table = Object.entries(groups).map(([k, rs]) => {
    const [task, cond] = k.split('|')
    return {
      task, cond, runs: rs.length,
      costUSD: round(mean(rs.map(r => r.costUSD ?? 0))),
      tokensM: round(mean(rs.map(r => (r.tokens?.total ?? 0) / 1e6))),
      outputK: round(mean(rs.map(r => (r.tokens?.output ?? 0) / 1e3)), 1),
      minutes: round(mean(rs.map(r => (r.wallMs ?? 0) / 60000)), 1),
      hiddenPassPct: round(100 * mean(rs.map(r => r.hidden?.rate ?? 0)), 1),
      ownTestsPassPct: round(100 * mean(rs.map(r => (r.own?.passed ? 1 : 0))), 0),
      judgeQuality: round(mean(rs.map(r => r.judge?.quality).filter(x => x !== null && x !== undefined)), 2),
      judgeWins: rs.reduce((a, r) => a + (r.judge?.wins ?? 0), 0),
      judgeLosses: rs.reduce((a, r) => a + (r.judge?.losses ?? 0), 0),
      judgeRankPoints: rs.reduce((a, r) => a + (r.judge?.rankPoints ?? 0), 0),
      agentSpawns: round(mean(rs.map(r => r.agentSpawns ?? 0)), 1),
      grade: round(mean(rs.map(r => r.grade.total)), 1),
      timeouts: rs.filter(r => r.timedOut).length,
    }
  }).sort((a, b) => ['easy', 'medium', 'hard', 'all'].indexOf(a.task) - ['easy', 'medium', 'hard', 'all'].indexOf(b.task) || a.cond.localeCompare(b.cond))
  writeFileSync(join(RESULTS, `report-data${suffix}.json`), JSON.stringify({ table, runs: graded }, null, 2) + '\n')
  const cols = ['task', 'cond', 'runs', 'costUSD', 'tokensM', 'outputK', 'minutes', 'hiddenPassPct', 'ownTestsPassPct', 'judgeQuality', 'judgeWins', 'judgeLosses', 'judgeRankPoints', 'agentSpawns', 'grade', 'timeouts']
  console.log(`| ${cols.join(' | ')} |\n|${cols.map(() => '---').join('|')}|`)
  for (const row of table) console.log(`| ${cols.map(c => row[c] ?? '–').join(' | ')} |`)
}

if (isMainModule(import.meta.url)) main()
