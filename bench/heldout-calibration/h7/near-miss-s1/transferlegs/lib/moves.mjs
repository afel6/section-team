// The moves and transfers routes.
import { firstDip, withNewMove } from './balance.mjs'
import { inTransaction } from './db.mjs'
import { partOfPath } from './parts.mjs'
import { costProblem, dateProblem, noteProblem, qtyProblem, transferQtyProblem } from './rules.mjs'
import { fail, jsonBody, reply, rowId } from './reply.mjs'

const PART_NOT_FOUND = fail(404, 'part not found')
const MOVE_NOT_FOUND = fail(404, 'move not found')
const belowZero = date => fail(409, `stock would go below zero on ${date}`)

const movesOf = (db, partId) => db.prepare('SELECT * FROM moves WHERE part_id = ? ORDER BY on_date, id').all(partId)

const insertMove = (db, partId, { on_date: onDate, qty, unit_cost_cents: cost, note }) => db
  .prepare('INSERT INTO moves (part_id, on_date, qty, unit_cost_cents, note) VALUES (?, ?, ?, ?, ?) RETURNING *')
  .get(partId, onDate, qty, cost, note)

export function listMoves(db, request) {
  const part = partOfPath(db, request.params[0])
  if (!part) return PART_NOT_FOUND
  let balance = 0
  const moves = movesOf(db, part.id).map(move => {
    balance += move.qty
    return { ...move, balance }
  })
  return reply(200, { moves })
}

export function addMove(db, request) {
  const part = partOfPath(db, request.params[0])
  if (!part) return PART_NOT_FOUND
  const { value, problem } = jsonBody(request)
  if (problem) return problem
  const bad = dateProblem(value.on_date) ?? qtyProblem(value.qty) ?? costProblem(value.unit_cost_cents) ?? noteProblem(value.note)
  if (bad) return fail(400, bad)
  const move = { ...value, note: value.note ?? '' }
  return inTransaction(db, () => {
    const dip = firstDip(withNewMove(movesOf(db, part.id), move))
    return dip === null ? reply(201, insertMove(db, part.id, move)) : belowZero(dip)
  })
}

export function deleteMove(db, request) {
  const id = rowId(request.params[0])
  const move = id === null ? undefined : db.prepare('SELECT * FROM moves WHERE id = ?').get(id)
  if (!move) return MOVE_NOT_FOUND
  return inTransaction(db, () => {
    const dip = firstDip(movesOf(db, move.part_id).filter(other => other.id !== move.id))
    if (dip !== null) return belowZero(dip)
    db.prepare('DELETE FROM moves WHERE id = ?').run(move.id)
    return reply(204)
  })
}

const partOfBody = (db, id) => (Number.isSafeInteger(id) && id > 0 ? db.prepare('SELECT * FROM parts WHERE id = ?').get(id) : undefined)

export function addTransfer(db, request) {
  const { value, problem } = jsonBody(request)
  if (problem) return problem
  const from = partOfBody(db, value.from_part)
  const to = partOfBody(db, value.to_part)
  if (!from || !to) return PART_NOT_FOUND
  if (from.id === to.id) return fail(400, 'from_part and to_part must differ')
  const bad = dateProblem(value.on_date) ?? transferQtyProblem(value.qty) ?? costProblem(value.unit_cost_cents)
  if (bad) return fail(400, bad)
  const leg = (qty, note) => ({ on_date: value.on_date, qty, unit_cost_cents: value.unit_cost_cents, note })
  const out = leg(-value.qty, `transfer to ${to.sku}`)
  return (() => {
    const dip = firstDip(withNewMove(movesOf(db, from.id), out))
    if (dip !== null) return belowZero(dip)
    return reply(201, { out: insertMove(db, from.id, out), in: insertMove(db, to.id, leg(value.qty, `transfer from ${from.sku}`)) })
  })()
}
