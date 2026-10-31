// Scores every finished benchmark run: cost/tokens/time from the transcript, hidden-test pass rate,
// the project's own `npm test`, code size, agent/model use. Writes results/<id>/metrics.json and results/summary.json.
// Usage: node bench/score.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shortModel } from '../hooks/board-model.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { RESULTS } from './run.mjs'

const BENCH = fileURLToPath(new URL('.', import.meta.url))
const CODE_EXT = new Set(['.mjs', '.js', '.cjs', '.html', '.css'])
const SKIP_DIRS = new Set(['node_modules', '.git', '.team', '.claude', '.superpowers'])

export function parseTranscript(raw) {
  const arr = (() => { try { const d = JSON.parse(raw); return Array.isArray(d) ? d : [d] } catch { return [] } })()
  const result = arr.find(m => m.type === 'result') ?? {}
  const agents = []
  for (const m of arr) {
    if (m.type !== 'assistant' || !Array.isArray(m.message?.content)) continue
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
    sessionId: result.session_id ?? null,
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

// Reads a run's session transcript and every subagent transcript (background heads and their depth-2 helpers are only here, not in raw.json):
// ~/.claude/projects/<run dir with every non-alphanumeric as '-'>/<session id>.jsonl and <session id>/subagents/agent-*.jsonl (+ .meta.json with agentType).
// Returns [{ role, messages }] with the session as 'main', or null when the session file is missing.
// Each subagent entry also has agentId (from agent-<id>.jsonl), parentId (meta.parentAgentId, null at depth 1) and start (first message's timestamp or null).
export function collectRoles(runDir, sessionId, home = homedir()) {
  const project = join(home, '.claude', 'projects', runDir.replace(/[^a-zA-Z0-9]/g, '-'))
  const sessionFile = join(project, `${sessionId}.jsonl`)
  if (!sessionId || !existsSync(sessionFile)) return null
  const subagents = join(project, sessionId, 'subagents')
  const files = existsSync(subagents) ? readdirSync(subagents).filter(name => name.endsWith('.jsonl')) : []
  return [
    { role: 'main', messages: readJsonl(sessionFile) },
    ...files.map(name => subagentRole(subagents, name)),
  ]
}

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

function codeStats(dir) {
  const stats = { files: 0, lines: 0, testFiles: 0, testLines: 0, docsLines: 0 }
  const walk = d => {
    for (const name of readdirSync(d)) {
      if (SKIP_DIRS.has(name)) continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) { walk(p); continue }
      const rel = relative(dir, p).replace(/\\/g, '/')
      const lines = () => readFileSync(p, 'utf8').split('\n').length
      if (/\.md$/i.test(name)) { stats.docsLines += lines(); continue }
      if (!CODE_EXT.has(extname(name))) continue
      const isTest = /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.test\.[cm]?js$/.test(name)
      if (isTest) { stats.testFiles++; stats.testLines += lines() } else { stats.files++; stats.lines += lines() }
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

function main() {
  const rows = []
  for (const id of readdirSync(RESULTS)) {
    const runPath = join(RESULTS, id, 'run.json')
    if (!existsSync(runPath)) continue
    const run = JSON.parse(readFileSync(runPath, 'utf8'))
    const transcript = parseTranscript(readFileSync(join(RESULTS, id, 'raw.json'), 'utf8'))
    const hidden = hiddenTests(run.task, run.dir)
    writeFileSync(join(RESULTS, id, 'hidden.tap'), hidden.tap)
    const own = ownTests(run.dir)
    const roles = collectRoles(run.dir, transcript.sessionId)
    const split = roles && agentModelSplit(roles)
    const metrics = { ...run, transcript, split, splitCoverage: splitCoverage(split, transcript.modelUsage), hidden: { tests: hidden.tests, pass: hidden.pass, fail: hidden.fail, rate: hidden.rate }, own, code: codeStats(run.dir), team: teamStats(run.dir) }
    writeFileSync(join(RESULTS, id, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n')
    rows.push(metrics)
    console.log(scoreLine(metrics))
  }
  writeFileSync(join(RESULTS, 'summary.json'), JSON.stringify(rows.map(summaryRow), null, 2) + '\n')
}

// A run whose CLI ended on an API error (usage limit, overload) still has a result, with is_error set: the line
// says so, because such a run is rerun like a crash, not kept as a result.
export function scoreLine({ id, hidden, own, transcript, wallMs, timedOut }) {
  const error = transcript.isError ? '  API ERROR' : ''
  return `${id.padEnd(16)} hidden ${hidden.pass}/${hidden.tests}  own ${own.passed ? 'ok ' : 'FAIL'}  $${(transcript.costUSD ?? 0).toFixed(2)}  ${Math.round(wallMs / 1000)}s  agents ${transcript.agentSpawns}  timedOut=${timedOut}${error}`
}

export const summaryRow = r => ({
  id: r.id, task: r.task, cond: r.cond, rep: r.rep, timedOut: r.timedOut, isError: r.transcript.isError === true, wallMs: r.wallMs,
  costUSD: r.transcript.costUSD, tokens: r.transcript.tokens, turns: r.transcript.turns, agentSpawns: r.transcript.agentSpawns,
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
