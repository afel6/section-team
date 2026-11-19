// Request bodies and JSON replies.
export const MAX_BODY = 16384

export class HttpError extends Error {
  constructor(status, message, headers = {}) {
    super(message)
    this.status = status
    this.headers = headers
  }
}

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

// Reads the whole body; keeps at most MAX_BODY + 1 bytes and throws 413 when there were more than MAX_BODY.
export async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    if (size <= MAX_BODY) chunks.push(chunk)
    size += chunk.length
  }
  if (size > MAX_BODY) throw new HttpError(413, 'body too large')
  return Buffer.concat(chunks)
}

// The body as a JSON object; throws 400 for bytes that are not UTF-8 JSON or for a value that is not an object.
export function parseObject(bytes) {
  let value
  try { value = JSON.parse(decoder.decode(bytes)) } catch { throw new HttpError(400, 'invalid JSON') }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'body must be a JSON object')
  return value
}

export function send(res, status, body, headers = {}) {
  if (body === undefined) {
    res.writeHead(status, headers)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), ...headers })
  res.end(text)
}
