// Keeps a cloud round safe when the machine vanishes (spec: docs/specs/2026-11-01-mode-round-design.md, "Cloud
// amendment"). After every finished run, run.mjs --sync commits that run's results/<id>/ and its solution folders to the
// results branch and pushes it; a solution folder's own git history goes along as a bundle. The preflight pushes the
// round's pin the same way. Before every push the outgoing objects, and the history of every solution folder, are
// scanned for the account email ($CLAUDE_CODE_USER_EMAIL, never printed): a hit stops before the push.
// restore rebuilds bench/results, the run folders, the pinned CLI and the plugin worktree on a fresh machine from what
// was pushed, never over anything already there. publish and fetch carry outside-judge case sets to the user's PC and
// verdicts back, through branches of their own: the results branch holds the blind keys and never goes to a judge.
// Claude Code writes the signed-in account's email into every session transcript (a session_context attachment): with
// --redact-email (run.mjs and push), the address is replaced in the pushed copies of results files only, never in the
// local evidence and never in a solution folder, and the scan still runs on what is pushed. Off, the scan stops the push.
// Usage: node bench/cloud-sync.mjs push [--branch=<b>] [--redact-email]        (all of bench/results and the run folders)
//        node bench/cloud-sync.mjs restore --round=mo [--branch=<b>]
//        node bench/cloud-sync.mjs scan [--rev=HEAD]                             (what a push of rev would send)
//        node bench/cloud-sync.mjs publish --branch=<b> [--only=<file name>,...] <folder or file> ...
//        node bench/cloud-sync.mjs fetch --branch=<b> --path=<path on the branch> --out=<new folder or file>
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { SECTION_TEAM_VERSION, sha256Of } from './clean-run.mjs'
import {
  EmailFound, accountEmail, batchObjects, checkBranch, commitPaths, fetchBranch, git, holdsEmail, openWorktree, remoteHasBranch, scanAndPush, scanHistory,
  scanOutgoing, tryGit, withoutEmail,
} from './cloud-git.mjs'
import { NAME, RESULTS, RUNS } from './run.mjs'

export const RESULTS_BRANCH = 'bench/mode-round-cloud-results'
export const CASES_BRANCH = 'bench/mode-round-cloud-cases'
export const VERDICTS_BRANCH = 'bench/mode-round-cloud-verdicts'
const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const SYNC_ROOT = join(homedir(), 'bench-sync')
const PLUGIN_TAG = `v${SECTION_TEAM_VERSION}`
const USAGE = 'usage: node bench/cloud-sync.mjs push | restore --round=<r> | scan [--rev=<rev>] | publish --branch=<b> [--only=<names>] <path>... | fetch --branch=<b> --path=<p> --out=<new path>'
const COPY = { recursive: true, verbatimSymlinks: true }
const PLACEHOLDER = '[account email removed]'
// GitHub refuses files over 100 MB; a pushed file over this stops the publish before any commit.
export const MAX_FILE_BYTES = 90 * 1024 * 1024
// Never pushed from a solution folder: its own repo (bundled beside it) and npm packages (the tasks allow built-ins only).
const NOT_PUSHED = new Set(['.git', 'node_modules'])
// A case set may hold none of these: a judged case, a used scratch folder, or a key.
const KEY_FILE = /blind-key|external-key/i

// The worktree a branch syncs through, outside the repo and the run folders.
export const syncDirFor = (branch, root = SYNC_ROOT) => join(root, branch.replaceAll('/', '-'))

const filesUnder = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile() || e.isSymbolicLink()).map(e => relative(dir, join(e.parentPath, e.name)).replaceAll('\\', '/')).sort()

const contextOf = ({ repo = REPO, syncRoot = SYNC_ROOT, env = process.env, branch = RESULTS_BRANCH, wait, push, redactEmail = false, maxFileBytes = MAX_FILE_BYTES } = {}) =>
  ({ repo, syncRoot, env, branch: checkBranch(branch), wait, push, redactEmail, maxFileBytes })

const megabytes = bytes => (bytes / (1024 * 1024)).toFixed(1)

