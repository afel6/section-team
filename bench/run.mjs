// Runs the section-team benchmark: each task × condition × repetition as a fresh headless session of the CLI the
// preflight pinned, in an empty git repo, with the clean run of clean-run.mjs (model, effort, settings, environment).
// Saves claude's stream-json output (raw.json) per run. Resumable: finished runs are skipped.
// A two-stage task (TWO_STAGE_TASKS) gets its second prompt by --resume in the same session once stage 1 ended ok: the run
// keeps raw-s1.json and raw-s2.json, tags the folder stage-1 and stage-2, and copies it to <folder>-s1 after stage 1.
// A task with a folder in bench/seeds/<task>/ starts from that seed, committed as 'seed' after 'init'.
// Team runs get empty section memory: the user's is moved aside for the round (see section-memory.mjs).
// lean and max runs start with .team/mode.json set to their mode (see prepareRun).
// Each attempt is archived, classified and checked as run-attempts.mjs says; evidence is copied into results/<id>/evidence/.
// Usage: node bench/run.mjs --plugin=<absolute path of the worktree at the pinned ref> --tag=mo [--round=mo] [--plugin-ref=<git ref>] --conds=solo,lean,team,max
//          [--tasks=h4,h5,h6] [--reps=3] [--rerun=<id>,... --reason=<fix commit>] [--sync=<branch> [--redact-email] | --no-sync]
//          [id-substring ...]
//        (needs results/preflight-<tag>.json and a clean worktree; --conds runs the setups in the order given; the ref is
//        the pin's, and a --plugin-ref that differs is refused)
//        --sync: after every run that finished or stopped, its results and solution folders are committed to <branch> and
//        pushed (cloud-sync.mjs); required off Windows, where the machine can vanish, unless --no-sync says otherwise.
//        The cloud round passes --redact-email with it, in every run, push and preflight command; the scan stays on.
//        exit 1: harness or evidence error; stop and report, do not resume
//        exit 2: the batch stopped (resume to rerun); exit 3: the round stopped (fix the cause as a harness bug first)
//        node bench/run.mjs --restore-memory [--force]   (after an interrupted round: puts the user's section memory back)
import { spawn as nodeSpawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { MODE_FILE, serializeMode } from '../hooks/lib/mode.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import {
  SECTION_TEAM_VERSION, childEnv, claudeListing, cleanSettings, commonArgs, initOf, installedPluginKeys, outputMessages, pluginVersionOf, readPin, sha256Of,
} from './clean-run.mjs'
import {
  BatchStop, EvidenceMissing, archiveAttempt, baseOf, classifyEnd, copyEvidence, exitCodeOf, finishAttempt, firstLine, nextAttempt, pendingRuns, projectDirFor, recordAttempt, runInitProblems,
} from './run-attempts.mjs'
import { BRANCH, checkBranch } from './cloud-git.mjs'
import { isAbsolutePath, samePath } from './os-paths.mjs'
import { MEMORY_BACKUP, MEMORY_ROOT, backupSectionMemory, renameRetry, required, restoreMessage, restoreSectionMemory, sameVolume, stashRunMemory } from './section-memory.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(BENCH)
// The plugin under test: rounds load it from a worktree checked out at --plugin-ref, by default this tag.
export const DEFAULT_PLUGIN_REF = `v${SECTION_TEAM_VERSION}`
// Benchmark projects live outside this repo, in the user's home folder (forward slashes: run ids are joined with '/').
export const RUNS = join(homedir(), 'bench-runs').replaceAll('\\', '/')
export const RESULTS = join(BENCH, 'results')
export const SEEDS = join(BENCH, 'seeds')
export const TASKS = ['easy', 'medium', 'hard']
// Per stage for a two-stage task.
export const TIMEOUT_MIN = { easy: 25, medium: 45, hard: 100, h1: 100, h2: 60, h3: 45, h4: 120, h5: 60, h6: 60, h7: 120 }
// Tasks whose second prompt (tasks/<task>-s2.md) arrives after the first build. Their hidden tests are hidden/<task>/<set>.test.mjs.
const TWO_STAGE_TASKS = ['h7']
export const isTwoStage = task => TWO_STAGE_TASKS.includes(task)
export const HIDDEN_SETS = ['s1', 's2', 'reg']
const PREFIX = 'AUTOMATED BENCHMARK TASK. No human will answer questions: the requirements below are complete and final, and any plan is approved in advance (OK). Work autonomously from start to finish without asking anything. Do not use the Fable model. Use only Node.js built-ins (no npm install). When you are finished, make sure the project\'s own tests pass, then stop.\n\n'
const ALLOWED = 'Task,Agent,SendMessage,Read,Write,Edit,MultiEdit,Glob,Grep,TodoWrite,Skill,PowerShell,Bash(node *),Bash(npm *),Bash(npx *),Bash(git *),Bash(mkdir *),Bash(ls *),Bash(date *),Bash(cat *),Bash(rm *),Bash(mv *),Bash(cp *),Bash(curl *),Bash(sleep *)'
export { PLUGIN_KEY } from './clean-run.mjs'
const FORCED_SUFFIX = '\n\nUse your section agents for this work: delegate the building to the sections; do not build it yourself.\n'
// team   = plugin on, supervisor decides whether to delegate (Balanced mode: no mode file)
// solo   = plugin off (the old way)
// forced = plugin on, prompt asks the supervisor to delegate to sections
// lean   = team, with the project's mode file set to lean
// max    = team, with the project's mode file set to max
export const CONDITIONS = ['team', 'solo', 'forced', 'lean', 'max']
// The setups of a round without --conds: the three from before the modes, so earlier rounds plan the same runs.
export const DEFAULT_CONDS = ['team', 'solo', 'forced']

