// Reviewer gate stats for one round's team, lean and max runs: each reviewer call's GRADE with its items (from the
// subagent transcripts), first tries and final grades judged by the run's mode's own mark, fix rounds,
// partial/blocked/ungraded REPORTs, hidden tests that fail after a passing gate, and the judges' code quality.
// Writes results/gate-stats-<round>.json and prints one markdown row per run.
// Usage: node bench/gate-stats.mjs --round=mo
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { GATES } from '../hooks/lib/mode.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { parseReport } from '../hooks/lib/report.mjs'
import { RESULTS } from './run.mjs'
import { collectRolesFrom, runSession, transcriptDir } from './score.mjs'

const REVIEWER = 'section-team:reviewer'
const GRADE_HEADING = /^[ \t]*#{1,6}[ \t]*GRADE[ \t]*$/gm
const ITEMS = ['structure', 'naming', 'duplication', 'size', 'errors', 'tests', 'security', 'leftovers']
const isPass = entry => entry?.verdict === 'pass'
const isFail = entry => entry?.verdict === 'fail'

// Each item's score in a GRADE block; an item scored n/a (or absent) is left out.
const itemsOf = block => Object.fromEntries(ITEMS.flatMap(name => {
  const m = new RegExp(`^[ \\t]*${name}:[ \\t]*(\\d+(?:\\.\\d+)?)`, 'm').exec(block)
  return m ? [[name, Number(m[1])]] : []
}))

// The reviewer's last GRADE block → { overall, verdict, items }; null when there is none or it was cut off before Overall or Verdict.
export function parseGrade(text) {
  if (typeof text !== 'string') return null
  const lf = text.replace(/\r\n?/g, '\n').replace(/\*\*/g, '')
  const heading = [...lf.matchAll(GRADE_HEADING)].at(-1)
  if (!heading) return null
  const block = lf.slice(heading.index)
  const overall = /^[ \t]*Overall:[ \t]*(\d+(?:\.\d+)?)[ \t]*\/[ \t]*10\b/m.exec(block)
  const verdict = /^[ \t]*Verdict:[ \t]*(pass|fail)\b/im.exec(block)
  return overall && verdict ? { overall: Number(overall[1]), verdict: verdict[1].toLowerCase(), items: itemsOf(block) } : null
}

const MODE_OF_COND = { lean: 'lean', team: 'balanced', max: 'max' }
// A run setup's mode: team runs Balanced; solo (or anything else) has none.
export const modeOfCond = cond => (Object.hasOwn(MODE_OF_COND, cond) ? MODE_OF_COND[cond] : null)

// Whether a review reaches the mode's own mark (GATES): overall at least passOverall and, when the mode sets
// minItem, every scored item at least minItem. No readable grade never does.
export function meetsMark(grade, mode) {
  if (!Object.hasOwn(GATES, mode)) throw new Error(`meetsMark: unknown mode ${String(mode)}`)
  if (!grade) return false
  const { passOverall, minItem } = GATES[mode]
  return grade.overall >= passOverall && (minItem === null || Object.values(grade.items).every(n => n >= minItem))
}

const textOf = content => {
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : ''
}
const lastAssistantText = messages => textOf(messages.findLast(m => m?.type === 'assistant')?.message?.content)
const handbackOf = m => (Array.isArray(m?.message?.content) ? m.message.content.find(p => p?.type === 'tool_use' && p.name === 'SubagentHandback') : undefined)
// A reviewer's answer: a background agent hands it back as the message of a SubagentHandback call; otherwise it is
// the text of its last assistant message.
const reviewerAnswer = messages => {
  const handback = handbackOf(messages.findLast(m => m?.type === 'assistant' && handbackOf(m)))
  return handback ? String(handback.input?.message ?? '') : lastAssistantText(messages)
}
const startTime = role => { const t = Date.parse(role.start ?? ''); return Number.isNaN(t) ? Infinity : t }

