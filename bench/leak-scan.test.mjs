import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { WORDS, leakScan, main, scanSolution, scanText } from './leak-scan.mjs'

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bench-leak-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function put(path, text) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

// Every file under dir with its text, to show the scan changes nothing.
const snapshot = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).map(e => join(e.parentPath, e.name)).sort().map(p => [p, readFileSync(p, 'utf8')])

test('WORDS is the frozen word list', () => {
  assert.deepEqual(WORDS, ['section-team', 'section', 'supervisor', 'REPORT', 'GRADE', 'reviewer', 'near-miss', 'near miss', 'nearmiss', 'mutant', 'Lean', 'Balanced', 'Max mode', '.team', 'ponytail'])
})

test('scanText counts "Lean" and "near-miss" but not "boolean" or "clean"', () => {
  assert.deepEqual(scanText('Run LEAN here; a boolean flag, a clean build and one near-miss: off by one'), { Lean: 1, 'near-miss': 1 })
})

test('scanText: - and . join a word only between two letters or digits', () => {
  assert.deepEqual(scanText('clean-up'), {})
  assert.deepEqual(scanText('Lean.'), { Lean: 1 })
  assert.deepEqual(scanText('ask the reviewer.'), { reviewer: 1 })
  assert.deepEqual(scanText('the .team folder'), { '.team': 1 })
  assert.deepEqual(scanText('a near-miss copy'), { 'near-miss': 1 })
  assert.deepEqual(scanText('near-miss-1'), {})
  assert.deepEqual(scanText('flag --lean- and x.team and lean.mjs and v2.section'), { Lean: 1 })
  assert.deepEqual(scanText('section-team lean-mode lean2 ponytails'), { 'section-team': 1 })
})

test('scanText: letters of any script join a word, _ does not', () => {
  assert.deepEqual(scanText('lean_mode'), { Lean: 1 })
  assert.deepEqual(scanText('éLean Leanö'), {})
})

test('scanText: a multi-word entry matches across exactly one space, any case', () => {
  assert.deepEqual(scanText('see near miss and MAX MODE'), { 'near miss': 1, 'Max mode': 1 })
  assert.deepEqual(scanText('near  miss, max\nmode, mutant mutant'), { mutant: 2 })
})

test('src/near-miss-1-parse.mjs starting // near-miss: off by one is a hit and an extra path', t => {
  const dir = tempDir(t)
  put(join(dir, 'src', 'near-miss-1-parse.mjs'), '// near-miss: off by one\nexport const parse = s => s\n')
  put(join(dir, 'src', 'parse.mjs'), 'export const parse = s => s\n')
  put(join(dir, 'test', 'parse.test.mjs'), 'a\nb\nc\n')
  put(join(dir, 'test', 'fixture.csv'), 'a,b\n')
  put(join(dir, 'README.md'), '# Parser\nChecked by the reviewer: yes\n')
  put(join(dir, 'package.json'), '{}\n')
  put(join(dir, 'data', 'app.json'), '{}\n')
  put(join(dir, '.gitignore'), 'node_modules\n')
  put(join(dir, 'NOTES.txt'), 'plain notes\n')
  assert.deepEqual(scanSolution(dir), {
    hits: { reviewer: 1, 'near-miss': 2 },
    extraPaths: ['.gitignore', 'NOTES.txt', 'src/near-miss-1-parse.mjs'],
    testLines: 4,
  })
})

test('scanSolution: in a path only letters and digits join a word, so /, -, . and _ end a name part', t => {
  const dir = tempDir(t)
  put(join(dir, 'REPORT.md'), 'ok\n')
  put(join(dir, '.team', 'notes.md'), 'ok\n')
  put(join(dir, 'section-team', 'x.mjs'), 'export {}\n')
  put(join(dir, 'src', 'boolean.mjs'), 'export {}\n')
  put(join(dir, 'src', 'clean-up.mjs'), 'export {}\n')
  put(join(dir, 'src', 'my_mutant.mjs'), 'export {}\n')
  assert.deepEqual(scanSolution(dir), {
    hits: { 'section-team': 1, section: 1, REPORT: 1, mutant: 1, '.team': 1 },
    extraPaths: ['.team/notes.md', 'REPORT.md', 'section-team/x.mjs', 'src/my_mutant.mjs'],
    testLines: 0,
  })
})

