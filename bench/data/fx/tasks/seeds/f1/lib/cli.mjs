// Command-line handling: turns arguments and a file into { code, out, err }. No process access here.
import { readFileSync } from 'node:fs'
import { isDate } from './dates.mjs'
import { LogError, parseLog } from './parse.mjs'
import { reportLines } from './report.mjs'

export const USAGE = 'usage: node timelog.mjs report <file> [--from <date>] [--to <date>]'
const OPTIONS = { '--from': 'from', '--to': 'to' }
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

class UsageError extends Error {}
const usage = () => ({ code: 2, out: '', err: `${USAGE}\n` })
const failure = (code, message) => ({ code, out: '', err: `error: ${message}\n` })

// { command, file, range } from the arguments; throws UsageError, or returns { badDate } for a bad option date.
function parseArgs(args) {
  const [command, file, ...rest] = args
  if (command !== 'report' || file === undefined) throw new UsageError()
  const range = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = OPTIONS[rest[i]]
    if (!key || key in range || i + 1 >= rest.length) throw new UsageError()
    range[key] = rest[i + 1]
  }
  for (const [flag, key] of Object.entries(OPTIONS)) {
    if (key in range && !isDate(range[key])) return { badDate: `bad date for ${flag}: ${range[key]}` }
  }
  return { command, file, range }
}

function readLog(file) {
  let bytes
  try { bytes = readFileSync(file) } catch { return { error: failure(3, `cannot read ${file}`) } }
  try { return { text: decoder.decode(bytes) } } catch { return { error: failure(3, `${file} is not valid UTF-8`) } }
}

export function run(args) {
  let parsed
  try { parsed = parseArgs(args) } catch (e) { if (e instanceof UsageError) return usage(); throw e }
  if (parsed.badDate) return failure(2, parsed.badDate)
  const { text, error } = readLog(parsed.file)
  if (error) return error
  let entries
  try { entries = parseLog(text) } catch (e) { if (e instanceof LogError) return failure(4, e.message); throw e }
  return { code: 0, out: `${reportLines(entries, parsed.range).join('\n')}\n`, err: '' }
}
