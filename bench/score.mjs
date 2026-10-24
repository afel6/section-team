// Scores every finished benchmark run: cost/tokens/time from the transcript, hidden-test pass rate,
// the project's own `npm test`, code size, agent/model use. Writes results/<id>/metrics.json and results/summary.json.
// Usage: node bench/score.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    finalText: String(result.result ?? '').slice(-1500),
  }
}

function count(list) {
  return list.reduce((acc, k) => ({ ...acc, [k]: (acc[k] ?? 0) + 1 }), {})
}

export function parseTap(text) {
  const num = key => Number((text.match(new RegExp(`^# ${key} (\\d+)`, 'm')) ?? [])[1] ?? 0)
  return { tests: num('tests'), pass: num('pass'), fail: num('fail') }
}

function hiddenTests(task, dir) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(BENCH, 'hidden', `${task}.test.mjs`)], {
    env: { ...process.env, TARGET_DIR: dir }, encoding: 'utf8', timeout: 300_000, windowsHide: true,
  })
  const tap = `${r.stdout ?? ''}\n${r.stderr ?? ''}`
  const counts = parseTap(r.stdout ?? '')
  return { ...counts, rate: counts.tests ? counts.pass / counts.tests : 0, tap }
}

function ownTests(dir) {
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) return { hasScript: false, passed: false }
  let pkg
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { return { hasScript: false, passed: false } }
  if (!pkg.scripts?.test) return { hasScript: false, passed: false }
  const r = spawnSync('npm', ['test'], { cwd: dir, encoding: 'utf8', timeout: 300_000, shell: true, windowsHide: true })
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
    const metrics = { ...run, transcript, hidden: { tests: hidden.tests, pass: hidden.pass, fail: hidden.fail, rate: hidden.rate }, own, code: codeStats(run.dir), team: teamStats(run.dir) }
    writeFileSync(join(RESULTS, id, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n')
    rows.push(metrics)
    console.log(`${id.padEnd(16)} hidden ${hidden.pass}/${hidden.tests}  own ${own.passed ? 'ok ' : 'FAIL'}  $${(transcript.costUSD ?? 0).toFixed(2)}  ${Math.round(run.wallMs / 1000)}s  agents ${transcript.agentSpawns}  timedOut=${run.timedOut}`)
  }
  writeFileSync(join(RESULTS, 'summary.json'), JSON.stringify(rows.map(r => ({
    id: r.id, task: r.task, cond: r.cond, rep: r.rep, timedOut: r.timedOut, wallMs: r.wallMs,
    costUSD: r.transcript.costUSD, tokens: r.transcript.tokens, turns: r.transcript.turns, agentSpawns: r.transcript.agentSpawns,
    agentTypes: r.transcript.agentTypes, agentModels: r.transcript.agentModels, modelUsage: r.transcript.modelUsage,
    hidden: r.hidden, own: r.own, code: r.code, team: r.team,
  })), null, 2) + '\n')
}

if (isMainModule(import.meta.url)) main()
