// Round nx in the README: every number it prints comes from bench/data/nx (the recompute script, or bars-nx.json for the
// bars), each setup is named, and the labels match the round. Run: node --test tests/docs-nx.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { linesOf, tablesOf } from '../bench/data/nx/recompute.mjs'

const NX = new URL('../bench/data/nx/', import.meta.url)
const json = file => JSON.parse(readFileSync(new URL(file, NX), 'utf8'))
const t = tablesOf(fileURLToPath(NX))
const bars = json('bars-nx.json')
const summary = json('summary.json')
// The README writes a minus as U+2212; recompute and the bars print a hyphen.
const norm = text => text.replaceAll('−', '-')
const readme = norm(readFileSync(new URL('../README.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n'))
const section = heading => readme.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? ''
const nxBlock = section('Results').split('**Round nx')[1]?.split('**Earlier rounds**')[0] ?? ''

const r2 = n => Math.round(n * 100) / 100
const times = x => `${x.toFixed(2)}×`
const signed = x => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`
const one = x => x.toFixed(1)
const { cost: c, wall: w, quality: q, nearMiss: nm } = t
const Q1 = bars.bars.Q1
const reported = task => bars.reported.find(row => row.task === task)
const runsPerSetup = task => summary.filter(run => run.cond === 'team-nx' && run.task === task).length
// The Balanced label rounds the team's cost over solo, the three tiers weighted equally; with h8 from base (the routing
// 0.6.0 keeps after L1's revert) it is an estimate, computed as recompute computes the overall row.
const BALANCED = Math.round(c.equal.teamSolo)
const ESTIMATE = r2((c.h8.base + c.h9.team + c.h10.team) / c.equal.solo)
const baseSolo = task => r2(q[task].base - q[task].solo)
const MAX_LABEL = 'about 10×, measured on 0.3.0+ rounds; 0.6.0 changes max only in trust text and the model alias, not re-measured'

const assertIncludes = (text, needles, label) => {
  for (const needle of needles) assert.ok(text.includes(needle), `${label} missing ${needle}`)
}

test('the bars file agrees with the recompute output on the figures the README takes from it', () => {
  assert.equal(bars.bars.C1.status, 'met')
  assert.equal(bars.bars.C1.ratio, c.h8.teamBase)
  assert.equal(Q1.status, 'missed')
  assert.equal(Q1.gap, q.h8.teamBase)
  assert.equal(Q1.n, q.h8.groups)
  assert.match(bars.keep.decision, /^revert L1/)
  assert.equal(reported('h10').costRatio, c.h10.teamBase)
  assert.equal(q.h9.groups, q.h10.groups)
  for (const task of ['h8', 'h9', 'h10']) {
    assert.equal(runsPerSetup(task), q[task].groups, `${task}: one run per setup in each group`)
    for (const setup of ['solo', 'base', 'team']) assert.equal(t.hidden[task][setup], t.hidden[task].tests, `${task} ${setup} hidden`)
  }
})

test('the Quickstart gives round nx cost, wall time and Codex gaps, naming the build behind each', () => {
  const quick = section('Quickstart')
  assertIncludes(quick, [
    `about ${BALANCED}× your normal Claude Code usage in Balanced`,
    `In round nx (${runsPerSetup('h8')}, ${runsPerSetup('h9')} and ${runsPerSetup('h10')} runs per setup) Balanced cost ${times(c.h8.baseSolo)} plain Claude Code on a small fix (v0.5.1, nearest to 0.6.0 there), ${times(c.h9.teamSolo)} on a single-area task and ${times(c.h10.teamSolo)} on a multi-area one (v0.6.0-rc.1), at ${times(w.h8.baseSolo)}, ${times(w.h9.teamSolo)} and ${times(w.h10.teamSolo)} the wall time (reported, no bar;`,
    `In round nx one judge, Codex, put Balanced ${signed(baseSolo('h8'))} over plain Claude Code on the small fix (v0.5.1, ${q.h8.groups} groups) and ${signed(q.h9.teamSolo)} on the single-area task (v0.6.0-rc.1, ${q.h9.groups} groups), reported with no pre-set bar.`,
  ], 'Quickstart')
  assert.ok(quick.toLowerCase().includes(MAX_LABEL), 'Quickstart Max label')
  // h10's 2 groups each hold a run the mode check flagged, so its quality gaps are not quoted (docs/launch-copy.md).
  assert.ok(!quick.includes(signed(q.h10.teamSolo)), 'no h10 quality gap in the Quickstart')
})

test('the Results round nx paragraph names the setups, the judge, the bars, the revert and the unmeasured release', () => {
  assertIncludes(nxBlock, [
    '**solo** is plain Claude Code (plugin off)', '**base** is section-team v0.5.1', '**team** is v0.6.0-rc.1, which added a direct tier (L1) for small fixes',
    `Tasks h8 (a small fix, ${q.h8.groups} groups), h9 (single-area, ${q.h9.groups}) and h10 (multi-area, ${q.h10.groups}) were written by Claude agents that week`,
    'one judge, Codex, scored every group blind (five-dimension means)',
    `L1 met its cost bar (${times(c.h8.teamBase)} base on h8) and missed its quality bar (team - base ${signed(Q1.gap)}, 95% CI [${signed(r2(Q1.lo))}, ${signed(r2(Q1.hi))}] over ${Q1.n} groups; bar at least ${Q1.reading.match(/at least (-?\d+\.\d+)/)[1]})`,
    'pre-registered in the public tag `nx-freeze`', 'no round measured that exact build',
    `there team cost ${times(reported('h9').costRatio)} and ${times(c.h10.teamBase)} of base (${times(c.h9.teamBase)} on h9 from cent-rounded means) and scored ${signed(q.h9.teamBase)} against it on h9; h10's quality is not quoted`,
    'Gaps against solo are reported, with no pre-set bar.', 'Every setup passed every hidden test',
    `On h8 the runs' own suites caught ${one(nm.h8.team)} (team), ${one(nm.h8.base)} (base) and ${one(nm.h8.solo)} (solo) of ${nm.h8.total} seeded near-miss bugs on average; h10's counts are confounded`,
    '[docs/benchmark-nx-2026-11.md](docs/benchmark-nx-2026-11.md)', '[`bench/data/nx/`](bench/data/nx/)',
  ], 'Results round nx')
  assert.ok(!nxBlock.includes(signed(q.h10.teamBase)), 'no h10 quality gap in Results')
  assert.ok(!/lowers quality|\bproves\b/i.test(readme), 'no "lowers quality" or "proves"')
})

