// Stage 1, accounts: login, sessions, the failure limit, users, and how passwords are stored.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  ADMIN_PW, E, SCRYPT, USER_PW, adminOf, answer, api, cookieOf, err, expect, get, it, nextName, ok, passwordMatches, post, req, rows, same, scryptHash, sessionOf,
  shared, sha256, sleep, userOf, view, withDb, withServer,
} from './lib.mjs'

const COOKIE_TAIL = 'Path=/; HttpOnly; SameSite=Strict'
const loginRows = (file, where = '1') => rows(file, `SELECT username, at FROM login_failures WHERE ${where} ORDER BY id`)

export function accountCases() {
  loginCases()
  failureLimitCases()
  sessionCases()
  createUserCases()
  updateUserCases()
}

function loginCases() {
  it('a login: 200 with the user, a Set-Cookie of exactly the given form, a session stored by the hash of the token text, one audit entry', async () => {
    await withServer({}, async s => {
      const t0 = Date.now()
      const r = await post(s, '/api/session', { username: 'admin', password: ADMIN_PW })
      const t1 = Date.now()
      same('reply', view(r), answer(200, { user: { id: 1, username: 'admin', role: 'admin' } }))
      const token = cookieOf(r)
      assert.ok(token, `Set-Cookie: ${r.headers['set-cookie']}`)
      assert.deepEqual(r.headers['set-cookie'], [`sid=${token}; ${COOKIE_TAIL}; Max-Age=28800`])
      const sessions = rows(s.file, 'SELECT * FROM sessions')
      assert.equal(sessions.length, 1)
      same('session', { token_hash: sessions[0].token_hash, user_id: sessions[0].user_id }, { token_hash: sha256(token), user_id: 1 })
      assert.match(sessions[0].token_hash, /^[0-9a-f]{64}$/)
      const at = sessions[0].expires_at - 28_800_000
      assert.ok(at >= t0 && at <= t1, `expires_at is the request time + 8 hours (${at} not in ${t0}..${t1})`)
      assert.deepEqual(rows(s.file, 'SELECT at, user_id, action, target FROM audit'), [{ at, user_id: 1, action: 'login', target: 'user:1' }])
      const me = await get(s, '/api/session', { headers: { cookie: `sid=${token}` } })
      same('GET /api/session', view(me), answer(200, { user: { id: 1, username: 'admin', role: 'admin' } }))
      assert.equal(me.headers['set-cookie'], undefined)
    })
  })

  it('login errors: 400 for non-strings, 401 for an unknown user or a wrong password (same text), each wrong try is recorded with the request time', async () => {
    await withServer({}, async s => {
      const bodies = [{}, { username: 'admin' }, { password: ADMIN_PW }, { username: 1, password: ADMIN_PW }, { username: 'admin', password: null }, { username: ['admin'], password: 'x' }, { username: 'admin', password: {} }, { username: null, password: null }]
      for (const body of bodies) same(JSON.stringify(body), view(await post(s, '/api/session', body)), answer(400, err(E.strings)))
      assert.deepEqual(loginRows(s.file), [], 'a 400 records nothing')
      const t0 = Date.now()
      const wrong = [['admin', 'wrong-password-1'], ['ghost', ADMIN_PW], ['Admin', ADMIN_PW], ['admin', ''], ['admin ', ADMIN_PW], ['admin', ADMIN_PW + ' ']]
      for (const [username, password] of wrong) {
        same(`${username}/${password}`, view(await post(s, '/api/session', { username, password })), answer(401, err(E.wrong)))
        await sleep(2)
      }
      const t1 = Date.now()
      const got = loginRows(s.file)
      assert.deepEqual(got.map(r => r.username), wrong.map(w => w[0]), 'one row per failure, with the username as given')
      assert.ok(got.every(r => r.at >= t0 && r.at <= t1), 'at is the request time')
      assert.equal(rows(s.file, 'SELECT count(*) AS n FROM sessions')[0].n, 0)
      assert.equal(rows(s.file, 'SELECT count(*) AS n FROM audit')[0].n, 0, 'a failed login adds no audit entry')
    })
  })
}

