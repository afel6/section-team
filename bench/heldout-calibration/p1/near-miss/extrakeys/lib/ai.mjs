import { audit, inTransaction } from './db.mjs'
import { fail } from './http.mjs'
import { findTicket } from './tickets.mjs'
import { CATEGORY_INSTRUCTIONS, SUMMARY_INSTRUCTIONS, callModel, categoryOf, summaryOf } from './model.mjs'

const ticketTarget = { find: findTicket, missing: 'ticket not found' }

// The model is called with no transaction open; the audit entry is written afterwards in its own.
function modelRoute(modelUrl, kind, instructions, check) {
  return {
    method: 'POST',
    path: new RegExp(`^/api/tickets/([^/]+)/${kind}$`),
    json: false,
    target: ticketTarget,
    async handler({ db, now, user, target }) {
      if (!modelUrl) throw fail(503, 'model not configured')
      const comments = db.prepare('SELECT text FROM comments WHERE ticket_id = ? ORDER BY id').all(target.id).map(row => row.text)
      const ticket = JSON.stringify({ title: target.title, description: target.description, comments })
      const value = await callModel(modelUrl, instructions, ticket, check)
      if (value === null) throw fail(502, 'model call failed')
      inTransaction(db, () => audit(db, now, user.id, `ticket.${kind}`, `ticket:${target.id}`))
      return { status: 200, body: { [kind]: value, title: target.title } }
    },
  }
}

export const aiRoutes = modelUrl => [
  modelRoute(modelUrl, 'summary', SUMMARY_INSTRUCTIONS, summaryOf),
  modelRoute(modelUrl, 'category', CATEGORY_INSTRUCTIONS, categoryOf),
]
