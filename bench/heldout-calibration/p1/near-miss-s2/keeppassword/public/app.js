const byId = id => document.getElementById(id)
const loginForm = byId('login-form')
const username = byId('username')
const password = byId('password')
const loginButton = byId('login')
const dashboard = byId('dashboard')
const who = byId('who')
const logoutButton = byId('logout')
const filterForm = byId('filter-form')
const counts = byId('counts')
const total = byId('total')
const chart = byId('chart')
const errorBox = byId('error')
const STATUSES = ['open', 'pending', 'closed']
const REQUEST_FAILED = 'Request failed.'
const UNREACHABLE = 'Could not reach the server.'

let latestFetch = 0

// Sends a request and says what came back: { ok, data, status, message } or { unreachable }.
async function send(method, url, body) {
  const options = { method }
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  let reply
  try {
    reply = await fetch(url, options)
  } catch (error) {
    return { unreachable: true }
  }
  const success = method === 'DELETE' ? 204 : 200
  if (reply.status === 204) return reply.status === success ? { ok: true } : { ok: false, status: 204, message: REQUEST_FAILED }
  let data
  try {
    data = await reply.json()
  } catch (error) {
    return { unreachable: true }
  }
  if (reply.status === success) return { ok: true, data }
  const message = data !== null && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string' ? data.error : REQUEST_FAILED
  return { ok: false, status: reply.status, message }
}

const failure = result => (result.unreachable ? UNREACHABLE : result.message)

function showLoggedOut() {
  loginForm.hidden = false
  dashboard.hidden = true
}

function showLoggedIn(user) {
  who.textContent = `${user.username} (${user.role})`
  loginForm.hidden = true
  dashboard.hidden = false
  fetchReport()
}

function queryOfFilters() {
  const parts = []
  for (const [name, field] of [['priority', byId('priority')], ['from', byId('from')], ['to', byId('to')]]) {
    if (field.value !== '') parts.push(`${name}=${encodeURIComponent(field.value)}`)
  }
  return parts.length > 0 ? `?${parts.join('&')}` : ''
}

async function fetchReport() {
  const mine = ++latestFetch
  const query = queryOfFilters()
  const result = await send('GET', `/api/reports/summary${query}`)
  if (mine !== latestFetch) return
  if (!result.ok) {
    errorBox.textContent = failure(result)
    return
  }
  counts.replaceChildren(...STATUSES.map(status => {
    const item = document.createElement('li')
    item.textContent = `${status}: ${result.data.counts[status]}`
    return item
  }))
  total.textContent = `Total: ${result.data.total}`
  chart.src = `/api/reports/chart.svg${query}`
  errorBox.textContent = ''
}

async function start() {
  const result = await send('GET', '/api/session')
  if (result.ok) return showLoggedIn(result.data.user)
  showLoggedOut()
  if (result.unreachable || result.status !== 401) errorBox.textContent = failure(result)
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault()
  if (loginButton.disabled) return
  loginButton.disabled = true
  const result = await send('POST', '/api/session', { username: username.value, password: password.value })
  loginButton.disabled = false
  if (!result.ok) {
    errorBox.textContent = failure(result)
    return
  }
  errorBox.textContent = ''
  showLoggedIn(result.data.user)
})

filterForm.addEventListener('submit', event => {
  event.preventDefault()
  fetchReport()
})

logoutButton.addEventListener('click', async () => {
  if (logoutButton.disabled) return
  logoutButton.disabled = true
  const result = await send('DELETE', '/api/session')
  logoutButton.disabled = false
  if (!result.ok) {
    errorBox.textContent = failure(result)
    return
  }
  latestFetch += 1
  errorBox.textContent = ''
  who.textContent = ''
  counts.replaceChildren()
  total.textContent = ''
  chart.src = ''
  showLoggedOut()
})

start()
