// Stage 1, startup: PORT, the listening line, the database file, the first user.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { connect } from 'node:net'
import { join } from 'node:path'
import {
  ADMIN_PW, E, EXPECTED_SCHEMA, commentOf, ticketOf, LINE, REFUSED, SCRYPT, answer, boot, dump, err, errLines, expect, fresh, freshDb, freePort, get, it, listenOn, passwordMatches,
  plantV1, portFree, post, refused, req, rows, runToExit, same, schemaOf, sessionOf, startServer, stopServer, tookPort, view, withDb, withServer,
} from './lib.mjs'

const ADMIN_LINE = 'ADMIN_PASSWORD must be 12 to 200 characters'
const garbageFile = dir => {
  const file = join(dir, 'garbage.db')
  writeFileSync(file, 'this is not a database. '.repeat(100))
  return file
}

export function startupCases() {
  portCases()
  databaseCases()
  firstUserCases()
}

function portCases() {
  it('the listening line: PORT=0 prints the port the OS picked, leading zeros are dropped, unset or empty PORT is 3000 (when taken: exit 1)', async () => {
    const s = await boot({ PORT: '0', DB_FILE: freshDb(), ADMIN_PASSWORD: ADMIN_PW }, { cwd: fresh() })
    const port = Number(/^listening on http:\/\/127\.0\.0\.1:([1-9][0-9]*)\n$/.exec(s.out)?.[1])
    const reply = port ? (await get({ port }, '/api/session')).status : null
    await stopServer(s)
    same('PORT=0', { out: s.out, reply }, { out: LINE(port), reply: 401 }, `stderr: ${s.err.slice(0, 300)}`)
    const want = await freePort()
    const padded = await boot({ PORT: `00${want}`, DB_FILE: freshDb(), ADMIN_PASSWORD: ADMIN_PW }, { cwd: fresh() })
    await stopServer(padded)
    assert.equal(padded.out, LINE(want))
    for (const PORT of [undefined, '']) {
      const free = await portFree(3000)
      const r = await runToExit({ PORT, DB_FILE: freshDb() }, { waitMs: 4000 })
      if (!await tookPort(r, free)) assert.equal(r.out, LINE(3000))
    }
  })

  it('a bad PORT or a port in use: exit 1, one line on stderr, nothing on stdout; PORT is checked before the database is opened', async () => {
    const blocker = await listenOn(0)
    const busy = String(blocker.address().port)
    for (const PORT of ['abc', '-1', '+3000', ' 3000', '3000 ', '30.5', '1e3', '0x1F', '３', '٣', ' ', '65536', '0065536', '99999999999999999999']) {
      const file = freshDb()
      const r = await runToExit({ PORT, DB_FILE: file })
      same(JSON.stringify(PORT), { code: r.code, out: r.out, lines: errLines(r.err).length, made: existsSync(file) }, { code: 1, out: '', lines: 1, made: false })
    }
    const r = await runToExit({ PORT: busy, DB_FILE: freshDb() })
    same('in use', { code: r.code, out: r.out, lines: errLines(r.err).length }, { code: 1, out: '', lines: 1 })
    await new Promise(resolve => blocker.close(resolve))
  })

  it('PORT 65535 is allowed and 65536 is not: the highest port is read whole', async () => {
    const r = await runToExit({ PORT: '65536', DB_FILE: freshDb() })
    assert.equal(r.code, 1)
    const edge = await boot({ PORT: '65535', DB_FILE: freshDb(), ADMIN_PASSWORD: ADMIN_PW }, { cwd: fresh() })
    const taken = edge.child.exitCode === 1
    await stopServer(edge)
    if (!taken) assert.equal(edge.out, LINE(65535))
  })

  it('the order of startup: PORT, then the database, then the first user, then listening', async () => {
    const dir = fresh()
    const garbage = garbageFile(dir)
    const blocker = await listenOn(0)
    const busy = String(blocker.address().port)
    const lines = async env => errLines((await runToExit(env)).err)
    same('bad PORT before a bad database', { lines: (await lines({ PORT: 'abc', DB_FILE: garbage })).filter(l => l.startsWith('cannot open')) }, { lines: [] })
    same('a bad database before a bad password', { lines: await lines({ DB_FILE: garbage, ADMIN_PASSWORD: 'short' }) }, { lines: [`cannot open database ${garbage}`] })
    same('a bad database before the port is bound', { lines: await lines({ PORT: busy, DB_FILE: garbage }) }, { lines: [`cannot open database ${garbage}`] })
    same('a bad password before the port is bound', { lines: await lines({ PORT: busy, DB_FILE: freshDb(), ADMIN_PASSWORD: 'short' }) }, { lines: [ADMIN_LINE] })
    await new Promise(resolve => blocker.close(resolve))
  })

  it('it listens on 127.0.0.1 only', async () => {
    await withServer({}, async s => {
      const refuses = host => new Promise(resolve => {
        const c = connect({ host, port: s.port })
        c.setTimeout(3000, () => { c.destroy(); resolve(true) })
        c.once('connect', () => { c.destroy(); resolve(false) })
        c.once('error', () => resolve(true))
      })
      assert.equal(await refuses('::1'), true, 'the IPv6 loopback address')
      const others = Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address)
      for (const host of others.slice(0, 2)) assert.equal(await refuses(host), true, host)
    })
  })
}

