// Attempts of one benchmark run (spec: docs/specs/2026-11-01-mode-round-design.md, "Attempts and reruns" and "Evidence"):
// earlier attempts are archived, never deleted; each attempt's ending is classified; API failures and void runs stop the
// batch (the round after the capped reruns); counted runs get a run.json with their evidence copied beside it.
// results/<id>/attempts.json lists every capped failure and harness-bug rerun of the run, across attempts.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { PLUGIN_KEY, childEnv, effortProblems, envNames, initOf, initProblems, resultOf } from './clean-run.mjs'
import { renameRetry } from './section-memory.mjs'

// The frozen match rules: a usage or rate limit waits for the next usage window; any other API failure is capped.
export const LIMIT = /usage limit|rate limit|rate_limit_error|hit your (?:[a-z]+ )*limit|out of (?:extra usage|usage credits)/i
export const API_FAILURE = /API Error|overloaded|overloaded_error|api_error/i
// Capped reruns per run id, counted since the last harness-bug rerun.
const CAPPED = ['api-other', 'void']
const MAX_RERUNS = 2
const ATTEMPT = /^attempt-\d+$/
const ATTEMPTS_FILE = 'attempts.json'
const SESSION_ID = /^[A-Za-z0-9-]+$/
// initProblems rule 6 (model, claude_code_version, apiKeySource): a harness bug, not a run's fault.
const VERSION_RULE = /^(model|claude_code_version|apiKeySource) .*, expected /
const INIT_FIELDS = ['plugins', 'mcp_servers', 'agents', 'skills', 'claude_code_version', 'model', 'apiKeySource']

class Stop extends Error {
  constructor(label, reason) {
    super(`${label}: ${reason}`)
    this.reason = reason
  }
}
// Stops the batch: main exits 2, and a resume reruns the run.
export class BatchStop extends Stop {
  name = 'BatchStop'
  exitCode = 2
  constructor(reason) { super('batch stopped', reason) }
}
// Stops the round: main exits 3 until the cause is fixed under the harness-bug rule.
export class RoundStop extends Stop {
  name = 'RoundStop'
  exitCode = 3
  constructor(reason) { super('round stopped', reason) }
}
// main's exit code: 2 or 3 for a stop, 1 for any other error.
export const exitCodeOf = err => (err instanceof BatchStop || err instanceof RoundStop ? err.exitCode : 1)

// The setup (solo, lean, team, max or forced), without the round tag.
export const baseOf = run => run.base ?? run.cond
const json = value => `${JSON.stringify(value, null, 2)}\n`
const firstLine = text => String(text ?? '').split(/\r?\n/)[0].slice(0, 200)

// Claude Code's project folder for a run folder: transcripts and auto-memory.
export const projectDirFor = (runDir, home = homedir()) => join(home, '.claude', 'projects', runDir.replace(/[^a-zA-Z0-9]/g, '-'))

// The number the next attempt folder gets: one more than the attempt folders there are.
export const nextAttempt = outDir => (existsSync(outDir) ? readdirSync(outDir).filter(name => ATTEMPT.test(name)).length : 0) + 1

// Moves an earlier attempt's results and the run's project folder into outDir/attempt-<n>/; null when there is none.
// The folder is made without recursive, so a gap in the numbering throws EEXIST instead of mixing two attempts.
export function archiveAttempt(outDir, projectDir) {
  const names = existsSync(outDir) ? readdirSync(outDir).filter(name => !ATTEMPT.test(name) && name !== ATTEMPTS_FILE) : []
  const project = existsSync(projectDir)
  if (names.length === 0 && !project) return null
  const target = join(outDir, `attempt-${nextAttempt(outDir)}`)
  mkdirSync(outDir, { recursive: true })
  mkdirSync(target)
  for (const name of names) renameRetry(join(outDir, name), join(target, name))
  if (project) renameRetry(projectDir, join(target, basename(projectDir)))
  return target
}

export function classifyEnd({ messages, timedOut, exitCode }) {
  if (timedOut) return 'timeout'
  const result = resultOf(messages)
  if (!result) return exitCode !== 0 ? 'crash' : 'no-result'
  if (!result.is_error) return 'ok'
  const text = String(result.result ?? '')
  if (LIMIT.test(text) || result.api_error_status === 429) return 'api-limit'
  if (result.api_error_status != null || API_FAILURE.test(text)) return 'api-other'
  return 'error'
}

// A results file's JSON, or undefined when it does not exist; a broken file is one line naming it.
function readJsonFile(file) {
  if (!existsSync(file)) return undefined
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`${file} is not valid JSON (${err.message}): fix it before the batch resumes`, { cause: err })
  }
}

function readHistory(outDir) {
  const file = join(outDir, ATTEMPTS_FILE)
  const history = readJsonFile(file) ?? []
  if (!Array.isArray(history)) throw new Error(`${file} is not a list of attempts`)
  return history
}

const cappedCount = history => history.slice(history.findLastIndex(e => e?.kind === 'harness-bug') + 1).filter(e => CAPPED.includes(e?.kind)).length

export function recordAttempt(outDir, entry) {
  const history = [...readHistory(outDir), entry]
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, ATTEMPTS_FILE), json(history))
  return { capped: cappedCount(history), history }
}

// Every file under path (path itself when it is a file).
const filesAt = path => (statSync(path).isFile()
  ? [path]
  : readdirSync(path, { withFileTypes: true, recursive: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)))

