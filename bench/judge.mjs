// Runs blind Opus judges over the anonymized groups in ~/bench-judge-<round>, with the committed prompt
// bench/judge-prompt.md, and appends each verdict to results/judge-<round>.json (rows that judgeScores reads,
// plus `judge` and `costUSD`). Each judge sees every solution of its group; an even judge sees them mirrored.
// Every attempt is a fresh session of the round's pinned binary, checked like a solo run (init and effort), and its
// transcript is kept in results/judge-<round>-transcripts/. An unusable attempt (a void session or a verdict that does
// not parse) is saved raw to results/judge-<round>-raw/, listed in -reasks.json and asked again, at most twice; a
// third unusable attempt is listed in -left-out.json and the exit code is 1. Judges whose session compacted are listed
// in -compacted.json; -edges.json counts how often each setup was the first or last folder of a saved judgment. A
// usage or rate limit, another API error, a session with no result or one that left no transcript stops judging
// (exit 1) without using an attempt. Judging refuses to start before the round's leak scan is written.
// Resumable: a (pair, judge) already saved or left out is skipped, and a resumed job keeps its attempt count.
// Each judge works in its own temp copy of the pair, with an empty scratch/ folder for probes; the harness deletes
// that copy when the judge exits, so no judge can change what the next one grades.
// Usage: node bench/judge.mjs --round=mo --per-pair=2 [--limit=1]   (--limit=1 is the paid trial judge)
import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { judgeDirFor } from './anonymize.mjs'
import {
  childEnv, cleanSettings, commonArgs, compacted, effortProblems, initOf, initProblems, installedPluginKeys, outputMessages, readPin, resultOf,
} from './clean-run.mjs'
import { classifyEnd, filesAt, projectDirFor } from './run-attempts.mjs'
import { NAME, RESULTS, parseArgs } from './run.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
// No rm or mktemp: the harness makes and deletes each judge's folder. node and npm stay because judges run the
// solutions' tests. That runs untrusted code on this machine, with this shell's environment (claude needs it to
// sign in), so run judging from a shell with no extra tokens set. The builder runs already ran the same code here.
export const ALLOWED = 'Read,Glob,Grep,Bash(node *),Bash(npm *),Bash(ls *),Bash(cat *)'
const SEED_NOTE = 'SEED/ is the repo before the change; judge only what each solution changed and whether it broke anything'
const SCORE_FIELDS = ['correctness', 'codeQuality', 'tests', 'robustnessSecurity', 'docsUsability', 'overall']
const USAGE = 'usage: node bench/judge.mjs --round=<name> --per-pair=<n> [--limit=<n>]'
// The closing fence is the first "\n```" after the opening one: a JSON string cannot hold a raw newline.
export const JSON_BLOCK = /```json[ \t]*\r?\n([\s\S]*?)\r?\n```/g
// A first attempt and at most two re-asks (spec: "Unusable verdicts").
export const MAX_ATTEMPTS = 3

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
    throw new Error(`judge json does not parse: ${err.message.replace(/\s+/g, ' ')}`)
  }
  if (typeof verdict !== 'object' || verdict === null || Array.isArray(verdict)) throw new Error('judge json is not an object')
  const scored = Object.fromEntries(labels.map(label => [label, checkScores(verdict[label], label)]))
  const { ranking } = verdict
  if (!Array.isArray(ranking) || ranking.length !== labels.length || !labels.every(l => ranking.includes(l))) {
    throw new Error(`ranking must list ${labels.join(', ')} once each, got ${JSON.stringify(ranking)}`)
  }
  return { pair, ...scored, ranking: [...ranking] }
}

const jobKey = ({ pair, judge }) => `${pair}#${judge}`

// Every (pair, judge 1..perPair) with no saved row and not left out, pair by pair.
export function pendingJobs(pairs, rows, perPair, leftOut = []) {
  const done = new Set([...rows, ...leftOut].map(jobKey))
  return pairs.flatMap(pair => Array.from({ length: perPair }, (_, i) => ({ pair, judge: i + 1 }))).filter(j => !done.has(jobKey(j)))
}

