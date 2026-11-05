// Hidden set s2 of task h7: what stage 2 asked for, on the final code: handles, the migration, the report and the page.
import assert from 'node:assert/strict'
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  LIST_FIRST, MOVES, PARTS_V1, REFUSED, SCHEMA_V1, SCHEMA_V2, all, answer, assets, boot, byId, del, dump, err, errorText, expect, fire, flush, fresh, freshDb, get, it, moveOf, norm, ok, openPage, parseHtml, partOf, patch, pending, plantV1, post, readyWith, refused, req, runToExit,
  same, schemaOf, setValue, settle, shared, sleep, startServer, stopServer, take, textOf, view, withDb, withServer, within, isEl,
} from './lib.mjs'

const BAD_DATE = 'as_of must be a valid YYYY-MM-DD date'
const BILLION = 1_000_000_000
const migrateLine = name => `cannot migrate database ${name}`

// --- Handles ---
it('a new part\'s handle follows the rule, step by step', async () => {
  await withServer({}, async s => {
    const a39 = 'a'.repeat(39)
    const cases = [
      ['Crème Brûlée', 'creme-brulee'], ['  Hex  Bolt, M8 ', 'hex-bolt-m8'], ['---', 'part'], ['日本語', 'part-2'], ['ﬁne', 'fine'], ['İstanbul', 'istanbul'], ['Straße 5', 'stra-e-5'], ['Æon', 'on'],
      ['A_B', 'a-b'], ['ab'.repeat(30), 'ab'.repeat(20)], [`${a39} tail`, a39], [`${'b'.repeat(39)}---x`, 'b'.repeat(39)], ['٣ 4', '4'], ['ÅNGSTRÖM', 'angstrom'],
    ]
    for (const [i, [name, handle]] of cases.entries()) {
      const made = await ok(post(s, '/api/parts', { sku: `R-${i}`, name }), 201)
      same(name, { handle: made.handle }, { handle })
    }
  })
})

it('a taken handle gets the smallest free number; deleting frees a handle; the suffix comes after the 40 characters', async () => {
  await withServer({}, async s => {
    const add = async (sku, name) => (await partOf(s, sku, name))
    const first = await add('A', 'Bolt')
    assert.equal(first.handle, 'bolt')
    assert.equal((await add('B', 'bolt!')).handle, 'bolt-2')
    const third = await add('C', 'BOLT')
    assert.equal(third.handle, 'bolt-3')
    assert.equal((await add('D', 'bolt 2')).handle, 'bolt-2-2', 'its own base is taken too')
    assert.equal((await add('E', 'Bolt 3')).handle, 'bolt-3-2')
    await ok(del(s, `/api/parts/${(await ok(get(s, '/api/parts?q=b&limit=100'), 200)).parts.find(p => p.handle === 'bolt-2').id}`), 204)
    assert.equal((await add('F', 'Bolt')).handle, 'bolt-2', 'a freed handle is free')
    assert.equal((await add('G', 'Bolt')).handle, 'bolt-4')
    const long = 'c'.repeat(50)
    assert.equal((await add('H', long)).handle, 'c'.repeat(40))
    assert.equal((await add('I', long)).handle, `${'c'.repeat(40)}-2`)
    const rivals = await Promise.all(Array.from({ length: 10 }, (_, i) => partOf(s, `Z-${i}`, 'Same')))
    assert.equal(new Set(rivals.map(p => p.handle)).size, 10, 'requests at the same time get different handles')
  })
})

it('every reply with a part has its handle; PATCH never changes it, and no body can set it', async () => {
  await withServer({}, async s => {
    const made = await ok(post(s, '/api/parts', { sku: 'A', name: 'Hex Bolt', handle: 'chosen' }), 201)
    assert.deepEqual(made, { id: made.id, sku: 'A', name: 'Hex Bolt', handle: 'hex-bolt', on_hand: 0, value_cents: '0' })
    assert.deepEqual(await ok(get(s, `/api/parts/${made.id}`), 200), made)
    assert.deepEqual((await ok(get(s, '/api/parts'), 200)).parts, [made])
    const renamed = await ok(patch(s, `/api/parts/${made.id}`, { name: 'Nut', handle: 'chosen' }), 200)
    assert.deepEqual(renamed, { ...made, name: 'Nut' })
    assert.deepEqual(await ok(get(s, `/api/parts/${made.id}`), 200), renamed)
    assert.equal((await partOf(s, 'B', 'Hex Bolt')).handle, 'hex-bolt-2', 'a renamed part keeps holding its handle')
    await expect('a duplicate sku is still that error', post(s, '/api/parts', { sku: 'A', name: 'Other' }), 409, err('sku already exists'))
    assert.deepEqual((await ok(get(s, '/api/parts?q=hex-bolt'), 200)).parts, [], 'q still looks at the sku and the name only')
  })
})