function databaseCases() {
  it('DB_FILE: unset or empty means helpdesk.db in the current working directory, and a relative name is resolved against it', async () => {
    for (const [file, name] of [[null, 'helpdesk.db'], ['', 'helpdesk.db'], ['sub.db', 'sub.db']]) {
      const cwd = fresh()
      await withServer({ file, cwd }, async () => {})
      assert.equal(existsSync(join(cwd, name)), true, name)
      assert.deepEqual(rows(join(cwd, name), 'SELECT username, role FROM users'), [{ username: 'admin', role: 'admin' }], name)
    }
  })

  it('a database the server cannot use: the exact line on stderr, exit 1, not listening, the file unchanged', async () => {
    const dir = fresh()
    const garbage = garbageFile(dir)
    const make = (name, sql) => {
      const file = join(dir, name)
      withDb(file, db => db.exec(sql))
      return file
    }
    const files = [
      ['garbage', garbage],
      ['version 2', make('v2.db', `${'CREATE TABLE t (a);'} PRAGMA user_version = 2;`)],
      ['version 2 without tables', make('v2e.db', 'PRAGMA user_version = 2;')],
      ['version 99', make('v99.db', 'CREATE TABLE t (a); PRAGMA user_version = 99;')],
      ['version -1', make('vneg.db', 'PRAGMA user_version = -1;')],
      ['tables but version 0', make('v0t.db', 'CREATE TABLE t (a);')],
    ]
    for (const [label, file] of files) {
      const before = readFileSync(file)
      for (const env of [{ DB_FILE: file }, { DB_FILE: file, ADMIN_PASSWORD: undefined }]) {
        same(label, refused(await runToExit(env), ''), REFUSED(`cannot open database ${file}`))
        assert.ok(readFileSync(file).equals(before), `${label}: the file changed`)
      }
    }
    const folder = join(dir, 'folder.db')
    mkdirSync(folder)
    const deep = join(dir, 'no', 'such', 'x.db')
    for (const [label, file] of [['a folder', folder], ['a missing folder on the path', deep]]) {
      same(label, refused(await runToExit({ DB_FILE: file }), ''), REFUSED(`cannot open database ${file}`))
    }
    assert.equal(existsSync(join(dir, 'no')), false, 'no folder is made')
    const cwd = fresh()
    writeFileSync(join(cwd, 'helpdesk.db'), 'this is not a database. '.repeat(100))
    writeFileSync(join(cwd, 'x.db'), 'this is not a database. '.repeat(100))
    for (const [label, DB_FILE, name] of [['default', undefined, 'helpdesk.db'], ['empty', '', 'helpdesk.db'], ['relative', 'x.db', 'x.db']]) {
      same(label, refused(await runToExit({ DB_FILE }, { cwd }), ''), REFUSED(`cannot open database ${name}`))
    }
  })

  it('a missing file, an empty file and an empty database all get exactly the schema, in version 1, with the checks of the task', async () => {
    const dir = fresh()
    const empty = join(dir, 'empty.db')
    writeFileSync(empty, '')
    const blank = join(dir, 'blank.db')
    withDb(blank, db => db.exec('CREATE TABLE t (a); DROP TABLE t;'))
    for (const file of [join(dir, 'new.db'), empty, blank]) {
      await withServer({ file }, async () => {})
      same(file, { schema: schemaOf(file) }, { schema: EXPECTED_SCHEMA })
    }
    const file = join(dir, 'new.db')
    withDb(file, db => {
      const bad = sql => assert.throws(() => db.exec(sql), `${sql} must be refused`)
      bad("INSERT INTO users (username, password_hash, role) VALUES ('x', 'h', 'root')")
      bad("INSERT INTO tickets (title, description, status, priority, created_by, created_at) VALUES ('t', 'd', 'new', 'low', 1, 1)")
      bad("INSERT INTO tickets (title, description, status, priority, created_by, created_at) VALUES ('t', 'd', 'open', 'urgent', 1, 1)")
      bad("INSERT INTO audit (at, user_id, action, target) VALUES ('later', 1, 'a', 't')")
      bad("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'h', 'admin')")
    })
  })

  it('a version 1 database is used as it is: its users, other objects and rows stay, and a start with a user present writes nothing', async () => {
    const dir = fresh()
    const file = join(dir, 'v1.db')
    plantV1(file, `INSERT INTO users (id, username, password_hash, role) VALUES (7, 'ann', 'x', 'member');
      INSERT INTO tickets (title, description, status, priority, created_by, created_at) VALUES ('old', 'old', 'open', 'low', 7, 5);
      CREATE TABLE other_tool (a TEXT); INSERT INTO other_tool VALUES ('kept'); CREATE INDEX tickets_by_status ON tickets (status);`)
    const before = readFileSync(file)
    const s = await startServer({ file, env: { ADMIN_PASSWORD: undefined } })
    const same_ = readFileSync(file).equals(before)
    await stopServer(s)
    assert.equal(same_, true, 'starting on a database with a user changed the file')
    assert.deepEqual(rows(file, 'SELECT id, username FROM users'), [{ id: 7, username: 'ann' }])
    assert.deepEqual(rows(file, 'SELECT a FROM other_tool'), [{ a: 'kept' }])
    assert.equal(rows(file, "SELECT name FROM sqlite_master WHERE name = 'tickets_by_status'").length, 1)
  })

  it('data lives in the file: a restart keeps users, tickets and sessions, and no id is given twice, also after deletes', async () => {
    const file = freshDb()
    const made = await withServer({ file }, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const t = await ticketOf(s, A)
      const c = await commentOf(s, A, t.id)
      const t2 = await ticketOf(s, A, 'second')
      assert.equal((await req(s, 'DELETE', `/api/tickets/${t2.id}`, { as: A })).status, 204)
      return { A, t, c, t2 }
    })
    await withServer({ file }, async s => {
      const A = made.A
      assert.equal((await get(s, '/api/session', { as: A })).status, 200, 'the session survives a restart')
      const again = await ticketOf(s, A, 'third')
      assert.ok(again.id > made.t2.id, `ticket id ${again.id} after ${made.t2.id} was deleted`)
      const gone = await commentOf(s, A, made.t.id, 'after restart')
      assert.ok(gone.id > made.c.id)
      const log = rows(file, 'SELECT id FROM audit ORDER BY id').map(r => r.id)
      assert.deepEqual(log, [...new Set(log)].sort((a, b) => a - b), 'audit ids are unique and rising')
    })
  })
}

