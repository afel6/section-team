// Runs blind Opus judges over the anonymized pairs in ~/bench-judge-<round>, with the committed prompt
// bench/judge-prompt.md, and appends each verdict to results/judge-<round>.json (rows that judgeScores reads,
// plus `judge` and `costUSD`). Resumable: a (pair, judge) already saved is skipped. A verdict that does not
// parse is saved raw to results/judge-<round>-raw/<pair>-<judge>.json; the other jobs go on and the exit code is 1.
// Usage: node bench/judge.mjs --round=ho --per-pair=2 [--limit=1]   (--limit=1 is the paid dry run)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { RESULTS, parseArgs } from './run.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const MODEL = 'claude-opus-5-5'
const ALLOWED = 'Read,Glob,Grep,Bash(node *),Bash(npm *),Bash(mktemp *),Bash(rm *),Bash(ls *),Bash(cat *)'
const SEED_NOTE = 'SEED/ is the repo before the change; judge only what each solution changed and whether it broke anything'
const SCORE_FIELDS = ['correctness', 'codeQuality', 'tests', 'robustnessSecurity', 'docsUsability', 'overall']
const USAGE = 'usage: node bench/judge.mjs --round=<name> --per-pair=<n> [--limit=<n>]'
// The closing fence is the first "\n```" after the opening one: a JSON string cannot hold a raw newline.
const JSON_BLOCK = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g

function checkScores(scores, label) {
  if (typeof scores !== 'object' || scores === null) throw new Error(`${label}: missing scores`)
  for (const field of SCORE_FIELDS) {
    const v = scores[field]
    if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error(`${label}.${field} must be an integer 1-10, got ${JSON.stringify(v)}`)
  }
  if (typeof scores.notes !== 'string') throw new Error(`${label}.notes must be a string`)
  return { ...Object.fromEntries(SCORE_FIELDS.map(f => [f, scores[f]])), notes: scores.notes }
}

// Judge answer text → { pair, <label>: Scores, ..., ranking } from its last fenced json block; throws on anything off.
export function parseVerdict(text, pair, labels) {
  if (typeof text !== 'string') throw new Error('judge result is not text')
  const block = [...text.matchAll(JSON_BLOCK)].at(-1)
  if (!block) throw new Error('no fenced json block in the judge answer')
  let verdict
  try {
    verdict = JSON.parse(block[1])
  } catch (err) {
    throw new Error(`judge json does not parse: ${err.message}`)
  }
  if (typeof verdict !== 'object' || verdict === null || Array.isArray(verdict)) throw new Error('judge json is not an object')
  const scored = Object.fromEntries(labels.map(label => [label, checkScores(verdict[label], label)]))
  const { ranking } = verdict
  if (!Array.isArray(ranking) || ranking.length !== labels.length || !labels.every(l => ranking.includes(l))) {
    throw new Error(`ranking must list ${labels.join(', ')} once each, got ${JSON.stringify(ranking)}`)
  }
  return { pair, ...scored, ranking: [...ranking] }
}

// Every (pair, judge 1..perPair) with no saved row yet, pair by pair.
export function pendingJobs(pairs, rows, perPair) {
  const done = new Set(rows.map(r => `${r.pair}#${r.judge}`))
  return pairs.flatMap(pair => Array.from({ length: perPair }, (_, i) => ({ pair, judge: i + 1 }))).filter(j => !done.has(`${j.pair}#${j.judge}`))
}

// One pass, with a function replacer, so `$&` or a placeholder inside the task text is copied as is.
export function fillPrompt(template, { labels, task, seed }) {
  const values = { LABELS: labels.join(', '), TASK: task, SEED_NOTE: seed ? SEED_NOTE : '' }
  return template.replace(/\{\{(LABELS|TASK|SEED_NOTE)\}\}/g, (_, name) => values[name])
}

export function judgeOptions(argv) {
  const opt = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const { round } = parseArgs(argv)
  const perPair = Number(opt('per-pair'))
  const limit = opt('limit') === undefined ? Infinity : Number(opt('limit'))
  const positive = n => Number.isInteger(n) && n >= 1
  if (!/^[A-Za-z0-9]+$/.test(round) || !positive(perPair) || !(limit === Infinity || positive(limit))) throw new Error(USAGE)
  return { round, perPair, limit }
}