test('the Modes table labels Balanced from round nx and Max with the not re-measured text', () => {
  const modes = section('Modes')
  assertIncludes(modes, [
    `| Balanced · ~${BALANCED}× usage | Round nx (reported, ${runsPerSetup('h8') + runsPerSetup('h9') + runsPerSetup('h10')} runs per setup): v0.6.0-rc.1 at ${times(c.equal.teamSolo)} plain Claude Code, three tiers weighted equally; estimated ${times(ESTIMATE)} with v0.5.1's h8 in place of the reverted L1. |`,
    '| Max · ~10× usage |',
  ], 'Modes')
  assert.ok(modes.toLowerCase().includes(MAX_LABEL), 'Modes Max label')
  assert.ok(!/~5×|about 5×/.test(readme), 'no old Balanced label')
})

// Typed numbers: money, multiples, signed or plain decimals, percentages and thousands. Versions (0.6.0, v0.5.1) are skipped.
const PATTERNS = { usd: /\$\d+\.\d{2}/g, x: /(?<![\w.])\d+(?:\.\d+)?×/g, pct: /(?<![\w.])\d+(?:\.\d+)?%/g, k: /(?<![\w.,])\d{1,3}(?:,\d{3})+(?!\d)/g, n: /(?<![\w.$])[+-]?\d+\.\d+(?![\d.×%])/g }
const numbersIn = text => Object.entries(PATTERNS).flatMap(([type, re]) => (text.match(re) ?? []).map(token => ({ type, token, key: `${type}:${Number(token.replace(/[$×%,]/g, ''))}` })))
const sentencesOf = text => text.split(/(?<=[.!?])\s+|\n/)

test('every number the README prints for round nx is in the recompute output, the bars file or derived from them', () => {
  const allowed = new Set(numbersIn(norm(linesOf(t).join('\n'))).map(n => n.key))
  for (const task of ['h8', 'h9', 'h10']) {
    allowed.add(`n:${baseSolo(task)}`)
    for (const peak of Object.values(t.mainPeak[task])) allowed.add(`k:${peak}`)
  }
  // pct:95 is the level of the bars' interval (bench/bars-common.mjs), printed as "95% CI".
  for (const key of ['pct:95', `x:${BALANCED}`, `x:${ESTIMATE}`, `x:${reported('h9').costRatio}`, `n:${r2(Q1.lo)}`, `n:${r2(Q1.hi)}`, `n:${Number(Q1.reading.match(/at least (-?\d+\.\d+)/)[1])}`]) allowed.add(key)
  const nxText = [nxBlock, ...sentencesOf(readme).filter(s => /\bnx\b|\bh(?:8|9|10)\b|\bL1\b/.test(s))].join('\n')
  const found = numbersIn(nxText)
  assert.ok(found.length >= 20, `round nx numbers found: ${found.length}`)
  assert.deepEqual(found.filter(n => !allowed.has(n.key)).map(n => n.token), [])
})
