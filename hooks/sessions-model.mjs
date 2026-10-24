export const IDLE_MS = 30 * 60 * 1000
export const HIDE_MS = 24 * 60 * 60 * 1000

export function statusDir(home) {
  return `${home}/.claude/section-team/sessions`
}

// A running turn or a busy section is working. Otherwise the chat waits for the person, until it has been quiet longer than IDLE_MS.
export function sessionState({ turnActive, anyRunning, updatedAt, now }) {
  if (turnActive || anyRunning) return 'working'
  return now - updatedAt > IDLE_MS ? 'idle' : 'needs-you'
}

// The order of the cards on the dashboard: the chats waiting for the person come first.
const RANK = { 'needs-you': 0, working: 1, idle: 2 }

// One status file's text back to a record, or undefined when it is cut off (another session is writing it) or is not a status record.
export function parseStatus(text) {
  let r
  try {
    r = JSON.parse(text)
  } catch {
    return undefined
  }
  const isSection = s => typeof s?.id === 'string' && typeof s.state === 'string'
  const ok = typeof r?.sessionId === 'string' && r.sessionId !== '' && typeof r.project === 'string' && typeof r.request === 'string' && typeof r.ended === 'boolean'
    && Object.hasOwn(RANK, r.state) && Array.isArray(r.sections) && r.sections.every(isSection)
    && [r.helpers, r.tokens, r.startedAt, r.updatedAt].every(Number.isFinite)
  return ok ? r : undefined
}

// What the /chats pane draws. Ended chats and chats quiet for over HIDE_MS are left out. A chat quiet for over IDLE_MS is idle whatever its file says:
// a waiting chat writes once and then stays still, and a working one that died stops its heartbeat. Records come back new; the input is not touched.
export function dashboardCards(records, now) {
  return records
    .filter(r => !r.ended && now - r.updatedAt <= HIDE_MS)
    .map(r => (now - r.updatedAt > IDLE_MS ? { ...r, state: 'idle' } : r))
    .sort((a, b) => RANK[a.state] - RANK[b.state] || b.updatedAt - a.updatedAt)
}

const REQUEST_MAX = 80

// What one session tells the /chats dashboard. Only the first line of the request, cut short, ever leaves the session.
export function statusRecord({ sessionId, cwd, request, board, turnActive, startedAt, now, ended = false }) {
  const awake = board.cards.filter(c => c.state !== 'asleep')
  return {
    sessionId,
    cwd,
    project: cwd.split(/[\\/]+/).filter(Boolean).at(-1) ?? '',
    request: request.split(/\r?\n/, 1)[0].slice(0, REQUEST_MAX),
    state: sessionState({ turnActive, anyRunning: awake.some(c => c.state === 'running' || c.state === 'waiting'), updatedAt: now, now }),
    sections: awake.map(c => ({ id: c.id, state: c.state })),
    helpers: board.team.helpers,
    tokens: board.team.tokens,
    startedAt,
    updatedAt: now,
    ended,
  }
}
