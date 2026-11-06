import { createServer } from 'node:http'
import { auditRoutes } from './lib/audit-log.mjs'
import { accountRoutes } from './lib/accounts.mjs'
import { makeHandler } from './lib/http.mjs'
import { reportRoutes } from './lib/reports.mjs'
import { StartupError, portOf, prepareDatabase } from './lib/startup.mjs'
import { ticketRoutes } from './lib/tickets.mjs'

const HOST = '127.0.0.1'

function stop(line) {
  process.stderr.write(`${line}\n`)
  process.exitCode = 1
}

function main() {
  let port
  let db
  try {
    port = portOf(process.env)
    db = prepareDatabase(process.env)
  } catch (error) {
    if (error instanceof StartupError) return stop(error.message)
    throw error
  }
  const server = createServer(makeHandler({ db, routes: [...accountRoutes, ...ticketRoutes, ...auditRoutes, ...reportRoutes] }))
  server.once('error', error => {
    db.close()
    stop(`cannot listen on port ${port}: ${error.code ?? 'error'}`)
  })
  server.listen(port, HOST, () => {
    process.stdout.write(`listening on http://${HOST}:${server.address().port}\n`)
  })
}

main()
