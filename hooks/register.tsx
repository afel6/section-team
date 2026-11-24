import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'
import type { BoardCard, BoardData, ChatCard, ChatsData, Mode, SessionState, SessionStatus } from '../types'
import { boardModel, emptyBoard, formatTokens, latestReportFiles, sectionUsage, stripLine } from './board-model.mjs'
import { isHarnessFrame } from './lib/frames.mjs'
import { DEFAULT_MODE, MODE_FILE, modeName, OFF_MODE, parseModeFile, serializeMode } from './lib/mode.mjs'
import { applyName, DEFAULT_NAMES, listNames, namesFile, NO_HOME_LINE, NOT_READ_LINE, parseNames, serializeNames, UNREADABLE_LINE, unread } from './lib/names.mjs'
import { applyLook, DEFAULT_LOOK, describeLook, lookFile, NO_HOME_LOOK, NOT_VALID_LOOK, parseLook, serializeLook } from './lib/look.mjs'
import { parseReport, PREFIX } from './lib/report.mjs'
import { codeOf, MODE_OPTIONS, modeHint, modeSummary, notAFolder, savedLine, saveFailedLine, unknownModeLine, unreadableModeFile } from './mode-lines.mjs'
import { officeAlt, officeSvg, ORDER } from './office.mjs'
import { trackOffice } from './office-track.mjs'
import { dashboardCards, HIDE_MS, parseStatus, statusDir, statusRecord } from './sessions-model.mjs'

// The scan that lists a module's state reads an atom only when it is declared in this file.
const board = atom({ plugin: 'section-team', key: 'board' } as const, emptyBoard() as BoardData)
const chats = atom({ plugin: 'section-team', key: 'chats' } as const, { hasHome: true, cards: [] } as ChatsData)
const modeState = atom({ plugin: 'section-team', key: 'mode' } as const, DEFAULT_MODE as Mode)
const PANE = 'team-board'
const TITLE = 'Team Board'
const CHATS_PANE = 'team-chats'
const CHATS_TITLE = 'Chats'
const POLL_MS = 1000
const GIT_TIMEOUT_MS = 5000
const HEARTBEAT_MS = 60 * 1000
const MINUTE_MS = 60 * 1000
const COLOR = { asleep: 'inactive', running: 'suggestion', waiting: 'warning', done: 'success', problem: 'error' } as const
// A chat waiting for you is lit like a waiting section, a working one like a running section, an idle one like a sleeping section.
const CHAT_COLOR = { 'needs-you': COLOR.waiting, working: COLOR.running, idle: COLOR.asleep } as const
const CHAT_PILL: Record<SessionState, string> = { 'needs-you': 'needs you', working: 'working', idle: 'idle' }
// Three cards across a wide pane, two across a narrow one.
const cardWidth = (columns: number) => Math.max(18, Math.floor(columns / (columns >= 90 ? 3 : 2)) - 1)
const pad = (n: number) => String(n).padStart(2, '0')
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

// The git main root, as the command hooks find it; outside git, the session's project root, never the folder the session moved to.
async function findRoot($: EngineInterface, cwd: string, sessionRoot: string): Promise<string> {
  const result = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, timeoutMs: GIT_TIMEOUT_MS }).catch(() => undefined)
  const common = result?.exitCode === 0 ? result.stdout.trim() : ''
  return /[\\/]\.git$/.test(common) ? common.replace(/[\\/]\.git$/, '') : sessionRoot
}

// The one root the board's reports, the strip and /team mode use. A /cd or a host's directory change raises no event, so each use
// compares the session's cwd and root with the ones the root came from, and asks git again only when one of them moved.
async function projectRoot($: EngineInterface, ctx: Ctx): Promise<string> {
  const [cwd, sessionRoot] = [await $.session.cwd(), await $.session.root()]
  const from = `${cwd}\n${sessionRoot}`
  if (ctx.root === '' || from !== ctx.rootFrom) {
    ctx.root = await findRoot($, cwd, sessionRoot)
    ctx.rootFrom = from
  }
  return ctx.root
}

