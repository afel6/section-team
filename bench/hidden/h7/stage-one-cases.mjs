// Every behaviour of stage 1 as tests: the s1 set runs them on the code as it stood after stage 1, the reg set on the final
// code. With stage 2, a part has a handle and the schema is version 2; nothing else may differ.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { moreCases } from './stage-one-more.mjs'
import {
  LINE, LIST_FIRST, REFUSED, SCHEMA_V1, SCHEMA_V2, all, answer, assets, boot, byId, del, dump, err, errorText, expect, fire, flush, fresh, freshDb, freePort, get, isDisabled, isEl, it, listenOn, moveOf, norm, ok, openPage, parseHtml,
  partOf, patch, pending, portFree, post, readyWith, refused, req, runToExit, same, schemaOf, setValue, settle, shared, sleep, stopServer, take, textOf, tookPort, tryJson, valueIn, view, withDb, withLock, withServer, within,
} from './lib.mjs'

const E = {
  contentType: 'content type must be application/json', tooLarge: 'body too large', notObject: 'body must be a JSON object', notFound: 'not found', methodNotAllowed: 'method not allowed', partNotFound: 'part not found', moveNotFound: 'move not found',
  sku: 'sku must be 1 to 32 letters, digits or dashes', name: 'name must be 1 to 80 characters', duplicateSku: 'sku already exists', limit: 'limit must be 1 to 100',
  date: 'on_date must be a valid YYYY-MM-DD date', qty: 'qty must be a non-zero whole number up to 1000000000', cost: 'unit_cost_cents must be a whole number from 0 to 1000000000', note: 'note must be at most 200 characters',
  differ: 'from_part and to_part must differ', transferQty: 'qty must be a whole number from 1 to 1000000000', busy: 'database busy', internal: 'internal error',
}
const NO_REPLY = 'Could not reach the server.'
const FAILED_REQ = 'Request failed.'
const below = date => `stock would go below zero on ${date}`
const BILLION = 1_000_000_000
let counter = 0
// A sku no earlier test on the shared server used.
const nextSku = (prefix = 'T') => `${prefix}-${++counter}`
const PARTS = '/api/parts'
const part = id => `/api/parts/${id}`
const moves = id => `/api/parts/${id}/moves`

export function stageOneCases({ stage }) {
  const tools = stageTools(stage)
  startupCases(tools)
  otherToolsCases(tools)
  routingCases()
  partsCases(tools)
  movesCases(tools)
  const page = pageTools(stage)
  pageMarkupCases()
  pageListCases(page)
  pageFormCases(page)
  pageDeleteCases(page)
  moreCases({ stage, tools, page })
}

// What the cases need from the stage they run on.
function stageTools(stage) {
  const SCHEMA = stage === 1 ? SCHEMA_V1 : SCHEMA_V2
  // A part as stage 1 knew it. On the final code it must also have a handle, a string.
  const plain = p => {
    if (stage === 1) return p
    const { handle, ...rest } = p ?? {}
    assert.equal(typeof handle, 'string', `no handle in ${JSON.stringify(p)}`)
    return rest
  }
  const plantPart = (db, sku, name) => (stage === 1
    ? db.prepare('INSERT INTO parts (sku, name) VALUES (?, ?) RETURNING id').get(sku, name)
    : db.prepare('INSERT INTO parts (sku, name, handle) VALUES (?, ?, ?) RETURNING id').get(sku, name, `planted-${sku.toLowerCase()}`)).id
  const expectPart = async (label, reply, status, want) => {
    const r = view(await reply)
    same(label, { status: r.status, type: r.type, body: plain(r.body) }, answer(status, want))
  }
  return { SCHEMA, plain, plantPart, expectPart }
}

// --- Startup and the database file ---
function startupCases({ SCHEMA, plain }) {
  it('the listening line: PORT=0 prints the port the OS picked, leading zeros are dropped, unset or empty PORT is 3000 (when taken: exit 1)', async () => {
    const s = await boot({ PORT: '0', DB_FILE: freshDb() }, { cwd: fresh() })
    const port = Number(/^listening on http:\/\/127\.0\.0\.1:([1-9][0-9]*)\n$/.exec(s.out)?.[1])
    const reply = port ? (await get({ port }, PARTS)).status : null
    await stopServer(s)
    same('PORT=0', { out: s.out, reply }, { out: LINE(port), reply: 200 }, `stderr: ${s.err.slice(0, 300)}`)
    const want = await freePort()
    const padded = await boot({ PORT: `00${want}`, DB_FILE: freshDb() }, { cwd: fresh() })
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
    for (const PORT of ['abc', '-1', '+3000', ' 3000', '30.5', '1e3', '0x1F', '３', '65536', '99999999999999999999']) {
      const file = freshDb()
      const r = await runToExit({ PORT, DB_FILE: file })
      same(PORT, { code: r.code, out: r.out, line: /[^\r\n]/.test(r.err), made: existsSync(file) }, { code: 1, out: '', line: true, made: false })
    }
    const r = await runToExit({ PORT: busy, DB_FILE: freshDb() })
    same('in use', { code: r.code, out: r.out, line: /[^\r\n]/.test(r.err) }, { code: 1, out: '', line: true })
    await new Promise(resolve => blocker.close(resolve))
  })

  it('DB_FILE: unset or empty means parts.db in the current working directory, and a relative name is resolved against it', async () => {
    for (const [file, name] of [[null, 'parts.db'], ['', 'parts.db'], ['sub.db', 'sub.db']]) {
      const cwd = fresh()
      await withServer({ file, cwd }, async s => {
        const made = await partOf(s, 'A-1')
        assert.equal(made.id, 1)
      })
      assert.deepEqual(dump(join(cwd, name)).parts.map(p => p.sku), ['A-1'], name)
    }
  })

  it('a database the server cannot use: the exact line on stderr, exit 1, not listening, the file unchanged', async () => {
    const dir = fresh()
    const garbage = join(dir, 'garbage.db')
    writeFileSync(garbage, 'this is not a database. '.repeat(100))
    const other = join(dir, 'other.db')
    withDb(other, db => db.exec('CREATE TABLE t (a); PRAGMA user_version = 99;'))
    const noVersion = join(dir, 'noversion.db')
    withDb(noVersion, db => db.exec('CREATE TABLE t (a);'))
    const folder = join(dir, 'folder.db')
    mkdirSync(folder)
    for (const [label, file] of [['garbage', garbage], ['version 99', other], ['tables but version 0', noVersion]]) {
      const before = readFileSync(file)
      const r = await runToExit({ DB_FILE: file })
      same(label, refused(r, `cannot open database ${file}`), REFUSED)
      assert.ok(readFileSync(file).equals(before), `${label}: the file changed`)
    }
    for (const [label, file] of [['a folder', folder], ['a missing folder on the path', join(dir, 'no', 'such', 'x.db')]]) {
      same(label, refused(await runToExit({ DB_FILE: file }), `cannot open database ${file}`), REFUSED)
    }
    const cwd = fresh()
    writeFileSync(join(cwd, 'parts.db'), 'this is not a database. '.repeat(100))
    same('default name', refused(await runToExit({}, { cwd }), 'cannot open database parts.db'), REFUSED)
    same('relative name', refused(await runToExit({ DB_FILE: 'parts.db' }, { cwd }), 'cannot open database parts.db'), REFUSED)
  })

  it('a missing file, an empty file and an empty database all get exactly the schema', async () => {
    const dir = fresh()
    const empty = join(dir, 'empty.db')
    writeFileSync(empty, '')
    const blank = join(dir, 'blank.db')
    withDb(blank, db => db.exec('CREATE TABLE t (a); DROP TABLE t;'))
    for (const file of [join(dir, 'new.db'), empty, blank]) {
      await withServer({ file }, async s => { await partOf(s, 'A-1') })
      assert.deepEqual(schemaOf(file), SCHEMA, file)
    }
  })

  it('a restart keeps every row, and an id is never given twice in either table, even after deleting the highest ones', async () => {
    const file = freshDb()
    const ids = await withServer({ file }, async s => {
      const [a, b] = [await partOf(s, 'A-1', 'Bolt'), await partOf(s, 'A-2')]
      await moveOf(s, a.id, '2026-03-01', 5)
      const last = await moveOf(s, a.id, '2026-03-02', 1)
      await ok(del(s, `/api/moves/${last.id}`), 204)
      await ok(del(s, part(b.id)), 204)
      const c = await partOf(s, 'A-3')
      assert.ok(c.id > b.id, 'no reuse before a restart')
      await ok(del(s, part(c.id)), 204)
      return { a: a.id, top: c.id, lastMove: last.id }
    })
    await withServer({ file }, async s => {
      const got = view(await get(s, part(ids.a)))
      same('kept', { status: got.status, body: plain(got.body) }, { status: 200, body: { id: ids.a, sku: 'A-1', name: 'Bolt', on_hand: 5, value_cents: '500' } })
      const again = await partOf(s, 'A-4')
      assert.ok(again.id > ids.top, `part id ${again.id} after ${ids.top} was deleted`)
      const move = await moveOf(s, ids.a, '2026-03-03', 1)
      assert.ok(move.id > ids.lastMove, `move id ${move.id} after ${ids.lastMove} was deleted`)
    })
  })
}

