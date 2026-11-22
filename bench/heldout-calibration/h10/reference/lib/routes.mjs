// The routes. A handler gets { state, id, headers, body } and returns { status, body?, page?, state? }: a new state
// when something changed (the old one is never modified), which the server saves before replying.
import { readFileSync } from 'node:fs'
import { HttpError, jsonObject } from './http.mjs'
import { parseNewPoll, parseVote, viewPoll } from './polls.mjs'

const asset = (name, type) => ({ type, text: readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8') })
const PAGE = asset('index.html', 'text/html; charset=utf-8')
const SCRIPT = asset('app.js', 'text/javascript; charset=utf-8')
const ID = /^[1-9][0-9]*$/

function findPoll(state, id) {
  const poll = ID.test(id) ? state.polls.find(p => p.id === Number(id)) : undefined
  if (!poll) throw new HttpError(404, 'poll not found')
  return poll
}

const withPoll = (state, poll) => ({ ...state, polls: state.polls.map(p => (p.id === poll.id ? poll : p)) })

const listPolls = ({ state }) => ({ status: 200, body: { polls: state.polls.toSorted((a, b) => b.id - a.id).map(viewPoll) } })

function createPoll({ state, headers, body }) {
  const { question, answers } = parseNewPoll(jsonObject(headers, body))
  const poll = { id: state.nextId, question, closed: false, answers, votes: [] }
  return { status: 201, body: viewPoll(poll), state: { ...state, nextId: state.nextId + 1, polls: [...state.polls, poll] } }
}

const getPoll = ({ state, id }) => ({ status: 200, body: viewPoll(findPoll(state, id)) })

function addVote({ state, id, headers, body }) {
  const poll = findPoll(state, id)
  const vote = parseVote(jsonObject(headers, body), poll)
  const voted = { ...poll, votes: [...poll.votes, vote] }
  return { status: 201, body: viewPoll(voted), state: withPoll(state, voted) }
}

function closePoll({ state, id }) {
  const poll = findPoll(state, id)
  if (poll.closed) return { status: 200, body: viewPoll(poll) }
  const closed = { ...poll, closed: true }
  return { status: 200, body: viewPoll(closed), state: withPoll(state, closed) }
}

function deletePoll({ state, id }) {
  const poll = findPoll(state, id)
  return { status: 204, state: { ...state, polls: state.polls.filter(p => p !== poll) } }
}

const POLL_PATH = /^\/api\/polls\/([^/]+)$/
const VOTES_PATH = /^\/api\/polls\/([^/]+)\/votes$/
const CLOSE_PATH = /^\/api\/polls\/([^/]+)\/close$/

// The handlers of a path by method, and the <id> in it; null for an unknown path.
function match(path) {
  if (path === '/') return { handlers: { GET: () => ({ status: 200, page: PAGE }) } }
  if (path === '/app.js') return { handlers: { GET: () => ({ status: 200, page: SCRIPT }) } }
  if (path === '/api/polls') return { handlers: { GET: listPolls, POST: createPoll } }
  const [poll, votes, close] = [POLL_PATH, VOTES_PATH, CLOSE_PATH].map(re => re.exec(path)?.[1])
  if (poll !== undefined) return { id: poll, handlers: { GET: getPoll, DELETE: deletePoll } }
  if (votes !== undefined) return { id: votes, handlers: { POST: addVote } }
  if (close !== undefined) return { id: close, handlers: { POST: closePoll } }
  return null
}

export function handle({ state, method, path, headers, body }) {
  const route = match(path)
  if (!route) throw new HttpError(404, 'not found')
  if (!Object.hasOwn(route.handlers, method)) throw new HttpError(405, 'method not allowed')
  return route.handlers[method]({ state, id: route.id, headers, body })
}