// The mode file's text, or null when there is none. Rejects when .team is not a folder (checked first: Windows says ENOENT under a
// file) or the file cannot be read. A failed stat or exists (no .team yet, or one that cannot be looked into) counts as no file here.
async function readModeText($: EngineInterface, root: string): Promise<string | null> {
  const teamStat = await $.fs.stat(`${root}/.team`).catch(() => undefined)
  if (teamStat !== undefined && teamStat.kind !== 'dir') throw notAFolder()
  const file = `${root}/${MODE_FILE}`
  return (await $.fs.exists(file)) ? $.fs.read(file) : null
}

// The mode file as the hooks read it, a file it cannot read being Balanced with the hooks' problem line.
const shownModeFile = ($: EngineInterface, root: string) => readModeText($, root).then(parseModeFile, unreadableModeFile)
// What /team mode shows: the mode the hooks will use (or Off) and the choices.
const describeMode = async ($: EngineInterface, ctx: Ctx) => modeSummary(await shownModeFile($, await projectRoot($, ctx)))

// Saves the project's mode where the command hooks read it, keeping the skill setting already there. Returns the one line to show.
async function setMode($: EngineInterface, ctx: Ctx, mode: string): Promise<string> {
  const unknown = unknownModeLine(mode)
  if (unknown !== null) return unknown
  let fromOff = false
  try {
    const root = await projectRoot($, ctx)
    const previous = await readModeText($, root)
    fromOff = parseModeFile(previous).off === true
    // $.fs has no rename, so this save is not atomic: a write cut off midway reads as Balanced with a problem line, as bad JSON does.
    await $.fs.write(`${root}/${MODE_FILE}`, serializeMode(previous, mode))
  } catch (error) {
    return saveFailedLine(error)
  }
  // The file is saved; if the picker cannot be set now, the next poll tick sets it from the file.
  await update($, modeState, () => mode as Mode).catch(() => undefined)
  return savedLine(mode, fromOff)
}

type Report = ReturnType<typeof parseReport>
type Spawn = { parentAgentId?: string; subagentType: string; model: string }
type Used = { total: number; out: number }
type Track = ReturnType<typeof trackOffice>['track']
// spawns, usage and the office's walk tracking live here, not in the atom: only the computed board is stored. spawns and usage are keyed by agent id.
type Ctx = {
  root: string; rootFrom: string; request: string; lastJson: string; lastError: string; lastNamesLog: string; lastLookLog: string; stop?: Timer
  board: BoardData; turnActive: boolean; mainTurnId: string; startedAt?: number; endedId?: string; lastStatus: string; lastWrite: number
  chatsOpen: boolean; lastChats: string
  cache: Map<string, { mtimeMs: number; report: Report }>; spawns: Map<string, Spawn>; usage: Map<string, Used>
  office: { track?: Track; office?: BoardData['office'] }
}

// A fresh session counts from zero. The poll is not touched: the board stays alive across a /clear.
function resetCounts(ctx: Ctx) {
  ctx.spawns.clear()
  ctx.usage.clear()
}

// Accounting is best effort: whatever goes wrong in it is dropped, so it can never reach the session. A count that is not a number reads as zero.
const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

function recordSpawn(ctx: Ctx, e: { parentAgentId?: string; subagentType: string }, result: { model?: string; agentId?: string; deny?: string }) {
  try {
    if (result.deny || !result.agentId) return
    ctx.spawns.set(result.agentId, { parentAgentId: e.parentAgentId, subagentType: e.subagentType, model: String(result.model ?? '') })
  } catch {
    // dropped on purpose
  }
}

function recordStep(ctx: Ctx, agentId: string | undefined, result: { usage?: Record<string, unknown> | null } | undefined) {
  try {
    const u = result?.usage
    if (!agentId || !u) return
    const out = count(u.output_tokens)
    const total = out + count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens)
    const before = ctx.usage.get(agentId)
    ctx.usage.set(agentId, { total: (before?.total ?? 0) + total, out: (before?.out ?? 0) + out })
  } catch {
    // dropped on purpose
  }
}

async function readReports($: EngineInterface, ctx: Ctx, root: string) {
  const dir = `${root}/.team/reports/${today()}`
  const entries = await $.fs.list(dir).catch(() => [])
  const { byId, summary } = latestReportFiles(entries)
  const reports: Record<string, Report> = {}
  for (const [id, name] of Object.entries(byId)) {
    const entry = entries.find(e => e.name === name)
    const key = `${dir}/${name}`
    const hit = ctx.cache.get(key)
    if (hit && hit.mtimeMs === entry?.mtimeMs) {
      reports[id] = hit.report
      continue
    }
    const text = await $.fs.read(key).catch(() => '')
    const report = parseReport(text)
    ctx.cache.set(key, { mtimeMs: entry?.mtimeMs ?? 0, report })
    reports[id] = report
  }
  const lastSummary = summary ? `${summary.slice(0, 2)}:${summary.slice(2, 4)}` : ''
  return { reports, lastSummary }
}

