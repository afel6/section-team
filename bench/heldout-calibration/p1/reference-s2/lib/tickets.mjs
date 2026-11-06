import { audit, inTransaction } from './db.mjs'
import { fail } from './http.mjs'
import { paging, listPage } from './paging.mjs'
import { MESSAGES, descriptionOk, has, priorityOk, statusOk, textOk, titleOk } from './rules.mjs'

export const TICKET = 'id, title, description, status, priority, created_by, created_at'
const COMMENT = 'id, ticket_id, user_id, text, created_at'

export function findTicket(db, id, user) {
  return user.role === 'admin'
    ? db.prepare(`SELECT ${TICKET} FROM tickets WHERE id = ?`).get(id)
    : db.prepare(`SELECT ${TICKET} FROM tickets WHERE id = ? AND created_by = ?`).get(id, user.id)
}
const ticketTarget = { find: findTicket, missing: 'ticket not found' }
const plain = rows => rows.map(row => ({ ...row }))

function listTickets({ db, user, query }) {
  const where = user.role === 'admin' ? { clause: '', params: [] } : { clause: 'AND created_by = ?', params: [user.id] }
  return { status: 200, body: listPage(db, paging(query), { name: 'tickets', select: TICKET, from: 'tickets', ...where }) }
}

function createTicket({ db, now, user, body }) {
  if (!titleOk(body.title)) throw fail(400, MESSAGES.title)
  if (!descriptionOk(body.description)) throw fail(400, MESSAGES.description)
  if (has(body, 'priority') && !priorityOk(body.priority)) throw fail(400, MESSAGES.priority)
  const made = inTransaction(db, () => {
    const row = db.prepare(`INSERT INTO tickets (title, description, status, priority, created_by, created_at) VALUES (?, ?, 'open', ?, ?, ?) RETURNING ${TICKET}`)
      .get(body.title.trim(), body.description.trim(), has(body, 'priority') ? body.priority : 'normal', user.id, now)
    audit(db, now, user.id, 'ticket.create', `ticket:${row.id}`)
    return row
  })
  return { status: 201, body: { ...made } }
}

function updateTicket({ db, now, user, body, target }) {
  const keys = ['title', 'description', 'status', 'priority'].filter(k => has(body, k))
  if (keys.length === 0) throw fail(400, 'nothing to change')
  if (user.role === 'member' && (has(body, 'status') || has(body, 'priority'))) throw fail(403, 'forbidden')
  if (has(body, 'title') && !titleOk(body.title)) throw fail(400, MESSAGES.title)
  if (has(body, 'description') && !descriptionOk(body.description)) throw fail(400, MESSAGES.description)
  if (has(body, 'status') && !statusOk(body.status)) throw fail(400, MESSAGES.status)
  if (has(body, 'priority') && !priorityOk(body.priority)) throw fail(400, MESSAGES.priority)
  const value = k => (k === 'title' || k === 'description' ? body[k].trim() : body[k])
  const changed = inTransaction(db, () => {
    db.prepare(`UPDATE tickets SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map(value), target.id)
    audit(db, now, user.id, 'ticket.update', `ticket:${target.id}`)
    return db.prepare(`SELECT ${TICKET} FROM tickets WHERE id = ?`).get(target.id)
  })
  return { status: 200, body: { ...changed } }
}

function deleteTicket({ db, now, user, target }) {
  inTransaction(db, () => {
    db.prepare('DELETE FROM comments WHERE ticket_id = ?').run(target.id)
    db.prepare('DELETE FROM tickets WHERE id = ?').run(target.id)
    audit(db, now, user.id, 'ticket.delete', `ticket:${target.id}`)
  })
  return { status: 204 }
}

function createComment({ db, now, user, body, target }) {
  if (!textOk(body.text)) throw fail(400, MESSAGES.text)
  if (target.status === 'closed') throw fail(409, 'ticket is closed')
  const made = inTransaction(db, () => {
    const row = db.prepare(`INSERT INTO comments (ticket_id, user_id, text, created_at) VALUES (?, ?, ?, ?) RETURNING ${COMMENT}`)
      .get(target.id, user.id, body.text.trim(), now)
    audit(db, now, user.id, 'comment.create', `comment:${row.id}`)
    return row
  })
  return { status: 201, body: { ...made } }
}

export const ticketRoutes = [
  { method: 'GET', path: /^\/api\/tickets$/, handler: listTickets },
  { method: 'POST', path: /^\/api\/tickets$/, handler: createTicket },
  { method: 'GET', path: /^\/api\/tickets\/([^/]+)$/, target: ticketTarget, handler: ({ target }) => ({ status: 200, body: { ...target } }) },
  { method: 'PATCH', path: /^\/api\/tickets\/([^/]+)$/, target: ticketTarget, handler: updateTicket },
  { method: 'DELETE', path: /^\/api\/tickets\/([^/]+)$/, admin: true, target: ticketTarget, handler: deleteTicket },
  {
    method: 'GET',
    path: /^\/api\/tickets\/([^/]+)\/comments$/,
    target: ticketTarget,
    handler: ({ db, target }) => ({ status: 200, body: { comments: plain(db.prepare(`SELECT ${COMMENT} FROM comments WHERE ticket_id = ? ORDER BY id`).all(target.id)) } }),
  },
  { method: 'POST', path: /^\/api\/tickets\/([^/]+)\/comments$/, target: ticketTarget, handler: createComment },
]
