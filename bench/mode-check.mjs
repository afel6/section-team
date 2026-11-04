// Mode fidelity: whether each Lean, Balanced and Max run of a round behaved as its mode (docs/specs/
// 2026-11-01-mode-round-design.md, "Mode fidelity"): the mode record and .team/mode.json, the sections woken, the
// reviewer's model, the gate rules and, for Max, the near-miss copies. Read-only over results/<id>/evidence/ and the
// run folder. A gate's final grade is never a rule (gate-stats.mjs reports it); tier is reported, never a rule.
// Usage: node bench/mode-check.mjs --round=mo   (writes results/mode-check-<round>.json and prints one line per run)
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { GATES, parseModeFile } from '../hooks/lib/mode.mjs'
import { readRecord } from '../hooks/lib/mode-record.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { modeOfCond } from './gate-stats.mjs'
import { BUILDERS, HEADS, gates, reviewerCalls, toolUses, wakeUps } from './mode-gates.mjs'
import { insideFolder } from './os-paths.mjs'
import { NAME, RESULTS } from './run.mjs'
import { collectRolesFrom, isFileFailure, runSession } from './score.mjs'

export { BUILDERS, HEADS, gates, reviewerCalls, toolUses, wakeUps }
// The setup in a run's condition, the part before its round tag ('team-mo' is team).
const setupOf = cond => /^(solo|lean|team|max)-[A-Za-z0-9]+$/.exec(cond)?.[1] ?? null
const REVIEWER_MODEL = { lean: 'sonnet', balanced: 'opus', max: 'opus' }
const SMALL_TASKS = ['h5', 'h6']
const MULTI_AREA_TASKS = ['h4', 'h7']
const NEAR_MISS = '.team/near-miss/'
const toPosix = path => path.split(sep).join('/').replaceAll('\\', '/')

// read()'s value, or fallback when the path (or a folder on it) does not exist; any other error is thrown.
function unlessMissing(read, fallback) {
  try {
    return read()
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return fallback
    throw err
  }
}

// Files under dir as dir-relative posix paths; [] when dir does not exist.
const filesUnder = dir => unlessMissing(() => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile()).map(e => toPosix(relative(dir, join(e.parentPath, e.name)))), [])

const SKIP_ANYWHERE = new Set(['.git', 'node_modules'])

// runDir-relative paths of the files outside .team/ (at the root) and outside any .git/ or node_modules/ folder.
// The root's .team, .git and node_modules are never walked.
function outsideFiles(runDir) {
  const top = unlessMissing(() => readdirSync(runDir, { withFileTypes: true }), [])
  return top.filter(e => e.name !== '.team' && !SKIP_ANYWHERE.has(e.name)).flatMap(e => {
    if (e.isDirectory()) return filesUnder(join(runDir, e.name)).map(rel => `${e.name}/${rel}`)
    return e.isFile() ? [e.name] : []
  }).filter(rel => !rel.split('/').some(part => SKIP_ANYWHERE.has(part)))
}

const sha = buffer => createHash('sha256').update(buffer).digest('hex')
const COPY_WORD = /near-miss|nearmiss|mutant/i

// { copies, outside }: how many files with bytes are under <runDir>/.team/near-miss/, and the runDir-relative paths of
// files outside .team/, .git/ and node_modules/ that are byte-identical to one of them, name near-miss, nearmiss or
// mutant in their path, or have a first line containing `near-miss:`.
export function nearMissState(runDir) {
  const nearDir = join(runDir, '.team', 'near-miss')
  // An empty file (a .gitkeep) is no copy, and would match every empty file: only files with bytes count.
  const copies = filesUnder(nearDir).map(rel => readFileSync(join(nearDir, rel))).filter(bytes => bytes.length > 0)
  const hashes = new Set(copies.map(sha))
  const isCopy = rel => {
    if (COPY_WORD.test(rel)) return true
    const bytes = readFileSync(join(runDir, rel))
    return bytes.toString('utf8').split('\n', 1)[0].includes('near-miss:') || hashes.has(sha(bytes))
  }
  return { copies: copies.length, outside: outsideFiles(runDir).filter(isCopy).sort() }
}