// The office picture, rebuilt only when trackOffice says so: between rebuilds its source stays the same, so its motion never restarts.
// Both maps hold all ten builders in ORDER, since trackOffice keys on their JSON as given. The track moves on only once the picture is
// built, so a tick whose drawing throws keeps the last picture and track, logs once, and rebuilds on the next one; the cards and the
// status file carry on without it.
function officeFor($: EngineInterface, ctx: Ctx, cards: BoardCard[], look: string, now: number) {
  const card = (id: string) => cards.find(c => c.kind === 'builder' && c.id === id)
  const states = Object.fromEntries(ORDER.map((id: string) => [id, card(id)?.state ?? 'asleep']))
  const names = Object.fromEntries(ORDER.map((id: string) => [id, card(id)?.name ?? '']))
  try {
    const { track, rebuild } = trackOffice(ctx.office.track, { states, names, look, now })
    if (rebuild) ctx.office.office = { source: officeSvg({ states, names, moves: track.moves, now, look }), alt: officeAlt({ states, names }) }
    ctx.office.track = track
  } catch (error) {
    logFailure($, ctx, 'office draw', error)
  }
  return ctx.office.office
}

async function refresh($: EngineInterface, ctx: Ctx) {
  const agents = await $.agent.list()
  // Looked up here, not at session.start, so the session start never waits on git.
  const root = await projectRoot($, ctx)
  const { reports, lastSummary } = await readReports($, ctx, root)
  // Read each tick, so a rename made in another chat shows here within a second.
  const { names } = await readNames($, ctx)
  const { look } = await readLook($, ctx)
  const usage = sectionUsage({ agents, spawns: Object.fromEntries(ctx.spawns), usage: Object.fromEntries(ctx.usage) })
  const model = boardModel({ agents, reports, request: ctx.request, lastSummary, usage, names })
  const next = { ...model, office: officeFor($, ctx, model.cards, look, await $.clock.now()) }
  ctx.board = next
  const json = JSON.stringify(next)
  if (json !== ctx.lastJson) {
    await update($, board, () => next)
    ctx.lastJson = json
  }
  await writeStatus($, ctx)
}

// The person's home folder, where the status files live. An empty USERPROFILE is not a home.
const homeDir = async ($: EngineInterface) => (await $.env.get('USERPROFILE')) || (await $.env.get('HOME'))

// The status file the /chats dashboard reads, one per session id under the home folder. It is written when anything but updatedAt changes,
// and every HEARTBEAT_MS while working, so a session that died goes stale. A session waiting for you is not rewritten: its updatedAt freezes
// and the dashboard turns it idle after IDLE_MS. Without a home there is nowhere to write: skipped, silently.
async function writeStatus($: EngineInterface, ctx: Ctx, ended?: { sessionId: string }) {
  const home = await homeDir($)
  if (!home) return
  const now = await $.clock.now()
  ctx.startedAt ??= now
  const sessionId = ended?.sessionId ?? (await $.session.id())
  // Seeing another id means the chat has moved on; seeing the ended one again (a /resume back to it) writes it afresh.
  if (!ended && sessionId !== ctx.endedId) ctx.endedId = undefined
  const record = statusRecord({ sessionId, cwd: await $.session.cwd(), request: ctx.request, board: ctx.board, turnActive: ctx.turnActive, startedAt: ctx.startedAt, now, ended: ended !== undefined })
  const key = JSON.stringify({ ...record, updatedAt: 0 })
  if (key === ctx.lastStatus && (record.state !== 'working' || now - ctx.lastWrite < HEARTBEAT_MS)) return
  // A tick that still answers the old id after the session ended (in flight, or before the id switches) must not un-end its file.
  if (!ended && sessionId === ctx.endedId) return
  await $.fs.write(`${statusDir(home)}/${sessionId}.json`, JSON.stringify(record))
  ctx.lastStatus = key
  ctx.lastWrite = now
}

