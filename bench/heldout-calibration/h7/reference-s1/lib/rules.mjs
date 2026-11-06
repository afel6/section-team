// The rules for values in requests: each returns the message of the rule a value breaks, or null.
const MAX_NAME = 80
const MAX_NOTE = 200
const MAX_QTY = 1_000_000_000
const MAX_COST = 1_000_000_000
const SKU = /^[A-Za-z0-9-]{1,32}$/
const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
const FIRST_YEAR = 2000
const LAST_YEAR = 2099
const DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const LEAP_EVERY = 4
const FEBRUARY = 2

export const isDate = value => {
  const match = typeof value === 'string' ? DATE.exec(value) : null
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > DAYS.length || day < 1) return false
  const leapless = month === FEBRUARY && year % LEAP_EVERY !== 0
  return day <= DAYS[month - 1] - (leapless ? 1 : 0)
}

export const skuProblem = sku => (typeof sku === 'string' && SKU.test(sku) ? null : 'sku must be 1 to 32 letters, digits or dashes')

export function nameProblem(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed.length >= 1 && trimmed.length <= MAX_NAME ? null : 'name must be 1 to 80 characters'
}

export const dateProblem = date => (isDate(date) ? null : 'on_date must be a valid YYYY-MM-DD date')
export const qtyProblem = qty => (Number.isInteger(qty) && qty !== 0 && Math.abs(qty) <= MAX_QTY ? null : 'qty must be a non-zero whole number up to 1000000000')
export const transferQtyProblem = qty => (Number.isInteger(qty) && qty >= 1 && qty <= MAX_QTY ? null : 'qty must be a whole number from 1 to 1000000000')
export const costProblem = cost => (Number.isInteger(cost) && cost >= 0 && cost <= MAX_COST ? null : 'unit_cost_cents must be a whole number from 0 to 1000000000')
export const noteProblem = note => (note === undefined || (typeof note === 'string' && note.length <= MAX_NOTE) ? null : 'note must be at most 200 characters')
