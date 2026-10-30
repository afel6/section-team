// Route table and handlers. A handler gets { state, params, query, body } and returns
// { status, body } plus, when it changes the store, the new store as `state`. Handlers never
// change the state they are given.
import { parseName, parsePage, parseQuantity, parseSku } from './validate.mjs'
import { paginate } from './paginate.mjs'
import { toCsv } from './csv.mjs'

const NOT_FOUND = { status: 404, body: { error: 'not found' } }

const bySku = (a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)

function listItems({ state, query }) {
  const { page, perPage } = parsePage(query)
  return { status: 200, body: paginate([...state.items].sort(bySku), page, perPage) }
}

// Every item, not one page.
function exportItems({ state }) {
  return { status: 200, contentType: 'text/csv', body: toCsv([...state.items].sort(bySku)) }
}

function createItem({ state, body }) {
  const item = { sku: parseSku(body.sku), name: parseName(body.name), qty: parseQuantity(body.qty), reserved: 0 }
  if (state.items.some(i => i.sku === item.sku)) return { status: 409, body: { error: 'sku already exists' } }
  return { status: 201, body: item, state: { ...state, items: [...state.items, item] } }
}

function getItem({ state, params }) {
  const item = state.items.find(i => i.sku === params[0])
  return item ? { status: 200, body: item } : NOT_FOUND
}

function listReservations({ state, query }) {
  const { page, perPage } = parsePage(query)
  const sorted = [...state.reservations].sort((a, b) => a.id - b.id)
  return { status: 200, body: paginate(sorted, page, perPage) }
}

// Adds delta to the reserved count of the item with this sku.
const changeReserved = (items, sku, delta) =>
  items.map(i => (i.sku === sku ? { ...i, reserved: i.reserved + delta } : i))

function createReservation({ state, body }) {
  const sku = parseSku(body.sku)
  const qty = parseQuantity(body.qty)
  const item = state.items.find(i => i.sku === sku)
  if (!item) return NOT_FOUND
  if (qty > item.qty - item.reserved) return { status: 409, body: { error: 'insufficient stock' } }
  const reservation = { id: state.nextReservationId, sku, qty }
  const next = {
    items: changeReserved(state.items, sku, qty),
    reservations: [...state.reservations, reservation],
    nextReservationId: state.nextReservationId + 1,
  }
  return { status: 201, body: reservation, state: next }
}

function deleteReservation({ state, params }) {
  const reservation = state.reservations.find(r => String(r.id) === params[0])
  if (!reservation) return NOT_FOUND
  const next = {
    ...state,
    items: changeReserved(state.items, reservation.sku, -reservation.qty),
    reservations: state.reservations.filter(r => r.id !== reservation.id),
  }
  return { status: 204, state: next }
}

// Checked in order; the first match wins, so export.csv must come before /items/:sku.
const ROUTES = [
  { method: 'GET', path: /^\/items$/, handler: listItems },
  { method: 'POST', path: /^\/items$/, handler: createItem },
  { method: 'GET', path: /^\/items\/export\.csv$/, handler: exportItems },
  { method: 'GET', path: /^\/items\/([^/]+)$/, handler: getItem },
  { method: 'GET', path: /^\/reservations$/, handler: listReservations },
  { method: 'POST', path: /^\/reservations$/, handler: createReservation },
  { method: 'DELETE', path: /^\/reservations\/([^/]+)$/, handler: deleteReservation },
]

// Returns { handler, params } for the first route matching method and pathname, or null.
export function findRoute(method, pathname) {
  for (const route of ROUTES) {
    const match = route.method === method && route.path.exec(pathname)
    if (match) return { handler: route.handler, params: match.slice(1) }
  }
  return null
}