// --- Migration ---
const OLD_PARTS = [
  { id: 1, sku: 'BOLT-1', name: 'Bolt' }, { id: 2, sku: 'bolt-1', name: 'bolt' }, { id: 3, sku: 'B3', name: 'Bolt 2' }, { id: 5, sku: 'B5', name: 'BOLT!' }, { id: 7, sku: 'N1', name: 'Écrou "M8" \'x\'' }, { id: 8, sku: 'Q', name: '???' }, { id: 9, sku: 'Q2', name: '!!!' },
  { id: 11, sku: 'L', name: 'l'.repeat(80) }, { id: 12, sku: 'L2', name: 'l'.repeat(79) }, { id: 13, sku: 'EMPTY', name: 'No moves' },
]
const OLD_HANDLES = { 1: 'bolt', 2: 'bolt-2', 3: 'bolt-2-2', 5: 'bolt-3', 7: 'ecrou-m8-x', 8: 'part', 9: 'part-2', 11: 'l'.repeat(40), 12: `${'l'.repeat(40)}-2`, 13: 'no-moves' }
const OLD_MOVES = [
  { id: 1, part_id: 1, on_date: '2026-03-01', qty: 10, unit_cost_cents: 250, note: 'first' }, { id: 2, part_id: 1, on_date: '2026-03-05', qty: -4, unit_cost_cents: 250, note: "it's  spaced " }, { id: 4, part_id: 7, on_date: '2026-01-01', qty: BILLION, unit_cost_cents: BILLION },
  { id: 6, part_id: 2, on_date: '2026-02-01', qty: 3, unit_cost_cents: 0 }, { id: 9, part_id: 9, on_date: '2099-12-31', qty: 1, unit_cost_cents: 1 },
]
const OLD_SEQ = { parts: 20, moves: 30 }
const plantOld = (file = freshDb()) => plantV1(file, { parts: OLD_PARTS, moves: OLD_MOVES, seq: OLD_SEQ })
const handled = () => OLD_PARTS.map(p => ({ ...p, handle: OLD_HANDLES[p.id] }))
const movesIn = () => OLD_MOVES.map(m => ({ note: '', ...m }))

it('the migration gives handles in id order and keeps every row, with exactly the new schema', async () => {
  const file = plantOld()
  await withServer({ file }, async s => { await ok(get(s, '/api/parts'), 200) })
  const after = dump(file)
  assert.deepEqual(after.parts.map(p => ({ id: p.id, sku: p.sku, name: p.name, handle: p.handle })), handled())
  assert.deepEqual(after.moves, movesIn())
  assert.deepEqual(schemaOf(file), SCHEMA_V2)
})

it('the migration keeps the id sequences: ids deleted before it are never given again', async () => {
  const file = plantOld()
  await withServer({ file }, async s => {
    const part = await partOf(s, 'NEW', 'New')
    assert.equal(part.id, OLD_SEQ.parts + 1, 'the next part id')
    assert.equal((await moveOf(s, part.id, '2026-03-01', 1)).id, OLD_SEQ.moves + 1, 'the next move id')
  })
})

it('the migration keeps the sequence also when every part was deleted before it, and an empty version 1 database works', async () => {
  const emptied = plantV1(freshDb(), { seq: { parts: 41, moves: 50 } })
  await withServer({ file: emptied }, async s => {
    const part = await partOf(s, 'NEW', 'New')
    assert.equal(part.id, 42)
    assert.equal((await moveOf(s, part.id, '2026-03-01', 1)).id, 51)
  })
  const blank = plantV1(freshDb())
  await withServer({ file: blank }, async s => { assert.equal((await partOf(s, 'NEW', 'New')).id, 1) })
  assert.deepEqual(schemaOf(blank), SCHEMA_V2)
})

