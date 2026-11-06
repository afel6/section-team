// Stage 1, working with other tools: locks, failures inside a write, requests at the same time, secrets, and the audit log.
import assert from 'node:assert/strict'
import { E, LINE, answer, api, commentOf, err, expect, get, it, ok, post, req, rows, same, sessionOf, startServer, stopServer, ticketOf, userOf, view, withDb, withLock, withServer, ADMIN_PW } from './lib.mjs'

export function toolCases() {
  lockCases()
  failureCases()
  concurrencyCases()
  secretCases()
  auditCases()
}

function lockCases() {
  it('a locked database: replies that need no database come at once, a request that needs it waits about 3 s and gets 503 `database busy`', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      await withDb(s.file, async db => {
        db.exec('BEGIN EXCLUSIVE')
        try {
          const t0 = Date.now()
          same('unknown path', view(await get(s, '/api/nope')), answer(404, err(E.notFound)))
          same('wrong method', view(await req(s, 'PUT', '/api/tickets')), answer(405, err(E.methodNotAllowed)))
          same('no cookie', view(await get(s, '/api/tickets')), answer(401, err(E.login)))
          same('no sid piece', view(await get(s, '/api/tickets', { headers: { cookie: 'a=b; c=d' } })), answer(401, err(E.login)))
          assert.ok(Date.now() - t0 < 2000, `those four took ${Date.now() - t0} ms`)
          const t1 = Date.now()
          same('a session lookup', view(await get(s, '/api/tickets', { as: A })), answer(503, err(E.busy)))
          const waited = Date.now() - t1
          assert.ok(waited >= 2700 && waited < 9000, `the wait was ${waited} ms`)
          same('an unknown token needs the database too', view(await get(s, '/api/tickets', { headers: { cookie: 'sid=abc' } })), answer(503, err(E.busy)))
        } finally {
          db.exec('ROLLBACK')
        }
      })
      same('the server keeps running', { status: (await get(s, '/api/tickets', { as: A })).status }, { status: 200 })
    })
  })

  it('a locked database: a write and a login get 503 too, and nothing they started stays', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const before = rows(s.file, 'SELECT (SELECT count(*) FROM tickets) AS t, (SELECT count(*) FROM audit) AS a, (SELECT count(*) FROM sessions) AS s, (SELECT count(*) FROM login_failures) AS f')
      await withDb(s.file, async db => {
        db.exec('BEGIN EXCLUSIVE')
        try {
          same('POST', view(await api(s, A).post('/api/tickets', { title: 'T', description: 'D' })), answer(503, err(E.busy)))
          same('login', view(await post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' })), answer(503, err(E.busy)))
        } finally {
          db.exec('ROLLBACK')
        }
      })
      assert.deepEqual(rows(s.file, 'SELECT (SELECT count(*) FROM tickets) AS t, (SELECT count(*) FROM audit) AS a, (SELECT count(*) FROM sessions) AS s, (SELECT count(*) FROM login_failures) AS f'), before)
      await ok(api(s, A).post('/api/tickets', { title: 'T', description: 'D' }), 201)
    })
  })

  it('a lock that goes within 3 s is waited out: reads, writes and logins succeed', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const t0 = Date.now()
      await withLock(s.file, 1200, () => [api(s, A).get('/api/tickets'), api(s, A).post('/api/tickets', { title: 'waited', description: 'D' })], async sent => {
        const [list, made] = await Promise.all(sent)
        same('statuses', { list: list.status, made: made.status }, { list: 200, made: 201 })
      })
      assert.ok(Date.now() - t0 >= 1000)
      await withLock(s.file, 1200, () => [post(s, '/api/session', { username: 'admin', password: ADMIN_PW })], async ([login]) => same('login', { status: (await login).status }, { status: 200 }))
      assert.deepEqual(rows(s.file, 'SELECT title FROM tickets'), [{ title: 'waited' }])
    })
  })
}

