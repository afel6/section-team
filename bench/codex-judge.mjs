// Has Codex judge a case set (from bench/external-judge.mjs prepare, copy or rebuild-heldout) one case at a time,
// each in its own fresh headless session (codex exec --ephemeral) whose workspace is only that case's folder, with
// the model, effort, sandbox and binary from the frozen run sheet bench/outside-run-sheet.md.
// Every attempt is logged in bench/results/codex-logs/<set>/ as <case>-a<n>.cmd.txt (the exact command, as a JSON
// argv), .jsonl (Codex's --json events), .err and .last.txt (its last message). Codex in a read-only sandbox cannot
// write verdict.json, so the last message's final fenced json block stands in for it.
// A verdict that fails the Opus verdict parser is moved to <case>-a<n>.verdict.json, its reason is written to
// <case>-a<n>.unusable.txt, and the case is asked again in a fresh session, at most twice.
// A Codex that cannot start, or that exits non-zero without a usable verdict (a usage limit, a sign-in or network
// failure), stops the run without using an attempt. Resumable: a case with a verdict.json is skipped, and a case's
// attempt count comes from its .unusable.txt files, so no case is ever asked a fourth time.
// Usage: node bench/codex-judge.mjs --set=C:/Users/Asus/codex-judge-mo
import { spawnSync } from 'node:child_process'
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { verdictText } from './external-judge.mjs'
import { JSON_BLOCK, MAX_ATTEMPTS, parseVerdict, subfolders } from './judge.mjs'
import { RESULTS } from './run.mjs'

const SHEET = join(dirname(fileURLToPath(import.meta.url)), 'outside-run-sheet.md')
const USAGE = 'usage: node bench/codex-judge.mjs --set=<case set folder>'
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']
// Model and effort go into Codex's arguments, the effort inside a TOML string: plain names only.
const PLAIN_NAME = /^[A-Za-z0-9._-]+$/
const CASE = /^case-\d+$/
const ATTEMPT_FILE = /^(.+)-a(\d+)\.(.+)$/

export const CODEX_PROMPT = [
  'You are a blind code reviewer. The current folder is one case.',
  'Read JUDGE.md here and follow it exactly, without asking questions.',
  'Work only inside this folder, and put probes only in scratch/.',
  'Never edit, create or delete anything in the solution folders or in SEED.',
  'Do not use the network.',
  'End your answer with your verdict as one fenced json block.',
].join(' ')

// { codexBin, model, effort, sandbox } from the run sheet's first fenced json block. The sandbox must be one of Codex's
// three modes, so a sheet still holding the placeholder starts nothing.
export function sheetValues(text) {
  const [block] = [...text.matchAll(JSON_BLOCK)]
  if (!block) throw new Error('the run sheet has no fenced json block')
  let values
  try {
    values = JSON.parse(block[1])
  } catch (err) {
    throw new Error(`the run sheet's json block does not parse (${err.message.replace(/\s+/g, ' ')}): fix it`, { cause: err })
  }
  if (typeof values !== 'object' || values === null || Array.isArray(values)) throw new Error('the run sheet\'s json block is not an object')
  const { codexBin, model, effort, sandbox } = values
  if (typeof codexBin !== 'string' || codexBin === '') throw new Error('the run sheet needs codexBin: the full path of codex.exe')
  for (const [name, value] of Object.entries({ model, effort })) {
    if (typeof value !== 'string' || !PLAIN_NAME.test(value)) throw new Error(`the run sheet's ${name} must be a plain name (letters, digits, . _ -), got ${JSON.stringify(value)}`)
  }
  if (!SANDBOXES.includes(sandbox)) {
    throw new Error(`the run sheet's sandbox is ${JSON.stringify(sandbox)}: set read-only, workspace-write or danger-full-access after the sandbox probe`)
  }
  return { codexBin, model, effort, sandbox }
}

export const codexArgs = ({ caseDir, model, effort, sandbox, lastMessage }) => [
  'exec', '--ephemeral', '--ignore-user-config', '-m', model, '-c', `model_reasoning_effort="${effort}"`, '--disable', 'memories',
  '--skip-git-repo-check', '-C', caseDir, '-s', sandbox, '--json', '-o', lastMessage, CODEX_PROMPT,
]

// The case's solution folders: its single capital letters (SEED and scratch are not solutions), sorted.
export const caseLabels = caseDir => subfolders(caseDir).filter(name => /^[A-Z]$/.test(name))

const attemptFiles = (logDir, name, n) => {
  const stem = join(logDir, `${name}-a${n}`)
  const file = ext => `${stem}.${ext}`
  return { cmd: file('cmd.txt'), jsonl: file('jsonl'), err: file('err'), last: file('last.txt'), verdict: file('verdict.json'), unusable: file('unusable.txt') }
}

// The highest attempt number logged for a case (a stopped attempt keeps its number), and how many attempts were used:
// checked and found unusable.
function loggedAttempts(logDir, name) {
  const found = readdirSync(logDir).map(file => ATTEMPT_FILE.exec(file)).filter(match => match?.[1] === name)
  return { lastAttempt: Math.max(0, ...found.map(match => Number(match[2]))), used: found.filter(match => match[3] === 'unusable.txt').length }
}

// { verdict } when the case's verdict.json passes the Opus verdict parser, else { problem } in one line. A file that
// cannot be read is a harness fault, not a bad verdict, so it throws.
function checkVerdict(path, name, labels) {
  if (!existsSync(path)) return { problem: 'no verdict.json and no fenced json block in the last message' }
  const text = verdictText(readFileSync(path, 'utf8'))
  try {
    return { verdict: parseVerdict(text, name, labels) }
  } catch (err) {
    return { problem: err.message.replace(/\s+/g, ' ') }
  }
}