// A tag (e.g. "v2") benchmarks a newer plugin version: ids and condition labels get the tag (easy-team-v2-r1, cond team-v2).
// Odd reps run the setups in the order conds gives them, even reps reversed, so no setup always goes first.
// A repeated setup adds no run; an unknown one (a typo in --conds) is refused before any run starts.
export function plan({ tag = '', conds = DEFAULT_CONDS, tasks = TASKS, reps = 2 } = {}) {
  const unknown = conds.find(c => !CONDITIONS.includes(c))
  if (unknown !== undefined) throw new RangeError(`--conds takes ${CONDITIONS.join(', ')}, got "${unknown}"`)
  const setups = [...new Set(conds)]
  return Array.from({ length: reps }, (_, i) => i + 1).flatMap(rep => {
    const order = rep % 2 ? setups : setups.toReversed()
    return tasks.flatMap(task => order.map(base => {
      const cond = tag ? `${base}-${tag}` : base
      return { id: `${task}-${cond}-r${rep}`, task, cond, base, rep }
    }))
  })
}

// Round, tag and task names end up in folder names, some of which get deleted: letters and digits only.
export const NAME = /^[A-Za-z0-9]+$/
// Run ids (task-cond-tag-rN) name results folders too: letters, digits and dashes only.
const RUN_ID = /^[A-Za-z0-9-]+$/

export function parseArgs(argv) {
  const opt = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const reps = opt('reps') ?? '2'
  const pluginRef = opt('plugin-ref')
  if (pluginRef !== undefined && !BRANCH.test(pluginRef)) throw new RangeError(`--plugin-ref takes a branch, tag or commit, got "${pluginRef}"`)
  if (!/^\d+$/.test(reps) || !Number.isSafeInteger(Number(reps)) || Number(reps) < 1) {
    throw new RangeError(`--reps must be a whole number of at least 1, got "${reps}"`)
  }
  const args = {
    tag: opt('tag') ?? '',
    conds: opt('conds')?.split(',') ?? DEFAULT_CONDS,
    round: opt('round') ?? '',
    tasks: opt('tasks')?.split(',') ?? TASKS,
    plugin: opt('plugin') ?? '',
    pluginRef: pluginRef ?? '',
    rerun: opt('rerun')?.split(',') ?? [],
    reason: opt('reason') ?? '',
    sync: opt('sync') ?? '',
    noSync: argv.includes('--no-sync'),
    redactEmail: argv.includes('--redact-email'),
  }
  // An empty round or tag means none; an empty task (--tasks=h1,) or rerun id is an error.
  const named = [['round', args.round], ['tag', args.tag]].filter(([, value]) => value !== '')
  for (const [flag, value] of [...named, ...args.tasks.map(t => ['tasks', t])]) {
    if (!NAME.test(value)) throw new RangeError(`--${flag} takes letters and digits only, got "${value}"`)
  }
  const badRerun = args.rerun.find(id => !RUN_ID.test(id))
  if (badRerun !== undefined) throw new RangeError(`--rerun takes run ids of letters, digits and dashes, got "${badRerun}"`)
  return { ...args, reps: Number(reps), filters: argv.filter(a => !a.startsWith('--')) }
}

// The preflight names the round's pin by --round and the run ids carry --tag: both must name the same round.
export function checkRoundTag({ round, tag }) {
  if (round && tag && round !== tag) throw new RangeError(`--round=${round} and --tag=${tag} must match`)
}

// The branch every finished run is pushed to, or null. Required off Windows (the cloud machine can vanish) unless
// --no-sync; Windows behaves as before without it.
export function syncBranchOf({ sync, noSync }, platform = process.platform) {
  if (sync !== '' && noSync) throw new Error('--sync= and --no-sync contradict each other: pass one')
  if (sync !== '') return checkBranch(sync)
  if (noSync || platform === 'win32') return null
  throw new Error('off Windows a round pushes every finished run: pass --sync=bench/mode-round-cloud-results (or --no-sync to keep results on this machine only)')
}

// One run, then its results and solution folders published (cloud-sync.mjs publishRun) whether it finished or stopped.
// An account-email hit outranks the run's own stop (exit 1: stop and report). A failed push after a finished run
// stops the batch; after a stopped run it is said with log and the run's own stop stands.
export function withPublish(one, publish, { log = console.error } = {}) {
  if (publish === null) return one
  return async (run, outDir) => {
    let failure = null
    try {
      await one(run, outDir)
    } catch (err) {
      failure = err
    }
    if (existsSync(outDir)) {
      try {
        publish(run, outDir)
      } catch (err) {
        if (err.name === 'EmailFound') throw err
        if (failure === null) throw err.name === 'PushFailed' ? new BatchStop(`${run.id}: ${err.message}; resume once the network is back (the resume pushes first)`) : err
        log(`${run.id}: ${err.message}`)
      }
    }
    if (failure !== null) throw failure
  }
}

