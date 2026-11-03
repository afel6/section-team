// HTTP helpers: reading a JSON body, sending JSON replies and turning errors into replies.
import { ValidationError } from './validate.mjs'

export const MAX_BODY_BYTES = 10 * 1024

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Reads the whole body as UTF-8. Past MAX_BODY_BYTES it stops keeping chunks but still drains the upload,
// so the 413 reply reaches the client instead of a reset connection.
export function readBody(req) {
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

export function parseJsonObject(text) {
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

// Sends { status, body }: body as JSON, or no body at all when it is undefined (204).
export function send(res, { status, body }) {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

export function errorReply(err) {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } }
  if (err instanceof ValidationError) return { status: 400, body: { error: err.message } }
  // An OS error (ENOENT, EACCES, ...) is logged as one line; any other error keeps its stack.
  console.error(err.code ? [err.code, err.syscall, err.path].filter(Boolean).join(' ') : err)
  return { status: 500, body: { error: 'internal error' } }
}
