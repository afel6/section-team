// Hidden tests for held-out task h5: the expense service in bench/seeds/h5, two money bugs in shared functions (amounts
// truncated to cents, split remainders dropped) and POST /groups/:id/import. Each test starts its own server on a fresh
// DATA_FILE (some pre-written in the seed's format); HTTP only. "Nothing saved" means same file id, mtime and text.
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
  child.kill('SIGKILL') // not taskkill: with the scorer's minimal environment it takes seconds per call
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

// The store as the seed saves it: amounts in cents, ids counted across groups, some ids already used and deleted.
const OLD_STORE = { groups: [TRIP, { id: 'flat', name: 'Flat', members: ['Ann', 'Dan'] }], nextExpenseId: 9, nextPaymentId: 6,
  expenses: [{ id: 2, group: 'flat', description: 'Rent', payer: 'Ann', amount: 50000, split: ['Ann', 'Dan'] },
    { id: 5, group: 'trip', description: 'Coffee', payer: 'Ann', amount: 434, split: ALL }, { id: 6, group: 'trip', description: 'Taxi', payer: 'Ann', amount: 1000, split: ALL }],
  payments: [{ id: 3, group: 'trip', from: 'Ben', to: 'Ann', amount: 100 }] }

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

// --- Bug 2: splitEvenly drops the remainder, and both the shares and the balances use it ---
test('bug 2: a 10.00 taxi for Ann, Ben and Cara is shared 3.34, 3.33, 3.33 and the balances add up to 0', () => withTrip('taxi', async s => {
  assert.deepEqual(await addExpense(s, { description: 'Taxi', payer: 'Ann', amount: 10 }), TAXI_VIEW(1))
  assert.deepEqual(await getJson(s, '/groups/trip/expenses'), { expenses: [TAXI_VIEW(1)] })
  assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: { Ann: 6.66, Ben: -3.33, Cara: -3.33 } })
  assert.deepEqual(await getJson(s, '/groups/trip/settle-up'), { payments: [{ from: 'Ben', to: 'Ann', amount: 3.33 }, { from: 'Cara', to: 'Ann', amount: 3.33 }] })
}))
test('bug 2: the extra cents go one each to the first people in split (not the payer, not the last); PATCH follows', () => withTrip('remainder', async s => {
  const cases = [[{ description: 'Taxi', payer: 'Ann', amount: 10, split: ['Cara', 'Ben', 'Ann'] }, { Cara: 3.34, Ben: 3.33, Ann: 3.33 }],
    [{ description: 'Gum', payer: 'Ben', amount: 0.05 }, { Ann: 0.02, Ben: 0.02, Cara: 0.01 }],
    [{ description: 'Mint', payer: 'Cara', amount: 0.02 }, { Ann: 0.01, Ben: 0.01, Cara: 0 }],
    [{ description: 'Pen', payer: 'Cara', amount: 0.04, split: ['Ben', 'Cara', 'Ann'] }, { Ben: 0.02, Cara: 0.01, Ann: 0.01 }]]
  for (const [body, shares] of cases) assert.deepEqual((await addExpense(s, body)).shares, shares, body.description)
  assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: { Ann: 6.63, Ben: -3.33, Cara: -3.3 } })
  assert.deepEqual(await getJson(s, '/groups/trip/settle-up'), { payments: [{ from: 'Ben', to: 'Ann', amount: 3.33 }, { from: 'Cara', to: 'Ann', amount: 3.3 }] })
  const edited = await ok(s, 'PATCH', '/groups/trip/expenses/1', { amount: 100, split: ['Ben', 'Cara', 'Ann'] }, 200)
  assert.deepEqual(edited, view(1, 'Taxi', 'Ann', 100, ['Ben', 'Cara', 'Ann'], { Ben: 33.34, Cara: 33.33, Ann: 33.33 }))
  await ok(s, 'PATCH', '/groups/trip/expenses/1', { payer: 'Cara' }, 200)
  assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: { Ann: -33.37, Ben: -33.34, Cara: 66.71 } })
}))
test('records saved before the fix are left as they are (no migration) and shared by the fixed rule', () => withServer('old-store', async s => {
  const coffee = view(5, 'Coffee', 'Ann', 4.34, ALL, { Ann: 1.45, Ben: 1.45, Cara: 1.44 })
  assert.deepEqual(await getJson(s, '/groups/trip/expenses'), { expenses: [coffee, TAXI_VIEW(6)] })
  assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: { Ann: 8.55, Ben: -3.78, Cara: -4.77 } })
  const ids = [(await addExpense(s, { description: 'Lunch', payer: 'Ben', amount: 4.35 })).id, (await addPayment(s, { from: 'Cara', to: 'Ann', amount: 1 })).id]
  assert.deepEqual(ids, [9, 6], 'next expense and payment ids')
  const saved = JSON.parse(readFileSync(s.file, 'utf8'))
  for (const old of OLD_STORE.expenses) assert.deepEqual(saved.expenses?.find(e => e.id === old.id), old, `saved expense ${old.id}`)
  assert.deepEqual([saved.payments?.find(p => p.id === 3), saved.groups], [OLD_STORE.payments[0], OLD_STORE.groups])
}, OLD_STORE))