// One git command's trimmed output, run from the repo root; a failure is one line naming the command.
function gitLine(args) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    const why = String(err.stderr ?? '').split('\n')[0].trim() || err.code || `exit ${err.status}`
    throw new Error(`git ${args.join(' ')} failed: ${why}`, { cause: err })
  }
}

// Rounds load the plugin from a worktree at one ref, never the live checkout: --plugin= must be its absolute path, at
// that ref's commit. Returns that commit, which every run records. name is what the messages call ref.
export function pluginCommitOf(plugin, { ref = DEFAULT_PLUGIN_REF, name = ref, git = gitLine } = {}) {
  // Windows paths on Windows (and drive-letter paths anywhere); POSIX paths on Linux (os-paths.mjs).
  if (!isAbsolutePath(plugin)) throw new Error(`--plugin= takes the absolute path of the ${name} worktree, got "${plugin}"`)
  const commit = git(['-C', plugin, 'rev-parse', 'HEAD'])
  const wanted = git(['rev-parse', `${ref}^{commit}`])
  if (commit !== wanted) throw new Error(`${plugin} is at ${commit}, not at ${name} (${wanted})`)
  return commit
}

// Before each batch the worktree is clean and matches the ref, and --plugin= is its root folder, not a subfolder. The
// worktree holds the plugin and this checkout runs the harness: with a branch ref they could otherwise be the same folder.
export function checkPluginWorktree(plugin, { ref = DEFAULT_PLUGIN_REF, name = ref, git = gitLine } = {}) {
  if (samePath(plugin, REPO)) throw new Error(`--plugin= must be a worktree of ${name} apart from this checkout, which runs the harness: got ${plugin}`)
  const top = git(['-C', plugin, 'rev-parse', '--show-toplevel'])
  if (!samePath(top, plugin)) throw new Error(`--plugin= must be the worktree's root folder ${top}, got ${plugin}`)
  if (git(['-C', plugin, 'status', '--porcelain']) !== '') throw new Error(`${plugin} has uncommitted changes: a batch needs a clean ${name} worktree`)
  if (git(['-C', plugin, 'diff', '--stat', ref]) !== '') throw new Error(`${plugin} differs from ${name}: a batch needs a clean ${name} worktree`)
}

// The batch runs what the preflight pinned: the plugin worktree it recorded and the binary bytes it hashed. A copy is
// put back by hand; an installed pin (npmPackage, the cloud machine) by installing its package again.
export function checkPin(plugin, pin) {
  if (!samePath(plugin, String(pin.pluginDir))) {
    throw new Error(`--plugin=${plugin} is not the worktree the round pinned: pass --plugin=${pin.pluginDir}`)
  }
  const fix = pin.npmPackage
    ? `install it again with npm i -g ${pin.npmPackage} (node bench/cloud-sync.mjs restore does); never re-pin a started round`
    : 'put the pinned copy back; never re-pin a started round'
  if (pin.npmPackage && !existsSync(pin.binary)) throw new Error(`${pin.binary} is missing: ${fix}`)
  if (sha256Of(pin.binary) !== pin.sha256) throw new Error(`${pin.binary} differs from the binary the round pinned: ${fix}`)
}

// What a batch's worktree must match: ref is the commit its pin recorded, so a branch that moves after the preflight stops
// nothing, and name the pin's ref, which is what the user passed; a pin from before --plugin-ref has only the default tag.
// A --plugin-ref that is not the pin's stops the batch.
export function pinnedTarget(pin, passed = '') {
  const name = pin.pluginRef ?? DEFAULT_PLUGIN_REF
  if (passed !== '' && passed !== name) throw new Error(`--plugin-ref=${passed} is not the ref the round pinned: pass --plugin-ref=${name} or leave it out`)
  return { ref: pin.pluginCommit ?? name, name }
}

// A batch's checks of the plugin under test, before any paid run, and what its runs need from them.
export function batchPlugin(plugin, pin, passedRef, { git = gitLine, readVersion = pluginVersionOf } = {}) {
  const { ref, name } = pinnedTarget(pin, passedRef)
  const pluginCommit = pluginCommitOf(plugin, { ref, name, git })
  checkPluginWorktree(plugin, { ref, name: `${name} (${pluginCommit})`, git })
  checkPin(plugin, pin)
  return { pluginCommit, pluginVersion: readVersion(plugin) }
}

// ~/.claude/skills and ~/.claude/agents (synced/ left out), like the preflight's syncedListing: the user's own skills
// and agents, which every init lists.
export const userListing = home => claudeListing(home, ['skills', 'agents'], path => path.split('/')[0] === 'synced')