// --- Working with other tools ---
function otherToolsCases({ plain, plantPart }) {
  it('the database is the only truth: a row another tool added, changed or removed shows in the next reply', async () => {
    await withServer({}, async s => {
      const known = await partOf(s, 'A-1', 'Old')
      await moveOf(s, known.id, '2026-03-01', 5)
      assert.equal(plain(await ok(get(s, part(known.id)), 200)).on_hand, 5)
      const added = withDb(s.file, db => {
        db.prepare('UPDATE parts SET name = ? WHERE id = ?').run('New', known.id)
        db.prepare('UPDATE moves SET qty = 7 WHERE part_id = ?').run(known.id)
        return plantPart(db, 'B-1', 'Outside')
      })
      assert.deepEqual((await ok(get(s, PARTS), 200)).parts.map(plain), [
        { id: known.id, sku: 'A-1', name: 'New', on_hand: 7, value_cents: '700' },
        { id: added, sku: 'B-1', name: 'Outside', on_hand: 0, value_cents: '0' },
      ])
      withDb(s.file, db => db.prepare('DELETE FROM parts WHERE id = ?').run(added))
      await expect('removed', get(s, part(added)), 404, err(E.partNotFound))
    })
  })

  it('a locked database: a write waits, and succeeds when the lock goes within 3 seconds', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'A-1')
      await withLock(s.file, 1000, () => ({
        addPart: post(s, PARTS, { sku: 'A-2', name: 'Waited' }),
        addMove: post(s, moves(made.id), { on_date: '2026-03-01', qty: 1, unit_cost_cents: 1 }),
      }), async ({ addPart, addMove }) => {
        await ok(addPart, 201, 'POST part while locked')
        await ok(addMove, 201, 'POST move while locked')
      })
      assert.deepEqual(dump(s.file).parts.map(p => p.sku), ['A-1', 'A-2'])
    })
  })

  it('a locked database: still locked after 3 seconds is 503 database busy, nothing changes, and the server keeps running', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'A-1')
      await moveOf(s, made.id, '2026-03-01', 5)
      const held = 5000
      let started
      await withLock(s.file, held, () => {
        started = Date.now()
        return { reply: post(s, PARTS, { sku: 'A-2', name: 'Late' }) }
      }, async ({ reply }) => {
        const r = await reply
        same('held past the wait', view(r), answer(503, err(E.busy)))
        assert.ok(Date.now() - started >= 2000, `gave up after ${Date.now() - started} ms, without waiting`)
      })
      await ok(del(s, `/api/moves/${dump(s.file).moves[0].id}`), 204, 'the server works once the lock is gone')
      await partOf(s, 'A-3')
      assert.deepEqual(dump(s.file).parts.map(p => p.sku), ['A-1', 'A-3'])
    })
  })

  it('a failure inside a write (a trigger another tool added) is 500 internal error; nothing stays changed and the next request works', async () => {
    await withServer({}, async s => {
      const [a, b] = [await partOf(s, 'A-1', 'Bolt'), await partOf(s, 'B-1', 'Nut')]
      const first = await moveOf(s, a.id, '2026-03-01', 10)
      const before = dump(s.file)
      const cases = [
        ['POST part', 'BEFORE INSERT ON parts', () => post(s, PARTS, { sku: 'C-1', name: 'x' })],
        ['POST move', 'BEFORE INSERT ON moves', () => post(s, moves(a.id), { on_date: '2026-03-02', qty: 1, unit_cost_cents: 1 })],
        ['PATCH part', 'BEFORE UPDATE ON parts', () => patch(s, part(a.id), { name: 'Renamed' })],
        ['DELETE part', 'BEFORE DELETE ON parts', () => del(s, part(a.id))],
        ['DELETE move', 'BEFORE DELETE ON moves', () => del(s, `/api/moves/${first.id}`)],
        ['transfer, stock coming in', 'BEFORE INSERT ON moves WHEN NEW.qty > 0', () => post(s, '/api/transfers', { from_part: a.id, to_part: b.id, on_date: '2026-03-02', qty: 1, unit_cost_cents: 1 })],
        ['transfer, stock going out', 'BEFORE INSERT ON moves WHEN NEW.qty < 0', () => post(s, '/api/transfers', { from_part: a.id, to_part: b.id, on_date: '2026-03-02', qty: 1, unit_cost_cents: 1 })],
      ]
      for (const [label, when, send] of cases) {
        withDb(s.file, db => db.exec(`CREATE TRIGGER boom ${when} BEGIN SELECT RAISE(ABORT, 'boom'); END;`))
        same(label, view(await send()), answer(500, err(E.internal)))
        withDb(s.file, db => db.exec('DROP TRIGGER boom'))
        same(`${label}: rows`, dump(s.file), before)
      }
      await ok(post(s, moves(a.id), { on_date: '2026-03-02', qty: 1, unit_cost_cents: 1 }), 201, 'the next request')
    })
  })

  it('requests at the same time act as if handled one at a time', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'A-1')
      await moveOf(s, made.id, '2026-03-01', 10)
      const out = await Promise.all(Array.from({ length: 30 }, () => post(s, moves(made.id), { on_date: '2026-03-02', qty: -1, unit_cost_cents: 1 })))
      assert.deepEqual(out.map(r => r.status).sort(), [...Array(10).fill(201), ...Array(20).fill(409)])
      assert.equal(plain(await ok(get(s, part(made.id)), 200)).on_hand, 0)
      const rivals = await Promise.all(Array.from({ length: 12 }, () => post(s, PARTS, { sku: 'SAME', name: 'One' })))
      assert.deepEqual(rivals.map(r => r.status).sort(), [201, ...Array(11).fill(409)])
      const ids = await Promise.all(Array.from({ length: 12 }, (_, i) => partOf(s, `P-${i}`)))
      assert.equal(new Set(ids.map(p => p.id)).size, 12)
    })
  })
}