// What the /chats pane shows: every status file under the home folder, cut down to the cards worth drawing. Only the chats pane being open
// makes the poll call this. A folder that is not there yet is no chats; a file that is cut off mid-write is skipped and read again next tick.
// ponytail: reads every file touched in the last 24 h each tick; add an mtime cache like readReports if that folder ever grows large.
async function refreshChats($: EngineInterface, ctx: Ctx) {
  const home = await homeDir($)
  const now = await $.clock.now()
  let next: ChatsData = { hasHome: false, cards: [] }
  if (home) {
    const dir = statusDir(home)
    const entries = await $.fs.list(dir).catch(() => [])
    // A file last written more than HIDE_MS ago holds an updatedAt older than that too: not worth reading. (A file with no mtime is read.)
    const fresh = entries.filter(e => e.name.endsWith('.json') && !(now - e.mtimeMs > HIDE_MS))
    const texts = await Promise.all(fresh.map(e => $.fs.read(`${dir}/${e.name}`).catch(() => '')))
    const records = texts.map(parseStatus).filter((r): r is SessionStatus => r !== undefined)
    next = { hasHome: true, cards: dashboardCards(records, now).map(r => ({ ...r, minutes: Math.max(0, Math.floor((now - r.startedAt) / MINUTE_MS)) })) }
  }
  const json = JSON.stringify(next)
  if (json === ctx.lastChats) return
  await update($, chats, () => next)
  ctx.lastChats = json
}

// Logged once per message, to the debug log only. Names and look problems keep slots of their own (lastNamesLog, lastLookLog): sharing
// lastError with another failure that keeps happening would make both log every tick.
function logFailure($: EngineInterface, ctx: Ctx, what: string, error: unknown, slot: 'lastError' | 'lastNamesLog' | 'lastLookLog' = 'lastError') {
  const message = error instanceof Error ? error.message : String(error)
  if (message === ctx[slot]) return
  ctx[slot] = message
  $.ui.log(`Team Board: ${what} failed: ${message}`, { to: 'debug' })
}

// The builders' names, saved per user under the home folder. Read as the mode file is, only when it exists. A file that cannot be read
// gives the default names and UNREADABLE_LINE, one that is not valid the names it could keep and its problem; both are logged once while
// they last. A clean read clears the slot, so a problem that comes back is logged again.
async function readNames($: EngineInterface, ctx: Ctx): Promise<{ names: Record<string, string>; problem: string | null }> {
  const home = await homeDir($)
  if (!home) return { names: { ...DEFAULT_NAMES }, problem: null }
  const file = namesFile(home)
  let text: string | null
  try {
    text = (await $.fs.exists(file)) ? await $.fs.read(file) : null
  } catch (error) {
    // The code alone: the engine's message carries an absolute path.
    logFailure($, ctx, 'names read', codeOf(error) ?? 'read refused', 'lastNamesLog')
    return { names: { ...DEFAULT_NAMES }, problem: UNREADABLE_LINE }
  }
  const parsed = parseNames(text)
  if (parsed.problem === null) ctx.lastNamesLog = ''
  else logFailure($, ctx, 'names read', parsed.problem, 'lastNamesLog')
  return parsed
}

// `/team name` alone lists the ten names, under the file's problem when it has one. With a section it renames that builder, or gives it
// its default name back when no name follows, and saves the names in the home folder. Returns the lines to show. A file whose names
// could not be read at all is never overwritten: saving the defaults plus one rename would wipe every other custom name in it.
async function nameCommand($: EngineInterface, ctx: Ctx, section: string | undefined, raw: string | undefined): Promise<string> {
  const { names, problem } = await readNames($, ctx)
  if (section === undefined) return problem === null ? listNames(names) : `${problem}\n${listNames(names)}`
  if (unread(problem)) return NOT_READ_LINE
  const { line, next } = applyName(names, section, raw)
  if (!next) return line
  const home = await homeDir($)
  if (!home) return NO_HOME_LINE
  try {
    // $.fs has no rename, so this save is not atomic, as the mode file's is not; the poll shows the new name on its next tick.
    await $.fs.write(namesFile(home), serializeNames(next))
  } catch (error) {
    // The code alone, as the mode line gives it: the engine's message carries an absolute path.
    return `Name not saved: ${codeOf(error) ?? 'the file system refused it'}.`
  }
  return line
}

