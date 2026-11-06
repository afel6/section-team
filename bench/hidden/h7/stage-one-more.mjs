// More cases for stage 1's behaviour, added after a calibration run found no failing test. Every case follows from a line of
// bench/tasks/h7.md; docs/plans/h7-hidden-coverage.md lists which. Called from stageOneCases, so s1 and reg both run them.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import {
  LINE, LIST_FIRST, REFUSED, answer, boot, del, dump, err, errorText, expect, fire, flush, fresh, freshDb, freePort, get, isDisabled, it, listenOn, moveOf, ok, openPage, partOf, patch, pending, plantV1, post,
  refused, req, runToExit, same, settle, shared, sleep, startServer, stopServer, take, valueIn, view, withDb, withLock, withServer,
} from './lib.mjs'

const PARTS = '/api/parts'
const part = id => `/api/parts/${id}`
const moves = id => `/api/parts/${id}/moves`
const NOT_FOUND = err('not found')
const BILLION = 1_000_000_000
const below = date => `stock would go below zero on ${date}`
const bytes = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))
let counter = 0
const nextSku = () => `MX-${++counter}`

export function moreCases({ stage, tools, page }) {
  startupMore(stage)
  failuresMore(tools)
  routingMore()
  partsMore()
  movesMore()
  pageMore(page)
}

function startupMore(stage) {
  it('PORT is read whole: a trailing newline or space is refused, and so is a value above 65535 behind zeros; many leading zeros are fine', async () => {
    const port = await freePort()
    for (const PORT of [`${port}\n`, `${port} `, '0065536', '000099999']) {
      const file = freshDb()
      const r = await runToExit({ PORT, DB_FILE: file })
      same(JSON.stringify(PORT), { code: r.code, out: r.out, line: /[^\r\n]/.test(r.err) }, { code: 1, out: '', line: true })
    }
    const wide = await boot({ PORT: `${'0'.repeat(30)}${port}`, DB_FILE: freshDb() }, { cwd: fresh() })
    await stopServer(wide)
    assert.equal(wide.out, LINE(port))
  })

  it('the database is opened before the server listens: a port in use and a database it cannot open give the database refusal', async () => {
    const blocker = await listenOn(0)
    const garbage = join(fresh(), 'garbage.db')
    writeFileSync(garbage, 'this is not a database. '.repeat(100))
    const r = await runToExit({ PORT: String(blocker.address().port), DB_FILE: garbage })
    await new Promise(resolve => blocker.close(resolve))
    same('busy port, bad database', refused(r, `cannot open database ${garbage}`), REFUSED)
  })

  it('it listens on 127.0.0.1 only: nothing answers on ::1 or on the machine\'s other addresses', async () => {
    await withServer({}, async s => {
      const others = Object.values(networkInterfaces()).flat().filter(a => a && !a.internal && (a.family === 'IPv4' || a.family === 4)).map(a => a.address)
      for (const host of ['::1', ...others]) {
        const answered = await new Promise(resolve => {
          const c = connect({ host, port: s.port })
          c.setTimeout(3000, () => { c.destroy(); resolve(false) })
          c.once('connect', () => { c.destroy(); resolve(true) })
          c.once('error', () => resolve(false))
        })
        assert.equal(answered, false, `connected to ${host}`)
      }
    })
  })

  it('stdout holds the listening line and nothing more, whatever the server is asked and whatever fails', async () => {
    const s = await startServer()
    try {
      const made = await partOf(s, 'A-1')
      await moveOf(s, made.id, '2026-03-01', 1)
      await req(s, 'GET', '/')
      await req(s, 'GET', '/app.js')
      await req(s, 'GET', '/nothing')
      await req(s, 'PUT', PARTS)
      await post(s, PARTS, { sku: '', name: 'x' })
      await post(s, PARTS, { sku: 'A-1', name: 'x' })
      await post(s, moves(made.id), { on_date: '2026-03-01', qty: -5, unit_cost_cents: 1 })
      withDb(s.file, db => db.exec("CREATE TRIGGER boom BEFORE INSERT ON moves BEGIN SELECT RAISE(ABORT, 'boom'); END;"))
      same('a failing write', view(await post(s, moves(made.id), { on_date: '2026-03-02', qty: 1, unit_cost_cents: 1 })), answer(500, err('internal error')))
      await sleep(200)
      assert.equal(s.out, LINE(s.port))
    } finally {
      await stopServer(s)
    }
  })

  it('a user_version that is not supported is refused whole, with tables or without, and the file stays as it was', async () => {
    const dir = fresh()
    for (const version of [-1, 5, stage === 1 ? 2 : 3]) {
      for (const tables of [false, true]) {
        const file = join(dir, `v${version}-${tables}.db`)
        withDb(file, db => db.exec(`${tables ? 'CREATE TABLE t (a);' : ''} PRAGMA user_version = ${version}`))
        const before = readFileSync(file)
        same(`version ${version}, tables ${tables}`, refused(await runToExit({ DB_FILE: file }), `cannot open database ${file}`), REFUSED)
        assert.ok(readFileSync(file).equals(before), `version ${version}, tables ${tables}: the file changed`)
      }
    }
  })

  if (stage === 1) {
    it('a version 1 database is used as it is: rows of other tools show as they are, nothing is checked or changed, ids go on from the sequences', async () => {
      const file = plantV1(freshDb(), {
        parts: [{ id: 4, sku: 'A-1', name: 'Bolt' }, { id: 6, sku: 'B-1', name: 'Nut' }],
        moves: [{ id: 3, part_id: 4, on_date: '2026-03-01', qty: -5, unit_cost_cents: 100 }, { id: 8, part_id: 99, on_date: '2026-03-01', qty: 1, unit_cost_cents: 1 }],
        seq: { parts: 9, moves: 12 },
      })
      withDb(file, db => db.exec("CREATE TABLE tool_log (id INTEGER PRIMARY KEY, note TEXT); INSERT INTO tool_log (note) VALUES ('kept'); CREATE INDEX tool_name ON parts (name); CREATE VIEW tool_skus AS SELECT sku FROM parts;"))
      const before = dump(file)
      await withServer({ file }, async s => {
        assert.deepEqual((await ok(get(s, PARTS), 200)).parts, [
          { id: 4, sku: 'A-1', name: 'Bolt', on_hand: -5, value_cents: '-500' },
          { id: 6, sku: 'B-1', name: 'Nut', on_hand: 0, value_cents: '0' },
        ])
        assert.deepEqual((await ok(get(s, moves(4)), 200)).moves.map(m => [m.id, m.balance]), [[3, -5]])
        assert.deepEqual(dump(file), before, 'reading changed the file')
        assert.equal((await partOf(s, 'C-1')).id, 10)
        assert.equal((await moveOf(s, 6, '2026-03-01', 1)).id, 13)
      })
      withDb(file, db => {
        assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1)
        assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'tool_%' ORDER BY name").all().map(r => r.name), ['tool_log', 'tool_name', 'tool_skus'])
        assert.deepEqual(db.prepare('SELECT note FROM tool_log').all().map(r => r.note), ['kept'])
      })
    })
  }
}

