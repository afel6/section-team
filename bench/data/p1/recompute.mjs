// Recomputes a p1 round's means from the files in its folder. Read-only: it writes nothing and never touches bench/results.
// Uses the harness's own judgeScores (bench/aggregate.mjs), so the judge math is the harness's.
// Usage: node bench/data/p1/recompute.mjs [round ...]   (no rounds = all of them)
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { judgeScores } = await import(pathToFileURL(join(here, '..', '..', 'aggregate.mjs')).href)
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
const r2 = n => Math.round(n * 100) / 100
const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))
const ALL = ['pr', 'tm', 'tc', 'tf', 'tg', 'th', 'ti', 'tj', 'tl', 'to']

function recompute(round) {
  const dir = join(here, round)
  const rows = read(dir, 'summary.json')
  const key = read(dir, `blind-key-${round}.json`)
  const prefix = `judge-${round}-`
  const judges = readdirSync(dir).filter(f => f.startsWith(prefix)).map(f => [f.slice(prefix.length, -5), judgeScores(read(dir, f), key)])
  console.log(`round ${round}: setup, cost per run (USD), hidden tests passed (mean), overall score per judge: ${judges.map(([j]) => j).join(', ')}`)
  for (const cond of [...new Set(rows.map(r => r.cond))].sort()) {
    const rs = rows.filter(r => r.cond === cond)
    const scores = judges.map(([, s]) => r2(mean(rs.map(r => s[r.id].overall))))
    console.log(`  ${cond.padEnd(8)} $${r2(mean(rs.map(r => r.costUSD))).toFixed(2).padStart(6)}  hidden ${mean(rs.map(r => r.hidden.pass))}  ${scores.join('  ')}`)
  }
}

const asked = process.argv.slice(2)
for (const round of asked.length ? asked : ALL) recompute(round)
