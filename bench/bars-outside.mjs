// Outside confirmation, published labels and secondary measures for the mode round's bars (spec "Bars and rules":
// Outside confirmation, Secondary measures; "Showing the size effect"). The CLI in bars.mjs adds them to each
// comparison's headline; the faithful-only sensitivity check gets none of them.
// bars.mjs imports this module; both take what they share from bars-common.mjs, so there is no import cycle.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { groupOf, mean, qualities, readInput, shown } from './bars-common.mjs'
import { pairWinners } from './external-judge.mjs'
import { round, signTestP } from './stats.mjs'

// A gap's sign after rounding to `decimals`: a float-noise zero is 0, and a missing gap is NaN, which matches nothing.
const signOf = (gap, decimals) => Math.sign(round(gap, decimals))

const casesOf = (results, roundTag) => readInput(
  join(results, `external-key-${roundTag}.json`), `run node bench/external-judge.mjs prepare --round=${roundTag} first`, 'array',
)

// One judge's mode-round import: all its verdicts (judge-<as>.json), a count of usable cases, or nothing.
function importOf(results, roundTag, as) {
  const judgePath = join(results, `judge-${as}.json`)
  // importRound refuses while judge-<as>.json or blind-key-<as>.json exists, so the hint moves them aside first.
  const again = `move judge-${as}.json and blind-key-${as}.json aside, then run node bench/external-judge.mjs import --round=${roundTag} --as=${as} again`
  if (existsSync(judgePath)) {
    const cases = casesOf(results, roundTag)
    const rows = readInput(judgePath, again, 'array')
    const key = readInput(join(results, `blind-key-${as}.json`), again, 'object')
    // A truncated import must stop here, not read as a disagreement later.
    if (!cases.every(c => rows.some(row => row?.case === c.case && row.pair === c.pair && key[row.pair]))) {
      throw new Error(`${judgePath} does not hold all ${cases.length} cases of external-key-${roundTag}.json: ${again}`)
    }
    return { status: 'usable', usableCases: cases.length, total: cases.length, rows, key }
  }
  const usablePath = join(results, `outside-usable-${as}.json`)
  if (!existsSync(usablePath)) return null
  const total = casesOf(results, roundTag).length
  const { usable } = readInput(usablePath, again, 'object')
  if (!Number.isInteger(usable) || usable < 0 || usable > total) throw new Error(`${usablePath} has no whole "usable" count from 0 to ${total}`)
  if (usable === total) throw new Error(`${usablePath} counts every case usable, but ${judgePath} is missing: ${again}`)
  return { status: `not usable (${usable} of ${total})`, usableCases: usable, total, rows: null, key: null }
}

// Each outside judge of config.outside: its held-out check (results/outside-check-ho-<heldOut>.json, `check`) and its
// mode-round import. A judge with no held-out check, or with nothing imported, is 'not used'.
export function outsideJudges({ config, results }) {
  const notUsed = { status: 'not used', usableCases: 0, total: null, rows: null, key: null }
  return config.outside.map(({ name, heldOut, round: as }) => {
    const checkPath = join(results, `outside-check-ho-${heldOut}.json`)
    if (!existsSync(checkPath)) return { name, passedHeldOut: false, check: null, ...notUsed }
    const check = readInput(checkPath, `run node bench/external-judge.mjs check --as=${heldOut} first`, 'object')
    if (typeof check.passed !== 'boolean' || ![check.gap, check.same, check.pairs].every(Number.isFinite)) {
      throw new Error(`${checkPath} is not a held-out check record (numbers gap, same, pairs and true or false passed)`)
    }
    return { name, passedHeldOut: check.passed, check, ...(importOf(results, config.round, as) ?? notUsed) }
  })
}

// The judges that count: passed the held-out check and have every mode-round case usable.
export const counting = judges => judges.filter(j => j.passedHeldOut && j.usableCases === j.total).map(j => j.name)

// { [group]: the mode's quality minus the comparator's }, over that source's rows (each solution's judges averaged).
export function groupGaps(rows, key, mode, vs) {
  const quals = qualities(rows, key)
  return Object.fromEntries(Object.keys(quals).sort().filter(g => quals[g][mode] && quals[g][vs])
    .map(g => [g, quals[g][mode].quality - quals[g][vs].quality]))
}

