import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  EMAIL_VAR, EmailFound, PushFailed, RETRY_WAITS_MS, accountEmail, batchObjects, checkBranch, commitPaths, git, holdsEmail, openWorktree,
  scanAndPush, scanHistory, scanOutgoing, unpushed, withoutEmail,
} from './cloud-git.mjs'

// A made-up address: tests never see the real account email.
const EMAIL = 'Someone.Else@example.test'
const BRANCH = 'bench/mode-round-cloud-results'
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commitAs = (cwd, email, message) => sh(cwd, '-c', 'user.name=x', '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', message)

// A bare "origin" and a clone with one pushed commit on main, removed after the test.
function remoteAndRepo(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-cloud-git-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  sh(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git')
  sh(root, 'clone', '-q', 'remote.git', 'repo')
  const repo = join(root, 'repo')
  commitAs(repo, 'bench@local', 'init')
  sh(repo, 'push', '-q', 'origin', 'main')
  return { root, repo, remote: join(root, 'remote.git') }
}

const write = (file, text) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}

test('checkBranch takes branch names and refuses options, dot-dot and spaces', () => {
  for (const ok of [BRANCH, 'claude/x-1', 'bench/mode-round-cloud-cases']) assert.equal(checkBranch(ok), ok)
  for (const bad of ['', '-x', 'a..b', 'a b', undefined]) assert.throws(() => checkBranch(bad), RangeError)
})

test('accountEmail needs the variable, and its error never holds a value', () => {
  assert.throws(() => accountEmail({}), { message: `$${EMAIL_VAR} is not set: the push scan cannot run, so nothing is pushed` })
  assert.throws(() => accountEmail({ [EMAIL_VAR]: '' }), /is not set/)
  assert.equal(accountEmail({ [EMAIL_VAR]: EMAIL }), EMAIL)
})

test('holdsEmail matches the address in any case and as %40, in bytes', () => {
  assert.equal(holdsEmail(Buffer.from(`x ${EMAIL.toUpperCase()} y`), EMAIL), true)
  assert.equal(holdsEmail(Buffer.from('someone.else%40example.test'), EMAIL), true)
  assert.equal(holdsEmail(Buffer.from('someone.else at example.test'), EMAIL), false)
})

test('withoutEmail replaces every spelling holdsEmail finds, reads regex characters literally, and leaves other bytes alone', () => {
  const email = 'a.b+c@x-y.test'
  const bytes = Buffer.concat([Buffer.from('1 A.B+C@X-Y.TEST 2 a.b+c%40x-y.test 3 aXb+c@x-y.test '), Buffer.from([0, 255])])
  assert.deepEqual(withoutEmail(bytes, email, '[R]'), Buffer.concat([Buffer.from('1 [R] 2 [R] 3 aXb+c@x-y.test '), Buffer.from([0, 255])]))
  assert.equal(withoutEmail(Buffer.from('nothing here'), email, '[R]'), null)
})

test('batchObjects reads git cat-file --batch output, binary bodies and missing objects included', t => {
  const { repo } = remoteAndRepo(t)
  write(join(repo, 'bin.dat'), Buffer.from([0, 10, 255, 10, 10]))
  sh(repo, 'add', 'bin.dat')
  const blob = sh(repo, 'rev-parse', ':bin.dat')
  const out = git(['cat-file', '--batch'], { cwd: repo, input: `${blob}\n${'0'.repeat(40)}\nHEAD\n`, text: false })
  const objects = batchObjects(out)
  assert.deepEqual(objects.map(o => o.type), ['blob', 'commit'])
  assert.deepEqual([...objects[0].body], [0, 10, 255, 10, 10])
})

