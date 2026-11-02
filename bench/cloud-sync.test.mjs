import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EMAIL_VAR } from './cloud-git.mjs'
import {
  CASES_BRANCH, MAX_FILE_BYTES, RESULTS_BRANCH, VERDICTS_BRANCH, fetchPath, publishRun, publishSets, pushAll, restore, syncDirFor, syncOptions, syncReady,
} from './cloud-sync.mjs'

// A made-up address: tests never see the real account email.
const EMAIL = 'someone.else@example.test'
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commitAs = (cwd, email, message) => sh(cwd, '-c', 'user.name=x', '-c', `user.email=${email}`, 'commit', '-q', '--allow-empty', '-m', message)
const write = (file, text) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, text)
}
const sha256 = text => createHash('sha256').update(text).digest('hex')

// A bare origin, and a clone (the harness checkout) with a pushed main and the plugin tag v0.2.1.
function machine(t) {
  const root = mkdtempSync(join(tmpdir(), 'bench-cloud-sync-'))
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }))
  sh(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git')
  sh(root, 'clone', '-q', 'remote.git', 'repo')
  const repo = join(root, 'repo')
  write(join(repo, 'agents', 'backend.md'), 'plugin\n')
  sh(repo, 'add', '.')
  commitAs(repo, 'bench@local', 'v0.2.1')
  sh(repo, 'tag', 'v0.2.1')
  sh(repo, 'push', '-q', '--tags', 'origin', 'main')
  const ctx = { repo, syncRoot: join(root, 'sync'), env: { [EMAIL_VAR]: EMAIL }, wait: () => {} }
  return { root, repo, remote: join(root, 'remote.git'), ctx, results: join(root, 'results'), runs: join(root, 'runs') }
}

// A finished run: results/<id>/ and a solution folder that is a git repo with an init commit and uncommitted work.
function finishedRun({ results, runs }, { id = 'h4-solo-mo-r1', folder = 'h4-0123abcd', author = 'bench@local' } = {}) {
  const outDir = join(results, id)
  write(join(outDir, 'run.json'), '{"end":"ok"}\n')
  write(join(outDir, 'evidence', 's1.jsonl'), '{"type":"assistant"}\n')
  const runDir = join(runs, folder)
  mkdirSync(runDir, { recursive: true })
  sh(runDir, 'init', '-q', '-b', 'main')
  write(join(runDir, 'README.md'), '# bench project\n')
  sh(runDir, 'add', 'README.md')
  commitAs(runDir, author, 'init')
  write(join(runDir, 'server.mjs'), 'export {}\n')
  write(join(runDir, '.gitignore'), '*.json\n')
  write(join(runDir, 'bookings.json'), '[]\n')
  return { id, outDir, runDir, folder }
}

const branchFiles = (remote, branch) => sh(remote, 'ls-tree', '-r', '--name-only', branch).split('\n')

test('syncOptions reads each command\'s options and refuses anything else', () => {
  assert.deepEqual(syncOptions(['push']), { command: 'push', branch: RESULTS_BRANCH, round: '', path: '', out: '', rev: 'HEAD', only: [], paths: [], redactEmail: false })
  assert.equal(syncOptions(['push', '--redact-email']).redactEmail, true)
  assert.deepEqual(syncOptions(['publish', `--branch=${CASES_BRANCH}`, '/a', '/b']).paths, ['/a', '/b'])
  assert.deepEqual(syncOptions(['publish', `--branch=${VERDICTS_BRANCH}`, '--only=verdict.json', '/a']).only, ['verdict.json'])
  for (const bad of [[], ['nope'], ['restore'], ['publish', '/a'], ['fetch', '--branch=x'], ['push', '--branch=-x']]) {
    assert.throws(() => syncOptions(bad), /usage: node bench\/cloud-sync\.mjs|--branch=/, bad.join(' '))
  }
})