// The office look, saved per user beside names.json and read each tick the same way. A file that cannot be read or is not valid
// draws night and is logged once while it lasts (lastLookLog).
async function readLook($: EngineInterface, ctx: Ctx): Promise<{ look: string; problem: string | null }> {
  const home = await homeDir($)
  if (!home) return { look: DEFAULT_LOOK, problem: null }
  const file = lookFile(home)
  let text: string | null
  try {
    text = (await $.fs.exists(file)) ? await $.fs.read(file) : null
  } catch (error) {
    // The code alone: the engine's message carries an absolute path.
    logFailure($, ctx, 'office look read', codeOf(error) ?? 'read refused', 'lastLookLog')
    return { look: DEFAULT_LOOK, problem: NOT_VALID_LOOK }
  }
  const parsed = parseLook(text)
  if (parsed.problem === null) ctx.lastLookLog = ''
  else logFailure($, ctx, 'office look read', parsed.problem, 'lastLookLog')
  return parsed
}

// `/team office` says which look the office has; `/team office <look>` saves another. The file holds only the look, so one that
// could not be read is simply replaced.
async function lookCommand($: EngineInterface, ctx: Ctx, raw: string | undefined): Promise<string> {
  const { look } = await readLook($, ctx)
  if (raw === undefined) return describeLook(look)
  const { line, next } = applyLook(look, raw)
  if (!next) return line
  const home = await homeDir($)
  if (!home) return NO_HOME_LOOK
  try {
    await $.fs.write(lookFile(home), serializeLook(next))
  } catch (error) {
    // The code alone, as the name line gives it: the engine's message carries an absolute path.
    return `Look not saved: ${codeOf(error) ?? 'the file system refused it'}.`
  }
  return line
}

async function pollChats($: EngineInterface, ctx: Ctx) {
  if (!ctx.chatsOpen) return
  try {
    await refreshChats($, ctx)
  } catch (error) {
    logFailure($, ctx, 'chats refresh', error)
  }
}

// The picker shows what the file says now, so an edit made outside it shows on the next tick. A pick made while the file was being
// read has already changed the picker since `before`: the older read then leaves it alone.
async function refreshMode($: EngineInterface, ctx: Ctx) {
  const before = await read($, modeState)
  const shown = await shownModeFile($, await projectRoot($, ctx))
  const mode = (shown.off ? OFF_MODE : shown.mode) as Mode
  if (mode !== before) await update($, modeState, current => (current === before ? mode : current))
}

// A failed tick is retried by the next one (lastJson, lastStatus and lastChats only move after a write lands). The mode and the chats come after the board and cannot hold it back.
async function poll($: EngineInterface, ctx: Ctx) {
  try {
    await refresh($, ctx)
  } catch (error) {
    logFailure($, ctx, 'refresh', error)
  }
  await refreshMode($, ctx).catch(error => logFailure($, ctx, 'mode refresh', error))
  await pollChats($, ctx)
}

// The poll starts with the session (/team and section spawns call this too), once. The session.end hook below only
// resets the counts on /clear; it never stops the poll (/clear starts no new session.start), and the timer ends with the process.
function startPoll($: EngineInterface, ctx: Ctx) {
  if (ctx.stop) return
  ctx.stop = $.clock.every(POLL_MS, () => {
    void poll($, ctx)
  })
}