it('after the migration the keys work: replies are right, deleting a part takes its moves, and uniqueness holds', async () => {
  const file = plantOld()
  await withServer({ file }, async s => {
    const seven = await ok(get(s, '/api/parts/7'), 200)
    assert.deepEqual(seven, { id: 7, sku: 'N1', name: OLD_PARTS[4].name, handle: OLD_HANDLES[7], on_hand: BILLION, value_cents: String(BigInt(BILLION) ** 2n) })
    assert.deepEqual((await ok(get(s, '/api/parts/1/moves'), 200)).moves.map(m => [m.id, m.balance]), [[1, 10], [2, 6]])
    await ok(post(s, '/api/parts/1/moves', { on_date: '2026-03-02', qty: -1, unit_cost_cents: 1 }), 201)
    await expect('the running balance still holds', post(s, '/api/parts/1/moves', { on_date: '2026-02-01', qty: -1, unit_cost_cents: 1 }), 409, err('stock would go below zero on 2026-02-01'))
    await ok(del(s, '/api/parts/1'), 204)
    assert.deepEqual(dump(file).moves.filter(m => m.part_id === 1), [], 'the cascade')
    await expect('a duplicate sku', post(s, '/api/parts', { sku: 'bolt-1', name: 'x' }), 409, err('sku already exists'))
    assert.equal((await partOf(s, 'NEW', 'Bolt')).handle, 'bolt', 'the deleted part\'s handle is free')
    assert.throws(() => withDb(file, db => db.prepare("INSERT INTO moves (part_id, on_date, qty, unit_cost_cents) VALUES (9999, '2026-01-01', 1, 1)").run()), /FOREIGN KEY/, 'the key is real')
    assert.throws(() => withDb(file, db => db.prepare("INSERT INTO parts (sku, name, handle) VALUES ('U', 'u', 'bolt-2')").run()), /UNIQUE/, 'handle is unique')
  })
})

it('the migration keeps what other tools added: a table, an index, a trigger and a view, all still working', async () => {
  const file = plantOld()
  withDb(file, db => db.exec(`
    CREATE TABLE tool_log (id INTEGER PRIMARY KEY, sku TEXT NOT NULL);
    INSERT INTO tool_log (sku) VALUES ('kept');
    CREATE INDEX tool_parts_name ON parts (name);
    CREATE TRIGGER tool_audit AFTER UPDATE OF name ON parts BEGIN INSERT INTO tool_log (sku) VALUES (NEW.sku); END;
    CREATE VIEW tool_stock AS SELECT p.sku AS sku, SUM(m.qty) AS qty FROM parts p JOIN moves m ON m.part_id = p.id GROUP BY p.id;
  `))
  await withServer({ file }, async s => { await ok(patch(s, '/api/parts/1', { name: 'Renamed' }), 200) })
  withDb(file, db => {
    const names = db.prepare("SELECT type, name FROM sqlite_master WHERE name LIKE 'tool_%' ORDER BY name").all().map(row => [row.type, row.name])
    assert.deepEqual(names, [['trigger', 'tool_audit'], ['table', 'tool_log'], ['index', 'tool_parts_name'], ['view', 'tool_stock']])
    assert.deepEqual(db.prepare('SELECT sku FROM tool_log ORDER BY id').all().map(row => row.sku), ['kept', 'BOLT-1'], 'the trigger still fires, and the migration did not fire it')
    assert.deepEqual(db.prepare("SELECT qty FROM tool_stock WHERE sku = 'BOLT-1'").get().qty, 6, 'the view reads the new table')
    assert.deepEqual(db.prepare('PRAGMA index_info(tool_parts_name)').all().map(row => row.name), ['name'])
  })
  assert.deepEqual(dump(file).parts.map(p => p.handle), OLD_PARTS.map(p => OLD_HANDLES[p.id]))
})