test('publishRun pushes the run\'s results and its solution folders, history bundled, ignored files kept', t => {
  const m = machine(t)
  const run = finishedRun(m)
  mkdirSync(`${run.runDir}-attempt-1`, { recursive: true })
  write(join(`${run.runDir}-attempt-1`, 'old.mjs'), 'old\n')
  assert.deepEqual(publishRun(run, m.ctx), { committed: true, pushed: true })
  const files = branchFiles(m.remote, RESULTS_BRANCH)
  for (const file of ['results/h4-solo-mo-r1/run.json', 'results/h4-solo-mo-r1/evidence/s1.jsonl', 'runs/h4-0123abcd/server.mjs',
    'runs/h4-0123abcd/bookings.json', 'runs/h4-0123abcd/.gitignore', 'runs/h4-0123abcd.git.bundle', 'runs/h4-0123abcd.git.json', 'runs/h4-0123abcd-attempt-1/old.mjs']) {
    assert.ok(files.includes(file), file)
  }
  assert.ok(!files.some(file => file.includes('/.git/')), 'no nested .git folder')
  const sidecar = JSON.parse(sh(m.remote, 'show', `${RESULTS_BRANCH}:runs/h4-0123abcd.git.json`))
  assert.deepEqual(sidecar, { head: 'refs/heads/main', refs: { 'refs/heads/main': sh(run.runDir, 'rev-parse', 'HEAD') } })
  assert.equal(sh(m.remote, 'log', '-1', '--format=%ae %s', RESULTS_BRANCH), '132957152+afel6@users.noreply.github.com chore(results): h4-solo-mo-r1')
  assert.deepEqual(publishRun(run, m.ctx), { committed: false, pushed: false }, 'nothing new')
})

// npm packages are no part of a solution (the tasks allow Node built-ins only) and can be huge: never pushed.
test('publishRun never pushes node_modules from a solution folder, at any depth', t => {
  const m = machine(t)
  const run = finishedRun(m)
  write(join(run.runDir, 'node_modules', 'left-pad', 'index.js'), 'x\n')
  write(join(run.runDir, 'lib', 'node_modules', 'x', 'index.js'), 'x\n')
  write(join(run.runDir, 'lib', 'util.mjs'), 'export {}\n')
  publishRun(run, m.ctx)
  const files = branchFiles(m.remote, RESULTS_BRANCH)
  assert.ok(files.includes('runs/h4-0123abcd/lib/util.mjs'))
  assert.deepEqual(files.filter(file => file.split('/').includes('node_modules')), [])
})

// GitHub refuses files over 100 MB: a file over 90 MB stops the publish in one line, before any commit or push.
test('a pushed file over the size limit stops the publish in one line, with nothing committed or pushed', t => {
  assert.equal(MAX_FILE_BYTES, 90 * 1024 * 1024)
  const m = machine(t)
  const run = finishedRun(m)
  write(join(run.outDir, 'raw.json'), 'x'.repeat(2 * 1024 * 1024))
  assert.throws(() => publishRun(run, { ...m.ctx, maxFileBytes: 1024 * 1024 }),
    { message: 'results/h4-solo-mo-r1/raw.json is 2.0 MB, over the 1.0 MB limit for one pushed file: nothing was committed or pushed' })
  assert.equal(sh(m.remote, 'branch', '--list', RESULTS_BRANCH), '')
  assert.throws(() => sh(m.repo, 'rev-parse', '--verify', '-q', `refs/heads/${RESULTS_BRANCH}`), 'no commit on the results branch')
})

test('publishRun stops before copying anything when a solution\'s history holds the account email', t => {
  const m = machine(t)
  const run = finishedRun(m, { author: EMAIL.toUpperCase() })
  assert.throws(() => publishRun(run, m.ctx), err => {
    assert.equal(err.name, 'EmailFound')
    assert.match(err.where[0], /^runs\/h4-0123abcd history \(commit [0-9a-f]{12}\)$/)
    assert.ok(!err.message.toLowerCase().includes(EMAIL), 'never the address')
    return true
  })
  assert.equal(existsSync(syncDirFor(RESULTS_BRANCH, m.ctx.syncRoot)), false)
  assert.equal(sh(m.remote, 'branch', '--list', RESULTS_BRANCH), '')
})

// Scanned before the commit too: a hit never sits in the local branch, where it would stop every later push.
test('publishRun commits and pushes nothing when a results file holds the email; no variable, no publish', t => {
  const m = machine(t)
  const run = finishedRun(m)
  write(join(run.outDir, 'stderr.txt'), `signed in as ${EMAIL}\n`)
  assert.throws(() => publishRun(run, m.ctx), err => err.name === 'EmailFound' && err.where[0] === 'results/h4-solo-mo-r1/stderr.txt')
  assert.equal(sh(m.remote, 'branch', '--list', RESULTS_BRANCH), '')
  assert.throws(() => sh(m.repo, 'rev-parse', '--verify', '-q', `refs/heads/${RESULTS_BRANCH}`), 'nothing committed')
  write(join(run.outDir, 'stderr.txt'), 'signed in\n')
  assert.deepEqual(publishRun(run, m.ctx), { committed: true, pushed: true }, 'once the file is clean, the run goes out')
  assert.throws(() => publishRun(run, { ...m.ctx, env: {} }), { message: `$${EMAIL_VAR} is not set: the push scan cannot run, so nothing is pushed` })
})

