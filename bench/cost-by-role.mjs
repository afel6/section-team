// Per task and setup of a round: the mean cost and mean agent count of each role (main, each section, each helper)
// across its runs, priced from each run's evidence transcripts with the bench's own transcriptCost. Read-only over
// results/<id>/; writes results/cost-by-role-<round>.json, which bench/data/<round>/recompute.mjs reads.
// Moved from .superpowers/tools/round-scripts/cost-by-role.mjs (p1 runs only) for the nx round's per-role cost.
// Usage: node bench/cost-by-role.mjs --round=nx
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { NAME, RESULTS } from './run.mjs'
import { required } from './section-memory.mjs'
import { transcriptCost } from './transcript-cost.mjs'

const SETUPS = ['solo', 'base', 'team', 'max', 'lean', 'forced']
const runIdOf = round => new RegExp(`^([A-Za-z0-9]+)-(${SETUPS.join('|')})-${round}-r\\d+$`)
const readJson = file => JSON.parse(readFileSync(file, 'utf8'))
const costOf = file => transcriptCost([readFileSync(file, 'utf8')]).costUSD

// A subagent's type from its meta file beside the transcript; 'unknown' without one.
const typeOf = transcript => {
  const meta = transcript.replace(/\.jsonl$/, '.meta.json')
  return existsSync(meta) ? readJson(meta).agentType ?? 'unknown' : 'unknown'
}

// { [role]: { n, usd } } for one run, or null when it has no session or main transcript.
function runRoles(folder) {
  const sessionFile = join(folder, 'session.json')
  if (!existsSync(sessionFile)) return null
  const { sessionId } = readJson(sessionFile)
  const evidence = join(folder, 'evidence')
  const mainFile = join(evidence, `${sessionId}.jsonl`)
  if (!existsSync(mainFile)) return null
  const subagents = join(evidence, sessionId, 'subagents')
  const files = existsSync(subagents) ? readdirSync(subagents).filter(name => name.endsWith('.jsonl')).sort().map(name => join(subagents, name)) : []
  const priced = [{ role: 'main', usd: costOf(mainFile) }, ...files.map(file => ({ role: typeOf(file), usd: costOf(file) }))]
  return priced.reduce((roles, { role, usd }) => ({ ...roles, [role]: { n: (roles[role]?.n ?? 0) + 1, usd: (roles[role]?.usd ?? 0) + usd } }), {})
}

// One setup's runs summed into mean cost and count per role, highest cost first, with each role's share of the mean.
function setupRow(ids, results) {
  const read = ids.map(id => [id, runRoles(join(results, id))])
  const runs = read.filter(([, roles]) => roles !== null).map(([, roles]) => roles)
  const missing = read.filter(([, roles]) => roles === null).map(([id]) => id)
  if (runs.length === 0) return { runs: 0, meanUSD: null, roles: [], missing }
  const names = [...new Set(runs.flatMap(roles => Object.keys(roles)))]
  const meanOf = (role, field) => runs.reduce((sum, roles) => sum + (roles[role]?.[field] ?? 0), 0) / runs.length
  const rows = names.map(role => ({ role, n: meanOf(role, 'n'), meanUSD: meanOf(role, 'usd') })).sort((a, b) => b.meanUSD - a.meanUSD)
  const meanUSD = rows.reduce((sum, row) => sum + row.meanUSD, 0)
  return { runs: runs.length, meanUSD, roles: rows.map(row => ({ ...row, share: row.meanUSD / meanUSD })), missing }
}

// { [task]: { [setup]: { runs, meanUSD, roles: [{ role, n, meanUSD, share }], missing } } }, tasks and setups sorted.
export function costByRole({ results, round }) {
  required({ results })
  const runId = runIdOf(round)
  const ids = readdirSync(results, { withFileTypes: true }).filter(d => d.isDirectory() && runId.test(d.name)).map(d => d.name).sort()
  const byTask = Map.groupBy(ids, id => runId.exec(id)[1])
  return Object.fromEntries([...byTask.keys()].sort().map(task => {
    const bySetup = Map.groupBy(byTask.get(task), id => runId.exec(id)[2])
    return [task, Object.fromEntries([...bySetup.keys()].sort().map(setup => [setup, setupRow(bySetup.get(setup), results)]))]
  }))
}

const money = usd => (Number.isFinite(usd) ? `$${usd.toFixed(2)}` : '$?')

export function main(argv = process.argv.slice(2), { results } = {}) {
  required({ results })
  const round = argv.find(a => a.startsWith('--round='))?.slice(8) ?? ''
  if (!NAME.test(round)) {
    console.error('usage: node bench/cost-by-role.mjs --round=<tag>   (letters and digits only)')
    process.exitCode = 1
    return
  }
  const out = costByRole({ results, round })
  writeFileSync(join(results, `cost-by-role-${round}.json`), JSON.stringify(out, null, 2) + '\n')
  for (const [task, setups] of Object.entries(out)) {
    for (const [setup, row] of Object.entries(setups)) {
      console.log(`${task} ${setup} (${row.runs} runs) mean ${money(row.meanUSD)}${row.missing.length ? `  no evidence: ${row.missing.join(', ')}` : ''}`)
      for (const r of row.roles) console.log(`  ${r.role.padEnd(28)} n ${r.n.toFixed(1).padStart(5)}  ${money(r.meanUSD).padStart(7)}  ${(100 * r.share).toFixed(0).padStart(3)}%`)
    }
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main(process.argv.slice(2), { results: RESULTS })
  } catch (err) {
    console.error(`cost-by-role: ${err.message}`)
    process.exitCode = 1
  }
}
