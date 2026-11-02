// Scores every finished benchmark run: cost/tokens/time from the transcript (cost computed from the session's
// transcripts when the CLI wrote none, as on a timeout), hidden-test pass rate,
// the project's own `npm test`, code size, agent/model use. Writes results/<id>/metrics.json and results/summary.json.
// Usage: node bench/score.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shortModel } from '../hooks/board-model.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { initOf, outputMessages, resultOf } from './clean-run.mjs'
import { projectDirFor } from './run-attempts.mjs'
import { RESULTS, SEEDS } from './run.mjs'
import { transcriptCost } from './transcript-cost.mjs'

const BENCH = fileURLToPath(new URL('.', import.meta.url))
const CODE_EXT = new Set(['.mjs', '.js', '.cjs', '.html', '.css'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.team', '.claude', '.superpowers'])

// raw.json: stream-json lines (new runs, possibly cut off before the result by a timeout) or one JSON array
// (older runs). With several result lines, the last is the session's true end and is scored (as classifyEnd reads it);
// without any, the session id comes from the init line.
export function parseTranscript(raw) {
  const arr = outputMessages(raw)
  const result = resultOf(arr) ?? {}
  const agents = []
  for (const m of arr) {
    if (m?.type !== 'assistant' || !Array.isArray(m.message?.content)) continue
    for (const part of m.message.content) {
      if (part.type === 'tool_use' && (part.name === 'Agent' || part.name === 'Task')) {
        agents.push({ type: part.input?.subagent_type ?? 'general-purpose', model: part.input?.model ?? null, nested: Boolean(m.parent_tool_use_id) })
      }
    }
  }
  const modelUsage = Object.fromEntries(Object.entries(result.modelUsage ?? {}).map(([k, v]) => [k, {
    input: v.inputTokens ?? 0, output: v.outputTokens ?? 0, cacheRead: v.cacheReadInputTokens ?? 0, cacheWrite: v.cacheCreationInputTokens ?? 0, costUSD: v.costUSD ?? 0,
  }]))
  const totals = Object.values(modelUsage).reduce((t, v) => ({
    input: t.input + v.input, output: t.output + v.output, cacheRead: t.cacheRead + v.cacheRead, cacheWrite: t.cacheWrite + v.cacheWrite,
  }), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  return {
    found: arr.length > 0 && result.type === 'result',
    costUSD: result.total_cost_usd ?? null,
    durationMs: result.duration_ms ?? null,
    apiMs: result.duration_api_ms ?? null,
    turns: result.num_turns ?? null,
    isError: result.is_error ?? null,
    subtype: result.subtype ?? null,
    modelUsage,
    tokens: { ...totals, total: totals.input + totals.output + totals.cacheRead + totals.cacheWrite },
    agentSpawns: agents.length,
    agentTypes: count(agents.map(a => a.type)),
    agentModels: count(agents.map(a => a.model ?? 'inherit')),
    sessionId: result.session_id ?? initOf(arr)?.session_id ?? null,
    finalText: String(result.result ?? '').slice(-1500),
  }
}

// Which model each agent used, as INPUT tokens (fresh + cache read + cache write): { <role>: { <short model>: n } }.
// roles = [{ role, messages }]: the main session and each subagent transcript (see collectRoles). Output tokens are left out on purpose:
// the per-message output_tokens in a transcript are the count when streaming began, about 6x below the real total, so output stays with modelUsage.
// The CLI writes one assistant message per content block with identical usage, so each message id counts once, across all roles.
export function agentModelSplit(roles) {
  const split = {}
  const seen = new Set()
  for (const { role, messages } of roles) {
    for (const m of messages) {
      const { id, model, usage = {} } = m?.type === 'assistant' ? m.message ?? {} : {}
      if (!model || seen.has(id)) continue
      if (id) seen.add(id)
      const models = (split[role] ??= {})
      const name = shortModel(model)
      models[name] = (models[name] ?? 0) + (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
    }
  }
  return split
}

// What the split misses: modelUsage input per short model minus the split's total for it. Negative means the split has more than the CLI billed.
// `complete` needs the transcripts found (split not null) and every remainder 0. Without a split everything is unattributed.
export function splitCoverage(split, modelUsage) {
  const billed = {}
  for (const [id, u] of Object.entries(modelUsage)) billed[shortModel(id)] = (billed[shortModel(id)] ?? 0) + u.input + u.cacheRead + u.cacheWrite
  const seen = {}
  for (const models of Object.values(split ?? {})) for (const [name, n] of Object.entries(models)) seen[name] = (seen[name] ?? 0) + n
  const unattributed = Object.fromEntries([...new Set([...Object.keys(billed), ...Object.keys(seen)])].map(name => [name, (billed[name] ?? 0) - (seen[name] ?? 0)]))
  return { complete: split !== null && Object.values(unattributed).every(n => n === 0), unattributed }
}

const readJsonl = path => readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
// A missing or unreadable .meta.json leaves the agent as role 'unknown' with no parent.
const readMeta = metaPath => { try { return JSON.parse(readFileSync(metaPath, 'utf8')) ?? {} } catch { return {} } }

function subagentRole(subagents, name) {
  const meta = readMeta(join(subagents, name.replace(/\.jsonl$/, '.meta.json')))
  const messages = readJsonl(join(subagents, name))
  return {
    role: meta.agentType ?? 'unknown',
    agentId: name.replace(/^agent-/, '').replace(/\.jsonl$/, ''),
    parentId: meta.parentAgentId ?? null,
    start: messages[0]?.timestamp ?? null,
    messages,
  }
}

// The same rule as copyEvidence's: the id becomes a file name, so it holds letters, digits and dashes only.
const isPlainSessionId = id => typeof id === 'string' && /^[A-Za-z0-9-]+$/.test(id)

// A session's files in a project folder (~/.claude/projects/<slug>/ or a run's evidence/ copy):
// <session id>.jsonl and <session id>/subagents/agent-*.jsonl (+ .meta.json with agentType); null without the session file.
// The id becomes part of a path, so an id that is not plain throws one line here, for every caller.
function sessionFiles(projectDir, sessionId) {
  if (!sessionId) return null
  if (!isPlainSessionId(sessionId)) throw new Error(`${projectDir}: session id is not plain (letters, digits and dashes only)`)
  const sessionFile = join(projectDir, `${sessionId}.jsonl`)
  if (!existsSync(sessionFile)) return null
  const subagents = join(projectDir, sessionId, 'subagents')
  const names = existsSync(subagents) ? readdirSync(subagents).filter(name => name.endsWith('.jsonl')) : []
  return { sessionFile, subagents, names }
}

// Reads a run's session transcript and every subagent transcript (background heads and their depth-2 helpers are only here, not in raw.json).
// Returns [{ role, messages }] with the session as 'main', or null when the session file is missing.
// Each subagent entry also has agentId (from agent-<id>.jsonl), parentId (meta.parentAgentId, null at depth 1) and start (first message's timestamp or null).
export function collectRolesFrom(projectDir, sessionId) {
  const files = sessionFiles(projectDir, sessionId)
  if (!files) return null
  return [
    { role: 'main', messages: readJsonl(files.sessionFile) },
    ...files.names.map(name => subagentRole(files.subagents, name)),
  ]
}

export const collectRoles = (runDir, sessionId, home = homedir()) => collectRolesFrom(projectDirFor(runDir, home), sessionId)

// The same transcripts as text, session first, for transcriptCost; [] when the session file is missing.
export function sessionTexts(projectDir, sessionId) {
  const files = sessionFiles(projectDir, sessionId)
  if (!files) return []
  return [files.sessionFile, ...files.names.map(name => join(files.subagents, name))].map(path => readFileSync(path, 'utf8'))
}

// A run's cost: total_cost_usd when the CLI wrote one, else computed from its transcripts and marked (a lower bound).
// No transcripts at all leaves it unknown (NaN, written as null), never $0.
export function costOf({ transcript, evidenceTexts }) {
  if (typeof transcript?.costUSD === 'number') return { costUSD: transcript.costUSD, costComputed: false }
  return { costUSD: evidenceTexts?.length ? transcriptCost(evidenceTexts).costUSD : NaN, costComputed: true }
}

// The run's session id: session.json's (written before every attempt), else raw.json's (runs made before session.json); null without either.
// The id becomes part of a path, so an id that is not plain throws, as does a session.json that does not parse. Each error is one fixed line.
export function runSession(outDir) {
  const sessionPath = join(outDir, 'session.json')
  if (existsSync(sessionPath)) {
    const text = readFileSync(sessionPath, 'utf8')
    let record
    try { record = JSON.parse(text) } catch { throw new Error(`${sessionPath} is not valid JSON`) }
    if (!isPlainSessionId(record?.sessionId)) throw new Error(`${sessionPath} has no plain sessionId`)
    return record.sessionId
  }
  const rawPath = join(outDir, 'raw.json')
  const sessionId = existsSync(rawPath) ? parseTranscript(readFileSync(rawPath, 'utf8')).sessionId : null
  if (sessionId !== null && !isPlainSessionId(sessionId)) throw new Error(`${rawPath} has no plain session id`)
  return sessionId
}

// The failures a corrupt or unreadable evidence file causes, which mode-check and gate-stats turn into a run's row: a
// file-system error, or one of the readers' one-line errors (runSession, collectRolesFrom, mode-record.mjs readRecord,
// mode-check's run.json reader; `known` adds a caller's own). Anything else is a bug.
const FILE_CODES = new Set(['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'EBUSY'])
const READER_ERRORS = [/ is not valid JSON$/, / has no plain sessionId$/, / has no plain session id$/, /: session id is not plain /, /^mode record is not valid$/, /^no usable session id /]
export const isFileFailure = (err, known = []) => FILE_CODES.has(err?.code)
  || (err instanceof Error && Object.getPrototypeOf(err) === Error.prototype && [...READER_ERRORS, ...known].some(re => re.test(err.message)))

// Where a run's transcripts are: its evidence/ copy when it has one, else Claude Code's project folder for the run.
export const transcriptDir = (outDir, runDir, home = homedir()) => {
  const evidence = join(outDir, 'evidence')
  return existsSync(evidence) ? evidence : projectDirFor(runDir, home)
}

// The task's seed folder (h5 has one), or null.
export const seedDirFor = (task, seeds = SEEDS) => (existsSync(join(seeds, task)) ? join(seeds, task) : null)

function count(list) {
  return list.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {})
}

export function parseTap(text) {
  const num = key => Number((text.match(new RegExp(`^# ${key} (\\d+)`, 'm')) ?? [])[1] ?? 0)
  return { tests: num('tests'), pass: num('pass'), fail: num('fail') }
}

// The hidden tests and the solution's own npm test both run solution code: give them only what node (and npm) needs,
// so API keys and tokens in the maintainer's shell never reach a solution.
const HIDDEN_ENV_KEYS = ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR']
const NPM_ENV_KEYS = [...HIDDEN_ENV_KEYS, 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemDrive', 'ComSpec', 'PATHEXT']
const pickEnv = (keys, env) => Object.fromEntries(keys.filter(k => env[k] !== undefined).map(k => [k, env[k]]))

export function hiddenEnv(dir, env = process.env) {
  return { ...pickEnv(HIDDEN_ENV_KEYS, env), TARGET_DIR: dir }
}

export function hiddenTests(task, dir) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(BENCH, 'hidden', `${task}.test.mjs`)], {
    env: hiddenEnv(dir), encoding: 'utf8', timeout: 300_000, windowsHide: true,
  })
  const tap = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const counts = parseTap(r.stdout ?? '')
  return { ...counts, rate: counts.tests ? counts.pass / counts.tests : 0, tap }
}

export function ownTests(dir, env = process.env) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return { hasScript: false, passed: false }
  let pkg
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { return { hasScript: false, passed: false } }
  if (!pkg.scripts?.test) return { hasScript: false, passed: false }
  const r = spawnSync('npm test', { cwd: dir, env: pickEnv(NPM_ENV_KEYS, env), encoding: 'utf8', timeout: 300_000, shell: true, windowsHide: true })
  const counts = parseTap(r.stdout ?? '')
  const specPass = Number(((r.stdout ?? '').match(/ℹ pass (\d+)/) ?? [])[1] ?? 0)
  const specFail = Number(((r.stdout ?? '').match(/ℹ fail (\d+)/) ?? [])[1] ?? 0)
  return { hasScript: true, passed: r.status === 0, exitCode: r.status, pass: counts.pass || specPass, fail: counts.fail || specFail }
}

// rel uses '/' separators, relative to the solution folder.
export const isTestPath = rel => /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.test\.[cm]?js$/.test(rel)

export const sameAsSeed = (seedDir, rel, path) => {
  if (!seedDir) return false
  const seedFile = join(seedDir, rel)
  return existsSync(seedFile) && statSync(seedFile).isFile() && readFileSync(seedFile).equals(readFileSync(path))
}

// Lines of code, tests and docs in a solution. With seedDir, a file byte-identical to the seed's same path is the
// seed's work, not the solution's, and is left out.
export function codeStats(dir, seedDir = null) {
  const stats = { files: 0, lines: 0, testFiles: 0, testLines: 0, docsLines: 0 }
  const walk = d => {
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name)) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const rel = relative(dir, p).replace(/\\/g, '/')
      const kind = /\.md$/i.test(name) ? 'docs' : CODE_EXT.has(extname(name)) ? (isTestPath(rel) ? 'test' : 'code') : null
      if (!kind || sameAsSeed(seedDir, rel, p)) continue
      const lines = readFileSync(p, 'utf8').split('\n').length
      if (kind === 'docs') stats.docsLines += lines
      else if (kind === 'test') { stats.testFiles++; stats.testLines += lines } else { stats.files++; stats.lines += lines }
    }
  }
  if (existsSync(dir)) walk(dir)
  return stats
}

