import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { homedir, totalmem } from 'node:os'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADVISOR_HELPERS, ADVISOR_IDS, BUILDER_IDS, HONEST_STATUSES, PREFIX, claimsDoneWithCode, extractReport, failsGate, needsGate, parseReport, reportHead, sectionIdFromType } from './lib/report.mjs'
import { gradeCheck } from './lib/grade.mjs'
import { ALLOW, headContextCheck } from './lib/head-context.mjs'
import { DEFAULT_MODE, GATES, activeMode, readMode } from './lib/mode.mjs'
import { FRESH_MS, LIMIT_VAR, MB, limitBytes, listerCommand, parseTable, sessionRoot } from './lib/memory-guard.mjs'
import { isSessionId, modeRecordDir, readRecord } from './lib/mode-record.mjs'
import { isMainModule, lineOf, projectDirOf, projectRoot, readStdinJson } from './lib/paths.mjs'
import { settingsVeto } from './lib/project-settings.mjs'

const MESSAGE_PREFIX = 'section-team pre-tool-use'
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'NotebookEdit'])
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const READ_ONLY_HELPERS = new Set(ADVISOR_HELPERS)

// The advisor's own memory folder (memory: local) under one root: <cwd>/.claude/agent-memory-local/<id or section-team-<id>>/.
// Claude Code builds that path from the agent's working folder, never the git main root; a missing or relative root allows nothing.
// path is injectable so tests can apply POSIX rules on any OS, where a backslash is part of a file name, not a separator.
export function isInMemory(target, id, cwd, path = nodePath) {
  if (typeof target !== 'string' || target === '' || typeof cwd !== 'string' || !path.isAbsolute(cwd)) return false
  const parts = path.relative(path.join(cwd, '.claude', 'agent-memory-local'), path.resolve(cwd, target)).split(path.sep)
  // The folder, then something inside it: a file named like the folder is not memory. '..' or another drive never equals the id.
  return parts.length >= 2 && (parts[0] === id || parts[0] === `section-team-${id}`)
}

const CANNOT_RUN = 'If the gate truly cannot run, hand back with `Status: ungraded` and say why.'
const fixRounds = n => `${n} fix round${n === 1 ? '' : 's'}`
const passRule = gate => `Pass: overall at least ${gate.passOverall}${gate.minItem === null ? '' : ` and no item under ${gate.minItem}`}.`
// A gate that sets reviewerModel names it; none does now, so every mode leaves it to the reviewer's own file.
const reviewerCall = gate => `\`run_in_background: false\` ${gate.reviewerModel === null ? '(do not pass `model`)' : `and \`model: "${gate.reviewerModel}"\``}`

// The handback gate's two refusals, worded from one mode's GATES entry.
export function gateReasons(gate) {
  return {
    ungraded: `section-team: your REPORT lists changed code but no reviewer grade, so it cannot be handed back yet. Run Agent \`section-team:reviewer\` on your changed files with ${reviewerCall(gate)} and wait for its GRADE. ${passRule(gate)} If it fails, have a coder apply the fix list and grade again, at most ${fixRounds(gate.fixRounds)}. Then hand back with \`Quality: <overall>/10 (reviewer, <n> fix rounds)\`. The testing section's final review does not replace your own gate. ${CANNOT_RUN}`,
    failing: `section-team: your REPORT says done, but its reviewer grade is under the pass mark (${gate.passOverall}/10). Give the fix list to a coder and grade again with a new Agent \`section-team:reviewer\` call with ${reviewerCall(gate)}, at most ${fixRounds(gate.fixRounds)} in all. Never SendMessage the earlier reviewer: that resumes it in the background and you are made to hand back unfinished. ${CANNOT_RUN} If it still fails, hand back with \`Status: partial\` and the grade; start the Quality line with the final grade.`,
  }
}

// The mode the session runs in, from its record; null when there is none to use (no record, a bad session id, a broken record).
// Falling back is the rule here, not a lost error: user-prompt-submit reports a broken record on every prompt.
function recordedMode(home, sessionId) {
  try {
    return activeMode(readRecord(home, sessionId))
  } catch {
    return null
  }
}

// The gate of the session's project (CLAUDE_PROJECT_DIR, else the event's cwd): its mode file's mode when usable (no file is Balanced),
// else the session's recorded mode, so a file that breaks mid-session keeps the gate the supervisor works to, else Balanced.
function projectGate(e, env, home) {
  const dir = projectDirOf(e, env)
  const setting = dir === null ? null : readMode(projectRoot(dir))
  // A project switched off mid-session keeps the gate the session started with, as an unusable file does.
  if (setting?.modeUsable && !setting.off) return GATES[setting.mode]
  return GATES[recordedMode(home, e.session_id) ?? DEFAULT_MODE]
}

