export type CardState = 'asleep' | 'running' | 'waiting' | 'done' | 'problem'
export type BoardCard = { id: string; kind: 'builder' | 'advisor'; state: CardState; line: string; helpers: string; tokens: string; helpersLine: string }
export type BoardData = {
  request: string
  lastSummary: string
  cards: BoardCard[]
  counts: { active: number; done: number; problem: number }
  teamLine: string
}

declare module 'claude-code' {
  interface PluginState {
    'section-team': { board: BoardData }
  }
}