// --- Feature: POST /groups/:id/import, the checks before the entry rules ---
test('import: 413 over 10 KB (exactly 10 KB is read) and 400 for a non-object body, then 404 for an unknown group', () => withTrip('i-404', async s => {
  const json = JSON.stringify({ entries: [TAXI] })
  const padded = size => json + ' '.repeat(size - Buffer.byteLength(json))
  const tooBig = { status: 413, body: { error: 'body too large' } }
  assert.deepEqual([await importTo(s, padded(MAX_BODY + 1)), await importTo(s, padded(MAX_BODY + 1), 'nope')], [tooBig, tooBig])
  for (const id of ['nope', 'trip']) {
    const replies = [await importTo(s, '[1, 2]', id), await importTo(s, 'null', id), await importTo(s, '{"entries": ', id)]
    assert.deepEqual(replies, [err400('body must be a JSON object'), err400('body must be a JSON object'), err400('invalid JSON')], id)
  }
  const nope = [{ entries: [TAXI] }, { entries: [TAXI], dry_run: true }, { bogus: 1 }, { entries: [] }, { entries: [null] }]
  for (const body of nope) assert.deepEqual(await importTo(s, body, 'nope'), NOT_FOUND, JSON.stringify(body))
  // The seed README: "An unknown route is 404", and its API table names each route by method and path.
  assert.deepEqual([await importTo(s, { entries: [TAXI] }, 'Trip'), await call(s, 'GET', '/groups/trip/import')], [NOT_FOUND, NOT_FOUND])
  assert.deepEqual(await getJson(s, '/groups/trip/expenses'), { expenses: [] })
  const r = await importTo(s, padded(MAX_BODY))
  assert.deepEqual([r.status, r.body.expenses], [201, [TAXI_VIEW(1)]])
}))
const [DRY, SKIP, ENTRIES] = ['dry_run must be true or false', 'skip_recorded must be true or false', 'entries must be an array of 1 to 50 items']
const BAD_BODIES = [
  ['unknown field <name> names the first extra field in Object.keys order, before every other check', [
    [{ entries: [TAXI], zeta: 1, alpha: 2 }, 'unknown field zeta'],
    [`{"entries": ${JSON.stringify([TAXI])}, "b": 1, "2": 1, "1": 1}`, 'unknown field 1'], // Object.keys puts integer-like keys first
    [{ entries: [TAXI], constructor: 1 }, 'unknown field constructor'], [{ entries: [TAXI], toString: 'x' }, 'unknown field toString'],
    [{ Entries: [TAXI] }, 'unknown field Entries'], [{ entries: [TAXI], dryRun: true }, 'unknown field dryRun'],
    [{ entries: 'x', dry_run: 'x', skip_recorded: 'x', extra: null }, 'unknown field extra'], [{ entries: [null], skip: true }, 'unknown field skip']]],
  ['entries must be an array of 1 to 50 items, checked before dry_run and before the entry rules',
    [{}, { dry_run: true }, { entries: null }, { entries: {} }, { entries: { 0: TAXI } }, { entries: 'x' }, { entries: [] }, { entries: [], dry_run: null },
      { entries: Array.from({ length: 51 }, () => pay('Ben', 'Ann', 1)) }, { entries: Array(51).fill(null) }].map(body => [body, ENTRIES])],
  ['dry_run, then skip_recorded, must be true or false; a null value counts as given; 400 comes before 422', [
    ...[null, 'true', 1, 0, [], {}].map(v => [{ entries: [TAXI], dry_run: v }, DRY]), ...[null, 'false', 1, 0].map(v => [{ entries: [TAXI], skip_recorded: v }, SKIP]),
    [{ entries: [TAXI], skip_recorded: 'no', dry_run: 'no' }, DRY], [{ entries: [null], dry_run: true, skip_recorded: null }, SKIP]]],
]
BAD_BODIES.forEach(([name, cases], i) => test(`import 400: ${name}; nothing saved`, () => withTrip(`i-400-${i}`, async s => {
  const was = await snapshot(s)
  for (const [body, error] of cases) assert.deepEqual(await importTo(s, body), err400(error), JSON.stringify(body).slice(0, 80))
  await assertNothingSaved(s, was)
  assert.equal((await importTo(s, { entries: [TAXI], dry_run: false, skip_recorded: false })).status, 201, 'a valid import')
})))