// Claude Code writes the signed-in account's email into every session transcript (a session_context attachment, and
// the request blob that echoes the system prompt). Off by default: the scan then stops the push, as asked. With
// --redact-email the address is replaced in the pushed copies of results files only, never in the local evidence and
// never in a solution folder; the scan still runs on what is pushed.
test('publishRun with redactEmail replaces the address in pushed results copies only, and says how many files', t => {
  const m = machine(t)
  const run = finishedRun(m)
  const line = `{"type":"attachment","attachment":{"type":"session_context","context":{"userEmail":"${EMAIL.toUpperCase()}"}}}\n`
  write(join(run.outDir, 'evidence', 's1', 'subagents', 'agent-1.jsonl'), line)
  assert.deepEqual(publishRun(run, { ...m.ctx, redactEmail: true }), { committed: true, pushed: true })
  assert.equal(sh(m.remote, 'show', `${RESULTS_BRANCH}:results/h4-solo-mo-r1/evidence/s1/subagents/agent-1.jsonl`),
    '{"type":"attachment","attachment":{"type":"session_context","context":{"userEmail":"[account email removed]"}}}')
  assert.equal(readFileSync(join(run.outDir, 'evidence', 's1', 'subagents', 'agent-1.jsonl'), 'utf8'), line, 'the local evidence is unchanged')
  assert.equal(sh(m.remote, 'log', '-1', '--format=%s', RESULTS_BRANCH), 'chore(results): h4-solo-mo-r1 (account email replaced in 1 file)')
  write(join(run.runDir, 'notes.md'), `contact ${EMAIL}\n`)
  assert.throws(() => publishRun(run, { ...m.ctx, redactEmail: true }), err => err.name === 'EmailFound' && err.where[0] === 'runs/h4-0123abcd/notes.md',
    'a solution folder is never edited: the scan stops it')
})

// A run whose publish failed on the network is not lost: the next publish of it (a resume's batch start) sends it.
test('a publish that cannot reach the remote fails as a push, and the run goes out with its next publish', t => {
  const m = machine(t)
  publishRun(finishedRun(m), m.ctx)
  const second = finishedRun(m, { id: 'h5-solo-mo-r1', folder: 'h5-0123abcd' })
  sh(m.repo, 'remote', 'set-url', 'origin', join(m.root, 'gone.git'))
  assert.throws(() => publishRun(second, m.ctx), { name: 'PushFailed' })
  sh(m.repo, 'remote', 'set-url', 'origin', m.remote)
  assert.deepEqual(publishRun(second, m.ctx), { committed: true, pushed: true })
  assert.ok(branchFiles(m.remote, RESULTS_BRANCH).includes('results/h5-solo-mo-r1/run.json'))
})

test('syncReady checks the email variable and the remote before any paid work, and changes nothing', t => {
  const m = machine(t)
  assert.equal(syncReady(m.ctx), true)
  assert.equal(sh(m.remote, 'branch', '--list', RESULTS_BRANCH), '')
  assert.throws(() => syncReady({ ...m.ctx, env: {} }), { message: `$${EMAIL_VAR} is not set: the push scan cannot run, so nothing is pushed` })
  sh(m.repo, 'remote', 'set-url', 'origin', join(m.root, 'gone.git'))
  assert.throws(() => syncReady(m.ctx), { name: 'PushFailed' })
})

test('pushAll pushes every results entry and run folder, such as the pin and judge files after judging', t => {
  const m = machine(t)
  finishedRun(m)
  write(join(m.results, 'preflight-mo.json'), '{"version":"2.1.296"}\n')
  write(join(m.results, 'judge-mo.json'), '[]\n')
  assert.deepEqual(pushAll({ results: m.results, runs: m.runs }, m.ctx), { committed: true, pushed: true })
  const files = branchFiles(m.remote, RESULTS_BRANCH)
  for (const file of ['results/preflight-mo.json', 'results/judge-mo.json', 'results/h4-solo-mo-r1/run.json', 'runs/h4-0123abcd/server.mjs']) assert.ok(files.includes(file), file)
})

// A fresh machine: a new clone of the code, an empty results folder and runs folder, no CLI and no plugin worktree.
function freshMachine(m) {
  sh(m.root, 'clone', '-q', 'remote.git', 'fresh')
  const repo = join(m.root, 'fresh')
  return { repo, results: join(m.root, 'fresh-results'), runs: join(m.root, 'fresh-runs'), ctx: { ...m.ctx, repo, syncRoot: join(m.root, 'fresh-sync') } }
}