// --- Routing and bodies, on one shared server ---
function routingCases() {
  it('unknown paths are 404, compared byte for byte; a listed path with another method is 405', async () => {
    const s = await shared()
    const known = await partOf(s, nextSku())
    const notFound = ['/x', '/api', '/api/', '/API/parts', '/api/%70arts', '/api/./parts', '/api/parts/', `/api/parts/${known.id}/`, `/api/parts/${known.id}/moves/`, `/api/parts/${known.id}/x`, '/api/moves', '/api/moves/', '/api/moves/1/', '/api/transfers/', '/app.js/', '/index.html', '//']
    for (const path of notFound) {
      for (const method of ['GET', 'POST', 'DELETE']) await expect(`${method} ${path}`, req(s, method, path), 404, err(E.notFound))
    }
    const wrong = [['PUT', PARTS], ['DELETE', PARTS], ['PATCH', PARTS], ['PUT', part(known.id)], ['POST', part(known.id)], ['PUT', '/api/parts/abc'], ['PATCH', moves(known.id)], ['DELETE', moves(known.id)], ['GET', '/api/moves/1'], ['PATCH', '/api/moves/abc'], ['GET', '/api/transfers'], ['DELETE', '/api/transfers'], ['POST', '/'], ['DELETE', '/'], ['POST', '/app.js']]
    for (const [method, path] of wrong) await expect(`${method} ${path}`, req(s, method, path), 405, err(E.methodNotAllowed))
    for (const method of ['HEAD', 'OPTIONS']) assert.equal((await req(s, method, PARTS)).status, 405, method)
  })

  it('an <id> that is not a positive integer in ASCII digits without a leading zero, or names no row, is 404 by its route', async () => {
    const s = await shared()
    const known = await partOf(s, nextSku())
    // Sent as written: %31 is not 1, because paths are compared byte for byte.
    const bad = ['abc', '0', `0${known.id}`, `${known.id}.0`, `${known.id}e0`, `-${known.id}`, `+${known.id}`, '%31', '999999999', '9007199254740993', '18446744073709551617', '99999999999999999999999999', '1e3', '%D9%A3']
    for (const id of bad) {
      await expect(`GET part ${id}`, get(s, part(id)), 404, err(E.partNotFound))
      await expect(`PATCH part ${id}`, patch(s, part(id), { name: 'x' }), 404, err(E.partNotFound))
      await expect(`DELETE part ${id}`, del(s, part(id)), 404, err(E.partNotFound))
      await expect(`GET moves ${id}`, get(s, moves(id)), 404, err(E.partNotFound))
      await expect(`POST move ${id}`, post(s, moves(id), { on_date: '2026-03-01', qty: 1, unit_cost_cents: 1 }), 404, err(E.partNotFound))
      await expect(`DELETE move ${id}`, del(s, `/api/moves/${id}`), 404, err(E.moveNotFound))
    }
    await expect('the path\'s id comes before the body rules', post(s, moves(999999999), 'not json', { type: 'text/plain' }), 404, err(E.partNotFound))
    await expect('also for PATCH', patch(s, part(999999999), 'not json', { type: 'text/plain' }), 404, err(E.partNotFound))
  })

  it('body rules for POST and PATCH: 415, then 413, then 400, read whole before any reply', async () => {
    const s = await shared()
    const known = await partOf(s, nextSku())
    const routes = [['POST part', (b, o) => post(s, PARTS, b, o)], ['PATCH part', (b, o) => patch(s, part(known.id), b, o)], ['POST move', (b, o) => post(s, moves(known.id), b, o)], ['POST transfer', (b, o) => post(s, '/api/transfers', b, o)]]
    const padded = size => {
      const text = JSON.stringify({ pad: '' })
      return JSON.stringify({ pad: 'x'.repeat(size - text.length) })
    }
    for (const [label, send] of routes) {
      for (const type of [null, 'text/plain', 'application/jsonx', 'application/json2; charset=utf-8', 'json']) await expect(`${label} type ${type}`, send('{}', { type }), 415, err(E.contentType))
      await expect(`${label}: too big and wrong type`, send(padded(10001), { type: 'text/plain' }), 415, err(E.contentType))
      await expect(`${label}: too big`, send(padded(10001)), 413, err(E.tooLarge))
      await expect(`${label}: too big and not JSON`, send('x'.repeat(10001)), 413, err(E.tooLarge))
      await expect(`${label}: too big, in pieces`, send(undefined, { parts: ['{"pad":"', 'x'.repeat(6000), 'x'.repeat(6000), '"}'], gap: 20 }), 413, err(E.tooLarge))
      for (const body of ['', 'null', '[]', '"x"', '1', 'true', '{bad', '﻿{}']) await expect(`${label}: body ${JSON.stringify(body)}`, send(body, { type: 'application/json' }), 400, err(E.notObject))
    }
    const sku = nextSku()
    for (const [i, type] of [' APPLICATION/JSON ; charset=x', 'application/json', '\tapplication/json;'].entries()) {
      await ok(post(s, PARTS, { sku: `${sku}-${i}`, name: 'x' }, { type }), 201, `type ${JSON.stringify(type)}`)
    }
    const exact = JSON.stringify({ sku: nextSku(), name: 'x', pad: '' })
    const size = JSON.stringify({ ...JSON.parse(exact), pad: 'x'.repeat(10000 - exact.length) })
    assert.equal(Buffer.byteLength(size), 10000)
    await ok(post(s, PARTS, size), 201, 'exactly 10000 bytes')
  })
}