function failuresMore({ plain }) {
  it('a failure in a read is 500 internal error too, and the server keeps running', async () => {
    await withServer({}, async s => {
      const made = await partOf(s, 'A-1')
      await moveOf(s, made.id, '2026-03-01', 3)
      withDb(s.file, db => db.exec('ALTER TABLE moves RENAME TO moves_gone'))
      try {
        for (const path of [PARTS, part(made.id), moves(made.id)]) await expect(`GET ${path}`, get(s, path), 500, err('internal error'))
      } finally {
        withDb(s.file, db => db.exec('ALTER TABLE moves_gone RENAME TO moves'))
      }
      assert.equal(plain(await ok(get(s, part(made.id)), 200)).on_hand, 3)
    })
  })

  // Three more writes, each held to the same lock rules as POST /api/parts.
  const writesOn = async s => {
    const a = await partOf(s, 'A-1')
    const b = await partOf(s, 'B-1')
    const first = await moveOf(s, a.id, '2026-03-01', 5)
    const second = await moveOf(s, b.id, '2026-03-01', 5)
    return {
      first, second,
      writes: [
        ['PATCH part', () => patch(s, part(a.id), { name: 'Renamed' }), 200],
        ['DELETE move', () => del(s, `/api/moves/${second.id}`), 204],
        ['POST transfer', () => post(s, '/api/transfers', { from_part: a.id, to_part: b.id, on_date: '2026-03-02', qty: 1, unit_cost_cents: 1 }), 201],
      ],
    }
  }

  it('a locked database: PATCH, DELETE of a move and a transfer wait for a lock that goes within 3 seconds', async () => {
    await withServer({}, async s => {
      const { writes } = await writesOn(s)
      await withLock(s.file, 1000, () => writes.map(([, send]) => send()), async sent => {
        const replies = await Promise.all(sent)
        assert.deepEqual(replies.map(r => r.status), writes.map(([, , status]) => status))
      })
    })
  })

  // A wait of 3 seconds takes longer on a loaded or Windows clock (about 4.7 s), and the server stops for it, so only one request fits in a window.
  it('a locked database: a transfer still locked after 3 seconds is 503 database busy and changes nothing', async () => {
    await withServer({}, async s => {
      const { writes } = await writesOn(s)
      const before = dump(s.file)
      const [label, send] = writes.at(-1)
      await withLock(s.file, 6500, () => ({ reply: send() }), async ({ reply }) => {
        same(label, view(await reply), answer(503, err('database busy')))
      })
      same('rows', dump(s.file), before)
      await ok(patch(s, part(before.parts[0].id), { name: 'Back' }), 200, 'the server works once the lock is gone')
    })
  })
}