// --- Feature: the entry rules (422); each case also checks that nothing was saved ---
const ENTRY_CASES = [
  ['not-an-object, then bad-type; problems sorted by index',
    [null, [], [TAXI], 5, 'expense', true, {}, { ...TAXI, type: 'Expense' }, { type: null, foo: 1 }, { type: 'refund', from: 'Ann' },
      { ...TAXI, type: ['expense'] }, { type: 'constructor' }, TAXI, pay('Ben', 'Ann', 5), { ...TAXI, type: ' expense' }],
    [...each([0, 1, 2, 3, 4, 5], 'not-an-object'), ...each([6, 7, 8, 9, 10, 11, 14], 'bad-type')]],
  ['unknown-field is a field the entry type does not take, checked before the field rules',
    [exp('A', 'Ann', 1, { from: 'Ann' }), exp('B', 'Ann', 1, { id: 7 }), exp('C', 'Ann', 1, { note: null }), exp('D', 'Ann', 1, { toString: 'x' }),
      exp('E', 'Ann', 1, { Split: ['Ann'] }), pay('Ben', 'Ann', 1, { split: ['Ann'] }), pay('Ben', 'Ann', 2, { description: 'x' }),
      pay('Ben', 'Ann', 3, { payer: 'Ben' }), { type: 'expense', extra: 1 }, { type: 'payment', from: 'X', to: 'X', amount: 0, x: 1 },
      exp('F', 'Ann', 1, { split: ['Ben'] }), pay('Ben', 'Ann', 1), exp('G', 'Ann', 1, { constructor: 1 })],
    each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12], 'unknown-field')],
  ['expense rules as on POST, the first broken one wins: bad-description, bad-payer, bad-amount, bad-split',
    [{ type: 'expense', payer: 'Ann', amount: 1 }, exp(' \t ', 'Ann', 1), exp('x'.repeat(201), 'Ann', 1), exp(5, 'Ann', 1), exp(null, 'Ann', 1),
      exp('', 'Dan', 0, { split: [] }), { type: 'expense', description: 'P1', amount: 1 }, exp('P2', 'Dan', 1), exp('P3', 'ann', 1), exp('P4', null, 1),
      exp('P5', 'Dan', 0, { split: [] }), { type: 'expense', description: 'A1', payer: 'Ann' }, exp('A2', 'Ann', 0), exp('A3', 'Ann', -5),
      exp('A4', 'Ann', 1.234), exp('A5', 'Ann', '4.35'), exp('A6', 'Ann', 1000000.01), exp('A7', 'Ann', null), exp('A8', 'Ann', 0, { split: [] }),
      exp('S1', 'Ann', 1, { split: [] }), exp('S2', 'Ann', 1, { split: null }), exp('S3', 'Ann', 1, { split: ['Ann', 'Ann'] }),
      exp('S4', 'Ann', 1, { split: ['Ann', 'Dan'] }), exp('S5', 'Ann', 1, { split: 'Ann' }), exp('S6', 'Ann', 1, { split: ['ann'] }),
      exp('y'.repeat(200), 'Ann', 1000000, { split: ['Cara'] }), exp('Fine', 'Ben', 0.01), exp('Also', 'Cara', 4.35, { split: ['Cara', 'Ann'] })],
    Array.from({ length: 25 }, (_, i) => [i, i < 6 ? 'bad-description' : i < 11 ? 'bad-payer' : i < 19 ? 'bad-amount' : 'bad-split'])],
  ['payment rules: bad-from, then bad-to (a stranger or the same as from), then bad-amount',
    [{ type: 'payment', to: 'Ann', amount: 1 }, pay('Dan', 'Ann', 1), pay(null, 'Ann', 1), pay('ben', 'Ann', 1), pay('Dan', 'Dan', 0),
      pay('Ann', 'Dan', 1), pay('Ann', 'Ann', 1), { type: 'payment', from: 'Ann', amount: 1 }, pay('Ann', 'ann', 1), pay('Ann', 'Ann', 0),
      pay('Ann', null, 1), pay('Ann', 'Dan', 'x'), pay('Ben', 'Ann', 0), pay('Ben', 'Ann', 1.234), { type: 'payment', from: 'Ben', to: 'Ann' },
      pay('Ben', 'Ann', '5'), pay('Ben', 'Ann', 1000000.01), pay('Ben', 'Ann', 4.35), pay('Cara', 'Ben', 1000000)],
    Array.from({ length: 17 }, (_, i) => [i, i < 5 ? 'bad-from' : i < 12 ? 'bad-to' : 'bad-amount'])],
  ['duplicate: same payer, cents and trimmed lower-case description, split ignored; earlier entries that broke a rule do not count',
    [exp('Coffee', 'Ann', 4.35), exp('  COFFEE\t', 'Ann', 4.35, { split: ['Ben'] }), exp('Coffee', 'Ben', 4.35), exp('Coffee', 'Ann', 4.36),
      exp('Cof fee', 'Ann', 4.35), exp('Lunch', 'Ann', 12, { split: [] }), exp('Lunch', 'Ann', 12), pay('Ann', 'Ben', 4.35),
      exp('coffee ', 'Ann', 4.35), exp('Café', 'Cara', 3), exp('CAFÉ', 'Cara', 3, { split: ['Cara'] }), exp('Tea', 'Ann', 2, { split: ['Ann', 'Dan'] }),
      exp('tea', 'Ann', 2), exp('Coffee', 'Ann', 4.35, { bogus: 1 }), exp('Coffee', 'Ben', 4.35), exp('Ice tea', 'Ben', 2), exp('ice  tea', 'Ben', 2)],
    [[1, 'duplicate'], [5, 'bad-split'], [8, 'duplicate'], [10, 'duplicate'], [11, 'bad-split'], [13, 'unknown-field'], [14, 'duplicate']]],
]
ENTRY_CASES.forEach(([name, entries, want], i) => test(`import 422: ${name}`, () => withTrip(`i-422-${i}`, async s => {
  const was = await snapshot(s)
  assert.deepEqual(await importTo(s, { entries }), rejected(want))
  await assertNothingSaved(s, was)
})))
test('import 422: an earlier already-recorded entry counts for duplicate, skipped or not; skipping hides only already-recorded', () => withTrip('i-chain', async s => {
  await addExpense(s, { description: 'Coffee', payer: 'Ann', amount: 4.35 })
  const was = await snapshot(s)
  const A = exp('Coffee', 'Ann', 4.35)
  const both = rejected([[0, 'already-recorded'], [1, 'duplicate']])
  assert.deepEqual([await importTo(s, { entries: [A, A] }), await importTo(s, { entries: [A, A], skip_recorded: false })], [both, both])
  assert.deepEqual(await importTo(s, { entries: [A, A], skip_recorded: true }), rejected([[1, 'duplicate']]))
  const three = [A, exp(' coffee ', 'Ann', 4.35), exp('COFFEE', 'Ann', 4.35, { split: ['Cara'] })]
  assert.deepEqual(await importTo(s, { entries: three, skip_recorded: true }), rejected([[1, 'duplicate'], [2, 'duplicate']]))
  const withBad = [A, exp('Tea', 'Ann', 1.234)]
  assert.deepEqual(await importTo(s, { entries: withBad, skip_recorded: true }), rejected([[1, 'bad-amount']]))
  assert.deepEqual(await importTo(s, { entries: withBad }), rejected([[0, 'already-recorded'], [1, 'bad-amount']]))
  assertUntouched(s, was, 'rejected imports')
  assert.deepEqual(await importTo(s, { entries: [A, exp('Tea', 'Ann', 1)], skip_recorded: true }), { status: 201, body: {
    expenses: [view(2, 'Tea', 'Ann', 1, ALL, { Ann: 0.34, Ben: 0.33, Cara: 0.33 })], payments: [], skipped: [0], balances: { Ann: 3.56, Ben: -1.78, Cara: -1.78 } } })
  assert.deepEqual((await getJson(s, '/groups/trip/expenses')).expenses.map(e => e.id), [1, 2])
}))
test('import already-recorded: only the group\'s current expenses count (edits, deletes, other groups); split ignored', () => withTrip('i-recorded', async s => {
  await ok(s, 'POST', '/groups', { id: 'flat', name: 'Flat', members: ['Ann', 'Dan'] })
  for (const [id, body] of [['trip', { description: 'Coffee', payer: 'Ann', amount: 4.35 }], ['trip', { description: 'Hotel', payer: 'Ann', amount: 90 }],
    ['trip', { description: 'Fuel', payer: 'Ben', amount: 20 }], ['flat', { description: 'Rent', payer: 'Ann', amount: 500 }]]) await addExpense(s, body, id)
  await ok(s, 'PATCH', '/groups/trip/expenses/2', { amount: 95 }, 200)
  assert.equal((await call(s, 'DELETE', '/groups/trip/expenses/3')).status, 204)
  await addExpense(s, { description: 'Lunch', payer: 'Cara', amount: 12, split: ['Ann'] })
  const entries = [exp(' coffee ', 'Ann', 4.35, { split: ['Ben'] }), exp('Hotel', 'Ann', 90), exp('HOTEL', 'Ann', 95), exp('Fuel', 'Ben', 20),
    exp('Rent', 'Ann', 500), exp('Coffee', 'Ben', 4.35), exp('Lunch', 'Cara', 12, { split: ['Ben', 'Cara'] }), pay('Ann', 'Cara', 95)]
  assert.deepEqual(await importTo(s, { entries }), rejected(each([0, 2, 6], 'already-recorded')))
  const r = await importTo(s, { entries, skip_recorded: true })
  assert.deepEqual(r, { status: 201, body: {
    expenses: [view(6, 'Hotel', 'Ann', 90, ALL, { Ann: 30, Ben: 30, Cara: 30 }), view(7, 'Fuel', 'Ben', 20, ALL, { Ann: 6.67, Ben: 6.67, Cara: 6.66 }),
      view(8, 'Rent', 'Ann', 500, ALL, { Ann: 166.67, Ben: 166.67, Cara: 166.66 }), view(9, 'Coffee', 'Ben', 4.35, ALL, { Ann: 1.45, Ben: 1.45, Cara: 1.45 })],
    payments: [{ id: 1, from: 'Ann', to: 'Cara', amount: 95 }], skipped: [0, 2, 6], balances: { Ann: 534.44, Ben: -213.56, Cara: -320.88 } } })
  assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: r.body.balances })
}))