// One pass, with a function replacer, so `$&` or a placeholder inside the task text is copied as is.
export function fillPrompt(template, { labels, task, seed }) {
  const values = { LABELS: labels.join(', '), TASK: task, SEED_NOTE: seed ? SEED_NOTE : '' }
  return template.replace(/\{\{(LABELS|TASK|SEED_NOTE)\}\}/g, (_, name) => values[name])
}

export function judgeOptions(argv) {
  const opt = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  let round
  try {
    ({ round } = parseArgs(argv))
  } catch (err) {
    throw new Error(USAGE, { cause: err })
  }
  const perPair = Number(opt('per-pair'))
  const limit = opt('limit') === undefined ? Infinity : Number(opt('limit'))
  const positive = n => Number.isInteger(n) && n >= 1
  if (!NAME.test(round) || !positive(perPair) || !(limit === Infinity || positive(limit))) throw new Error(USAGE)
  return { round, perPair, limit }
}

// The round's judge files in results.
export const judgeFiles = (results, round) => ({
  rows: join(results, `judge-${round}.json`),
  raw: join(results, `judge-${round}-raw`),
  transcripts: join(results, `judge-${round}-transcripts`),
  reasks: join(results, `judge-${round}-reasks.json`),
  leftOut: join(results, `judge-${round}-left-out.json`),
  compacted: join(results, `judge-${round}-compacted.json`),
  edges: join(results, `judge-${round}-edges.json`),
})

// claude -p --output-format json stdout (every message as one array with --verbose, else the result alone) → saved
// row; throws when there is no result text or the verdict does not parse.
function rowFromOutput(stdout, { pair, judge, labels }) {
  const out = resultOf(outputMessages(stdout))
  if (typeof out?.result !== 'string') throw new Error('claude output has no result text')
  return { ...parseVerdict(out.result, pair, labels), judge, costUSD: typeof out.total_cost_usd === 'number' ? out.total_cost_usd : null }
}

// An even judge sees the mirror of judge 1's order: with the labels sorted, the 1st label's folder swapped with the
// last's, the 2nd's with the one before it, and so on (an odd count keeps its middle label). null for an odd judge.
export function mirrorSwap(judge, labels) {
  if (judge % 2 !== 0) return null
  const sorted = [...labels].sort()
  const n = sorted.length
  return Array.from({ length: Math.floor(n / 2) }, (_, i) => [sorted[i], sorted[n - 1 - i]])
}

// The label whose solution a folder holds after the swap. The pairs are disjoint, so each is its own inverse.
const realLabel = (folder, pairs) => pairs?.find(pair => pair.includes(folder))?.find(label => label !== folder) ?? folder

// A mirrored judge's row, put back under the real labels. Its notes still name the folders it saw, hence `swapped`.
export function unswap(row, pairs) {
  if (!pairs || pairs.length === 0) return row
  const moved = Object.fromEntries(pairs.flatMap(([a, b]) => [[a, row[b]], [b, row[a]]]))
  return { ...row, ...moved, ranking: row.ranking.map(label => realLabel(label, pairs)), swapped: true }
}

// { [setup]: { first, last } }: how often each setup's solution was the first or the last folder a judge saw.
export function edgeCounts(key, jobs) {
  const setupIn = (job, folder) => {
    const setup = key[job.pair]?.[realLabel(folder, job.swap)]
    if (setup === undefined) throw new Error(`the blind key has no setup for ${job.pair} folder ${folder}`)
    return setup
  }
  const edges = jobs.map(job => {
    const sorted = [...job.labels].sort()
    return { first: setupIn(job, sorted[0]), last: setupIn(job, sorted.at(-1)) }
  })
  const setups = [...new Set(jobs.flatMap(job => Object.values(key[job.pair])))].sort()
  const count = (setup, edge) => edges.filter(e => e[edge] === setup).length
  return Object.fromEntries(setups.map(setup => [setup, { first: count(setup, 'first'), last: count(setup, 'last') }]))
}

// edgeCounts over the judgments that count: the planned jobs with a saved row (a left-out job is no judgment).
export function countedEdges(key, planned, rows) {
  const counted = new Set(rows.map(jobKey))
  return edgeCounts(key, planned.filter(job => counted.has(jobKey(job))))
}