const listed = list => list.join(', ')

function modeFileRules(mode, runDir) {
  const text = unlessMissing(() => readFileSync(join(runDir, '.team', 'mode.json'), 'utf8'), null)
  if (mode === 'balanced') return text === null ? [] : ['.team/mode.json present (a team run has none)']
  if (text === null) return [`.team/mode.json missing (${mode} expected)`]
  const parsed = parseModeFile(text)
  const named = parsed.modeUsable ? parsed.mode : 'nothing usable'
  return named === mode ? [] : [`.team/mode.json says ${named}, not ${mode}`]
}

const recordRules = (mode, record) => (record === mode ? [] : [`mode record is ${record ?? 'missing'}, not ${mode}`])

const FILE_WRITERS = ['Write', 'Edit', 'MultiEdit']
const SHELLS = ['Bash', 'PowerShell']

// A tool's file_path as a runDir-relative posix path, or null when it lies outside runDir (or is runDir itself).
// Windows run folders and transcript paths read as Windows paths on any OS (CI runs Ubuntu); Linux ones (the cloud
// machine) as POSIX paths, case for case (os-paths.mjs).
const insideRunDir = (runDir, path) => insideFolder(runDir, String(path ?? ''))

// A shell command that names .team/near-miss in either slash direction, as the folder itself (.team/near-miss,
// .team/near-miss/x, ".team\near-miss") and not a longer name (.team/near-missing, .team/near-miss-old).
const namesNearMiss = command => /\.team\/near-miss(?![A-Za-z0-9_.-])/.test(command.replaceAll('\\', '/'))

// Files main itself wrote inside the run folder, other than docs, package.json, .gitignore and .team/ files.
function mainWrites(roles, runDir) {
  const main = roles.find(r => r.role === 'main')?.messages ?? []
  const inside = toolUses(main, ...FILE_WRITERS).map(use => insideRunDir(runDir, use.input.file_path)).filter(rel => rel !== null)
  const allowed = rel => rel.endsWith('.md') || ['package.json', '.gitignore'].includes(basename(rel)) || rel.startsWith('.team/')
  return [...new Set(inside)].filter(rel => !allowed(rel))
}

// h4 and h7, every mode: main wakes backend and frontend, someone wakes docs, and main writes no source itself.
function h4Rules(roles, woken, runDir) {
  const byMain = new Set(woken.filter(w => w.caller === 'main').map(w => w.section))
  const missing = ['backend', 'frontend'].filter(head => !byMain.has(head)).map(head => `main did not wake ${head}`)
  const docs = woken.some(w => w.section === 'docs') ? [] : ['docs not woken']
  const written = mainWrites(roles, runDir)
  return [...missing, ...docs, ...(written.length ? [`main wrote ${listed(written)}`] : [])]
}

function reviewerRules(roles, mode) {
  const word = REVIEWER_MODEL[mode]
  const off = [...new Set(reviewerCalls(roles).map(call => call.model).filter(model => !String(model ?? '').includes(word)))]
  return off.length ? [`reviewer not on ${word}: ${listed(off.map(String))}`] : []
}

function gateRules(roles, mode) {
  const max = GATES[mode].fixRounds
  return gates(roles, mode).flatMap(gate => [
    ...(gate.endsEarly ? [`gate of ${gate.caller} ended early`] : []),
    ...(gate.fixRounds > max ? [`gate of ${gate.caller} had ${gate.fixRounds} fix rounds (at most ${max})`] : []),
    ...(gate.regradeAfterPass ? [`gate of ${gate.caller} graded again after a pass`] : []),
  ])
}

