// Hidden tests for H2: the stock-keeping service in bench/seeds/h2, two shared-function bugs and a CSV export.
// Every test starts its own server on a fresh DATA_FILE, so a failure never cascades into the next test.
// The seed-regression tests at the end check seed behaviour through HTTP only, independent of the seed's own
// tests, so a run that "fixes" the task by editing or deleting those tests still has to keep the service working.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'

const TARGET = process.env.TARGET_DIR
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const CRLF = CR + LF
const HEADER = 'sku,name,qty,reserved'
const ITEM_KEYS = ['sku', 'name', 'qty', 'reserved']
const csvBody = lines => lines.map(l => l + CRLF).join('')

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

function waitForListening(child) {
  let out = ''
  let err = ''
  return new Promise((resolve, reject) => {
    // 10 s, not 20 s: every test starts its own server, and 17 starts must stay under the scorer's 300 s limit.
    const timer = setTimeout(() => reject(new Error(`server did not print "listening on" within 10 s. stdout: ${out.slice(0, 500)} stderr: ${err.slice(0, 500)}`)), 10000)
    child.stderr.on('data', d => { err += d })
    child.stdout.on('data', d => {
      out += d
      if (/listening on/i.test(out)) { clearTimeout(timer); resolve() }
    })
    child.once('error', e => { clearTimeout(timer); reject(new Error(`could not start the server: ${e.message}`)) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited early (${code}). stderr: ${err.slice(0, 800)}`)) })
  })
}

async function stopServer(s) {
  const { child } = s
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
  if (process.platform === 'win32') {
    // taskkill fails when the process exited between the check above and this call; `exited` still settles.
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  } else {
    child.kill('SIGKILL')
  }
  try { await exited } catch (e) { throw new Error(`server pid ${child.pid} did not stop within 5 s`, { cause: e }) }
}

async function startServer(dataFile) {
  if (!TARGET) throw new Error('TARGET_DIR is not set')
  const port = await freePort()
  const child = spawn(process.execPath, [join(TARGET, 'server.mjs')], {
    cwd: TARGET,
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const s = { port, child, base: `http://127.0.0.1:${port}` }
  try {
    await waitForListening(child)
  } catch (e) {
    await stopServer(s).catch(stopErr => { throw new AggregateError([e, stopErr], e.message) })
    throw e
  }
  return s
}

let root
before(() => { root = mkdtempSync(join(tmpdir(), 'h2-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })

async function withServer(name, fn) {
  const s = await startServer(join(root, `${name}.json`))
  try { return await fn(s) } finally { await stopServer(s) }
}

// Reads the body as bytes and decodes it without dropping a BOM, so a CSV that starts with one fails the exact-body checks.
async function call(s, method, path, body) {
  const signal = AbortSignal.timeout(10000)
  const init = body === undefined
    ? { method, signal }
    : { method, signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
  const r = await fetch(s.base + path, init)
  const text = Buffer.from(await r.arrayBuffer()).toString('utf8')
  const json = () => {
    try { return JSON.parse(text) } catch { throw new Error(`${method} ${path}: body is not JSON: ${text.slice(0, 200)}`) }
  }
  return { status: r.status, type: r.headers.get('content-type'), text, json }
}

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k]]))
const reserve = (s, sku, qty) => call(s, 'POST', '/reservations', { sku, qty })

async function addItem(s, sku, name, qty) {
  const r = await call(s, 'POST', '/items', { sku, name, qty })
  assert.equal(r.status, 201, `POST /items ${sku}: ${r.text.slice(0, 200)}`)
  return r.json()
}

async function getJson(s, path) {
  const r = await call(s, 'GET', path)
  assert.equal(r.status, 200, `GET ${path}: ${r.text.slice(0, 200)}`)
  return r.json()
}

const getItem = (s, sku) => getJson(s, `/items/${sku}`)

async function reserveOk(s, sku, qty) {
  const r = await reserve(s, sku, qty)
  assert.equal(r.status, 201, `POST /reservations ${sku} ${qty}: ${r.text.slice(0, 200)}`)
  return r.json()
}

// --- Bug 1: parseQuantity truncates fractions, and both POST routes share it ---

test('POST /reservations with qty 2.5 → 400, and nothing is reserved', () => withServer('qty-res', async s => {
  await addItem(s, 'WIDGET-1', 'Widget', 10)
  assert.equal((await reserve(s, 'WIDGET-1', 2.5)).status, 400)
  assert.equal((await getItem(s, 'WIDGET-1')).reserved, 0)
  assert.equal((await getJson(s, '/reservations')).total, 0)
}))

test('POST /items with qty 2.5 → 400 too (shared validator), and no item is created', () => withServer('qty-items', async s => {
  const r = await call(s, 'POST', '/items', { sku: 'GADGET-1', name: 'Gadget', qty: 2.5 })
  assert.equal(r.status, 400)
  assert.equal((await call(s, 'GET', '/items/GADGET-1')).status, 404)
}))

test('qty sent as the string "2.5" → 400 on both routes', () => withServer('qty-string', async s => {
  await addItem(s, 'WIDGET-1', 'Widget', 10)
  assert.equal((await reserve(s, 'WIDGET-1', '2.5')).status, 400, 'POST /reservations')
  assert.equal((await getItem(s, 'WIDGET-1')).reserved, 0)
  assert.equal((await call(s, 'POST', '/items', { sku: 'GADGET-1', name: 'Gadget', qty: '2.5' })).status, 400, 'POST /items')
}))

test('whole quantities still work: qty 3 → 201 on both routes', () => withServer('qty-whole', async s => {
  const created = await call(s, 'POST', '/items', { sku: 'WIDGET-1', name: 'Widget', qty: 3 })
  assert.equal(created.status, 201)
  assert.deepEqual(pick(created.json(), ITEM_KEYS), { sku: 'WIDGET-1', name: 'Widget', qty: 3, reserved: 0 })
  const r = await reserve(s, 'WIDGET-1', 3)
  assert.equal(r.status, 201)
  const res = r.json()
  assert.deepEqual(pick(res, ['sku', 'qty']), { sku: 'WIDGET-1', qty: 3 })
  assert.notEqual(res.id ?? null, null, 'reservation has an id')
  assert.equal((await getItem(s, 'WIDGET-1')).reserved, 3)
}))

test('quantities below 1 are still rejected on both routes', () => withServer('qty-low', async s => {
  await addItem(s, 'WIDGET-1', 'Widget', 10)
  for (const qty of [0, -1]) {
    assert.equal((await reserve(s, 'WIDGET-1', qty)).status, 400, `POST /reservations qty ${qty}`)
    assert.equal((await call(s, 'POST', '/items', { sku: 'GADGET-1', name: 'Gadget', qty })).status, 400, `POST /items qty ${qty}`)
  }
  assert.equal((await getItem(s, 'WIDGET-1')).reserved, 0)
}))

// --- Bug 2: paginate returns one item too few, and both list routes share it ---

test('GET /items?per_page=10 pages 25 items as 10, 10 and 5; the default page holds 20', () => withServer('page-items', async s => {
  const skus = Array.from({ length: 25 }, (_, i) => `SKU-${String(i + 1).padStart(2, '0')}`)
  for (const sku of [...skus].reverse()) await addItem(s, sku, `Item ${sku}`, 1)
  const urls = ['/items?per_page=10', '/items?page=2&per_page=10', '/items?page=3&per_page=10']
  const pages = await Promise.all(urls.map(u => getJson(s, u)))
  assert.deepEqual(pages.map(p => p.items.length), [10, 10, 5])
  assert.deepEqual(pages.flatMap(p => p.items.map(i => i.sku)), skus, 'pages hold every item once, sorted by sku')
  assert.deepEqual(pages.map(p => [p.page, p.per_page, p.total]), [[1, 10, 25], [2, 10, 25], [3, 10, 25]])
  const first = await getJson(s, '/items')
  assert.deepEqual(first.items.map(i => i.sku), skus.slice(0, 20))
  assert.deepEqual([first.page, first.per_page, first.total], [1, 20, 25])
}))

test('GET /reservations?per_page=5 pages 12 reservations as 5, 5 and 2 (shared pager)', () => withServer('page-res', async s => {
  await addItem(s, 'WIDGET-1', 'Widget', 100)
  const ids = []
  for (let i = 0; i < 12; i++) ids.push((await reserveOk(s, 'WIDGET-1', 1)).id)
  const urls = ['/reservations?per_page=5', '/reservations?page=2&per_page=5', '/reservations?page=3&per_page=5']
  const pages = await Promise.all(urls.map(u => getJson(s, u)))
  assert.deepEqual(pages.map(p => p.items.length), [5, 5, 2])
  assert.deepEqual(pages.flatMap(p => p.items.map(r => r.id)), ids, 'pages hold every reservation once, sorted by id')
  assert.deepEqual(pages.map(p => [p.page, p.per_page, p.total]), [[1, 5, 12], [2, 5, 12], [3, 5, 12]])
}))

// --- Feature: GET /items/export.csv ---

async function addCsvItems(s) {
  await addItem(s, 'RULER-12', 'Ruler 12"', 3)
  await addItem(s, 'BOLT-5', 'Bolt, "hex" 5mm', 40)
  await addItem(s, 'NUT-5', 'Nut M5', 100)
  await reserveOk(s, 'NUT-5', 7)
}

test('GET /items/export.csv → 200 with Content-Type exactly text/csv (not caught by /items/:sku)', () => withServer('csv-head', async s => {
  await addCsvItems(s)
  const r = await call(s, 'GET', '/items/export.csv')
  assert.equal(r.status, 200, r.text.slice(0, 200))
  assert.equal(r.type, 'text/csv')
}))

test('CSV body: header, items sorted by sku, quotes wrapped and doubled, CRLF after every line', () => withServer('csv-body', async s => {
  await addCsvItems(s)
  const r = await call(s, 'GET', '/items/export.csv')
  assert.equal(r.status, 200)
  const lines = [HEADER, 'BOLT-5,"Bolt, ""hex"" 5mm",40,0', 'NUT-5,Nut M5,100,7', 'RULER-12,"Ruler 12""",3,0']
  assert.equal(r.text, csvBody(lines))
}))

test('CSV wraps a field that holds a CR or an LF in double quotes', () => withServer('csv-crlf', async s => {
  await addItem(s, 'LF-1', `Line${LF}Feed`, 1)
  await addItem(s, 'CR-1', `Carriage${CR}Return`, 2)
  const r = await call(s, 'GET', '/items/export.csv')
  assert.equal(r.status, 200)
  const lines = [HEADER, `CR-1,"Carriage${CR}Return",2,0`, `LF-1,"Line${LF}Feed",1,0`]
  assert.equal(r.text, csvBody(lines))
}))

test('CSV of an empty store is exactly the header line', () => withServer('csv-empty', async s => {
  const r = await call(s, 'GET', '/items/export.csv')
  assert.equal(r.status, 200)
  assert.equal(r.text, HEADER + CRLF)
}))

// 105 items: more than the default page (20) and the largest page (100), so an export built on the pager fails.
test('CSV holds every item, not one page: 105 items → the header and 105 lines sorted by sku', () => withServer('csv-all', async s => {
  const skus = Array.from({ length: 105 }, (_, i) => `SKU-${String(i + 1).padStart(3, '0')}`)
  // 37 is coprime with 105: every item is added once, in an order that is neither sorted nor reverse-sorted.
  for (let i = 0; i < skus.length; i++) {
    const at = (i * 37) % skus.length
    await addItem(s, skus[at], `Item ${skus[at]}`, at + 1)
  }
  const r = await call(s, 'GET', '/items/export.csv')
  assert.equal(r.status, 200)
  assert.equal(r.text.split(LF).length - 2, 105, 'item lines in the export')
  const lines = [HEADER, ...skus.map((sku, i) => `${sku},Item ${sku},${i + 1},0`)]
  assert.equal(r.text, csvBody(lines))
}))

// --- Seed regression, through HTTP only (independent of the seed's own tests) ---

test('GET /items/:sku still answers next to the export route', () => withServer('seed-get', async s => {
  await addItem(s, 'BOLT-5', 'Bolt', 40)
  assert.deepEqual(pick(await getItem(s, 'BOLT-5'), ITEM_KEYS), { sku: 'BOLT-5', name: 'Bolt', qty: 40, reserved: 0 })
  const miss = await call(s, 'GET', '/items/NOPE-1')
  assert.equal(miss.status, 404)
  assert.deepEqual(miss.json(), { error: 'not found' })
}))

test('duplicate sku → 409, and the first item is kept', () => withServer('seed-dup', async s => {
  await addItem(s, 'WIDGET-1', 'Widget', 10)
  const dup = await call(s, 'POST', '/items', { sku: 'WIDGET-1', name: 'Other', qty: 99 })
  assert.equal(dup.status, 409)
  assert.deepEqual(pick(await getItem(s, 'WIDGET-1'), ITEM_KEYS), { sku: 'WIDGET-1', name: 'Widget', qty: 10, reserved: 0 })
}))

test('reservations: unknown sku → 404, over the free stock → 409 insufficient stock, an exact fit → 201', () => withServer('seed-over', async s => {
  await addItem(s, 'WIDGET-1', 'Widget', 5)
  assert.equal((await reserve(s, 'NOPE-1', 1)).status, 404)
  await reserveOk(s, 'WIDGET-1', 3)
  const over = await reserve(s, 'WIDGET-1', 3)
  assert.equal(over.status, 409)
  assert.deepEqual(over.json(), { error: 'insufficient stock' })
  assert.equal((await getItem(s, 'WIDGET-1')).reserved, 3)
  await reserveOk(s, 'WIDGET-1', 2)
  assert.equal((await getItem(s, 'WIDGET-1')).reserved, 5)
}))

test('DELETE /reservations/:id → 204 and frees the stock', () => withServer('seed-delete', async s => {
  await addItem(s, 'WIDGET-1', 'Widget', 5)
  const { id } = await reserveOk(s, 'WIDGET-1', 5)
  assert.equal((await reserve(s, 'WIDGET-1', 1)).status, 409)
  const del = await call(s, 'DELETE', `/reservations/${id}`)
  assert.equal(del.status, 204)
  assert.equal(del.text, '')
  assert.equal((await getItem(s, 'WIDGET-1')).reserved, 0)
  assert.equal((await getJson(s, '/reservations')).total, 0)
  await reserveOk(s, 'WIDGET-1', 5)
}))

test('data survives a restart on the same DATA_FILE', async () => {
  const file = join(root, 'seed-restart.json')
  const first = await startServer(file)
  let id
  try {
    await addItem(first, 'WIDGET-1', 'Widget', 10)
    id = (await reserveOk(first, 'WIDGET-1', 4)).id
  } finally {
    await stopServer(first)
  }
  const second = await startServer(file)
  try {
    assert.deepEqual(pick(await getItem(second, 'WIDGET-1'), ITEM_KEYS), { sku: 'WIDGET-1', name: 'Widget', qty: 10, reserved: 4 })
    const list = await getJson(second, '/reservations')
    assert.deepEqual(list.items.map(r => pick(r, ['id', 'sku', 'qty'])), [{ id, sku: 'WIDGET-1', qty: 4 }])
    assert.notEqual((await reserveOk(second, 'WIDGET-1', 1)).id, id, 'reservation ids are not reused after a restart')
  } finally {
    await stopServer(second)
  }
})