// The leak scan runs before any judge (spec "Leak scan"): a round with groups to judge needs its results file.
export function checkLeakScan(results, round, groups) {
  if (groups.length > 0 && !existsSync(join(results, `leak-scan-${round}.json`))) throw new Error(`run node bench/leak-scan.mjs --round=${round} first`)
}

// A results file's JSON; one line naming the file when it cannot be read or does not parse.
function readJson(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`cannot read ${path} (${err.code ?? err.name})`, { cause: err })
  }
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON: fix it before judging resumes`, { cause: err })
  }
}

function loadList(path) {
  if (!existsSync(path)) return []
  const list = readJson(path)
  if (!Array.isArray(list)) throw new Error(`${path} is not a JSON array`)
  return list
}

// Write then rename, so a crash mid-write never corrupts the verdicts already paid for.
function saveJson(path, value) {
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n')
  renameSync(`${path}.tmp`, path)
}

const appendJson = (path, entry) => saveJson(path, [...loadList(path), entry])
const jobLabel = ({ pair, judge }) => `judge ${pair} #${judge}`
// The base name of one attempt's raw output and transcript.
const attemptName = ({ pair, judge }, attempt) => `${pair}-${judge}-a${attempt}`

function saveRaw(dir, job, attempt, stdout) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${attemptName(job, attempt)}.json`)
  writeFileSync(path, stdout)
  return path
}

// An attempt's row, and the reasons it is unusable: the check's (init and effort) plus the parse error, if any.
function verdictOf(answer, job, check) {
  const reasons = check(answer)
  try {
    return { row: unswap(rowFromOutput(answer.stdout, job), job.swap), reasons }
  } catch (err) {
    return { row: null, reasons: [...reasons, err.message] }
  }
}

// One job: a fresh call per attempt until one is usable or the third is not. The count goes on from the re-asks
// already saved, so a resumed job never gets more than three attempts. Returns the row, or null when left out.
async function judgeJob(job, { call, check, files, log }) {
  const attemptsUsed = loadList(files.reasks).filter(entry => jobKey(entry) === jobKey(job)).length
  for (let attempt = attemptsUsed + 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const answer = await call(job, attempt)
    const { row, reasons } = verdictOf(answer, job, check)
    const at = { pair: job.pair, judge: job.judge, attempt }
    if (reasons.length === 0) {
      if (compacted(answer.transcript)) appendJson(files.compacted, at)
      return row
    }
    const rawPath = saveRaw(files.raw, job, attempt, answer.stdout)
    if (attempt === MAX_ATTEMPTS) {
      appendJson(files.leftOut, { ...at, reasons })
      log(`${jobLabel(job)} left out after ${MAX_ATTEMPTS} attempts: ${reasons.join('; ')}; raw output in ${rawPath}`)
      return null
    }
    appendJson(files.reasks, { ...at, reasons })
    log(`${jobLabel(job)} attempt ${attempt} unusable, re-ask: ${reasons.join('; ')}; raw output in ${rawPath}`)
  }
  throw new Error(`${jobLabel(job)} has ${attemptsUsed} re-asks saved but is not left out: check ${files.reasks}`)
}

// Runs each job through call(job, attempt) → { stdout, transcript, subagentTranscripts } and check(that answer) → reasons,
// saving rows as it goes. Returns the number of jobs this run left out.
export async function runJobs(jobs, { rows, call, check, files, log }) {
  let saved = rows
  let leftOut = 0
  for (const job of jobs) {
    const row = await judgeJob(job, { call, check, files, log })
    if (row === null) {
      leftOut++
      continue
    }
    saved = [...saved, row]
    saveJson(files.rows, saved)
    log(`${jobLabel(job)} done, $${row.costUSD ?? '?'}`)
  }
  return leftOut
}

export const subfolders = dir => readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()

export function prepareJob(job, judgeDir, template) {
  const source = join(judgeDir, job.pair)
  const labels = subfolders(source).filter(name => /^[A-Z]$/.test(name))
  if (labels.length === 0) throw new Error(`no solution folders in ${source}`)
  const task = readFileSync(join(BENCH, 'tasks', `${job.pair.split('-')[0]}.md`), 'utf8')
  const prompt = fillPrompt(template, { labels, task, seed: existsSync(join(source, 'SEED')) })
  return { ...job, source, labels, prompt, swap: mirrorSwap(job.judge, labels) }
}

// Runs fn(dir) on a fresh temp copy of source plus an empty scratch/ folder, then deletes the copy, also when fn
// throws. A copy that cannot be deleted (a file still locked on Windows) is logged, not thrown: the verdict is paid for.
// ponytail: Ctrl+C skips the finally and leaves a bench-judge-job-* folder in the temp folder; delete those by hand.
// swap [['W', 'Z'], ['X', 'Y']] exchanges each pair's folders in the copy (see mirrorSwap), through a temp name per pair.
export async function withCopy(source, fn, { log = console.error, remove = rmSync, swap = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-judge-job-'))
  try {
    // verbatimSymlinks: a relative link stays relative, so it points inside this copy, not back into source.
    cpSync(source, dir, { recursive: true, verbatimSymlinks: true })
    for (const [a, b] of swap ?? []) {
      const temp = join(dir, `.swap-${a}`)
      renameSync(join(dir, a), temp)
      renameSync(join(dir, b), join(dir, a))
      renameSync(temp, join(dir, b))
    }
    mkdirSync(join(dir, 'scratch'))
    return await fn(dir)
  } finally {
    try {
      remove(dir, { recursive: true, force: true, maxRetries: 5 })
    } catch (err) {
      log(`could not delete judge folder ${dir}: ${err.message}`)
    }
  }
}

// The round's model, effort, --verbose and session id (commonArgs), and clean settings with section-team off, so a
// judge never gets the supervisor brief of the setup it is judging. --permission-mode default: only ALLOWED runs,
// whatever the user's own default mode is, so a judge cannot read the blind key.
export const judgeArgs = (prompt, { sessionId, installedKeys, pluginDir }) => [
  '-p', prompt, '--output-format', 'json', '--allowedTools', ALLOWED, '--permission-mode', 'default', ...commonArgs({ sessionId }),
  '--settings', JSON.stringify(cleanSettings({ installedKeys, sectionTeam: false, pluginDir })),
]

// check for runJobs: a judge is held to the pin like a solo run (initProblems maps judge to solo), and its session and
// subagent transcripts to the effort.
export const judgeCheck = pin => ({ stdout, transcript, subagentTranscripts = [] }) => [
  ...initProblems(initOf(outputMessages(stdout)), { setup: 'judge', pin, pluginDir: pin.pluginDir }),
  ...effortProblems([transcript, ...subagentTranscripts]),
]

// ponytail: no timeout; a hung judge needs Ctrl+C, and the rerun redoes only that job, at the same attempt number.
function runClaude(binary, args, { cwd, env, spawn }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'inherit'] })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.on('error', err => reject(new Error(`could not start claude (${binary}: ${err.code ?? err.message})`)))
    child.on('close', () => resolve(stdout))
  })
}

// The session's transcript, copied to <transcripts>/<pair>-<judge>-a<attempt>.jsonl, and its subagent folder, copied
// to <transcripts>/<pair>-<judge>-a<attempt>/ as run-attempts copyEvidence does. A session that wrote no transcript is
// a harness fault (like a run's missing session file), so it stops judging instead of using up the job's attempts.
// Returns the main text and the text of every .jsonl in the subagent folder.
function keepTranscript({ cwd, sessionId, home, files, job, attempt }) {
  const project = projectDirFor(cwd, home)
  const from = join(project, `${sessionId}.jsonl`)
  if (!existsSync(from)) throw new Error(`${jobLabel(job)} left no session transcript at ${from}: fix the harness, then resume`)
  const transcript = readFileSync(from, 'utf8')
  mkdirSync(files.transcripts, { recursive: true })
  writeFileSync(join(files.transcripts, `${attemptName(job, attempt)}.jsonl`), transcript)
  const subagents = join(project, sessionId)
  if (!existsSync(subagents)) return { transcript, subagentTranscripts: [] }
  const to = join(files.transcripts, attemptName(job, attempt))
  cpSync(subagents, to, { recursive: true })
  return { transcript, subagentTranscripts: filesAt(to).filter(file => file.endsWith('.jsonl')).sort().map(file => readFileSync(file, 'utf8')) }
}

// call for runJobs: each attempt is a fresh session (a new id) of the pinned binary, with the round's child
// environment, in a fresh copy of the pair (mirrored for an even judge); its transcript is kept before the copy goes.
// A usage or rate limit, another API error or a session with no result is not the judge's fault: it stops judging
// and uses no attempt, as it stops a batch of runs. runClaude reports no exit code, so a missing result reads as
// 'no-result' (exitCode 0), never 'crash'.
export function judgeCall({ pin, installedKeys, files, env = process.env, home = homedir(), spawn = nodeSpawn, log }) {
  const { binary, pluginDir } = pin
  const childEnvironment = childEnv(env, { pluginDir })
  return (job, attempt) => withCopy(job.source, async cwd => {
    const sessionId = randomUUID()
    const args = judgeArgs(job.prompt, { sessionId, installedKeys, pluginDir })
    const stdout = await runClaude(binary, args, { cwd, env: childEnvironment, spawn })
    const end = classifyEnd({ messages: outputMessages(stdout), exitCode: 0 })
    if (end === 'api-limit') throw new Error(`${jobLabel(job)} hit a usage or rate limit: resume judging in the next usage window`)
    if (end === 'api-other' || end === 'no-result') throw new Error(`${jobLabel(job)} ended with an API error or no result: fix the cause (login, outage), then resume`)
    return { stdout, ...keepTranscript({ cwd, sessionId, home, files, job, attempt }) }
  }, { log, swap: job.swap })
}

function readKey(results, round) {
  const path = join(results, `blind-key-${round}.json`)
  if (!existsSync(path)) throw new Error(`missing ${path}: run node bench/anonymize.mjs --round=${round} first`)
  const key = readJson(path)
  if (typeof key !== 'object' || key === null || Array.isArray(key)) throw new Error(`${path} is not a blind key (one object per group)`)
  return key
}

async function main() {
  const { round, perPair, limit } = judgeOptions(process.argv.slice(2))
  const judgeDir = judgeDirFor(round)
  if (!existsSync(judgeDir)) throw new Error(`no folder ${judgeDir}: anonymize round ${round} first`)
  const pin = readPin(RESULTS, round)
  const files = judgeFiles(RESULTS, round)
  const rows = loadList(files.rows)
  const leftOut = loadList(files.leftOut)
  const key = readKey(RESULTS, round)
  const template = readFileSync(join(BENCH, 'judge-prompt.md'), 'utf8')
  const groups = subfolders(judgeDir)
  checkLeakScan(RESULTS, round, groups)
  // Every planned job is prepared before the first paid call, so a missing task file stops the run before it spends anything.
  const planned = pendingJobs(groups, [], perPair).map(job => prepareJob(job, judgeDir, template))
  const pending = new Set(pendingJobs(groups, rows, perPair, leftOut).map(jobKey))
  const jobs = planned.filter(job => pending.has(jobKey(job))).slice(0, limit)
  console.log(`${jobs.length} judge job(s) to run`)
  const log = line => console.log(`${new Date().toISOString()} ${line}`)
  const call = judgeCall({ pin, installedKeys: installedPluginKeys(), files, log })
  let leftOutNow
  try {
    leftOutNow = await runJobs(jobs, { rows, call, check: judgeCheck(pin), files, log })
  } finally {
    // From the saved rows on every invocation, so a resume or a stop on a limit leaves it right.
    saveJson(files.edges, countedEdges(key, planned, loadList(files.rows)))
  }
  const leftOutTotal = leftOut.length + leftOutNow
  if (leftOutTotal > 0) {
    console.error(`${leftOutTotal} judge job(s) left out after ${MAX_ATTEMPTS} attempts, listed in ${files.leftOut}`)
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
