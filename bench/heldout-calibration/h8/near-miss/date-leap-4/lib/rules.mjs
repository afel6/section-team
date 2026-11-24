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
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function parseDate(value) {
  if (!DATE.test(value)) throw new UserError(DATE_MESSAGE)
  const [year, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12) throw new UserError(DATE_MESSAGE)
  const days = month === 2 && year % 4 === 0 ? 29 : DAYS_IN_MONTH[month - 1]
  if (day < 1 || day > days) throw new UserError(DATE_MESSAGE)
  return value
}

// A loan number: a whole number written in digits, such as 3.
export function parseNumber(value) {
  if (!NUMBER.test(value)) throw new UserError('loan number must be a whole number like 3')
  return Number(value)
}
