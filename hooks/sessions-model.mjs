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