// The worktree files under paths, worktree-relative.
const stagedFiles = (dir, paths) => paths.filter(rel => existsSync(join(dir, rel)))
  .flatMap(rel => (lstatSync(join(dir, rel)).isDirectory() ? filesUnder(join(dir, rel)).map(file => `${rel}/${file}`) : [rel]))

// Before the commit, so a hit never sits in the local branch, where it would stop every later push.
function checkNoEmail(dir, files, email) {
  const hits = files.filter(file => lstatSync(join(dir, file)).isFile() && holdsEmail(readFileSync(join(dir, file)), email))
  if (hits.length > 0) throw new EmailFound(hits)
}

// Every file about to be staged must fit the limit; one line names each that does not.
function checkSizes(dir, files, limit) {
  const big = files.map(file => [file, lstatSync(join(dir, file)).size]).filter(([, size]) => size > limit)
  if (big.length > 0) {
    throw new Error(`${big.map(([file, size]) => `${file} is ${megabytes(size)} MB`).join(', ')}, over the ${megabytes(limit)} MB limit for one pushed file: nothing was committed or pushed`)
  }
}

// The pushed copies under to (a folder or a file) without the address; the number of files changed.
function redactCopies(to, email) {
  const files = statSync(to).isFile() ? [to] : filesUnder(to).map(rel => join(to, rel))
  return files.filter(file => {
    const clean = statSync(file).isFile() ? withoutEmail(readFileSync(file), email, PLACEHOLDER) : null
    if (clean !== null) writeFileSync(file, clean)
    return clean !== null
  }).length
}

// A solution folder's refs and HEAD, so a bundle is rebuilt only when its history changed.
function repoState(dir) {
  const head = tryGit(['symbolic-ref', '-q', 'HEAD'], { cwd: dir }) ?? tryGit(['rev-parse', '-q', '--verify', 'HEAD'], { cwd: dir })
  const lines = (tryGit(['show-ref'], { cwd: dir }) ?? '').split('\n').filter(Boolean)
  return { head, refs: Object.fromEntries(lines.map(line => line.split(' ').reverse())) }
}

const readJsonOr = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback)

// The solution's files without any .git, beside it its history as <name>.git.bundle and <name>.git.json.
function placeSolution(from, to) {
  rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { ...COPY, filter: src => src === from || !NOT_PUSHED.has(basename(src)) })
  const sidecar = `${to}.git.json`
  if (!existsSync(join(from, '.git'))) {
    for (const file of [sidecar, `${to}.git.bundle`]) rmSync(file, { force: true })
    return
  }
  const state = repoState(from)
  if (JSON.stringify(readJsonOr(sidecar, null)) === JSON.stringify(state) && existsSync(`${to}.git.bundle`)) return
  if (Object.keys(state.refs).length > 0) git(['bundle', 'create', '-q', `${to}.git.bundle`, '--all'], { cwd: from })
  writeFileSync(sidecar, `${JSON.stringify(state, null, 2)}\n`)
}

// One item into the worktree: a folder or file mirrored, a solution with its history, or (only) the named files alone.
function placeItem(item, dir) {
  const to = join(dir, item.to)
  mkdirSync(dirname(to), { recursive: true })
  if (item.solution) return placeSolution(item.from, to)
  rmSync(to, { recursive: true, force: true })
  if (!item.only?.length) return cpSync(item.from, to, COPY)
  if (statSync(item.from).isFile()) return item.only.includes(basename(item.from)) ? cpSync(item.from, to) : undefined
  for (const rel of filesUnder(item.from).filter(rel => item.only.includes(basename(rel)))) cpSync(join(item.from, rel), join(to, rel), COPY)
}

// The worktree paths a commit stages: those that exist, and those it tracks (a deletion).
const stageable = (dir, paths) => paths.filter(rel => existsSync(join(dir, rel)) || git(['ls-files', '--', rel], { cwd: dir }) !== '')
const pathsOf = item => (item.solution ? [item.to, `${item.to}.git.bundle`, `${item.to}.git.json`] : [item.to])