it('a version 2 database is used as it is: a restart gives no new handles and changes nothing', async () => {
  const file = plantOld()
  await withServer({ file }, async s => {
    await ok(patch(s, '/api/parts/1', { name: 'Renamed' }), 200)
    await ok(del(s, '/api/parts/2'), 204)
    await partOf(s, 'NEW', 'bolt 2')
  })
  const before = dump(file)
  await withServer({ file }, async s => { await ok(get(s, '/api/parts'), 200) })
  assert.deepEqual(dump(file), before)
})

it('a version 1 database that breaks the rules is refused whole: the line, exit 1, not listening, content and version as they were', async () => {
  const lastPart = OLD_PARTS.at(-1).id
  const broken = {
    'a move with no part': { parts: OLD_PARTS, moves: [...OLD_MOVES, { id: 20, part_id: 999, on_date: '2026-01-01', qty: 1, unit_cost_cents: 1 }] },
    'a running balance below zero on the last part': { parts: OLD_PARTS, moves: [...OLD_MOVES, { id: 20, part_id: lastPart, on_date: '2026-01-01', qty: -1, unit_cost_cents: 1 }] },
    'a balance that dips only on the way': { parts: OLD_PARTS, moves: [...OLD_MOVES, { id: 20, part_id: lastPart, on_date: '2026-01-01', qty: -1, unit_cost_cents: 1 }, { id: 21, part_id: lastPart, on_date: '2026-01-02', qty: 5, unit_cost_cents: 1 }] },
  }
  for (const [label, rows] of Object.entries(broken)) {
    const file = plantV1(freshDb(), { ...rows, seq: OLD_SEQ })
    const before = dump(file)
    same(label, refused(await runToExit({ DB_FILE: file }), migrateLine(file)), REFUSED)
    same(`${label}: content`, dump(file), before)
    assert.deepEqual(schemaOf(file).parts, SCHEMA_V1.parts, `${label}: the old table`)
    assert.equal(schemaOf(file).version, 1, label)
    withDb(file, db => db.prepare('DELETE FROM moves WHERE id >= 20').run())
    await withServer({ file }, async s => { assert.equal((await ok(get(s, '/api/parts/7'), 200)).handle, OLD_HANDLES[7], `${label}: mended, it migrates`) })
  }
})

it('a refusal names the file as given, and the default name; a version above 2 is refused as before, the file unchanged', async () => {
  const cwd = fresh()
  plantV1(join(cwd, 'parts.db'), { moves: [{ id: 1, part_id: 5, on_date: '2026-01-01', qty: 1, unit_cost_cents: 1 }] })
  same('default', refused(await runToExit({}, { cwd }), migrateLine('parts.db')), REFUSED)
  same('relative', refused(await runToExit({ DB_FILE: 'parts.db' }, { cwd }), migrateLine('parts.db')), REFUSED)
  const newer = plantV1(freshDb())
  withDb(newer, db => db.exec('PRAGMA user_version = 3'))
  const bytes = readFileSync(newer)
  same('version 3', refused(await runToExit({ DB_FILE: newer }), `cannot open database ${newer}`), REFUSED)
  assert.ok(readFileSync(newer).equals(bytes), 'the file is unchanged')
})

// A large version 1 database, built once: parts with names that collide, and moves that keep every balance above zero.
function plantLarge(file, partCount, moveCount) {
  withDb(file, db => {
    db.exec(`BEGIN; ${PARTS_V1} ${MOVES} PRAGMA user_version = 1;`)
    const part = db.prepare('INSERT INTO parts (sku, name) VALUES (?, ?)')
    for (let i = 1; i <= partCount; i++) part.run(`S-${i}`, `Part ${i % 1000} Group ${i % 7}`)
    const move = db.prepare('INSERT INTO moves (part_id, on_date, qty, unit_cost_cents) VALUES (?, ?, ?, ?)')
    for (let i = 1; i <= moveCount; i++) move.run(1 + (i % partCount), '2026-03-01', i % 2 === 0 ? 1 : 2, 100)
    db.exec('COMMIT')
  })
  return file
}

