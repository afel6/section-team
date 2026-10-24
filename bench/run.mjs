// Runs the section-team benchmark: each task × condition × repetition as a fresh headless `claude -p` session
// in an empty git repo. Saves the raw JSON transcript per run. Resumable: finished runs are skipped.
// Usage: node bench/run.mjs [id-substring ...]
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMainModule } from '../hooks/lib/paths.mjs'

const BENCH = dirname(fileURLToPath(import.meta.url))
export const RUNS = 'C:/Users/Asus/bench-runs'
export const RESULTS = join(BENCH, 'results')
const TIMEOUT_MIN = { easy: 25, medium: 45, hard: 100 }
const PREFIX = 'AUTOMATED BENCHMARK TASK. No human will answer questions: the requirements below are complete and final, and any plan is approved in advance (OK). Work autonomously from start to finish without asking anything. Do not use the Fable model. Use only Node.js built-ins (no npm install). When you are finished, make sure the project\'s own tests pass, then stop.\n\n'
const ALLOWED = 'Task,Agent,SendMessage,Read,Write,Edit,MultiEdit,Glob,Grep,TodoWrite,Skill,PowerShell,Bash(node *),Bash(npm *),Bash(npx *),Bash(git *),Bash(mkdir *),Bash(ls *),Bash(date *),Bash(cat *),Bash(rm *),Bash(mv *),Bash(cp *),Bash(curl *),Bash(sleep *)'
const PLUGIN_OFF = JSON.stringify({ enabledPlugins: { 'section-team@inline': false } })

export function plan() {
  const out = []
  for (const rep of [1, 2]) {
    for (const task of ['easy', 'medium', 'hard']) {
      for (const cond of rep === 1 ? ['team', 'solo'] : ['solo', 'team']) out.push({ id: `${task}-${cond}-r${rep}`, task, cond, rep })
    }
  }
  return out
}

function freshRepo(dir) {
  if (!dir.startsWith(RUNS)) throw new Error(`refusing to touch ${dir}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  writeFileSync(join(dir, 'README.md'), '# bench project\n')
  git('add', 'README.md')
  git('-c', 'user.email=bench@local', '-c', 'user.name=bench', 'commit', '-q', '-m', 'init')
}

function runClaude(run, dir, outDir) {
  const prompt = PREFIX + readFileSync(join(BENCH, 'tasks', `${run.task}.md`), 'utf8')
  const args = ['-p', prompt, '--output-format', 'json', '--allowedTools', ALLOWED]
  if (run.cond === 'solo') args.push('--settings', PLUGIN_OFF)
  return new Promise(resolve => {
    const started = Date.now()
    const child = spawn('claude', args, { cwd: dir, windowsHide: true })
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
  const filters = process.argv.slice(2)
  const runs = plan().filter(r => filters.length === 0 || filters.some(f => r.id.includes(f)))
  mkdirSync(RESULTS, { recursive: true })
  for (const run of runs) {
    const outDir = join(RESULTS, run.id)
    if (existsSync(join(outDir, 'run.json'))) { console.log(`skip ${run.id} (done)`); continue }
    mkdirSync(outDir, { recursive: true })
    const dir = `${RUNS}/${run.id}`
    freshRepo(dir)
    console.log(`${new Date().toISOString()} start ${run.id}`)
    const info = await runClaude(run, dir, outDir)
    writeFileSync(join(outDir, 'run.json'), JSON.stringify({ ...run, dir, ...info }, null, 2) + '\n')
    console.log(`${new Date().toISOString()} end   ${run.id} exit=${info.exitCode} timedOut=${info.timedOut} wall=${Math.round(info.wallMs / 1000)}s`)
  }
  console.log('all runs finished')
}

if (isMainModule(import.meta.url)) main()