function failureCases() {
  const TRIGGER = "CREATE TRIGGER no_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'boom'); END"
  const state = file => rows(file, `SELECT (SELECT count(*) FROM tickets) AS tickets, (SELECT count(*) FROM comments) AS comments, (SELECT count(*) FROM users) AS users,
    (SELECT count(*) FROM sessions) AS sessions, (SELECT count(*) FROM login_failures) AS failures, (SELECT count(*) FROM audit) AS audit,
    (SELECT group_concat(name || seq) FROM sqlite_sequence) AS seqs, (SELECT group_concat(password_hash || role) FROM users) AS hashes,
    (SELECT group_concat(title || status || priority) FROM tickets) AS titles`)

  it('an unexpected failure in a write is 500 `internal error`, nothing the request started stays, and the server keeps running', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const bob = await userOf(s, A, { username: 'bob_user' })
      const t = await ticketOf(s, A, 'kept')
      await commentOf(s, A, t.id)
      await post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' })
      withDb(s.file, db => db.exec(TRIGGER))
      const before = state(s.file)
      const attempts = [
        ['POST ticket', () => c.post('/api/tickets', { title: 'x', description: 'y' })],
        ['POST comment', () => c.post(`/api/tickets/${t.id}/comments`, { text: 'x' })],
        ['PATCH ticket', () => c.patch(`/api/tickets/${t.id}`, { title: 'changed', status: 'closed' })],
        ['DELETE ticket', () => c.del(`/api/tickets/${t.id}`)],
        ['POST user', () => c.post('/api/users', { username: 'new_one', password: 'long-enough-pw1', role: 'admin' })],
        ['PATCH user', () => c.patch(`/api/users/${bob.made.id}`, { password: 'changed-password-1', role: 'admin' })],
        ['login', () => post(s, '/api/session', { username: 'admin', password: ADMIN_PW })],
        ['logout', () => c.del('/api/session')],
      ]
      for (const [label, send] of attempts) {
        same(label, view(await send()), answer(500, err(E.internal)))
        assert.deepEqual(state(s.file), before, `${label} changed the database`)
      }
      same('reads still work', { status: (await c.get('/api/tickets')).status }, { status: 200 })
      withDb(s.file, db => db.exec('DROP TRIGGER no_audit'))
      const next = await ok(c.post('/api/tickets', { title: 'after', description: 'ok' }), 201)
      assert.equal(next.id, t.id + 1, 'a rolled-back request leaves no gap in the ids')
    })
  })

  it('an unexpected failure in a read or a login is 500 too, and the routes that do not touch the damaged part keep working', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      withDb(s.file, db => db.exec('ALTER TABLE login_failures RENAME TO lf_away'))
      same('login', view(await post(s, '/api/session', { username: 'admin', password: ADMIN_PW })), answer(500, err(E.internal)))
      same('another route', { status: (await get(s, '/api/session', { as: A })).status }, { status: 200 })
      withDb(s.file, db => db.exec('ALTER TABLE lf_away RENAME TO login_failures'))
      await ok(post(s, '/api/session', { username: 'admin', password: ADMIN_PW }), 200)
    })
  })
}

function concurrencyCases() {
  it('requests at the same time give the result of some order one at a time: 20 tickets, 20 comments and 5 equal usernames', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const made = await Promise.all(Array.from({ length: 20 }, (_, i) => c.post('/api/tickets', { title: `t${i}`, description: 'd' })))
      assert.deepEqual(made.map(r => r.status), Array(20).fill(201))
      const ids = made.map(r => JSON.parse(r.text).id)
      assert.equal(new Set(ids).size, 20)
      const notes = await Promise.all(ids.map(id => c.post(`/api/tickets/${id}/comments`, { text: 'hello' })))
      assert.deepEqual(notes.map(r => r.status), Array(20).fill(201))
      const users = await Promise.all(Array.from({ length: 5 }, () => c.post('/api/users', { username: 'twin_user', password: 'long-enough-pw1', role: 'member' })))
      assert.deepEqual(users.map(r => r.status).sort(), [201, 409, 409, 409, 409])
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'ticket.create'")[0].n, 20)
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'comment.create'")[0].n, 20)
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'user.create'")[0].n, 1)
    })
  })
}

