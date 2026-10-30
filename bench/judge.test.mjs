import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fillPrompt, judgeOptions, parseVerdict, pendingJobs, runJobs } from './judge.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const LABELS = ['X', 'Y']
const scores = (overall, extra = {}) => ({ correctness: 8, codeQuality: 7, tests: 6, robustnessSecurity: 7, docsUsability: 5, overall, notes: 'src/a.mjs:3 ok', ...extra })
const fenced = v => `I ran both test suites.\n\n\`\`\`json\n${JSON.stringify(v, null, 2)}\n\`\`\`\n`
const good = { X: scores(6), Y: scores(8), ranking: ['Y', 'X'] }
const envelope = text => JSON.stringify({ type: 'result', result: text, total_cost_usd: 1.25 })

test('parseVerdict on valid text returns the row', () => {
  assert.deepEqual(parseVerdict(fenced(good), 'h1-r1', LABELS), { pair: 'h1-r1', ...good })
})

test('parseVerdict uses the last json block when there are two', () => {
  const draft = { X: scores(2), Y: scores(3), ranking: ['X', 'Y'] }
  assert.deepEqual(parseVerdict(fenced(draft) + 'On second thought:\n' + fenced(good), 'h1-r1', LABELS), { pair: 'h1-r1', ...good })
})

test('parseVerdict keeps notes that quote a ``` fence', () => {
  const quoting = { ...good, X: scores(6, { notes: 'README.md:4 shows ```json\n``` usage' }) }
  assert.deepEqual(parseVerdict(fenced(quoting), 'h1-r1', LABELS), { pair: 'h1-r1', ...quoting })
})

test('parseVerdict throws on a missing tests field', () => {
  const { tests, ...noTests } = scores(6)
  assert.throws(() => parseVerdict(fenced({ ...good, X: noTests }), 'h1-r1', LABELS), /tests/)
})

test('parseVerdict throws on a score of 11', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, Y: scores(11) }), 'h1-r1', LABELS), /Y\.overall/)
})

test('parseVerdict throws on a score that is not an integer', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, X: scores(7.5) }), 'h1-r1', LABELS), /X\.overall/)
  assert.throws(() => parseVerdict(fenced({ ...good, X: scores('7') }), 'h1-r1', LABELS), /X\.overall/)
})

test('parseVerdict throws on notes that are not a string', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, X: scores(6, { notes: undefined }) }), 'h1-r1', LABELS), /notes/)
})

test('parseVerdict throws on a ranking that repeats a label', () => {
  assert.throws(() => parseVerdict(fenced({ ...good, ranking: ['X', 'X'] }), 'h1-r1', LABELS), /ranking/)
})

test('parseVerdict throws on text with no JSON', () => {
  assert.throws(() => parseVerdict('Both solutions look fine.', 'h1-r1', LABELS), /json/)
})

test('pendingJobs lists every (pair, judge) not yet in the rows, pair by pair', () => {
  assert.deepEqual(pendingJobs(['h1-r1', 'h1-r2'], [{ pair: 'h1-r1', judge: 1 }], 2), [
    { pair: 'h1-r1', judge: 2 },
    { pair: 'h1-r2', judge: 1 },
    { pair: 'h1-r2', judge: 2 },
  ])
})

test('fillPrompt fills every placeholder of the committed prompt, and the SEED note only for a seeded pair', () => {
  const template = readFileSync(join(BENCH, 'judge-prompt.md'), 'utf8')
  for (const name of ['{{LABELS}}', '{{TASK}}', '{{SEED_NOTE}}']) assert.ok(template.includes(name), name)
  const task = 'Build a cron library. Use $& and $1 literally.'
  const seeded = fillPrompt(template, { labels: LABELS, task, seed: true })
  const plain = fillPrompt(template, { labels: LABELS, task, seed: false })
  for (const text of [seeded, plain]) {
    assert.ok(!text.includes('{{'), 'no placeholder left')
    assert.ok(text.includes(task), 'task text copied as is')
    assert.ok(text.includes('X, Y'))
  }
  const note = 'SEED/ is the repo before the change; judge only what each solution changed and whether it broke anything'
  assert.ok(seeded.includes(note))
  assert.ok(!plain.includes('SEED/'))
})

test('runJobs saves bad output raw, goes on with the other jobs, and a rerun redoes only the missing ones', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'judge-test-'))
  try {
    const rowsPath = join(dir, 'judge-t.json')
    const rawDir = join(dir, 'judge-t-raw')
    const jobs = [['h1-r1', 1], ['h1-r1', 2], ['h1-r2', 1], ['h1-r2', 2]].map(([pair, judge]) => ({ pair, judge, labels: LABELS }))
    const partial = envelope(fenced({ X: scores(6), ranking: ['X', 'Y'] }))
    const outputs = [envelope(fenced(good)), partial, 'claude crashed', envelope(fenced(good))]
    const lines = []
    const failed = await runJobs(jobs, { rows: Object.freeze([]), call: async job => outputs[jobs.indexOf(job)], rowsPath, rawDir, log: line => lines.push(line) })

    assert.equal(failed, 2)
    const rows = JSON.parse(readFileSync(rowsPath, 'utf8'))
    assert.deepEqual(rows, [
      { pair: 'h1-r1', ...good, judge: 1, costUSD: 1.25 },
      { pair: 'h1-r2', ...good, judge: 2, costUSD: 1.25 },
    ])
    assert.equal(readFileSync(join(rawDir, 'h1-r1-2.json'), 'utf8'), partial)
    assert.equal(readFileSync(join(rawDir, 'h1-r2-1.json'), 'utf8'), 'claude crashed')
    const failLines = lines.filter(line => line.includes('failed'))
    assert.equal(failLines.length, 2)
    assert.match(failLines[0], /h1-r1 #2 failed: Y/)
    assert.deepEqual(pendingJobs(['h1-r1', 'h1-r2'], rows, 2), [{ pair: 'h1-r1', judge: 2 }, { pair: 'h1-r2', judge: 1 }])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('judgeOptions reads round, per-pair and limit, and rejects a bad command line', () => {
  assert.deepEqual(judgeOptions(['--round=ho', '--per-pair=2']), { round: 'ho', perPair: 2, limit: Infinity })
  assert.deepEqual(judgeOptions(['--round=ho', '--per-pair=2', '--limit=1']), { round: 'ho', perPair: 2, limit: 1 })
  for (const argv of [[], ['--round=ho'], ['--per-pair=2'], ['--round=../x', '--per-pair=2'], ['--round=ho', '--per-pair=0'], ['--round=ho', '--per-pair=2', '--limit=0']]) {
    assert.throws(() => judgeOptions(argv), /usage/, argv.join(' '))
  }
})

test('the CLI prints one usage line and exits 1 on a bad command line, without calling claude', () => {
  const res = spawnSync(process.execPath, [join(BENCH, 'judge.mjs'), '--round=ho'], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  assert.equal(res.stdout, '')
  assert.match(res.stderr, /^judge: usage: node bench\/judge\.mjs --round=<name> --per-pair=<n> \[--limit=<n>\]\n$/)
})
