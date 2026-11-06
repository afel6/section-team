// The page: the list of parts with search and paging, adding and deleting. Every value goes in as plain text.
const NO_REPLY = 'Could not reach the server.'
const FAILED = 'Request failed.'
const PAGE = 20
const el = id => document.getElementById(id)
const errorLine = el('error')
const list = el('part-list')
const more = el('more')
const add = el('add')
let latestList = 0
let next = null

const messageOf = body => (typeof body === 'object' && body !== null && !Array.isArray(body) && typeof body.error === 'string' ? body.error : FAILED)

// { ok, body } for a success, or { message } for what #error should show.
async function request(url, success, options) {
  let answer
  try {
    answer = options ? await fetch(url, options) : await fetch(url)
  } catch {
    return { message: NO_REPLY }
  }
  if (answer.status === 204) return success === 204 ? { ok: true } : { message: FAILED }
  let body
  try {
    body = await answer.json()
  } catch {
    return { message: NO_REPLY }
  }
  return answer.status === success ? { ok: true, body } : { message: messageOf(body) }
}

const listUrl = after => {
  const search = el('search').value
  const q = search === '' ? '' : `&q=${encodeURIComponent(search)}`
  return `/api/parts?limit=${PAGE}${q}${after === null ? '' : `&after=${encodeURIComponent(after)}`}`
}

function partRow(part) {
  const row = document.createElement('li')
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.textContent = 'Delete'
  remove.addEventListener('click', () => deletePart(part.id, remove))
  row.append(`${part.sku} ${part.name} (${part.on_hand})`, remove)
  return row
}

function emptyRow() {
  const row = document.createElement('li')
  row.textContent = 'No parts.'
  return row
}

async function fetchList() {
  const ticket = ++latestList
  const outcome = await request(listUrl(null), 200)
  if (outcome.message) {
    errorLine.textContent = outcome.message
    more.disabled = next === null
    return
  }
  next = outcome.body.next
  list.replaceChildren(...(outcome.body.parts.length ? outcome.body.parts.map(partRow) : [emptyRow()]))
  more.disabled = next === null
}

async function loadMore() {
  const ticket = ++latestList
  more.disabled = true
  const outcome = await request(listUrl(next), 200)
  if (ticket !== latestList) return
  if (outcome.message) {
    errorLine.textContent = outcome.message
    more.disabled = false
    return
  }
  next = outcome.body.next
  list.append(...outcome.body.parts.map(partRow))
  more.disabled = next === null
}

async function addPart(event) {
  event.preventDefault()
  if (add.disabled) return
  add.disabled = true
  const body = JSON.stringify({ sku: el('sku').value, name: el('name').value })
  const outcome = await request('/api/parts', 201, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  add.disabled = false
  if (outcome.message) {
    errorLine.textContent = outcome.message
    return
  }
  errorLine.textContent = ''
  el('sku').value = ''
  el('name').value = ''
  fetchList()
}

async function deletePart(id, button) {
  button.disabled = true
  const outcome = await request(`/api/parts/${id}`, 204, { method: 'DELETE' })
  button.disabled = false
  errorLine.textContent = outcome.message ?? ''
  if (outcome.message !== NO_REPLY) fetchList()
}

el('part-form').addEventListener('submit', addPart)
el('search').addEventListener('change', fetchList)
more.addEventListener('click', loadMore)
fetchList()