test('openWorktree makes an orphan branch, reuses it, and opens the pushed one on a fresh clone', t => {
  const { root, repo } = remoteAndRepo(t)
  const dir = join(root, 'sync', 'results')
  assert.equal(openWorktree({ repo, branch: BRANCH, dir }), dir)
  assert.equal(sh(dir, 'symbolic-ref', '--short', 'HEAD'), BRANCH)
  write(join(dir, 'results', 'a.json'), '{}\n')
  assert.equal(commitPaths({ cwd: dir, paths: ['results'], message: 'chore(results): a' }), true)
  assert.equal(sh(dir, 'log', '--format=%ae %s'), '132957152+afel6@users.noreply.github.com chore(results): a')
  assert.equal(sh(dir, 'rev-list', '--count', 'HEAD'), '1', 'an orphan: no history of the code branches')
  assert.equal(openWorktree({ repo, branch: BRANCH, dir }), dir, 'reused')
  sh(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`)

  sh(root, 'clone', '-q', 'remote.git', 'fresh')
  const fresh = join(root, 'fresh-sync')
  openWorktree({ repo: join(root, 'fresh'), branch: BRANCH, dir: fresh })
  assert.equal(sh(fresh, 'show', 'HEAD:results/a.json'), '{}')
})

test('openWorktree refuses a folder that is not its worktree, and a branch that diverged from the remote', t => {
  const { root, repo } = remoteAndRepo(t)
  const dir = join(root, 'sync')
  write(join(root, 'busy', 'x'), 'x')
  assert.throws(() => openWorktree({ repo, branch: BRANCH, dir: join(root, 'busy') }), { message: `${join(root, 'busy')} exists and is not a worktree of ${BRANCH}: move it away first` })
  assert.throws(() => openWorktree({ repo, branch: BRANCH, dir: repo }), { message: `${repo} is a worktree of main, not ${BRANCH}` })
  openWorktree({ repo, branch: BRANCH, dir })
  commitAs(dir, 'bench@local', 'local one')
  sh(dir, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`)
  sh(root, 'clone', '-q', 'remote.git', 'other')
  const other = join(root, 'other-sync')
  openWorktree({ repo: join(root, 'other'), branch: BRANCH, dir: other })
  commitAs(other, 'bench@local', 'from another machine')
  sh(other, 'push', '-q', 'origin', `HEAD:refs/heads/${BRANCH}`)
  commitAs(dir, 'bench@local', 'local two')
  assert.throws(() => openWorktree({ repo, branch: BRANCH, dir }), { message: `${BRANCH} in ${dir} and origin/${BRANCH} have diverged: compare them before any push` })
})

test('commitPaths commits files a solution\'s own .gitignore ignores, and reports when nothing changed', t => {
  const { root, repo } = remoteAndRepo(t)
  const dir = openWorktree({ repo, branch: BRANCH, dir: join(root, 'sync') })
  write(join(dir, 'runs', 'h4-1', '.gitignore'), '*.json\n')
  write(join(dir, 'runs', 'h4-1', 'bookings.json'), '[]\n')
  assert.equal(commitPaths({ cwd: dir, paths: ['runs'], message: 'm' }), true)
  assert.equal(sh(dir, 'ls-files'), 'runs/h4-1/.gitignore\nruns/h4-1/bookings.json')
  assert.equal(commitPaths({ cwd: dir, paths: ['runs'], message: 'm' }), false)
})

test('scanAndPush pushes what is new, and nothing when nothing is', t => {
  const { root, repo, remote } = remoteAndRepo(t)
  const dir = openWorktree({ repo, branch: BRANCH, dir: join(root, 'sync') })
  assert.equal(scanAndPush({ cwd: dir, branch: BRANCH, email: EMAIL, push: () => assert.fail('nothing to push') }), false)
  write(join(dir, 'results', 'a.json'), '{"ok":true}\n')
  commitPaths({ cwd: dir, paths: ['results'], message: 'm' })
  assert.equal(unpushed({ cwd: dir, branch: BRANCH }), 1)
  assert.equal(scanAndPush({ cwd: dir, branch: BRANCH, email: EMAIL }), true)
  assert.equal(unpushed({ cwd: dir, branch: BRANCH }), 0)
  assert.equal(sh(remote, 'show', `${BRANCH}:results/a.json`), '{"ok":true}')
})