// claude -p --output-format json stdout → saved row; throws when the output or the verdict does not parse.
function rowFromOutput(stdout, { pair, judge, labels }) {
  let out
  try {
    out = JSON.parse(stdout)
  } catch (err) {
    throw new Error(`claude output is not JSON: ${err.message}`)
  }
  if (typeof out?.result !== 'string') throw new Error('claude output has no result text')
  return { ...parseVerdict(out.result, pair, labels), judge, costUSD: typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null }
}

function loadRows(path) {
  if (!existsSync(path)) return []
  const rows = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(rows)) throw new Error(`${path} is not a JSON array`)
  return rows
}

// Write then rename, so a crash mid-write never corrupts the verdicts already paid for.
function saveRows(path, rows) {
  writeFileSync(`${path}.tmp`, JSON.stringify(rows, null, 2) + '\n')
  renameSync(`${path}.tmp`, path)
}

// Runs each job through call(job) → stdout, saving rows as it goes. Returns the number of failed jobs.
export async function runJobs(jobs, { rows, call, rowsPath, rawDir, log }) {
  let saved = rows
  let failed = 0
  for (const job of jobs) {
    const stdout = await call(job)
    let row
    try {
      row = rowFromOutput(stdout, job)
    } catch (err) {
      failed++
      mkdirSync(rawDir, { recursive: true })
      const rawPath = join(rawDir, `${job.pair}-${job.judge}.json`)
      writeFileSync(rawPath, stdout)
      log(`judge ${job.pair} #${job.judge} failed: ${err.message}; raw output in ${rawPath}`)
      continue
    }
    saved = [...saved, row]
    saveRows(rowsPath, saved)
    log(`judge ${job.pair} #${job.judge} done, $${row.costUSD ?? '?'}`)
  }
  return failed
}

const subfolders = dir => readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()

function prepareJob(job, judgeDir, template) {
  const cwd = join(judgeDir, job.pair)
  const labels = subfolders(cwd).filter(name => /^[A-Z]$/.test(name))
  if (labels.length === 0) throw new Error(`no solution folders in ${cwd}`)
  const task = readFileSync(join(BENCH, 'tasks', `${job.pair.split('-')[0]}.md`), 'utf8')
  return { ...job, cwd, labels, prompt: fillPrompt(template, { labels, task, seed: existsSync(join(cwd, 'SEED')) }) }
}

// ponytail: no timeout; a hung judge needs Ctrl+C, and the rerun redoes only that job.
function callClaude({ prompt, cwd }) {
  const args = ['-p', prompt, '--model', MODEL, '--output-format', 'json', '--allowedTools', ALLOWED]
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.on('error', reject)
    child.on('close', () => resolve(stdout))
  })
}

async function main() {
  const { round, perPair, limit } = judgeOptions(process.argv.slice(2))
  const judgeDir = join(homedir(), 'bench-judge-' + round)
  if (!existsSync(judgeDir)) throw new Error(`no folder ${judgeDir}: anonymize round ${round} first`)
  const rowsPath = join(RESULTS, `judge-${round}.json`)
  const rows = loadRows(rowsPath)
  const template = readFileSync(join(BENCH, 'judge-prompt.md'), 'utf8')
  // Prepared before the first paid call, so a missing task file stops the run before it spends anything.
  const jobs = pendingJobs(subfolders(judgeDir), rows, perPair).slice(0, limit).map(job => prepareJob(job, judgeDir, template))
  console.log(`${jobs.length} judge job(s) to run`)
  const log = line => console.log(`${new Date().toISOString()} ${line}`)
  const failed = await runJobs(jobs, { rows, call: callClaude, rowsPath, rawDir: join(RESULTS, `judge-${round}-raw`), log })
  if (failed > 0) {
    console.error(`${failed} judge job(s) failed; rerun to redo only those`)
    process.exitCode = 1
  } else {
    console.log('all judge jobs finished')
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(err => {
    console.error(`judge: ${err.message}`)
    process.exitCode = 1
  })
}