// --- Parts ---
function partsCases({ plain, expectPart }) {
  it('POST /api/parts: rules in order, the name trimmed, other keys ignored, letter case matters in a sku', async () => {
    const s = await shared()
    for (const sku of [undefined, null, 5, '', 'x'.repeat(33), 'a b', 'a_b', 'é', 'a/b', ' a', 'a\n']) await expect(`sku ${JSON.stringify(sku)}`, post(s, PARTS, { sku, name: 7 }), 400, err(E.sku))
    const sku = nextSku('case')
    for (const name of [undefined, null, 5, '', '   ', '\n\t', 'x'.repeat(81), ` ${'é'.repeat(81)} `, '\u{1F600}'.repeat(41)]) await expect(`name ${JSON.stringify(name)}`, post(s, PARTS, { sku, name }), 400, err(E.name))
    const long = 'x'.repeat(80)
    const made = await ok(post(s, PARTS, { sku, name: `  ${long}\n`, id: 999, on_hand: 7, extra: true }), 201)
    same('made', { body: plain(made) }, { body: { id: made.id, sku, name: long, on_hand: 0, value_cents: '0' } })
    assert.ok(made.id !== 999)
    await expect('duplicate sku', post(s, PARTS, { sku, name: 'y' }), 409, err(E.duplicateSku))
    await expect('name rule before duplicate rule', post(s, PARTS, { sku, name: ' ' }), 400, err(E.name))
    await ok(post(s, PARTS, { sku: sku.toUpperCase(), name: 'y' }), 201, 'another letter case is another part')
    await ok(post(s, PARTS, { sku: nextSku('L').padEnd(32, 'x'), name: 'y' }), 201, '32 characters')
  })

  it('GET, PATCH and DELETE of a part; deleting takes its moves, as the foreign key says', async () => {
    const s = await shared()
    const sku = nextSku()
    const made = await partOf(s, sku, 'Bolt')
    const first = await moveOf(s, made.id, '2026-03-01', 3, 200)
    await expectPart('GET', get(s, part(made.id)), 200, { id: made.id, sku, name: 'Bolt', on_hand: 3, value_cents: '600' })
    await expectPart('GET with a query', get(s, `${part(made.id)}?x=1`), 200, { id: made.id, sku, name: 'Bolt', on_hand: 3, value_cents: '600' })
    for (const name of [undefined, null, 5, '', '  ', 'x'.repeat(81)]) await expect(`PATCH name ${JSON.stringify(name)}`, patch(s, part(made.id), { name }), 400, err(E.name))
    await expectPart('PATCH', patch(s, part(made.id), { name: '  Hex bolt ', sku: 'IGNORED', on_hand: 99 }), 200, { id: made.id, sku, name: 'Hex bolt', on_hand: 3, value_cents: '600' })
    await expectPart('PATCH stays', get(s, part(made.id)), 200, { id: made.id, sku, name: 'Hex bolt', on_hand: 3, value_cents: '600' })
    const gone = await del(s, part(made.id))
    same('DELETE', { status: gone.status, text: gone.text }, { status: 204, text: '' })
    await expect('gone', get(s, part(made.id)), 404, err(E.partNotFound))
    await expect('gone twice', del(s, part(made.id)), 404, err(E.partNotFound))
    await expect('its moves went too', del(s, `/api/moves/${first.id}`), 404, err(E.moveNotFound))
    assert.deepEqual(withDb(s.file, db => db.prepare('SELECT count(*) AS n FROM moves WHERE part_id = ?').get(made.id).n), 0)
  })

  it('value_cents is exact past 2^53 and past 2^63, negative when below zero, and on_hand is a number', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'BIG')
      for (let i = 1; i <= 20; i++) await moveOf(s, made.id, '2026-03-01', BILLION, BILLION - i)
      const want = 20n * BigInt(BILLION) * BigInt(BILLION) - 210n * BigInt(BILLION)
      assert.ok(want > 2n ** 63n, 'the test must pass a 64-bit integer')
      await expectPart('huge', get(s, part(made.id)), 200, { id: made.id, sku: 'BIG', name: 'Part', on_hand: 20 * BILLION, value_cents: String(want) })
      assert.deepEqual((await ok(get(s, PARTS), 200)).parts.map(plain).map(p => p.value_cents), [String(want)], 'the list says the same')
      const small = await partOf(s, 'NEG')
      await moveOf(s, small.id, '2026-03-01', 1, 100)
      await moveOf(s, small.id, '2026-03-02', -1, 300)
      await expectPart('below zero', get(s, part(small.id)), 200, { id: small.id, sku: 'NEG', name: 'Part', on_hand: 0, value_cents: '-200' })
      const close = await partOf(s, 'ODD')
      await moveOf(s, close.id, '2026-03-01', BILLION, 999999999)
      await moveOf(s, close.id, '2026-03-01', 999999999, 999999999)
      await moveOf(s, close.id, '2026-03-01', 7, 1)
      const odd = BigInt(BILLION) * 999999999n + 999999999n * 999999999n + 7n
      assert.equal(plain(await ok(get(s, part(close.id)), 200)).value_cents, String(odd), 'no rounding on the way')
    })
  })

  it('GET /api/parts: byte order, the default limit, limit rules, after and next', async () => {
    await withServer({}, async s => {
      const skus = ['a', 'B', 'AB-1', 'ab-1', 'Z', '0', '-x', 'A', 'b-1', 'b']
      for (const sku of skus) await partOf(s, sku)
      const sorted = [...skus].sort((x, y) => (Buffer.compare(Buffer.from(x), Buffer.from(y))))
      assert.deepEqual((await ok(get(s, PARTS), 200)).parts.map(p => p.sku), sorted)
      for (const value of ['0', '101', 'abc', '01', '', '1.5', '+1', '%201', '1e1', '-1']) await expect(`limit=${value}`, get(s, `${PARTS}?limit=${value}`), 400, err(E.limit))
      await expect('limit with no value', get(s, `${PARTS}?limit`), 400, err(E.limit))
      const page = await ok(get(s, `${PARTS}?limit=3&limit=abc`), 200)
      same('first of a repeated limit', { skus: page.parts.map(p => p.sku), next: page.next }, { skus: sorted.slice(0, 3), next: sorted[2] })
      const walked = []
      for (let after = ''; ;) {
        const r = await ok(get(s, `${PARTS}?limit=4${after ? `&after=${encodeURIComponent(after)}` : ''}`), 200)
        walked.push(...r.parts.map(p => p.sku))
        if (r.next === null) break
        assert.equal(r.next, r.parts.at(-1).sku)
        after = r.next
      }
      assert.deepEqual(walked, sorted, 'paging visits each part once')
      const exact = await ok(get(s, `${PARTS}?limit=${skus.length}`), 200)
      same('a page that ends exactly at the last part', { n: exact.parts.length, next: exact.next }, { n: skus.length, next: null })
      const between = await ok(get(s, `${PARTS}?after=AB-0&limit=1`), 200)
      same('after need not be a part', { skus: between.parts.map(p => p.sku), next: between.next }, { skus: ['AB-1'], next: 'AB-1' })
      assert.equal((await ok(get(s, `${PARTS}?after=`), 200)).parts.length, skus.length, 'an empty after is none')
    })
    await withServer({}, async s => {
      const made = await Promise.all(Array.from({ length: 25 }, (_, i) => partOf(s, `S-${String(i).padStart(2, '0')}`)))
      const page = await ok(get(s, PARTS), 200)
      same('default limit 20', { n: page.parts.length, next: page.next }, { n: 20, next: 'S-19' })
      assert.equal((await ok(get(s, `${PARTS}?limit=100`), 200)).parts.length, made.length)
      const before = await ok(get(s, `${PARTS}?limit=5`), 200)
      await partOf(s, 'A-new')
      await ok(del(s, part(before.parts[1].id)), 204)
      const nextPage = await ok(get(s, `${PARTS}?limit=5&after=${before.next}`), 200)
      assert.deepEqual(nextPage.parts.map(p => p.sku), ['S-05', 'S-06', 'S-07', 'S-08', 'S-09'], 'a change before the cursor does not shift the next page')
    })
  })

  it('q finds a sku or name after toLowerCase on both sides; % and _ are ordinary characters; next counts only matches', async () => {
    await withServer({}, async s => {
      const rows = [['E-1', 'ÉCROU M8'], ['E-2', 'écrou m10'], ['E-3', 'Ecrou plain'], ['P-1', '100% steel'], ['P-2', '100 steel'], ['U-1', 'a_b'], ['U-2', 'axb'], ['S-1', 'STRASSE'], ['G-1', 'ΣΊΣΥΦΟΣ'], ['Case-9', 'other']]
      for (const [sku, name] of rows) await partOf(s, sku, name)
      const find = async q => (await ok(get(s, `${PARTS}?q=${encodeURIComponent(q)}`), 200)).parts.map(p => p.sku)
      for (const [q, want] of [
        ['écrou', ['E-1', 'E-2']], ['ÉCROU', ['E-1', 'E-2']], ['ecrou', ['E-3']], ['%', ['P-1']], ['100%', ['P-1']], ['_', ['U-1']], ['a_b', ['U-1']], ['a%b', []], ['case', ['Case-9']], ['CASE-', ['Case-9']],
        ['sisyfos', []], ['σίσυφος', ['G-1']], ['p-', ['P-1', 'P-2']], ['steel', ['P-1', 'P-2']], ["'", []], ['"', []], ['\\', []],
      ]) assert.deepEqual(await find(q), want, `q=${q}`)
      assert.equal((await ok(get(s, `${PARTS}?q=`), 200)).parts.length, rows.length, 'an empty q is none')
      assert.equal((await ok(get(s, `${PARTS}?q=100+steel`), 200)).parts.length, 1, 'a + in the query is a space, as URLSearchParams says')
      const paged = await ok(get(s, `${PARTS}?q=steel&limit=1`), 200)
      same('next with q', { skus: paged.parts.map(p => p.sku), next: paged.next }, { skus: ['P-1'], next: 'P-1' })
      const last = await ok(get(s, `${PARTS}?q=steel&limit=1&after=P-1`), 200)
      same('no more matches, though more parts follow', { skus: last.parts.map(p => p.sku), next: last.next }, { skus: ['P-2'], next: null })
    })
  })
}