// { <caller>: [grade | null] } in start order; caller is the agent that hired the reviewer, 'main' at depth 1.
export function gateSequences(roles) {
  const reviews = roles.filter(r => r.role === REVIEWER).toSorted((a, b) => (startTime(a) - startTime(b)) || 0)
  return reviews.reduce((acc, r) => {
    const caller = r.parentId ?? 'main'
    return { ...acc, [caller]: [...(acc[caller] ?? []), parseGrade(reviewerAnswer(r.messages))] }
  }, {})
}

// fixRounds: fails that were followed by another call from the same caller.
export function summarize(sequences) {
  const lists = Object.values(sequences)
  const all = lists.flat()
  return {
    calls: all.length,
    graded: all.filter(entry => entry !== null).length,
    passes: all.filter(isPass).length,
    fails: all.filter(isFail).length,
    ungraded: all.filter(entry => entry === null).length,
    callers: lists.length,
    firstTryPasses: lists.filter(list => isPass(list[0])).length,
    fixRounds: lists.reduce((n, list) => n + list.slice(0, -1).filter(isFail).length, 0),
  }
}

// Names on `not ok N - <name>` lines (nested subtests too), with TAP's \# and \\ escapes undone.
export function failingTests(tap) {
  return [...String(tap ?? '').matchAll(/^[ \t]*not ok \d+ - (.*)$/gm)].map(m => m[1].trim().replace(/\\([\\#])/g, '$1'))
}

// A run with no gate call has no last pass, so it has no gate misses.
export function gateMisses(sequences, tap) {
  const lasts = Object.values(sequences).map(list => list.at(-1))
  return lasts.length > 0 && lasts.every(isPass) ? failingTests(tap) : []
}

// One run's row. roles null (no transcript found: no run.json, or no session id or session file) → noData. tap null (no hidden.tap) → gateMisses null.
// firstTryMeetsMark counts callers whose first review met the mode's mark; finalMeetsMark: { <caller>: boolean }.
export function gateRow({ id, mode, roles, tap, reports, codeQuality }) {
  const statuses = reports.map(text => parseReport(text).status)
  const count = status => statuses.filter(s => s === status).length
  // ungradedReports: REPORTs that handed back Status: ungraded; summarize's `ungraded` counts reviewer calls with no GRADE.
  const base = { id, mode, partial: count('partial'), blocked: count('blocked'), ungradedReports: count('ungraded'), judgeCodeQuality: codeQuality }
  if (!roles) return { ...base, noData: true }
  const sequences = gateSequences(roles)
  const perCaller = pick => Object.fromEntries(Object.entries(sequences).map(([caller, list]) => [caller, pick(list)]))
  return {
    ...base, noData: false, ...summarize(sequences), sequences,
    finalGrades: perCaller(list => list.at(-1)),
    firstTryMeetsMark: Object.values(sequences).filter(list => meetsMark(list[0], mode)).length,
    finalMeetsMark: perCaller(list => meetsMark(list.at(-1), mode)),
    gateMisses: tap === null ? null : gateMisses(sequences, tap),
  }
}

// { <run id>: mean codeQuality over its judges }, de-anonymized like judgeScores in aggregate.mjs (pair '<task>-r<rep>').
export function judgeCodeQuality(judgeRows, key) {
  const scores = {}
  for (const row of judgeRows) {
    const map = key[row.pair]
    if (!map) continue
    const [task, repTag] = row.pair.split('-')
    for (const [label, cond] of Object.entries(map)) {
      const value = row[label]?.codeQuality
      if (Number.isFinite(value)) (scores[`${task}-${cond}-${repTag}`] ??= []).push(value)
    }
  }
  return Object.fromEntries(Object.entries(scores).map(([id, xs]) => [id, xs.reduce((a, b) => a + b, 0) / xs.length]))
}

const readText = path => {
  try { return readFileSync(path, 'utf8') } catch (err) { if (err.code === 'ENOENT') return null; throw err }
}
const readJson = path => {
  const text = readText(path)
  if (text === null) return null
  try { return JSON.parse(text) } catch (err) { throw new Error(`${path}: not valid JSON (${err.message})`) }
}

// Section REPORTs saved under <run dir>/.team/reports/<day>/*.md; supervisor summaries are not REPORTs.
function readReports(dir) {
  const base = join(dir, '.team', 'reports')
  if (!existsSync(base)) return []
  return readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory()).flatMap(day =>
    readdirSync(join(base, day.name)).filter(name => name.endsWith('.md') && !name.includes('supervisor-summary')).map(name => readFileSync(join(base, day.name, name), 'utf8')))
}

// Roles come from results/<id>/evidence when the run has one, else (held-out runs) from Claude Code's project folder.
function readRun(folder, home) {
  const run = readJson(join(folder, 'run.json'))
  if (run === null) return { roles: null, tap: null, reports: [] }
  if (typeof run?.dir !== 'string') throw new Error(`${join(folder, 'run.json')}: no run dir`)
  const roles = collectRolesFrom(transcriptDir(folder, run.dir, home), runSession(folder))
  return { roles, tap: readText(join(folder, 'hidden.tap')), reports: readReports(run.dir) }
}

// Joined only once aggregate has written report-data-<round>.json; the scores come from judge-<round>.json through blind-key-<round>.json.
function codeQualityByRun(results, round) {
  if (!existsSync(join(results, `report-data-${round}.json`))) return {}
  const judge = readJson(join(results, `judge-${round}.json`))
  if (judge === null) return {}
  const keyPath = join(results, `blind-key-${round}.json`)
  const key = readJson(keyPath)
  if (key === null) throw new Error(`${keyPath}: missing, so judge-${round}.json cannot be matched to runs`)
  return judgeCodeQuality(judge, key)
}

// Every team (Balanced), lean and max run of the round; solo runs have no gate.
export function gateStats({ results = RESULTS, round, home = homedir() }) {
  const runId = new RegExp(`-(team|lean|max)-${round}-r\\d+$`)
  const ids = readdirSync(results, { withFileTypes: true }).filter(d => d.isDirectory() && runId.test(d.name)).map(d => d.name).sort()
  const quality = codeQualityByRun(results, round)
  return ids.map(id => gateRow({ id, mode: modeOfCond(runId.exec(id)[1]), ...readRun(join(results, id), home), codeQuality: quality[id] ?? null }))
}

const HEADER = ['id', 'mode', 'calls', 'first-try passes/callers', 'first-try at mark/callers', 'fix rounds', 'final grades', 'finals at mark/callers', 'partial/blocked/ungraded', 'gate misses', 'judge code quality']
const cell = value => String(value).replaceAll('|', '\\|')

function cells(row) {
  const judge = row.judgeCodeQuality === null ? '–' : String(Math.round(row.judgeCodeQuality * 100) / 100)
  const reports = `${row.partial}/${row.blocked}/${row.ungradedReports}`
  const mode = row.mode ?? '–'
  if (row.noData) return [row.id, mode, 'no data', '–', '–', '–', '–', '–', reports, '–', judge]
  const finals = Object.values(row.finalGrades).map(g => (g ? `${g.overall} ${g.verdict}` : 'no grade')).join(', ') || '–'
  const finalsAtMark = Object.values(row.finalMeetsMark).filter(Boolean).length
  const misses = row.gateMisses === null ? '–' : row.gateMisses.join('; ') || 'none'
  return [row.id, mode, row.calls, `${row.firstTryPasses}/${row.callers}`, `${row.firstTryMeetsMark}/${row.callers}`, row.fixRounds, finals, `${finalsAtMark}/${row.callers}`, reports, misses, judge]
}

export function formatTable(rows) {
  const line = values => `| ${values.map(cell).join(' | ')} |`
  return [line(HEADER), `|${HEADER.map(() => '---').join('|')}|`, ...rows.map(row => line(cells(row)))].join('\n')
}

function main() {
  const round = process.argv.slice(2).find(a => a.startsWith('--round='))?.slice(8) ?? ''
  if (!/^[A-Za-z0-9_-]+$/.test(round)) {
    console.error('usage: node bench/gate-stats.mjs --round=<tag>   (letters, digits, _ and - only)')
    process.exitCode = 1
    return
  }
  try {
    const rows = gateStats({ round })
    writeFileSync(join(RESULTS, `gate-stats-${round}.json`), JSON.stringify(rows, null, 2) + '\n')
    console.log(formatTable(rows))
  } catch (err) {
    console.error(`gate-stats: ${err.message}`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) main()