function routingMore() {
  it('a path not listed is 404 whatever the method or the body, also with a wrong type or a body too big; an empty id or one with a slash names no route', async () => {
    const s = await shared()
    for (const method of ['PUT', 'PATCH', 'OPTIONS', 'HEAD', 'DELETE']) assert.equal((await req(s, method, '/nothing')).status, 404, method)
    for (const method of ['POST', 'PATCH']) {
      for (const [label, opts] of [['wrong type', { body: '{}', type: 'text/plain' }], ['too big', { body: 'x'.repeat(10001) }], ['not JSON', { body: 'nope' }], ['no type', { body: '{}', type: null }]]) {
        await expect(`${method} /nothing, ${label}`, req(s, method, '/nothing', opts), 404, NOT_FOUND)
      }
    }
    const paths = ['/api/parts//moves', '/api/parts/1/2', '/api/parts/1/moves/2', '/api/moves/1/2', '/api/parts%3F', '/api/transfers/x', '/api/parts/x/moves/']
    for (const path of paths) for (const method of ['GET', 'POST', 'DELETE']) await expect(`${method} ${path}`, req(s, method, path), 404, NOT_FOUND)
    const known = await partOf(s, nextSku())
    for (const id of ['%2F', '1%20', '%20', '%0A', `${known.id}%0A`, '%00']) {
      await expect(`GET part ${id}`, get(s, part(id)), 404, err('part not found'))
      await expect(`GET moves ${id}`, get(s, moves(id)), 404, err('part not found'))
      await expect(`DELETE move ${id}`, del(s, `/api/moves/${id}`), 404, err('move not found'))
    }
    await expect('PATCH of an unknown part with a body that is fine JSON', patch(s, part(999999), {}), 404, err('part not found'))
  })

  it('the query is cut at the first ?, and decoded as URLSearchParams does: bad percent signs, a repeated name, an encoded name', async () => {
    await withServer({}, async s => {
      for (const sku of ['a', 'b', 'c', 'd']) await partOf(s, sku, sku === 'a' ? 'steel' : 'plain')
      const list = async query => (await ok(get(s, `${PARTS}${query}`), 200)).parts.map(p => p.sku)
      for (const [query, want] of [
        ['?', ['a', 'b', 'c', 'd']], ['?limit=%32', ['a', 'b']], ['?%6Cimit=1', ['a']], ['?x=1&limit=1', ['a']], ['?limit=2&limit=abc', ['a', 'b']], ['?q=%FF', []], ['?q=%', []], ['?q=%E0%A4%A', []],
        ['?q=steel&q=zzz', ['a']], ['?q=zzz&q=steel', []], ['?after=b&after=z', ['c', 'd']], ['?after=z&after=b', []], ['?q=&q=steel', ['a', 'b', 'c', 'd']],
      ]) assert.deepEqual(await list(query), want, `GET ${PARTS}${query}`)
      for (const query of ['?limit=abc&limit=3', '?limit=%D9%A3', '?limit=%2B1', '?limit=1%0A']) await expect(`GET ${PARTS}${query}`, get(s, `${PARTS}${query}`), 400, err('limit must be 1 to 100'))
      const made = await ok(post(s, `${PARTS}?limit=abc`, { sku: 'e', name: 'plain' }), 201, 'POST with a query')
      assert.equal((await ok(get(s, `${part(made.id)}?/moves`), 200)).sku, 'e', 'the path ends at the first ?')
      const patched = await ok(patch(s, `${part(made.id)}?name=x`, { name: 'kept' }), 200)
      assert.equal(patched.name, 'kept')
      const gone = await del(s, `${part(made.id)}?x=%`)
      assert.equal(gone.status, 204)
    })
  })

  it('the size limit counts bytes, a multi-byte character may be cut by the network, and JSON may be padded or repeat a key', async () => {
    const s = await shared()
    const sized = (sku, size) => {
      const base = JSON.stringify({ sku, name: 'x', pad: '' })
      const room = size - Buffer.byteLength(base)
      const text = base.replace('"pad":""', `"pad":"${'é'.repeat(Math.floor(room / 2))}${'x'.repeat(room % 2)}"`)
      assert.equal(Buffer.byteLength(text), size)
      return text
    }
    await ok(post(s, PARTS, sized(nextSku(), 10000)), 201, '10000 bytes of two-byte characters')
    for (const size of [10001, 10002, 10240]) await expect(`${size} bytes, about half as many characters`, post(s, PARTS, sized(nextSku(), size)), 413, err('body too large'))
    const raw = Buffer.from(JSON.stringify({ sku: nextSku(), name: 'é€\u{1F600}' }))
    const cut = raw.indexOf(0xc3) + 1
    const split = await ok(post(s, PARTS, undefined, { parts: [raw.subarray(0, cut), raw.subarray(cut, cut + 8), raw.subarray(cut + 8)], gap: 20 }), 201, 'a character split between two pieces')
    assert.equal(split.name, 'é€\u{1F600}')
    const padded = await ok(post(s, PARTS, ` \n\t{"sku":"${nextSku()}","name":"a","name":"b"}\r\n `), 201, 'padded JSON')
    assert.equal(padded.name, 'b', 'the last of a repeated key')
  })
}