// --- Moves ---
function movesCases({ plain, expectPart }) {
  it('POST moves: the rules in order, whole numbers only, the note as given', async () => {
    const s = await shared()
    const made = await partOf(s, nextSku())
    const good = { on_date: '2026-03-01', qty: 5, unit_cost_cents: 100 }
    const send = over => post(s, moves(made.id), { ...good, ...over })
    const dates = [undefined, null, 5, '', '2026-3-1', '2026-03-1', ' 2026-03-01', '2026-03-01 ', '2026/03/01', '2026-02-29', '2100-02-29', '1999-12-31', '2100-01-01', '2026-13-01', '2026-00-10', '2026-01-00', '2026-04-31', '٢٠٢٦-٠٣-٠١', '20260301']
    for (const on_date of dates) await expect(`on_date ${JSON.stringify(on_date)}`, send({ on_date, qty: 0, unit_cost_cents: -1, note: 5 }), 400, err(E.date))
    for (const qty of [undefined, null, 0, 1.5, '1', true, BILLION + 1, -BILLION - 1, 1e300]) await expect(`qty ${JSON.stringify(qty)}`, send({ qty, unit_cost_cents: -1, note: 5 }), 400, err(E.qty))
    for (const unit_cost_cents of [undefined, null, -1, 1.5, '1', BILLION + 1]) await expect(`cost ${JSON.stringify(unit_cost_cents)}`, send({ unit_cost_cents, note: 5 }), 400, err(E.cost))
    for (const note of [null, 5, [], 'x'.repeat(201)]) await expect(`note ${JSON.stringify(note)}`, send({ note, qty: -1000 }), 400, err(E.note))
    for (const on_date of ['2024-02-29', '2000-02-29', '2000-01-01', '2099-12-31']) await ok(send({ on_date }), 201, on_date)
    const extra = { id: 12345, part_id: 99, balance: 5, other: 1 }
    const move = await ok(send({ ...extra, note: '  spaced  ' }), 201)
    same('the reply', { move }, { move: { id: move.id, part_id: made.id, on_date: '2026-03-01', qty: 5, unit_cost_cents: 100, note: '  spaced  ' } })
    const noNote = await ok(send({}), 201)
    assert.equal(noNote.note, '', 'no note is an empty note')
    assert.equal((await ok(send({ note: 'x'.repeat(200) }), 201)).note.length, 200)
    assert.equal((await ok(send({ qty: 2.0, unit_cost_cents: 0 }), 201)).qty, 2, 'a whole JSON number, and a cost of 0')
    await ok(send({ qty: BILLION, unit_cost_cents: BILLION }), 201, 'the top of both ranges')
    await ok(send({ qty: -BILLION }), 201, 'the bottom of qty')
  })

  it('the running balance holds on every date: a move dated before others can break it, and the first date it breaks on is named', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'A-1')
      const add = (date, qty) => post(s, moves(made.id), { on_date: date, qty, unit_cost_cents: 1 })
      await expect('nothing in stock', add('2026-01-01', -1), 409, err(below('2026-01-01')))
      await ok(add('2026-03-10', 10), 201)
      await expect('out before it came in', add('2026-03-05', -1), 409, err(below('2026-03-05')))
      await ok(add('2026-03-10', -10), 201, 'the same date, later id')
      await expect('after it all went', add('2026-03-20', -1), 409, err(below('2026-03-20')))
      const other = await partOf(s, 'A-2')
      const on = (date, qty) => post(s, moves(other.id), { on_date: date, qty, unit_cost_cents: 1 })
      for (const [date, qty] of [['2026-01-10', 5], ['2026-01-20', -5], ['2026-02-01', 5], ['2026-02-10', -5]]) await ok(on(date, qty), 201)
      await expect('fine on its own date, but a later move goes below', on('2026-01-15', -1), 409, err(below('2026-01-20')))
      await expect('below at its own date', on('2026-01-05', -1), 409, err(below('2026-01-05')))
      await expect('later again', on('2026-02-05', -1), 409, err(below('2026-02-10')))
      await expect('below on its own date, in a gap between moves', on('2026-01-25', -1), 409, err(below('2026-01-25')))
      await ok(on('2026-01-12', 1), 201, 'stock coming in early is always fine')
      await ok(on('2026-01-15', -1), 201, 'now it fits')
      const walked = (await ok(get(s, moves(other.id)), 200)).moves
      assert.deepEqual(walked.map(m => [m.on_date, m.qty, m.balance]), [['2026-01-10', 5, 5], ['2026-01-12', 1, 6], ['2026-01-15', -1, 5], ['2026-01-20', -5, 0], ['2026-02-01', 5, 5], ['2026-02-10', -5, 0]])
      assert.deepEqual(Object.keys(walked[0]).sort(), ['balance', 'id', 'note', 'on_date', 'part_id', 'qty', 'unit_cost_cents'])
    })
  })

  it('DELETE /api/moves/<id>: 409 when the running balance would go below zero, and the move stays', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'A-1')
      const a = await moveOf(s, made.id, '2026-03-01', 5)
      const b = await moveOf(s, made.id, '2026-03-02', 5)
      const c = await moveOf(s, made.id, '2026-03-03', -8)
      const d = await moveOf(s, made.id, '2026-03-04', 8)
      await expect('takes the first in', del(s, `/api/moves/${a.id}`), 409, err(below('2026-03-03')))
      await expect('takes the second in', del(s, `/api/moves/${b.id}`), 409, err(below('2026-03-03')))
      assert.equal(plain(await ok(get(s, part(made.id)), 200)).on_hand, 10)
      const gone = await del(s, `/api/moves/${d.id}`)
      same('fine', { status: gone.status, text: gone.text }, { status: 204, text: '' })
      await expect('gone', del(s, `/api/moves/${d.id}`), 404, err(E.moveNotFound))
      await ok(del(s, `/api/moves/${c.id}`), 204, 'stock going out can always go')
      await ok(del(s, `/api/moves/${a.id}`), 204, 'now fine')
      assert.deepEqual((await ok(get(s, moves(made.id)), 200)).moves.map(m => [m.id, m.balance]), [[b.id, 5]])
    })
  })

  it('GET moves sorts by on_date, then id', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'A-1')
      const a = await moveOf(s, made.id, '2026-03-05', 5, 1, { note: 'n' })
      const b = await moveOf(s, made.id, '2026-03-01', 5, 2)
      const c = await moveOf(s, made.id, '2026-03-05', -1, 3)
      const r = await ok(get(s, moves(made.id)), 200)
      assert.deepEqual(r, { moves: [{ ...b, balance: 5 }, { ...a, balance: 10 }, { ...c, balance: 9 }] })
    })
  })

  it('POST /api/transfers: two moves with their notes, the rules in order, the source held to the running balance', async () => {
    await withServer({}, async s => {
      const a = await partOf(s, 'FROM-1')
      const b = await partOf(s, 'TO-1')
      await moveOf(s, a.id, '2026-03-10', 10, 500)
      const good = { from_part: a.id, to_part: b.id, on_date: '2026-03-10', qty: 4, unit_cost_cents: 500 }
      const send = over => post(s, '/api/transfers', { ...good, ...over })
      for (const from_part of [undefined, null, '1', 1.5, 0, -1, 999999, [a.id]]) await expect(`from ${JSON.stringify(from_part)}`, send({ from_part, on_date: 'x', qty: 0 }), 404, err(E.partNotFound))
      for (const to_part of [undefined, null, String(b.id), 999999]) await expect(`to ${JSON.stringify(to_part)}`, send({ to_part, on_date: 'x', qty: 0 }), 404, err(E.partNotFound))
      await expect('the same part', send({ to_part: a.id, on_date: 'x', qty: 0 }), 400, err(E.differ))
      await expect('on_date', send({ on_date: '2026-02-30', qty: 0 }), 400, err(E.date))
      for (const qty of [undefined, 0, -1, 1.5, '1', BILLION + 1]) await expect(`qty ${JSON.stringify(qty)}`, send({ qty, unit_cost_cents: -1 }), 400, err(E.transferQty))
      for (const unit_cost_cents of [undefined, -1, 1.5, BILLION + 1]) await expect(`cost ${JSON.stringify(unit_cost_cents)}`, send({ unit_cost_cents }), 400, err(E.cost))
      await expect('more than there is', send({ qty: 11 }), 409, err(below('2026-03-10')))
      await expect('before it came in', send({ on_date: '2026-03-09' }), 409, err(below('2026-03-09')))
      const before = dump(s.file).moves
      assert.equal(before.length, 1, 'a refused transfer stores nothing')
      const done = await ok(send({ note: 'ignored' }), 201)
      assert.deepEqual(Object.keys(done).sort(), ['in', 'out'])
      assert.deepEqual(done.out, { id: done.out.id, part_id: a.id, on_date: '2026-03-10', qty: -4, unit_cost_cents: 500, note: 'transfer to TO-1' })
      assert.deepEqual(done.in, { id: done.in.id, part_id: b.id, on_date: '2026-03-10', qty: 4, unit_cost_cents: 500, note: 'transfer from FROM-1' })
      assert.notEqual(done.in.id, done.out.id)
      await expectPart('source', get(s, part(a.id)), 200, { id: a.id, sku: 'FROM-1', name: 'Part', on_hand: 6, value_cents: '3000' })
      await expectPart('target', get(s, part(b.id)), 200, { id: b.id, sku: 'TO-1', name: 'Part', on_hand: 4, value_cents: '2000' })
      await expect('the stock that moved can no longer go twice', send({ qty: 7 }), 409, err(below('2026-03-10')))
    })
  })
}

