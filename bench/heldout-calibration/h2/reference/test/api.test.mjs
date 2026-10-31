import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startApp, tempDataFile, withApp } from './helpers.mjs'

const widget = { sku: 'WIDGET-1', name: 'Widget', qty: 10 }

test('POST /items creates an item with nothing reserved', () => withApp(async call => {
  const r = await call('POST', '/items', widget)
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, { ...widget, reserved: 0 })
}))

test('POST /items refuses an existing sku with 409', () => withApp(async call => {
  await call('POST', '/items', widget)
  const r = await call('POST', '/items', { ...widget, name: 'Other' })
  assert.equal(r.status, 409)
  assert.equal(typeof r.body.error, 'string')
}))

test('POST /items refuses a bad sku, name or qty with 400', () => withApp(async call => {
  for (const bad of [{ sku: 'widget 1' }, { name: '' }, { qty: 0 }, { qty: 'many' }]) {
    const r = await call('POST', '/items', { ...widget, ...bad })
    assert.equal(r.status, 400, JSON.stringify(bad))
    assert.equal(typeof r.body.error, 'string')
  }
}))

test('GET /items lists items sorted by sku with the paging fields', () => withApp(async call => {
  for (const sku of ['C-1', 'A-1', 'B-1']) await call('POST', '/items', { sku, name: sku, qty: 1 })
  const r = await call('GET', '/items')
  assert.equal(r.status, 200)
  const { items, ...paging } = r.body
  assert.deepEqual(items.map(i => i.sku), ['A-1', 'B-1', 'C-1'])
  assert.deepEqual(paging, { page: 1, per_page: 20, total: 3 })
  assert.equal((await call('GET', '/items?per_page=500')).status, 400)
}))

test('GET /items/:sku returns the item, or 404', () => withApp(async call => {
  await call('POST', '/items', widget)
  assert.deepEqual((await call('GET', '/items/WIDGET-1')).body, { ...widget, reserved: 0 })
  const missing = await call('GET', '/items/NOPE')
  assert.equal(missing.status, 404)
  assert.deepEqual(missing.body, { error: 'not found' })
}))

test('POST /reservations reserves stock on the item', () => withApp(async call => {
  await call('POST', '/items', widget)
  const r = await call('POST', '/reservations', { sku: 'WIDGET-1', qty: 3 })
  assert.equal(r.status, 201)
  assert.deepEqual(r.body, { id: 1, sku: 'WIDGET-1', qty: 3 })
  assert.equal((await call('GET', '/items/WIDGET-1')).body.reserved, 3)
}))

test('POST /reservations: 404 for an unknown sku, 400 for a bad qty', () => withApp(async call => {
  await call('POST', '/items', widget)
  assert.equal((await call('POST', '/reservations', { sku: 'NOPE', qty: 1 })).status, 404)
  assert.equal((await call('POST', '/reservations', { sku: 'WIDGET-1', qty: -2 })).status, 400)
}))

test('POST /reservations refuses more than the free stock with 409', () => withApp(async call => {
  await call('POST', '/items', widget)
  assert.equal((await call('POST', '/reservations', { sku: 'WIDGET-1', qty: 6 })).status, 201)
  const r = await call('POST', '/reservations', { sku: 'WIDGET-1', qty: 5 })
  assert.equal(r.status, 409)
  assert.deepEqual(r.body, { error: 'insufficient stock' })
  assert.equal((await call('GET', '/items/WIDGET-1')).body.reserved, 6)
}))

test('GET /reservations lists reservations sorted by id', () => withApp(async call => {
  await call('POST', '/items', widget)
  for (const qty of [1, 2, 3]) await call('POST', '/reservations', { sku: 'WIDGET-1', qty })
  const r = await call('GET', '/reservations')
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.items.map(x => [x.id, x.qty]), [[1, 1], [2, 2], [3, 3]])
  assert.equal(r.body.total, 3)
}))

test('DELETE /reservations/:id frees the stock, then 404', () => withApp(async call => {
  await call('POST', '/items', widget)
  await call('POST', '/reservations', { sku: 'WIDGET-1', qty: 4 })
  const r = await call('DELETE', '/reservations/1')
  assert.equal(r.status, 204)
  assert.equal(r.text, '')
  assert.equal((await call('GET', '/items/WIDGET-1')).body.reserved, 0)
  assert.equal((await call('DELETE', '/reservations/1')).status, 404)
}))

test('bad JSON, a non-object body and unknown routes are refused', () => withApp(async call => {
  const bad = await call('POST', '/items', '{"sku": ')
  assert.equal(bad.status, 400)
  assert.deepEqual(bad.body, { error: 'invalid JSON' })
  assert.equal((await call('POST', '/items', '[1, 2]')).status, 400)
  assert.equal((await call('GET', '/nothing-here')).status, 404)
}))