// An outside judge confirms when both overall gaps (over the Opus groups) are non-zero with one sign and the group
// directions agree in at least ⌈share × n⌉ groups; a zero on either side disagrees. Gaps are rounded first.
export function confirm({ opus, outside, n, share = 0.75, decimals = 2 }) {
  const groups = Object.keys(opus)
  const sign = gaps => signOf(mean(groups.map(g => gaps[g])), decimals)
  const agree = groups.filter(g => signOf(opus[g], decimals) !== 0 && signOf(opus[g], decimals) === signOf(outside[g], decimals)).length
  const needed = Math.ceil(share * n)
  const gapsSameSign = sign(opus) !== 0 && sign(opus) === sign(outside)
  return { agree, needed, gapsSameSign, confirmed: gapsSameSign && agree >= needed }
}

// { [judge]: { status, passedHeldOut, counts } } for one headline result; a counting judge also gets its gap over the
// Opus groups and its confirmation, whatever the bar's status (a missed bar lists these gaps).
export function outsideFor({ result, judges, cmp, share = 0.75, decimals = 2 }) {
  const names = counting(judges)
  return Object.fromEntries(judges.map(j => {
    const base = { status: j.status, passedHeldOut: j.passedHeldOut, counts: names.includes(j.name) }
    if (!base.counts || !result.n) return [j.name, base]
    const outside = groupGaps(j.rows, j.key, cmp.mode, cmp.vs)
    const gap = mean(result.groups.map(g => outside[g]))
    return [j.name, { ...base, gap, n: result.n, ...confirm({ opus: result.groupGaps, outside, n: result.n, share, decimals }) }]
  }))
}

function notConfirmedReason(judges) {
  const passed = judges.filter(([, j]) => j.passedHeldOut)
  if (passed.length === 0) return 'no outside judge passed its held-out check'
  const counted = judges.filter(([, j]) => j.counts)
  if (counted.length === 0) return `no passing judge was usable in the mode round (${passed.map(([name, j]) => `${name}: ${j.status}`).join(', ')})`
  return counted.filter(([, j]) => !j.confirmed).map(([name, j]) => `${name} disagrees (${j.agree} of ${j.n} groups, gap ${shown(j.gap)})`).join(', ')
}

// The published label: a bar that is not met keeps its status; a met bar reads "met", ", within noise" when its range
// includes 0, then ", outside-confirmed" or ", not outside-confirmed (<reason>)".
export function labelFor(result, outsideByJudge) {
  if (result.status !== 'met') return result.status
  const noise = result.includesZero ? ', within noise' : ''
  const judges = Object.entries(outsideByJudge)
  const counted = judges.filter(([, j]) => j.counts)
  if (counted.length > 0 && counted.every(([, j]) => j.confirmed)) return `met${noise}, outside-confirmed`
  return `met${noise}, not outside-confirmed (${notConfirmedReason(judges)})`
}

// { [group]: [true when that Opus judgment ranks the mode above the comparator, ...] } over groups holding both.
function rankings(rows, key, mode, vs) {
  const byGroup = {}
  for (const row of rows) {
    const labels = key[row.pair] ?? {}
    const [m, v] = [mode, vs].map(cond => Object.keys(labels).find(label => labels[label] === cond))
    if (!m || !v) continue
    const ranking = Array.isArray(row.ranking) ? row.ranking : []
    const [above, below] = [ranking.indexOf(m), ranking.indexOf(v)]
    if (above < 0 || below < 0) throw new Error(`judge row ${row.pair} judge ${row.judge}: the ranking does not hold ${m} and ${v}`)
    byGroup[row.pair] = [...(byGroup[row.pair] ?? []), above < below]
  }
  return byGroup
}

// Groups for the mode (every usable judgment ranks it above), against it (every one below) or split; a group with one
// judgment counts by it and is marked. p: exact two-sided sign test over the non-split groups; judgments: per judgment.
export function rankWins(rows, key, mode, vs) {
  const byGroup = rankings(rows, key, mode, vs)
  const groups = Object.keys(byGroup).sort()
  const kindOf = above => (above.every(Boolean) ? 'for' : above.some(Boolean) ? 'split' : 'against')
  const count = kind => groups.filter(g => kindOf(byGroup[g]) === kind).length
  const all = groups.flatMap(g => byGroup[g])
  return {
    for: count('for'), against: count('against'), split: count('split'), marked: groups.filter(g => byGroup[g].length === 1),
    p: signTestP(count('for'), count('against')), judgments: { for: all.filter(Boolean).length, against: all.filter(a => !a).length },
  }
}

