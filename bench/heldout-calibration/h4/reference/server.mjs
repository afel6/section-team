// Entry point: `node server.mjs`. Checks PORT, reads DATA_FILE, then listens on 127.0.0.1, in that order.
// Env: PORT (default 3000), DATA_FILE (default bookings.json, relative to the current working directory).
import { resolve } from 'node:path'
import { createApp } from './lib/app.mjs'
import { loadState } from './lib/store.mjs'

const DEFAULT_PORT = 3000
const MAX_PORT = 65535
const DEFAULT_DATA_FILE = 'bookings.json'

// Writes one line to stderr; the process then exits with code 1 once nothing is left to run.
function fail(line) {
  process.stderr.write(`${line}\n`)
  process.exitCode = 1
}

// PORT as a number, or null when it is not made only of ASCII digits or is above MAX_PORT.
function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT
  if (!/^[0-9]+$/.test(value)) return null
  const port = Number(value)
  return port <= MAX_PORT ? port : null
}

function main() {
  const port = parsePort(process.env.PORT)
  if (port === null) return fail(`PORT must be a whole number from 0 to ${MAX_PORT}`)
  const name = process.env.DATA_FILE || DEFAULT_DATA_FILE
  const file = resolve(name)
  let state
  try {
    state = loadState(file)
  } catch {
    return fail(`cannot read data file ${name}`)
  }
  const server = createApp(file, state)
  server.on('error', err => fail(`cannot listen on 127.0.0.1:${port}: ${err.code ?? err.message}`))
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`)
  })
}

main()
