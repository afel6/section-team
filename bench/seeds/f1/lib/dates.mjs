// Calendar dates as written in the log (YYYY-MM-DD), proleptic Gregorian, years 0000 to 9999.
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const isLeap = y => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)

// True when text is a real calendar date written as YYYY-MM-DD.
export function isDate(text) {
  const m = DATE.exec(text)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return false
  const max = mo === 2 && isLeap(y) ? 29 : MONTH_DAYS[mo - 1]
  return d <= max
}

// Days since 0000-03-01 for a valid date (only differences between two results matter).
export function dayNumber(text) {
  let [y, m, d] = text.split('-').map(Number)
  if (m < 3) { y -= 1; m += 12 }
  return 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + Math.floor((153 * (m - 3) + 2) / 5) + d - 1
}
