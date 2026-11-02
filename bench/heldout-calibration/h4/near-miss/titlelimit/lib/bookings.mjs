// Booking rules 4-10 and the list order. Pure functions: no I/O, inputs are never changed.
export const ROOMS = ['Aurora', 'Borealis', 'Cosmos']
export const DATE_ERROR = 'date must be a valid YYYY-MM-DD date'

const TITLE_MAX = 80
const FIRST_YEAR = 2000
const LAST_YEAR = 2099
const LAST_HOUR = 23
const LAST_MINUTE = 59
const DATE_PATTERN = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
const TIME_PATTERN = /^([0-9]{2}):([0-9]{2})$/
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

// A string YYYY-MM-DD naming a real day from 2000-01-01 to 2099-12-31 (every 4th year is a leap year there).
export function isValidDate(value) {
  const match = typeof value === 'string' ? DATE_PATTERN.exec(value) : null
  if (!match) return false
  const [year, month, day] = match.slice(1).map(Number)
  if (year < FIRST_YEAR || year > LAST_YEAR || month < 1 || month > 12) return false
  const days = month === 2 && year % 4 === 0 ? 29 : DAYS_IN_MONTH[month - 1]
  return day >= 1 && day <= days
}

// A string HH:MM from 00:00 to 23:59.
export function isValidTime(value) {
  const match = typeof value === 'string' ? TIME_PATTERN.exec(value) : null
  return match !== null && Number(match[1]) <= LAST_HOUR && Number(match[2]) <= LAST_MINUTE
}

// Rules 4-9 on a parsed body, in order. Returns { error } for the first rule that fails, else
// { fields } holding room, title (trimmed), date, start and end. Other keys of body are ignored.
export function checkFields(body) {
  const { room, title, date, start, end } = body
  if (!ROOMS.includes(room)) return { error: `room must be one of ${ROOMS.join(', ')}` }
  const trimmed = typeof title === 'string' ? title.trim() : ''
  if (trimmed.length < 1 || trimmed.length >= TITLE_MAX) return { error: `title must be 1 to ${TITLE_MAX} characters` }
  if (!isValidDate(date)) return { error: DATE_ERROR }
  if (!isValidTime(start)) return { error: 'start must be HH:MM' }
  if (!isValidTime(end)) return { error: 'end must be HH:MM' }
  if (end <= start) return { error: 'end must be after start' }
  return { fields: { room, title: trimmed, date, start, end } }
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

// Rule 10: the booking of the same room and date that overlaps `fields` and starts earliest, or undefined.
// Two bookings overlap when each starts before the other ends, so touching bookings do not.
export function findConflict(bookings, fields) {
  return bookings
    .filter(b => b.room === fields.room && b.date === fields.date && b.start < fields.end && fields.start < b.end)
    .toSorted((a, b) => compareText(a.start, b.start))[0]
}

// List order: date, then start, then room in the order of ROOMS.
export function compareBookings(a, b) {
  return compareText(a.date, b.date) || compareText(a.start, b.start) || ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room)
}