// The 2026-11-09 p1 round: 1.6–7.2K-character narratives above builder REPORTs filled the supervisor's context.
const HANDBACK_HEAD_MAX = 1200
const LONG_HEAD_REASON = `section-team: your hand-back has more than ${HANDBACK_HEAD_MAX} characters above its REPORT block. Move the long part (probe logs, spec readings, flow output) to \`.team/reports/<date>/<time>-<your id>-details.md\`, name that file on the Next line, and hand back again with at most 5 short lines above the block.`

const refuse = reason => ({ reason, notice: null })

// The clean-code gate, enforced where the REPORT leaves the section: a code REPORT that is ungraded, claims done under the mode's pass mark,
// claims a grade its own transcript does not back, or claims done while the reviewer scored an item under the mode's item minimum is refused.
// A hand-back that claims done with a long text above its REPORT is refused first; partial, blocked and ungraded stay the
// honest ways out, and one with no REPORT is not checked here. Returns a verdict, or null when this is no builder hand-back with a REPORT.
function handbackGate(id, e, env, home) {
  if (e.tool_name !== 'SubagentHandback' || !BUILDER_IDS.includes(id)) return null
  const message = e.tool_input?.message
  const block = extractReport(message)
  if (!block) return null
  const report = parseReport(block)
  if (!HONEST_STATUSES.includes(report.status) && reportHead(message).length > HANDBACK_HEAD_MAX) return refuse(LONG_HEAD_REASON)
  const gate = projectGate(e, env, home)
  const gradeAll = gate.gradeAll === true
  if (needsGate(report, gradeAll)) return refuse(gateReasons(gate).ungraded)
  if (failsGate(report, gate.passOverall, gradeAll)) return refuse(gateReasons(gate).failing)
  return claimsDoneWithCode(report, gradeAll) ? gradeCheck(e, report.quality, gate) : ALLOW
}

const FOREGROUND_REASON = 'section-team: run helpers in the foreground: pass `run_in_background: false` (or leave it out), never `true`. Independent helpers launched together in one message still run in parallel. A section that ends its turn while a helper runs is made to hand back unfinished.'

// A section that waits on a background helper ends its turn, and the harness then forces an unfinished handback.
// Only an explicit request is refused: some Agent tools (the desktop app's) have no run_in_background option and strip it.
function foregroundRule(e) {
  return e.tool_name === 'Agent' && e.tool_input?.run_in_background === true ? FOREGROUND_REASON : null
}

function advisorRule(id, e, env) {
  if (!ADVISOR_IDS.includes(id)) return null
  const tool = e.tool_name
  if (SHELL_TOOLS.has(tool)) return `section-team: the ${id} advisor is read-only; ${tool} is not allowed.`
  if (WRITE_TOOLS.has(tool)) {
    // Claude Code builds local memory from the agent's working folder (the event's cwd); the session's project dir counts too.
    const inMemory = [e.cwd, projectDirOf(e, env)].some(root => isInMemory(e.tool_input?.file_path, id, root))
    return inMemory ? null : `section-team: the ${id} advisor may only write inside its memory folder.`
  }
  if (tool === 'Agent' && !READ_ONLY_HELPERS.has(e.tool_input?.subagent_type)) {
    return `section-team: the ${id} advisor may only use read-only helpers (${ADVISOR_HELPERS.join(', ')}).`
  }
  return null
}

// The verdict on one call: reason (deny with it) and notice (one line for the user when a rule could not check), each null when not given.
// home is where the session mode records live; tests pass a temp folder.
export function check(e, env = process.env, home = homedir()) {
  // Before the agent_type test: a supervisor's call has no agent_type, and the rule words its refusal for either caller.
  if (e?.tool_name === 'SendMessage') return headContextCheck(e)
  if (typeof e?.agent_type !== 'string' || !e.agent_type.startsWith(PREFIX)) return ALLOW
  const id = sectionIdFromType(e.agent_type)
  if (!id) return ALLOW
  return handbackGate(id, e, env, home) ?? refuse(advisorRule(id, e, env) ?? foregroundRule(e))
}

// The deny reason alone, or null.
export const decide = (e, env = process.env, home = homedir()) => check(e, env, home).reason

// The session memory guard. The first Bash or PowerShell call by a section (not an advisor) claims the session's record and starts
// one detached runner (memory-guard.mjs); the runner touches the record on every scan, so a fresh record means one is running.
const GUARD_TOOLS = new Set(['Bash', 'PowerShell'])
const RETRY_MS = 10 * 60 * 1000
const LIST_TIMEOUT_MS = 4000
const LIST_BUFFER = 64 * MB
const RUNNER = fileURLToPath(new URL('./memory-guard.mjs', import.meta.url))
const GUARD_LOG = ['.team', 'tmp', 'memory-guard.log']
const GUARD_SUFFIX = '.guard.json'

