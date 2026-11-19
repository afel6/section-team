// Parses the text of a time log into entries. See README.md for the line format.
import { dayNumber, isDate } from './dates.mjs'

const TIME_RANGE = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/
const PROJECT = /^[a-z][a-z0-9-]{0,29}$/
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const MINUTES_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR

// A bad line in the log; line counts from 1.
export class LogError extends Error {
  constructor(line, reason) {
    super(`line ${line}: ${reason}`)
    this.name = 'LogError'
    this.line = line
    this.reason = reason
  }
}

// An entry whose end is earlier than its start runs past midnight into the next day.
const duration = (start, end) => (end > start ? end - start : end + MINUTES_PER_DAY - start)
const toMinutes = (h, m) => Number(h) * MINUTES_PER_HOUR + Number(m)
const validTime = (h, m) => Number(h) < HOURS_PER_DAY && Number(m) < MINUTES_PER_HOUR

function parseTimes(text) {
  const m = TIME_RANGE.exec(text)
  if (!m || !validTime(m[1], m[2]) || !validTime(m[3], m[4])) return null
  return { start: toMinutes(m[1], m[2]), end: toMinutes(m[3], m[4]) }
}

// One entry line (already known not to be blank or a comment) into an entry; throws LogError.
function parseEntry(text, line) {
  const fields = text.trim().split(/[ \t]+/)
  if (fields.length < 3) throw new LogError(line, 'missing fields')
  const [date, range, project] = fields
  if (!isDate(date)) throw new LogError(line, 'bad date')
  const times = parseTimes(range)
  if (!times) throw new LogError(line, 'bad time')
  if (times.start === times.end) throw new LogError(line, 'zero-length entry')
  if (!PROJECT.test(project)) throw new LogError(line, 'bad project')
  return { line, date, day: dayNumber(date), start: times.start, end: times.end, project, minutes: duration(times.start, times.end) }
}

const isSkipped = text => text.trim() === '' || text.trimStart().startsWith('#')

// The entries of a log, in file order; throws LogError for the first bad line.
export function parseLog(text) {
  const lines = text.split('\n').map(l => (l.endsWith('\r') ? l.slice(0, -1) : l))
  return lines.flatMap((l, i) => (isSkipped(l) ? [] : [parseEntry(l, i + 1)]))
}