export const register: Register = on => {
  const ctx: Ctx = { root: '', rootFrom: '', request: '', lastJson: '', lastError: '', lastNamesLog: '', lastLookLog: '', board: emptyBoard() as BoardData, turnActive: false, mainTurnId: '', lastStatus: '', lastWrite: 0, chatsOpen: false, lastChats: '', cache: new Map(), spawns: new Map(), usage: new Map(), office: {} }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'team', description: "Show the Team Board, set this project's mode (/team mode balanced|max|off), name a builder (/team name <section> <name>), or paint the office (/team office yellow|night)" })
    await $.command.register({ name: 'chats', description: 'Show every open chat as a card' })
    ctx.root = ''
    resetCounts(ctx)
    // A new session's first poll records no moves: nobody walks from where the last session left them. A /clear keeps the track.
    ctx.office = {}
    startPoll($, ctx)
    return next(e)
  })

  // The ended file is written first, while it still holds the request and the board of the session that is ending.
  // /clear ends the session and no session.start follows: its counts and its request start again, and the poll keeps running.
  on('session.end', async ($, e, next) => {
    ctx.endedId = e.sessionId // before the first await: writeStatus must see it from here on
    await writeStatus($, ctx, { sessionId: e.sessionId }).catch(error => logFailure($, ctx, 'status write', error))
    if (e.reason === 'clear') {
      resetCounts(ctx)
      ctx.request = ''
      ctx.startedAt = undefined
    }
    return next(e)
  })

  // The chat's own turn, not a helper's: it decides between working and needs-you in the status file.
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      ctx.mainTurnId = e.turnId
      ctx.turnActive = true
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.turnId === ctx.mainTurnId) ctx.turnActive = false
    return next(e)
  })

  // `/team mode` shows the mode, `/team mode <mode>` sets it; `/team name [<section> [<name>]]` lists or sets builder names; `/team office [<look>]` shows or sets the office look;
  // anything else opens the board, as before.
  on('command.run', { command: 'team' }, async ($, e) => {
    // A caller that sends no args at all (a test's $.command.run) means no arguments, as before.
    const args = (e.args ?? '').trim()
    const modeArgs = /^mode(?:\s+(.*))?$/s.exec(args)
    if (modeArgs) return { text: modeArgs[1] === undefined ? await describeMode($, ctx) : await setMode($, ctx, modeArgs[1]) }
    const nameArgs = /^name(?:\s+(\S+)(?:\s+(.+))?)?$/s.exec(args)
    if (nameArgs) return { text: await nameCommand($, ctx, nameArgs[1], nameArgs[2]) }
    const officeArgs = /^office(?:\s+(\S+))?$/.exec(args)
    if (officeArgs) return { text: await lookCommand($, ctx, officeArgs[1]) }
    startPoll($, ctx)
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Team Board opened.' }
  })

  // From here on the poll reads the status folder; the first read is done now so the pane opens with the chats in it.
  on('command.run', { command: 'chats' }, async $ => {
    ctx.chatsOpen = true
    startPoll($, ctx)
    await pollChats($, ctx)
    await $.ui.open({ id: CHATS_PANE, title: CHATS_TITLE })
    return { text: 'Chats opened.' }
  })

  // The pane is gone, however it closed: the poll stops reading the status folder until /chats opens it again.
  on('ui.close', { id: CHATS_PANE }, async ($, e, next) => {
    ctx.chatsOpen = false
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    recordSpawn(ctx, e, result)
    if (typeof e.subagentType !== 'string' || !e.subagentType.startsWith(PREFIX) || result.deny) return result
    startPoll($, ctx)
    return result
  })

  // Watches only: the stream and its result pass through as they are; the counts are added after the last chunk, and the 1 s poll shows them.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    recordStep(ctx, e.agentId, result)
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // A hand-back, a notification or another session's message is not the user's request: the task line keeps the last one.
    if (isHarnessFrame(e.text)) return next(e)
    const first = e.text.split(/\r?\n/).find(line => line.trim() !== '' && !line.startsWith('/'))
    if (first) ctx.request = first.trim().slice(0, 120)
    return next(e)
  })

  // The strip: one line above the prompt, drawn from the same stored board as the pane. A survey holds the band, so the strip yields to it.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const data = await read($, board)
    const mode = await read($, modeState)
    const pick = (value: string) => void setMode($, ctx, value).then(line => $.ui.toast(line)).catch(error => logFailure($, ctx, 'mode picker', error))
    // Mobile draws no Select (its table answers one with an empty box): there the mode is a button that names it and how to set it.
    // Not $.command.run: a plugin's own run skips the plugin's own command hook, so nothing would answer it.
    const picker = e.surface !== 'mobile' && 'Select' in table
      ? <table.Select key="mode" label="Mode" options={MODE_OPTIONS} value={mode} onSelect={pick} />
      : <Button key="mode" label={`● ${modeName(mode)}`} onPress={() => $.ui.toast(modeHint(mode))} />
    return (
      <Box key="strip" gap={1}>
        <Text wrap="truncate-end">{stripLine(data)}</Text>
        {picker}
        <Button key="open-board" label="Board" onPress={() => $.ui.open({ id: PANE, title: TITLE })} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Svg, Text } = $.ui.resolve(e)
    const data = await read($, board)
    // The terminal draws no Svg. Elsewhere the office, which shows the sleeping builders too, takes the asleep line's place.
    const office = e.surface === 'terminal' ? undefined : data.office
    const width = cardWidth(e.props.bodyColumns ?? 80)
    const card = (c: BoardCard) => (
      <Box key={`card-${c.id}`} width={width} flexDirection="column" paddingX={1} borderStyle={c.kind === 'advisor' ? 'dashed' : 'round'} borderColor={COLOR[c.state]}>
        {/* A board stored by an earlier version has no names on its cards: the header falls back to the id until the next tick. */}
        <Text bold color={COLOR[c.state]}>{c.kind === 'builder' && c.name ? `● ${c.name} · ${c.id}` : `● ${c.id}`}</Text>
        <Text wrap="truncate-end" dimColor={c.state === 'asleep'}>{c.line}</Text>
        {c.tokens ? <Text wrap="truncate-end" dimColor>{c.tokens}</Text> : null}
        {c.helpersLine ? <Text dimColor>{c.helpersLine}</Text> : null}
      </Box>
    )
    const counts = `${data.counts.active} active · ${data.counts.done} done · ${data.counts.problem} problem`
    // Sections nobody woke are one line, not a card each; a heading is drawn only when it has a card under it.
    const awake = data.cards.filter(c => c.state !== 'asleep')
    const asleep = data.cards.length - awake.length
    const group = (title: string, kind: BoardCard['kind']) => {
      const cards = awake.filter(c => c.kind === kind)
      return cards.length === 0 ? null : (
        <Box key={`group-${kind}`} flexDirection="column" gap={1}>
          <Text dimColor>{title}</Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>{cards.map(card)}</Box>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" gap={1}>
        <Box key="supervisor" flexDirection="column" paddingX={1} borderStyle="double" borderColor="claude">
          <Text bold>Supervisor</Text>
          <Text wrap="truncate-end">{data.request === '' ? 'Waiting for your next request' : `Task: ${data.request}`}</Text>
          <Text dimColor>{data.lastSummary === '' ? counts : `${counts} · last summary ${data.lastSummary}`}</Text>
          {data.teamLine ? <Text dimColor>{data.teamLine}</Text> : null}
        </Box>
        {office ? <Svg key="office" source={office.source} alt={office.alt} isInteractive /> : null}
        {group('Sections', 'builder')}
        {group('Advisors', 'advisor')}
        {office ? null : <Box key="asleep"><Text dimColor>{asleep} asleep</Text></Box>}
        <Box key="legend" flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text color={COLOR.running}>● running</Text>
          <Text color={COLOR.waiting}>● waiting</Text>
          <Text color={COLOR.done}>● done</Text>
          <Text color={COLOR.problem}>● problem</Text>
          <Text color={COLOR.asleep}>● asleep</Text>
        </Box>
      </Box>
    )
  })

  // The dashboard: one card per open chat, the ones waiting for you first (dashboardCards sorts), drawn from the chats the poll stored.
  on('ui.render', { component: 'Pane', requestId: CHATS_PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const data = await read($, chats)
    if (!data.hasHome) return <Box key="no-home"><Text>Chats need USERPROFILE or HOME to be set.</Text></Box>
    if (data.cards.length === 0) return <Box key="no-chats"><Text dimColor>No open chats.</Text></Box>
    const width = cardWidth(e.props.bodyColumns ?? 80)
    const card = (c: ChatCard) => {
      const sections = c.sections.map(s => `${s.id} ${s.state}`).join(', ') || 'no sections awake'
      const helpers = `${c.helpers} ${c.helpers === 1 ? 'helper' : 'helpers'}`
      return (
        <Box key={`chat-${c.sessionId}`} width={width} flexDirection="column" paddingX={1} borderStyle="round" borderColor={CHAT_COLOR[c.state]}>
          <Box gap={1}>
            <Text bold wrap="truncate-end">{c.project}</Text>
            <Text color={CHAT_COLOR[c.state]}>{CHAT_PILL[c.state]}</Text>
          </Box>
          <Text wrap="truncate-end">{c.request || 'No request yet'}</Text>
          <Text wrap="truncate-end" dimColor>{`${sections} · ${helpers}`}</Text>
          <Text dimColor>{`${c.minutes} min · ${formatTokens(c.tokens)} tokens`}</Text>
        </Box>
      )
    }
    return <Box key="chats" flexDirection="row" flexWrap="wrap" gap={1}>{data.cards.map(card)}</Box>
  })
}
