// Mode fidelity: whether each Lean, Balanced and Max run of a round behaved as its mode (docs/specs/
// 2026-11-01-mode-round-design.md, "Mode fidelity"): the mode record and .team/mode.json, the sections woken, the
// reviewer's model, the gate rules and, for Max before 0.3.0, the near-miss copies. Read-only over results/<id>/evidence/ and the
// run folder. A gate's final grade is never a rule (gate-stats.mjs reports it); tier is reported, never a rule.
// A round whose pin (results/preflight-<round>.json) sits beside its runs also gets each run's validity (V1 to V5 of the
// nx round, docs in validityOf); a void there is owed one rerun: --rerun=<id> --reason=V1b (or V2).
// Usage: node bench/mode-check.mjs --round=mo   (writes results/mode-check-<round>.json and prints one line per run)
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { parseModeFile } from '../hooks/lib/mode.mjs'
import { readRecord } from '../hooks/lib/mode-record.mjs'
import { isMainModule } from '../hooks/lib/paths.mjs'
import { ROUND_GATES, modeOfCond } from './gate-stats.mjs'
import { BUILDERS, FILE_WRITERS, HEADS, gates, reviewerCalls, toolUses, wakeUps } from './mode-gates.mjs'
import { insideFolder } from './os-paths.mjs'
import { BENCH_MODEL } from './clean-run.mjs'
import { NAME, RESULTS } from './run.mjs'
import { collectRolesFrom, isFileFailure, runSession } from './score.mjs'
import { required } from './section-memory.mjs'

export { BUILDERS, HEADS, gates, reviewerCalls, toolUses, wakeUps }
// The setup in a run's condition, the part before its round tag ('team-mo' is team), and the round tag after it.
const setupOf = cond => /^(solo|lean|team|max|base)-[A-Za-z0-9]+$/.exec(cond)?.[1] ?? null
const roundOf = cond => /^(?:solo|lean|team|max|base)-([A-Za-z0-9]+)$/.exec(cond)?.[1] ?? null
// The direct-job tasks: there team (the plugin with the direct tier) may do the fix itself, behind its own reviewer gate.
// h8 is the round's; h5p is the pilot's L1 probe (h5's seed, its first bug report only).
const DIRECT_TASKS = ['h8', 'h5p']
const REVIEWER = 'section-team:reviewer'
const REVIEWER_MODEL = { lean: 'sonnet', balanced: 'opus', max: 'opus' }
// The single-area tasks (the mode round's h5 and h6, the nx round's h9) and the multi-area ones (h4, h7, nx's h10).
const SMALL_TASKS = ['h5', 'h6', 'h9']
const MULTI_AREA_TASKS = ['h4', 'h7', 'h10']
// The rounds whose Balanced arms (base at v0.5.1, team at the rc) run a brief that sends a small or single-area task to
// the matching builder section and no other builder section (brief/tiers-balanced.md, the same lines at v0.5.1): the nx
// round and its pilot pnx. Every earlier round keeps the mode round's rule (testing and no other section).
const ONE_BUILDER_ROUNDS = ['nx', 'pnx']
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
  const named = parsed.modeUsable ? parsed.retired ?? parsed.mode : 'nothing usable' // a lean run's file still says lean
  return named === mode ? [] : [`.team/mode.json says ${named}, not ${mode}`]
}

const recordRules = (mode, record) => (record === mode ? [] : [`mode record is ${record ?? 'missing'}, not ${mode}`])

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

