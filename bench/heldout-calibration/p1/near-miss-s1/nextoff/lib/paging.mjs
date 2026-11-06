import { fail } from './http.mjs'
import { MAX_ID, positive } from './rules.mjs'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

// `limit` and `before` of a list route, checked in that order.
export function paging(query) {
  let limit = DEFAULT_LIMIT
  if (query.has('limit')) {
    const text = query.get('limit')
    if (!/^[1-9][0-9]*$/.test(text) || Number(text) > MAX_LIMIT) throw fail(400, 'limit must be 1 to 100')
    limit = Number(text)
  }
  let before = MAX_ID
  if (query.has('before')) {
    const n = positive(query.get('before'))
    if (n === null) throw fail(400, 'before must be a positive whole number')
    before = n > MAX_ID ? MAX_ID : n
  }
  return { limit, before }
}

// One page, newest first: `next` is the id of the last row when more rows match after it.
export function listPage(db, { limit, before }, { name, select, from, clause = '', params = [] }) {
  const rows = db.prepare(`SELECT ${select} FROM ${from} WHERE id < ? ${clause} ORDER BY id DESC LIMIT ?`).all(before, ...params, limit + 1)
  const shown = rows.slice(0, limit).map(row => ({ ...row }))
  return { [name]: shown, next: rows.length >= limit ? shown[limit - 1].id : null }
}
