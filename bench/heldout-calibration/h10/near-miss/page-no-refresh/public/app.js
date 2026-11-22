// Quick polls page: lists the polls, shows one, and votes, closes and creates polls through the JSON API.
'use strict'

const NO_REPLY = 'Could not reach the server.'
const FAILED = 'Request failed.'
const byId = id => document.getElementById(id)
const els = {
  form: byId('poll-form'), newQuestion: byId('question'), answers: byId('answers'), create: byId('create'), list: byId('poll-list'),
  question: byId('poll-question'), results: byId('results'), voter: byId('voter'), close: byId('close-poll'), error: byId('error'),
}
// The id of the poll shown, which the next vote or close is for.
let shownId = null

const showError = message => { els.error.textContent = message }
const jsonRequest = data => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

// Sends one request: { ok: true, body } on okStatus, otherwise { ok: false, message }. A reply whose body is not JSON
// counts as no reply.
async function call(url, okStatus, options) {
  let reply
  let body
  try {
    reply = await fetch(url, options)
    body = await reply.json()
  } catch {
    return { ok: false, message: NO_REPLY }
  }
  if (reply.status === okStatus) return { ok: true, body }
  const isObject = body !== null && typeof body === 'object' && !Array.isArray(body)
  return { ok: false, message: isObject && typeof body.error === 'string' ? body.error : FAILED }
}

function button(text, onClick) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = text
  b.addEventListener('click', onClick)
  return b
}

function item(...nodes) {
  const li = document.createElement('li')
  li.append(...nodes)
  return li
}

function renderList(polls) {
  if (polls.length === 0) {
    els.list.replaceChildren(item('No polls yet.'))
    return
  }
  els.list.replaceChildren(...polls.map(poll =>
    item(`${poll.question} (${poll.total} votes${poll.closed ? ', closed' : ''})`, button('Open', () => openPoll(poll.id)))))
}

async function loadList() {
  const r = await call('/api/polls', 200)
  if (r.ok) renderList(r.body.polls)
  else showError(r.message)
}

function showPoll(poll) {
  shownId = poll.id
  els.question.textContent = poll.question
  els.results.replaceChildren(...poll.answers.map((answer, index) => {
    const vote = button('Vote', () => castVote(vote, index))
    vote.disabled = poll.closed
    return item(`${answer.text}: ${answer.votes} (${answer.percent}%)`, vote)
  }))
  els.close.disabled = poll.closed
}

async function openPoll(id) {
  const r = await call(`/api/polls/${id}`, 200)
  if (!r.ok) return showError(r.message)
  showPoll(r.body)
  showError('')
}

async function castVote(voteButton, index) {
  voteButton.disabled = true
  const r = await call(`/api/polls/${shownId}/votes`, 201, jsonRequest({ voter: els.voter.value, answer: index }))
  voteButton.disabled = false
  if (!r.ok) return showError(r.message)
  showPoll(r.body)
  showError('')
}

async function closeShown() {
  els.close.disabled = true
  const r = await call(`/api/polls/${shownId}/close`, 200, { method: 'POST' })
  if (!r.ok) {
    els.close.disabled = false
    return showError(r.message)
  }
  showPoll(r.body)
  showError('')
  loadList()
}

// The lines of the answers box: split at "\n", one "\r" at a line end removed, blank lines left out, others unchanged.
const answerLines = text => text.split('\n').map(line => (line.endsWith('\r') ? line.slice(0, -1) : line)).filter(line => line.trim() !== '')

async function createPoll(event) {
  event.preventDefault()
  if (els.create.disabled) return
  els.create.disabled = true
  const r = await call('/api/polls', 201, jsonRequest({ question: els.newQuestion.value, answers: answerLines(els.answers.value) }))
  els.create.disabled = false
  if (!r.ok) return showError(r.message)
  els.newQuestion.value = ''
  els.answers.value = ''
  showError('')
  showPoll(r.body)
  loadList()
}

els.form.addEventListener('submit', createPoll)
els.close.addEventListener('click', closeShown)
loadList()
