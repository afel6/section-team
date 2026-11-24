// Input rules shared by every command: each parser returns the clean value or throws a UserError.
export class UserError extends Error {}

const ITEM_MAX = 100
const PERSON_MAX = 40
const DATE = /^\d{4}-\d{2}-\d{2}$/
const NUMBER = /^[1-9]\d*$/

export const DATE_MESSAGE = 'due date must be a real date as YYYY-MM-DD'

const text = (value, max, message) => {
  const trimmed = value.trim()
  if (trimmed.length < 1 || trimmed.length > max) throw new UserError(message)
  return trimmed
}

export const parseItem = value => text(value, ITEM_MAX, `item must be 1 to ${ITEM_MAX} characters`)
export const parsePerson = value => text(value, PERSON_MAX, `person must be 1 to ${PERSON_MAX} characters`)

// A date as YYYY-MM-DD; used by add --due, edit --due and list --due-before.
export function parseDate(value) {
  if (!DATE.test(value)) throw new UserError(DATE_MESSAGE)
  const date = new Date(`${value}T00:00:00Z`)
  // Date rolls a day the month does not have into the next month (2026-02-30 becomes 2026-03-02): refuse those.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new UserError(DATE_MESSAGE)
  return value
}

// A loan number: a whole number written in digits, such as 3.
export function parseNumber(value) {
  if (!NUMBER.test(value)) throw new UserError('loan number must be a whole number like 3')
  return Number(value)
}
