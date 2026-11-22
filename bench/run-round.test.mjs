// A round's own setup: where its run folders live and what may sit above them. run.test.mjs has the rest of run.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempRoot } from './run-fixtures.mjs'
import { checkRunsRoot, instructionFilesAbove } from './run.mjs'

const put = (file, text = 'x') => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
// Only what a test planted: the machine running it may hold such a file above its temp folder (this one has AGENTS.md
// in the home), and that one is the machine's, not the test's.
const planted = (found, root) => found.filter(path => path.startsWith(root))

test('the run folders live under BENCH_RUNS when it is set, else ~/bench-runs, with forward slashes', t => {
  const root = tempRoot(t)
  const runsOf = env => spawnSync(process.execPath, ['--input-type=module', '-e', "const { RUNS } = await import('./run.mjs'); process.stdout.write(RUNS)"],
    { cwd: import.meta.dirname, env: { ...process.env, ...env }, encoding: 'utf8' }).stdout
  assert.equal(runsOf({ BENCH_RUNS: join(root, 'bench-runs-nx'), HOME: root, USERPROFILE: root }), join(root, 'bench-runs-nx').replaceAll('\\', '/'))
  assert.equal(runsOf({ BENCH_RUNS: '', HOME: root, USERPROFILE: root }), join(root, 'bench-runs').replaceAll('\\', '/'))
})

test('instructionFilesAbove finds CLAUDE.md, CLAUDE.local.md, AGENTS.md and .claude/CLAUDE.md in the folder and every folder above it, nearest first', t => {
  const root = tempRoot(t)
  const runs = join(root, 'home', 'bench-runs')
  mkdirSync(runs, { recursive: true })
  assert.deepEqual(planted(instructionFilesAbove(runs), root), [])
  put(join(root, 'home', 'AGENTS.md'))
  put(join(root, 'CLAUDE.local.md'))
  put(join(root, 'home', '.claude', 'CLAUDE.md'))
  put(join(runs, 'CLAUDE.md'))
  put(join(root, 'home', 'README.md'))
  assert.deepEqual(planted(instructionFilesAbove(runs), root), [
    join(runs, 'CLAUDE.md'), join(root, 'home', 'AGENTS.md'), join(root, 'home', '.claude', 'CLAUDE.md'), join(root, 'CLAUDE.local.md'),
  ])
})

test('checkRunsRoot refuses a relative root and one with an instruction file above it, naming the file', t => {
  const root = tempRoot(t)
  const runs = join(root, 'home', 'bench-runs-nx')
  mkdirSync(runs, { recursive: true })
  assert.throws(() => checkRunsRoot('bench-runs'), { message: 'BENCH_RUNS takes an absolute path, got "bench-runs"' })
  const agents = join(root, 'home', 'AGENTS.md')
  put(agents)
  assert.throws(() => checkRunsRoot(runs), err => {
    assert.ok(err.message.startsWith(`${agents} sits above the run folders`), err.message)
    assert.match(err.message, /Claude Code reads it as instructions in every run: set BENCH_RUNS to a folder with no CLAUDE\.md, CLAUDE\.local\.md or AGENTS\.md above it$/)
    assert.doesNotMatch(err.message, /\n/)
    return true
  })
  assert.doesNotThrow(() => checkRunsRoot(runs, { found: () => [] }), 'a clean tree passes')
})