// Two groups, two setups: h4-r1 W=solo X=max, h5-r1 (seeded) W=max X=solo. SEED/ is not a solution.
function judgeFolder(judgeDir) {
  put(join(judgeDir, 'h4-r1', 'W', 'src', 'app.mjs'), 'export {}\n')
  put(join(judgeDir, 'h4-r1', 'W', 'test', 'app.test.mjs'), 'x\ny\n')
  put(join(judgeDir, 'h4-r1', 'X', 'notes.txt'), 'the supervisor said so\n')
  put(join(judgeDir, 'h4-r1', 'X', 'test', 'app.test.mjs'), 'x\n')
  put(join(judgeDir, 'h5-r1', 'SEED', 'test', 'seed.test.mjs'), 'seed\nseed\n')
  put(join(judgeDir, 'h5-r1', 'SEED', 'section.md'), 'section REPORT\n')
  put(join(judgeDir, 'h5-r1', 'W', 'test', 'seed.test.mjs'), 'seed\nseed\n')
  put(join(judgeDir, 'h5-r1', 'W', 'test', 'new.test.mjs'), 'n\n')
  put(join(judgeDir, 'h5-r1', 'W', 'README.md'), 'GRADE: 9\n')
  put(join(judgeDir, 'h5-r1', 'X', 'test', 'seed.test.mjs'), 'seed\nseed\n')
  return judgeDir
}

const KEY = { 'h4-r1': { W: 'solo-mo', X: 'max-mo' }, 'h5-r1': { W: 'max-mo', X: 'solo-mo' } }
const SCAN = {
  'max-mo': { hits: { supervisor: 1, GRADE: 1 }, extraPaths: ['h4-r1/X/notes.txt'], testLines: 4 },
  'solo-mo': { hits: {}, extraPaths: [], testLines: 3 },
}

test('leakScan groups by setup through the blind key', t => {
  const judgeDir = judgeFolder(join(tempDir(t), 'judge'))
  const before = snapshot(judgeDir)
  const scan = leakScan({ judgeDir, key: KEY })
  assert.deepEqual(Object.keys(scan), ['max-mo', 'solo-mo'])
  assert.deepEqual(scan, SCAN)
  assert.deepEqual(snapshot(judgeDir), before)
})

test('leakScan refuses a missing solution folder and a key entry that is not a plain name', t => {
  const judgeDir = judgeFolder(join(tempDir(t), 'judge'))
  assert.throws(() => leakScan({ judgeDir, key: { 'h4-r1': { Y: 'lean-mo' } } }), /h4-r1\/Y.*missing.*anonymize/)
  assert.throws(() => leakScan({ judgeDir, key: { 'h4-r1': { '../W': 'lean-mo' } } }), /label "\.\.\/W"/)
  assert.throws(() => leakScan({ judgeDir, key: { '../h4-r1': { W: 'lean-mo' } } }), /group "\.\.\/h4-r1"/)
  assert.throws(() => leakScan({ judgeDir, key: { 'h4-r1': { W: 7 } } }), /setup of h4-r1\/W/)
  assert.throws(() => leakScan({ judgeDir, key: { 'h4-r1': null } }), /labels of h4-r1/)
  assert.throws(() => leakScan({ judgeDir, key: [] }), /blind key/)
})

test('main --round=mo writes results/leak-scan-mo.json and prints a table per setup', t => {
  const root = tempDir(t)
  const home = join(root, 'home')
  const results = join(root, 'results')
  judgeFolder(join(home, 'bench-judge-mo'))
  put(join(results, 'blind-key-mo.json'), JSON.stringify(KEY))
  const lines = []
  t.mock.method(console, 'log', text => lines.push(text))
  main(['--round=mo'], { results, home })
  assert.deepEqual(JSON.parse(readFileSync(join(results, 'leak-scan-mo.json'), 'utf8')), SCAN)
  assert.deepEqual(lines.join('\n').split('\n'), [
    '| setup | word hits | extra paths | test lines |',
    '|---|---|---|---|',
    '| max-mo | supervisor 1, GRADE 1 | 1 | 4 |',
    '| solo-mo | none | 0 | 3 |',
  ])
})

test('main gives one line and exit 1 for a bad round, a missing key, a bad key and a key that is a folder', t => {
  const root = tempDir(t)
  const dirs = { results: join(root, 'results'), home: join(root, 'home') }
  const keyPath = join(dirs.results, 'blind-key-mo.json')
  mkdirSync(dirs.results)
  const errors = []
  t.mock.method(console, 'error', text => errors.push(text))
  // The exit code is put back so this test file itself still exits 0.
  const run = argv => {
    const before = process.exitCode
    main(argv, dirs)
    const exitCode = process.exitCode
    process.exitCode = before
    return { errors: errors.splice(0), exitCode }
  }
  const usage = { errors: ['usage: node bench/leak-scan.mjs --round=<tag>   (letters and digits only)'], exitCode: 1 }
  assert.deepEqual(run([]), usage)
  assert.deepEqual(run(['--round=../x']), usage)
  assert.deepEqual(run(['--round=mo']), { errors: [`leak-scan: missing ${keyPath}: run node bench/anonymize.mjs --round=mo first`], exitCode: 1 })
  writeFileSync(keyPath, '{ nope')
  assert.deepEqual(run(['--round=mo']), { errors: [`leak-scan: ${keyPath}: not valid JSON`], exitCode: 1 })
  rmSync(keyPath)
  mkdirSync(keyPath)
  assert.deepEqual(run(['--round=mo']), { errors: [`leak-scan: ${keyPath} is a folder, not a file`], exitCode: 1 })
})