it('a database of 20000 parts and 100000 moves migrates within 30 seconds, all of it', async () => {
  const file = plantLarge(freshDb(), 20_000, 100_000)
  const before = dump(file)
  const started = Date.now()
  const s = await startServer({ file, waitMs: 30_000 })
  const took = Date.now() - started
  try {
    assert.ok(took <= 30_000, `took ${took} ms`)
    const r = await ok(get(s, '/api/parts/20000'), 200)
    assert.equal(r.on_hand, before.moves.filter(m => m.part_id === 20_000).reduce((sum, m) => sum + m.qty, 0))
  } finally {
    await stopServer(s)
  }
  const after = dump(file)
  assert.deepEqual(after.moves, before.moves)
  assert.deepEqual(after.parts.map(({ handle, ...p }) => p), before.parts)
  assert.equal(new Set(after.parts.map(p => p.handle)).size, 20_000)
  // Names repeat every 7000 parts: the first of a name has the plain handle, the next ones -2, -3.
  assert.deepEqual(after.parts.slice(0, 2).map(p => p.handle), ['part-1-group-1', 'part-2-group-2'])
  assert.equal(after.parts[7000].handle, 'part-1-group-1-2')
}, 75_000)

it('killed at any moment the file holds the old version or the new one, whole, and the next start finishes the job', async () => {
  const master = plantLarge(freshDb(), 5000, 30_000)
  const original = dump(master)
  for (const delay of [60, 120, 180, 260, 350, 500]) {
    const file = freshDb()
    copyFileSync(master, file)
    const s = await boot({ PORT: '0', DB_FILE: file }, { waitMs: 0 })
    await sleep(delay)
    await stopServer(s)
    const seen = dump(file)
    assert.ok([1, 2].includes(seen.version), `version ${seen.version}`)
    assert.deepEqual(seen.moves, original.moves, `moves after a kill at ${delay} ms`)
    assert.deepEqual(seen.parts.map(({ handle, ...p }) => p), original.parts, `parts after a kill at ${delay} ms`)
    assert.ok(seen.parts.every(p => (seen.version === 1) === (p.handle === undefined)), `version ${seen.version} with the wrong table`)
    await withServer({ file, waitMs: 30_000 }, async again => { assert.equal((await ok(get(again, '/api/parts/5000'), 200)).id, 5000) })
    assert.equal(dump(file).version, 2)
  }
}, 90_000)

// --- Report ---
it('GET /api/report: only moves on or before the date, every part, sorted by handle, with exact totals', async () => {
  await withServer({}, async s => {
    const zebra = await partOf(s, 'A-1', 'Zebra')
    const apple = await partOf(s, 'Z-1', 'Apple')
    const none = await partOf(s, 'M-1', 'Mango')
    await moveOf(s, zebra.id, '2026-03-01', 5, 100)
    await moveOf(s, zebra.id, '2026-03-10', -2, 100)
    await moveOf(s, apple.id, '2026-03-10', 3, 7)
    const report = date => ok(get(s, `/api/report?as_of=${date}`), 200)
    const row = (p, onHand, value) => ({ id: p.id, handle: p.handle, sku: p.sku, on_hand: onHand, value_cents: value })
    assert.deepEqual(await report('2026-02-28'), { as_of: '2026-02-28', parts: [row(apple, 0, '0'), row(none, 0, '0'), row(zebra, 0, '0')], total_value_cents: '0' })
    assert.deepEqual(await report('2026-03-09'), { as_of: '2026-03-09', parts: [row(apple, 0, '0'), row(none, 0, '0'), row(zebra, 5, '500')], total_value_cents: '500' })
    assert.deepEqual(await report('2026-03-10'), { as_of: '2026-03-10', parts: [row(apple, 3, '21'), row(none, 0, '0'), row(zebra, 3, '300')], total_value_cents: '321' })
    const firstOf = await ok(get(s, '/api/report?as_of=2026-03-09&as_of=2026-03-10'), 200)
    assert.equal(firstOf.as_of, '2026-03-09', 'a repeated parameter means its first value')
  })
})