// One line naming the changed top-level entries (skills/<name>, agents/<name>) of a list of paths, sorted, at most
// SHOWN of them and a count of the rest.
const SHOWN = 5
function changedEntriesLine(paths) {
  const entries = [...new Set(paths.map(path => path.split('/').slice(0, 2).join('/')))].sort()
  const rest = entries.length - SHOWN
  return `${entries.slice(0, SHOWN).join(', ')}${rest > 0 ? ` … and ${rest} more` : ''}`
}

// One run of the batch with the user's skills and agents checked against the batch start, before and after it: a
// change stops the batch naming the run and the entries, before another paid run starts on a setup unlike the pin.
// A run that stops on its own keeps its stop (and exit code); a change it made, or a failure to list, is said with log.
export function watchUserLists(one, { home = homedir(), log = console.error } = {}) {
  const start = new Set(userListing(home))
  const changeLine = (run, when) => {
    const now = new Set(userListing(home))
    const added = [...now].filter(path => !start.has(path))
    const removed = [...start].filter(path => !now.has(path))
    if (added.length + removed.length === 0) return null
    const changes = [added.length && `added ${changedEntriesLine(added)}`, removed.length && `removed ${changedEntriesLine(removed)}`]
      .filter(Boolean).join('; ')
    return `${run.id}: ~/.claude skills or agents changed ${when} the run (${changes}); put them back as the batch found them, then resume`
  }
  const check = (run, when) => {
    const line = changeLine(run, when)
    if (line !== null) throw new BatchStop(line)
  }
  return async (run, outDir) => {
    check(run, 'before')
    try {
      await one(run, outDir)
    } catch (err) {
      try {
        const line = changeLine(run, 'during')
        if (line !== null) log(line)
      } catch (listErr) {
        log(`${run.id}: could not list ~/.claude skills or agents after the run (${listErr.code ?? listErr.message})`)
      }
      throw err
    }
    check(run, 'during')
  }
}

// initProblems judges these setups only, so a round runs no other (forced included); the preflight checks each.
export const ROUND_CONDS = ['solo', 'lean', 'team', 'max']
export function checkConds(conds) {
  const other = conds.find(cond => !ROUND_CONDS.includes(cond))
  if (other !== undefined) throw new RangeError(`a round runs solo, lean, team and max only, got "${other}": pass --conds=${ROUND_CONDS.join(',')}`)
}

const taskFiles = task => (isTwoStage(task)
  ? [`tasks/${task}.md`, `tasks/${task}-s2.md`, ...HIDDEN_SETS.map(set => `hidden/${task}/${set}.test.mjs`)]
  : [`tasks/${task}.md`, `hidden/${task}.test.mjs`])

// Every task that cannot run: a missing prompt, missing hidden tests or no timeout. Empty when all are fine.
export function taskProblems(tasks, bench = BENCH) {
  return tasks.flatMap(t => {
    const missing = taskFiles(t).filter(f => !existsSync(join(bench, f))).map(f => `bench/${f}`)
    if (!Object.hasOwn(TIMEOUT_MIN, t)) missing.push('a timeout in TIMEOUT_MIN')
    return missing.length ? [`${t}: missing ${missing.join(', ')}`] : []
  })
}

// Who commits in a run folder: the solution's git may have no identity of its own.
const GIT_IDENTITY = ['-c', 'user.email=bench@local', '-c', 'user.name=bench']

