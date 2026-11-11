// The HTTP server: reads each request whole, routes it, and turns any failure into a reply.
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { addMove, addTransfer, deleteMove, listMoves } from './moves.mjs'
import { createPart, deletePart, getPart, listParts, patchPart } from './parts.mjs'
import { MAX_BODY, fail } from './reply.mjs'

const asset = name => readFileSync(new URL(`../public/${name}`, import.meta.url))
const file = (type, bytes) => () => ({ status: 200, type, raw: bytes })
const ROUTES = [
  { path: /^\/api\/parts$/, handlers: { GET: listParts, POST: createPart } },
  { path: /^\/api\/parts\/([^/]+)$/, handlers: { GET: getPart, PATCH: patchPart, DELETE: deletePart } },
  { path: /^\/api\/parts\/([^/]+)\/moves$/, handlers: { GET: listMoves, POST: addMove } },
  { path: /^\/api\/moves\/([^/]+)$/, handlers: { DELETE: deleteMove } },
  { path: /^\/api\/transfers$/, handlers: { POST: addTransfer } },
  { path: /^\/$/, handlers: { GET: file('text/html; charset=utf-8', asset('index.html')) } },
  { path: /^\/app\.js$/, handlers: { GET: file('text/javascript; charset=utf-8', asset('app.js')) } },
]
const JSON_TYPE = 'application/json; charset=utf-8'

// Reads the whole body but keeps only enough to know it is too long.
async function readBody(req) {
  const kept = []
  let size = 0
  for await (const chunk of req) {
    if (size <= MAX_BODY) kept.push(chunk)
    size += chunk.length
  }
  return { body: Buffer.concat(kept), bodySize: size }
}

function answer(db, req, body) {
  const at = req.url.indexOf('?')
  const path = at < 0 ? req.url : req.url.slice(0, at)
  const query = new URLSearchParams(at < 0 ? '' : req.url.slice(at + 1))
  const route = ROUTES.find(r => r.path.test(path))
  if (!route) return fail(404, 'not found')
  if (!Object.hasOwn(route.handlers, req.method)) return fail(405, 'method not allowed')
  return route.handlers[req.method](db, { params: route.path.exec(path).slice(1), query, headers: req.headers, ...body })
}

function send(res, { status, body, type, raw }) {
  if (raw) return res.writeHead(status, { 'Content-Type': type }).end(raw)
  if (body === undefined) return res.writeHead(status).end()
  return res.writeHead(status, { 'Content-Type': JSON_TYPE }).end(JSON.stringify(body))
}

export function createApp(db) {
  return createServer(async (req, res) => {
    try {
      send(res, answer(db, req, await readBody(req)))
    } catch (err) {
      send(res, fail(500, 'internal error'))
    }
  })
}
