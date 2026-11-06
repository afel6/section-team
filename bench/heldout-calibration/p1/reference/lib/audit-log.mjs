import { paging, listPage } from './paging.mjs'

export const auditRoutes = [
  {
    method: 'GET',
    path: /^\/api\/audit$/,
    admin: true,
    handler: ({ db, query }) => ({ status: 200, body: listPage(db, paging(query), { name: 'entries', select: 'id, at, user_id, action, target', from: 'audit' }) }),
  },
]