function partsMore() {
  it('the name is cut with String.prototype.trim and counted in UTF-16 code units: no-break spaces go, a zero-width space stays', async () => {
    const s = await shared()
    const emoji = '\u{1F600}'.repeat(40)
    for (const name of ['  　  ﻿  ', `${emoji}x`, `${'x'.repeat(80)}y`]) await expect(`name ${JSON.stringify(name)}`, post(s, PARTS, { sku: nextSku(), name }), 400, err('name must be 1 to 80 characters'))
    for (const [name, kept] of [
      [' ﻿ x   ', 'x'], ['​x', '​x'], ['\u0085x\u0085', '\u0085x\u0085'], ['é', 'é'], [emoji, emoji], [`  ${emoji}\t`, emoji], ['é'.repeat(80), 'é'.repeat(80)], [`${'x'.repeat(80)} `, 'x'.repeat(80)],
    ]) assert.equal((await ok(post(s, PARTS, { sku: nextSku(), name }), 201, JSON.stringify(name))).name, kept, JSON.stringify(name))
    assert.equal((await ok(post(s, PARTS, { sku: '-', name: 'dash' }), 201)).sku, '-', 'a dash is a sku')
  })

  it('after compares bytes with the sku, whatever its letters: uppercase sorts before lowercase, a longer sku after its prefix, and é after everything', async () => {
    await withServer({}, async s => {
      const skus = ['a', 'B', 'AB-1', 'ab-1', 'Z', '0', '-x', 'A', 'b-1', 'b']
      for (const sku of skus) await partOf(s, sku)
      const sorted = [...skus].sort(bytes)
      for (const after of ['Z', 'b', 'a', '-x', '-', '0', 'AB', 'zzz', '~', '%C3%A9']) {
        const text = decodeURIComponent(after)
        const want = sorted.filter(sku => bytes(sku, text) > 0)
        const got = await ok(get(s, `${PARTS}?after=${after}`), 200)
        same(`after=${after}`, { skus: got.parts.map(p => p.sku), next: got.next }, { skus: want, next: null })
      }
      const one = await ok(get(s, `${PARTS}?limit=1&after=Z`), 200)
      same('limit 1', { skus: one.parts.map(p => p.sku), next: one.next }, { skus: ['a'], next: 'a' })
    })
  })

  it('q lowercases both sides with toLowerCase and nothing else: ß is not SS, İ becomes i and a dot, the Kelvin sign is k, and a query is never a pattern', async () => {
    await withServer({}, async s => {
      const rows = [['S-1', 'STRASSE'], ['S-2', 'Straße'], ['T-1', 'İstanbul'], ['K-1', 'Kelvin'], ['W-1', 'a.b'], ['X-1', 'axb'], ['R-1', '[a-c] (x)'], ['B-1', 'back\\slash'], ['Q-1', 'it\'s "q"']]
      for (const [sku, name] of rows) await partOf(s, sku, name)
      const lower = text => text.toLowerCase()
      for (const q of ['straße', 'STRASSE', 'strasse', 'STRAẞE', 'İ', 'i̇', 'i', 'İS', 'K', 'k', 'K', '.', 'a.b', '.*', '[a-c]', '(x)', '\\', '\\s', 'x)', '"q"', '\'s', 's-1', 'S-', '-']) {
        const want = rows.filter(([sku, name]) => lower(sku).includes(lower(q)) || lower(name).includes(lower(q))).map(r => r[0]).sort(bytes)
        const got = (await ok(get(s, `${PARTS}?q=${encodeURIComponent(q)}`), 200)).parts.map(p => p.sku)
        assert.deepEqual(got, want, `q=${q}`)
      }
    })
  })
}

