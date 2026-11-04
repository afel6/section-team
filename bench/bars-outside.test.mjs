import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { confirm, counting, groupGaps, labelFor, outsideFor, outsideJudges, rankWins, sizeEffect, sizeEffectHeldOut } from './bars-outside.mjs'
import { readBars, shown } from './bars-common.mjs'
import { signTestP } from './stats.mjs'

const CONFIG = readBars()
const BALANCED = CONFIG.comparisons.find(c => c.name === 'balanced')
const GROUPS = ['h4-r1', 'h4-r2', 'h4-r3', 'h5-r1', 'h5-r2', 'h5-r3', 'h6-r1', 'h6-r2', 'h6-r3']
const HELDOUT = fileURLToPath(new URL('./data/heldout/', import.meta.url))
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} is not ${expected}`)
const gapsOf = (values, groups = GROUPS) => Object.fromEntries(values.map((v, i) => [groups[i], v]))
const readJson = path => JSON.parse(readFileSync(path, 'utf8'))
// A zero gap as floating point computes it: 8.9e-16, not 0.
const FLOAT_ZERO = (7.2 + 7.4) / 2 - (7.1 + 7.5) / 2

const DIMS = ['correctness', 'codeQuality', 'tests', 'robustnessSecurity', 'docsUsability']
const scores = q => ({ ...Object.fromEntries(DIMS.map(d => [d, q])), overall: q, notes: '' })
const KEY = Object.fromEntries(GROUPS.map(g => [g, { W: 'team-mo', X: 'solo-mo' }]))
// An outside judge's two cases per group: team-mo (W) scores 8 on every dimension, solo-mo (X) 8 minus the group's gap.
const outsideRows = gaps => GROUPS.flatMap((pair, i) => [1, 2].map(judge => ({
  pair, W: scores(8), X: scores(8 - gaps[i]), ranking: gaps[i] >= 0 ? ['W', 'X'] : ['X', 'W'], judge, case: `case-${String(2 * i + judge).padStart(2, '0')}`,
})))
const EXTERNAL_KEY = GROUPS.flatMap((pair, i) => [1, 2].map(judge => ({
  case: `case-${String(2 * i + judge).padStart(2, '0')}`, pair, judge, map: judge === 1 ? { A: 'W', B: 'X' } : { A: 'X', B: 'W' },
})))
const PASSED = { gap: 0.93, same: 8, pairs: 9, passed: true }
const codexImported = gaps => ({ 'outside-check-ho-hocx.json': PASSED, 'judge-mocx.json': outsideRows(gaps), 'blind-key-mocx.json': KEY, 'external-key-mo.json': EXTERNAL_KEY })
const ONES = GROUPS.map(() => 1)

function resultsWith(t, files) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-bars-outside-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data))
  return dir
}

// A met Balanced headline over the 9 groups, every group gap +0.5.
const MET = { status: 'met', n: 9, groups: GROUPS, groupGaps: gapsOf(GROUPS.map(() => 0.5)), gap: 0.5, includesZero: false }
const outsideOf = (results, result = MET) => outsideFor({ result, judges: outsideJudges({ config: CONFIG, results }), cmp: BALANCED, share: CONFIG.confirmShare, decimals: CONFIG.statDecimals })
const labelOf = (results, result = MET) => labelFor(result, outsideOf(results, result))

test('7 of 9 with same-sign gaps confirms; opposite gap signs does not; a zero disagrees', () => {
  const opus = gapsOf([0.5, 0.4, 0.3, 0.2, 0.1, 0.6, 0.2, -0.1, 0.3])
  const seven = gapsOf([0.3, 0.2, 0.1, 0.4, 0.2, 0.1, 0.1, 0.2, -0.3])
  assert.deepEqual(confirm({ opus, outside: seven, n: 9 }), { agree: 7, needed: 7, gapsSameSign: true, confirmed: true })
  // 8 groups agree, but one large opposite group gap turns the outside judge's gap negative.
  const opposite = gapsOf([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, -0.1, -2])
  assert.deepEqual(confirm({ opus, outside: opposite, n: 9 }), { agree: 8, needed: 7, gapsSameSign: false, confirmed: false })
  // A zero on the outside side, then on both sides, disagrees.
  const zero = { ...seven, 'h4-r1': 0 }
  assert.deepEqual(confirm({ opus, outside: zero, n: 9 }), { agree: 6, needed: 7, gapsSameSign: true, confirmed: false })
  assert.equal(confirm({ opus: { ...opus, 'h4-r1': 0 }, outside: zero, n: 9 }).agree, 6)
  // Gaps are rounded to 2 decimals first: a float-noise zero is a zero, in a group and overall.
  assert.ok(FLOAT_ZERO > 0)
  assert.equal(confirm({ opus, outside: { ...seven, 'h4-r1': FLOAT_ZERO }, n: 9 }).agree, 6)
  const flat = gapsOf([0.1, 0.2, -0.3, 0, 0, 0, 0, 0, 0])
  assert.ok(Object.values(flat).reduce((a, b) => a + b, 0) > 0, 'the unrounded overall gap is float noise above 0')
  assert.deepEqual(confirm({ opus: flat, outside: flat, n: 9 }), { agree: 3, needed: 7, gapsSameSign: false, confirmed: false })
})

test('with 8 groups the threshold is 6', () => {
  const groups = GROUPS.slice(0, 8)
  const opus = gapsOf(groups.map(() => 0.3), groups)
  const six = gapsOf([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, -0.1, -0.1], groups)
  assert.deepEqual(confirm({ opus, outside: six, n: 8, share: CONFIG.confirmShare }), { agree: 6, needed: 6, gapsSameSign: true, confirmed: true })
  assert.deepEqual(confirm({ opus, outside: { ...six, 'h4-r1': -0.1 }, n: 8 }), { agree: 5, needed: 6, gapsSameSign: true, confirmed: false })
  // With 7 groups the threshold is 6 (5.25 rounds up, not to the nearest).
  const seven = GROUPS.slice(0, 7)
  assert.equal(confirm({ opus: gapsOf(seven.map(() => 0.3), seven), outside: gapsOf([0.2, 0.2, 0.2, 0.2, 0.2, -0.1, -0.1], seven), n: 7 }).needed, 6)
})

test('label: met, within noise, not outside-confirmed (no outside judge passed its held-out check)', t => {
  const reason = 'not outside-confirmed (no outside judge passed its held-out check)'
  assert.equal(labelOf(resultsWith(t, {}), { ...MET, includesZero: true }), `met, within noise, ${reason}`)
  // A judge that failed its held-out check does not count, even with every mode-round case imported.
  const failed = resultsWith(t, { ...codexImported(ONES), 'outside-check-ho-hocx.json': { ...PASSED, passed: false } })
  assert.equal(labelOf(failed), `met, ${reason}`)
})

// Reason 2 names only the judges that passed their held-out check, never one that failed it.
test('label: with no passing judge usable, the reason lists only the judges that passed their held-out check', t => {
  const results = resultsWith(t, { 'outside-check-ho-hocx.json': PASSED, 'outside-check-ho-hoag2.json': { ...PASSED, passed: false } })
  assert.equal(labelOf(results), 'met, not outside-confirmed (no passing judge was usable in the mode round (Codex: not used))')
})

test('label: outside-confirmed when every counting judge confirms; otherwise each disagreeing judge with its count and gap', t => {
  assert.equal(labelOf(resultsWith(t, codexImported(ONES))), 'met, outside-confirmed')
  assert.equal(labelOf(resultsWith(t, codexImported(ONES)), { ...MET, includesZero: true }), 'met, within noise, outside-confirmed')
  const six = resultsWith(t, codexImported([1, 1, 1, 1, 1, 1, -1, -1, -1]))
  assert.equal(labelOf(six), 'met, not outside-confirmed (Codex disagrees (6 of 9 groups, gap +0.33))')
  const both = resultsWith(t, {
    ...codexImported(ONES), 'outside-check-ho-hoag2.json': PASSED, 'judge-moag.json': outsideRows(GROUPS.map(() => -1)), 'blind-key-moag.json': KEY,
  })
  assert.equal(labelOf(both), 'met, not outside-confirmed (Antigravity disagrees (0 of 9 groups, gap -1.00))')
  const twoDisagree = resultsWith(t, {
    ...codexImported([1, 1, 1, 1, 1, 1, -1, -1, -1]), 'outside-check-ho-hoag2.json': PASSED, 'judge-moag.json': outsideRows(GROUPS.map(() => -1)), 'blind-key-moag.json': KEY,
  })
  assert.equal(labelOf(twoDisagree), 'met, not outside-confirmed (Codex disagrees (6 of 9 groups, gap +0.33), Antigravity disagrees (0 of 9 groups, gap -1.00))')
  // A float-noise zero gap prints as +0.00 whichever side of 0 it lands.
  assert.deepEqual([shown(-1e-15), shown(1e-15), shown(-0.333)], ['+0.00', '+0.00', '-0.33'])
})

test('a missed bar shows outside gaps and no confirmation label', t => {
  const results = resultsWith(t, codexImported([1, 1, 1, 1, 1, 1, -1, -1, -1]))
  const missed = { ...MET, status: 'missed' }
  const outside = outsideOf(results, missed)
  assert.equal(labelFor(missed, outside), 'missed')
  close(outside.Codex.gap, 3 / 9)
  assert.deepEqual({ ...outside.Codex, gap: 'checked' }, {
    status: 'usable', passedHeldOut: true, counts: true, gap: 'checked', n: 9, agree: 6, needed: 7, gapsSameSign: true, confirmed: false,
  })
  assert.deepEqual(outside.Antigravity, { status: 'not used', passedHeldOut: false, counts: false })
  // Confirmation is computed for a Max comparison reported as not measurable too, and labels it no more than a miss.
  const ceiling = { ...MET, status: 'not measurable (scale ceiling)' }
  const atCeiling = outsideOf(results, ceiling)
  assert.equal(labelFor(ceiling, atCeiling), 'not measurable (scale ceiling)')
  assert.equal(atCeiling.Codex.agree, 6)
  assert.deepEqual(groupGaps(outsideRows([1, 1, 1, 1, 1, 1, -1, -1, -1]), KEY, 'team-mo', 'solo-mo'), gapsOf([1, 1, 1, 1, 1, 1, -1, -1, -1]))
})

test('a held-out pass with no mode-round import is "not used"; one with 17 usable is "not usable (17 of 18)" and does not count', t => {
  const results = resultsWith(t, {
    'outside-check-ho-hocx.json': PASSED, 'outside-check-ho-hoag2.json': PASSED, 'external-key-mo.json': EXTERNAL_KEY,
    'outside-usable-moag.json': { usable: 17, total: 18, problems: ['case-07: no verdict.json'] },
  })
  const judges = outsideJudges({ config: CONFIG, results })
  assert.deepEqual(judges.map(j => [j.name, j.passedHeldOut, j.status, j.usableCases, j.total, j.rows, j.key]), [
    ['Codex', true, 'not used', 0, null, null, null],
    ['Antigravity', true, 'not usable (17 of 18)', 17, 18, null, null],
  ])
  assert.deepEqual(counting(judges), [])
  assert.equal(labelOf(results), 'met, not outside-confirmed (no passing judge was usable in the mode round (Codex: not used, Antigravity: not usable (17 of 18)))')
  // Every case imported counts; with no held-out check file the same import is "not used".
  const imported = outsideJudges({ config: CONFIG, results: resultsWith(t, codexImported(ONES)) })
  assert.deepEqual(imported.map(j => [j.name, j.passedHeldOut, j.status, j.usableCases, j.total, j.rows?.length ?? null]), [
    ['Codex', true, 'usable', 18, 18, 18], ['Antigravity', false, 'not used', 0, null, null],
  ])
  assert.deepEqual(imported[0].check, PASSED)
  assert.deepEqual(counting(imported), ['Codex'])
  const { 'outside-check-ho-hocx.json': _check, ...unchecked } = codexImported(ONES)
  const noCheck = outsideJudges({ config: CONFIG, results: resultsWith(t, unchecked) })
  assert.deepEqual([noCheck[0].passedHeldOut, noCheck[0].status, noCheck[0].check], [false, 'not used', null])
})

test('a corrupt outside file stops with one line naming it', t => {
  const judgesFrom = files => () => outsideJudges({ config: CONFIG, results: resultsWith(t, files) })
  for (const bad of [{ passed: 'yes' }, { gap: '0.93' }, { same: null }, { pairs: undefined }]) {
    assert.throws(judgesFrom({ 'outside-check-ho-hocx.json': { ...PASSED, ...bad } }), /outside-check-ho-hocx\.json is not a held-out check record \(numbers gap, same, pairs and true or false passed\)$/)
  }
  // A judge-<as>.json or blind-key-<as>.json that does not hold every case stops instead of reading as a disagreement.
  const rows = outsideRows(ONES)
  for (const broken of [{ 'judge-mocx.json': rows.slice(1) }, { 'judge-mocx.json': [] }, { 'blind-key-mocx.json': {} }]) {
    assert.throws(judgesFrom({ ...codexImported(ONES), ...broken }),
      /judge-mocx\.json does not hold all 18 cases of external-key-mo\.json: move judge-mocx\.json and blind-key-mocx\.json aside, then run node bench\/external-judge\.mjs import --round=mo --out=C:\/Users\/Asus\/codex-judge-mo --as=mocx again$/)
  }
  assert.throws(judgesFrom({ 'outside-check-ho-hocx.json': '{"passed": tr' }), /outside-check-ho-hocx\.json is not valid JSON$/)
  const usable = usable => ({ 'outside-check-ho-hoag2.json': PASSED, 'external-key-mo.json': EXTERNAL_KEY, 'outside-usable-moag.json': { usable, total: 18 } })
  assert.throws(judgesFrom(usable('17')), /outside-usable-moag\.json has no whole "usable" count from 0 to 18$/)
  assert.throws(judgesFrom(usable(19)), /outside-usable-moag\.json has no whole "usable" count from 0 to 18$/)
  assert.throws(judgesFrom(usable(18)),
    /outside-usable-moag\.json counts every case usable, but .*judge-moag\.json is missing: move judge-moag\.json and blind-key-moag\.json aside, then run node bench\/external-judge\.mjs import --round=mo --out=C:\/Users\/Asus\/ag-judge-mo --as=moag again$/)
  const { 'external-key-mo.json': _key, ...noKey } = codexImported(ONES)
  assert.throws(judgesFrom(noKey), /missing .*external-key-mo\.json: run node bench\/external-judge\.mjs prepare --round=mo first$/)
})

test('rankWins: both above is for, split is split, one usable judgment is marked', () => {
  const key = Object.fromEntries(GROUPS.map(g => [g, { W: 'team-mo', X: 'solo-mo', Y: 'lean-mo', Z: 'max-mo' }]))
  const row = (pair, judge, ranking) => ({ pair, judge, ranking })
  const rows = [
    row('h4-r1', 1, ['W', 'Y', 'X', 'Z']), row('h4-r1', 2, ['Z', 'W', 'X', 'Y']), // both above: for
    row('h4-r2', 1, ['W', 'X', 'Y', 'Z']), row('h4-r2', 2, ['X', 'W', 'Y', 'Z']), // split
    row('h4-r3', 2, ['X', 'Y', 'Z', 'W']), // one judgment, below: against, marked
    row('h5-r1', 1, ['X', 'W', 'Y', 'Z']), row('h5-r1', 2, ['Y', 'X', 'Z', 'W']), // both below: against
    row('h5-r2', 1, ['Z', 'W', 'Y', 'X']), // one judgment, above: for, marked
    ...['h5-r3', 'h6-r1', 'h6-r2'].flatMap(pair => [row(pair, 1, ['W', 'X', 'Y', 'Z']), row(pair, 2, ['Z', 'Y', 'W', 'X'])]),
  ]
  // A group whose key lacks the comparator is not one of the comparison's groups.
  const partial = { ...key, 'h6-r3': { W: 'lean-mo', X: 'solo-mo' } }
  const r = rankWins([...rows, row('h6-r3', 1, ['X', 'W'])], partial, 'team-mo', 'solo-mo')
  assert.deepEqual(r, { for: 5, against: 2, split: 1, marked: ['h4-r3', 'h5-r2'], p: signTestP(5, 2), judgments: { for: 10, against: 4 } })
  assert.equal(r.p, 0.453125)
  assert.throws(() => rankWins([row('h4-r1', 2, ['W', 'Y', 'Z'])], key, 'team-mo', 'solo-mo'), /^Error: judge row h4-r1 judge 2: the ranking does not hold W and X$/)
})

test('sizeEffect counts equal test lines as disagreement', () => {
  const run = (group, cond, testLines) => {
    const [task, rep] = group.split('-r')
    return { id: `${task}-${cond}-r${rep}`, task, cond, rep: Number(rep), code: { testLines } }
  }
  const groups = ['h4-r1', 'h4-r2', 'h4-r3', 'h5-r1', 'h5-r2']
  const summary = [
    run('h4-r1', 'team-mo', 300), run('h4-r1', 'solo-mo', 200), // more test lines, gap +: agrees
    run('h4-r2', 'team-mo', 250), run('h4-r2', 'solo-mo', 250), // equal count, gap +: disagrees
    run('h4-r3', 'team-mo', 100), run('h4-r3', 'solo-mo', 180), // fewer, gap -: agrees
    run('h5-r1', 'team-mo', 400), run('h5-r1', 'solo-mo', 100), // more, a float-noise zero gap: disagrees
    run('h5-r2', 'team-mo', 90), run('h5-r2', 'solo-mo', 120), // fewer, gap +: disagrees
  ]
  const opus = gapsOf([0.4, 0.2, -0.3, FLOAT_ZERO, 0.1], groups)
  assert.deepEqual(sizeEffect(summary, groups, 'team-mo', 'solo-mo', opus), { agree: 2, n: 5 })
  const noLines = summary.map(r => (r.id === 'h4-solo-mo-r1' ? { ...r, code: {} } : r))
  assert.throws(() => sizeEffect(noLines, groups, 'team-mo', 'solo-mo', opus), /^Error: summary\.json row h4-solo-mo-r1 has no code\.testLines$/)
  assert.throws(() => sizeEffect(summary.slice(2), groups, 'team-mo', 'solo-mo', opus), /^Error: summary\.json has no team-mo run in h4-r1$/)
})

test('sizeEffectHeldOut gives 8 of 9', () => {
  const [summary, judgeRows, key] = ['summary.json', 'judge-ho.json', 'blind-key-ho.json'].map(file => readJson(join(HELDOUT, file)))
  assert.deepEqual(sizeEffectHeldOut({ summary, judgeRows, key }), { agree: 8, pairs: 9 })
  // Equal counts give no prediction: h1-r1 (team-ho won with more test lines) stops agreeing.
  const equal = summary.map(r => (r.task === 'h1' && r.rep === 1 ? { ...r, code: { ...r.code, testLines: 150 } } : r))
  assert.deepEqual(sizeEffectHeldOut({ summary: equal, judgeRows, key }), { agree: 7, pairs: 9 })
})
