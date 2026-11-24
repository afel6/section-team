// Recomputes a multi-task round's numbers (rounds hq and fx) from the files in its folder. Read-only: it writes
// nothing and never touches bench/results. Uses the harness's own judgeScores (bench/aggregate.mjs).
// Usage: node bench/data/hq/recompute.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const { judgeScores } = await import(pathToFileURL(join(here, '..', '..', 'aggregate.mjs')).href)
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
const sum = xs => xs.reduce((a, b) => a + b, 0)
const r2 = n => Math.round(n * 100) / 100
const read = (dir, f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))

function judgesOf(dir, round, key) {
  const prefix = `judge-${round}-`
  return readdirSync(dir).filter(f => f.startsWith(prefix)).map(f => [f.slice(prefix.length, -5), judgeScores(read(dir, f), key)])
}

// One line per setup: total cost, cost as a multiple of the solo setup, hidden passes per task (mean), and per judge
// the mean overall score and the number of cases that ranked it first; then the same per task.
export function recomputeTasks(dir, round, solo) {
  const rows = read(dir, 'summary.json')
  const judges = judgesOf(dir, round, read(dir, `blind-key-${round}.json`))
  const tasks = [...new Set(rows.map(r => r.task))].sort()
  const conds = [...new Set(rows.map(r => r.cond))].sort()
  const of = (cond, task) => rows.filter(r => r.cond === cond && (!task || r.task === task))
  const cost = (cond, task) => sum(of(cond, task).map(r => r.costUSD))
  const line = (cond, task) => {
    const rs = of(cond, task)
    const scores = judges.map(([j, s]) => `${j} ${r2(mean(rs.map(r => s[r.id].overall))).toFixed(2)} (1st ${sum(rs.map(r => s[r.id].wins))})`)
    const hidden = (task ? [task] : tasks).map(t => mean(of(cond, t).map(r => r.hidden.pass))).join(' / ')
    return `${cond.padEnd(8)} $${r2(cost(cond, task)).toFixed(2).padStart(7)}  ${(cost(cond, task) / cost(solo, task)).toFixed(2)}x  hidden ${hidden}  ${scores.join('  ')}`
  }
  console.log(`round ${round}: setup, total cost (USD), x ${solo}, hidden passed per task ${tasks.join(' / ')} (mean), overall per judge (cases ranked 1st)`)
  for (const cond of conds) console.log(`  ${line(cond)}`)
  for (const task of tasks) {
    console.log(` ${task}:`)
    for (const cond of conds) console.log(`  ${line(cond, task)}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) recomputeTasks(here, 'hq', 'solo-hq')