// The sections a mode must wake on a task, and on h5 and h6 the only ones it may wake.
function sectionPlan(mode, task) {
  const small = SMALL_TASKS.includes(task)
  if (mode === 'max') return { need: ['testing', 'security'], only: small ? ['testing', 'security'] : null }
  if (mode === 'balanced') return { need: MULTI_AREA_TASKS.includes(task) || small ? ['testing'] : [], only: small ? ['testing'] : null }
  return { need: MULTI_AREA_TASKS.includes(task) ? ['testing'] : [], only: small ? [] : null }
}

function sectionRules(mode, task, woken) {
  const { need, only } = sectionPlan(mode, task)
  const sections = new Set(woken.map(w => w.section))
  const missing = need.filter(head => !sections.has(head)).map(head => `${head} not woken`)
  const extra = only === null ? [] : [...sections].filter(head => !only.includes(head))
  const allowed = only?.length ? `only ${listed(only)} allowed` : 'none allowed'
  return [...missing, ...(extra.length ? [`${task} woke ${listed(extra)} (${allowed})`] : [])]
}

// A testing-section tool call wrote into .team/near-miss/: a Write, Edit or MultiEdit of a file under the run's
// .team/near-miss/, or a Bash or PowerShell command naming .team/near-miss/ (either slash direction).
function testingWroteCopy(roles, runDir) {
  return roles.filter(r => r.role === 'section-team:testing').some(({ messages }) =>
    toolUses(messages, ...FILE_WRITERS).some(use => insideRunDir(runDir, use.input.file_path)?.startsWith(NEAR_MISS))
    || toolUses(messages, ...SHELLS).some(use => namesNearMiss(String(use.input.command ?? ''))))
}

// Max: a copy stayed in .team/near-miss/ (or the testing section wrote one there), and none sits outside .team/.
function nearMissRules(roles, runDir) {
  const { copies, outside } = nearMissState(runDir)
  const made = copies > 0 || testingWroteCopy(roles, runDir)
  return [...(made ? [] : [`no near-miss copy in ${NEAR_MISS}`]), ...(outside.length ? [`near-miss copy outside .team/: ${listed(outside)}`] : [])]
}

// The tier the supervisor chose: only its own wake-ups count, not a section's (testing waking backend).
const tierOf = woken => {
  const own = woken.filter(w => w.caller === 'main')
  if (own.some(w => BUILDERS.includes(w.section))) return 'multi'
  return own.some(w => w.section === 'testing') ? 'single' : 'small'
}

// A row that was not checked: one line says why.
const failedRow = line => ({ faithful: false, broken: [line], tier: null })

// { faithful, broken, tier } for one run. Solo runs are always faithful; roles null (no evidence) is a no-data row.
export function checkRun({ cond, task, roles, runDir, record }) {
  if (setupOf(cond) === 'solo') return { faithful: true, broken: [], tier: null }
  if (roles === null) return failedRow('no data')
  const mode = modeOfCond(setupOf(cond))
  if (mode === null) throw new Error(`unknown setup "${cond}"`)
  const woken = wakeUps(roles)
  const broken = [
    ...recordRules(mode, record),
    ...modeFileRules(mode, runDir),
    ...(MULTI_AREA_TASKS.includes(task) ? h4Rules(roles, woken, runDir) : []),
    ...reviewerRules(roles, mode),
    ...gateRules(roles, mode),
    ...sectionRules(mode, task, woken),
    ...(mode === 'max' ? nearMissRules(roles, runDir) : []),
  ]
  return { faithful: broken.length === 0, broken, tier: tierOf(woken) }
}

const unreadable = what => failedRow(`${what} unreadable`)

// read()'s value, or FAILED when a file failure stopped it (score.mjs isFileFailure), so one bad file becomes that run's row and never stops
// the others. Anything else (a TypeError, an ERR_* code) is a bug and propagates.
const FAILED = Symbol('failed')
const attempt = read => {
  try {
    return read()
  } catch (err) {
    if (isFileFailure(err)) return FAILED
    throw err
  }
}