// Wipes dir (it must sit inside root, never root itself) and makes a git repo with an 'init' commit;
// with a seed folder, copies it in and commits it as 'seed', so a run's own changes are a diff from that commit.
export function freshRepo(dir, { seed = null, root } = {}) {
  required({ root })
  const rel = relative(resolve(root), resolve(dir))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`refusing to touch ${dir}: not inside ${root}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  const commit = msg => git(...GIT_IDENTITY, 'commit', '-q', '-m', msg)
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), '# bench project\n')
  git('add', 'README.md')
  commit('init')
  if (!seed) return
  cpSync(seed, dir, { recursive: true })
  git('add', '-A')
  commit('seed')
}

// The --settings env value alone does not reach the plugin's hooks when the shell already sets the variable
// (preflight, 2026-10-30), so builder runs get the round's switches in their process environment too.
export const builderEnv = (env, { pluginDir }) => childEnv(env, { pluginDir })

// stream-json writes the init as raw.json's first line, so a run killed at its time limit keeps it. Every setup
// loads plugins from the worktree; only solo turns section-team off.
export function builderArgs(base, prompt, { sessionId, resume = false, installedKeys, pluginDir }) {
  const settings = cleanSettings({ installedKeys, sectionTeam: base !== 'solo', pluginDir })
  return ['-p', prompt, '--output-format', 'stream-json', '--allowedTools', ALLOWED, ...commonArgs({ sessionId, resume }), '--settings', JSON.stringify(settings)]
}

// <RUNS>/<task>-<8 hex of the id's hash>: the setup never shows in the folder name, so it cannot end up in a
// package name or README the judges read. Stable, so a rerun reuses the folder.
export const runFolder = run => `${RUNS}/${run.task}-${createHash('sha256').update(run.id).digest('hex').slice(0, 8)}`

// The mode file a setup's run folder starts with; team runs Balanced with no file, as before the modes.
export const modeFileFor = base => (base === 'lean' || base === 'max' ? `${serializeMode(null, base)}\n` : null)

// A fresh run folder (see freshRepo) with the setup's mode file, left uncommitted as when a user picks a mode.
export function prepareRun(run, { dir, root, seeds = SEEDS } = {}) {
  required({ dir, root })
  const seed = join(seeds, run.task)
  freshRepo(dir, { seed: existsSync(seed) ? seed : null, root })
  const modeFile = modeFileFor(baseOf(run))
  if (modeFile !== null) {
    const file = join(dir, MODE_FILE)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, modeFile)
  }
  return dir
}

// The claude process of the run in progress and the kill its run was given, so an exit can stop it before section
// memory is put back. A test's fake child is only ever stopped by its test's own kill.
let activeChild = null
const stopActiveChild = () => { if (activeChild) activeChild.kill(activeChild.child) }
// Every process in /proc: { pid, ppid, pgrp }. The fields after the last ')' of stat are state, ppid and pgrp (a
// command name may hold spaces and parentheses). A process that ends while it is read is skipped.
export function procTable(proc = '/proc') {
  return readdirSync(proc).filter(name => /^\d+$/.test(name)).flatMap(name => {
    try {
      const stat = readFileSync(join(proc, name, 'stat'), 'utf8')
      const [, ppid, pgrp] = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
      return [{ pid: Number(name), ppid: Number(ppid), pgrp: Number(pgrp) }]
    } catch {
      return []
    }
  })
}

// pid and every process below it, parents first.
function treeOf(pid, table) {
  const tree = table.filter(p => p.pid === pid)
  for (let i = 0; i < tree.length; i++) tree.push(...table.filter(p => p.ppid === tree[i].pid))
  return tree
}

// Linux: claude's Bash tool and hooks start shells in process groups of their own, so a group kill alone misses them.
// Every process below claude is stopped first (none can start more, or be orphaned when its parent dies), looking again
// until no new one turns up; then every group found but the harness's own, and every process, gets SIGKILL.
function killLinuxTree(pid, { kill, table, self, fail }) {
  const signal = (target, name) => {
    try {
      kill(target, name)
    } catch (err) {
      if (err.code !== 'ESRCH') fail(err)
    }
  }
  const first = table()
  const own = first.find(p => p.pid === self)?.pgrp
  const stopped = new Map()
  for (let snapshot = first, pass = 0; pass < 10; snapshot = table(), pass++) {
    const fresh = treeOf(pid, snapshot).filter(p => !stopped.has(p.pid))
    if (fresh.length === 0) break
    for (const p of fresh) {
      stopped.set(p.pid, p)
      signal(p.pid, 'SIGSTOP')
    }
  }
  for (const group of new Set([...stopped.values()].map(p => p.pgrp).filter(g => g !== own))) signal(-group, 'SIGKILL')
  for (const p of stopped.values()) signal(p.pid, 'SIGKILL')
}

// taskkill exits 128 when the process is already gone; any other failure is said (once), since a live claude could
// still write while section memory is put back. Linux has no taskkill: killLinuxTree stops the tree, as /T /F does.
export function killTree(child, { execFile = execFileSync, kill = process.kill, platform = process.platform, table = procTable, self = process.pid, log = console.error } = {}) {
  let failure = null
  const fail = err => { failure ??= err }
  if (platform === 'win32') {
    try {
      execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch (err) {
      if (err.status !== 128) fail(err)
    }
  } else killLinuxTree(child.pid, { kill, table, self, fail })
  if (failure !== null) log(`could not stop claude (pid ${child.pid}): ${failure.message}`)
}

// How a builder's claude starts: in the harness's process group, as before the cloud port, so Ctrl+C, a closed
// terminal or a stopped background job reaches it too, even when the harness is killed outright.
export const spawnOptions = (cwd, env) => ({ cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

// Where a stage's output goes; a single-stage run (stage null) writes raw.json and stderr.txt.
const rawFile = stage => (stage === null ? 'raw.json' : `raw-s${stage}.json`)
const stderrFile = stage => (stage === null ? 'stderr.txt' : `stderr-s${stage}.txt`)
export const promptFile = (task, stage) => (stage === 2 ? `${task}-s2.md` : `${task}.md`)

// Starts the pinned binary (ctx.pin.binary), never `claude` from PATH, so the user's own CLI can keep updating.
// Resolves once the output files are flushed, so the caller can read them. At timeoutMs it kills the child.
function runClaude(run, dir, outDir, ctx, { sessionId, env, spawn, kill, timeoutMs, stage = null }) {
  const base = baseOf(run)
  const prompt = PREFIX + readFileSync(join(BENCH, 'tasks', promptFile(run.task, stage)), 'utf8') + (base === 'forced' ? FORCED_SUFFIX : '')
  const { binary } = ctx.pin
  const args = builderArgs(base, prompt, { sessionId, resume: stage === 2, installedKeys: ctx.installedKeys, pluginDir: ctx.pluginDir })
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(binary, args, spawnOptions(dir, env))
    activeChild = { child, kill }
    const outFile = createWriteStream(join(outDir, rawFile(stage)))
    const errorFile = createWriteStream(join(outDir, stderrFile(stage)))
    child.stdout.pipe(outFile)
    child.stderr.pipe(errorFile)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      kill(child)
    }, timeoutMs)
    const finish = () => {
      activeChild = null
      clearTimeout(timer)
      outFile.end()
      errorFile.end()
    }
    // The pinned binary missing: stop the round with one line (main's catch); the finally still restores memory. The
    // rejection waits until the output files are closed, so nothing that runs next races a stream still opening.
    child.on('error', spawnErr => {
      finish()
      const failed = new Error(`could not start claude (${binary}: ${spawnErr.code ?? spawnErr.message})`)
      Promise.all([finished(outFile), finished(errorFile)]).then(() => reject(failed), () => reject(failed))
    })
    child.on('close', code => {
      finish()
      const info = { exitCode: code, timedOut, wallMs: Date.now() - started, startedAt: new Date(started).toISOString() }
      Promise.all([finished(outFile), finished(errorFile)]).then(() => resolve(info), reject)
    })
  })
}

// Missing required evidence stays an exit-1 stop (no void, no cap): the init's problems go into the message for
// diagnosis, and attempts.json lists the attempt, so the rerun shows between batches.
function withInitProblems(err, { run, outDir, sessionId, attempt, messages, ctx }) {
  const reasons = runInitProblems(messages, run, ctx)
  recordAttempt(outDir, { kind: 'evidence-missing', attempt, sessionId, at: new Date().toISOString(), path: err.path, reasons })
  return new EvidenceMissing(`${err.message}; init problems: ${reasons.join('; ') || 'none'}`, err.path)
}

// Everything the run left (ignored files aside) committed and tagged, so what a stage changed is a diff between tags.
// A hook the solution installed must not stop the harness.
export function tagStage(dir, tag) {
  const git = (...args) => execFileSync('git', ['-C', dir, ...GIT_IDENTITY, '-c', 'core.hooksPath=/dev/null', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  git('add', '-A')
  git('commit', '-q', '--allow-empty', '-m', tag)
  git('tag', '-f', tag)
}

// The tags only serve stage 2's change measure (score.mjs stageChange reads a missing tag as not measured), so a failure,
// such as a lock a killed git left behind, is said and never costs the paid run.
function tagOrSay(dir, tag) {
  try {
    tagStage(dir, tag)
  } catch (err) {
    console.error(`could not tag ${tag} in ${dir}: ${firstLine(err.stderr ?? err.message)}; stage 2's change will not be measured`)
  }
}

