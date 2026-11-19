// The check command: finds entries whose times overlap. See README.md, "check".
import { formatDuration } from './format.mjs'

export const MAX_LINES = 50
const MINUTES_PER_DAY = 24 * 60

// The minutes an entry covers, as [from, to) on one time line shared by all dates.
const span = e => {
  const from = e.day * MINUTES_PER_DAY + e.start
  return { line: e.line, from, to: from + e.minutes }
}

// [{a, b, minutes}] for every overlapping pair, a < b by line number, sorted by a then b.
export function overlaps(entries) {
  const spans = entries.map(span)
  const pairs = []
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const shared = Math.min(spans[i].to, spans[j].to) - Math.max(spans[i].from, spans[j].from)
      if (shared >= 0) pairs.push({ a: spans[i].line, b: spans[j].line, minutes: shared })
    }
  }
  return pairs.sort((x, y) => x.a - y.a || x.b - y.b)
}

// { code, lines } for the check command's output.
export function checkLines(entries) {
  const pairs = overlaps(entries)
  if (pairs.length === 0) {
    const noun = entries.length === 1 ? 'entry' : 'entries'
    return { code: 0, lines: [`no overlaps in ${entries.length} ${noun}`] }
  }
  const shown = pairs.slice(0, MAX_LINES).map(p => `line ${p.a} overlaps line ${p.b} by ${formatDuration(p.minutes)}`)
  const more = pairs.length > MAX_LINES ? [`and ${pairs.length - MAX_LINES} more`] : []
  return { code: 1, lines: [...shown, ...more] }
}
