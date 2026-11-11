// The parts routes.
import { inTransaction } from './db.mjs'
import { freeHandle } from './handle.mjs'
import { nameProblem, skuProblem } from './rules.mjs'
import { fail, jsonBody, reply, rowId } from './reply.mjs'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const LIMIT = /^[1-9][0-9]*$/
const NOT_FOUND = fail(404, 'part not found')

// on_hand and value_cents from a part's moves. Products and sums can pass 2^63, so the value is added up in BigInt.
function stockOf(db, partId) {
  const moves = db.prepare('SELECT qty, unit_cost_cents FROM moves WHERE part_id = ?').all(partId)
  const onHand = moves.reduce((sum, move) => sum + move.qty, 0)
  const value = moves.reduce((sum, move) => sum + BigInt(move.qty) * BigInt(move.unit_cost_cents), 0n)
  return { on_hand: onHand, value_cents: String(value) }
}

const partReply = (db, part) => ({ id: part.id, sku: part.sku, name: part.name, handle: part.handle, ...stockOf(db, part.id) })
const partById = (db, id) => db.prepare('SELECT * FROM parts WHERE id = ?').get(id)

// The part a path's <id> names, or undefined.
export const partOfPath = (db, text) => {
  const id = rowId(text)
  return id === null ? undefined : partById(db, id)
}

function parseLimit(query) {
  if (!query.has('limit')) return DEFAULT_LIMIT
  const text = query.get('limit')
  const limit = LIMIT.test(text) ? Number(text) : Infinity
  return limit <= MAX_LIMIT ? limit : null
}

const matcher = q => {
  const wanted = q.toLowerCase()
  return part => part.sku.toLowerCase().includes(wanted) || part.name.toLowerCase().includes(wanted)
}

export function listParts(db, request) {
  const limit = parseLimit(request.query)
  if (limit === null) return fail(400, 'limit must be 1 to 100')
  const matches = matcher(request.query.get('q') ?? '')
  const rows = db.prepare('SELECT * FROM parts WHERE sku > ? ORDER BY sku').all(request.query.get('after') ?? '').filter(matches)
  const page = rows.slice(0, limit)
  return reply(200, { parts: page.map(part => partReply(db, part)), next: rows.length > limit ? page.at(-1).sku : null })
}

export function createPart(db, request) {
  const { value, problem } = jsonBody(request)
  if (problem) return problem
  const bad = skuProblem(value.sku) ?? nameProblem(value.name)
  if (bad) return fail(400, bad)
  return inTransaction(db, () => {
    if (db.prepare('SELECT 1 FROM parts WHERE sku = ?').get(value.sku)) return fail(409, 'sku already exists')
    const name = value.name.trim()
    const handleInUse = db.prepare('SELECT 1 FROM parts WHERE handle = ?')
    const handle = freeHandle(name, candidate => handleInUse.get(candidate) !== undefined)
    const part = db.prepare('INSERT INTO parts (sku, name, handle) VALUES (?, ?, ?) RETURNING *').get(value.sku, name, handle)
    return reply(201, partReply(db, part))
  })
}

export function getPart(db, request) {
  const part = partOfPath(db, request.params[0])
  return part ? reply(200, partReply(db, part)) : NOT_FOUND
}

export function patchPart(db, request) {
  const part = partOfPath(db, request.params[0])
  if (!part) return NOT_FOUND
  const { value, problem } = jsonBody(request)
  if (problem) return problem
  const bad = nameProblem(value.name)
  if (bad) return fail(400, bad)
  const renamed = inTransaction(db, () => db.prepare('UPDATE parts SET name = ? WHERE id = ? RETURNING *').get(value.name.trim(), part.id))
  return reply(200, partReply(db, renamed))
}

export function deletePart(db, request) {
  const part = partOfPath(db, request.params[0])
  if (!part) return NOT_FOUND
  inTransaction(db, () => db.prepare('DELETE FROM parts WHERE id = ?').run(part.id))
  return reply(204)
}
