// The stock report as of a date.
import { isDate } from './rules.mjs'
import { fail, reply } from './reply.mjs'

function partRow(db, part, asOf) {
  const moves = db.prepare('SELECT qty, unit_cost_cents FROM moves WHERE part_id = ? AND on_date <= ?').all(part.id, asOf)
  const value = moves.reduce((sum, move) => sum + BigInt(move.qty) * BigInt(move.unit_cost_cents), 0n)
  return { value, row: { id: part.id, handle: part.handle, sku: part.sku, on_hand: moves.reduce((sum, move) => sum + move.qty, 0), value_cents: String(value) } }
}

export function report(db, request) {
  const asOf = request.query.get('as_of')
  if (!isDate(asOf)) return fail(400, 'as_of must be a valid YYYY-MM-DD date')
  const rows = db.prepare('SELECT * FROM parts ORDER BY handle').all().map(part => partRow(db, part, asOf))
  const total = rows.reduce((sum, { value }) => sum + value, 0n)
  return reply(200, { as_of: asOf, parts: rows.map(({ row }) => row), total_value_cents: String(total) })
}
