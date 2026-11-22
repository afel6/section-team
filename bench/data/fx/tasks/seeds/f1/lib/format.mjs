// Formats a number of minutes as hours and minutes, H:MM.
const MINUTES_PER_HOUR = 60

export function formatDuration(minutes) {
  const h = Math.floor(minutes / MINUTES_PER_HOUR)
  const m = minutes % MINUTES_PER_HOUR
  return `${h}:${m}`
}
