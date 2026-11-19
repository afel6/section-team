// Cron expressions: parseCron turns one into sets of values, nextRuns finds the next matching minutes in UTC.
const FIELDS = [
  { key: 'minute', name: 'minute', min: 0, max: 59 },
  { key: 'hour', name: 'hour', min: 0, max: 23 },
  { key: 'dayOfMonth', name: 'day-of-month', min: 1, max: 31 },
  { key: 'month', name: 'month', min: 1, max: 12, names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], first: 1 },
  { key: 'dayOfWeek', name: 'day-of-week', min: 0, max: 7, names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], first: 0 },
]
const MAX_COUNT = 1000
const WINDOW_YEARS = 100
const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000
const SUNDAY_TOO = 7

export class CronError extends Error {
  constructor(message, field = null) {
    super(message)
    this.name = 'CronError'
    this.field = field
  }
}

class BadField extends Error {}
const bad = () => { throw new BadField() }

function parseValue(text, field) {
  if (/^\d{1,2}$/.test(text)) {
    const n = Number(text)
    return n >= field.min && n <= field.max ? n : bad()
  }
  const i = field.names && /^[a-z]{3}$/i.test(text) ? field.names.indexOf(text.toUpperCase()) : -1
  return i >= 0 ? i + field.first : bad()
}

function parseStep(text) {
  if (text === undefined) return 1
  return /^\d{1,2}$/.test(text) && Number(text) >= 1 ? Number(text) : bad()
}

// The values one comma-separated item stands for.
function parseItem(item, field) {
  const parts = item.split('/')
  if (parts.length > 2) bad()
  const [base, stepText] = parts
  const step = parseStep(stepText)
  let lo
  let hi
  if (base === '*') [lo, hi] = [field.min, field.max]
  else if (base.includes('-')) {
    const ends = base.split('-')
    if (ends.length !== 2) bad()
    ;[lo, hi] = ends.map(e => parseValue(e, field))
    if (lo > hi) bad()
  } else {
    lo = parseValue(base, field)
    hi = stepText === undefined ? lo : field.max
  }
  const values = []
  for (let v = lo; v <= hi; v += step) values.push(v)
  return values
}

function parseField(text, field) {
  try {
    const values = new Set(text.split(',').flatMap(item => parseItem(item, field)))
    if (field.key === 'dayOfWeek' && values.delete(SUNDAY_TOO)) values.add(0)
    return [...values].sort((a, b) => a - b)
  } catch (e) {
    if (e instanceof BadField) throw new CronError(`invalid ${field.name} field: ${text}`, field.name)
    throw e
  }
}

export function parseCron(expr) {
  if (typeof expr !== 'string') throw new TypeError('expression must be a string')
  const trimmed = expr.replace(/^[ \t]+|[ \t]+$/g, '')
  const parts = trimmed === '' ? [] : trimmed.split(/[ \t]+/)
  if (parts.length !== FIELDS.length) throw new CronError(`expected 5 fields, got ${parts.length}`)
  const result = Object.fromEntries(FIELDS.map((f, i) => [f.key, parseField(parts[i], f)]))
  return { ...result, dayOfMonthStar: parts[2].startsWith('*'), dayOfWeekStar: parts[4].startsWith('*') }
}

// True when the UTC day that starts at dayMs matches the day-of-month and day-of-week rule.
function dayMatches(cron, sets, dayMs) {
  const d = new Date(dayMs)
  if (!sets.month.has(d.getUTCMonth() + 1)) return false
  const dom = sets.dayOfMonth.has(d.getUTCDate())
  const dow = sets.dayOfWeek.has(d.getUTCDay())
  return dom && dow
}

function lastAllowedMs(from) {
  const end = new Date(0)
  end.setUTCFullYear(from.getUTCFullYear() + WINDOW_YEARS + 1, 0, 1)
  return end.getTime()
}

export function nextRuns(expr, from, count) {
  const cron = parseCron(expr)
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) throw new TypeError('from must be a valid Date')
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) throw new RangeError(`count must be an integer from 1 to ${MAX_COUNT}`)
  const sets = Object.fromEntries(FIELDS.map(f => [f.key, new Set(cron[f.key])]))
  const times = cron.hour.flatMap(h => cron.minute.map(m => (h * 60 + m) * MS_PER_MINUTE))
  const start = from.getTime()
  const end = lastAllowedMs(from)
  const runs = []
  for (let day = Math.floor(start / MS_PER_DAY) * MS_PER_DAY; day < end && runs.length < count; day += MS_PER_DAY) {
    if (!dayMatches(cron, sets, day)) continue
    for (const t of times) {
      if (day + t > start && runs.length < count) runs.push(new Date(day + t))
    }
  }
  return runs
}