function firstUserCases() {
  it('the first user: admin, role admin, the password as given (spaces and non-ASCII included), stored as scrypt, no audit entry', async () => {
    const password = '  pässwörd 日本語 !  '
    const file = freshDb()
    await withServer({ file, env: { ADMIN_PASSWORD: password } }, async s => {
      same('exact password', { status: (await post(s, '/api/session', { username: 'admin', password })).status }, { status: 200 })
      same('trimmed password', view(await post(s, '/api/session', { username: 'admin', password: password.trim() })), answer(401, err(E.wrong)))
    })
    const users = rows(file, 'SELECT * FROM users')
    same('row', { n: users.length, id: users[0].id, username: users[0].username, role: users[0].role }, { n: 1, id: 1, username: 'admin', role: 'admin' })
    assert.match(users[0].password_hash, SCRYPT)
    assert.equal(passwordMatches(password, users[0].password_hash), true)
    assert.equal(passwordMatches(password.trim(), users[0].password_hash), false)
    assert.deepEqual(rows(file, 'SELECT action FROM audit WHERE action <> \'login\''), [])
    const other = freshDb()
    await withServer({ file: other, env: { ADMIN_PASSWORD: password } }, async () => {})
    assert.notEqual(rows(other, 'SELECT password_hash FROM users')[0].password_hash, users[0].password_hash, 'every stored password gets a new salt')
  })

  it('ADMIN_PASSWORD is 12 to 200 UTF-16 code units; the limits are in code units, not characters', async () => {
    for (const password of ['a'.repeat(12), 'a'.repeat(200), '😀'.repeat(6), '😀'.repeat(100), ' '.repeat(12)]) {
      await withServer({ env: { ADMIN_PASSWORD: password } }, async s => {
        same(`${password.length} units`, { status: (await post(s, '/api/session', { username: 'admin', password })).status }, { status: 200 })
      })
    }
    for (const password of [undefined, '', 'a'.repeat(11), 'a'.repeat(201), '😀'.repeat(5), '😀'.repeat(101), '日本語'.repeat(3) + 'ab']) {
      const file = freshDb()
      const r = await runToExit({ DB_FILE: file, ADMIN_PASSWORD: password })
      same(`${password?.length} units`, refused(r, ''), REFUSED(ADMIN_LINE))
      assert.ok(!existsSync(file) || statSync(file).size === 0, 'a new file stays absent or empty')
    }
  })

  it('a bad ADMIN_PASSWORD leaves an existing file as it was: an empty file, an empty database, a version 1 database without users', async () => {
    const dir = fresh()
    const empty = join(dir, 'empty.db')
    writeFileSync(empty, '')
    const blank = join(dir, 'blank.db')
    withDb(blank, db => db.exec('CREATE TABLE t (a); DROP TABLE t;'))
    const v1 = plantV1(join(dir, 'v1.db'), 'CREATE TABLE other_tool (a TEXT);')
    for (const file of [empty, blank, v1]) {
      const before = readFileSync(file)
      same(file, refused(await runToExit({ DB_FILE: file, ADMIN_PASSWORD: 'short' }), ''), REFUSED(ADMIN_LINE))
      assert.ok(readFileSync(file).equals(before), `${file} changed`)
    }
  })

  it('the first user is made when the users table has no row, also in a version 1 database with other rows; otherwise ADMIN_PASSWORD is ignored', async () => {
    const dir = fresh()
    const v1 = plantV1(join(dir, 'v1.db'), "INSERT INTO sqlite_sequence (name, seq) VALUES ('users', 40);")
    await withServer({ file: v1, env: { ADMIN_PASSWORD: 'first-password-1' } }, async s => {
      same('login', { status: (await post(s, '/api/session', { username: 'admin', password: 'first-password-1' })).status }, { status: 200 })
    })
    assert.deepEqual(rows(v1, 'SELECT username, role FROM users'), [{ username: 'admin', role: 'admin' }])
    for (const ADMIN_PASSWORD of [undefined, 'short', 'a-different-password-2']) {
      await withServer({ file: v1, env: { ADMIN_PASSWORD } }, async s => {
        same(`restart with ${ADMIN_PASSWORD}`, { status: (await post(s, '/api/session', { username: 'admin', password: 'first-password-1' })).status }, { status: 200 })
        same('the new password', { status: (await post(s, '/api/session', { username: 'admin', password: 'a-different-password-2' })).status }, { status: 401 })
      })
      assert.equal(rows(v1, 'SELECT count(*) AS n FROM users')[0].n, 1)
    }
    const members = plantV1(join(dir, 'members.db'), "INSERT INTO users (username, password_hash, role) VALUES ('ann', 'x', 'member');")
    await withServer({ file: members, env: { ADMIN_PASSWORD: undefined } }, async () => {})
    assert.deepEqual(rows(members, 'SELECT username FROM users'), [{ username: 'ann' }], 'a database with users but no admin is not repaired')
  })

  it('a 404 is the first thing a started server can say: the listening line is the only line on stdout', async () => {
    await withServer({}, async s => {
      await expect('unknown', get(s, '/api/nope'), 404, err(E.notFound))
      assert.equal(s.out, LINE(s.port))
      assert.deepEqual(dump(s.file).audit, [])
    })
  })
}
