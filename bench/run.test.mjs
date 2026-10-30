import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TASKS, TIMEOUT_MIN, freshRepo, parseArgs, plan, taskProblems } from './run.mjs'

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()

// A temp folder removed after the test, even when the test fails.
function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-run-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  return root
}

test('plan defaults are unchanged', () => {
  const runs = plan()
  assert.equal(runs.length, 18)
  assert.equal(runs[0].id, 'easy-team-r1')
  assert.equal(runs.at(-1).id, 'hard-team-r2')
})

test('plan with tasks, reps and tag', () => {
  const runs = plan({ tag: 'ho', conds: ['team', 'solo'], tasks: ['h1', 'h2', 'h3'], reps: 3 })
  assert.equal(runs.length, 18)
  const ids = runs.map(r => r.id)
  assert.ok(ids.includes('h1-team-ho-r1'))
  assert.ok(ids.includes('h3-solo-ho-r3'))
  assert.ok(runs.every(r => r.base === 'team' || r.base === 'solo'))
  assert.equal(new Set(ids).size, 18)
})

test('plan alternates the condition order by rep, so no condition always goes first', () => {
  const ids = plan({ tasks: ['h1'], reps: 3 }).map(r => r.id)
  assert.deepEqual(ids, [
    'h1-team-r1', 'h1-solo-r1', 'h1-forced-r1',
    'h1-forced-r2', 'h1-solo-r2', 'h1-team-r2',
    'h1-team-r3', 'h1-solo-r3', 'h1-forced-r3',
  ])
})

test('parseArgs reads tasks and reps', () => {
  const args = parseArgs(['--tasks=h1,h2', '--reps=3'])
  assert.deepEqual(args.tasks, ['h1', 'h2'])
  assert.equal(args.reps, 3)
  const defaults = parseArgs([])
  assert.deepEqual(defaults.tasks, TASKS)
  assert.equal(defaults.reps, 2)
})

test('parseArgs rejects bad reps', () => {
  for (const bad of ['--reps=0', '--reps=x', '--reps=1.5', '--reps=', '--reps=-1', '--reps=1e1']) {
    assert.throws(() => parseArgs([bad]), RangeError, bad)
  }
})

test('TASKS and the held-out timeouts', () => {
  assert.deepEqual(TASKS, ['easy', 'medium', 'hard'])
  assert.deepEqual({ h1: TIMEOUT_MIN.h1, h2: TIMEOUT_MIN.h2, h3: TIMEOUT_MIN.h3 }, { h1: 100, h2: 60, h3: 45 })
})

test('freshRepo with a seed', t => {
  const root = tempRoot(t)
  const seed = join(root, 'seed')
  mkdirSync(seed)
  writeFileSync(join(seed, 'a.txt'), 'seeded\n')
  const dir = join(root, 'r')
  freshRepo(dir, { seed, root })
  assert.ok(existsSync(join(dir, 'a.txt')))
  assert.equal(git(dir, 'log', '--format=%s'), 'seed\ninit')
  assert.equal(git(dir, 'status', '--porcelain'), '')
})

test('freshRepo without a seed', t => {
  const root = tempRoot(t)
  const dir = join(root, 'r')
  freshRepo(dir, { root })
  assert.equal(git(dir, 'log', '--format=%s'), 'init')
  assert.equal(git(dir, 'status', '--porcelain'), '')
})

test('freshRepo refuses a folder outside root', t => {
  const base = tempRoot(t)
  const keep = name => {
    const dir = join(base, name)
    mkdirSync(dir)
    writeFileSync(join(dir, 'keep.txt'), 'keep\n')
    return dir
  }
  const root = keep('runs')
  // A sibling whose name starts with root's name, a path that climbs out with '..', and root itself.
  for (const dir of [keep('runs-x'), `${root}/../up`, root]) {
    assert.throws(() => freshRepo(dir, { root }), /refusing/, dir)
  }
  assert.ok(existsSync(join(base, 'runs-x', 'keep.txt')))
  assert.ok(existsSync(join(root, 'keep.txt')))
  assert.ok(!existsSync(join(base, 'up')))
})

test('taskProblems lists every task missing its prompt, hidden tests or timeout', t => {
  const bench = tempRoot(t)
  mkdirSync(join(bench, 'tasks'))
  mkdirSync(join(bench, 'hidden'))
  const put = file => writeFileSync(join(bench, file), '')
  for (const task of ['h1', 'zz']) { put(`tasks/${task}.md`); put(`hidden/${task}.test.mjs`) }
  put('tasks/h2.md')
  const problems = taskProblems(['h1', 'h2', 'h3', 'zz'], bench)
  assert.equal(problems.length, 3)
  assert.match(problems[0], /^h2\b.*bench\/hidden\/h2\.test\.mjs/)
  assert.doesNotMatch(problems[0], /h2\.md/)
  assert.match(problems[1], /^h3\b.*bench\/tasks\/h3\.md.*bench\/hidden\/h3\.test\.mjs/)
  assert.match(problems[2], /^zz\b.*timeout/)
})

test('taskProblems finds nothing wrong with the shipped tasks', () => {
  assert.deepEqual(taskProblems(TASKS), [])
})

test('parseArgs rejects a round, tag or task name that is not only letters and digits', () => {
  for (const bad of ['--round=x/..', '--round=..', '--round=a b', '--tag=x\\..', '--tag=a-b', '--tasks=h1,../x', '--tasks=h1,']) {
    assert.throws(() => parseArgs([bad]), RangeError, bad)
  }
  const ok = parseArgs(['--round=ho', '--tag=ho', '--tasks=h1,h2'])
  assert.deepEqual([ok.round, ok.tag, ok.tasks], ['ho', 'ho', ['h1', 'h2']])
})

test('taskProblems does not take an inherited key such as constructor as a timeout', t => {
  const bench = tempRoot(t)
  mkdirSync(join(bench, 'tasks'))
  mkdirSync(join(bench, 'hidden'))
  writeFileSync(join(bench, 'tasks', 'constructor.md'), '')
  writeFileSync(join(bench, 'hidden', 'constructor.test.mjs'), '')
  assert.deepEqual(taskProblems(['constructor'], bench), ['constructor: missing a timeout in TIMEOUT_MIN'])
})
