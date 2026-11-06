import { createHash } from 'node:crypto'
import { isBusy } from './db.mjs'
import { MAX_ID, positive } from './rules.mjs'

export const JSON_TYPE = 'application/json; charset=utf-8'
export const MAX_BODY = 100000
const BLANKS = /^[ \t]+|[ \t]+$/g

export class Failure extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export const fail = (status, message) => new Failure(status, message)
export const sha256 = text => createHash('sha256').update(text).digest('hex')

// The whole body is read before anything is answered; only the first MAX_BODY + 1 bytes are kept.
function readBody(req) {
  return new Promise(resolve => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size <= MAX_BODY) chunks.push(chunk)
    })
    req.on('end', () => resolve({ size, buffer: Buffer.concat(chunks) }))
    req.on('error', () => resolve(null))
    req.on('close', () => resolve(null))
  })
}

// The token of the first Cookie piece that starts with `sid=`, or null when there is none.
export function tokenOf(header) {
  if (header === undefined) return null
  for (const piece of header.split(';')) {
    const trimmed = piece.replace(BLANKS, '')
    if (trimmed.startsWith('sid=')) return trimmed.slice(4)
  }
  return null
}

function sessionOf(db, token, now) {
  const tokenHash = sha256(token)
  const user = db.prepare(
    'SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ).get(tokenHash, now)
  return user ? { user: { id: user.id, username: user.username, role: user.role }, tokenHash } : null
}

function jsonBody(headers, body) {
  const type = (headers['content-type'] ?? '').split(';')[0].replace(BLANKS, '').toLowerCase()
  if (type !== 'application/json') throw fail(415, 'content type must be application/json')
  if (body.size > MAX_BODY) throw fail(413, 'body too large')
  let parsed
  try {
    parsed = JSON.parse(body.buffer.toString('utf8'))
  } catch {
    throw fail(400, 'body must be a JSON object')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail(400, 'body must be a JSON object')
  return parsed
}

async function dispatch({ db, routes, req, body, now }) {
  const cut = req.url.indexOf('?')
  const path = cut < 0 ? req.url : req.url.slice(0, cut)
  const query = new URLSearchParams(cut < 0 ? '' : req.url.slice(cut + 1))
  const listed = routes.map(route => ({ route, match: route.path.exec(path) })).filter(r => r.match)
  if (listed.length === 0) throw fail(404, 'not found')
  const found = listed.find(r => r.route.method === req.method)
  if (!found) throw fail(405, 'method not allowed')
  const { route, match } = found
  const ctx = { db, now, query, req, body: null, session: null, user: null, target: null }
  if (route.session !== false) {
    const token = tokenOf(req.headers.cookie)
    if (token === null) throw fail(401, 'login required')
    ctx.session = sessionOf(db, token, now)
    if (!ctx.session) throw fail(401, 'login required')
    ctx.user = ctx.session.user
    if (route.admin && ctx.user.role !== 'admin') throw fail(403, 'forbidden')
  }
  if (route.target) {
    const id = positive(match[1])
    ctx.target = id !== null && id <= MAX_ID ? route.target.find(db, id, ctx.user) : undefined
    if (!ctx.target) throw fail(404, route.target.missing)
  }
  if (route.json !== false && (req.method === 'POST' || req.method === 'PATCH')) ctx.body = jsonBody(req.headers, body)
  return route.handler(ctx)
}

function replyOf(error) {
  if (error instanceof Failure) return { status: error.status, body: { error: error.message } }
  if (isBusy(error)) return { status: 503, body: { error: 'database busy' } }
  process.stderr.write(`internal error: ${error?.message}\n`)
  return { status: 500, body: { error: 'internal error' } }
}

function send(res, { status, body, headers = {}, raw, type }) {
  if (raw !== undefined) {
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(raw), ...headers })
    res.end(raw)
  } else if (body === undefined) {
    res.writeHead(status, headers)
    res.end()
  } else {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': JSON_TYPE, 'Content-Length': Buffer.byteLength(text), ...headers })
    res.end(text)
  }
}

export function makeHandler({ db, routes }) {
  return async (req, res) => {
    const body = await readBody(req)
    if (!body) return
    const now = Date.now()
    let reply
    try {
      reply = await dispatch({ db, routes, req, body, now })
    } catch (error) {
      reply = replyOf(error)
    }
    send(res, reply)
  }
}