// One fresh Codex session on the case, its output streamed into the attempt's log files. Throws when Codex cannot
// start: nothing was asked.
function askCodex({ caseDir, files, values, run }) {
  const args = codexArgs({ caseDir, ...values, lastMessage: files.last })
  writeFileSync(files.cmd, JSON.stringify([values.codexBin, ...args]) + '\n')
  const out = openSync(files.jsonl, 'w')
  const err = openSync(files.err, 'w')
  const started = Date.now()
  try {
    const result = run(values.codexBin, args, { cwd: caseDir, stdio: ['ignore', out, err], windowsHide: true })
    if (result.error) throw new Error(`could not start codex (${values.codexBin}: ${result.error.code ?? result.error.message})`)
    return { exitCode: result.status, seconds: (Date.now() - started) / 1000 }
  } finally {
    closeSync(out)
    closeSync(err)
  }
}

// Codex without write access answers only in its last message: its final fenced json block becomes verdict.json.
function verdictFromMessage(lastMessage, verdictPath) {
  if (existsSync(verdictPath) || !existsSync(lastMessage)) return
  const block = [...readFileSync(lastMessage, 'utf8').matchAll(JSON_BLOCK)].at(-1)
  if (block) writeFileSync(verdictPath, block[1] + '\n')
}

// Copy and delete rather than rename: the case set and the logs may sit on different drives.
function moveAside(from, to) {
  copyFileSync(from, to)
  rmSync(from)
}

const plural = n => `${n} attempt${n === 1 ? '' : 's'}`

// Asks a case until its verdict is usable or it has used MAX_ATTEMPTS. Returns { entry, line }.
function askCase({ caseDir, name, logDir, values, run }) {
  const verdictPath = join(caseDir, 'verdict.json')
  const labels = caseLabels(caseDir)
  let { lastAttempt, used } = loggedAttempts(logDir, name)
  let seconds = 0
  let exitCode = null
  let problem = `no attempts left (reasons in ${logDir})`
  while (used < MAX_ATTEMPTS) {
    lastAttempt += 1
    const files = attemptFiles(logDir, name, lastAttempt)
    const asked = askCodex({ caseDir, files, values, run })
    seconds += asked.seconds
    exitCode = asked.exitCode
    verdictFromMessage(files.last, verdictPath)
    const checked = checkVerdict(verdictPath, name, labels)
    const entry = { case: name, exitCode, seconds: Math.round(seconds), attempts: used + 1, verdict: checked.verdict ?? null }
    if (checked.verdict) return { entry, line: `${name}: usable after ${plural(used + 1)} (${entry.seconds} s)` }
    if (existsSync(verdictPath)) moveAside(verdictPath, files.verdict)
    if (exitCode !== 0) {
      throw new Error(`${name} attempt ${lastAttempt}: codex exited with ${exitCode ?? 'a signal'} and no usable verdict, so no attempt was used; see ${files.err}, then run again to resume`)
    }
    used += 1
    problem = checked.problem
    writeFileSync(files.unusable, problem + '\n')
  }
  return { entry: { case: name, exitCode, seconds: Math.round(seconds), attempts: used, verdict: null }, line: `${name}: not usable after ${plural(used)}: ${problem}` }
}

// A case that already holds a verdict.json is never asked again; its verdict is still checked, so the count is true.
function judgedCase({ caseDir, name, logDir }) {
  const checked = checkVerdict(join(caseDir, 'verdict.json'), name, caseLabels(caseDir))
  const entry = { case: name, exitCode: null, seconds: 0, attempts: loggedAttempts(logDir, name).used + 1, verdict: checked.verdict ?? null }
  const line = checked.verdict
    ? `${name}: usable (judged before this run)`
    : `${name}: not usable: ${checked.problem} (move its verdict.json out of the set to ask again)`
  return { entry, line }
}

// Judges every case-NN folder of setDir in turn and logs one line per case. Returns [{ case, exitCode, seconds,
// attempts, verdict }], verdict null when unusable.
export function runCases({ setDir, logDir, values, run = spawnSync, log }) {
  const cases = subfolders(setDir).filter(name => CASE.test(name))
  if (cases.length === 0) throw new Error(`no case-NN folders in ${setDir}: prepare or copy a case set first`)
  mkdirSync(logDir, { recursive: true })
  return cases.map(name => {
    const job = { caseDir: join(setDir, name), name, logDir, values, run }
    const { entry, line } = existsSync(join(job.caseDir, 'verdict.json')) ? judgedCase(job) : askCase(job)
    log(line)
    return entry
  })
}

function main(argv) {
  const set = argv.find(arg => arg.startsWith('--set='))?.slice('--set='.length)
  if (!set) throw new Error(USAGE)
  const values = sheetValues(readFileSync(SHEET, 'utf8'))
  const setDir = resolve(set)
  const logDir = join(RESULTS, 'codex-logs', basename(setDir))
  const results = runCases({ setDir, logDir, values, log: console.log })
  const usable = results.filter(result => result.verdict).length
  console.log(`${usable} of ${results.length} cases usable`)
  if (usable < results.length) process.exitCode = 1
}

if (isMainModule(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    console.error(`codex-judge: ${err.code === 'ENOENT' ? `missing ${err.path}` : err.message}`)
    process.exitCode = 1
  }
}