// --- Page ---
// What the page cases need from the stage they run on.
function pageTools(stage) {
  const LISTED = (p) => (stage === 1 ? `${p.sku} ${p.name} (${p.on_hand})` : `${p.handle}: ${p.sku} ${p.name} (${p.on_hand})`)
  const P = (id, sku, name, onHand = 0) => ({ id, sku, name, on_hand: onHand, value_cents: '0', ...(stage === 1 ? {} : { handle: `h-${id}` }) })
  const SAMPLE = [P(3, 'A-1', 'Bolt', 5), P(1, 'B-1', '<b>x</b> & co', 0)]
  const rows = page => page.el('part-list').kids.map(li => [li.tag, ...(li.kids ?? []).map(k => (isEl(k) ? `<${k.tag} type=${k.attrs.type}>${textOf(k)}` : k.text))])
  const row = p => ['li', LISTED(p), '<button type=button>Delete']
  const NONE = [['li', 'No parts.']]
  const LIST = SAMPLE.map(row)
  const moreOff = page => isDisabled(page.el('more'))
  const okList = (parts, next = null) => c => c.reply(200, { parts, next })
  const ready = readyWith(SAMPLE)
  const search = async (page, value) => {
    setValue(page.el('search'), value)
    fire(page.el('search'), 'change')
    await flush()
  }
  const FORM = { sku: 'N-1', name: '  New <i>part</i> ' }
  const submit = async page => {
    const prevented = fire(page.el('part-form'), 'submit')
    await flush()
    return prevented
  }
  const fill = (page, values) => Object.entries(values).forEach(([id, v]) => setValue(page.el(id), v))
  const bodyOf = call => tryJson(call.opts.body)
  return { P, SAMPLE, rows, row, NONE, LIST, moreOff, okList, ready, search, FORM, submit, fill, bodyOf }
}