function movesMore() {
  it('on_date is a real day from 2000-01-01 to 2099-12-31 written exactly YYYY-MM-DD; February 29 only in years divisible by 4', async () => {
    const s = await shared()
    const made = await partOf(s, nextSku())
    const send = on_date => post(s, moves(made.id), { on_date, qty: 1, unit_cost_cents: 1 })
    const bad = ['2001-02-29', '2026-06-31', '2026-09-31', '2026-11-31', '2026-12-32', '2026-03-01\n', '+2026-03-01', '2026-03-01T00:00:00Z', 20260301, '0000-01-01', '2100-12-31', '1999-12-31', '2026-02-00', '２０２６-０３-０１', '2026-1-01', 'abcd-ef-gh', '2026-03-01\u0000', true, {}, ['2026-03-01']]
    for (const on_date of bad) await expect(`on_date ${JSON.stringify(on_date)}`, send(on_date), 400, err('on_date must be a valid YYYY-MM-DD date'))
    for (const on_date of ['2096-02-29', '2004-02-29', '2026-04-30', '2026-12-31', '2026-01-31', '2000-12-31', '2099-01-01']) await ok(send(on_date), 201, on_date)
    assert.deepEqual(await ok(get(s, moves(made.id)), 200).then(r => r.moves.length), 7)
    const empty = await partOf(s, nextSku())
    assert.deepEqual(await ok(get(s, moves(empty.id)), 200), { moves: [] })
  })

  it('qty and unit_cost_cents are numbers as JSON.parse reads them (1e2 is 100, -0 is zero), and a note counts UTF-16 code units', async () => {
    const s = await shared()
    const made = await partOf(s, nextSku())
    const rawMove = (qty, cost = '1', extra = '') => post(s, moves(made.id), `{"on_date":"2026-03-01","qty":${qty},"unit_cost_cents":${cost}${extra}}`)
    const good = await ok(rawMove('1e2', '1E1'), 201, '1e2')
    assert.deepEqual([good.qty, good.unit_cost_cents], [100, 10])
    assert.equal((await ok(rawMove('0.5e1'), 201)).qty, 5)
    for (const qty of ['-0', '0e5', '9007199254740993', '1e400', '-1e400', '1000000000.5', '"5"']) await expect(`qty ${qty}`, rawMove(qty), 400, err('qty must be a non-zero whole number up to 1000000000'))
    for (const cost of ['1e400', '1000000001', '9007199254740993', 'null']) await expect(`cost ${cost}`, rawMove('1', cost), 400, err('unit_cost_cents must be a whole number from 0 to 1000000000'))
    const emoji = '\u{1F600}'
    assert.equal((await ok(rawMove('1', '1', `,"note":${JSON.stringify(emoji.repeat(100))}`), 201)).note, emoji.repeat(100), '200 code units')
    assert.equal((await ok(rawMove('1', '1', ',"note":""'), 201)).note, '')
    for (const note of [emoji.repeat(101), `${'x'.repeat(200)}y`, 'é'.repeat(199) + emoji]) await expect(`note of ${note.length} units`, rawMove('1', '1', `,"note":${JSON.stringify(note)}`), 400, err('note must be at most 200 characters'))
  })

  it('transfers: unknown parts come before the same-part rule, the day the source goes below zero is the first one that breaks, and the ranges hold at their edges', async () => {
    await withServer({}, async s => {
      const a = await partOf(s, 'FROM-1')
      const b = await partOf(s, 'TO-1')
      await moveOf(s, a.id, '2026-03-01', 6, 100)
      await moveOf(s, a.id, '2026-03-20', -5, 100)
      const send = over => post(s, '/api/transfers', { from_part: a.id, to_part: b.id, on_date: '2026-03-10', qty: 1, unit_cost_cents: 0, ...over })
      await expect('the same unknown part twice', send({ from_part: 999999, to_part: 999999, on_date: 'x', qty: 0 }), 404, err('part not found'))
      await expect('one unknown part, the other fine', send({ to_part: 999999 }), 404, err('part not found'))
      await expect('a later move breaks', send({ qty: 2 }), 409, err(below('2026-03-20')))
      await expect('the date itself breaks first', send({ qty: 7, on_date: '2026-03-02' }), 409, err(below('2026-03-02')))
      const done = await ok(send({}), 201)
      assert.deepEqual([done.out.unit_cost_cents, done.in.unit_cost_cents, done.out.on_date, done.in.on_date], [0, 0, '2026-03-10', '2026-03-10'])
      await expect('and now the later move breaks again', send({}), 409, err(below('2026-03-20')))
      await expect('a move dated the same day as the one that empties it goes after it', send({ on_date: '2026-03-20' }), 409, err(below('2026-03-20')))
      const edge = await partOf(s, 'EDGE-1')
      await moveOf(s, edge.id, '2026-03-01', BILLION, 1)
      const full = await ok(post(s, '/api/transfers', { from_part: edge.id, to_part: b.id, on_date: '2026-03-01', qty: BILLION, unit_cost_cents: BILLION }), 201)
      assert.deepEqual([full.out.qty, full.in.qty, full.in.unit_cost_cents], [-BILLION, BILLION, BILLION])
    })
  })
}

