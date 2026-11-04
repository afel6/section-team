// Request handling: routing, body reading, the API and the page. The state lives in memory; a change is
// saved to the data file first and only then replaces the in-memory state, so a failed save changes nothing.
// Each request's work after its body has arrived is synchronous, so concurrent requests act one at a time.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { DATE_ERROR, ROOMS, checkFields, compareBookings, findConflict, isValidDate } from './bookings.mjs'
import { saveState } from './store.mjs'

const MAX_BODY_BYTES = 10000
const JSON_TYPE = 'application/json; charset=utf-8'
const BOOKING_PREFIX = '/api/bookings/'
const ID_PATTERN = /^[1-9][0-9]*$/
const PUBLIC = join(import.meta.dirname, '..', 'public')
const PAGE = { status: 200, type: 'text/html; charset=utf-8', body: readFileSync(join(PUBLIC, 'index.html')) }
const SCRIPT = { status: 200, type: 'text/javascript; charset=utf-8', body: readFileSync(join(PUBLIC, 'app.js')) }

const fail = (status, message) => ({ status, body: { error: message } })

// The media type of a Content-Type header: the part before the first ';', spaces and tabs trimmed, lower case.
function mediaType(header) {
  if (typeof header !== 'string') return null
  return header.split(';', 1)[0].replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase()
}

// The body as a plain object, or null when it is not valid JSON or not a JSON object.
function parseObject(data) {
  let value
  try {
    value = JSON.parse(data.toString('utf8'))
  } catch {
    return null
  }
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

// Reads the whole body, keeping it only while it fits the limit, so every reply reaches the client.
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size <= MAX_BODY_BYTES) chunks.push(chunk)
  }
  return { size, data: size <= MAX_BODY_BYTES ? Buffer.concat(chunks) : null }
}

function listBookings({ state, query }) {
  const params = new URLSearchParams(query)
  if (!params.has('date')) return { status: 200, body: { bookings: state.bookings.toSorted(compareBookings) } }
  const date = params.get('date')
  if (!isValidDate(date)) return fail(400, DATE_ERROR)
  const bookings = state.bookings.filter(b => b.date === date).toSorted(compareBookings)
  return { status: 200, body: { bookings } }
}

// Booking rules 1-10 in order, then the save.
function createBooking({ state, commit, req, body }) {
  if (mediaType(req.headers['content-type']) !== 'application/json') {
    return fail(415, 'content type must be application/json')
  }
  if (body.size > MAX_BODY_BYTES) return fail(413, 'body too large')
  const input = parseObject(body.data)
  if (input === null) return fail(400, 'body must be a JSON object')
  const { error, fields } = checkFields(input)
  if (error) return fail(400, error)
  const conflict = findConflict(state.bookings, fields)
  if (conflict) return fail(409, `room is already booked from ${conflict.start} to ${conflict.end}`)
  const booking = { id: state.nextId, ...fields }
  commit({ nextId: state.nextId + 1, bookings: [...state.bookings, booking] })
  return { status: 201, body: booking }
}

function deleteBooking({ state, commit, id }) {
  const booking = ID_PATTERN.test(id) ? state.bookings.find(b => String(b.id) === id) : undefined
  if (!booking) return fail(404, 'booking not found')
  commit({ nextId: state.nextId, bookings: state.bookings.filter(b => b !== booking) })
  return { status: 204 }
}

const ROUTES = {
  '/api/rooms': { GET: () => ({ status: 200, body: { rooms: ROOMS } }) },
  '/api/bookings': { GET: listBookings, POST: createBooking },
  '/': { GET: () => PAGE },
  '/app.js': { GET: () => SCRIPT },
}

// The methods of the route at path (and the booking id for the delete route), or null for an unknown path.
function findRoute(path) {
  if (Object.hasOwn(ROUTES, path)) return { methods: ROUTES[path] }
  const id = path.startsWith(BOOKING_PREFIX) ? path.slice(BOOKING_PREFIX.length) : ''
  if (id !== '' && !id.includes('/')) return { methods: { DELETE: deleteBooking }, id }
  return null
}

function respond(ctx) {
  const target = ctx.req.url
  const mark = target.indexOf('?')
  const path = mark === -1 ? target : target.slice(0, mark)
  const route = findRoute(path)
  if (!route) return fail(404, 'not found')
  if (!Object.hasOwn(route.methods, ctx.req.method)) return fail(405, 'method not allowed')
  const query = mark === -1 ? '' : target.slice(mark + 1)
  return route.methods[ctx.req.method]({ ...ctx, query, id: route.id })
}

function send(res, { status, type, body }) {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const payload = type ? body : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': type ?? JSON_TYPE, 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

const logError = err => process.stderr.write(`request failed: ${err?.code ?? err?.message ?? err}\n`)

// An HTTP server around `state`, saving every change to `file` before replying.
export function createApp(file, initialState) {
  let state = initialState
  const commit = next => {
    saveState(file, next)
    state = next
  }
  async function serve(req, res) {
    let reply
    try {
      const body = await readBody(req)
      reply = respond({ state, commit, req, body })
    } catch (err) {
      logError(err)
      reply = fail(500, 'internal error')
    }
    send(res, reply)
  }
  return createServer((req, res) => {
    serve(req, res).catch(err => {
      logError(err)
      res.destroy()
    })
  })
}