function teamStats(dir) {
  const base = join(dir, '.team', 'reports')
  if (!existsSync(base)) return { reports: 0, sections: {}, summaries: 0 }
  const names = readdirSync(base).flatMap(day => { const p = join(base, day); return statSync(p).isDirectory() ? readdirSync(p) : [] })
  const summaries = names.filter(n => n.includes('supervisor-summary')).length
  const sections = count(names.filter(n => !n.includes('supervisor-summary')).map(n => n.replace(/^\d{6}-/, '').replace(/(-\d+)?\.md$/, '')))
  return { reports: names.length - summaries, sections, summaries }
}

// One run's metrics. Transcripts come from the run's evidence/ copy when it has one (Claude Code's project folder otherwise),
// the session id from session.json, and code size leaves out files unchanged from the task's seed.
function scoreRun(id) {
  const outDir = join(RESULTS, id)
  const run = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8'))
  const transcript = parseTranscript(readFileSync(join(outDir, 'raw.json'), 'utf8'))
  const sessionId = runSession(outDir)
  const transcripts = transcriptDir(outDir, run.dir)
  const roles = collectRolesFrom(transcripts, sessionId)
  const split = roles && agentModelSplit(roles)
  const hidden = hiddenTests(run.task, run.dir)
  writeFileSync(join(outDir, 'hidden.tap'), hidden.tap)
  return {
    ...run, transcript, cost: costOf({ transcript, evidenceTexts: sessionTexts(transcripts, sessionId) }), split, splitCoverage: splitCoverage(split, transcript.modelUsage),
    hidden: { tests: hidden.tests, pass: hidden.pass, fail: hidden.fail, rate: hidden.rate }, own: ownTests(run.dir),
    code: codeStats(run.dir, seedDirFor(run.task)), team: teamStats(run.dir),
  }
}

