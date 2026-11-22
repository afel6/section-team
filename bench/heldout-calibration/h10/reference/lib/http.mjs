// HTTP helpers: reading the whole body, the JSON body check, and sending replies.
export const MAX_BODY_BYTES = 10000
const JSON_TYPE = 'application/json; charset=utf-8'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// Reads the whole body. Past MAX_BODY_BYTES it keeps reading but drops the bytes, so the client still gets the reply.
// text is null when the body was too large.
export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) chunks.push(chunk)
    })
    req.on('end', () => resolve({ text: size > MAX_BODY_BYTES ? null : Buffer.concat(chunks).toString('utf8') }))
    req.on('error', reject)
  })
}

// The media type: the part before the first ";", spaces and tabs trimmed, letter case ignored.
const mediaType = header => (header ?? '').split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase()

// The JSON object in the body, after the content type and size checks.
export function jsonObject(headers, body) {
  if (mediaType(headers['content-type']) !== 'application/json') throw new HttpError(415, 'content type must be application/json')
  if (body.text === null) throw new HttpError(413, 'body too large')
  let value
  try {
    value = JSON.parse(body.text)
  } catch {
    throw new HttpError(400, 'body must be a JSON object')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'body must be a JSON object')
  return value
}

// Sends { status, body } as JSON, { status, page: { type, text } } as is, or { status } with no body.
export function send(res, { status, body, page }) {
  if (page) {
    res.writeHead(status, { 'content-type': page.type, 'content-length': Buffer.byteLength(page.text) })
    res.end(page.text)
  } else if (body === undefined) {
    res.writeHead(status)
    res.end()
  } else {
    const text = JSON.stringify(body)
    res.writeHead(status, { 'content-type': JSON_TYPE, 'content-length': Buffer.byteLength(text) })
    res.end(text)
  }
}

export function errorReply(err) {
  if (err instanceof HttpError) return { status: err.status, body: { error: err.message } }
  process.stderr.write(`request failed: ${err?.code ?? err?.message ?? err}\n`)
  return { status: 500, body: { error: 'internal error' } }
}
