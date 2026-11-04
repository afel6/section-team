// What handlers return, and the parts of a request every handler shares.
export const MAX_BODY = 10_000
const JSON_TYPE = 'application/json'

export const reply = (status, body) => ({ status, body })
export const fail = (status, error) => reply(status, { error })

// A row id from a path's <id>, or null when it cannot be any row's id.
export function rowId(text) {
  if (!/^[1-9][0-9]*$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) ? id : null
}

const mediaType = header => String(header ?? '').split(';')[0].replace(/^[ \t]+|[ \t]+$/g, '').toLowerCase()

function parseObject(bytes) {
  try {
    const value = JSON.parse(bytes.toString('utf8'))
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

// The request's JSON object as { value }, or { problem } with the reply for the first body rule it breaks.
export function jsonBody(request) {
  if (mediaType(request.headers['content-type']) !== JSON_TYPE) return { problem: fail(415, 'content type must be application/json') }
  if (request.bodySize > MAX_BODY) return { problem: fail(413, 'body too large') }
  const value = parseObject(request.body)
  return value === null ? { problem: fail(400, 'body must be a JSON object') } : { value }
}
