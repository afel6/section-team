// HTTP entry point. Reads JSON bodies, dispatches to lib/routes.mjs and saves the store
// after every change. Env: PORT (default 3000), DATA_FILE (default stock.json).
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { load, save } from './lib/store.mjs'
import { findRoute } from './lib/routes.mjs'
import { ValidationError } from './lib/validate.mjs'

const MAX_BODY_BYTES = 10 * 1024

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Reads the whole body. Past MAX_BODY_BYTES it stops keeping chunks but still drains the
// upload, so the 413 reply reaches the client instead of a reset connection.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > MAX_BODY_BYTES) reject(new HttpError(413, 'body too large'))
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function parseJsonObject(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'invalid JSON')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'body must be a JSON object')
  }
  return value
}

function send(res, { status, body }) {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function errorReply(err) {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } }
  if (err instanceof ValidationError) return { status: 400, body: { error: err.message } }
  // An OS error (ENOENT, EACCES, ...) is logged as one line; any other error keeps its stack.
  console.error(err.code ? [err.code, err.syscall, err.path].filter(Boolean).join(' ') : err)
  return { status: 500, body: { error: 'internal error' } }
}

// Builds the server around the store in dataFile. The store is kept in memory; each change is
// saved before it replaces the in-memory copy, so a failed save changes nothing.
export function createApp(dataFile) {
  let state = load(dataFile)
  return createServer(async (req, res) => {
    try {
      // Prefixing the origin keeps a request path like //host/items a path, not a host.
      const url = new URL(`http://localhost${req.url}`)
      const route = findRoute(req.method, url.pathname)
      if (!route) return send(res, { status: 404, body: { error: 'not found' } })
      const body = req.method === 'POST' ? parseJsonObject(await readBody(req)) : undefined
      const reply = route.handler({ state, params: route.params, query: url.searchParams, body })
      if (reply.state) {
        save(dataFile, reply.state)
        state = reply.state
      }
      send(res, reply)
    } catch (err) {
      send(res, errorReply(err))
    }
  })
}

function fail(message) {
  console.error(`cannot start: ${message}`)
  process.exitCode = 1
}

// A plain message for the OS errors a bad DATA_FILE gives; any other error keeps its own.
function loadErrorMessage(err, file) {
  if (err.code === 'EISDIR') return `DATA_FILE ${file} is a folder, not a file`
  if (err.code === 'EACCES') return `cannot read DATA_FILE ${file}: permission denied`
  return err.message
}

function main() {
  const port = Number(process.env.PORT || 3000)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return fail(`PORT must be a whole number from 0 to 65535, got "${process.env.PORT}"`)
  }
  const file = process.env.DATA_FILE || 'stock.json'
  // Without this check the server would start, then answer 500 to every change it cannot save.
  if (!existsSync(dirname(resolve(file)))) return fail(`folder for DATA_FILE ${file} does not exist`)
  let server
  try {
    server = createApp(file)
  } catch (err) {
    return fail(loadErrorMessage(err, file))
  }
  server.on('error', err => fail(err.message))
  server.listen(port, '127.0.0.1', () => {
    console.log(`listening on http://127.0.0.1:${server.address().port}`)
  })
}

if (import.meta.main) main()