// --- Feature: successful imports and dry_run ---
test('import: identical payments are all imported (never duplicate); 50 entries is allowed; balances in member order', () => withServer('i-payments', async s => {
  await ok(s, 'POST', '/groups', { id: 'band', name: 'Band', members: ['Zoe', 'Ann', 'Mia'] })
  await addPayment(s, { from: 'Mia', to: 'Zoe', amount: 5 }, 'band')
  const r = await importTo(s, { entries: Array.from({ length: 50 }, () => pay('Mia', 'Zoe', 5)) }, 'band')
  const payments = Array.from({ length: 50 }, (_, i) => ({ id: i + 2, from: 'Mia', to: 'Zoe', amount: 5 }))
  assert.deepEqual(r, { status: 201, body: { expenses: [], payments, skipped: [], balances: { Zoe: -255, Ann: 0, Mia: 255 } } })
  assert.deepEqual(Object.keys(r.body.balances), ['Zoe', 'Ann', 'Mia'], 'balances keys in the group\'s member order')
  assert.equal((await getJson(s, '/groups/band/payments')).payments.length, 51)
}))
test('import: when every entry is skipped it succeeds with empty lists and writes nothing; dry_run gives the same with 200', () => withTrip('i-skipall', async s => {
  await addExpense(s, { description: 'Coffee', payer: 'Ann', amount: 4.35 })
  await addExpense(s, { description: 'Taxi', payer: 'Ann', amount: 10 })
  await addPayment(s, { from: 'Ben', to: 'Ann', amount: 1 })
  const was = await snapshot(s)
  const entries = [exp('coffee', 'Ann', 4.35), exp(' TAXI ', 'Ann', 10, { split: ['Ben'] })]
  const body = { expenses: [], payments: [], skipped: [0, 1], balances: { Ann: 8.56, Ben: -3.78, Cara: -4.78 } }
  assert.deepEqual(await importTo(s, { entries, skip_recorded: true }), { status: 201, body })
  assert.deepEqual(await importTo(s, { entries, skip_recorded: true, dry_run: true }), { status: 200, body })
  assertUntouched(s, was, 'all-skipped import and dry run')
  assert.equal((await addExpense(s, { description: 'Tea', payer: 'Ben', amount: 1 })).id, 3)
}))
test('import 201: ids per kind in entry order from the next POST ids, POST-shaped replies, saved in the data file', async () => {
  const entries = [exp('  Ski pass ', 'Cara', 4.35), exp('coffee', 'Ann', 4.34), pay('Cara', 'Ann', 2.51), exp('Rent', 'Ann', 500, { split: ['Ben', 'Ann'] })]
  const expenses = [view(9, '  Ski pass ', 'Cara', 4.35, ALL, { Ann: 1.45, Ben: 1.45, Cara: 1.45 }), view(10, 'Rent', 'Ann', 500, ['Ben', 'Ann'], { Ben: 250, Ann: 250 })]
  const body = { expenses, payments: [{ id: 6, from: 'Cara', to: 'Ann', amount: 2.51 }], skipped: [1], balances: { Ann: 254.59, Ben: -255.23, Cara: 0.64 } }
  await withServer('i-ids', async s => {
    assert.deepEqual(await importTo(s, { entries, skip_recorded: true }), { status: 201, body })
    // The saved 4.34 coffee is 434 cents, so a 4.35 coffee is not already recorded; it takes the next id, E + 2.
    const more = await importTo(s, { entries: [exp('Coffee', 'Ann', 4.35)] })
    assert.deepEqual([more.status, more.body?.expenses?.map(e => [e.id, e.amount])], [201, [[11, 4.35]]], JSON.stringify(more.body))
    assert.equal((await addPayment(s, { from: 'Ben', to: 'Cara', amount: 1 })).id, 7)
  }, OLD_STORE)
  await withServer('i-ids', async s => {
    const saved = (await getJson(s, '/groups/trip/expenses')).expenses
    assert.deepEqual([saved.map(e => e.id), saved.slice(2, 4)], [[5, 6, 9, 10, 11], expenses], 'the import survives a restart')
    assert.deepEqual((await getJson(s, '/groups/trip/payments')).payments.map(p => p.id), [3, 6, 7])
    assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: { Ann: 257.49, Ben: -255.68, Cara: -1.81 } })
    assert.equal((await addExpense(s, { description: 'Tea', payer: 'Ben', amount: 1 })).id, 12)
  })
})
test('import dry_run: same body with 200, nothing saved, and the next real ids are the ones it showed', () => withTrip('i-dry', async s => {
  await addExpense(s, { description: 'Hotel', payer: 'Ann', amount: 90 })
  await addPayment(s, { from: 'Ben', to: 'Ann', amount: 30 })
  const was = await snapshot(s)
  const entries = [TAXI, pay('Cara', 'Ann', 30), exp('Lunch', 'Ben', 4.35, { split: ['Ben', 'Cara'] })]
  const body = { expenses: [TAXI_VIEW(2), view(3, 'Lunch', 'Ben', 4.35, ['Ben', 'Cara'], { Ben: 2.18, Cara: 2.17 })],
    payments: [{ id: 2, from: 'Cara', to: 'Ann', amount: 30 }], skipped: [], balances: { Ann: 6.66, Ben: -1.16, Cara: -5.5 } }
  assert.deepEqual(await importTo(s, { entries, dry_run: true }), { status: 200, body })
  assert.deepEqual(await importTo(s, { entries, dry_run: true, skip_recorded: true }), { status: 200, body })
  assertUntouched(s, was, 'dry run')
  const now = [(await getJson(s, '/groups/trip/expenses')).expenses.map(e => e.id), await getJson(s, '/groups/trip/balances')]
  assert.deepEqual(now, [[1], { balances: { Ann: 30, Ben: 0, Cara: -30 } }])
  assert.deepEqual(await importTo(s, { entries, dry_run: false }), { status: 201, body })
  const next = await importTo(s, { entries: [exp('Snack', 'Cara', 1), pay('Ann', 'Ben', 1)], dry_run: true })
  assert.deepEqual([next.status, next.body?.expenses?.map(e => e.id), next.body?.payments?.map(p => p.id)], [200, [4], [3]])
  assert.equal((await addExpense(s, { description: 'Snack', payer: 'Cara', amount: 1 })).id, 4)
  assert.equal((await addPayment(s, { from: 'Ann', to: 'Ben', amount: 1 })).id, 3)
}))
test('import dry_run keeps every error reply (404, 400, 413, 422) the same, and a rejected import uses no id', () => withTrip('i-dry-errors', async s => {
  await addExpense(s, { description: 'Coffee', payer: 'Ann', amount: 4.35 })
  const was = await snapshot(s)
  const coffee = exp('Coffee', 'Ann', 4.35)
  const cases = [['nope', { entries: [TAXI] }], ['trip', { entries: [TAXI], x: 1 }], ['trip', { entries: [] }], ['trip', { entries: [null, coffee] }],
    ['trip', { entries: [null, coffee], skip_recorded: true }], ['trip', { entries: [TAXI, pay('Ben', 'Ann', 5), exp('Bad', 'Ann', 0)] }],
    ['trip', { entries: [TAXI], pad: 'x'.repeat(MAX_BODY) }]]
  const replies = []
  for (const [id, body] of cases) {
    replies.push(await importTo(s, body, id))
    assert.deepEqual(await importTo(s, { ...body, dry_run: true }, id), replies.at(-1), `dry run of ${JSON.stringify(body).slice(0, 80)}`)
  }
  assert.deepEqual(replies.map(r => r.status), [404, 400, 400, 422, 422, 422, 413])
  assert.deepEqual(replies.slice(3, 6), [rejected([[0, 'not-an-object'], [1, 'already-recorded']]), rejected([[0, 'not-an-object']]), rejected([[2, 'bad-amount']])])
  assertUntouched(s, was, 'rejected imports')
  assert.equal((await addExpense(s, { description: 'Tea', payer: 'Ben', amount: 1 })).id, 2)
  assert.equal((await addPayment(s, { from: 'Ann', to: 'Ben', amount: 1 })).id, 1)
}))