function testLinesOf(summary, group, cond) {
  const run = summary.find(r => groupOf(r) === group && r.cond === cond)
  if (!run) throw new Error(`summary.json has no ${cond} run in ${group}`)
  if (!Number.isFinite(run.code?.testLines)) throw new Error(`summary.json row ${run.id} has no code.testLines`)
  return run.code.testLines
}

// The setup whose run in the group has the most test lines (seed-identical files already left out by score.mjs), or
// null when that count is shared: equal counts predict nothing.
function moreTestLines(summary, group, conds) {
  const lines = conds.map(cond => testLinesOf(summary, group, cond))
  const most = Math.max(...lines)
  return lines.filter(n => n === most).length === 1 ? conds[lines.indexOf(most)] : null
}

// Groups where "more test lines" names the setup the Opus group gap favours; a zero gap or an equal count disagrees.
export function sizeEffect(summary, groups, mode, vs, opusGaps, decimals = 2) {
  const agree = groups.filter(group => {
    const sign = signOf(opusGaps[group], decimals)
    const favoured = sign > 0 ? mode : sign < 0 ? vs : null
    return favoured !== null && moreTestLines(summary, group, [mode, vs]) === favoured
  }).length
  return { agree, n: groups.length }
}

// The held-out round: pairs where "more test lines" names c5ba259's pairWinners winner (no prediction matches nothing).
export function sizeEffectHeldOut({ summary, judgeRows, key }) {
  const winners = pairWinners(judgeRows, key)
  const pairs = Object.keys(winners)
  const agree = pairs.filter(pair => moreTestLines(summary, pair, Object.values(key[pair])) === winners[pair]).length
  return { agree, pairs: pairs.length }
}

// What the CLI writes beyond bars(): per headline its label, outside confirmation, rank wins (over the comparison's
// groups) and size effect; for the round, each outside judge's standing and the held-out size effect.
export function outsideReport({ out, config, judges, judgeRows, key, summary, heldOut }) {
  const comparisons = config.comparisons.map(cmp => {
    const { headline, sensitivity } = out[cmp.name]
    const groups = headline.groups ?? []
    const outside = outsideFor({ result: headline, judges, cmp, share: config.confirmShare, decimals: config.statDecimals })
    const added = {
      label: labelFor(headline, outside), outside,
      rankWins: rankWins(judgeRows.filter(row => groups.includes(row.pair)), key, cmp.mode, cmp.vs),
      sizeEffect: sizeEffect(summary, groups, cmp.mode, cmp.vs, headline.groupGaps ?? {}, config.statDecimals),
    }
    return [cmp.name, { headline: { ...headline, ...added }, sensitivity }]
  })
  const standing = judges.map(j => ({ name: j.name, passedHeldOut: j.passedHeldOut, status: j.status, usableCases: j.usableCases, total: j.total, check: j.check }))
  return { ...Object.fromEntries(comparisons), outside: { judges: standing, sizeEffectHeldOut: sizeEffectHeldOut(heldOut) } }
}

export function secondaryLine(name, headline) {
  const { rankWins: r, sizeEffect: s } = headline
  const marked = r.marked.length ? ` (one judgment: ${r.marked.join(', ')})` : ''
  const counts = Object.entries(headline.outside).filter(([, j]) => j.gap !== undefined)
    .map(([judge, j]) => `  ${judge} ${j.agree} of ${j.n} groups, gap ${shown(j.gap)}`).join('')
  const ranks = `rank wins ${r.for}-${r.against}, ${r.split} split, p ${r.p.toFixed(4)}${marked}  judgments ${r.judgments.for}-${r.judgments.against}`
  const range = Number.isFinite(headline.testsLo) ? ` [${shown(headline.testsLo)}, ${shown(headline.testsHi)}]` : ''
  const tests = Number.isFinite(headline.testsGap) ? `  tests gap ${shown(headline.testsGap)}${range}` : ''
  return `${name.padEnd(9)}${'secondary'.padEnd(12)}${ranks}  more test lines ${s.agree} of ${s.n}${tests}${counts}`
}

export function outsideLine({ judges, sizeEffectHeldOut: s }) {
  const held = c => (c ? `held-out ${c.passed ? 'passed' : 'not passed'} (gap ${shown(c.gap)}, same winner ${c.same} of ${c.pairs})` : 'no held-out check')
  return `${'outside'.padEnd(21)}${judges.map(j => `${j.name} ${held(j.check)}, ${j.status}`).join('; ')}; more test lines ${s.agree} of ${s.pairs} (held-out)`
}