const wantsGuard = e => GUARD_TOOLS.has(e?.tool_name) && typeof e.agent_type === 'string' && e.agent_type.startsWith(PREFIX)
  && !ADVISOR_IDS.includes(e.agent_type.slice(PREFIX.length)) && isSessionId(e.session_id)

const mtimeOrNull = file => {
  try {
    return statSync(file).mtimeMs
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

// A new file opened for writing, or null when it already exists.
const openNew = file => {
  try {
    return openSync(file, 'wx')
  } catch (err) {
    if (err.code === 'EEXIST') return null
    throw err
  }
}

// A failed start written less than RETRY_MS ago; an unreadable record is no failure.
function recentFailure(record, now) {
  try {
    const at = JSON.parse(readFileSync(record, 'utf8'))?.failed?.at
    return Number.isFinite(at) && now - at < RETRY_MS
  } catch {
    return false
  }
}

// An open descriptor on the session's record when this caller wins it, else null. A stale record is taken over by the one caller that
// creates the takeover file named for that record's modified time; the modes folder's weekly prune removes it.
function claim(record, now) {
  mkdirSync(nodePath.dirname(record), { recursive: true })
  const fd = openNew(record)
  if (fd !== null) return fd
  const mtime = mtimeOrNull(record)
  if (mtime === null) return openNew(record)
  if (now - mtime < FRESH_MS || recentFailure(record, now)) return null
  const lock = openNew(`${record.slice(0, -GUARD_SUFFIX.length)}.guard-takeover-${Math.trunc(mtime)}.json`)
  if (lock === null) return null
  closeSync(lock)
  try {
    unlinkSync(record)
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return openNew(record)
}

// Finds the root, writes the record and starts the runner; a failure goes into the record (the hook does not try again for RETRY_MS).
function startGuard(fd, record, e, env, deps, limit) {
  try {
    const dir = projectDirOf(e, env)
    if (dir === null) throw new Error('no project folder for its log')
    const root = sessionRoot(deps.list(), deps.pid)
    if (root === null) throw new Error('no claude or node process above this hook')
    // The claim names this guard: a runner whose record names another (a takeover) exits.
    writeSync(fd, JSON.stringify({ root, limit, log: nodePath.join(projectRoot(dir), ...GUARD_LOG), claim: randomUUID() }))
    closeSync(fd)
    fd = null
    deps.spawn(record)
    return null
  } catch (err) {
    if (fd !== null) closeSync(fd)
    writeFileSync(record, JSON.stringify({ failed: { at: deps.now(), problem: lineOf(err) } }))
    return `memory guard not started, tried again in 10 minutes: ${lineOf(err)}`
  }
}

// A limit the guard cannot use, or one the project's settings may have set, leaves it off, so its line is said on the first call of each
// session that would have started it. The marker ends in .json so the modes folder's weekly prune removes it.
function badLimitOnce(home, sessionId, problem) {
  const dir = modeRecordDir(home)
  mkdirSync(dir, { recursive: true })
  const marker = openNew(nodePath.join(dir, `${sessionId}.limit-said.json`))
  if (marker === null) return null
  closeSync(marker)
  return problem
}

const GUARD_OFF = 'the memory guard stays off'

// Why the session's project keeps the guard off, or null. Claude Code hands a project's .claude settings env to the hooks, so a limit set
// there cannot be told from the user's own, and HOME or USERPROFILE set there choose the home folder whose settings pass for the user's.
// A check that fails keeps the guard off as well. No project folder is no veto: startGuard then fails with its own line.
function projectGuardVeto(e, env, home) {
  const dir = projectDirOf(e, env)
  if (dir === null) return null
  try {
    const name = settingsVeto(dir, LIMIT_VAR, home)
    if (name === null) return null
    return name === LIMIT_VAR
      ? `this project's .claude settings set ${LIMIT_VAR}, which only your own ~/.claude/settings.json may set; ${GUARD_OFF}`
      : `this project's .claude settings set ${name}, which decides where your home folder is; ${GUARD_OFF}`
  } catch (err) {
    return `project settings check failed: ${lineOf(err)}; ${GUARD_OFF}`
  }
}

// Starts the session's memory guard when this call should and none runs; never denies. deps carries every effect: home (the record folder's home),
// platform, totalBytes, now, pid (this hook's), list (the process table) and spawn (starts the runner on a record file).
// Returns one line for the user, or null.
export function ensureGuard(e, env, deps) {
  if (!wantsGuard(e)) return null
  const { bytes, problem } = limitBytes(env, deps.totalBytes, deps.platform)
  if (bytes === null) return problem === null ? null : badLimitOnce(deps.home, e.session_id, problem)
  const record = nodePath.join(modeRecordDir(deps.home), `${e.session_id}${GUARD_SUFFIX}`)
  const mtime = mtimeOrNull(record)
  if (mtime !== null && deps.now() - mtime < FRESH_MS) return null
  // ponytail: a vetoed session checks its folders again (a few git calls) on each section shell call; keep a marker here if that shows.
  const veto = projectGuardVeto(e, env, deps.home)
  if (veto !== null) return badLimitOnce(deps.home, e.session_id, veto)
  const fd = claim(record, deps.now())
  if (fd === null) return null
  return startGuard(fd, record, e, env, deps, bytes) ?? problem
}

function listOnce(platform) {
  const { file, args, env } = listerCommand(platform)
  const out = execFileSync(file, args, { input: '\n', encoding: 'utf8', timeout: LIST_TIMEOUT_MS, windowsHide: true, env: { ...process.env, ...env }, maxBuffer: LIST_BUFFER, stdio: ['pipe', 'pipe', 'ignore'] })
  return parseTable(platform, out)
}

// The runner outlives this hook: detached, no shared output, its folder the record's.
function spawnRunner(record) {
  const child = spawn(process.execPath, [RUNNER, record], { detached: true, stdio: 'ignore', windowsHide: true, cwd: nodePath.dirname(record) })
  child.once('error', err => writeFileSync(record, JSON.stringify({ failed: { at: Date.now(), problem: lineOf(err) } })))
  child.unref()
}

const realGuardDeps = () => ({
  home: homedir(), platform: process.platform, totalBytes: totalmem(), now: Date.now, pid: process.pid,
  list: () => listOnce(process.platform), spawn: spawnRunner,
})

function guardNotice(e) {
  try {
    return ensureGuard(e, process.env, realGuardDeps())
  } catch (err) {
    return `memory guard not started: ${lineOf(err)}`
  }
}

// A builder's scratch folder, .team/tmp/<id>/, made where a relative path in its command resolves: the event's cwd when absolute
// (in a worktree session, the worktree), else the project dir. No git call, since this runs on every tool call; never throws or denies.
export function ensureScratch(e, env = process.env) {
  try {
    const id = sectionIdFromType(e?.agent_type)
    if (!BUILDER_IDS.includes(id)) return null
    const base = typeof e.cwd === 'string' && nodePath.isAbsolute(e.cwd) ? e.cwd : projectDirOf(e, env)
    if (base !== null) mkdirSync(nodePath.join(base, '.team', 'tmp', id), { recursive: true })
    return null
  } catch (err) {
    return `scratch folder not made: ${lineOf(err)}`
  }
}

const notice = text => process.stdout.write(JSON.stringify({ systemMessage: `${MESSAGE_PREFIX}: ${text}` }))

// The user's one line: the hook's own notes behind its name, then a rule's notice, which is a whole sentence of its own.
const messageOf = (notes, ruleNotice) => [notes.length > 0 ? `${MESSAGE_PREFIX}: ${notes.join('; ')}` : null, ruleNotice].filter(Boolean).join(' ')

const denial = reason => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } })

