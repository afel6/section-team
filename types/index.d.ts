export type CardState = 'asleep' | 'running' | 'waiting' | 'done' | 'problem'
// name is the creature's name for a builder, the id for an advisor.
export type BoardCard = { id: string; kind: 'builder' | 'advisor'; name: string; state: CardState; line: string; tokens: string; helpersLine: string }
// office is the office picture (its SVG source and alt text), when the poll has built one.
export type BoardData = {
  request: string
  lastSummary: string
  cards: BoardCard[]
  counts: { active: number; done: number; problem: number }
  teamLine: string
  team: { tokens: number; helpers: number }
  office?: { source: string; alt: string }
}

// One session's status file, read by the /chats dashboard. Times are milliseconds since the epoch.
export type SessionState = 'working' | 'needs-you' | 'idle'
export type SessionStatus = {
  sessionId: string
  cwd: string
  project: string
  request: string
  state: SessionState
  sections: { id: string; state: CardState }[]
  helpers: number
  tokens: number
  startedAt: number
  updatedAt: number
  ended: boolean
}

// What the /chats pane draws: the cards the dashboard shows, each with how long its chat has been open. hasHome is false when there is no folder to read.
export type ChatCard = SessionStatus & { minutes: number }
export type ChatsData = { hasHome: boolean; cards: ChatCard[] }

// The project's quality mode, as .team/mode.json names it; the strip's picker shows it.
export type Mode = 'balanced' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'section-team': { board: BoardData; chats: ChatsData; mode: Mode }
  }
}