function failureLimitCases() {
  it('5 recorded failures within 15 minutes lock a username: 429 even with the right password, nothing recorded, other names unaffected', async () => {
    await withServer({}, async s => {
      for (let i = 0; i < 4; i++) await expect(`failure ${i}`, post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' }), 401, err(E.wrong))
      await expect('the fifth failure is still a 401', post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' }), 401, err(E.wrong))
      assert.equal(loginRows(s.file).length, 5)
      for (const password of [ADMIN_PW, 'wrong-password-1']) await expect(`locked with ${password}`, post(s, '/api/session', { username: 'admin', password }), 429, err(E.tooMany))
      assert.equal(loginRows(s.file).length, 5, 'a 429 records nothing')
      assert.equal(rows(s.file, 'SELECT count(*) AS n FROM sessions')[0].n, 0)
      await expect('another name', post(s, '/api/session', { username: 'ghost', password: 'wrong-password-1' }), 401, err(E.wrong))
      await expect('another case', post(s, '/api/session', { username: 'Admin', password: ADMIN_PW }), 401, err(E.wrong))
      await expect('400 comes before 429', post(s, '/api/session', { username: 'admin', password: 5 }), 400, err(E.strings))
    })
  })

  it('a good login clears the failures of that username only; 4 failures then a good login never lock', async () => {
    await withServer({}, async s => {
      withDb(s.file, db => {
        const add = db.prepare('INSERT INTO login_failures (username, at) VALUES (?, ?)')
        for (let i = 0; i < 4; i++) add.run('admin', Date.now() - 1000 * i)
        add.run('ghost', Date.now())
        add.run('admin', Date.now() - 3_600_000)
      })
      await ok(post(s, '/api/session', { username: 'admin', password: ADMIN_PW }), 200)
      assert.deepEqual(loginRows(s.file).map(r => r.username), ['ghost'])
      for (let i = 0; i < 4; i++) await post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' })
      await ok(post(s, '/api/session', { username: 'admin', password: ADMIN_PW }), 200)
      assert.equal(loginRows(s.file, "username = 'admin'").length, 0)
    })
  })

  it('only failures newer than 15 minutes count, and the database is the truth: rows another tool added lock at once, old rows do not', async () => {
    await withServer({}, async s => {
      const plant = (n, at) => withDb(s.file, db => { for (let i = 0; i < n; i++) db.prepare('INSERT INTO login_failures (username, at) VALUES (?, ?)').run('admin', at) })
      plant(5, Date.now() - 900_000 - 1)
      await ok(post(s, '/api/session', { username: 'admin', password: ADMIN_PW }), 200, 'five failures just outside the window')
      plant(4, Date.now())
      plant(1, Date.now() - 900_000 - 5000)
      await ok(post(s, '/api/session', { username: 'admin', password: ADMIN_PW }), 200, 'four inside and one outside')
      plant(5, Date.now() - 900_000 + 20_000)
      await expect('five just inside the window', post(s, '/api/session', { username: 'admin', password: ADMIN_PW }), 429, err(E.tooMany))
      withDb(s.file, db => db.exec('DELETE FROM login_failures'))
      await ok(post(s, '/api/session', { username: 'admin', password: ADMIN_PW }), 200, 'rows another tool removed')
    })
  })

  it('requests at the same time act as if one at a time: 8 wrong logins at once give five 401 and three 429, and five rows', async () => {
    await withServer({}, async s => {
      const replies = await Promise.all(Array.from({ length: 8 }, () => post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' })))
      const counts = replies.reduce((c, r) => ({ ...c, [r.status]: (c[r.status] ?? 0) + 1 }), {})
      same('statuses', counts, { 401: 5, 429: 3 })
      assert.equal(loginRows(s.file).length, 5)
    })
  })
}

function sessionCases() {
  it('a logout: 204 with an empty body and the Set-Cookie of the task, that session row only is deleted, one audit entry; a second logout is 401', async () => {
    await withServer({}, async s => {
      const one = await sessionOf(s, 'admin', ADMIN_PW)
      const two = await sessionOf(s, 'admin', ADMIN_PW)
      assert.notEqual(one.token, two.token)
      const out = await req(s, 'DELETE', '/api/session', { as: one })
      same('logout', { status: out.status, text: out.text, cookie: out.headers['set-cookie'] }, { status: 204, text: '', cookie: [`sid=; ${COOKIE_TAIL}; Max-Age=0`] })
      assert.deepEqual(rows(s.file, 'SELECT token_hash FROM sessions'), [{ token_hash: sha256(two.token) }])
      assert.deepEqual(rows(s.file, "SELECT user_id, action, target FROM audit WHERE action = 'logout'"), [{ user_id: 1, action: 'logout', target: 'user:1' }])
      await expect('the old cookie', get(s, '/api/session', { as: one }), 401, err(E.login))
      await expect('the other session', get(s, '/api/session', { as: two }), 200, { user: { id: 1, username: 'admin', role: 'admin' } })
      await expect('a second logout', req(s, 'DELETE', '/api/session', { as: one }), 401, err(E.login))
    })
  })

  it('a login keeps the session the request already has; only the login and the logout set a cookie', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const r = await post(s, '/api/session', { username: 'admin', password: ADMIN_PW }, { as: A })
    assert.equal(r.status, 200)
    await expect('the old session stays', get(s, '/api/session', { as: A }), 200, { user: A.user })
    const replies = [await post(s, '/api/session', { username: 'admin', password: 'wrong-password-1' }), await get(s, '/api/session', { as: A }), await get(s, '/api/users', { as: A }), await get(s, '/api/nope'), await post(s, '/api/session', 'x', { type: 'text/plain' })]
    for (const x of replies) assert.equal(x.headers['set-cookie'], undefined, `${x.status} sets a cookie`)
  })

  it('a session is a row the database holds: it expires at expires_at, a row another tool adds or removes counts at once, and the token is hashed as text', async () => {
    await withServer({}, async s => {
      const token = 'ab'.repeat(32)
      const add = (hash, expires) => withDb(s.file, db => db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, 1, ?)').run(hash, expires))
      add(sha256(token), Date.now() + 60_000)
      await expect('planted session', get(s, '/api/session', { headers: { cookie: `sid=${token}` } }), 200, { user: { id: 1, username: 'admin', role: 'admin' } })
      const bytes = 'cd'.repeat(32)
      add(createHashOfBytes(bytes), Date.now() + 60_000)
      await expect('a hash of the 32 bytes is not the hash of the text', get(s, '/api/session', { headers: { cookie: `sid=${bytes}` } }), 401, err(E.login))
      const old = 'ef'.repeat(32)
      add(sha256(old), Date.now() - 1)
      await expect('expired', get(s, '/api/session', { headers: { cookie: `sid=${old}` } }), 401, err(E.login))
      const soon = '12'.repeat(32)
      add(sha256(soon), Date.now() + 2500)
      await expect('about to expire', get(s, '/api/session', { headers: { cookie: `sid=${soon}` } }), 200, { user: { id: 1, username: 'admin', role: 'admin' } })
      await sleep(3000)
      await expect('expired a moment later', get(s, '/api/session', { headers: { cookie: `sid=${soon}` } }), 401, err(E.login))
      withDb(s.file, db => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token)))
      await expect('removed', get(s, '/api/session', { headers: { cookie: `sid=${token}` } }), 401, err(E.login))
    })
  }, 120_000)

  it('the database is the only truth for users: a role, a password or a new user changed by another tool counts on the next request', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const planted = scryptHash('planted-password-1')
      withDb(s.file, db => db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('ann', ?, 'member')").run(planted))
      const ann = await sessionOf(s, 'ann', 'planted-password-1')
      await expect('member', get(s, '/api/users', { as: ann }), 403, err(E.forbidden))
      withDb(s.file, db => db.exec("UPDATE users SET role = 'admin' WHERE username = 'ann'"))
      assert.equal((await get(s, '/api/users', { as: ann })).status, 200, 'promoted by another tool')
      withDb(s.file, db => db.exec("UPDATE users SET role = 'member' WHERE username = 'ann'"))
      assert.equal((await get(s, '/api/users', { as: ann })).status, 403, 'demoted by another tool')
      withDb(s.file, db => db.prepare("UPDATE users SET password_hash = ? WHERE username = 'ann'").run(scryptHash('changed-password-2', 'ffeeddccbbaa99887766554433221100')))
      await expect('the old password', post(s, '/api/session', { username: 'ann', password: 'planted-password-1' }), 401, err(E.wrong))
      await ok(post(s, '/api/session', { username: 'ann', password: 'changed-password-2' }), 200)
      withDb(s.file, db => db.exec("UPDATE users SET password_hash = 'plaintext' WHERE username = 'ann'"))
      await expect('a hash that is not a scrypt hash matches nothing', post(s, '/api/session', { username: 'ann', password: 'plaintext' }), 401, err(E.wrong))
      assert.equal((await get(s, '/api/session', { as: A })).status, 200)
    })
  })

  it('passwords are stored as scrypt$<16-byte salt>$<64-byte key> in lowercase hex of the UTF-8 bytes, with a new salt each time', async () => {
    await withServer({}, async s => {
      const A = await adminOf(s)
      const same_ = 'same-password-123'
      const u1 = await userOf(s, A, { username: 'one_user', password: same_ })
      await userOf(s, A, { username: 'two_user', password: same_ })
      await userOf(s, A, { username: 'uni_user', password: 'pässwörd-日本語-😀' })
      const hashes = rows(s.file, 'SELECT username, password_hash FROM users').reduce((m, r) => ({ ...m, [r.username]: r.password_hash }), {})
      for (const h of Object.values(hashes)) assert.match(h, SCRYPT)
      assert.equal(passwordMatches(same_, hashes.one_user), true)
      assert.equal(passwordMatches('pässwörd-日本語-😀', hashes.uni_user), true)
      assert.notEqual(hashes.one_user.split('$')[1], hashes.two_user.split('$')[1], 'a new salt for every user')
      const before = hashes.one_user
      await ok(api(s, A).patch(`/api/users/${u1.made.id}`, { password: same_ }), 200)
      const after = rows(s.file, 'SELECT password_hash FROM users WHERE id = ?', u1.made.id)[0].password_hash
      assert.notEqual(after, before, 'the same password set again gets a new salt')
      assert.equal(passwordMatches(same_, after), true)
    })
  })
}