test('restore rebuilds results, run folders with their history, the pinned CLI and the plugin worktree on a fresh machine', t => {
  const m = machine(t)
  const run = finishedRun(m)
  const binary = join(m.root, 'npm', 'claude.exe')
  const pluginDir = join(m.root, 'section-team-v0.2.1')
  write(join(m.results, 'preflight-mo.json'), JSON.stringify({ version: '2.1.296', binary, sha256: sha256('claude bytes'), npmPackage: '@anthropic-ai/claude-code@2.1.296', pluginDir }))
  pushAll({ results: m.results, runs: m.runs }, m.ctx)

  const f = freshMachine(m)
  write(join(f.results, 'h4-solo-mo-r1', 'run.json'), '{"end":"local"}\n')
  const installs = []
  const install = pkg => { installs.push(pkg); write(binary, 'claude bytes') }
  const summary = restore({ round: 'mo', results: f.results, runs: f.runs }, { ...f.ctx, install })
  assert.deepEqual(summary, { results: ['preflight-mo.json'], kept: ['h4-solo-mo-r1'], runs: ['h4-0123abcd'], cli: 'installed', plugin: 'added' })
  assert.deepEqual(installs, ['@anthropic-ai/claude-code@2.1.296'])
  assert.equal(readFileSync(join(f.results, 'h4-solo-mo-r1', 'run.json'), 'utf8'), '{"end":"local"}\n', 'local results are never overwritten')
  const restored = join(f.runs, run.folder)
  assert.equal(sh(restored, 'log', '--format=%s'), 'init')
  assert.equal(sh(restored, 'symbolic-ref', 'HEAD'), 'refs/heads/main')
  assert.deepEqual(sh(restored, 'status', '--porcelain').split('\n').sort(), ['?? .gitignore', '?? server.mjs'])
  assert.equal(readFileSync(join(restored, 'bookings.json'), 'utf8'), '[]\n')
  assert.equal(sh(pluginDir, 'rev-parse', 'HEAD'), sh(m.repo, 'rev-parse', 'v0.2.1'))
  assert.deepEqual(restore({ round: 'mo', results: f.results, runs: f.runs }, { ...f.ctx, install: () => assert.fail('no install') }),
    { results: [], kept: ['h4-solo-mo-r1', 'preflight-mo.json'], runs: [], cli: 'ok', plugin: 'present' }, 'a second restore changes nothing')
})

// The user's Windows run of the restore test got '[]\r\n' for '[]\n': a checkout with core.autocrlf=true converted it.
test('restore on a machine with core.autocrlf=true gives every file back byte for byte', t => {
  const m = machine(t)
  const run = finishedRun(m)
  write(join(run.runDir, 'crlf.txt'), 'a\r\nb\n')
  publishRun(run, m.ctx)
  const f = freshMachine(m)
  sh(f.repo, 'config', 'core.autocrlf', 'true')
  restore({ round: 'mo', results: f.results, runs: f.runs }, f.ctx)
  assert.equal(readFileSync(join(f.runs, run.folder, 'bookings.json'), 'utf8'), '[]\n')
  assert.equal(readFileSync(join(f.runs, run.folder, 'crlf.txt'), 'utf8'), 'a\r\nb\n')
  assert.equal(readFileSync(join(f.results, run.id, 'run.json'), 'utf8'), '{"end":"ok"}\n')
})

test('restore stops when installing the pinned package does not give the pinned bytes, and works before any pin', t => {
  const m = machine(t)
  const binary = join(m.root, 'npm', 'claude.exe')
  write(join(m.results, 'preflight-mo.json'), JSON.stringify({ binary, sha256: sha256('claude bytes'), npmPackage: '@anthropic-ai/claude-code@2.1.296', pluginDir: join(m.root, 'w') }))
  pushAll({ results: m.results, runs: m.runs }, m.ctx)
  const f = freshMachine(m)
  assert.throws(() => restore({ round: 'mo', results: f.results, runs: f.runs }, { ...f.ctx, install: () => write(binary, 'other bytes') }),
    { message: `npm i -g @anthropic-ai/claude-code@2.1.296 did not give ${binary} the pinned bytes (sha256 ${sha256('claude bytes')}): stop; never re-pin a started round` })
})