// --- Seed behaviour through HTTP, the module, the README and the test script ---
test('the other routes still ignore unknown fields, and their errors are unchanged', () => withServer('seed', async s => {
  assert.deepEqual(await ok(s, 'POST', '/groups', { ...TRIP, colour: 'blue' }), TRIP)
  assert.deepEqual(await addExpense(s, { description: 'Hotel', payer: 'Ann', amount: 90, type: 'expense', note: 'x' }), view(1, 'Hotel', 'Ann', 90, ALL, { Ann: 30, Ben: 30, Cara: 30 }))
  assert.deepEqual(await addPayment(s, { from: 'Ben', to: 'Ann', amount: 30, type: 'payment', memo: 'x' }), { id: 1, from: 'Ben', to: 'Ann', amount: 30 })
  assert.deepEqual(await ok(s, 'PATCH', '/groups/trip/expenses/1', { amount: 60, colour: 'x' }, 200), view(1, 'Hotel', 'Ann', 60, ALL, { Ann: 20, Ben: 20, Cara: 20 }))
  assert.deepEqual(await getJson(s, '/groups/trip/balances'), { balances: { Ann: 10, Ben: 10, Cara: -20 } })
  const self = await call(s, 'POST', '/groups/trip/payments', { from: 'Ann', to: 'Ann', amount: 5 })
  const stranger = await call(s, 'POST', '/groups/trip/expenses', { description: 'X', payer: 'Dan', amount: 5 })
  assert.deepEqual([self, stranger], [err400('from and to must be two different members of the group'), err400('payer must be a member of the group')])
  assert.deepEqual([await call(s, 'POST', '/groups', TRIP), await call(s, 'GET', '/nothing-here')], [{ status: 409, body: { error: 'group already exists' } }, NOT_FOUND])
}))
test('lib/import.mjs exists', () => assert.ok(existsSync(join(target(), 'lib', 'import.mjs')), 'lib/import.mjs is missing'))

