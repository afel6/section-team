// Hidden tests for the pilot's L1 probe h5p: the expense service in bench/seeds/h5 with only h5's first user problem,
// amounts truncated to cents. These are h5's two bug 1 tests with the helpers above them, unchanged from
// bench/hidden/h5.test.mjs; h5's bug 2, old-store and import tests are left out. Each test starts its own server on a
// fresh DATA_FILE; HTTP only.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'

const TARGET = process.env.TARGET_DIR
const target = () => { assert.ok(TARGET, 'TARGET_DIR is not set'); return TARGET }
const TRIP = { id: 'trip', name: 'Ski trip', members: ['Ann', 'Ben', 'Cara'] }
const ALL = TRIP.members
const AMOUNT_ERROR = 'amount must be a number from 0.01 to 1000000 with at most 2 decimals'
const MAX_BODY = 10 * 1024
const SEED_DIR = fileURLToPath(new URL('../seeds/h5/', import.meta.url))
const RULES = ['not-an-object', 'bad-type', 'unknown-field', 'bad-description', 'bad-payer', 'bad-amount', 'bad-split',
  'duplicate', 'already-recorded', 'bad-from', 'bad-to']

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

// Resolves once the server prints "listening on"; 8 s each keeps ~23 starts inside the scorer's time limit.
const waitForListening = child => new Promise((resolve, reject) => {
  let [out, err] = ['', '']
  const fail = msg => { clearTimeout(timer); reject(new Error(`${msg}. stdout: ${out.slice(0, 500)} stderr: ${err.slice(0, 800)}`)) }
  const timer = setTimeout(() => fail('server did not print "listening on" within 8 s'), 8000)
  child.stderr.on('data', d => { err += d })
  child.stdout.on('data', d => { out += d; if (/listening on/i.test(out)) { clearTimeout(timer); resolve() } })
  child.once('error', e => fail(`could not start the server: ${e.message}`))
  child.once('exit', code => fail(`server exited early (${code})`))
})

async function stopServer({ child }) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) })
  child.kill('SIGKILL') // not taskkill: in a stripped environment (env -i) it can take seconds per call; the server has no child processes
  try { await exited } catch (e) { throw new Error(`server pid ${child.pid} did not stop within 5 s`, { cause: e }) }
}

