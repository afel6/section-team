// Runs the section-team benchmark: each task × condition × repetition as a fresh headless `claude -p` session
// in an empty git repo. Saves the raw JSON transcript per run. Resumable: finished runs are skipped.
// A task with a folder in bench/seeds/<task>/ starts from that seed, committed as 'seed' after 'init'.
// Usage: node bench/run.mjs [--tag=v2] [--conds=team,solo] [--tasks=h1,h2,h3] [--reps=3] [id-substring ...]
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
// Benchmark projects live outside this repo, in the user's home folder (forward slashes: run ids are joined with '/').
export const RUNS = join(homedir(), 'bench-runs').replaceAll('\\', '/')
export const RESULTS = join(BENCH, 'results')
export const SEEDS = join(BENCH, 'seeds')
export const TASKS = ['easy', 'medium', 'hard']
export const TIMEOUT_MIN = { easy: 25, medium: 45, hard: 100, h1: 100, h2: 60, h3: 45 }
const PREFIX = 'AUTOMATED BENCHMARK TASK. No human will answer questions: the requirements below are complete and final, and any plan is approved in advance (OK). Work autonomously from start to finish without asking anything. Do not use the Fable model. Use only Node.js built-ins (no npm install). When you are finished, make sure the project\'s own tests pass, then stop.\n\n'
const ALLOWED = 'Task,Agent,SendMessage,Read,Write,Edit,MultiEdit,Glob,Grep,TodoWrite,Skill,PowerShell,Bash(node *),Bash(npm *),Bash(npx *),Bash(git *),Bash(mkdir *),Bash(ls *),Bash(date *),Bash(cat *),Bash(rm *),Bash(mv *),Bash(cp *),Bash(curl *),Bash(sleep *)'
const PLUGIN_OFF = JSON.stringify({ enabledPlugins: { 'section-team@inline': false } })
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

function runClaude(run, dir, outDir) {
  const base = run.base ?? run.cond
  const prompt = PREFIX + readFileSync(join(BENCH, 'tasks', `${run.task}.md`), 'utf8') + (base === 'forced' ? FORCED_SUFFIX : '')
  const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', ALLOWED]
  if (base === 'solo') args.push('--settings', PLUGIN_OFF)
  return new Promise(resolve => {
    const started = Date.now()
    const child = spawn('claude', args, { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const out = createWriteStream(join(outDir, 'raw.json'))
    const err = createWriteStream(join(outDir, 'stderr.txt'))
    child.stdout.pipe(out)
    child.stderr.pipe(err)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    }, TIMEOUT_MIN[run.task] * 60_000)
    child.on('close', code => {
      clearTimeout(timer)
      out.end()
      err.end()
      resolve({ exitCode: code, timedOut, wallMs: Date.now() - started, startedAt: new Date(started).toISOString() })
    })
  })
}

async function main() {
  const { tag, conds, tasks, reps, filters } = parseArgs(process.argv.slice(2))
  const problems = taskProblems(tasks)
  if (problems.length) throw new Error(`cannot run these tasks: ${problems.join('; ')}`)
  const runs = plan({ tag, conds, tasks, reps }).filter(r => filters.length === 0 || filters.some(f => r.id.includes(f)))
  mkdirSync(RESULTS, { recursive: true })
  for (const run of runs) {
    const outDir = join(RESULTS, run.id)
    if (existsSync(join(outDir, 'run.json'))) { console.log(`skip ${run.id} (done)`); continue }
    mkdirSync(outDir, { recursive: true })
    const dir = `${RUNS}/${run.id}`
    const seed = join(SEEDS, run.task)
    freshRepo(dir, existsSync(seed) ? { seed } : {})
    console.log(`${new Date().toISOString()} start ${run.id}`)
    const info = await runClaude(run, dir, outDir)
    writeFileSync(join(outDir, 'run.json'), JSON.stringify({ ...run, dir, ...info }, null, 2) + '\n')
    console.log(`${new Date().toISOString()} end   ${run.id} exit=${info.exitCode} timedOut=${info.timedOut} wall=${Math.round(info.wallMs / 1000)}s`)
  }
  console.log('all runs finished')
}

if (isMainModule(import.meta.url)) main().catch(err => { console.error(err.message); process.exitCode = 1 })