it('the report\'s totals are exact past 2^53 and 2^63, and below zero', async () => {
  await withServer({}, async s => {
    const parts = await Promise.all(['A', 'B', 'C'].map(sku => partOf(s, sku, sku)))
    for (const p of parts) for (let i = 1; i <= 8; i++) await moveOf(s, p.id, '2026-03-01', BILLION, BILLION - i)
    const each = 8n * BigInt(BILLION) ** 2n - 36n * BigInt(BILLION)
    const report = await ok(get(s, '/api/report?as_of=2026-03-01'), 200)
    assert.deepEqual(report.parts.map(p => p.value_cents), [String(each), String(each), String(each)])
    assert.equal(report.total_value_cents, String(3n * each))
    assert.ok(3n * each > 2n ** 63n)
    const low = await partOf(s, 'LOW', 'Low')
    await moveOf(s, low.id, '2026-04-01', 1, 0)
    await moveOf(s, low.id, '2026-04-02', -1, 500)
    assert.equal((await ok(get(s, '/api/report?as_of=2026-04-02'), 200)).parts.find(p => p.sku === 'LOW').value_cents, '-500')
  })
})

it('the report\'s date rules and routes', async () => {
  const s = await shared()
  for (const q of ['', '?as_of=', '?as_of', '?as_of=2026-02-30', '?as_of=2026-3-1', '?as_of=1999-12-31', '?as_of=2100-01-01', '?date=2026-03-01', '?as_of=%202026-03-01']) {
    await expect(`report${q}`, get(s, `/api/report${q}`), 400, err(BAD_DATE))
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) await expect(`${method} report`, req(s, method, '/api/report?as_of=2026-03-01'), 405, err('method not allowed'))
  await expect('another path', get(s, '/api/report/'), 404, err('not found'))
  const r = view(await get(s, '/api/report?as_of=2000-01-01'))
  same('an early date', { status: r.status, type: r.type }, { status: 200, type: answer(200, null).type })
})

// --- Page ---
const P = (id, sku, name, onHand = 0, handle = `h-${id}`) => ({ id, sku, name, handle, on_hand: onHand, value_cents: '0' })
const REPORT = date => `/api/report?as_of=${encodeURIComponent(date)}`
const ready = readyWith([P(1, 'A-1', 'Bolt', 5, 'hex-bolt')])
const reportText = page => ({
  rows: page.el('report-list').kids.filter(isEl).map(li => ({ tag: li.tag, text: textOf(li), kids: li.kids.length })),
  total: textOf(page.el('report-total')),
})
const asOf = async (page, date) => {
  setValue(page.el('as-of'), date)
  const prevented = fire(page.el('report-form'), 'submit')
  await flush()
  return prevented
}
const reportBody = (rows, total) => ({ as_of: '2026-03-01', parts: rows, total_value_cents: total })
const ROW = (handle, onHand, value) => ({ id: 1, handle, sku: 'S', on_hand: onHand, value_cents: value })

it('page markup: the report form with its label, outside the part form; the report list and total empty', async () => {
  const { html } = await assets()
  const root = parseHtml(html)
  const form = byId(root, 'report-form')
  const partForm = byId(root, 'part-form')
  assert.deepEqual({ tag: form?.tag, novalidate: Boolean(form && 'novalidate' in form.attrs), inside: within(form, partForm) }, { tag: 'form', novalidate: true, inside: false })
  const field = byId(root, 'as-of')
  assert.deepEqual({ tag: field?.tag, type: field?.attrs.type, inForm: within(field, form) }, { tag: 'input', type: 'date', inForm: true })
  assert.deepEqual(all(root).filter(n => n.tag === 'label' && n.attrs.for === 'as-of').map(l => ({ text: norm(l), holdsField: all(l).some(n => n.attrs.id === 'as-of') })), [{ text: 'As of', holdsField: false }])
  const button = byId(root, 'report')
  assert.deepEqual({ tag: button?.tag, type: button?.attrs.type, text: button && norm(button), inForm: within(button, form) }, { tag: 'button', type: 'submit', text: 'Show report', inForm: true })
  for (const [id, tag] of [['report-list', 'ul'], ['report-total', 'p']]) {
    const n = byId(root, id)
    assert.deepEqual({ tag: n?.tag, kids: n?.kids.filter(k => isEl(k) || k.text.trim() !== '').length, inForm: within(n, form) }, { tag, kids: 0, inForm: false }, id)
  }
})

it('page: each part\'s line starts with its handle; the rest of the list works as before', async () => {
  const page = await ready([P(3, 'A-1', '<b>Bolt</b>', 5, 'hex-bolt')])
  const [li] = page.el('part-list').kids
  assert.deepEqual([li.tag, li.kids.length, textOf(li.kids[0]), li.kids[1].tag], ['li', 2, 'hex-bolt: A-1 <b>Bolt</b> (5)', 'button'])
})