// An advisor's write is the one call that fails closed: the rule that would refuse it is the one that broke. Only agent_type and
// tool_name are read here, so a broken tool_input cannot break this check too.
const isAdvisorWrite = e => ADVISOR_IDS.includes(sectionIdFromType(e.agent_type)) && WRITE_TOOLS.has(e.tool_name)

function onRuleError(e, err) {
  if (isAdvisorWrite(e)) return process.stdout.write(JSON.stringify(denial(`section-team: the advisor check failed (${lineOf(err)}), so this write was refused.`)))
  return notice(`no rule was checked: ${lineOf(err)}`)
}

// A hook that cannot check says so in one line and denies nothing, except an advisor's write.
async function main() {
  const e = await readStdinJson()
  if (typeof e !== 'object' || e === null || Array.isArray(e)) return notice('the hook input is not a JSON object, so no rule was checked')
  try {
    const notes = [guardNotice(e), ensureScratch(e)].filter(Boolean)
    const { reason, notice: ruleNotice } = check(e)
    const message = messageOf(notes, ruleNotice)
    const out = { ...(message ? { systemMessage: message } : {}), ...(reason ? denial(reason) : {}) }
    if (message || reason) process.stdout.write(JSON.stringify(out))
  } catch (err) {
    onRuleError(e, err)
  }
}

if (isMainModule(import.meta.url)) {
  // Reaches here only when reading the input fails, or an agent_type or tool_name that cannot be read breaks the advisor test: no event to judge.
  main().catch(err => notice(`no rule was checked: ${lineOf(err)}`))
}
