// HTTP entry point for the poll service. Env: PORT (default 3000), DATA_FILE (default polls.json).
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError, parseObject, readBody, send } from './lib/http.mjs'
import { closePoll, createPoll, getPoll, listPolls, retract, vote } from './lib/polls.mjs'
import { load, save } from './lib/store.mjs'

const DEFAULT_PORT = 3000
const MAX_PORT = 65535

// [pattern, { METHOD: [handler, takesBody] }]; a pattern segment starting with : captures one path segment.
const ROUTES = [
  ['/polls', { GET: [listPolls, false], POST: [createPoll, true] }],
  ['/polls/:id', { GET: [getPoll, false] }],
  ['/polls/:id/votes', { POST: [vote, true] }],
  ['/polls/:id/votes/:voter', { DELETE: [retract, false] }],
  ['/polls/:id/close', { POST: [closePoll, false] }],
]

function matchPath(pattern, path) {
  const [want, got] = [pattern.split('/'), path.split('/')]
  if (want.length !== got.length) return null
  const params = {}
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) {
      if (got[i] === '') return null
      params[want[i].slice(1)] = got[i]
    } else if (want[i] !== got[i]) return null
  }
  return params
}

function findRoute(method, path) {
  for (const [pattern, methods] of ROUTES) {
    const params = matchPath(pattern, path)
    if (!params) continue
    if (!Object.hasOwn(methods, method)) throw new HttpError(405, 'method not allowed', { allow: Object.keys(methods).join(', ') })
    const [handler, takesBody] = methods[method]
    return { handler, takesBody, params }
  }
  throw new HttpError(404, 'not found')
}

export function createApp(dataFile) {
  let store = load(dataFile)
  return createServer(async (req, res) => {
    try {
      const qAt = req.url.indexOf('?')
      const path = qAt < 0 ? req.url : req.url.slice(0, qAt)
      const query = new URLSearchParams(qAt < 0 ? '' : req.url.slice(qAt + 1))
      const route = findRoute(req.method, path)
      const body = route.takesBody ? parseObject(await readBody(req)) : undefined
      if (!route.takesBody) req.resume()
      // Handling and saving run without an await in between, so requests never interleave here.
      const reply = route.handler({ store, params: route.params, query, body })
      if (reply.store) {
        try { save(dataFile, reply.store) } catch { throw new HttpError(500, 'cannot save') }
        store = reply.store
      }
      send(res, reply.status, reply.body)
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message }, err.headers)
      send(res, 500, { error: 'internal error' })
    }
  })
}

function main() {
  const port = Number(process.env.PORT || DEFAULT_PORT)
  const file = process.env.DATA_FILE || 'polls.json'
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    console.error(`PORT must be a whole number from 0 to ${MAX_PORT}`)
    process.exitCode = 1
    return
  }
  let server
  try {
    server = createApp(file)
  } catch {
    console.error(`cannot load ${file}`)
    process.exitCode = 1
    return
  }
  server.on('error', e => { console.error(e.message); process.exitCode = 1 })
  server.listen(port, '127.0.0.1', () => console.log(`listening on http://127.0.0.1:${server.address().port}`))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