function secretCases() {
  it('no reply, no output of the server and no table holds a password, a password hash or a session token, except the token in the Set-Cookie of its own login', async () => {
    const adminPw = 'Adm1n-secret-ZZTOP-7701'
    const secrets = { adminPw, created: 'U-secret-PW-8472-x', changed: 'P-secret-PW-9931-y', wrong: 'W-secret-PW-1100-z' }
    const s = await startServer({ env: { ADMIN_PASSWORD: adminPw } })
    const replies = []
    const keep = async pending => {
      const r = await pending
      replies.push(r)
      return r
    }
    const A = await sessionOf(s, 'admin', adminPw)
    const c = api(s, A)
    await keep(c.post('/api/users', { username: 'sec_user', password: secrets.created, role: 'member' }))
    const login = await keep(post(s, '/api/session', { username: 'sec_user', password: secrets.created }))
    const tokens = [A.token, /^sid=([0-9a-f]{64})/.exec(login.headers['set-cookie'][0])[1]]
    await keep(post(s, '/api/session', { username: 'sec_user', password: secrets.wrong }))
    await keep(post(s, '/api/users', `{"username":"x","password":"${secrets.wrong}"`, { as: A }))
    await keep(c.post('/api/users', { username: 'sec_user', password: secrets.wrong, role: 'member' }))
    await keep(c.patch('/api/users/2', { password: secrets.changed }))
    await keep(c.patch('/api/users/2', { password: 'x', other: secrets.wrong }))
    withDb(s.file, db => db.exec("CREATE TRIGGER no_audit BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'boom'); END"))
    await keep(c.post('/api/tickets', { title: `title ${secrets.wrong}`, description: 'd' }))
    await keep(post(s, '/api/session', { username: 'admin', password: adminPw }))
    withDb(s.file, db => db.exec('DROP TRIGGER no_audit'))
    await keep(c.post('/api/tickets', { title: 'fine', description: 'd' }))
    for (const path of ['/api/users', '/api/tickets', '/api/audit', '/api/session', '/api/tickets/1', '/api/tickets/1/comments']) await keep(c.get(path))
    await keep(c.del('/api/session'))
    const hashes = rows(s.file, 'SELECT password_hash FROM users').map(r => r.password_hash)
    const tokenHashes = rows(s.file, 'SELECT token_hash FROM sessions').map(r => r.token_hash)
    await stopServer(s)
    const bad = [...Object.values(secrets), ...hashes, ...hashes.flatMap(h => h.split('$').slice(1)), ...tokenHashes, ...tokens]
    const text = r => `${r.text}\n${JSON.stringify(r.headers)}`
    for (const r of replies) {
      const body = r === login ? r.text + JSON.stringify({ ...r.headers, 'set-cookie': undefined }) : text(r)
      for (const word of bad) assert.equal(body.includes(word), false, `a reply (${r.status}) holds ${word.slice(0, 12)}...`)
    }
    assert.equal(login.headers['set-cookie'].length, 1)
    assert.equal(s.out, LINE(s.port), 'stdout holds the listening line and nothing more')
    for (const word of bad) assert.equal(s.err.includes(word), false, `stderr holds ${word.slice(0, 12)}...`)
    const dumpText = JSON.stringify(['users', 'sessions', 'login_failures', 'tickets', 'comments', 'audit'].map(t => rows(s.file, `SELECT * FROM ${t}`)))
    for (const word of [...Object.values(secrets), ...tokens]) assert.equal(dumpText.includes(word), false, `the database holds ${word.slice(0, 12)}...`)
  })
}