// Scans the solutions' histories (before anything is copied), places every item, commits, then scans and pushes.
export function publishItems({ items, message }, options) {
  const ctx = contextOf(options)
  const email = accountEmail(ctx.env)
  const hits = items.filter(item => item.solution).flatMap(item => scanHistory({ cwd: item.from, email, label: item.to }))
  if (hits.length > 0) throw new EmailFound(hits)
  const dir = openWorktree({ repo: ctx.repo, branch: ctx.branch, dir: syncDirFor(ctx.branch, ctx.syncRoot), wait: ctx.wait })
  for (const item of items) placeItem(item, dir)
  const redactable = items.filter(item => !item.solution && item.to.startsWith('results/') && existsSync(join(dir, item.to)))
  const redacted = ctx.redactEmail ? redactable.reduce((sum, item) => sum + redactCopies(join(dir, item.to), email), 0) : 0
  const note = redacted > 0 ? ` (account email replaced in ${redacted} file${redacted === 1 ? '' : 's'})` : ''
  const paths = stageable(dir, items.flatMap(pathsOf))
  const files = stagedFiles(dir, paths)
  checkNoEmail(dir, files, email)
  checkSizes(dir, files, ctx.maxFileBytes)
  const committed = paths.length > 0 && commitPaths({ cwd: dir, paths, message: `${message}${note}` })
  const pushed = scanAndPush({ cwd: dir, branch: ctx.branch, email, wait: ctx.wait, push: ctx.push })
  return { committed, pushed }
}

// The run folder and what run.mjs kept beside it: earlier attempts (<dir>-attempt-<n>) and stage copies (<dir>-s1).
function solutionFolders(runDir) {
  const prefix = `${basename(runDir)}-`
  const parent = dirname(runDir)
  const attempts = existsSync(parent) ? readdirSync(parent).filter(name => name.startsWith(prefix)).map(name => join(parent, name)) : []
  return [runDir, ...attempts].filter(existsSync)
}

// One run's results and solution folders, after it finished or stopped (run.mjs --sync).
export function publishRun({ id, outDir, runDir }, options) {
  const items = [{ from: outDir, to: `results/${id}` }, ...solutionFolders(runDir).map(dir => ({ from: dir, to: `runs/${basename(dir)}`, solution: true }))]
  return publishItems({ items, message: `chore(results): ${id}` }, options)
}

// Everything: every results entry (the pin, judge files, keys) and every run folder.
export function pushAll({ results = RESULTS, runs = RUNS } = {}, options) {
  const entries = dir => (existsSync(dir) ? readdirSync(dir).sort() : [])
  const items = [
    ...entries(results).map(name => ({ from: join(results, name), to: `results/${name}` })),
    ...entries(runs).filter(name => statSync(join(runs, name)).isDirectory()).map(name => ({ from: join(runs, name), to: `runs/${name}`, solution: true })),
  ]
  return publishItems({ items, message: 'chore(results): sync all' }, options)
}

// Before any paid work: the email variable is set and the remote answers (a network failure is a PushFailed). It
// creates nothing, here or on the remote.
export function syncReady(options) {
  const ctx = contextOf(options)
  accountEmail(ctx.env)
  remoteHasBranch({ cwd: ctx.repo, branch: ctx.branch, wait: ctx.wait })
  return true
}

// Commits left unpushed by a stopped batch go out before the next run starts.
export function pushPending(options) {
  const ctx = contextOf(options)
  const dir = syncDirFor(ctx.branch, ctx.syncRoot)
  if (!existsSync(join(dir, '.git'))) return false
  return scanAndPush({ cwd: dir, branch: ctx.branch, email: accountEmail(ctx.env), wait: ctx.wait, push: ctx.push })
}

function rebuildRepo(dir, bundle, { head }) {
  git(['init', '-q'], { cwd: dir })
  git(['fetch', '-q', '--update-head-ok', bundle, '+refs/*:refs/*'], { cwd: dir })
  if (head?.startsWith('refs/')) git(['symbolic-ref', 'HEAD', head], { cwd: dir })
  else if (head) git(['update-ref', '--no-deref', 'HEAD', head], { cwd: dir })
  git(['reset', '-q'], { cwd: dir })
}