function createUserCases() {
  const base = { username: 'valid_name', password: 'long-enough-pw1', role: 'member' }

  it('POST /api/users: the rules of username, password and role, in that order, then the duplicate', async () => {
    await withServer({}, async s => {
      const c = api(s, await adminOf(s))
      const bad = async (label, patch, message) => same(label, view(await c.post('/api/users', { ...base, ...patch })), answer(400, err(message)))
      for (const username of ['ab', 'a'.repeat(33), 'Abc', 'a-b', 'a b', 'añb', '', 'abc\n', ' abc', 'abc ', 123, null, ['abc'], {}, 'a.b', 'ａｂｃ']) await bad(`username ${JSON.stringify(username)}`, { username }, E.username)
      same('no username', view(await c.post('/api/users', { password: base.password, role: 'member' })), answer(400, err(E.username)))
      for (const password of ['short', '1'.repeat(11), 'x'.repeat(201), 12345678901234, null, ['x'.repeat(12)], '😀'.repeat(101), '😀'.repeat(5), true]) await bad(`password ${String(password).slice(0, 14)}`, { password }, E.password)
      for (const role of ['Admin', 'root', '', null, 1, ['admin'], 'member ', 'ADMIN']) await bad(`role ${JSON.stringify(role)}`, { role }, E.role)
      same('no role', view(await c.post('/api/users', { username: 'valid_name', password: base.password })), answer(400, err(E.role)))
      await bad('all three bad', { username: 'x', password: 'x', role: 'x' }, E.username)
      await bad('password and role bad', { password: 'x', role: 'x' }, E.password)
      await bad('a taken name with a bad role', { username: 'admin', role: 'x' }, E.role)
      await bad('a taken name with a bad password', { username: 'admin', password: 'x' }, E.password)
      await expect('a taken name', c.post('/api/users', { ...base, username: 'admin' }), 409, err(E.exists))
      assert.equal(rows(s.file, 'SELECT count(*) AS n FROM users')[0].n, 1)
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action <> 'login'")[0].n, 0, 'nothing that failed is audited')
    })
  })

  it('POST /api/users: 201 and the user, with the password as given (spaces kept), one audit entry, ids that rise; other keys are ignored', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const cases = [['abc', 'x'.repeat(12)], ['a'.repeat(32), 'x'.repeat(200)], ['_0_', '😀'.repeat(6)], ['123', ' '.repeat(12)], ['spaced', '  pass word 12  ']]
      for (const [i, [username, password]] of cases.entries()) {
        const t0 = Date.now()
        const r = await c.post('/api/users', { username, password, role: i % 2 ? 'admin' : 'member', id: 99, password_hash: 'x' })
        same(username, view(r), answer(201, { id: i + 2, username, role: i % 2 ? 'admin' : 'member' }))
        same('login with the exact password', { status: (await post(s, '/api/session', { username, password })).status }, { status: 200 })
        const [entry] = rows(s.file, "SELECT at, user_id, action, target FROM audit WHERE action = 'user.create' AND target = ?", `user:${i + 2}`)
        same('audit', { user_id: entry.user_id, action: entry.action, recent: entry.at >= t0 && entry.at <= Date.now() }, { user_id: 1, action: 'user.create', recent: true })
      }
      const list = await ok(c.get('/api/users'), 200)
      assert.deepEqual(list.users.map(u => Object.keys(u).sort()), list.users.map(() => ['id', 'role', 'username']))
      assert.deepEqual(list.users.map(u => u.id), [1, 2, 3, 4, 5, 6])
      assert.equal(JSON.stringify(list).includes('password'), false)
    })
  })

  it('a member cannot use /api/users at all', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const M = await userOf(s, A)
    await expect('list', get(s, '/api/users', { as: M }), 403, err(E.forbidden))
    await expect('create', post(s, '/api/users', { ...base, username: nextName() }, { as: M }), 403, err(E.forbidden))
    await expect('update', api(s, M).patch(`/api/users/${M.made.id}`, { role: 'admin' }), 403, err(E.forbidden))
  })
}