// The import's API entry: a table row starting with the route (leading pipe optional, method and path in one cell or
// two), else a bullet or heading naming POST and the path, with the lines under it up to the next sibling or heading.
const ROW = /^\s*\|?\s*[`*_]*POST[`*_]*\s*(?:\|\s*)?[`*_]*\/groups\/:id\/import\b.*\|/
const ITEM = /^\s*(?:[-*+]|\d+[.)]|#{1,6})\s.*\bPOST\b.*\/groups\/:id\/import\b/
const [level, indent, bullet] = [l => /^\s*(#{1,6})\s/.exec(l)?.[1].length ?? 0, l => l.search(/\S/), l => /^\s*(?:[-*+]|\d+[.)])\s/.test(l)]
const sectionEnds = (top, l) => (level(l) > 0 && (!level(top) || level(l) <= level(top))) || (!level(top) && bullet(l) && indent(l) <= indent(top))
const importEntries = lines => [...lines.filter(l => ROW.test(l)), ...lines.flatMap((top, at) => {
  const end = ITEM.test(top) && lines.findIndex((l, i) => i > at && sectionEnds(top, l))
  return end === false ? [] : [lines.slice(at, end < 0 ? undefined : end).join('\n')]
})]
// Paragraphs: blocks between blank lines, where a list item, heading or table row also starts a new block.
const paragraphs = text => text.split(/\r?\n(?=[ \t]*\r?$|[ \t]*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\|))/m).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
test('README documents the import: API entry, fields, every rule, and unknown fields ignored only elsewhere', () => {
  const text = readFileSync(join(target(), 'README.md'), 'utf8')
  const lines = text.split(/\r?\n/)
  const entries = importEntries(lines)
  assert.ok(text.includes('POST /groups/:id/import') && entries.length, 'an API table row that starts with POST /groups/:id/import')
  const missing = e => ['201', '200', '400', '404', '413', '422', 'import rejected'].filter(part => !e.includes(part))
  assert.ok(entries.some(e => !missing(e).length), `the API row for the import does not list ${missing(entries[0]).join(', ')}`)
  for (const word of ['dry_run', 'skip_recorded', ...RULES]) assert.ok(text.includes(word), `README names ${word}`)
  const ignored = paragraphs(text).filter(p => /unknown\s+fields?/i.test(p) && /ignore/i.test(p))
  assert.ok(ignored.length > 0, 'README still says the other routes ignore unknown fields')
  for (const p of ignored) assert.match(p, /import|other|except/i, `"unknown fields ignored" is not limited: ${p.slice(0, 300)}`)
})

// Runs `npm test` in dir as the scorer does; sums every "tests <n>" summary line (spec "ℹ tests", tap "# tests").
function npmTest(dir) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('NODE_TEST')))
  const r = spawnSync('npm test', { cwd: dir, env, shell: true, encoding: 'utf8', timeout: 120000, windowsHide: true })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(/\x1b\[[0-9;]*m/g, '')
  const count = [...out.matchAll(/^\D{0,3}tests (\d+)\s*$/gm)].reduce((sum, m) => sum + Number(m[1]), 0)
  return { passed: r.status === 0, count, why: `${r.error?.message ?? r.status}: ${out.slice(-1500)}` }
}
test('the package.json test script passes and runs more tests than the seed\'s own suite', () => {
  const mine = npmTest(target())
  assert.ok(mine.passed, `the test script failed (${mine.why})`)
  const seed = npmTest(SEED_DIR)
  assert.ok(seed.passed && seed.count > 0, `the seed's own suite did not run (${seed.why})`)
  assert.ok(mine.count > seed.count, `the test script ran ${mine.count} tests; the seed's own suite has ${seed.count}`)
})