async function startServer(file) {
  const port = await freePort()
  const env = { ...process.env, PORT: String(port), DATA_FILE: file }
  const child = spawn(process.execPath, [join(target(), 'server.mjs')], { cwd: TARGET, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const s = { child, file, base: `http://127.0.0.1:${port}` }
  try { await waitForListening(child) } catch (e) { await stopServer(s).catch(stopErr => { throw new AggregateError([e, stopErr], e.message) }); throw e }
  return s
}

let root
before(() => { root = mkdtempSync(join(tmpdir(), 'h5-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) })

// Runs fn with a server on its own data file; `store` (seed format) is written to that file first.
async function withServer(name, fn, store) {
  const file = join(root, `${name}.json`)
  if (store) writeFileSync(file, JSON.stringify(store, null, 2) + '\n')
  const s = await startServer(file)
  try { return await fn(s) } finally { await stopServer(s) }
}
const withTrip = (name, fn) => withServer(name, async s => { await ok(s, 'POST', '/groups', TRIP); return fn(s) })

// A string body is sent as is (raw JSON text); anything else as JSON. Returns { status, body }.
async function call(s, method, path, body) {
  const init = { method, signal: AbortSignal.timeout(10000) }
  if (body !== undefined) Object.assign(init, { headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  const r = await fetch(s.base + path, init)
  const text = await r.text()
  try { return { status: r.status, body: JSON.parse(text) } } catch { return { status: r.status, body: `not JSON: ${text.slice(0, 200)}` } }
}
async function ok(s, method, path, body, status = 201) {
  const r = await call(s, method, path, body)
  assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(r.body).slice(0, 300)}`)
  return r.body
}
const getJson = (s, path) => ok(s, 'GET', path, undefined, 200)
const addExpense = (s, body, id = 'trip') => ok(s, 'POST', `/groups/${id}/expenses`, body)
const addPayment = (s, body, id = 'trip') => ok(s, 'POST', `/groups/${id}/payments`, body)
const importTo = (s, body, id = 'trip') => call(s, 'POST', `/groups/${id}/import`, body)
const exp = (description, payer, amount, extra = {}) => ({ type: 'expense', description, payer, amount, ...extra })
const pay = (from, to, amount, extra = {}) => ({ type: 'payment', from, to, amount, ...extra })
const view = (id, description, payer, amount, split, shares) => ({ id, description, payer, amount, split, shares })
const rejected = pairs => ({ status: 422, body: { error: 'import rejected', problems: pairs.map(([index, rule]) => ({ index, rule })) } })
const each = (indexes, rule) => indexes.map(i => [i, rule])
const err400 = error => ({ status: 400, body: { error } })
const NOT_FOUND = { status: 404, body: { error: 'not found' } }
const TAXI = exp('Taxi', 'Ann', 10)
const TAXI_VIEW = id => view(id, 'Taxi', 'Ann', 10, ALL, { Ann: 3.34, Ben: 3.33, Cara: 3.33 })
const fileState = file => { const st = statSync(file, { bigint: true }); return { ino: st.ino, mtimeNs: st.mtimeNs, text: readFileSync(file, 'utf8') } }
// Waits first, so a later rewrite gets a later mtime even on a clock with 16 ms ticks.
const snapshot = async s => { await sleep(50); return fileState(s.file) }
const assertUntouched = (s, was, what) => assert.deepEqual(fileState(s.file), was, `${what}: the data file was written`)
async function assertNothingSaved(s, was) {
  assertUntouched(s, was, 'rejected import')
  assert.deepEqual([await getJson(s, '/groups/trip/expenses'), await getJson(s, '/groups/trip/payments')], [{ expenses: [] }, { payments: [] }])
}

// --- Bug 1: parseAmount truncates v * 100, and every route that takes an amount shares it ---
test('bug 1: a 4.35 coffee is kept and shown as 4.35, not 4.34', () => withTrip('coffee', async s => {
  const want = view(1, 'Coffee', 'Ann', 4.35, ALL, { Ann: 1.45, Ben: 1.45, Cara: 1.45 })
  assert.deepEqual(await addExpense(s, { description: 'Coffee', payer: 'Ann', amount: 4.35 }), want)
  assert.deepEqual(await getJson(s, '/groups/trip/expenses'), { expenses: [want] })
  assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: { Ann: 2.9, Ben: -1.45, Cara: -1.45 } })
}))
test('bug 1: amounts with up to 2 decimals are kept exactly on expenses, payments and PATCH; bad ones still refused', () => withServer('amounts', async s => {
  // 669777.7 * 100 is 66977769.99999999, so a tiny-epsilon fix such as Math.trunc(v * 100 + 1e-9) still fails on it.
  const amounts = [0.07, 0.14, 0.29, 0.57, 1.15, 2.51, 4.35, 8.2, 9.95, 19.99, 12.5, 0.5, 0.01, 669777.7, 999999.99, 1000000]
  await ok(s, 'POST', '/groups', { id: 'duo', name: 'Duo', members: ['Ann', 'Ben'] })
  for (const amount of amounts) {
    const e = await addExpense(s, { description: `E ${amount}`, payer: 'Ann', amount, split: ['Ben'] }, 'duo')
    assert.deepEqual([e.amount, e.shares], [amount, { Ben: amount }], `POST expense ${amount}`)
    assert.equal((await addPayment(s, { from: 'Ben', to: 'Ann', amount }, 'duo')).amount, amount, `POST payment ${amount}`)
  }
  for (const amount of [...amounts.slice(1), amounts[0]]) {
    const e = await ok(s, 'PATCH', '/groups/duo/expenses/1', { amount }, 200)
    assert.deepEqual([e.amount, e.shares], [amount, { Ben: amount }], `PATCH ${amount}`)
  }
  for (const amount of [0, -1, 0.001, 0.005, 1.234, 4.355, 1000000.01, '4.35', null, true]) {
    const e = await call(s, 'POST', '/groups/duo/expenses', { description: 'X', payer: 'Ann', amount })
    const p = await call(s, 'POST', '/groups/duo/payments', { from: 'Ben', to: 'Ann', amount })
    assert.deepEqual([e, p], [err400(AMOUNT_ERROR), err400(AMOUNT_ERROR)], `expense and payment of ${JSON.stringify(amount)}`)
  }
  assert.deepEqual((await getJson(s, '/groups/duo/expenses')).expenses.map(e => e.amount), amounts)
  assert.deepEqual((await getJson(s, '/groups/duo/payments')).payments.map(p => p.amount), amounts)
  assert.deepEqual(await getJson(s, '/groups/duo/balances'), { balances: { Ann: 0, Ben: 0 } })
}))