function auditCases() {
  it('the audit log: one entry per successful audited request, none for anything that failed or only reads; GET /api/audit shows them newest first', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const bob = await userOf(s, A, { username: 'bob_user' })
      const bobTicket = await ticketOf(s, bob, 'bobs')
      await commentOf(s, A, bobTicket.id, 'hi')
      await ok(c.patch(`/api/tickets/${bobTicket.id}`, { status: 'pending' }), 200)
      await ok(c.patch(`/api/users/${bob.made.id}`, { role: 'member' }), 200)
      const failures = [
        () => c.post('/api/users', { username: 'x' }), () => api(s, bob).get('/api/audit'), () => get(s, '/api/audit'), () => c.get('/api/tickets/999'), () => c.del('/api/tickets/999'),
        () => c.post(`/api/tickets/${bobTicket.id}/comments`, { text: '' }), () => c.patch('/api/users/1', { role: 'member' }), () => post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' }),
        () => c.patch(`/api/tickets/${bobTicket.id}`, { status: 'weird' }), () => c.get('/api/tickets'), () => c.get('/api/users'), () => c.get('/api/session'),
      ]
      for (const send of failures) await send()
      await ok(c.del(`/api/tickets/${bobTicket.id}`), 204)
      await ok(c.del('/api/session'), 204)
      const log = rows(s.file, 'SELECT id, at, user_id, action, target FROM audit ORDER BY id')
      const want = [
        ['login', 1, 'user:1'], ['user.create', 1, 'user:2'], ['login', 2, 'user:2'], ['ticket.create', 2, `ticket:${bobTicket.id}`], ['comment.create', 1, 'comment:1'],
        ['ticket.update', 1, `ticket:${bobTicket.id}`], ['user.update', 1, 'user:2'], ['ticket.delete', 1, `ticket:${bobTicket.id}`], ['logout', 1, 'user:1'],
      ]
      same('entries', { log: log.map(e => [e.action, e.user_id, e.target]) }, { log: want })
      assert.ok(log.every((e, i) => i === 0 || (e.at >= log[i - 1].at && e.id > log[i - 1].id)), 'time and ids rise')
    })
  })

  it('GET /api/audit (admin only): entries with exactly five keys, newest first, with limit, before and next as for tickets', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      for (let i = 0; i < 6; i++) await ticketOf(s, A, `t${i}`)
      const all = await ok(c.get('/api/audit'), 200)
      const total = all.entries.length
      assert.equal(total, 7, 'the login and six tickets')
      assert.deepEqual(all.entries.map(e => e.id), [7, 6, 5, 4, 3, 2, 1])
      assert.deepEqual(all.next, null)
      assert.deepEqual(Object.keys(all.entries[0]).sort(), ['action', 'at', 'id', 'target', 'user_id'])
      assert.deepEqual(all.entries.map(e => e.action), ['ticket.create', 'ticket.create', 'ticket.create', 'ticket.create', 'ticket.create', 'ticket.create', 'login'])
      const p1 = await ok(c.get('/api/audit?limit=3'), 200)
      same('first', { ids: p1.entries.map(e => e.id), next: p1.next }, { ids: [7, 6, 5], next: 5 })
      const p2 = await ok(c.get(`/api/audit?limit=3&before=${p1.next}`), 200)
      same('second', { ids: p2.entries.map(e => e.id), next: p2.next }, { ids: [4, 3, 2], next: 2 })
      const p3 = await ok(c.get(`/api/audit?limit=3&before=${p2.next}`), 200)
      same('last', { ids: p3.entries.map(e => e.id), next: p3.next }, { ids: [1], next: null })
      for (const limit of ['0', '101', '', 'x', '01']) await expect(`limit=${limit}`, c.get(`/api/audit?limit=${limit}`), 400, err(E.limit))
      for (const before of ['0', '', 'x', '01']) await expect(`before=${before}`, c.get(`/api/audit?before=${before}`), 400, err(E.before))
    })
  })
}