// Where the copy of a run's folder after stage 1 goes: beside it, so the code runs from the same kind of place.
const stageCopyOf = dir => `${dir}-s1`
const readMessages = (outDir, stage) => outputMessages(readFileSync(join(outDir, rawFile(stage)), 'utf8'))

// The folder as stage 1 left it, for the s1 set. A failed copy stops the run before stage 2 is paid for: a harness error,
// said in one line naming the run and the step, and listed in attempts.json.
function copyStageOne({ run, dir, outDir, sessionId, attempt }) {
  try {
    cpSync(dir, stageCopyOf(dir), { recursive: true })
  } catch (err) {
    const reason = `could not copy ${dir} after stage 1 (${err.code ?? firstLine(err.message)})`
    recordAttempt(outDir, { kind: 'stage-copy-failed', attempt, sessionId, at: new Date().toISOString(), reason })
    throw new Error(`${run.id}: ${reason}`, { cause: err })
  }
}

// One stage of a single-stage task.
async function singleStage(claude, outDir) {
  const info = await claude(null)
  return { info, messages: readMessages(outDir, null), extraReasons: [] }
}

// Both stages of a two-stage task. Stage 2 starts only after a stage 1 that ended ok with a good init: anything else is
// scored as it ended, and a void or stopped run spends no more. What finishAttempt judges is the last stage that ran
// (stage 1's result must not stand in for a stage 2 that wrote none). The hidden sets s2 and reg then fail for a run
// that never reached stage 2.
async function twoStages(claude, { run, outDir, dir, sessionId, attempt, ctx }) {
  const first = await claude(1)
  const firstMessages = readMessages(outDir, 1)
  const firstEnd = classifyEnd({ messages: firstMessages, timedOut: first.timedOut, exitCode: first.exitCode })
  const stageOne = { stage: 1, ...first, end: firstEnd }
  const good = firstEnd === 'ok' && runInitProblems(firstMessages, run, ctx).length === 0
  if (!good) return { info: { ...first, stages: [stageOne], snapshot: null }, messages: firstMessages, extraReasons: [] }
  tagOrSay(dir, 'stage-1')
  copyStageOne({ run, dir, outDir, sessionId, attempt })
  const second = await claude(2)
  tagOrSay(dir, 'stage-2')
  const messages = readMessages(outDir, 2)
  const stageTwo = { stage: 2, ...second, end: classifyEnd({ messages, timedOut: second.timedOut, exitCode: second.exitCode }) }
  const resumedAs = initOf(messages)?.session_id
  return {
    info: { ...second, wallMs: first.wallMs + second.wallMs, startedAt: first.startedAt, stages: [stageOne, stageTwo], snapshot: stageCopyOf(dir) },
    messages,
    extraReasons: resumedAs === undefined || resumedAs === sessionId ? [] : [`stage 2 ran as session ${resumedAs}, not ${sessionId}`],
  }
}