test('restore before any pin restores what was pushed and says there is no pin; with nothing pushed it restores nothing', t => {
  const m = machine(t)
  const bare = freshMachine(m)
  assert.deepEqual(restore({ round: 'mo', results: bare.results, runs: bare.runs }, bare.ctx),
    { results: [], kept: [], runs: [], cli: 'no pin yet', plugin: 'no pin yet' })
  assert.equal(sh(m.remote, 'branch', '--list', RESULTS_BRANCH), '', 'a restore never creates the results branch')
  publishRun(finishedRun(m), m.ctx)
  sh(m.root, 'clone', '-q', 'remote.git', 'second')
  const repo = join(m.root, 'second')
  const summary = restore({ round: 'mo', results: join(m.root, 'r2'), runs: join(m.root, 'w2') }, { ...m.ctx, repo, syncRoot: join(m.root, 'sync-2') })
  assert.deepEqual(summary, { results: ['h4-solo-mo-r1'], kept: [], runs: ['h4-0123abcd'], cli: 'no pin yet', plugin: 'no pin yet' })
})

// A fresh outside-judge case set as external-judge.mjs prepare writes it.
function caseSet(root, name) {
  const set = join(root, name)
  write(join(set, 'case-01', 'A', 'server.mjs'), 'a\n')
  write(join(set, 'case-01', 'JUDGE.md'), 'judge\n')
  mkdirSync(join(set, 'case-01', 'scratch'), { recursive: true })
  return set
}

test('publishSets sends fresh case sets to the cases branch and refuses keys, verdicts and used scratch folders', t => {
  const m = machine(t)
  const codex = caseSet(m.root, 'codex-judge-mo')
  const ag = caseSet(m.root, 'ag-judge-mo')
  const ctx = { ...m.ctx, branch: CASES_BRANCH }
  for (const [file, why] of [['case-01/verdict.json', 'case-01/verdict.json: judged already'], ['case-01/scratch/p.mjs', 'case-01/scratch/p.mjs: judged already'], ['external-key-mo.json', 'external-key-mo.json: a key']]) {
    const bad = caseSet(m.root, `bad-${why.length}`)
    write(join(bad, file), '{}')
    assert.throws(() => publishSets({ paths: [bad] }, ctx), { message: `not a fresh case set, nothing published: ${bad}/${why}` })
  }
  assert.deepEqual(publishSets({ paths: [codex, ag] }, ctx), { committed: true, pushed: true })
  assert.deepEqual(branchFiles(m.remote, CASES_BRANCH).sort(), ['ag-judge-mo/case-01/A/server.mjs', 'ag-judge-mo/case-01/JUDGE.md', 'codex-judge-mo/case-01/A/server.mjs', 'codex-judge-mo/case-01/JUDGE.md'])
})

test('fetchPath writes a pushed folder or file to a new place, with no .git, and never over anything', t => {
  const m = machine(t)
  const set = caseSet(m.root, 'codex-judge-mo')
  publishSets({ paths: [set] }, { ...m.ctx, branch: CASES_BRANCH })
  write(join(m.root, 'pc-results', 'outside-check-ho-hocx.json'), '{"passed":true}\n')
  write(join(set, 'case-01', 'verdict.json'), '{"ranking":["A"]}\n')
  publishSets({ paths: [set, join(m.root, 'pc-results', 'outside-check-ho-hocx.json')], only: ['verdict.json', 'outside-check-ho-hocx.json'] }, { ...m.ctx, branch: VERDICTS_BRANCH })
  assert.deepEqual(branchFiles(m.remote, VERDICTS_BRANCH).sort(), ['codex-judge-mo/case-01/verdict.json', 'outside-check-ho-hocx.json'])

  const f = freshMachine(m)
  const out = join(m.root, 'pc', 'codex-judge-mo')
  assert.equal(fetchPath({ path: 'codex-judge-mo', out }, { ...f.ctx, branch: CASES_BRANCH }), 2)
  assert.deepEqual(readdirSync(join(out, 'case-01')).sort(), ['A', 'JUDGE.md'])
  assert.equal(existsSync(join(m.root, 'pc', '.git')), false)
  assert.throws(() => fetchPath({ path: 'codex-judge-mo', out }, { ...f.ctx, branch: CASES_BRANCH }), { message: `${out} is not empty: pick a new folder` })
  const check = join(f.results, 'outside-check-ho-hocx.json')
  assert.equal(fetchPath({ path: 'outside-check-ho-hocx.json', out: check }, { ...f.ctx, branch: VERDICTS_BRANCH }), 1)
  assert.equal(readFileSync(check, 'utf8'), '{"passed":true}\n')
  assert.throws(() => fetchPath({ path: 'outside-check-ho-hocx.json', out: check }, { ...f.ctx, branch: VERDICTS_BRANCH }), { message: `${check} exists: pick a new path` })
  assert.throws(() => fetchPath({ path: 'nope', out: join(m.root, 'x') }, { ...f.ctx, branch: VERDICTS_BRANCH }), { message: `nope is not on ${VERDICTS_BRANCH}` })
})