// results/<id>/run.json's value; undefined when there is none.
function readRunJson(folder) {
  const text = unlessMissing(() => readFileSync(join(folder, 'run.json'), 'utf8'), undefined)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error('run.json is not valid JSON', { cause: err })
  }
}

// The run's session id and roles from results/<id>/ (session.json, else raw.json) and its evidence/ copy.
function sessionOf(folder) {
  const sid = runSession(folder)
  return { sid, roles: sid ? collectRolesFrom(join(folder, 'evidence'), sid) : null }
}

// The readers of a run's evidence; tests inject failing ones.
const READERS = Object.freeze({ session: sessionOf, record: (folder, sid) => readRecord(join(folder, 'evidence'), sid) })

// One run's row: every run of the round gets one. No run.json, run folder or evidence is a no-data row; a file that
// does not parse or cannot be read names itself (run.json, session, mode record, run folder).
function runRow(folder, cond, task, readers) {
  if (setupOf(cond) === 'solo') return checkRun({ cond, task, roles: null, runDir: null, record: null })
  const run = attempt(() => readRunJson(folder))
  if (run === undefined) return failedRow('no data')
  if (run === FAILED || typeof run?.dir !== 'string') return unreadable('run.json')
  const isFolder = attempt(() => unlessMissing(() => statSync(run.dir).isDirectory(), false))
  if (isFolder === FAILED) return unreadable('run folder')
  if (!isFolder) return failedRow('no data')
  const session = attempt(() => readers.session(folder))
  if (session === FAILED) return unreadable('session')
  if (session.roles === null) return failedRow('no data')
  const record = attempt(() => readers.record(folder, session.sid))
  if (record === FAILED) return unreadable('mode record')
  const row = attempt(() => checkRun({ cond, task, roles: session.roles, runDir: run.dir, record }))
  return row === FAILED ? unreadable('run folder') : row
}

// { [runId]: { cond, task, faithful, broken, tier } } for every solo, lean, team and max run of the round (cond and
// task from the run id). Throws one line when results/ cannot be read, or (a bug) naming the run it failed on.
export function modeCheck({ results = RESULTS, round, readers = {} }) {
  const use = { ...READERS, ...readers }
  const runId = new RegExp(`^([^-]+)-(solo|lean|team|max)-${round}-r\\d+$`)
  let entries
  try {
    entries = readdirSync(results, { withFileTypes: true })
  } catch (err) {
    throw new Error(`cannot read ${results} (${err.code ?? err.message})`, { cause: err })
  }
  const ids = entries.filter(d => d.isDirectory() && runId.test(d.name)).map(d => d.name).sort()
  return Object.fromEntries(ids.map(id => {
    const [, task, base] = runId.exec(id)
    const cond = `${base}-${round}`
    try {
      return [id, { cond, task, ...runRow(join(results, id), cond, task, use) }]
    } catch (err) {
      throw new Error(`${id}: ${err.message}`, { cause: err })
    }
  }))
}

const lineOf = (id, row) => `${id}  ${row.faithful ? 'faithful' : 'not faithful'}  tier ${row.tier ?? '–'}${row.broken.length ? `  ${row.broken.join('; ')}` : ''}`

export function main(argv = process.argv.slice(2), { results = RESULTS, readers } = {}) {
  const round = argv.find(a => a.startsWith('--round='))?.slice(8) ?? ''
  if (!NAME.test(round)) {
    console.error('usage: node bench/mode-check.mjs --round=<tag>   (letters and digits only)')
    process.exitCode = 1
    return
  }
  try {
    const rows = modeCheck({ results, round, readers })
    writeFileSync(join(results, `mode-check-${round}.json`), JSON.stringify(rows, null, 2) + '\n')
    for (const [id, row] of Object.entries(rows)) console.log(lineOf(id, row))
  } catch (err) {
    console.error(`mode-check: ${err.message}`)
    process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) main()