function pageMarkupCases() {
  it('GET / and GET /app.js: types, query ignored, one <title> and <h1>, one last script, no inline code', async () => {
    const s = await shared()
    const { html, js } = await assets()
    const root = parseHtml(html)
    for (const [path, type, text] of [['/', 'text/html', html], ['/?v=1', 'text/html', html], ['/app.js', 'text/javascript', js], ['/app.js?v=1', 'text/javascript', js]]) {
      const r = await get(s, path)
      same(path, { status: r.status, type: r.type, same: r.text === text, empty: text === '' }, { status: 200, type: `${type}; charset=utf-8`, same: true, empty: false })
    }
    assert.deepEqual(['title', 'h1'].map(t => all(root).filter(n => n.tag === t).map(norm)), [['Parts store'], ['Parts store']])
    const scripts = all(root).filter(n => n.tag === 'script')
    const body = all(root).find(n => n.tag === 'body') ?? root
    assert.deepEqual(scripts.map(n => ({ src: n.attrs.src, inline: textOf(n).trim(), flags: ['type', 'defer', 'async'].filter(a => a in n.attrs) })), [{ src: '/app.js', inline: '', flags: [] }])
    assert.ok(body.kids.filter(isEl).at(-1) === scripts[0], 'the script is the last element in <body>')
    assert.deepEqual(all(root).flatMap(n => Object.keys(n.attrs).filter(a => a.startsWith('on')).map(a => `<${n.tag} ${a}>`)), [], 'no on… attributes')
    assert.doesNotThrow(() => new vm.Script(js, { filename: 'app.js' }), 'a classic script')
  })

  it('page markup: the form with its fields and labels; outside it search, the list, Load more and an empty #error', async () => {
    const { html } = await assets()
    const root = parseHtml(html)
    const form = byId(root, 'part-form')
    assert.deepEqual({ tag: form?.tag, novalidate: Boolean(form && 'novalidate' in form.attrs) }, { tag: 'form', novalidate: true })
    const about = id => (n => n && { tag: n.tag, type: n.attrs.type?.toLowerCase(), text: norm(n), inForm: within(n, form) })(byId(root, id))
    const labels = id => all(root).filter(n => n.tag === 'label' && n.attrs.for === id).map(l => ({ text: norm(l), holdsField: all(l).some(n => n.attrs.id === id) }))
    for (const [id, type, label, inForm] of [['sku', 'text', 'SKU', true], ['name', 'text', 'Name', true], ['search', 'search', 'Search', false]]) {
      same(id, { ...about(id), labels: labels(id) }, { tag: 'input', type, text: '', inForm, labels: [{ text: label, holdsField: false }] })
    }
    same('add', about('add'), { tag: 'button', type: 'submit', text: 'Add', inForm: true })
    same('more', about('more'), { tag: 'button', type: 'button', text: 'Load more', inForm: false })
    assert.equal(about('part-list')?.tag, 'ul')
    const error = byId(root, 'error')
    assert.deepEqual({ tag: error?.tag, role: error?.attrs.role, kids: error?.kids.length, inForm: within(error, form) }, { tag: 'p', role: 'alert', kids: 0, inForm: false })
  })
}

