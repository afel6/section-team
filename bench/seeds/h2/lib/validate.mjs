// Input checks for request bodies and query strings. Each parser returns the clean value
// or throws a ValidationError, which the server turns into a 400 response.

export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

const SKU = /^[A-Z0-9-]{1,20}$/
const MAX_NAME_LENGTH = 200
const POSITIVE_INT = /^[1-9][0-9]{0,8}$/
const DEFAULT_PER_PAGE = 20
const MAX_PER_PAGE = 100

export function parseSku(v) {
  if (typeof v !== 'string' || !SKU.test(v)) {
    throw new ValidationError('sku must be 1 to 20 characters of A-Z, 0-9 or -')
  }
  return v
}

export function parseName(v) {
  if (typeof v !== 'string' || v.trim() === '' || v.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`name must be a non-empty string of at most ${MAX_NAME_LENGTH} characters`)
  }
  return v
}

export function parseQuantity(v) {
  const n = parseInt(v, 10)
  if (!Number.isInteger(n) || n < 1) throw new ValidationError('qty must be a whole number of at least 1')
  return n
}

function positiveInt(raw, name) {
  if (!POSITIVE_INT.test(raw)) throw new ValidationError(`${name} must be a whole number of at least 1`)
  return Number(raw)
}

// query is a URLSearchParams. Reads ?page= (default 1) and ?per_page= (default 20, at most 100).
export function parsePage(query) {
  const page = positiveInt(query.get('page') ?? '1', 'page')
  const perPage = positiveInt(query.get('per_page') ?? String(DEFAULT_PER_PAGE), 'per_page')
  if (perPage > MAX_PER_PAGE) throw new ValidationError(`per_page must be at most ${MAX_PER_PAGE}`)
  return { page, perPage }
}
