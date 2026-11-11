import { readFileSync } from 'node:fs'
import { fail } from './http.mjs'
import { MAX_ID, MESSAGES, positive, priorityOk } from './rules.mjs'

const DAY_MS = 24 * 60 * 60 * 1000
const STATUSES = ['open', 'pending', 'closed']
const SVG_TYPE = 'image/svg+xml; charset=utf-8'
const PAGE = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8')
const SCRIPT = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8')

// The time of 00:00:00.000 UTC of a YYYY-MM-DD day from 2000 to 2099, or null.
function dayStart(text) {
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(text)
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const lengths = [31, year % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) return null
  return Date.UTC(year, month - 1, day)
}

// The WHERE part for the tickets this user sees and the filters of the query, checked in the order of the task.
function filters(query, user) {
  const given = name => query.has(name) && query.get(name) !== ''
  const conds = []
  const params = []
  if (given('priority')) {
    if (!priorityOk(query.get('priority'))) throw fail(400, MESSAGES.priority)
    conds.push('priority = ?')
    params.push(query.get('priority'))
  }
  let from = null
  let to = null
  if (given('from')) {
    from = dayStart(query.get('from'))
    if (from === null) throw fail(400, 'from must be a valid YYYY-MM-DD date')
    conds.push('created_at >= ?')
    params.push(from)
  }
  if (given('to')) {
    to = dayStart(query.get('to'))
    if (to === null) throw fail(400, 'to must be a valid YYYY-MM-DD date')
    conds.push('created_at < ?')
    params.push(to + DAY_MS)
  }
  if (from !== null && to !== null && from > to) throw fail(400, 'from must not be after to')
  if (user.role === 'member') {
    conds.push('created_by = ?')
    params.push(user.id)
  } else if (given('created_by')) {
    const id = positive(query.get('created_by'))
    if (id === null) throw fail(400, 'created_by must be a positive whole number')
    conds.push('created_by = ?')
    params.push(id > MAX_ID ? MAX_ID : id)
  }
  return { where: conds.length ? `WHERE ${conds.join(' AND ')}` : '', params }
}

function countsOf({ db, query, user }) {
  const { where, params } = filters(query, user)
  const found = Object.fromEntries(db.prepare(`SELECT status, count(*) AS n FROM tickets ${where} GROUP BY status`).all(...params).map(r => [r.status, r.n]))
  const counts = Object.fromEntries(STATUSES.map(s => [s, found[s] ?? 0]))
  return { counts, total: STATUSES.reduce((sum, s) => sum + counts[s], 0) }
}

const summary = ctx => ({ status: 200, body: countsOf(ctx) })

function chart(ctx) {
  const { counts } = countsOf(ctx)
  const most = Math.max(...STATUSES.map(s => counts[s]))
  const bars = STATUSES.map((status, i) => {
    const height = most === 0 ? 0 : Math.floor(150 * counts[status] / most)
    return `<rect x="${20 + 100 * i}" y="${170 - height}" width="80" height="${height}"/><text x="${60 + 100 * i}" y="190" text-anchor="middle">${status} ${counts[status]}</text>`
  })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><title>Tickets by status</title>${bars.join('')}</svg>`
  return { status: 200, raw: svg, type: SVG_TYPE }
}

const asset = (raw, type) => () => ({ status: 200, raw, type })

export const reportRoutes = [
  { method: 'GET', path: /^\/api\/reports\/summary$/, handler: summary },
  { method: 'GET', path: /^\/api\/reports\/chart\.svg$/, handler: chart },
  { method: 'GET', path: /^\/$/, session: false, handler: asset(PAGE, 'text/html; charset=utf-8') },
  { method: 'GET', path: /^\/app\.js$/, session: false, handler: asset(SCRIPT, 'text/javascript; charset=utf-8') },
]