test('a body over 10 KB is refused with 413', () => withApp(async call => {
  const r = await call('POST', '/items', { ...widget, name: 'x'.repeat(11 * 1024) })
  assert.equal(r.status, 413)
  assert.equal((await call('GET', '/items')).body.total, 0)
}))

test('data survives a restart on the same data file', async t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const first = await startApp(data.file)
  await first.call('POST', '/items', widget)
  await first.call('POST', '/reservations', { sku: 'WIDGET-1', qty: 2 })
  await first.stop()
  const second = await startApp(data.file)
  t.after(second.stop)
  assert.equal((await second.call('GET', '/items/WIDGET-1')).body.reserved, 2)
  const next = await second.call('POST', '/reservations', { sku: 'WIDGET-1', qty: 1 })
  assert.equal(next.body.id, 2)
})

test('a failed save answers 500 and logs one line, not a stack', async t => {
  const data = tempDataFile()
  const app = await startApp(data.file)
  t.after(app.stop)
  data.cleanup() // the folder is gone, so the save fails with ENOENT
  const logged = t.mock.method(console, 'error', () => {})
  const r = await app.call('POST', '/items', widget)
  assert.equal(r.status, 500)
  assert.deepEqual(r.body, { error: 'internal error' })
  assert.deepEqual(logged.mock.calls.map(c => c.arguments), [[`ENOENT open ${data.file}.${process.pid}.tmp`]])
})

// Runs server.mjs on dataFile until it exits; one that starts instead is killed after 5 s.
function runServer(dataFile) {
  const server = fileURLToPath(new URL('../server.mjs', import.meta.url))
  const env = { ...process.env, PORT: '0', DATA_FILE: dataFile }
  return spawnSync(process.execPath, [server], { env, encoding: 'utf8', timeout: 5000 })
}

test('the server will not start on a DATA_FILE in a missing folder, or on a folder', t => {
  const data = tempDataFile()
  t.after(data.cleanup)
  const folder = dirname(data.file)
  const missing = join(folder, 'missing', 'stock.json')
  for (const [file, line] of [
    [missing, `cannot start: folder for DATA_FILE ${missing} does not exist`],
    [folder, `cannot start: DATA_FILE ${folder} is a folder, not a file`],
  ]) {
    const r = runServer(file)
    assert.equal(r.status, 1, file)
    assert.equal(r.stdout, '')
    assert.equal(r.stderr, `${line}\n`)
  }
})

test('a fractional qty is refused on both POST /items and POST /reservations', () => withApp(async call => {
  assert.equal((await call('POST', '/items', { ...widget, qty: 2.5 })).status, 400)
  await call('POST', '/items', widget)
  const r = await call('POST', '/reservations', { sku: 'WIDGET-1', qty: 2.5 })
  assert.equal(r.status, 400)
  assert.equal((await call('GET', '/items/WIDGET-1')).body.reserved, 0)
  assert.equal((await call('POST', '/reservations', { sku: 'WIDGET-1', qty: 3 })).status, 201)
}))

test('per_page gives full pages on both list routes', () => withApp(async call => {
  for (let i = 1; i <= 25; i++) await call('POST', '/items', { sku: `S-${String(i).padStart(2, '0')}`, name: 'n', qty: 20 })
  for (let i = 0; i < 12; i++) await call('POST', '/reservations', { sku: 'S-01', qty: 1 })
  const sizes = path => Promise.all([1, 2, 3].map(async p => (await call('GET', `${path}&page=${p}`)).body.items.length))
  assert.deepEqual(await sizes('/items?per_page=10'), [10, 10, 5])
  assert.deepEqual(await sizes('/reservations?per_page=5'), [5, 5, 2])
}))

test('GET /items/export.csv returns every item sorted by sku as CSV', () => withApp(async call => {
  await call('POST', '/items', { sku: 'NUT-2', name: 'Nut', qty: 7 })
  await call('POST', '/items', { sku: 'BOLT-1', name: 'Bolt, "hex" 5mm', qty: 40 })
  await call('POST', '/reservations', { sku: 'NUT-2', qty: 4 })
  const r = await call('GET', '/items/export.csv')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'text/csv')
  assert.equal(r.text, 'sku,name,qty,reserved\r\nBOLT-1,"Bolt, ""hex"" 5mm",40,0\r\nNUT-2,Nut,7,4\r\n')
}))

test('GET /items/export.csv is not paged and is the header alone for an empty store', () => withApp(async call => {
  assert.equal((await call('GET', '/items/export.csv')).text, 'sku,name,qty,reserved\r\n')
  for (let i = 1; i <= 25; i++) await call('POST', '/items', { sku: `S-${i}`, name: 'n', qty: 1 })
  assert.equal((await call('GET', '/items/export.csv')).text.split('\r\n').length, 27)
}))