// Copies this session's transcript, its subagent folder and its mode record into outDir/evidence/, laid out so that
// collectRolesFrom and readRecord read the evidence folder as they read a project folder and a home. Checks before
// copying anything, so a stop leaves no partial evidence. Returns the copied files.
export function copyEvidence({ runDir, sessionId, outDir, base, home = homedir(), bestEffort = false }) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw new TypeError(`copyEvidence needs a plain session id, got "${sessionId}"`)
  const project = projectDirFor(runDir, home)
  const evidence = join(outDir, 'evidence')
  const record = join('.claude', 'section-team', 'modes', `${sessionId}.json`)
  const items = [
    { from: join(project, `${sessionId}.jsonl`), to: join(evidence, `${sessionId}.jsonl`), required: true },
    { from: join(project, sessionId), to: join(evidence, sessionId), required: false },
    { from: join(home, record), to: join(evidence, record), required: base !== 'solo' },
  ]
  const missing = items.find(item => item.required && !existsSync(item.from))
  if (missing && !bestEffort) throw new Error(`evidence missing for ${sessionId}: ${missing.from}`)
  return items.filter(item => existsSync(item.from)).flatMap(item => {
    cpSync(item.from, item.to, { recursive: true })
    return filesAt(item.to)
  })
}

// The round stops on the third capped failure since the last harness-bug rerun; before that, the batch stops.
function capStop(run, capped, what) {
  if (capped > MAX_RERUNS) return new RoundStop(`${run.id}: ${what}, failure ${capped}; fix the cause as a harness bug, then resume with --rerun=${run.id} --reason=<fix commit>`)
  return new BatchStop(`${run.id}: ${what}; a resume reruns it (rerun ${capped} of ${MAX_RERUNS})`)
}

function runRecord({ run, dir, info, sessionId, attempt, kind, result, ctx, init, env }) {
  const sectionTeam = init.plugins.find(p => p?.source === PLUGIN_KEY)
  return {
    ...run, dir, ...info, sessionId, attempt, end: kind,
    subtype: result?.subtype ?? null,
    resultText: typeof result?.result === 'string' ? result.result.slice(0, 500) : null,
    pluginCommit: ctx.pluginCommit,
    sectionTeam: sectionTeam ? { path: sectionTeam.path, version: sectionTeam.version } : null,
    init: Object.fromEntries(INIT_FIELDS.map(field => [field, init[field] ?? null])),
    envNames: envNames(env),
  }
}

// Ends one attempt: a run.json for a counted run, otherwise void.json and/or an attempts entry and a BatchStop or RoundStop.
// env is the child environment the attempt ran with (run.json records its names).
export function finishAttempt({ run, outDir, dir, sessionId, attempt, info, messages, pin, ctx, evidenceTexts, write = writeFileSync, env = childEnv(process.env, { pluginDir: ctx.pluginDir }) }) {
  const kind = classifyEnd({ messages, timedOut: info.timedOut, exitCode: info.exitCode })
  const result = resultOf(messages)
  const entry = { attempt, sessionId, at: new Date().toISOString() }
  if (kind === 'api-limit') throw new BatchStop(`${run.id}: usage or rate limit (${firstLine(result.result)}); resume in the next usage window`)
  if (kind === 'api-other') {
    const text = firstLine(result.result)
    throw capStop(run, recordAttempt(outDir, { kind, ...entry, resultText: text }).capped, `API failure (${text})`)
  }
  const init = initOf(messages)
  const reasons = [...initProblems(init, { setup: baseOf(run), pin, pluginDir: ctx.pluginDir }), ...effortProblems(evidenceTexts)]
  if (reasons.length > 0) {
    write(join(outDir, 'void.json'), json({ reasons }))
    if (reasons.some(reason => VERSION_RULE.test(reason))) {
      recordAttempt(outDir, { kind: 'harness-bug', reason: 'version or model mismatch', ...entry, reasons })
      throw new BatchStop('harness bug: version or model mismatch')
    }
    throw capStop(run, recordAttempt(outDir, { kind: 'void', ...entry, reasons }).capped, `void (${reasons.join('; ')})`)
  }
  const wrote = join(outDir, 'run.json')
  write(wrote, json(runRecord({ run, dir, info, sessionId, attempt, kind, result, ctx, init, env })))
  return { kind, wrote }
}

const startedAt = outDir => readJsonFile(join(outDir, 'run.json'))?.startedAt

// A rerun is recorded once per reason, so a resume with the same flags neither resets the cap again nor reruns a run
// whose run.json started after the fix was recorded.
function owesRerun(outDir, reason, at) {
  const earlier = readHistory(outDir).findLast(e => e?.kind === 'harness-bug' && e.reason === reason)
  if (earlier === undefined) {
    recordAttempt(outDir, { kind: 'harness-bug', reason, at })
    return true
  }
  return !(startedAt(outDir) > earlier.at)
}

// The runs left to do: those without run.json, plus the --rerun ids of a harness-bug fix.
export function pendingRuns(runs, { results, rerun = [], reason = '', at } = {}) {
  const unknown = rerun.find(id => !runs.some(run => run.id === id))
  if (unknown !== undefined) throw new RangeError(`--rerun names ${unknown}, which is not a run of this batch`)
  if (rerun.length > 0 && reason.trim() === '') throw new RangeError('--rerun needs --reason= naming the harness-bug fix commit')
  if (rerun.length > 0 && typeof at !== 'string') throw new TypeError('pendingRuns needs the time (at) to record a rerun')
  const owed = rerun.filter(id => owesRerun(join(results, id), reason, at))
  const pending = runs.filter(run => owed.includes(run.id) || !existsSync(join(results, run.id, 'run.json')))
  const capped = pending.find(run => cappedCount(readHistory(join(results, run.id))) > MAX_RERUNS)
  if (capped !== undefined) throw new RoundStop(`${capped.id}: its ${MAX_RERUNS} capped reruns are used; fix the cause as a harness bug, then resume with --rerun=${capped.id} --reason=<fix commit>`)
  return pending
}