function pageListCases({ P, SAMPLE, rows, row, NONE, LIST, moreOff, okList, ready, search }) {
  it('page: at load the list is requested at once and filled as plain text; no parts is one line; Load more follows next', async () => {
    const page = await openPage()
    assert.deepEqual(pending(page), [`GET ${LIST_FIRST}`], 'requested before any event')
    assert.ok(moreOff(page), 'disabled until the first reply')
    await settle(take(page, 'GET', LIST_FIRST), okList(SAMPLE))
    assert.deepEqual({ rows: rows(page), more: moreOff(page), error: errorText(page) }, { rows: LIST, more: true, error: '' })
    const empty = await ready([])
    assert.deepEqual({ rows: rows(empty), more: moreOff(empty) }, { rows: NONE, more: true })
    const more = await ready(SAMPLE, 'B-1')
    assert.equal(moreOff(more), false, 'enabled when next is a string')
  })

  it('page: a list fetch with an error status or no reply shows the message and leaves the list; a success leaves #error alone', async () => {
    const cases = [[c => c.reply(500, err('boom')), 'boom'], [c => c.reply(201, { parts: [], next: null }), FAILED_REQ], [c => c.reply(404, err(404)), FAILED_REQ], [c => c.reply(400, ['x']), FAILED_REQ], [c => c.reply(200, '<h1>oops</h1>'), NO_REPLY], [c => c.reply(500, 'Internal'), NO_REPLY], [c => c.fail(), NO_REPLY]]
    for (const [i, [how, message]] of cases.entries()) {
      const page = await ready()
      await search(page, 'x')
      await settle(take(page, 'GET', `${LIST_FIRST}&q=x`), how)
      assert.deepEqual({ error: errorText(page), rows: rows(page) }, { error: message, rows: LIST }, `case ${i}`)
      await search(page, 'y')
      await settle(take(page, 'GET', `${LIST_FIRST}&q=y`), okList([]))
      assert.deepEqual({ error: errorText(page), rows: rows(page) }, { error: message, rows: NONE }, 'a success leaves #error alone')
    }
  })

  it('page: Load more adds after the list, with the search kept and everything encoded; a failure keeps the list and enables it again', async () => {
    const page = await ready([P(1, 'A/1', 'a')], 'A/1')
    fire(page.el('more'), 'click')
    await flush()
    assert.ok(moreOff(page), 'disabled while it loads')
    await settle(take(page, 'GET', `${LIST_FIRST}&after=A%2F1`), okList([P(2, 'B', 'b')], 'B'))
    assert.deepEqual(rows(page), [row(P(1, 'A/1', 'a')), row(P(2, 'B', 'b'))])
    assert.equal(moreOff(page), false)
    fire(page.el('more'), 'click')
    await flush()
    await settle(take(page, 'GET', `${LIST_FIRST}&after=B`), c => c.reply(500, err('boom')))
    assert.deepEqual({ error: errorText(page), n: rows(page).length, more: moreOff(page) }, { error: 'boom', n: 2, more: false })
    fire(page.el('more'), 'click')
    await flush()
    await settle(take(page, 'GET', `${LIST_FIRST}&after=B`), okList([P(3, 'C', 'c')]))
    assert.deepEqual({ n: rows(page).length, more: moreOff(page) }, { n: 3, more: true })
    const searched = await ready()
    await search(searched, 'a b&c')
    await settle(take(searched, 'GET', `${LIST_FIRST}&q=a%20b%26c`), okList([P(5, 'S', 's')], 'S'))
    fire(searched.el('more'), 'click')
    await flush()
    await settle(take(searched, 'GET', `${LIST_FIRST}&q=a%20b%26c&after=S`), okList([]))
    assert.equal(rows(searched).length, 1, 'nothing more to add')
  })

  it('page: change searches at once from the start; input does nothing; clearing the search drops q', async () => {
    const page = await ready(SAMPLE, 'B-1')
    setValue(page.el('search'), 'typed')
    fire(page.el('search'), 'input')
    await flush()
    assert.deepEqual(pending(page), [], 'input does nothing')
    fire(page.el('search'), 'change')
    await flush()
    await settle(take(page, 'GET', `${LIST_FIRST}&q=typed`), okList([]))
    assert.deepEqual(rows(page), NONE)
    await search(page, '')
    await settle(take(page, 'GET', LIST_FIRST), okList(SAMPLE))
    assert.deepEqual(rows(page), LIST)
  })

  it('page: when list fetches overlap only the last one started counts, whatever arrives first and however it ends', async () => {
    for (const late of [okList([P(9, 'OLD', 'old')]), c => c.reply(500, err('old')), c => c.fail()]) {
      const page = await ready()
      await search(page, 'a')
      await search(page, 'b')
      await settle(take(page, 'GET', `${LIST_FIRST}&q=b`), okList([]))
      await settle(take(page, 'GET', `${LIST_FIRST}&q=a`), late)
      assert.deepEqual({ rows: rows(page), error: errorText(page) }, { rows: NONE, error: '' })
    }
    const page = await ready(SAMPLE, 'B-1')
    fire(page.el('more'), 'click')
    await flush()
    await search(page, 'a')
    await settle(take(page, 'GET', `${LIST_FIRST}&after=B-1`), okList([P(9, 'OLD', 'old')], 'OLD'))
    assert.deepEqual(rows(page), LIST, 'a Load more overtaken by a search adds nothing')
    await settle(take(page, 'GET', `${LIST_FIRST}&q=a`), okList([]))
    assert.deepEqual({ rows: rows(page), more: moreOff(page) }, { rows: NONE, more: true })
  })
}

function pageFormCases({ P, rows, row, okList, ready, FORM, submit, fill, bodyOf }) {
  it('page: adding sends the fields unchanged, Add is disabled meanwhile, and a success empties them and fetches again', async () => {
    const page = await ready()
    fill(page, FORM)
    assert.equal(await submit(page), true, 'preventDefault')
    assert.ok(isDisabled(page.el('add')), 'disabled while it runs')
    await submit(page)
    assert.deepEqual(pending(page), ['POST /api/parts'], 'a second submit sends nothing')
    const call = take(page, 'POST', '/api/parts')
    assert.deepEqual({ ...call.opts.headers }, { 'Content-Type': 'application/json' })
    assert.deepEqual(bodyOf(call), FORM)
    await settle(call, c => c.reply(201, P(7, 'N-1', 'New')))
    assert.deepEqual({ add: isDisabled(page.el('add')), sku: valueIn(page.el('sku')), name: valueIn(page.el('name')), fetches: pending(page) }, { add: false, sku: '', name: '', fetches: [`GET ${LIST_FIRST}`] })
    await settle(take(page, 'GET', LIST_FIRST), okList([P(7, 'N-1', 'New')]))
    assert.deepEqual(rows(page), [row(P(7, 'N-1', 'New'))])
  })

  it('page: a refused add shows the message and keeps the fields; a later success empties #error; no reply says so', async () => {
    const page = await ready()
    fill(page, FORM)
    await submit(page)
    await settle(take(page, 'POST', '/api/parts'), c => c.reply(409, err('sku already exists')))
    assert.deepEqual({ error: errorText(page), add: isDisabled(page.el('add')), sku: valueIn(page.el('sku')), name: valueIn(page.el('name')), fetches: pending(page) }, { error: 'sku already exists', add: false, ...FORM, fetches: [] })
    await submit(page)
    await settle(take(page, 'POST', '/api/parts'), c => c.fail())
    assert.deepEqual({ error: errorText(page), add: isDisabled(page.el('add')), sku: valueIn(page.el('sku')) }, { error: NO_REPLY, add: false, sku: FORM.sku })
    await submit(page)
    await settle(take(page, 'POST', '/api/parts'), c => c.reply(201, P(7, 'N-1', 'New')))
    assert.equal(errorText(page), '')
    take(page, 'GET', LIST_FIRST)
  })
}

function pageDeleteCases({ SAMPLE, okList, ready }) {
  it('page: Delete disables its button and sends the part\'s id; the list comes back afterwards, except with no reply', async () => {
    const page = await ready()
    const click = async i => {
      const button = page.el('part-list').kids[i].kids[1]
      fire(button, 'click')
      await flush()
      return button
    }
    const first = await click(0)
    assert.ok(isDisabled(first), 'disabled while it runs')
    await settle(take(page, 'DELETE', '/api/parts/3'), c => c.reply(404, err('part not found')))
    assert.deepEqual({ error: errorText(page), disabled: isDisabled(first), fetches: pending(page) }, { error: 'part not found', disabled: false, fetches: [`GET ${LIST_FIRST}`] })
    await settle(take(page, 'GET', LIST_FIRST), okList(SAMPLE))
    const again = await click(1)
    await settle(take(page, 'DELETE', '/api/parts/1'), c => c.fail())
    assert.deepEqual({ error: errorText(page), disabled: isDisabled(again), fetches: pending(page) }, { error: NO_REPLY, disabled: false, fetches: [] })
    await click(0)
    await settle(take(page, 'DELETE', '/api/parts/3'), c => c.reply(204))
    assert.deepEqual({ error: errorText(page), fetches: pending(page) }, { error: '', fetches: [`GET ${LIST_FIRST}`] })
  })
}