function restoreFolders(base, results, runs) {
  const summary = { results: [], kept: [], runs: [] }
  const named = dir => (existsSync(dir) ? readdirSync(dir).sort() : [])
  for (const name of named(join(base, 'results'))) {
    const target = join(results, name)
    if (existsSync(target)) summary.kept.push(name)
    else summary.results.push(name) && cpSync(join(base, 'results', name), target, COPY)
  }
  for (const name of named(join(base, 'runs')).filter(name => statSync(join(base, 'runs', name)).isDirectory())) {
    const target = join(runs, name)
    if (existsSync(target)) continue
    cpSync(join(base, 'runs', name), target, COPY)
    const bundle = join(base, 'runs', `${name}.git.bundle`)
    if (existsSync(bundle)) rebuildRepo(target, bundle, readJsonOr(join(base, 'runs', `${name}.git.json`), {}))
    summary.runs.push(name)
  }
  return summary
}

function npmInstall(pkg) {
  const r = spawnSync('npm', ['i', '-g', pkg], { stdio: 'inherit' })
  if (r.error || r.status !== 0) throw new Error(`npm i -g ${pkg} failed (${r.error?.code ?? `exit ${r.status}`})`)
}

const pinnedBytes = pin => existsSync(pin.binary) && sha256Of(pin.binary) === pin.sha256

// The pinned CLI back in place: an installed pin by installing its npm package again; its bytes must match the pin.
function ensurePinnedCli(pin, install) {
  if (pinnedBytes(pin)) return 'ok'
  if (!pin.npmPackage) throw new Error(`${pin.binary} is not the pinned CLI and the pin names no npm package: put the pinned copy back`)
  install(pin.npmPackage)
  if (!pinnedBytes(pin)) throw new Error(`npm i -g ${pin.npmPackage} did not give ${pin.binary} the pinned bytes (sha256 ${pin.sha256}): stop; never re-pin a started round`)
  return 'installed'
}

// The worktree at the commit the pin recorded, which is what a batch holds it to; a pin from before --plugin-ref has only the tag.
function ensurePluginWorktree(pin, repo) {
  if (existsSync(pin.pluginDir)) return 'present'
  tryGit(['fetch', '-q', 'origin', ...(pin.pluginRef ? [pin.pluginRef] : ['tag', PLUGIN_TAG])], { cwd: repo })
  git(['worktree', 'add', '-q', '--detach', pin.pluginDir, pin.pluginCommit ?? pin.pluginRef ?? PLUGIN_TAG], { cwd: repo })
  return 'added'
}

// A fresh machine back to where the pushed data left the round. Restores into missing places only.
export function restore({ round, results = RESULTS, runs = RUNS }, { install = npmInstall, ...options } = {}) {
  const ctx = contextOf(options)
  const pushed = remoteHasBranch({ cwd: ctx.repo, branch: ctx.branch, wait: ctx.wait })
  const summary = pushed
    ? restoreFolders(openWorktree({ repo: ctx.repo, branch: ctx.branch, dir: syncDirFor(ctx.branch, ctx.syncRoot), wait: ctx.wait }), results, runs)
    : { results: [], kept: [], runs: [] }
  const pin = readJsonOr(join(results, `preflight-${round}.json`), null)
  if (pin === null) return { ...summary, cli: 'no pin yet', plugin: 'no pin yet' }
  return { ...summary, cli: ensurePinnedCli(pin, install), plugin: ensurePluginWorktree(pin, ctx.repo) }
}

// The first file of a case set that a fresh set may not hold.
function staleFile(set) {
  const why = rel => (KEY_FILE.test(basename(rel)) ? 'a key' : basename(rel) === 'verdict.json' || rel.split('/').includes('scratch') ? 'judged already' : null)
  const rel = filesUnder(set).find(why)
  return rel === undefined ? null : `${set}/${rel}: ${why(rel)}`
}