// The multi-area tasks (MULTI_AREA_TASKS), every mode: main wakes backend and frontend, someone wakes docs, and main writes no source itself.
function multiAreaRules(roles, woken, runDir) {
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

// Max before 0.3.0 (the mode round ran 0.2.1): 3 fix rounds and a near-miss copy. GATES holds 0.3.0's Max.
const MAX_BEFORE_030 = Object.freeze({ ...ROUND_GATES.max, fixRounds: 3, nearMiss: true })

// The gate a run's mode had in the plugin version its run.json records; a run.json without one is from before 0.3.0.
export function gateFor(mode, pluginVersion) {
  const before030 = typeof pluginVersion !== 'string' || /^0\.[0-2]\./.test(pluginVersion)
  return mode === 'max' && before030 ? MAX_BEFORE_030 : ROUND_GATES[mode]
}

function gateRules(roles, mode, max) {
  return gates(roles, mode, max).flatMap(gate => [
    ...(gate.endsEarly ? [`gate of ${gate.caller} ended early`] : []),
    ...(gate.fixRounds > max ? [`gate of ${gate.caller} had ${gate.fixRounds} fix rounds (at most ${max})`] : []),
    ...(gate.regradeAfterPass ? [`gate of ${gate.caller} graded again after a pass`] : []),
  ])
}

// The sections a mode must wake on a task, and on the single-area tasks (SMALL_TASKS) the only ones it may wake: the
// mode round's rule, which every run keeps except a one-builder run (oneBuilderRules).
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

// A Balanced run on a single-area task in a round of ONE_BUILDER_ROUNDS.
const isOneBuilderRun = (mode, task, cond) => mode === 'balanced' && SMALL_TASKS.includes(task) && ONE_BUILDER_ROUNDS.includes(roundOf(cond))

// The builder sections main itself woke, each once, in wake order: a section's own wake-ups are not the supervisor's choice.
const mainBuilders = woken => [...new Set(woken.filter(w => w.caller === 'main' && BUILDERS.includes(w.section)).map(w => w.section))]

// A one-builder run: main wakes exactly one builder section; testing, docs, security and advisors are allowed.
function oneBuilderRules(task, woken) {
  const builders = mainBuilders(woken)
  if (builders.length === 0) return ['no builder woken']
  return builders.length > 1 ? [`${task} woke ${listed(builders)} (one builder allowed)`] : []
}

// A testing-section tool call wrote into .team/near-miss/: a Write, Edit or MultiEdit of a file under the run's
// .team/near-miss/, or a Bash or PowerShell command naming .team/near-miss/ (either slash direction).
function testingWroteCopy(roles, runDir) {
  return roles.filter(r => r.role === 'section-team:testing').some(({ messages }) =>
    toolUses(messages, ...FILE_WRITERS).some(use => insideRunDir(runDir, use.input.file_path)?.startsWith(NEAR_MISS))
    || toolUses(messages, ...SHELLS).some(use => namesNearMiss(String(use.input.command ?? ''))))
}

// Max before 0.3.0: a copy stayed in .team/near-miss/ (or the testing section wrote one there), and none sits outside .team/.
function nearMissRules(roles, runDir) {
  const { copies, outside } = nearMissState(runDir)
  const made = copies > 0 || testingWroteCopy(roles, runDir)
  return [...(made ? [] : [`no near-miss copy in ${NEAR_MISS}`]), ...(outside.length ? [`near-miss copy outside .team/: ${listed(outside)}`] : [])]
}

// The tier the supervisor chose: only its own wake-ups count, not a section's (testing waking backend). Team on the
// direct-job task with no section woken is the direct tier; a one-builder run with one builder woken is single.
const tierOf = (woken, direct = false, oneBuilder = false) => {
  const own = woken.filter(w => w.caller === 'main')
  if (oneBuilder && mainBuilders(woken).length === 1) return 'single'
  if (own.some(w => BUILDERS.includes(w.section))) return 'multi'
  if (own.some(w => w.section === 'testing')) return 'single'
  return direct && woken.length === 0 ? 'direct' : 'small'
}

// A direct job that changed code gets the gate too: the supervisor runs the reviewer on its own changed files.
const directRules = roles => (reviewerCalls(roles).some(call => call.caller === 'main') ? [] : ['direct job without the reviewer gate'])

// A row that was not checked: one line says why.
const failedRow = line => ({ faithful: false, broken: [line], tier: null })

// { faithful, broken, tier } for one run. Solo runs are always faithful; roles null (no evidence) is a no-data row.
// pluginVersion is the section-team version from the run's run.json (undefined when it has none).
export function checkRun({ cond, task, roles, runDir, record, pluginVersion }) {
  if (setupOf(cond) === 'solo') return { faithful: true, broken: [], tier: null }
  if (roles === null) return failedRow('no data')
  const mode = modeOfCond(setupOf(cond)) // base, the control arm, is Balanced like team and held to its rules
  if (mode === null) throw new Error(`unknown setup "${cond}"`)
  const woken = wakeUps(roles)
  const oneBuilder = isOneBuilderRun(mode, task, cond)
  const tier = tierOf(woken, setupOf(cond) === 'team' && DIRECT_TASKS.includes(task), oneBuilder)
  const gate = gateFor(mode, pluginVersion)
  const broken = [
    ...recordRules(mode, record),
    ...modeFileRules(mode, runDir),
    ...(MULTI_AREA_TASKS.includes(task) ? multiAreaRules(roles, woken, runDir) : []),
    ...reviewerRules(roles, mode),
    ...gateRules(roles, mode, gate.fixRounds),
    ...(oneBuilder ? oneBuilderRules(task, woken) : sectionRules(mode, task, woken)),
    ...(gate.nearMiss ? nearMissRules(roles, runDir) : []),
    ...(tier === 'direct' ? directRules(roles) : []),
  ]
  return { faithful: broken.length === 0, broken, tier }
}

// The agent types a run spawned, sorted, from its transcripts (main is the session itself).
const spawnedTypes = roles => [...new Set(roles.filter(r => r.role !== 'main').map(r => r.role))].sort()
const isBuilderType = type => BUILDERS.includes(/^section-team:(.+)$/.exec(type)?.[1])

// Every assistant line's model other than the round's, with the role that ran it; <synthetic> lines are Claude Code's
// own (API errors, interrupts), not a model's turn.
const modelsOtherThanRound = roles => {
  const seen = roles.flatMap(r => r.messages.filter(m => m?.type === 'assistant' && m.message?.model !== '<synthetic>').map(m => `${r.role}\u0000${m.message?.model}`))
  return [...new Set(seen)].map(key => key.split('\u0000')).filter(([, model]) => model !== BENCH_MODEL).map(([role, model]) => ({ role, model }))
}

const isOpus = model => model === 'opus' || (typeof model === 'string' && model.startsWith('claude-opus'))

// { 'section-team:<name>': model } from the agent files of the plugin the run loaded, or null when they cannot be read.
function declaredModels(pluginDir) {
  if (typeof pluginDir !== 'string') return null
  const files = unlessMissing(() => readdirSync(join(pluginDir, 'agents')).filter(name => name.endsWith('.md')), null)
  if (files === null) return null
  return Object.fromEntries(files.map(name => [`section-team:${name.slice(0, -3)}`, /^model:\s*(\S+)/m.exec(readFileSync(join(pluginDir, 'agents', name), 'utf8'))?.[1] ?? null]))
}

// V4 checks the opus alias: main and every section whose agent file declares an Opus model (the alias opus, or a full id
// claude-opus-*, as v0.5.1's builders declare) answer as the round's model. Roles that run another model by design (the
// coder on sonnet, the scout on haiku, built-in helpers) are reported as otherModels.
// A builder run whose agent files cannot be read leaves V4 unmeasured (offModel null).
function modelChecks(roles, setup, pluginDir) {
  const declared = setup === 'solo' ? {} : declaredModels(pluginDir)
  const other = modelsOtherThanRound(roles)
  if (declared === null) return { offModel: null, otherModels: other }
  const held = role => role === 'main' || isOpus(declared[role])
  return { offModel: other.filter(o => held(o.role)), otherModels: other.filter(o => !held(o.role)) }
}

// The commit a run's arm must report: none for solo, the pin's base entry for base, the pin's own for team and max (V3).
const wantedCommit = (setup, pin) => (setup === 'solo' ? null : setup === 'base' ? pin.base?.pluginCommit ?? null : pin.pluginCommit ?? null)

// A void owed one rerun, or after that rerun (an attempts.json harness-bug entry with that reason) kept and reported.
const voidOrKept = (rule, broke, history) => {
  if (!broke) return { void: null, kept: null }
  return history.some(entry => entry?.kind === 'harness-bug' && entry.reason === rule) ? { void: null, kept: rule } : { void: rule, kept: null }
}

// The nx round's validity checks of one run, from its transcripts, its run.json and the round's pin:
// V1 leverFired (team on h8: it spawned only the reviewer and built-ins), V1b wokeBuilder (base on h8: one that woke no
// builder is void once), V2 nonBuiltin (solo: any spawn outside the pin's built-in agents is void once), V3 commit,
// V4 offModel (modelChecks), V5 timedOut. Only V1b and V2 void a run; the others are read by the bars.
export function validityOf({ setup, task, roles, run, pin, history = [] }) {
  const spawned = spawnedTypes(roles)
  const builtins = pin.setups?.solo?.agents ?? []
  const onDirectTask = DIRECT_TASKS.includes(task)
  const wokeBuilder = spawned.some(isBuilderType)
  const nonBuiltin = setup === 'solo' ? spawned.filter(type => !builtins.includes(type)) : null
  const rule = setup === 'base' && onDirectTask ? ['V1b', !wokeBuilder] : setup === 'solo' ? ['V2', nonBuiltin.length > 0] : [null, false]
  const want = wantedCommit(setup, pin)
  const got = run.pluginCommit ?? null
  const versionOk = setup === 'solo' ? (run.sectionTeam ?? null) === null : run.sectionTeam?.version === run.pluginVersion
  return {
    spawned,
    leverFired: setup === 'team' && onDirectTask ? spawned.every(type => type === REVIEWER || builtins.includes(type)) : null,
    wokeBuilder,
    nonBuiltin,
    ...voidOrKept(rule[0], rule[1], history),
    commit: { ok: got === want && versionOk, want, got },
    ...modelChecks(roles, setup, run.sectionTeam?.path),
    timedOut: run.timedOut === true,
  }
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

// results/<id>/attempts.json's entries, [] when there is none.
function readHistory(folder) {
  const text = unlessMissing(() => readFileSync(join(folder, 'attempts.json'), 'utf8'), '[]')
  try {
    const history = JSON.parse(text)
    return Array.isArray(history) ? history : []
  } catch (err) {
    throw new Error('attempts.json is not valid JSON', { cause: err })
  }
}

// A row's validity, with the round's pin: null when the run has no run.json or evidence to read.
function validityRow(folder, cond, task, readers, pin) {
  const run = attempt(() => readRunJson(folder))
  const session = run === undefined || run === FAILED ? FAILED : attempt(() => readers.session(folder))
  if (session === FAILED || session.roles === null) return null
  const history = attempt(() => readHistory(folder))
  return validityOf({ setup: setupOf(cond), task, roles: session.roles, run, pin, history: history === FAILED ? [] : history })
}

// One run's row: every run of the round gets one. No run.json, run folder or evidence is a no-data row; a file that
// does not parse or cannot be read names itself (run.json, session, mode record, run folder).
function runRow(folder, cond, task, readers, pin = null) {
  const row = faithfulRow(folder, cond, task, readers)
  return pin === null ? row : { ...row, validity: validityRow(folder, cond, task, readers, pin) }
}

function faithfulRow(folder, cond, task, readers) {
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
  const row = attempt(() => checkRun({ cond, task, roles: session.roles, runDir: run.dir, record, pluginVersion: run.sectionTeam?.version }))
  return row === FAILED ? unreadable('run folder') : row
}

// { [runId]: { cond, task, faithful, broken, tier } } for every solo, lean, team and max run of the round (cond and
// task from the run id). Throws one line when results/ cannot be read, or (a bug) naming the run it failed on.
export function modeCheck({ results = RESULTS, round, readers = {} }) {
  const use = { ...READERS, ...readers }
  const runId = new RegExp(`^([^-]+)-(solo|lean|team|max|base)-${round}-r\\d+$`)
  const pin = readRoundPin(results, round)
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
      return [id, { cond, task, ...runRow(join(results, id), cond, task, use, pin) }]
    } catch (err) {
      throw new Error(`${id}: ${err.message}`, { cause: err })
    }
  }))
}

