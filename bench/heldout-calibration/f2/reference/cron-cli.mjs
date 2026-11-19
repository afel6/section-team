#!/usr/bin/env node
// node cron-cli.mjs <expression> [--from <time>] [--count <n>]: prints the next runs of a cron expression in UTC.
import { CronError, nextRuns } from './cron.mjs'

const USAGE = 'usage: node cron-cli.mjs <expression> [--from <time>] [--count <n>]'
const DEFAULT_COUNT = 5
const MAX_COUNT = 1000
const MIN_YEAR = 1970
const MAX_YEAR = 9899
const FROM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z$/
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

class Exit extends Error {
  constructor(code, message) { super(message); this.code = code }
}

// { expression, from?, count? } as text; throws Exit(2) with the usage line.
function parseArgs(args) {
  const options = {}
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--from' || a === '--count') {
      const key = a.slice(2)
      if (key in options || i + 1 >= args.length) throw new Exit(2, USAGE)
      options[key] = args[++i]
    } else if (a.startsWith('--')) throw new Exit(2, USAGE)
    else positional.push(a)
  }
  if (positional.length !== 1) throw new Exit(2, USAGE)
  return { expression: positional[0], ...options }
}

function parseFrom(text) {
  const m = FROM.exec(text)
  const bad = () => { throw new Exit(2, `error: invalid --from: ${text}`) }
  if (!m) bad()
  const [y, mo, d, h, mi, s = 0] = m.slice(1).map(v => (v === undefined ? undefined : Number(v)))
  if (y < MIN_YEAR || y > MAX_YEAR || h > 23 || mi > 59 || s > 59) bad()
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s))
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) bad()
  return date
}

function parseCount(text) {
  if (!/^\d+$/.test(text) || Number(text) < 1 || Number(text) > MAX_COUNT) throw new Exit(2, `error: invalid --count: ${text}`)
  return Number(text)
}

const two = n => String(n).padStart(2, '0')
const formatRun = d => `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())} ${DAYS[d.getUTCDay()]}`

function main(args) {
  const parsed = parseArgs(args)
  const from = parsed.from === undefined ? new Date() : parseFrom(parsed.from)
  const count = parsed.count === undefined ? DEFAULT_COUNT : parseCount(parsed.count)
  let runs
  try {
    runs = nextRuns(parsed.expression, from, count)
  } catch (e) {
    if (e instanceof CronError) throw new Exit(3, `error: ${e.message}`)
    throw e
  }
  const out = runs.map(r => `${formatRun(r)}\n`).join('')
  if (runs.length < count) return { code: 1, out, err: `error: only ${runs.length} of ${count} runs within 100 years\n` }
  return { code: 0, out, err: '' }
}

function run(args) {
  try { return main(args) } catch (e) {
    if (e instanceof Exit) return { code: e.code, out: '', err: `${e.message}\n` }
    throw e
  }
}

const { code, out, err } = run(process.argv.slice(2))
process.stdout.write(out)
process.stderr.write(err)
process.exitCode = code
