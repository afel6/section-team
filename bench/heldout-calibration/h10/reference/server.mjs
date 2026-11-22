// Quick polls: a JSON API and a page, with every poll kept in one JSON file.
// Env: PORT (default 3000), DATA_FILE (default polls.json, relative to the working directory).
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { errorReply, readBody, send } from './lib/http.mjs'
import { handle } from './lib/routes.mjs'
import { loadStore, saveStore } from './lib/store.mjs'

const DEFAULT_PORT = 3000
const MAX_PORT = 65535

// The app around the store in file. Each request's body is read whole first; the handler and the save then run without
// awaiting, so requests never interleave, and a change replaces the in-memory state only once it is saved.
export function createApp(file, initial) {
  let state = initial
  return createServer(async (req, res) => {
    try {
      const body = await readBody(req)
      const path = req.url.split('?')[0]
      const reply = handle({ state, method: req.method, path, headers: req.headers, body })
      if (reply.state) {
        saveStore(file, reply.state)
        state = reply.state
      }
      send(res, reply)
    } catch (err) {
      send(res, errorReply(err))
    }
  })
}

// The port from PORT: ASCII digits only, at most MAX_PORT; null when it is not.
function portFrom(text) {
  if (text === undefined || text === '') return DEFAULT_PORT
  if (!/^[0-9]+$/.test(text) || Number(text) > MAX_PORT) return null
  return Number(text)
}

function fail(line) {
  process.stderr.write(`${line}\n`)
  process.exitCode = 1
}

function main() {
  const port = portFrom(process.env.PORT)
  if (port === null) return fail(`PORT must be a whole number from 0 to ${MAX_PORT}`)
  const name = process.env.DATA_FILE || 'polls.json'
  const file = resolve(name)
  let state
  try {
    state = loadStore(file)
  } catch {
    return fail(`cannot read data file ${name}`)
  }
  const server = createApp(file, state)
  server.on('error', err => fail(`cannot listen on port ${port}: ${err.code ?? err.message}`))
  server.listen(port, '127.0.0.1', () => process.stdout.write(`listening on http://127.0.0.1:${server.address().port}\n`))
}

if (import.meta.main) main()
