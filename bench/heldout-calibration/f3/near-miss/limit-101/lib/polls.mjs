// The poll handlers. Each takes { store, params, query, body } and returns { status, body?, store? }; a returned
// store is the new state to save. Handlers never change the store they get.
import { HttpError } from './http.mjs'

const MAX_VOTES = 100
const QUESTION = { min: 1, max: 200 }
const OPTIONS = { min: 2, max: 10, length: 100 }
const VOTER = /^[a-z0-9_]{1,32}$/

const MSG = {
  question: 'question must be a string of 1 to 200 characters',
  options: 'options must be 2 to 10 different strings of 1 to 100 characters',
  voter: 'voter must be 1 to 32 characters of a-z, 0-9 and _',
  option: 'option must be a string',
}

const bad = message => { throw new HttpError(400, message) }

function checkFields(body, allowed) {
  const extra = Object.keys(body).find(k => !allowed.includes(k))
  if (extra !== undefined) bad(`unknown field ${extra}`)
}

function parseQuestion(v) {
  const q = typeof v === 'string' ? v.trim() : ''
  return q.length >= QUESTION.min && q.length <= QUESTION.max ? q : bad(MSG.question)
}

function parseOptions(v) {
  if (!Array.isArray(v) || v.length < OPTIONS.min || v.length > OPTIONS.max) bad(MSG.options)
  const opts = v.map(o => (typeof o === 'string' ? o.trim() : ''))
  if (opts.some(o => o.length < 1 || o.length > OPTIONS.length)) bad(MSG.options)
  if (new Set(opts.map(o => o.toLowerCase())).size !== opts.length) bad(MSG.options)
  return opts
}

export const view = p => ({
  id: p.id,
  question: p.question,
  options: [...p.options],
  closed: p.closed,
  results: p.options.map(option => ({ option, votes: p.votes.filter(v => v.option === option).length })),
  total: p.votes.length,
})
const summary = p => ({ id: p.id, question: p.question, closed: p.closed, total: p.votes.length })

function findPoll(store, idText) {
  const poll = /^[1-9]\d{0,14}$/.test(idText) ? store.polls.find(p => p.id === Number(idText)) : undefined
  if (!poll) throw new HttpError(404, 'poll not found')
  return poll
}

const replacePoll = (store, poll) => ({ ...store, polls: store.polls.map(p => (p.id === poll.id ? poll : p)) })

export function createPoll({ store, body }) {
  checkFields(body, ['question', 'options'])
  const question = parseQuestion(body.question)
  const options = parseOptions(body.options)
  const poll = { id: store.nextId, question, options, closed: false, votes: [] }
  return { status: 201, body: view(poll), store: { nextId: store.nextId + 1, polls: [...store.polls, poll] } }
}

export function listPolls({ store, query }) {
  const status = query.get('status')
  if (status !== null && status !== 'open' && status !== 'closed') bad('status must be open or closed')
  const keep = p => status === null || p.closed === (status === 'closed')
  return { status: 200, body: { polls: store.polls.filter(keep).map(summary) } }
}

export const getPoll = ({ store, params }) => ({ status: 200, body: view(findPoll(store, params.id)) })

export function vote({ store, params, body }) {
  checkFields(body, ['voter', 'option'])
  if (typeof body.voter !== 'string' || !VOTER.test(body.voter)) bad(MSG.voter)
  if (typeof body.option !== 'string') bad(MSG.option)
  const poll = findPoll(store, params.id)
  if (!poll.options.includes(body.option)) bad('unknown option')
  if (poll.closed) throw new HttpError(409, 'poll closed')
  if (poll.votes.some(v => v.voter === body.voter)) throw new HttpError(409, 'already voted')
  if (poll.votes.length > MAX_VOTES) throw new HttpError(409, 'poll is full')
  const next = { ...poll, votes: [...poll.votes, { voter: body.voter, option: body.option }] }
  return { status: 201, body: { poll: poll.id, voter: body.voter, option: body.option }, store: replacePoll(store, next) }
}

export function retract({ store, params }) {
  const poll = findPoll(store, params.id)
  if (poll.closed) throw new HttpError(409, 'poll closed')
  if (!poll.votes.some(v => v.voter === params.voter)) throw new HttpError(404, 'vote not found')
  const next = { ...poll, votes: poll.votes.filter(v => v.voter !== params.voter) }
  return { status: 204, store: replacePoll(store, next) }
}

export function closePoll({ store, params }) {
  const poll = findPoll(store, params.id)
  if (poll.closed) throw new HttpError(409, 'poll closed')
  const next = { ...poll, closed: true }
  return { status: 200, body: view(next), store: replacePoll(store, next) }
}
