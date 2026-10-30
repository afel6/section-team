// Runs the section-team benchmark: each task × condition × repetition as a fresh headless `claude -p` session
// in an empty git repo. Saves the raw JSON transcript per run. Resumable: finished runs are skipped.
// A task with a folder in bench/seeds/<task>/ starts from that seed, committed as 'seed' after 'init'.
// Team runs get empty section memory: the user's is moved aside for the round (see section-memory.mjs).
// Usage: node bench/run.mjs [--tag=v2] [--conds=team,solo] [--tasks=h1,h2,h3] [--reps=3] [id-substring ...]
//        node bench/run.mjs --restore-memory [--force]   (after an interrupted round: puts the user's section memory back)
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { MEMORY_ROOT, backupSectionMemory, restoreMessage, restoreSectionMemory, sameVolume, stashRunMemory } from './section-memory.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
// Benchmark projects live outside this repo, in the user's home folder (forward slashes: run ids are joined with '/').
export const RUNS = join(homedir(), 'bench-runs').replaceAll('\\', '/')
export const RESULTS = join(BENCH, 'results')
export const SEEDS = join(BENCH, 'seeds')
export const TASKS = ['easy', 'medium', 'hard']
export const TIMEOUT_MIN = { easy: 25, medium: 45, hard: 100, h1: 100, h2: 60, h3: 45 }
const PREFIX = 'AUTOMATED BENCHMARK TASK. No human will answer questions: the requirements below are complete and final, and any plan is approved in advance (OK). Work autonomously from start to finish without asking anything. Do not use the Fable model. Use only Node.js built-ins (no npm install). When you are finished, make sure the project\'s own tests pass, then stop.\n\n'
const ALLOWED = 'Task,Agent,SendMessage,Read,Write,Edit,MultiEdit,Glob,Grep,TodoWrite,Skill,PowerShell,Bash(node *),Bash(npm *),Bash(npx *),Bash(git *),Bash(mkdir *),Bash(ls *),Bash(date *),Bash(cat *),Bash(rm *),Bash(mv *),Bash(cp *),Bash(curl *),Bash(sleep *)'
export const PLUGIN_KEY = 'section-team@inline'
// Automatic skill installs stay off in every run: an install changes ~/.claude/skills for every later run of both setups.
const NO_AUTO_INSTALL = { env: { SECTION_TEAM_AUTO_INSTALL_SKILLS: '0' } }
const FORCED_SUFFIX = '\n\nUse your section agents for this work: delegate the building to the sections; do not build it yourself.\n'
// team   = plugin on, supervisor decides whether to delegate
// solo   = plugin off (the old way)
// forced = plugin on, prompt asks the supervisor to delegate to sections
export const CONDITIONS = ['team', 'solo', 'forced']

// A tag (e.g. "v2") benchmarks a newer plugin version: ids and condition labels get the tag (easy-team-v2-r1, cond team-v2).
// Odd reps run the conditions in order, even reps reversed, so no condition always goes first.
export function plan({ tag = '', conds = CONDITIONS, tasks = TASKS, reps = 2 } = {}) {
  return Array.from({ length: reps }, (_, i) => i + 1).flatMap(rep => {
    const order = (rep % 2 ? CONDITIONS : CONDITIONS.toReversed()).filter(c => conds.includes(c))
    return tasks.flatMap(task => order.map(base => {
      const cond = tag ? `${base}-${tag}` : base
      return { id: `${task}-${cond}-r${rep}`, task, cond, base, rep }
    }))
  })
}

// Round, tag and task names end up in folder names, some of which get deleted: letters and digits only.
export const NAME = /^[A-Za-z0-9]+$/