it('page: the report form never reloads and asks for the date, encoded; a success fills the list and total and empties #error', async () => {
  const page = await ready()
  assert.equal(await asOf(page, '2026-03-01'), true, 'preventDefault')
  const call = take(page, 'GET', REPORT('2026-03-01'))
  await settle(call, c => c.reply(200, reportBody([ROW('a-b', 3, '21'), ROW('<i>', 0, '0')], '21')))
  assert.deepEqual(reportText(page), { rows: [{ tag: 'li', text: 'a-b 3 21', kids: 1 }, { tag: 'li', text: '<i> 0 0', kids: 1 }], total: 'Total: 21' })
  await asOf(page, 'a b&c')
  take(page, 'GET', '/api/report?as_of=a%20b%26c')
})

it('page: a report with an error status or no reply shows the message and leaves the report; the next success empties #error', async () => {
  const cases = [[c => c.reply(400, err(BAD_DATE)), BAD_DATE], [c => c.reply(500, ['x']), 'Request failed.'], [c => c.reply(200, '<html>'), 'Could not reach the server.'], [c => c.fail(), 'Could not reach the server.']]
  for (const [how, message] of cases) {
    const page = await ready()
    await asOf(page, '2026-03-01')
    await settle(take(page, 'GET', REPORT('2026-03-01')), c => c.reply(200, reportBody([ROW('kept', 1, '1')], '1')))
    await asOf(page, '2026-03-02')
    await settle(take(page, 'GET', REPORT('2026-03-02')), how)
    assert.deepEqual({ error: errorText(page), ...reportText(page) }, { error: message, rows: [{ tag: 'li', text: 'kept 1 1', kids: 1 }], total: 'Total: 1' })
    await asOf(page, '2026-03-03')
    await settle(take(page, 'GET', REPORT('2026-03-03')), c => c.reply(200, reportBody([], '0')))
    assert.deepEqual({ error: errorText(page), ...reportText(page) }, { error: '', rows: [], total: 'Total: 0' })
  }
})

it('page: when reports overlap only the last one started counts, however an earlier one ends', async () => {
  for (const late of [c => c.reply(200, reportBody([ROW('old', 1, '1')], '1')), c => c.reply(500, err('old')), c => c.fail()]) {
    const page = await ready()
    await asOf(page, '2026-03-01')
    await asOf(page, '2026-03-02')
    await settle(take(page, 'GET', REPORT('2026-03-02')), c => c.reply(200, reportBody([ROW('new', 2, '2')], '2')))
    await settle(take(page, 'GET', REPORT('2026-03-01')), late)
    assert.deepEqual({ error: errorText(page), ...reportText(page) }, { error: '', rows: [{ tag: 'li', text: 'new 2 2', kids: 1 }], total: 'Total: 2' })
  }
})

it('page: report requests and list fetches are independent, in both directions', async () => {
  const page = await openPage()
  await asOf(page, '2026-03-01')
  assert.deepEqual(pending(page).sort(), [`GET ${LIST_FIRST}`, `GET ${REPORT('2026-03-01')}`])
  await settle(take(page, 'GET', LIST_FIRST), c => c.reply(200, { parts: [P(1, 'A', 'a', 1, 'a')], next: null }))
  assert.equal(page.el('part-list').kids.length, 1, 'a report started later does not cancel the list')
  await settle(take(page, 'GET', REPORT('2026-03-01')), c => c.reply(200, reportBody([ROW('r', 1, '1')], '1')))
  assert.equal(reportText(page).total, 'Total: 1')
  await asOf(page, '2026-03-02')
  setValue(page.el('search'), 'x')
  fire(page.el('search'), 'change')
  await flush()
  await settle(take(page, 'GET', REPORT('2026-03-02')), c => c.reply(200, reportBody([], '9')))
  assert.equal(reportText(page).total, 'Total: 9', 'a list fetch started later does not cancel the report')
  await settle(take(page, 'GET', `${LIST_FIRST}&q=x`), c => c.reply(200, { parts: [], next: null }))
  assert.equal(textOf(page.el('part-list').kids[0]), 'No parts.')
})