// One attempt of a run: archive the earlier one, a fresh session id, the run, its evidence, then run.json or a stop.
// ctx = { pin, installedKeys, pluginDir, pluginVersion, pluginCommit }, built once per batch by main; deps let tests replace the
// spawn, the kill and the time limit. deps also name what a run moves or wipes (realRunDeps for a real batch), with no default.
export async function runOne(run, outDir, ctx, deps = {}) {
  const { spawn = nodeSpawn, kill = killTree, timeoutMs = TIMEOUT_MIN[run.task] * 60_000, home, dir, root, stash } = deps
  required({ home, dir, root, stash })
  archiveAttempt(outDir, projectDirFor(dir, home))
  mkdirSync(outDir, { recursive: true })
  const sessionId = randomUUID()
  const attempt = nextAttempt(outDir)
  // The earlier attempt's solution folder is kept beside the new one (a harness-bug rerun replaces a counted run).
  // Renamed before session.json is written, so a failed rename leaves outDir as it was and a resume reuses the number.
  if (existsSync(dir)) renameRetry(dir, `${dir}-attempt-${attempt - 1}`)
  if (existsSync(stageCopyOf(dir))) renameRetry(stageCopyOf(dir), `${stageCopyOf(dir)}-attempt-${attempt - 1}`)
  writeFileSync(join(outDir, 'session.json'), `${JSON.stringify({ sessionId, attempt }, null, 2)}\n`)
  prepareRun(run, { dir, root })
  const env = builderEnv(process.env, { pluginDir: ctx.pluginDir })
  console.log(`${new Date().toISOString()} start ${run.id} attempt ${attempt}`)
  const claude = stage => runClaude(run, dir, outDir, ctx, { sessionId, env, spawn, kill, timeoutMs, stage })
  const { info, messages, extraReasons } = isTwoStage(run.task) ? await twoStages(claude, { run, outDir, dir, sessionId, attempt, ctx }) : await singleStage(claude, outDir)
  // Section memory the run wrote is filed with its results before the run counts as done, so the next team run starts empty.
  if (baseOf(run) !== 'solo') stash({ into: outDir })
  const ended = classifyEnd({ messages, timedOut: info.timedOut, exitCode: info.exitCode })
  const bestEffort = ended === 'api-limit' || ended === 'api-other'
  let copied
  try {
    copied = copyEvidence({ runDir: dir, sessionId, outDir, base: baseOf(run), home, bestEffort })
  } catch (err) {
    throw err instanceof EvidenceMissing ? withInitProblems(err, { run, outDir, sessionId, attempt, messages, ctx }) : err
  }
  const evidenceTexts = copied.filter(file => file.endsWith('.jsonl')).map(file => readFileSync(file, 'utf8'))
  const { kind } = finishAttempt({ run, outDir, dir, sessionId, attempt, info, messages, ctx, evidenceTexts, extraReasons, env })
  console.log(`${new Date().toISOString()} end   ${run.id} ${kind} exit=${info.exitCode} wall=${Math.round(info.wallMs / 1000)}s`)
}

const nearestExisting = path => (existsSync(path) || dirname(path) === path ? path : nearestExisting(dirname(path)))

// Section memory moves between MEMORY_ROOT, the backup in home and RESULTS: renames need one volume. MEMORY_ROOT
// may not exist yet (no section has saved a note), so its nearest existing parent stands in for it.
export function checkVolumes({ root = MEMORY_ROOT, others = [homedir(), RESULTS] } = {}) {
  const memory = nearestExisting(root)
  for (const dir of others) {
    if (!sameVolume(memory, nearestExisting(dir))) throw new Error(`${root} and ${dir} are on different drives, so section memory cannot be moved between them`)
  }
}

// The real folders. Only main reaches these; everything exported takes its folders from its caller.
const REAL_MEMORY = { root: MEMORY_ROOT, backup: MEMORY_BACKUP }
const realRunDeps = run => ({ home: homedir(), dir: runFolder(run), root: RUNS, stash: args => stashRunMemory({ ...args, root: MEMORY_ROOT }) })

function restoreMemory({ force = false } = {}) {
  checkVolumes()
  const leftovers = join(RESULTS, `section-memory-leftover-${Date.now()}`)
  console.log(restoreMessage(restoreSectionMemory({ ...REAL_MEMORY, leftovers, force }), leftovers))
}

const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }

// Moves the user's section memory aside for the round (see section-memory.mjs) and returns the function that
// moves it back. Ctrl+C, a closed console, a kill or a crash skip `finally`; they all end in process exit, whose
// handler stops the run in progress and then puts the memory back. It runs at most once.
export function isolateSectionMemory({ volumes = checkVolumes, backup, restore, stop = stopActiveChild } = {}) {
  required({ backup, restore })
  volumes()
  console.log(`section memory moved aside: ${backup().join(' ') || '(none)'}`)
  let released = false
  const putBack = () => {
    if (released) return
    released = true
    stop()
    try {
      restore()
    } catch (err) {
      console.error(`could not restore your section memory: ${err.message}; run node bench/run.mjs --restore-memory`)
      process.exitCode = 1
    }
  }
  const onSignal = signal => process.exit(128 + SIGNAL_NUMBERS[signal])
  process.on('exit', putBack)
  for (const signal of Object.keys(SIGNAL_NUMBERS)) process.once(signal, onSignal)
  return () => {
    for (const signal of Object.keys(SIGNAL_NUMBERS)) process.off(signal, onSignal)
    process.off('exit', putBack)
    putBack()
  }
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--restore-memory')) return restoreMemory({ force: argv.includes('--force') })
  const { tag, round, conds, tasks, reps, filters, plugin, pluginRef, rerun, reason, sync, noSync, redactEmail } = parseArgs(argv)
  checkRoundTag({ round, tag })
  const syncBranch = syncBranchOf({ sync, noSync })
  // Every run reads its round's pin by the tag, so a run without one cannot start.
  if (tag === '') throw new Error('--tag= names the round and its preflight pin, e.g. --tag=mo')
  checkConds(conds)
  const problems = taskProblems(tasks)
  if (problems.length) throw new Error(`cannot run these tasks: ${problems.join('; ')}`)
  const pin = readPin(RESULTS, tag)
  const ctx = { pin, installedKeys: installedPluginKeys(), pluginDir: plugin, ...batchPlugin(plugin, pin, pluginRef) }
  const runs = plan({ tag, conds, tasks, reps }).filter(r => filters.length === 0 || filters.some(f => r.id.includes(f)))
  mkdirSync(RESULTS, { recursive: true })
  const todo = pendingRuns(runs, { results: RESULTS, rerun, reason, at: new Date().toISOString() })
  for (const run of runs.filter(r => !todo.includes(r))) console.log(`skip ${run.id} (done)`)
  const publish = syncBranch === null ? null : await publisher({ runs, tag, options: { branch: syncBranch, redactEmail } })
  const isolate = () => isolateSectionMemory({ backup: () => backupSectionMemory(REAL_MEMORY), restore: restoreMemory })
  await runAll(todo, { isolate, runOne: watchUserLists(withPublish((r, o) => runOne(r, o, ctx, realRunDeps(r)), publish)) })
  console.log('all runs finished')
}

// Before any paid run of a syncing batch: the email variable and the remote are checked, then every run of the batch
// that has results (a publish that failed earlier, a --rerun entry, a run a lost machine left) and the round's pin
// are sent again; unchanged ones add no commit. A network failure stops the batch (resume); anything else exits 1.
export function publishAtStart({ runs, results = RESULTS, tag, options, log = console.log }, sync) {
  try {
    sync.syncReady(options)
    sync.pushPending?.(options)
    const sent = runs.filter(run => existsSync(join(results, run.id)))
      .filter(run => sync.publishRun({ id: run.id, outDir: join(results, run.id), runDir: runFolder(run) }, options).pushed).length
    const pin = join(results, `preflight-${tag}.json`)
    const pinSent = existsSync(pin) && sync.publishItems({ items: [{ from: pin, to: `results/${basename(pin)}` }], message: `chore(results): pin round ${tag}` }, options).pushed
    if (sent > 0 || pinSent) log(`pushed earlier results to ${options.branch}: ${sent} run(s)${pinSent ? ' and the pin' : ''}`)
  } catch (err) {
    throw err.name === 'PushFailed' ? new BatchStop(`${err.message}; resume once the network is back`) : err
  }
}

// cloud-sync.mjs imports this module, so it is loaded only when a batch syncs.
async function publisher({ runs, tag, options }) {
  const sync = await import('./cloud-sync.mjs')
  const real = { ...sync.REAL_SYNC, ...options }
  publishAtStart({ runs, tag, options: real }, sync)
  return (run, outDir) => {
    const { pushed } = sync.publishRun({ id: run.id, outDir, runDir: runFolder(run) }, real)
    if (pushed) console.log(`${new Date().toISOString()} pushed ${run.id} to ${options.branch}`)
  }
}

// Runs each run in order. The user's section memory stays out of every team run: it is moved aside only when a
// run other than solo is left, and moved back even when a run throws. runOne is required: main binds it to the
// batch's ctx, and a default without ctx could only crash mid-batch.
export async function runAll(todo, { runOne: one, isolate } = {}) {
  if (typeof one !== 'function') throw new TypeError('runAll needs a runOne bound to the batch context')
  required({ isolate })
  const release = todo.some(run => baseOf(run) !== 'solo') ? isolate() : () => {}
  try {
    for (const run of todo) await one(run, join(RESULTS, run.id))
  } finally {
    release()
  }
}

// A stop prints its one-line reason and exits 2 (batch) or 3 (round); any other error exits 1.
if (isMainModule(import.meta.url)) main().catch(err => { console.error(err.message); process.exitCode = exitCodeOf(err) })
