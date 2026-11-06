// Every behaviour of stage 1 as tests: the s1 set runs them on the code as it stood after stage 1, reg2 on the code after
// stage 2 and reg3 on the final code. `stage` is the stage of the code under test: from stage 2 on `/` and `/app.js` are routes,
// so the cases that need them to be unlisted run on stage 1 only; a database made by stage 1's own code must keep working.
import assert from 'node:assert/strict'
import { E, S1_DIR, answer, api, commentOf, dump, err, freshDb, it, ok, same, schemaOf, sessionOf, startServer, stopServer, ticketOf, userOf, view, ADMIN_PW, EXPECTED_SCHEMA, withServer } from './lib.mjs'
import { accountCases } from './stage-one-accounts.mjs'
import { routingCases } from './stage-one-routing.mjs'
import { startupCases } from './stage-one-startup.mjs'
import { ticketCases } from './stage-one-tickets.mjs'
import { toolCases } from './stage-one-tools.mjs'

export function stageOneCases({ stage }) {
  startupCases()
  routingCases({ stage })
  accountCases()
  ticketCases()
  toolCases()
  if (stage > 1) existingDataCases()
}

// A database that stage 1's own server filled is read, written and left in version 1 by the later code.
function existingDataCases() {
  it('a database that stage 1\'s code wrote works on this code: every reply as before, the schema unchanged, ids continuing', async () => {
    const file = freshDb()
    const old = await startServer({ file, dir: S1_DIR })
    let before
    try {
      const A = await sessionOf(old, 'admin', ADMIN_PW)
      const bob = await userOf(old, A, { username: 'bob_user' })
      const t1 = await ticketOf(old, bob, 'First', 'one', { priority: 'high' })
      const t2 = await ticketOf(old, A, 'Second', 'two')
      await commentOf(old, A, t1.id, 'a comment')
      await ok(api(old, A).patch(`/api/tickets/${t2.id}`, { status: 'closed' }), 200)
      await ok(api(old, A).del(`/api/tickets/${t2.id}`), 204)
      before = {
        tickets: await ok(api(old, A).get('/api/tickets'), 200), users: await ok(api(old, A).get('/api/users'), 200),
        comments: await ok(api(old, A).get(`/api/tickets/${t1.id}/comments`), 200), audit: await ok(api(old, A).get('/api/audit'), 200), t1, t2, bob: bob.made,
      }
    } finally {
      await stopServer(old)
    }
    const kept = dump(file)
    await withServer({ file, env: { ADMIN_PASSWORD: undefined } }, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const B = await sessionOf(s, 'bob_user', 'member-password-123')
      const c = api(s, A)
      same('tickets', view(await c.get('/api/tickets')), answer(200, before.tickets))
      same('users', view(await c.get('/api/users')), answer(200, before.users))
      same('comments', view(await c.get(`/api/tickets/${before.t1.id}/comments`)), answer(200, before.comments))
      same('bob\'s ticket', view(await api(s, B).get(`/api/tickets/${before.t1.id}`)), answer(200, before.t1))
      same('bob cannot see an admin ticket', view(await api(s, B).get(`/api/tickets/${before.t2.id}`)), answer(404, err(E.ticketNotFound)))
      const next = await ticketOf(s, A, 'Third')
      assert.ok(next.id > before.t2.id, `id ${next.id} after the deleted ${before.t2.id}`)
      const log = (await ok(c.get('/api/audit?limit=100'), 200)).entries
      assert.deepEqual(log.slice(-before.audit.entries.length), before.audit.entries, 'the old audit entries are untouched')
    })
    assert.deepEqual(dump(file).users, kept.users)
    same('schema', { schema: schemaOf(file) }, { schema: EXPECTED_SCHEMA })
  })
}
