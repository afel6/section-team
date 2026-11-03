// HTTP entry point: finds the route, reads the JSON body of the routes that take one, runs the handler and
// saves the store after every change. Env: PORT (default 3000), DATA_FILE (default groups.json).
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { errorReply, parseJsonObject, readBody, send } from './lib/http.mjs'
import { findRoute } from './lib/routes.mjs'
import { load, save } from './lib/store.mjs'

const DEFAULT_PORT = 3000
const MAX_PORT = 65535

// Builds the server around the store in dataFile. The store is kept in memory; each change is saved before it
// replaces the in-memory copy, so a failed save changes nothing.
export function createApp(dataFile) {
  let state = load(dataFile)
  return createServer(async (req, res) => {
    try {
      // Prefixing the origin keeps a request path like //host/groups a path, not a host.
      const url = new URL(`http://localhost${req.url}`)
      const route = findRoute(req.method, url.pathname)
      if (!route) return send(res, { status: 404, body: { error: 'not found' } })
      const body = route.takesBody ? parseJsonObject(await readBody(req)) : undefined
      const reply = route.handler({ state, params: route.params, query: url.searchParams, body })
      if (reply.state) {
        save(dataFile, reply.state)
        state = reply.state
      }
      send(res, reply)
    } catch (err) {
      send(res, errorReply(err))
    }
  })
}

function fail(message) {
  console.error(`cannot start: ${message}`)
  process.exitCode = 1
}

// A plain message for the OS errors a bad DATA_FILE gives; any other error keeps its own.
function loadErrorMessage(err, file) {
  if (err.code === 'EISDIR') return `DATA_FILE ${file} is a folder, not a file`
  if (err.code === 'EACCES') return `cannot read DATA_FILE ${file}: permission denied`
  return err.message
}

function main() {
  const port = Number(process.env.PORT || DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    return fail(`PORT must be a whole number from 0 to ${MAX_PORT}, got "${process.env.PORT}"`)
  }
  const file = process.env.DATA_FILE || 'groups.json'
  // Without this check the server would start, then answer 500 to every change it cannot save.
  if (!existsSync(dirname(resolve(file)))) return fail(`folder for DATA_FILE ${file} does not exist`)
  let server
  try {
    server = createApp(file)
  } catch (err) {
    return fail(loadErrorMessage(err, file))
  }
  server.on('error', err => fail(err.message))
  server.listen(port, '127.0.0.1', () => {
    console.log(`listening on http://127.0.0.1:${server.address().port}`)
  })
}

if (import.meta.main) main()
