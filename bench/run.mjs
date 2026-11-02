// Runs the section-team benchmark: each task × condition × repetition as a fresh headless session of the CLI the
// preflight pinned, in an empty git repo, with the clean run of clean-run.mjs (model, effort, settings, environment).
// Saves claude's stream-json output (raw.json) per run. Resumable: finished runs are skipped.
// A task with a folder in bench/seeds/<task>/ starts from that seed, committed as 'seed' after 'init'.
// Team runs get empty section memory: the user's is moved aside for the round (see section-memory.mjs).
// lean and max runs start with .team/mode.json set to their mode (see prepareRun).
// Each attempt is archived, classified and checked as run-attempts.mjs says; evidence is copied into results/<id>/evidence/.
// Usage: node bench/run.mjs --plugin=<absolute path of the v0.2.1 worktree> --tag=mo [--round=mo] --conds=solo,lean,team,max
//          [--tasks=h4,h5,h6] [--reps=3] [--rerun=<id>,... --reason=<fix commit>] [id-substring ...]
//        (needs results/preflight-<tag>.json and a clean worktree; --conds runs the setups in the order given)
//        exit 2: the batch stopped (resume to rerun); exit 3: the round stopped (fix the cause as a harness bug first)
//        node bench/run.mjs --restore-memory [--force]   (after an interrupted round: puts the user's section memory back)
import { spawn as nodeSpawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path'
import { finished } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { MODE_FILE, serializeMode } from '../hooks/lib/mode.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { SECTION_TEAM_VERSION, childEnv, cleanSettings, commonArgs, installedPluginKeys, outputMessages, readPin } from './clean-run.mjs'
import { archiveAttempt, baseOf, classifyEnd, copyEvidence, exitCodeOf, finishAttempt, nextAttempt, pendingRuns, projectDirFor } from './run-attempts.mjs'
import { MEMORY_ROOT, backupSectionMemory, restoreMessage, restoreSectionMemory, sameVolume, stashRunMemory } from './section-memory.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
const REPO = dirname(BENCH)
// The plugin under test: rounds load it from a worktree checked out at this tag.
const PLUGIN_TAG = `v${SECTION_TEAM_VERSION}`
// Benchmark projects live outside this repo, in the user's home folder (forward slashes: run ids are joined with '/').
export const RUNS = join(homedir(), 'bench-runs').replaceAll('\\', '/')
export const RESULTS = join(BENCH, 'results')
export const SEEDS = join(BENCH, 'seeds')
export const TASKS = ['easy', 'medium', 'hard']
export const TIMEOUT_MIN = { easy: 25, medium: 45, hard: 100, h1: 100, h2: 60, h3: 45, h4: 120, h5: 60, h6: 60 }
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
  if (!/^\d+$/.test(reps) || !Number.isSafeInteger(Number(reps)) || Number(reps) < 1) {
    throw new RangeError(`--reps must be a whole number of at least 1, got "${reps}"`)
  }
  const args = {
    tag: opt('tag') ?? '',
    conds: opt('conds')?.split(',') ?? DEFAULT_CONDS,
    round: opt('round') ?? '',
    tasks: opt('tasks')?.split(',') ?? TASKS,
    plugin: opt('plugin') ?? '',
    rerun: opt('rerun')?.split(',') ?? [],
    reason: opt('reason') ?? '',
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

// One git command's trimmed output, run from the repo root; a failure is one line naming the command.
function gitLine(args) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch (err) {
    const why = String(err.stderr ?? '').split('\n')[0].trim() || err.code || `exit ${err.status}`
    throw new Error(`git ${args.join(' ')} failed: ${why}`, { cause: err })
  }
}

// Rounds load the plugin from a worktree of PLUGIN_TAG, never the live checkout: --plugin= must be its absolute path,
// at the tagged commit. Returns that commit, which every run records.
export function pluginCommitOf(plugin, { git = gitLine } = {}) {
  // Plugin paths are Windows paths, so path.win32 checks them the same way on any OS.
  if (typeof plugin !== 'string' || !win32.isAbsolute(plugin)) throw new Error(`--plugin= takes the absolute path of the ${PLUGIN_TAG} worktree, got "${plugin}"`)
  const commit = git(['-C', plugin, 'rev-parse', 'HEAD'])
  const tagged = git(['rev-parse', `${PLUGIN_TAG}^{commit}`])
  if (commit !== tagged) throw new Error(`${plugin} is at ${commit}, not at ${PLUGIN_TAG} (${tagged})`)
  return commit
}

// Before each batch the worktree is clean and matches PLUGIN_TAG, and --plugin= is its root folder, not a subfolder.
export function checkPluginWorktree(plugin, { git = gitLine } = {}) {
  const top = git(['-C', plugin, 'rev-parse', '--show-toplevel'])
  if (win32.resolve(top).toLowerCase() !== win32.resolve(plugin).toLowerCase()) throw new Error(`--plugin= must be the worktree's root folder ${top}, got ${plugin}`)
  if (git(['-C', plugin, 'status', '--porcelain']) !== '') throw new Error(`${plugin} has uncommitted changes: a batch needs a clean ${PLUGIN_TAG} worktree`)
  if (git(['-C', plugin, 'diff', '--stat', PLUGIN_TAG]) !== '') throw new Error(`${plugin} differs from ${PLUGIN_TAG}: a batch needs a clean ${PLUGIN_TAG} worktree`)
}

// initProblems judges these setups only, so a round runs no other (forced included); the preflight checks each.
export const ROUND_CONDS = ['solo', 'lean', 'team', 'max']
export function checkConds(conds) {
  const other = conds.find(cond => !ROUND_CONDS.includes(cond))
  if (other !== undefined) throw new RangeError(`a round runs solo, lean, team and max only, got "${other}": pass --conds=${ROUND_CONDS.join(',')}`)
}

// Every task that cannot run: a missing prompt, missing hidden tests or no timeout. Empty when all are fine.
export function taskProblems(tasks, bench = BENCH) {
  return tasks.flatMap(t => {
    const missing = [`tasks/${t}.md`, `hidden/${t}.test.mjs`].filter(f => !existsSync(join(bench, f))).map(f => `bench/${f}`)
    if (!Object.hasOwn(TIMEOUT_MIN, t)) missing.push('a timeout in TIMEOUT_MIN')
    return missing.length ? [`${t}: missing ${missing.join(', ')}`] : []
  })
}

// Wipes dir (it must sit inside root, never root itself) and makes a git repo with an 'init' commit;
// with a seed folder, copies it in and commits it as 'seed', so a run's own changes are a diff from that commit.
export function freshRepo(dir, { seed = null, root = RUNS } = {}) {
  const rel = relative(resolve(root), resolve(dir))
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`refusing to touch ${dir}: not inside ${root}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  const commit = msg => git('-c', 'user.email=bench@local', '-c', 'user.name=bench', 'commit', '-q', '-m', msg)
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
export function builderArgs(base, prompt, { sessionId, installedKeys, pluginDir }) {
  const settings = cleanSettings({ installedKeys, sectionTeam: base !== 'solo', pluginDir })
  return ['-p', prompt, '--output-format', 'stream-json', '--allowedTools', ALLOWED, ...commonArgs({ sessionId }), '--settings', JSON.stringify(settings)]
}

// <RUNS>/<task>-<8 hex of the id's hash>: the setup never shows in the folder name, so it cannot end up in a
// package name or README the judges read. Stable, so a rerun reuses the folder.
export const runFolder = run => `${RUNS}/${run.task}-${createHash('sha256').update(run.id).digest('hex').slice(0, 8)}`

// The mode file a setup's run folder starts with; team runs Balanced with no file, as before the modes.
export const modeFileFor = base => (base === 'lean' || base === 'max' ? `${serializeMode(null, base)}\n` : null)

// A fresh run folder (see freshRepo) with the setup's mode file, left uncommitted as when a user picks a mode.
export function prepareRun(run, { dir = runFolder(run), root = RUNS, seeds = SEEDS } = {}) {
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
// taskkill exits 128 when the process is already gone; any other failure is said, since a live claude could still
// write while section memory is put back.
export function killTree(child, { execFile = execFileSync, log = console.error } = {}) {
  try {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch (err) {
    if (err.status !== 128) log(`could not stop claude (pid ${child.pid}): ${err.message}`)
  }
}

// Starts the pinned binary (ctx.pin.binary), never `claude` from PATH, so the user's own CLI can keep updating.
// Resolves once raw.json and stderr.txt are flushed, so the caller can read them. At timeoutMs it kills the child.
function runClaude(run, dir, outDir, ctx, { sessionId, env, spawn, kill, timeoutMs }) {
  const base = baseOf(run)
  const prompt = PREFIX + readFileSync(join(BENCH, 'tasks', `${run.task}.md`), 'utf8') + (base === 'forced' ? FORCED_SUFFIX : '')
  const { binary } = ctx.pin
  const args = builderArgs(base, prompt, { sessionId, installedKeys: ctx.installedKeys, pluginDir: ctx.pluginDir })
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(binary, args, { cwd: dir, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    activeChild = { child, kill }
    const outFile = createWriteStream(join(outDir, 'raw.json'))
    const errFile = createWriteStream(join(outDir, 'stderr.txt'))
    child.stdout.pipe(outFile)
    child.stderr.pipe(errFile)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      kill(child)
    }, timeoutMs)
    const finish = () => {
      activeChild = null
      clearTimeout(timer)
      outFile.end()
      errFile.end()
    }
    // The pinned binary missing: stop the round with one line (main's catch); the finally still restores memory.
    child.on('error', spawnErr => {
      finish()
      reject(new Error(`could not start claude (${binary}: ${spawnErr.code ?? spawnErr.message})`))
    })
    child.on('close', code => {
      finish()
      const info = { exitCode: code, timedOut, wallMs: Date.now() - started, startedAt: new Date(started).toISOString() }
      Promise.all([finished(outFile), finished(errFile)]).then(() => resolve(info), reject)
    })
  })
}

// One attempt of a run: archive the earlier one, a fresh session id, the run, its evidence, then run.json or a stop.
// ctx = { pin, installedKeys, pluginDir, pluginCommit }, built once per batch by main; deps let tests replace the
// spawn, the kill and the time limit, the home folder and the run folder.
export async function runOne(run, outDir, ctx, deps = {}) {
  const { spawn = nodeSpawn, kill = killTree, timeoutMs = TIMEOUT_MIN[run.task] * 60_000, home = homedir(), dir = runFolder(run), root = RUNS } = deps
  archiveAttempt(outDir, projectDirFor(dir, home))
  mkdirSync(outDir, { recursive: true })
  const sessionId = randomUUID()
  const attempt = nextAttempt(outDir)
  writeFileSync(join(outDir, 'session.json'), `${JSON.stringify({ sessionId, attempt }, null, 2)}\n`)
  prepareRun(run, { dir, root })
  const env = builderEnv(process.env, { pluginDir: ctx.pluginDir })
  console.log(`${new Date().toISOString()} start ${run.id} attempt ${attempt}`)
  const info = await runClaude(run, dir, outDir, ctx, { sessionId, env, spawn, kill, timeoutMs })
  const messages = outputMessages(readFileSync(join(outDir, 'raw.json'), 'utf8'))
  // Section memory the run wrote is filed with its results before the run counts as done, so the next team run starts empty.
  if (baseOf(run) !== 'solo') stashRunMemory({ into: outDir })
  const ended = classifyEnd({ messages, timedOut: info.timedOut, exitCode: info.exitCode })
  const bestEffort = ended === 'api-limit' || ended === 'api-other'
  const copied = copyEvidence({ runDir: dir, sessionId, outDir, base: baseOf(run), home, bestEffort })
  const evidenceTexts = copied.filter(file => file.endsWith('.jsonl')).map(file => readFileSync(file, 'utf8'))
  const { kind } = finishAttempt({ run, outDir, dir, sessionId, attempt, info, messages, pin: ctx.pin, ctx, evidenceTexts, env })
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

function restoreMemory({ force = false } = {}) {
  checkVolumes()
  const leftovers = join(RESULTS, `section-memory-leftover-${Date.now()}`)
  console.log(restoreMessage(restoreSectionMemory({ leftovers, force }), leftovers))
}

const SIGNAL_NUMBERS = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }

// Moves the user's section memory aside for the round (see section-memory.mjs) and returns the function that
// moves it back. Ctrl+C, a closed console, a kill or a crash skip `finally`; they all end in process exit, whose
// handler stops the run in progress and then puts the memory back. It runs at most once.
export function isolateSectionMemory({ volumes = checkVolumes, backup = backupSectionMemory, restore = restoreMemory, stop = stopActiveChild } = {}) {
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
  const { tag, round, conds, tasks, reps, filters, plugin, rerun, reason } = parseArgs(argv)
  checkRoundTag({ round, tag })
  // Every run reads its round's pin by the tag, so a run without one cannot start.
  if (tag === '') throw new Error('--tag= names the round and its preflight pin, e.g. --tag=mo')
  checkConds(conds)
  const problems = taskProblems(tasks)
  if (problems.length) throw new Error(`cannot run these tasks: ${problems.join('; ')}`)
  const pluginCommit = pluginCommitOf(plugin)
  checkPluginWorktree(plugin)
  const pin = readPin(RESULTS, tag)
  const ctx = { pin, installedKeys: installedPluginKeys(), pluginDir: plugin, pluginCommit }
  const runs = plan({ tag, conds, tasks, reps }).filter(r => filters.length === 0 || filters.some(f => r.id.includes(f)))
  mkdirSync(RESULTS, { recursive: true })
  const todo = pendingRuns(runs, { results: RESULTS, rerun, reason, at: new Date().toISOString() })
  for (const run of runs.filter(r => !todo.includes(r))) console.log(`skip ${run.id} (done)`)
  await runAll(todo, { runOne: (r, o) => runOne(r, o, ctx) })
  console.log('all runs finished')
}

// Runs each run in order. The user's section memory stays out of every team run: it is moved aside only when a
// run other than solo is left, and moved back even when a run throws. runOne is required: main binds it to the
// batch's ctx, and a default without ctx could only crash mid-batch.
export async function runAll(todo, { runOne: one, isolate = isolateSectionMemory } = {}) {
  if (typeof one !== 'function') throw new TypeError('runAll needs a runOne bound to the batch context')
  const release = todo.some(run => baseOf(run) !== 'solo') ? isolate() : () => {}
  try {
    for (const run of todo) await one(run, join(RESULTS, run.id))
  } finally {
    release()
  }
}

// A stop prints its one-line reason and exits 2 (batch) or 3 (round); any other error exits 1.
if (isMainModule(import.meta.url)) main().catch(err => { console.error(err.message); process.exitCode = exitCodeOf(err) })