// Folders or files under their names at the branch root. The cases branch takes only fresh case sets (no verdict, no
// probe in scratch/, no key); --only keeps just the named files (verdict.json going back).
export function publishSets({ paths, only = [] }, options) {
  const ctx = contextOf(options)
  if (ctx.branch === CASES_BRANCH) {
    const stale = paths.map(staleFile).find(Boolean)
    if (stale) throw new Error(`not a fresh case set, nothing published: ${stale}`)
  }
  const items = paths.map(from => ({ from, to: basename(from), only }))
  return publishItems({ items, message: `chore(sync): ${items.map(item => item.to).join(', ')}` }, ctx)
}

// A path of a pushed branch written to a new folder or file, without any git folder: how the user's PC takes a case
// set, and how this machine takes verdicts back. Returns the number of files written.
export function fetchPath({ path, out }, options) {
  const ctx = contextOf(options)
  fetchBranch({ cwd: ctx.repo, branch: ctx.branch, wait: ctx.wait })
  const entries = git(['ls-tree', '-r', '-z', '--full-tree', `origin/${ctx.branch}`, '--', path], { cwd: ctx.repo }).split('\0').filter(Boolean).map(line => {
    const [meta, name] = line.split('\t')
    const [mode, , oid] = meta.split(' ')
    return { mode, oid, name }
  })
  if (entries.length === 0) throw new Error(`${path} is not on ${ctx.branch}`)
  const single = entries.length === 1 && entries[0].name === path
  if (single && existsSync(out)) throw new Error(`${out} exists: pick a new path`)
  if (!single && existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty: pick a new folder`)
  const bodies = new Map(batchObjects(git(['cat-file', '--batch'], { cwd: ctx.repo, input: `${entries.map(e => e.oid).join('\n')}\n`, text: false })).map(o => [o.oid, o.body]))
  for (const { mode, oid, name } of entries) {
    const file = single ? out : join(out, relative(path, name))
    mkdirSync(dirname(file), { recursive: true })
    if (mode === '120000') symlinkSync(bodies.get(oid).toString('utf8'), file)
    else writeFileSync(file, bodies.get(oid))
    if (mode === '100755') chmodSync(file, 0o755)
  }
  return entries.length
}

const COMMANDS = { push: [], restore: ['round'], scan: [], publish: ['branch', 'paths'], fetch: ['branch', 'path', 'out'] }

export function syncOptions(argv) {
  const [command, ...rest] = argv
  const opt = name => rest.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const options = {
    command, branch: opt('branch') ?? RESULTS_BRANCH, round: opt('round') ?? '', path: opt('path') ?? '', out: opt('out') ?? '', rev: opt('rev') ?? 'HEAD',
    only: opt('only')?.split(',').filter(Boolean) ?? [], paths: rest.filter(a => !a.startsWith('--')), redactEmail: rest.includes('--redact-email'),
  }
  const given = name => (name === 'paths' ? options.paths.length > 0 : name === 'branch' ? opt('branch') !== undefined : options[name] !== '')
  if (!Object.hasOwn(COMMANDS, command) || !COMMANDS[command].every(given) || (options.round !== '' && !NAME.test(options.round))) throw new Error(USAGE)
  checkBranch(options.branch)
  return options
}

function main(options) {
  const { command, branch } = options
  const say = value => console.log(`cloud-sync ${command}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  if (command === 'push') say(pushAll({}, { branch, redactEmail: options.redactEmail }))
  else if (command === 'restore') say(restore({ round: options.round }, { branch }))
  else if (command === 'publish') say(publishSets({ paths: options.paths, only: options.only }, { branch }))
  else if (command === 'fetch') say(`${fetchPath({ path: options.path, out: options.out }, { branch })} file(s) written to ${options.out}`)
  else {
    const hits = scanOutgoing({ cwd: REPO, email: accountEmail(), rev: options.rev })
    if (hits.length > 0) throw new EmailFound(hits)
    say(`nothing that a push of ${options.rev} would send holds the account email`)
  }
}

if (isMainModule(import.meta.url)) {
  try {
    main(syncOptions(process.argv.slice(2)))
  } catch (err) {
    console.error(`cloud-sync: ${err.message}`)
    process.exitCode = 1
  }
}
