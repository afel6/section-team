import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

// The world beneath the plugin the board tests run in, shared by board.test.tsx and mode-picker.test.tsx.

// The status file the /chats dashboard reads: one JSON per session id, under the home folder.
export const STATUS_DIR = 'C:/Users/u/.claude/section-team/sessions'
export const T0 = 1_700_000_000_000
export const MINUTE = 60 * 1000
export const slashes = (path: string) => path.replaceAll('\\', '/')

const FILE = { kind: 'file', size: 1, mtimeMs: 1, isLink: false } as const
const REPORT = '## REPORT · backend\nStatus: done\nJob: /api/login + JWT\nHelpers used: sonnet ×2\n'
export const START = { cwd: 'C:/proj', surface: 'terminal', isInteractive: true } as const
export const SECTION = { prompt: 'x', description: 'login form', subagentType: 'section-team:frontend' } as const
export const OTHER = { prompt: 'x', description: 'login form', subagentType: 'general-purpose' } as const

// Answers, beneath the plugin, everything the board's poll reaches for; `seen` records what it asked.
export function world(on: On, now = 0) {
  const clock = mock.clock(on, { now })
  const seen = { listed: '', opened: [] as string[], agentList: 0, runs: [] as { argv: readonly string[]; timeoutMs?: number }[], logs: [] as { text: string; to: string }[], denySpawn: false,
    writes: [] as { path: string; text: string }[], env: { USERPROFILE: 'C:/Users/u' } as Record<string, string | undefined>, sessionId: 's1', denyWrite: undefined as string | undefined, registered: [] as string[],
    // The status folder the /chats pane reads: file texts by name (mtimes by name, T0 when not given), a refusal, and what was asked of it.
    chats: { files: {} as Record<string, string>, mtimes: {} as Record<string, number>, deny: undefined as string | undefined, lists: 0, reads: [] as string[] },
    agents: undefined as readonly object[] | undefined, spawnAnswer: undefined as ((e: { subagentType: string; parentAgentId?: string }) => { model: string; agentId?: string }) | undefined, stepUsage: null as unknown,
    // Where the session is, whether git finds a repository there, and the files on disk by path (a path holding text is a file, the folders above it exist).
    cwd: 'C:/proj', projectRoot: 'C:/proj', gitExit: 0, disk: {} as Record<string, string>, descriptions: {} as Record<string, string | undefined>, toasts: [] as string[] }
  const under = (path: string, dir: string) => path.startsWith(`${dir}/`)
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('session.cwd', async () => ({ value: seen.cwd }))
  on('session.root', async () => ({ value: seen.projectRoot }))
  on('session.id', async () => ({ value: seen.sessionId }))
  on('env.get', async (_$, e) => ({ value: seen.env[e.name] }))
  on('fs.write', async (_$, e) => {
    if (seen.denyWrite) return { deny: seen.denyWrite }
    // The engine hands the path over as the OS spells it (backslashes on Windows).
    const path = slashes(e.path)
    // A file where a folder should be: Windows says ENOENT, not ENOTDIR.
    if (Object.keys(seen.disk).some(file => under(path, file))) return { deny: 'ENOENT: no such file or directory' }
    seen.writes.push({ path, text: e.text })
    seen.disk[path] = e.text
    return { value: undefined }
  })
  on('fs.exists', async (_$, e) => ({ value: Object.keys(seen.disk).some(file => file === slashes(e.path) || under(file, slashes(e.path))) }))
  on('fs.stat', async (_$, e) => {
    const path = slashes(e.path)
    const kind = path in seen.disk ? 'file' : Object.keys(seen.disk).some(file => under(file, path)) ? 'dir' : undefined
    return kind ? { value: { kind, size: 1, mtimeMs: 1, isLink: false } } : { deny: 'ENOENT: no such file or directory' }
  })
  on('ui.toast', async (_$, e) => { seen.toasts.push(e.text); return { value: undefined } })
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('process.run', async (_$, e) => {
    seen.runs.push({ argv: e.argv, timeoutMs: e.init?.timeoutMs })
    const stdout = seen.gitExit === 0 ? 'C:/proj/.git\n' : ''
    return { value: { exitCode: seen.gitExit, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', async (_$, e) => {
    seen.registered.push(e.name)
    seen.descriptions[e.name] = e.description
    return { value: { command: e.name } }
  })
  on('agent.list', async () => {
    seen.agentList += 1
    return { value: seen.agents ?? [{ id: '1', type: 'section-team:frontend', status: 'running', description: 'login form' }, { id: '2', type: 'section-team:backend', status: 'completed', description: 'api' }] }
  })
  on('fs.list', async (_$, e) => {
    if (slashes(e.path) === STATUS_DIR) {
      seen.chats.lists += 1
      if (seen.chats.deny) return { deny: seen.chats.deny }
      return { value: Object.keys(seen.chats.files).map(name => ({ name, ...FILE, mtimeMs: seen.chats.mtimes[name] ?? T0 })) }
    }
    seen.listed = e.path
    return { value: [{ name: '101500-backend.md', ...FILE }, { name: '140200-supervisor-summary.md', ...FILE }] }
  })
  on('fs.read', async (_$, e) => {
    const path = slashes(e.path)
    if (!path.startsWith(`${STATUS_DIR}/`)) {
      if (path in seen.disk) return { value: seen.disk[path] }
      return path.endsWith('/mode.json') ? { deny: 'ENOENT: no such file or directory' } : { value: REPORT }
    }
    const name = path.slice(STATUS_DIR.length + 1)
    seen.chats.reads.push(name)
    return { value: seen.chats.files[name] }
  })
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('agent.spawn', async (_$, e) => (seen.denySpawn ? { deny: 'guard says no' } : seen.spawnAnswer?.(e) ?? { model: 'sonnet' }))
  // The model's answer to a step, beneath the plugin: one text chunk, then a result carrying the usage the test set.
  on('turn.step', async function* (_$, e) {
    yield { kind: 'text', index: 0, text: 'ok' } as const
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn', usage: seen.stepUsage as never }
  })
  on('ui.open', async (_$, e) => {
    seen.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.log', async (_$, e) => { seen.logs.push({ text: e.text, to: e.to }); return { value: undefined } })
  return { clock, seen }
}

export const BAND = { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} }
export type Strip = {
  find: (q: { key: string }) => Promise<{ text: string; props: Record<string, unknown> } | undefined>
  press: (t: { key: string }) => Promise<unknown>
  select: (t: { key: string; value: string }) => Promise<unknown>
}
export const mountStrip = ($: { ui: { mount: (t: never) => Promise<Strip> } }, props: object = BAND, surface = 'terminal') =>
  $.ui.mount({ plugin: 'section-team', surface, component: 'AbovePrompt', props } as never)