function updateUserCases() {
  it('PATCH /api/users/<id>: the rules in order (nothing, password, role), 404 first, and the reply is the user with the given values changed', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const bob = await userOf(s, A, { username: 'bob_user' })
      const path = `/api/users/${bob.made.id}`
      for (const body of [{}, { other: 1 }, { username: 'zed', id: 5 }]) same(JSON.stringify(body), view(await c.patch(path, body)), answer(400, err(E.nothing)))
      for (const password of ['short', null, 5, 'x'.repeat(201)]) same(`password ${password}`, view(await c.patch(path, { password })), answer(400, err(E.password)))
      for (const role of ['root', null, 'Admin', 3]) same(`role ${role}`, view(await c.patch(path, { role })), answer(400, err(E.role)))
      same('password before role', view(await c.patch(path, { password: 'x', role: 'x' })), answer(400, err(E.password)))
      same('404 before 400', view(await c.patch('/api/users/99999', {})), answer(404, err(E.userNotFound)))
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'user.update'")[0].n, 0, 'failed updates are not audited')
      same('role only', view(await c.patch(path, { role: 'admin' })), answer(200, { id: bob.made.id, username: 'bob_user', role: 'admin' }))
      same('password only', view(await c.patch(path, { password: 'brand-new-password-1', username: 'ignored' })), answer(200, { id: bob.made.id, username: 'bob_user', role: 'admin' }))
      same('both', view(await c.patch(path, { password: 'another-password-2', role: 'member' })), answer(200, { id: bob.made.id, username: 'bob_user', role: 'member' }))
      same('the same role again', view(await c.patch(path, { role: 'member' })), answer(200, { id: bob.made.id, username: 'bob_user', role: 'member' }))
      await expect('the old password', post(s, '/api/session', { username: 'bob_user', password: USER_PW }), 401, err(E.wrong))
      await ok(post(s, '/api/session', { username: 'bob_user', password: 'another-password-2' }), 200)
      assert.deepEqual(rows(s.file, "SELECT user_id, action, target FROM audit WHERE action = 'user.update'"), Array(4).fill({ user_id: 1, action: 'user.update', target: `user:${bob.made.id}` }))
    })
  })

  it('a successful update deletes every session of that user, the requester\'s own included, and no one else\'s', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const B = await userOf(s, A, { username: 'bob_user', role: 'admin' })
      const B2 = await sessionOf(s, 'bob_user', USER_PW)
      const C = await userOf(s, A, { username: 'cat_user' })
      await ok(api(s, A).patch(`/api/users/${B.made.id}`, { role: 'member' }), 200)
      await expect('bob session one', get(s, '/api/session', { as: B }), 401, err(E.login))
      await expect('bob session two', get(s, '/api/session', { as: B2 }), 401, err(E.login))
      assert.equal((await get(s, '/api/session', { as: A })).status, 200, 'the admin\'s own session stays')
      assert.equal((await get(s, '/api/session', { as: C })).status, 200, 'another user\'s session stays')
      const D = await userOf(s, A, { username: 'dan_user', role: 'admin' })
      await expect('self update answers 200', api(s, D).patch(`/api/users/${D.made.id}`, { password: 'dan-new-password-1' }), 200, { id: D.made.id, username: 'dan_user', role: 'admin' })
      await expect('and then the session is gone', get(s, '/api/session', { as: D }), 401, err(E.login))
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'user.update' AND user_id = ?", D.made.id)[0].n, 1, 'the audit entry is written for the request that deleted its own session')
    })
  })

  it('the last admin cannot be removed: 409, and then nothing changes (no password, no session deleted, no audit entry)', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const before = rows(s.file, 'SELECT * FROM users')
      await expect('demote the only admin', c.patch('/api/users/1', { role: 'member' }), 409, err(E.lastAdmin))
      await expect('demote with a password', c.patch('/api/users/1', { role: 'member', password: 'sneaky-password-9' }), 409, err(E.lastAdmin))
      assert.deepEqual(rows(s.file, 'SELECT * FROM users'), before)
      assert.equal((await get(s, '/api/session', { as: A })).status, 200)
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'user.update'")[0].n, 0)
      await ok(c.patch('/api/users/1', { password: 'fresh-admin-password-1' }), 200, 'a password change of the only admin is fine')
      const A2 = await sessionOf(s, 'admin', 'fresh-admin-password-1')
      const B = await userOf(s, A2, { username: 'bob_user', role: 'admin' })
      await ok(api(s, B).patch('/api/users/1', { role: 'member' }), 200, 'with another admin the first can go')
      await expect('now bob is the last', api(s, B).patch(`/api/users/${B.made.id}`, { role: 'member' }), 409, err(E.lastAdmin))
      const m = await userOf(s, B, { username: 'mia_user' })
      await ok(api(s, B).patch(`/api/users/${m.made.id}`, { role: 'member' }), 200, 'a member kept as member')
    })
  })

  it('two admins removing each other at the same time: one request wins, the other finds its session gone, and one admin is left', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const B = await userOf(s, A, { username: 'bob_user', role: 'admin' })
      const replies = await Promise.all([api(s, A).patch(`/api/users/${B.made.id}`, { role: 'member' }), api(s, B).patch('/api/users/1', { role: 'member' })])
      assert.deepEqual(replies.map(r => r.status).sort(), [200, 401])
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM users WHERE role = 'admin'")[0].n, 1)
    })
  })
}

const createHashOfBytes = hex => createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')
