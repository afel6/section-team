// Entry point: `node server.mjs`. Checks PORT, opens DB_FILE, then listens on 127.0.0.1, in that order.
import { resolve } from 'node:path'
import { createApp } from './lib/app.mjs'
import { MigrationFailed, openDatabase } from './lib/db.mjs'

const DEFAULT_PORT = 3000
const MAX_PORT = 65535
const DEFAULT_DB_FILE = 'parts.db'

function fail(line) {
  process.stderr.write(`${line}\n`)
  process.exitCode = 1
}

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT
  if (!/^[0-9]+$/.test(value)) return null
  const port = Number(value)
  return port <= MAX_PORT ? port : null
}

function main() {
  const port = parsePort(process.env.PORT)
  if (port === null) return fail(`PORT must be a whole number from 0 to ${MAX_PORT}`)
  const name = process.env.DB_FILE || DEFAULT_DB_FILE
  let db
  try {
    db = openDatabase(resolve(name))
  } catch (err) {
    return fail(err instanceof MigrationFailed ? `cannot migrate database ${name}` : `cannot open database ${name}`)
  }
  const server = createApp(db)
  server.on('error', err => fail(`cannot listen on 127.0.0.1:${port}: ${err.code ?? err.message}`))
  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`)
  })
}

main()