function pageMore({ P, SAMPLE, rows, row, NONE, moreOff, okList, ready, search, FORM, submit, fill }) {
  const NO_REPLY = 'Could not reach the server.'
  const FAILED = 'Request failed.'
  const clickMore = async page => {
    fire(page.el('more'), 'click')
    await flush()
  }
  const clickDelete = async (page, i) => {
    fire(page.el('part-list').kids[i].kids[1], 'click')
    await flush()
  }

  it('page: the search value and the Load more cursor go through encodeURIComponent as they are; a space is a value', async () => {
    for (const value of [' ', 'it\'s (a)! *~é', 'a+b=c/d?e#f', '%41']) {
      const page = await ready()
      await search(page, value)
      take(page, 'GET', `${LIST_FIRST}&q=${encodeURIComponent(value)}`)
    }
    const next = 'a b/é(*)\'!~+'
    const page = await ready([P(1, 'x', 'x')], next)
    await clickMore(page)
    take(page, 'GET', `${LIST_FIRST}&after=${encodeURIComponent(next)}`)
  })

  it('page: a Load more that gets an error status, no reply or a reply that is not JSON keeps the list and enables the button; a later success leaves #error alone', async () => {
    const cases = [[c => c.fail(), NO_REPLY], [c => c.reply(200, 'oops'), NO_REPLY], [c => c.reply(201, { parts: [], next: null }), FAILED], [c => c.reply(500, 'null'), FAILED], [c => c.reply(503, { error: 'busy' }), 'busy']]
    for (const [how, message] of cases) {
      const page = await ready([P(1, 'A', 'a')], 'A')
      await clickMore(page)
      assert.ok(moreOff(page), 'disabled while it loads')
      await settle(take(page, 'GET', `${LIST_FIRST}&after=A`), how)
      assert.deepEqual({ error: errorText(page), n: rows(page).length, more: moreOff(page) }, { error: message, n: 1, more: false }, message)
      await clickMore(page)
      await settle(take(page, 'GET', `${LIST_FIRST}&after=A`), okList([P(2, 'B', 'b')]))
      assert.deepEqual({ error: errorText(page), n: rows(page).length, more: moreOff(page) }, { error: message, n: 2, more: true })
    }
  })

  it('page: the list that comes back after an add or a delete starts from the start, with the search kept, and replaces everything Load more added', async () => {
    const page = await ready(SAMPLE, 'B-1')
    await clickMore(page)
    await settle(take(page, 'GET', `${LIST_FIRST}&after=B-1`), okList([P(9, 'C-1', 'c')]))
    assert.equal(rows(page).length, 3)
    await search(page, 'x')
    await settle(take(page, 'GET', `${LIST_FIRST}&q=x`), okList(SAMPLE))
    fill(page, FORM)
    await submit(page)
    await settle(take(page, 'POST', '/api/parts'), c => c.reply(201, P(7, 'N-1', 'New')))
    await settle(take(page, 'GET', `${LIST_FIRST}&q=x`), okList([P(7, 'N-1', 'New')]))
    assert.deepEqual(rows(page), [row(P(7, 'N-1', 'New'))])
    await clickDelete(page, 0)
    await settle(take(page, 'DELETE', '/api/parts/7'), c => c.reply(204))
    assert.deepEqual(pending(page), [`GET ${LIST_FIRST}&q=x`])
  })

  it('page: the list that comes back after an add, and the one at load, are list fetches too: a search started after them wins', async () => {
    const page = await ready()
    fill(page, FORM)
    await submit(page)
    await settle(take(page, 'POST', '/api/parts'), c => c.reply(201, P(7, 'N-1', 'New')))
    await search(page, 'q')
    await settle(take(page, 'GET', `${LIST_FIRST}&q=q`), okList([P(5, 'S', 's')]))
    await settle(take(page, 'GET', LIST_FIRST), okList([P(9, 'OLD', 'old')]))
    assert.deepEqual(rows(page), [row(P(5, 'S', 's'))])
    for (const late of [okList([P(9, 'OLD', 'old')]), c => c.reply(500, err('old')), c => c.fail()]) {
      const loading = await openPage()
      await search(loading, 'a')
      await settle(take(loading, 'GET', `${LIST_FIRST}&q=a`), okList([]))
      await settle(take(loading, 'GET', LIST_FIRST), late)
      assert.deepEqual({ rows: rows(loading), error: errorText(loading) }, { rows: NONE, error: '' })
    }
  })

  it('page: an add answered with any status but 201, or with a body that is not JSON, shows the message, keeps the fields and enables Add; the list is not fetched', async () => {
    const cases = [[c => c.reply(200, P(7, 'N-1', 'New')), FAILED], [c => c.reply(204), FAILED], [c => c.reply(500, 'Internal'), NO_REPLY], [c => c.reply(400, 'null'), FAILED], [c => c.reply(400, { error: 7 }), FAILED], [c => c.reply(422, { error: 'odd' }), 'odd']]
    for (const [how, message] of cases) {
      const page = await ready()
      fill(page, FORM)
      await submit(page)
      await settle(take(page, 'POST', '/api/parts'), how)
      assert.deepEqual({ error: errorText(page), add: isDisabled(page.el('add')), sku: valueIn(page.el('sku')), name: valueIn(page.el('name')), fetches: pending(page) }, { error: message, add: false, ...FORM, fetches: [] }, message)
    }
  })

  it('page: a delete answered with any status but 204 shows the message and the list is fetched again; the button is enabled again', async () => {
    const cases = [[c => c.reply(200, {}), FAILED], [c => c.reply(200, { error: 'odd' }), 'odd'], [c => c.reply(500, 'null'), FAILED], [c => c.reply(409, err('stock')), 'stock']]
    for (const [how, message] of cases) {
      const page = await ready()
      const button = page.el('part-list').kids[0].kids[1]
      await clickDelete(page, 0)
      await settle(take(page, 'DELETE', '/api/parts/3'), how)
      assert.deepEqual({ error: errorText(page), disabled: isDisabled(button), fetches: pending(page) }, { error: message, disabled: false, fetches: [`GET ${LIST_FIRST}`] }, message)
    }
  })
}