function main() {
  const rows = []
  for (const id of readdirSync(RESULTS)) {
    if (!existsSync(join(RESULTS, id, 'run.json'))) continue
    const metrics = scoreRun(id)
    writeFileSync(join(RESULTS, id, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n')
    rows.push(metrics)
    console.log(scoreLine(metrics))
  }
  writeFileSync(join(RESULTS, 'summary.json'), JSON.stringify(rows.map(summaryRow), null, 2) + '\n')
}

// The line ends with how the run ended (run.json's end; '?' for held-out runs, which have none). A cost computed from
// transcripts is marked.
export function scoreLine({ id, hidden, own, transcript, cost, wallMs, timedOut, end }) {
  const usd = `$${Number.isFinite(cost.costUSD) ? cost.costUSD.toFixed(2) : '?'}${cost.costComputed ? ' computed' : ''}`
  return `${id.padEnd(16)} hidden ${hidden.pass}/${hidden.tests}  own ${own.passed ? 'ok ' : 'FAIL'}  ${usd}  ${Math.round(wallMs / 1000)}s  agents ${transcript.agentSpawns}  timedOut=${timedOut}  end=${end ?? '?'}`
}

export const summaryRow = r => ({
  id: r.id, task: r.task, cond: r.cond, rep: r.rep, timedOut: r.timedOut, isError: r.transcript.isError === true, wallMs: r.wallMs,
  costUSD: r.cost.costUSD, costComputed: r.cost.costComputed, tokens: r.transcript.tokens, turns: r.transcript.turns, agentSpawns: r.transcript.agentSpawns,
  agentTypes: r.transcript.agentTypes, agentModels: r.transcript.agentModels, modelUsage: r.transcript.modelUsage, split: r.split, splitCoverage: r.splitCoverage,
  hidden: r.hidden, own: r.own, code: r.code, team: r.team,
})

// One plain line and exit 1 on any failure; a missing input names the step that makes it.
if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (err) {
    console.error(`score: ${err.code === 'ENOENT' ? `missing ${err.path}: run node bench/run.mjs first` : err.message}`)
    process.exitCode = 1
  }
}