export function parseArgs(argv) {
  const opt = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
  const reps = opt('reps') ?? '2'
  if (!/^\d+$/.test(reps) || !Number.isSafeInteger(Number(reps)) || Number(reps) < 1) {
    throw new RangeError(`--reps must be a whole number of at least 1, got "${reps}"`)
  }
  const args = {
    tag: opt('tag') ?? '',
    conds: opt('conds')?.split(',') ?? CONDITIONS,
    round: opt('round') ?? '',
    tasks: opt('tasks')?.split(',') ?? TASKS,
  }
  // An empty round or tag means none; an empty task (--tasks=h1,) is an error.
  const named = [['round', args.round], ['tag', args.tag]].filter(([, value]) => value !== '')
  for (const [flag, value] of [...named, ...args.tasks.map(t => ['tasks', t])]) {
    if (!NAME.test(value)) throw new RangeError(`--${flag} takes letters and digits only, got "${value}"`)
  }
  return { ...args, reps: Number(reps), filters: argv.filter(a => !a.startsWith('--')) }
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
// (preflight, 2026-10-30), so builder runs get it in their process environment too.
export const builderEnv = (env = process.env) => ({ ...env, ...NO_AUTO_INSTALL.env })

export function builderArgs(base, prompt) {
  const settings = base === 'solo' ? { ...NO_AUTO_INSTALL, enabledPlugins: { [PLUGIN_KEY]: false } } : NO_AUTO_INSTALL
  return ['-p', prompt, '--output-format', 'json', '--allowedTools', ALLOWED, '--settings', JSON.stringify(settings)]
}

// <RUNS>/<task>-<8 hex of the id's hash>: the setup never shows in the folder name, so it cannot end up in a
// package name or README the judges read. Stable, so a rerun reuses the folder.
export const runFolder = run => `${RUNS}/${run.task}-${createHash('sha256').update(run.id).digest('hex').slice(0, 8)}`

// team, solo or forced, without the round tag.
const baseOf = run => run.base ?? run.cond

// The claude process of the run in progress, so an exit can stop it before section memory is put back.
let activeChild = null
const killTree = child => {
  try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
}

function runClaude(run, dir, outDir) {
  const base = baseOf(run)
  const prompt = PREFIX + readFileSync(join(BENCH, 'tasks', `${run.task}.md`), 'utf8') + (base === 'forced' ? FORCED_SUFFIX : '')
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn('claude', builderArgs(base, prompt), { cwd: dir, env: builderEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    activeChild = child
    const outFile = createWriteStream(join(outDir, 'raw.json'))
    const errFile = createWriteStream(join(outDir, 'stderr.txt'))
    child.stdout.pipe(outFile)
    child.stderr.pipe(errFile)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, TIMEOUT_MIN[run.task] * 60_000)
    const finish = () => {
      activeChild = null
      clearTimeout(timer)
      outFile.end()
      errFile.end()
    }
    // claude missing from PATH: stop the round with one line (main's catch); the finally still restores memory.
    child.on('error', spawnErr => {
      finish()
      reject(new Error(`could not start claude (${spawnErr.code ?? spawnErr.message})`))
    })
    child.on('close', code => {
      finish()
      resolve({ exitCode: code, timedOut, wallMs: Date.now() - started, startedAt: new Date(started).toISOString() })
    })
  })
}

async function runOne(run, outDir) {
  mkdirSync(outDir, { recursive: true })
  const dir = runFolder(run)
  const seed = join(SEEDS, run.task)
  freshRepo(dir, existsSync(seed) ? { seed } : {})
  console.log(`${new Date().toISOString()} start ${run.id}`)
  const info = await runClaude(run, dir, outDir)
  // Section memory the run wrote is filed with its results before the run counts as done, so the next team run starts empty.
  if (baseOf(run) !== 'solo') stashRunMemory({ into: outDir })
  writeFileSync(join(outDir, 'run.json'), JSON.stringify({ ...run, dir, ...info }, null, 2) + '\n')
  console.log(`${new Date().toISOString()} end   ${run.id} exit=${info.exitCode} timedOut=${info.timedOut} wall=${Math.round(info.wallMs / 1000)}s`)
}

const nearestExisting = path => (existsSync(path) || dirname(path) === path ? path : nearestExisting(dirname(path)))

// Section memory moves between MEMORY_ROOT, the backup in home and RESULTS: renames need one volume. MEMORY_ROOT
// may not exist yet (no section has saved a note), so its nearest existing parent stands in for it.
export function checkVolumes({ root = MEMORY_ROOT, others = [homedir(), RESULTS] } = {}) {
  const memory = nearestExisting(root)
  for (const dir of others) {
    if (!sameVolume(memory, dir)) throw new Error(`${root} and ${dir} are on different drives, so section memory cannot be moved between them`)
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
export function isolateSectionMemory({ volumes = checkVolumes, backup = backupSectionMemory, restore = restoreMemory } = {}) {
  volumes()
  console.log(`section memory moved aside: ${backup().join(' ') || '(none)'}`)
  let released = false
  const putBack = () => {
    if (released) return
    released = true
    if (activeChild) killTree(activeChild)
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
  const { tag, conds, tasks, reps, filters } = parseArgs(argv)
  const problems = taskProblems(tasks)
  if (problems.length) throw new Error(`cannot run these tasks: ${problems.join('; ')}`)
  const runs = plan({ tag, conds, tasks, reps }).filter(r => filters.length === 0 || filters.some(f => r.id.includes(f)))
  mkdirSync(RESULTS, { recursive: true })
  const todo = runs.filter(run => !existsSync(join(RESULTS, run.id, 'run.json')))
  for (const run of runs.filter(r => !todo.includes(r))) console.log(`skip ${run.id} (done)`)
  await runAll(todo)
  console.log('all runs finished')
}

// Runs each run in order. The user's section memory stays out of every team run: it is moved aside only when a
// team (or forced) run is left, and moved back even when a run throws.
export async function runAll(todo, { runOne: one = runOne, isolate = isolateSectionMemory } = {}) {
  const release = todo.some(run => baseOf(run) !== 'solo') ? isolate() : () => {}
  try {
    for (const run of todo) await one(run, join(RESULTS, run.id))
  } finally {
    release()
  }
}

if (isMainModule(import.meta.url)) main().catch(err => { console.error(err.message); process.exitCode = 1 })
