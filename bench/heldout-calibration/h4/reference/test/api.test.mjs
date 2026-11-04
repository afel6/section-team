// The API, run in this process (startApp) on a data file in a fresh temp folder per test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { booking, startApp, tempDir, withApp } from './helpers.mjs'

const JSON_TYPE = 'application/json; charset=utf-8'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function created(app, fields) {
  const r = await app.post(booking(fields))
  assert.equal(r.status, 201, r.text)
  return r.json()
}

function assertError(r, status, error) {
  assert.equal(r.status, status, r.text)
  assert.equal(r.headers['content-type'], JSON_TYPE)
  assert.deepEqual(r.json(), { error })
}

test('GET /api/rooms lists the rooms in order', () => withApp(async app => {
  const r = await app.call('GET', '/api/rooms?x=1')
  assert.equal(r.status, 200)
  assert.equal(r.headers['content-type'], JSON_TYPE)
  assert.deepEqual(r.json(), { rooms: ['Aurora', 'Borealis', 'Cosmos'] })
}))

test('POST creates bookings with ids 1, 2, ... and a trimmed title; other keys are ignored', () => withApp(async app => {
  const first = await app.post({ ...booking({ title: '  Standup \n' }), id: 99, extra: true })
  assert.equal(first.status, 201)
  assert.equal(first.headers['content-type'], JSON_TYPE)
  assert.deepEqual(first.json(), { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' })
  assert.equal((await created(app, { room: 'Cosmos' })).id, 2)
}))

test('GET /api/bookings sorts by date, start, then room order, and filters by ?date', () => withApp(async app => {
  await created(app, { room: 'Cosmos', start: '09:00', end: '10:00' })
  await created(app, { room: 'Aurora', start: '10:00', end: '11:00' })
  await created(app, { room: 'Borealis', start: '09:00', end: '10:00' })
  await created(app, { room: 'Aurora', date: '2026-11-02', start: '15:00', end: '16:00' })
  const all = (await app.call('GET', '/api/bookings')).json().bookings
  assert.deepEqual(all.map(b => b.id), [4, 3, 1, 2])
  const day = (await app.call('GET', '/api/bookings?date=2026-11-03&date=nope&x=1')).json().bookings
  assert.deepEqual(day.map(b => b.id), [3, 1, 2])
  assert.deepEqual((await app.call('GET', '/api/bookings?date=2026-11-05')).json(), { bookings: [] })
  assert.deepEqual((await app.call('GET', '/api/bookings?other=1')).json().bookings.length, 4)
}))

test('GET /api/bookings with an invalid or empty date → 400', () => withApp(async app => {
  for (const q of ['?date', '?date=', '?date=2026-02-30', '?date=2026-11-3', '?date=%202026-11-03', '?x=1&date=bad']) {
    assertError(await app.call('GET', `/api/bookings${q}`), 400, 'date must be a valid YYYY-MM-DD date')
  }
  const ok = await app.call('GET', '/api/bookings?date=2026%2D11%2D03')
  assert.equal(ok.status, 200, 'the query is percent-decoded')
}))

test('booking rules 1-3: content type, size and JSON object', () => withApp(async app => {
  const post = (body, headers = JSON_HEADERS) => app.call('POST', '/api/bookings', { headers, body })
  const valid = JSON.stringify(booking())
  assertError(await post(valid, {}), 415, 'content type must be application/json')
  assertError(await post(valid, { 'Content-Type': 'text/plain' }), 415, 'content type must be application/json')
  assertError(await post(valid, { 'Content-Type': 'application/jsonx' }), 415, 'content type must be application/json')
  assertError(await post('x'.repeat(10001), { 'Content-Type': 'text/plain' }), 415, 'content type must be application/json')
  assertError(await post('x'.repeat(10001)), 413, 'body too large')
  for (const body of ['', 'nope', 'null', '[]', '"s"', '3', 'true', `﻿${valid}`]) {
    assertError(await post(body), 400, 'body must be a JSON object')
  }
  const padded = valid.padEnd(10000, ' ')
  assert.equal((await post(padded, { 'Content-Type': ' \tAPPLICATION/Json\t ; charset=utf-8' })).status, 201)
}))

test('rules 4-9 reply 400 with the first failing rule; invalid UTF-8 alone is no error', () => withApp(async app => {
  assertError(await app.post(booking({ room: 'cosmos', title: '' })), 400, 'room must be one of Aurora, Borealis, Cosmos')
  assertError(await app.post(booking({ title: ' '.repeat(5), date: 'x' })), 400, 'title must be 1 to 80 characters')
  assertError(await app.post(booking({ title: 'y'.repeat(81) })), 400, 'title must be 1 to 80 characters')
  assert.equal((await created(app, { room: 'Cosmos', title: ` ${'y'.repeat(80)} ` })).title, 'y'.repeat(80))
  assertError(await app.post(booking({ date: '2026-11-31', start: 'x' })), 400, 'date must be a valid YYYY-MM-DD date')
  assertError(await app.post(booking({ start: '9:00', end: 'x' })), 400, 'start must be HH:MM')
  assertError(await app.post(booking({ end: '24:00' })), 400, 'end must be HH:MM')
  assertError(await app.post(booking({ start: '10:00', end: '10:00' })), 400, 'end must be after start')
  const bytes = Buffer.concat([Buffer.from('{"room":"Aurora","title":"x'), Buffer.from([0xff]), Buffer.from('","date":"2026-11-03","start":"09:00","end":"10:00"}')])
  const r = await app.call('POST', '/api/bookings', { headers: JSON_HEADERS, body: bytes })
  assert.equal(r.status, 201)
  assert.equal(r.json().title, 'x�')
}))

test('rule 10: overlaps → 409 naming the earliest overlapping booking; touching is fine', () => withApp(async app => {
  await created(app, { start: '10:00', end: '11:00' })
  await created(app, { start: '09:00', end: '10:00' })
  await created(app, { start: '11:00', end: '12:00' })
  assertError(await app.post(booking({ start: '09:30', end: '11:30' })), 409, 'room is already booked from 09:00 to 10:00')
  assertError(await app.post(booking({ start: '10:30', end: '10:45' })), 409, 'room is already booked from 10:00 to 11:00')
  assert.equal((await created(app, { start: '12:00', end: '13:00' })).id, 4)
  assert.equal((await created(app, { room: 'Borealis', start: '09:30', end: '11:30' })).id, 5)
  assert.equal((await created(app, { date: '2026-11-04', start: '09:30', end: '11:30' })).id, 6)
}))

test('DELETE /api/bookings/<id> → 204 and the booking is gone; ids are never reused', () => withApp(async app => {
  await created(app, {})
  await created(app, { start: '10:00', end: '11:00' })
  const r = await app.call('DELETE', '/api/bookings/2')
  assert.equal(r.status, 204)
  assert.equal(r.text, '')
  assert.equal(r.headers['content-type'], undefined)
  assertError(await app.call('DELETE', '/api/bookings/2'), 404, 'booking not found')
  assert.equal((await created(app, { start: '10:00', end: '11:00' })).id, 3)
}))

test('DELETE with an id that is not a positive integer without a leading zero → 404', () => withApp(async app => {
  await created(app, {})
  for (const id of ['01', '0', '-1', '+1', '1.0', '1e0', '0x1', 'abc', '%31', '1%20', '99']) {
    assertError(await app.call('DELETE', `/api/bookings/${id}`), 404, 'booking not found')
  }
  assert.equal((await app.call('GET', '/api/bookings')).json().bookings.length, 1)
}))

test('paths compare byte for byte; unknown paths → 404, known paths with another method → 405', () => withApp(async app => {
  for (const path of ['/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/', '/api/rooms/', '/index.html', '/api', '/app.js/']) {
    for (const method of ['GET', 'POST', 'DELETE']) assertError(await app.call(method, path), 404, 'not found')
  }
  const cases = [['POST', '/api/rooms'], ['DELETE', '/api/bookings'], ['PUT', '/api/bookings'], ['GET', '/api/bookings/abc'],
    ['POST', '/api/bookings/1'], ['POST', '/'], ['DELETE', '/app.js'], ['OPTIONS', '/api/rooms']]
  for (const [method, path] of cases) assertError(await app.call(method, path), 405, 'method not allowed')
  assert.equal((await app.call('HEAD', '/')).status, 405)
}))

test('GET / and GET /app.js serve the page and its script', () => withApp(async app => {
  const page = await app.call('GET', '/?x=1')
  assert.equal(page.status, 200)
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8')
  assert.match(page.text, /<script src="\/app\.js"><\/script>/)
  const script = await app.call('GET', '/app.js')
  assert.equal(script.status, 200)
  assert.equal(script.headers['content-type'], 'text/javascript; charset=utf-8')
  assert.match(script.text, /getElementById/)
}))

test('a failed save replies 500 and changes nothing, the next id included', async () => {
  const { dir, cleanup } = tempDir()
  const app = await startApp(join(dir, 'later', 'bookings.json'))
  try {
    assertError(await app.post(booking()), 500, 'internal error')
    assert.deepEqual((await app.call('GET', '/api/bookings')).json(), { bookings: [] })
    mkdirSync(join(dir, 'later'))
    assert.equal((await created(app, {})).id, 1)
    rmSync(join(dir, 'later'), { recursive: true })
    assertError(await app.call('DELETE', '/api/bookings/1'), 500, 'internal error')
    assert.equal((await app.call('GET', '/api/bookings')).json().bookings.length, 1, 'the booking is kept')
  } finally {
    await app.stop()
    cleanup()
  }
})

test('the file is written only by a created or deleted booking, and survives a restart', async () => {
  const { dir, cleanup } = tempDir()
  const file = join(dir, 'bookings.json')
  let app
  try {
    app = await startApp(file)
    await app.call('GET', '/api/bookings')
    await app.post(booking({ room: 'Mars' }))
    await app.call('DELETE', '/api/bookings/1')
    assert.equal(existsSync(file), false, 'no write without a change')
    await created(app, {})
    await created(app, { start: '10:00', end: '11:00' })
    await app.call('DELETE', '/api/bookings/2')
    const saved = readFileSync(file, 'utf8')
    await app.stop()
    app = await startApp(file)
    assert.deepEqual((await app.call('GET', '/api/bookings')).json().bookings.map(b => b.id), [1])
    assert.equal((await created(app, { start: '10:00', end: '11:00' })).id, 3)
    assert.notEqual(readFileSync(file, 'utf8'), saved)
  } finally {
    await app?.stop()
    cleanup()
  }
})

test('concurrent overlapping bookings: exactly one is created, the others get 409, no id is given twice', () => withApp(async app => {
  const clash = await Promise.all(Array.from({ length: 12 }, (_, i) => app.post(booking({ title: `t${i}` }))))
  assert.deepEqual(clash.map(r => r.status).toSorted(), [201, ...Array(11).fill(409)])
  const free = await Promise.all(Array.from({ length: 12 }, (_, i) => app.post(booking({ room: 'Cosmos', start: `${String(i + 10)}:00`, end: `${String(i + 10)}:30` }))))
  const ids = free.map(r => r.json().id)
  assert.deepEqual(ids.toSorted((a, b) => a - b), Array.from({ length: 12 }, (_, i) => i + 2))
}))

test('a large body on a route that ignores it is read and the reply arrives', () => withApp(async app => {
  const r = await app.call('GET', '/api/rooms', { body: 'x'.repeat(200000) })
  assert.equal(r.status, 200)
  assertError(await app.call('DELETE', '/nope', { body: 'x'.repeat(200000) }), 404, 'not found')
  const big = await app.call('POST', '/api/bookings', { headers: { 'Content-Type': 'text/plain' }, body: 'x'.repeat(200000) })
  assertError(big, 415, 'content type must be application/json')
}))

test('the size limit counts the bytes received, chunked bodies included', () => withApp(async app => {
  const chunked = { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' }
  const fits = JSON.stringify(booking()).padEnd(10000, ' ')
  assert.equal((await app.call('POST', '/api/bookings', { headers: chunked, body: fits })).status, 201)
  assertError(await app.call('POST', '/api/bookings', { headers: chunked, body: `${fits} ` }), 413, 'body too large')
  const multibyte = `{"room":"Cosmos","title":"${'é'.repeat(4990)}"}`
  assert.ok(multibyte.length <= 10000 && Buffer.byteLength(multibyte) > 10000)
  assertError(await app.call('POST', '/api/bookings', { headers: chunked, body: multibyte }), 413, 'body too large')
}))
