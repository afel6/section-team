// Attempts of one benchmark run (spec: docs/specs/2026-11-01-mode-round-design.md, "Attempts and reruns" and "Evidence"):
// earlier attempts are archived, never deleted; each attempt's ending is classified; API failures and void runs stop the
// batch (the round after the capped reruns); counted runs get a run.json with their evidence copied beside it.
// results/<id>/attempts.json lists every capped failure, usage limit, missing-evidence stop, failed stage copy and
// harness-bug rerun of the run, across attempts; only the CAPPED kinds count toward the cap.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PLUGIN_KEY, childEnv, effortProblems, envNames, initOf, initProblems, resultOf } from './clean-run.mjs'
import { renameRetry, required } from './section-memory.mjs'

// The frozen match rules: a usage or rate limit waits for the next usage window; any other API failure is capped.
export const LIMIT = /usage limit|rate limit|rate_limit_error|(?:hit|reached) your (?:[a-z]+ )*limit|out of (?:extra usage|usage credits)/i
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
// Required evidence (the session transcript, a builder's mode record) missing after a run: a harness or evidence error.
// main exits 1 on it, like any other error: stop and report, never resume on its own. path is the missing file.
export class EvidenceMissing extends Error {
  name = 'EvidenceMissing'
  constructor(message, path) {
    super(message)
    this.path = path
  }
}
// main's exit code: 2 or 3 for a stop, 1 for any other error.
export const exitCodeOf = err => (err instanceof BatchStop || err instanceof RoundStop ? err.exitCode : 1)

// The setup (solo, lean, team, max or forced), without the round tag.
export const baseOf = run => run.base ?? run.cond
// What keeps a run's init from counting, by its setup and its batch's ctx ({ pin, pluginDir, pluginVersion }).
export const runInitProblems = (messages, run, ctx) => initProblems(initOf(messages), { setup: baseOf(run), pin: ctx.pin, pluginDir: ctx.pluginDir, pluginVersion: ctx.pluginVersion })
const json = value => `${JSON.stringify(value, null, 2)}\n`
export const firstLine = text => String(text ?? '').split(/\r?\n/)[0].slice(0, 200)

// Claude Code's project folder for a run folder: transcripts and auto-memory. archiveAttempt moves it, so home has no default.
export function projectDirFor(runDir, home) {
  required({ home })
  return join(home, '.claude', 'projects', runDir.replace(/[^a-zA-Z0-9]/g, '-'))
}

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
export const filesAt = path => (statSync(path).isFile()
  ? [path]
  : readdirSync(path, { withFileTypes: true, recursive: true }).filter(e => e.isFile()).map(e => join(e.parentPath, e.name)))

// Copies this session's transcript, its subagent folder and its mode record into outDir/evidence/, laid out so that
// collectRolesFrom and readRecord read the evidence folder as they read a project folder and a home. Checks before
// copying anything, so a stop leaves no partial evidence. Returns the copied files.
export function copyEvidence({ runDir, sessionId, outDir, base, home, bestEffort = false }) {
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
  if (missing && !bestEffort) throw new EvidenceMissing(`evidence missing for ${sessionId}: ${missing.from}`, missing.from)
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
// env is the child environment the attempt ran with (run.json records its names). extraReasons void it too: what only
// the caller can see, such as a second stage that resumed as another session.
export function finishAttempt({ run, outDir, dir, sessionId, attempt, info, messages, ctx, evidenceTexts, extraReasons = [], write = writeFileSync, env = childEnv(process.env, { pluginDir: ctx.pluginDir }) }) {
  const kind = classifyEnd({ messages, timedOut: info.timedOut, exitCode: info.exitCode })
  const result = resultOf(messages)
  const entry = { attempt, sessionId, at: new Date().toISOString() }
  // A limit is recorded but never capped (cappedCount skips the kind), so attempts.json lists every attempt.
  if (kind === 'api-limit') {
    const text = firstLine(result.result)
    recordAttempt(outDir, { kind, ...entry, resultText: text })
    throw new BatchStop(`${run.id}: usage or rate limit (${text}); resume in the next usage window`)
  }
  if (kind === 'api-other') {
    const text = firstLine(result.result)
    throw capStop(run, recordAttempt(outDir, { kind, ...entry, resultText: text }).capped, `API failure (${text})`)
  }
  const init = initOf(messages)
  const reasons = [...runInitProblems(messages, run, ctx), ...effortProblems(evidenceTexts), ...extraReasons]
  if (reasons.length > 0) {
    write(join(outDir, 'void.json'), json({ reasons }))
    const mismatch = reasons.filter(reason => VERSION_RULE.test(reason))
    if (mismatch.length > 0) {
      recordAttempt(outDir, { kind: 'harness-bug', reason: 'version or model mismatch', ...entry, reasons })
      throw new BatchStop(`harness bug: ${run.id} attempt ${attempt}: version or model mismatch (${mismatch.join('; ')})`)
    }
    throw capStop(run, recordAttempt(outDir, { kind: 'void', ...entry, reasons }).capped, `void (${reasons.join('; ')})`)
  }
  const wrote = join(outDir, 'run.json')
  write(wrote, json(runRecord({ run, dir, info, sessionId, attempt, kind, result, ctx, init, env })))
  return { kind, wrote }
}

// A harness-bug rerun is recorded once per reason, so a resume with the same flags does not reset the cap again.
function recordRerun(outDir, reason, at) {
  if (!readHistory(outDir).some(e => e?.kind === 'harness-bug' && e.reason === reason)) recordAttempt(outDir, { kind: 'harness-bug', reason, at })
}

// A run is left to do without a run.json, or while its run.json started before its last harness-bug entry: a run a
// fix named stays owed on every resume, with or without --rerun, until it has run again.
function owed(outDir) {
  const record = readJsonFile(join(outDir, 'run.json'))
  if (record === undefined) return true
  const fix = readHistory(outDir).findLast(e => e?.kind === 'harness-bug')
  return fix !== undefined && !(record.startedAt > fix.at)
}

// The runs left to do, after recording the --rerun ids of a harness-bug fix.
export function pendingRuns(runs, { results, rerun = [], reason = '', at } = {}) {
  const unknown = rerun.find(id => !runs.some(run => run.id === id))
  if (unknown !== undefined) throw new RangeError(`--rerun names ${unknown}, which is not a run of this batch`)
  if (rerun.length > 0 && reason.trim() === '') throw new RangeError('--rerun needs --reason= naming the harness-bug fix commit')
  if (rerun.length > 0 && typeof at !== 'string') throw new TypeError('pendingRuns needs the time (at) to record a rerun')
  for (const id of rerun) recordRerun(join(results, id), reason, at)
  const pending = runs.filter(run => owed(join(results, run.id)))
  const capped = pending.find(run => cappedCount(readHistory(join(results, run.id))) > MAX_RERUNS)
  if (capped !== undefined) throw new RoundStop(`${capped.id}: its ${MAX_RERUNS} capped reruns are used; fix the cause as a harness bug, then resume with --rerun=${capped.id} --reason=<fix commit>`)
  return pending
}
