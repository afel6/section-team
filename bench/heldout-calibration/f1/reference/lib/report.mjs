// The report command: minutes per project for the entries whose date lies in the chosen range.
import { formatDuration } from './format.mjs'

const inRange = (entry, { from, to }) => (from === undefined || entry.date >= from) && (to === undefined || entry.date <= to)

const byTotal = ([pa, ma], [pb, mb]) => mb - ma || (pa < pb ? -1 : pa > pb ? 1 : 0)

// [[project, minutes], ...] sorted by minutes, most first, then by project name.
export function totals(entries, range = {}) {
  const sums = new Map()
  for (const e of entries.filter(x => inRange(x, range))) sums.set(e.project, (sums.get(e.project) ?? 0) + e.minutes)
  return [...sums].sort(byTotal)
}

// The report's lines, without the final newline.
export function reportLines(entries, range = {}) {
  const rows = totals(entries, range)
  const all = rows.reduce((sum, [, m]) => sum + m, 0)
  return [...rows.map(([p, m]) => `${p}\t${formatDuration(m)}`), `total\t${formatDuration(all)}`]
}
