// Round nx's results doc and data READMEs: their numbers come from the published data in bench/data/nx/.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { linesOf, tablesOf } from '../bench/data/nx/recompute.mjs'
import { qualities } from '../bench/bars-common.mjs'

const DOC = 'docs/benchmark-nx-2026-11.md'
const NX = 'bench/data/nx'
const path = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url))
const read = rel => readFileSync(path(rel), 'utf8').replaceAll('\r\n', '\n')
const json = rel => JSON.parse(read(rel))
const signed = x => `${x >= 0 ? '+' : ''}${x.toFixed(2)}`
const DIMS = [['correctness', 'correctness'], ['codeQuality', 'code quality'], ['tests', 'tests'], ['robustnessSecurity', 'robustness/security'], ['docsUsability', 'docs/usability']]

test('the results doc prints the recompute output verbatim', () => {
  const doc = read(DOC)
  assert.ok(doc.includes(linesOf(tablesOf(path(NX))).join('\n')), 'recompute output')
})

test('the results doc gives every bar reading, the keep decision and the reported h9 and h10 checks', () => {
  const doc = read(DOC)
  const bars = json(`${NX}/bars-nx.json`)
  for (const [id, bar] of Object.entries(bars.bars)) {
    assert.ok(doc.includes(`| ${id} | ${bar.status} |`), `${id} status row`)
    assert.ok(doc.includes(bar.reading), `${id} reading`)
  }
  assert.ok(doc.includes(bars.keep.decision), 'keep decision')
  for (const r of bars.reported) assert.ok(doc.includes(`${r.task}: cost ${r.costRatio.toFixed(2)}× base, quality ${signed(r.gap)}`), `${r.task} reported`)
})

test('the results doc gives each h8 group and the per-dimension gaps as the judge data gives them', () => {
  const doc = read(DOC)
  const key = json(`${NX}/blind-key-nxcx.json`)
  const judge = json(`${NX}/judge-nxcx.json`)
  const q = qualities(judge, key)
  for (const group of Object.keys(q).filter(g => g.startsWith('h8-'))) {
    const [solo, base, team] = ['solo-nx', 'base-nx', 'team-nx'].map(c => q[group][c].quality)
    const row = `| ${group.replace('-', ' ')} | ${solo.toFixed(2)} | ${base.toFixed(2)} | ${team.toFixed(2)} | ${signed(team - base)} |`
    assert.ok(doc.includes(row), `group row ${row}`)
  }
  const mean = (cond, dim) => {
    const xs = judge.filter(r => r.pair.startsWith('h8-')).flatMap(r => ['X', 'Y', 'Z'].filter(l => key[r.pair][l] === cond).map(l => r[l][dim]))
    return xs.reduce((a, b) => a + b, 0) / xs.length
  }
  for (const [dim, name] of DIMS) {
    const [solo, base, team] = ['solo-nx', 'base-nx', 'team-nx'].map(c => mean(c, dim))
    const row = `| ${name} | ${solo.toFixed(2)} | ${base.toFixed(2)} | ${team.toFixed(2)} | ${signed(team - base)} |`
    assert.ok(doc.includes(row), `dimension row ${row}`)
  }
})

test('the results doc gives the plugin-against-solo gaps as reported, from the recompute tables', () => {
  const doc = read(DOC)
  const t = tablesOf(path(NX))
  for (const task of ['h8', 'h9', 'h10']) {
    const q = t.quality[task]
    const c = t.cost[task]
    const row = `| ${task} | ${q.groups} | ${signed(q.base - q.solo)} | ${c.baseSolo.toFixed(2)}× | ${signed(q.teamSolo)} | ${c.teamSolo.toFixed(2)}× |`
    assert.ok(doc.includes(row), `plugin vs solo row ${row}`)
  }
})

test('the results doc states the revert, the disclosures and the limits, and makes no claim the round does not support', () => {
  const doc = read(DOC)
  for (const needle of [
    '7dd5bf3', '9e76662', 'L1 missed its quality bar', 'written by Claude agents', '0.92×', '0.93×',
    'No round measured', 'git diff --stat v0.6.0-rc.1 v0.6.0 -- agents brief hooks skills scripts',
    'one judge', 'EPERM', '$66.21', '$55', 'not faithful', 'false positive', 'process listing', 'confounded',
    '[-1.67, +0.91]', '5 groups', 'reported',
  ]) assert.ok(doc.includes(needle), `missing ${needle}`)
  assert.ok(!/lowers? quality|\bproves?\b|better code/i.test(doc), 'unsupported claim')
  assert.ok(!/Users[\\/]|[\w.+-]+@[\w-]+\.\w|claude-team-cloud|\.superpowers/.test(doc), 'private data')
})

test('the launch copy dates the freeze to the first run of the round: the paid pilot ran before it', () => {
  const copy = read('docs/launch-copy.md')
  assert.ok(!/first paid run|before the runs/.test(copy), 'freeze dated by paid runs')
  assert.ok(copy.includes('`nx-freeze` before the first run of the round'), 'freeze wording')
})

test('the data READMEs describe the nx folder as it now is', () => {
  const data = read('bench/data/README.md')
  assert.ok(!data.includes('For now it holds only'), 'stale nx sentence')
  const line = data.split('\n').find(l => l.includes('[`nx/`](nx/)')) ?? ''
  for (const needle of ['[`nx/README.md`](nx/README.md)', '../../docs/benchmark-nx-2026-11.md', 'node bench/data/nx/recompute.mjs']) assert.ok(line.includes(needle), `nx line ${needle}`)
  const nx = read(`${NX}/README.md`)
  for (const file of readdirSync(path(NX)).filter(f => f !== 'README.md')) assert.ok(nx.includes(`| \`${file}\` |`), `nx README row ${file}`)
  assert.ok(nx.includes('node bench/data/nx/recompute.mjs'), 'recompute command')
})