test('scanAndPush finds the email in a file or in a commit, names where, never the address, and pushes nothing', t => {
  const { root, repo, remote } = remoteAndRepo(t)
  const dir = openWorktree({ repo, branch: BRANCH, dir: join(root, 'sync') })
  write(join(dir, 'results', 'h4-solo-mo-r1', 'raw.json'), `{"note":"mail ${EMAIL.toLowerCase()}"}\n`)
  commitPaths({ cwd: dir, paths: ['results'], message: 'm' })
  const push = () => assert.fail('no push after a hit')
  assert.throws(() => scanAndPush({ cwd: dir, branch: BRANCH, email: EMAIL, push }), err => {
    assert.ok(err instanceof EmailFound)
    assert.deepEqual(err.where, ['results/h4-solo-mo-r1/raw.json'])
    assert.ok(!err.message.toLowerCase().includes(EMAIL.toLowerCase()), 'the message never holds the address')
    return true
  })
  assert.equal(sh(remote, 'branch', '--list', BRANCH), '', 'nothing reached the remote')
  sh(dir, 'rm', '-q', '-r', 'results')
  sh(dir, ...['-c', 'user.name=x', '-c', 'user.email=bench@local'], 'commit', '-q', '-m', 'drop')
  assert.throws(() => scanAndPush({ cwd: dir, branch: BRANCH, email: EMAIL, push }), { name: 'EmailFound' }, 'still in the unpushed history')
  const clean = join(root, 'clean')
  openWorktree({ repo, branch: 'bench/other', dir: clean })
  commitAs(clean, EMAIL, 'authored with the address')
  assert.throws(() => scanAndPush({ cwd: clean, branch: 'bench/other', email: EMAIL, push }), err => /^commit [0-9a-f]{12}$/.test(err.where[0]))
})

test('scanAndPush retries a failing push 4 times, 2, 4, 8 and 16 s apart, then fails with the commits kept', t => {
  const { root, repo } = remoteAndRepo(t)
  const dir = openWorktree({ repo, branch: BRANCH, dir: join(root, 'sync') })
  write(join(dir, 'a'), 'a')
  commitPaths({ cwd: dir, paths: ['a'], message: 'm' })
  const waits = []
  let tries = 0
  const flaky = () => { if (++tries < 3) throw new Error('network down') }
  assert.equal(scanAndPush({ cwd: dir, branch: BRANCH, email: EMAIL, push: flaky, wait: ms => waits.push(ms) }), true)
  assert.deepEqual(waits, [2000, 4000])
  waits.length = 0
  assert.throws(() => scanAndPush({ cwd: dir, branch: BRANCH, email: EMAIL, push: () => { throw new Error('network down') }, wait: ms => waits.push(ms) }), err => {
    assert.ok(err instanceof PushFailed)
    assert.match(err.message, /after 5 tries \(network down\); its commits stay in .*, and the next push sends them$/)
    return true
  })
  assert.deepEqual(waits, RETRY_WAITS_MS)
})

test('scanHistory reads every object of a solution folder\'s own repo, and nothing without one', t => {
  const { root, repo } = remoteAndRepo(t)
  assert.deepEqual(scanHistory({ cwd: repo, email: EMAIL, label: 'runs/h4-1' }), [])
  commitAs(repo, EMAIL.toUpperCase(), 'by the account')
  const hits = scanHistory({ cwd: repo, email: EMAIL, label: 'runs/h4-1' })
  assert.equal(hits.length, 1)
  assert.match(hits[0], /^runs\/h4-1 history \(commit [0-9a-f]{12}\)$/)
  assert.deepEqual(scanHistory({ cwd: join(root, 'nowhere'), email: EMAIL, label: 'x' }), [])
  assert.deepEqual(scanOutgoing({ cwd: repo, email: 'nobody@example.test' }), [])
})