// The round's pin beside its results when it names its setups (conds, since the nx round's preflight), else null: an
// older round's pin, such as the mode round's, gets no validity rows.
function readRoundPin(results, round) {
  const file = join(results, `preflight-${round}.json`)
  if (!existsSync(file)) return null
  let pin
  try {
    pin = JSON.parse(readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(`${file} is not valid JSON`, { cause: err })
  }
  return Array.isArray(pin?.conds) ? pin : null
}

// What a validity row adds to a run's line: a void with its rerun, a kept repeat, and V1, V3, V4 and V5 misses.
function validityLine(id, v) {
  if (!v) return v === null ? '  validity: no data' : ''
  return [
    v.void && `  void ${v.void}: rerun once with --rerun=${id} --reason=${v.void}`,
    v.kept && `  ${v.kept} repeated after its rerun: kept and reported`,
    v.leverFired === false && `  lever did not fire (spawned ${v.spawned.join(', ')})`,
    !v.commit.ok && `  commit ${v.commit.got ?? 'none'}, expected ${v.commit.want ?? 'none'} (or its version differs)`,
    v.offModel === null && '  models not checked (agent files unread)',
    v.offModel?.length > 0 && `  off-model ${v.offModel.map(o => `${o.role} ${o.model}`).join(', ')}`,
    v.timedOut && '  timed out',
  ].filter(Boolean).join('')
}

const lineOf = (id, row) => `${id}  ${row.faithful ? 'faithful' : 'not faithful'}  tier ${row.tier ?? '–'}${row.broken.length ? `  ${row.broken.join('; ')}` : ''}${validityLine(id, row.validity)}`

export function main(argv = process.argv.slice(2), { results, readers } = {}) {
  required({ results })
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

if (isMainModule(import.meta.url)) main(process.argv.slice(2), { results: RESULTS })
