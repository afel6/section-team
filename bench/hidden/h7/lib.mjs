// Shared by the three hidden sets of task h7 (the parts store on SQLite): server processes, raw HTTP, direct database
// access and a DOM stand-in. TARGET_DIR holds the code under test; S1_DIR the code as it stood after stage 1.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'

const TARGET = process.env.TARGET_DIR
export const S1_DIR = process.env.S1_DIR
const JSON_TYPE = 'application/json; charset=utf-8'
const ROOT = mkdtempSync(join(tmpdir(), 'h7-'))
const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }
const running = new Set()

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export const fresh = () => mkdtempSync(join(ROOT, 'c-'))
export const freshDb = () => join(fresh(), 'data.db')
after(async () => {
  for (const s of running) await stopServer(s)
  rmSync(ROOT, RM)
})
// A hung test fails alone instead of running the whole file into the scorer's limit. Node's summary calls it cancelled;
// the scorer counts its `not ok` line as a failure.
export const it = (name, fn, timeout = 60_000) => test(name, { timeout }, fn)
export const tryJson = text => {
  try {
    return JSON.parse(text)
  } catch {
    return `not JSON: ${String(text).slice(0, 200)}`
  }
}
// A failing row of a table test names itself.
// Node 26 throws ERR_INVALID_ARG_TYPE for an explicit undefined message, so it is only passed when given.
export const same = (label, got, want, ...msg) => assert.deepEqual({ label, ...got }, { label, ...want }, ...msg)

// --- Server processes (helper listeners are unref'd: a failed assertion that skips close() cannot hold the process open) ---
export const listenOn = port => new Promise((resolve, reject) => {
  const s = createServer().once('error', reject)
  s.listen(port, '127.0.0.1', () => resolve(s.unref()))
})
export const portFree = port => listenOn(port).then(s => new Promise(resolve => s.close(() => resolve(true))), () => false)
// Exit 1 is right only with the port taken. Another program can take or free it between the first probe and the server's bind,
// so a probe before the server started and one after it exited both count.
export const tookPort = async (r, freeBefore, port = 3000) => r.code === 1 && (!freeBefore || !(await portFree(port)))
export async function freePort() {
  const s = await listenOn(0)
  const { port } = s.address()
  await new Promise(resolve => s.close(resolve))
  return port
}
export const LINE = port => `listening on http://127.0.0.1:${port}\n`

// Spawns server.mjs; resolves once stdout holds a full line, the process has closed, or the wait is over.
export function boot(env, { cwd = fresh(), dir = TARGET, waitMs = 10_000 } = {}) {
  if (!dir) throw new Error('TARGET_DIR is not set')
  const kept = Object.entries(process.env).filter(([k]) => !['PORT', 'DB_FILE', 'NODE_TEST_CONTEXT'].includes(k))
  const full = Object.fromEntries([...kept, ...Object.entries(env).filter(([, v]) => v !== undefined)])
  const s = { child: spawn(process.execPath, [join(dir, 'server.mjs')], { cwd, env: full, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }), out: '', err: '' }
  running.add(s)
  s.child.stdout.on('data', d => { s.out += d })
  s.child.stderr.on('data', d => { s.err += d })
  s.child.on('error', e => { s.err += `spawn error: ${e.message}` })
  return new Promise(done => {
    const finish = () => {
      clearTimeout(timer)
      s.child.stdout.off('data', check)
      done(s)
    }
    const check = () => { if (s.out.includes('\n')) finish() }
    const timer = setTimeout(finish, waitMs)
    s.child.stdout.on('data', check)
    s.child.once('close', finish).once('error', finish)
    check()
  })
}

export async function stopServer(s) {
  running.delete(s)
  if (s.child.pid === undefined || s.child.exitCode !== null || s.child.signalCode !== null) return
  const exited = once(s.child, 'exit', { signal: AbortSignal.timeout(5000) }).catch(() => {})
  s.child.kill('SIGKILL')
  await exited
}

export async function startServer({ file = freshDb(), cwd, dir, env = {}, waitMs } = {}) {
  const port = await freePort()
  const s = await boot({ PORT: String(port), DB_FILE: file ?? undefined, ...env }, { cwd, dir, waitMs })
  if (s.child.exitCode === null && /listening on/i.test(s.out)) return Object.assign(s, { port, file })
  await stopServer(s)
  throw new Error(`server did not start: stdout ${JSON.stringify(s.out.slice(0, 300))} stderr ${JSON.stringify(s.err.slice(0, 800))}`)
}

export async function withServer(opts, fn) {
  const s = await startServer(opts)
  try {
    return await fn(s)
  } finally {
    await stopServer(s)
  }
}

let sharedP
export const shared = () => (sharedP ??= startServer())

// Starts the server expecting it to stop: its exit code and what it wrote.
export async function runToExit(env, { cwd = fresh(), waitMs } = {}) {
  const s = await boot({ PORT: String(await freePort()), ...env }, { cwd, waitMs })
  const code = s.child.exitCode ?? 'still running'
  await stopServer(s)
  return { code, out: s.out, err: s.err }
}
const hasLine = (text, line) => `\n${text.replaceAll('\r\n', '\n')}`.includes(`\n${line}\n`)
// A refusal: exit 1, nothing on stdout, and the line whole on stderr (other stderr lines, such as Node's warnings, are free).
export const refused = (r, line) => ({ code: r.code, out: r.out, line: hasLine(r.err, line) ? 'present' : `stderr ${JSON.stringify(r.err.slice(0, 400))}` })
export const REFUSED = { code: 1, out: '', line: 'present' }

// --- Raw HTTP ---
// body: object → JSON (type application/json unless `type` says otherwise; null: none), string/Buffer → raw.
export function req(s, method, path, { body, parts, type, gap = 50 } = {}) {
  const chunks = parts ?? (body === undefined ? [] : [typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)])
  const headers = { ...(type !== null && (type !== undefined || chunks.length > 0) && { 'content-type': type ?? 'application/json' }) }
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: s.port, method, path, headers, agent: false }, res => {
      const got = []
      res.on('data', d => got.push(d)).on('error', reject).on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], text: Buffer.concat(got).toString('utf8') }))
    })
    r.setTimeout(20_000, () => r.destroy(new Error(`${method} ${path}: no reply within 20 s`))).on('error', reject)
    ;(async () => {
      for (const c of chunks.slice(0, -1)) {
        r.write(c)
        await sleep(gap)
      }
      r.end(chunks.at(-1))
    })()
  })
}
export const view = r => ({ status: r.status, type: r.type, body: tryJson(r.text) })
export const answer = (status, body) => ({ status, type: JSON_TYPE, body })
export const err = error => ({ error })
export const expect = async (label, pending, status, body) => same(label, view(await pending), answer(status, body))
export const get = (s, path) => req(s, 'GET', path)
export const post = (s, path, body, opts = {}) => req(s, 'POST', path, { body, ...opts })
export const patch = (s, path, body, opts = {}) => req(s, 'PATCH', path, { body, ...opts })
export const del = (s, path) => req(s, 'DELETE', path)

export async function ok(pending, status, label = '') {
  const r = await pending
  assert.equal(r.status, status, `${label} replied ${r.status} ${r.text.slice(0, 300)}`)
  return r.text === '' ? null : JSON.parse(r.text)
}
export const partOf = (s, sku, name = 'Part') => ok(post(s, '/api/parts', { sku, name }), 201, `POST part ${sku}`)
export const moveOf = (s, partId, onDate, qty, cost = 100, extra = {}) => ok(post(s, `/api/parts/${partId}/moves`, { on_date: onDate, qty, unit_cost_cents: cost, ...extra }), 201, `POST move ${qty} on ${onDate}`)

// --- The database, as another tool uses it ---
export const PARTS_V1 = `CREATE TABLE parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
) STRICT;`
export const MOVES = `CREATE TABLE moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  on_date TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  note TEXT NOT NULL DEFAULT ''
) STRICT;`

// fn may be async: the connection closes when it has finished.
export function withDb(file, fn) {
  const db = new DatabaseSync(file, { timeout: 10_000 })
  const close = () => db.close()
  try {
    const result = fn(db)
    if (result instanceof Promise) return result.finally(close)
    close()
    return result
  } catch (e) {
    close()
    throw e
  }
}
const version = db => db.prepare('PRAGMA user_version').get().user_version

// Plain copies: node:sqlite's rows have a null prototype, which deepEqual tells from an object's.
const rowsOf = (db, sql) => db.prepare(sql).all().map(row => ({ ...row }))

// A version 1 database made as another tool (or an old server) would have made it. seq: the id sequences, so ids above
// the rows' own show as deleted before the migration. Foreign keys are off, so a test can plant a broken row.
export function plantV1(file, { parts = [], moves = [], seq = {} } = {}) {
  const db = new DatabaseSync(file, { enableForeignKeyConstraints: false })
  try {
    db.exec(`BEGIN; ${PARTS_V1} ${MOVES} PRAGMA user_version = 1;`)
    const part = db.prepare('INSERT INTO parts (id, sku, name) VALUES (?, ?, ?)')
    for (const p of parts) part.run(p.id, p.sku, p.name)
    const move = db.prepare('INSERT INTO moves (id, part_id, on_date, qty, unit_cost_cents, note) VALUES (?, ?, ?, ?, ?, ?)')
    for (const m of moves) move.run(m.id, m.part_id, m.on_date, m.qty, m.unit_cost_cents, m.note ?? '')
    for (const [name, value] of Object.entries(seq)) {
      db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(name)
      db.prepare('INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)').run(name, value)
    }
    db.exec('COMMIT')
  } finally {
    db.close()
  }
  return file
}

// What the file holds: everything a migration must keep or a refusal must leave alone.
export const dump = file => withDb(file, db => ({
  version: version(db),
  parts: rowsOf(db, 'SELECT * FROM parts ORDER BY id'),
  moves: rowsOf(db, 'SELECT * FROM moves ORDER BY id'),
  sequences: rowsOf(db, 'SELECT name, seq FROM sqlite_sequence ORDER BY name'),
}))

// The schema a tool sees, free of how it was written: columns, keys, strictness, unique columns and other objects.
export const schemaOf = file => withDb(file, db => ({
  version: version(db),
  tables: rowsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(t => t.name),
  triggers: rowsOf(db, "SELECT name FROM sqlite_master WHERE type IN ('trigger', 'view')").map(t => t.name),
  strict: rowsOf(db, "SELECT name, strict FROM pragma_table_list WHERE name IN ('parts', 'moves') ORDER BY name").map(t => [t.name, t.strict]),
  parts: rowsOf(db, 'PRAGMA table_info(parts)').map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk]),
  moves: rowsOf(db, 'PRAGMA table_info(moves)').map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk]),
  uniqueInParts: [...new Set(rowsOf(db, 'PRAGMA index_list(parts)').filter(i => i.unique === 1).flatMap(i => rowsOf(db, `PRAGMA index_info("${i.name}")`).map(c => c.name)))].sort(),
  keys: rowsOf(db, 'PRAGMA foreign_key_list(moves)').map(k => [k.table, k.from, k.to, k.on_delete]),
  autoincrement: rowsOf(db, "SELECT name, sql FROM sqlite_master WHERE name IN ('parts', 'moves') ORDER BY name").map(t => [t.name, /AUTOINCREMENT/i.test(t.sql)]),
  check: rowsOf(db, 'PRAGMA foreign_key_check').length,
  integrity: rowsOf(db, 'PRAGMA integrity_check').map(r => r.integrity_check),
}))
const MOVE_COLUMNS = [['id', 'INTEGER', 0, null, 1], ['part_id', 'INTEGER', 1, null, 0], ['on_date', 'TEXT', 1, null, 0], ['qty', 'INTEGER', 1, null, 0], ['unit_cost_cents', 'INTEGER', 1, null, 0], ['note', 'TEXT', 1, "''", 0]]
const schema = (versionNumber, parts, unique) => ({
  version: versionNumber, tables: ['moves', 'parts'], triggers: [], strict: [['moves', 1], ['parts', 1]], parts, moves: MOVE_COLUMNS, uniqueInParts: unique,
  keys: [['parts', 'part_id', 'id', 'CASCADE']], autoincrement: [['moves', true], ['parts', true]], check: 0, integrity: ['ok'],
})
const PART_COLUMNS = [['id', 'INTEGER', 0, null, 1], ['sku', 'TEXT', 1, null, 0], ['name', 'TEXT', 1, null, 0]]
export const SCHEMA_V1 = schema(1, PART_COLUMNS, ['sku'])
export const SCHEMA_V2 = schema(2, [...PART_COLUMNS, ['handle', 'TEXT', 1, null, 0]], ['handle', 'sku'])

// --- Page: a tolerant HTML parser and a DOM stand-in offering only the listed browser APIs (any other member throws) ---
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '))
const CLOSES_P = new Set('address article aside blockquote div dl fieldset footer form h1 h2 h3 h4 h5 h6 header hr main nav ol p pre section table ul'.split(' '))
const elem = (tag, attrs = {}) => ({ tag, attrs, kids: [], parent: null, on: {} })
const textNode = text => ({ tag: '#text', text })
export const isEl = n => n.tag !== '#text'
const put = (parent, n) => {
  if (n.parent) n.parent.kids = n.parent.kids.filter(k => k !== n)
  n.parent = parent
  parent.kids.push(n)
}
export const textOf = n => (isEl(n) ? n.kids.map(textOf).join('') : n.text)
export const norm = n => textOf(n).replace(/[\t\n\f\r ]+/g, ' ').trim()
export const all = n => n.kids.filter(isEl).flatMap(k => [k, ...all(k)])
export const byId = (root, id) => all(root).find(n => n.attrs.id === id)
export const isDisabled = n => n.disabled ?? 'disabled' in n.attrs
export const within = (n, outer) => {
  for (let p = n?.parent; p; p = p.parent) if (p === outer) return true
  return false
}

export function parseHtml(html) {
  const root = elem('#document')
  const re = /<!--[\s\S]*?(?:-->|$)|<[!?][^>]*>|<\/([a-z][^\s/>]*)[^>]*>|<([a-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|[^<]+|</gi
  let cur = root
  const close = tag => {
    for (let n = cur; n !== root; n = n.parent) {
      if (n.tag === tag) {
        cur = n.parent
        return
      }
    }
  }
  for (let m; (m = re.exec(html));) {
    if (m[1]) close(m[1].toLowerCase())
    else if (!m[2]) {
      if (m[0][0] !== '<' || m[0] === '<') put(cur, textNode(m[0]))
    } else {
      const tag = m[2].toLowerCase()
      const attrs = {}
      const n = elem(tag, attrs)
      for (const [, k, ...v] of m[3].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
        if (!Object.hasOwn(attrs, k.toLowerCase())) attrs[k.toLowerCase()] = v.find(x => x !== undefined) ?? ''
      }
      if (CLOSES_P.has(tag)) close('p')
      put(cur, n)
      if (['script', 'style', 'title', 'textarea'].includes(tag)) {
        const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex)
        const stop = end < 0 ? html.length : end
        const gt = html.indexOf('>', stop)
        if (stop > re.lastIndex) put(n, textNode(html.slice(re.lastIndex, stop)))
        re.lastIndex = gt < 0 ? html.length : gt + 1
      } else if (!VOID.has(tag)) cur = n
    }
  }
  return root
}

const realOf = new WeakMap()
const strict = (obj, name, refuse = k => { throw new Error(`app.js used ${name}.${String(k)}, which is not among the browser APIs the task allows`) }) =>
  new Proxy(obj, { get: (t, k) => (typeof k === 'symbol' || k === 'then' || k in t ? t[k] : refuse(k)), set: (t, k, v) => (k in t ? ((t[k] = v), true) : refuse(k)) })
export const valueIn = n => n.value ?? n.attrs.value ?? ''
export const setValue = (n, v) => { n.value = v }
function api(n) {
  const adopt = xs => xs.forEach(x => put(n, realOf.get(x) ?? textNode(String(x))))
  n.api ??= strict({
    get textContent() { return textOf(n) },
    set textContent(v) {
      n.kids = []
      if (v != null && v !== '') put(n, textNode(String(v)))
    },
    get value() { return valueIn(n) },
    set value(v) { setValue(n, String(v)) },
    get type() { return n.attrs.type ?? { button: 'submit', input: 'text' }[n.tag] ?? '' },
    set type(v) { n.attrs.type = String(v) },
    get disabled() { return isDisabled(n) },
    set disabled(v) { n.disabled = Boolean(v) },
    append: (...xs) => adopt(xs),
    replaceChildren: (...xs) => {
      n.kids = []
      adopt(xs)
    },
    addEventListener: (type, fn) => { (n.on[type] ??= []).push(fn) },
  }, `<${n.tag}${n.attrs.id ? ` id=${n.attrs.id}` : ''}>`)
  realOf.set(n.api, n)
  return n.api
}
export const fire = (n, type) => {
  let prevented = false
  const ev = strict({ preventDefault: () => { prevented = true } }, `the ${type} event`)
  for (const fn of n.on[type] ?? []) fn.call(n.api, ev)
  return prevented
}
export const flush = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)) }

let assetsP
export const assets = () => (assetsP ??= (async () => {
  const s = await shared()
  return { html: (await get(s, '/')).text, js: (await get(s, '/app.js')).text }
})())

// app.js in a vm; each fetch call waits for call.reply(status, body) or call.fail().
export async function openPage() {
  const { html, js } = await assets()
  const root = parseHtml(html)
  const page = { calls: [], el: id => byId(root, id) }
  const ctx = vm.createContext({})
  const [P, J, TypeErr] = vm.runInContext('[Promise, JSON, TypeError]', ctx)
  ctx.document = strict({ getElementById: id => { const n = byId(root, String(id)); return n ? api(n) : null }, createElement: tag => api(elem(String(tag).toLowerCase())) }, 'document')
  ctx.fetch = (url, opts) => new P((resolve, reject) => page.calls.push({
    url, opts, method: String(opts?.method ?? 'GET').toUpperCase(), fail: () => reject(new TypeErr('Failed to fetch')),
    reply: (status, body = '', text = typeof body === 'string' ? body : JSON.stringify(body)) => resolve(strict({
      status, json: () => new P((yes, no) => { try { yes(J.parse(text)) } catch (e) { no(e) } }),
    }, 'the fetch reply')),
  }))
  vm.runInContext(js, ctx, { filename: 'app.js', timeout: 5000 })
  await flush()
  return page
}
export const pending = page => page.calls.filter(c => !c.taken).map(c => `${c.method} ${c.url}`)
export function take(page, method, url) {
  const call = page.calls.find(c => !c.taken && c.method === method && c.url === url)
  assert.ok(call, `expected fetch ${method} ${url}; open fetch calls: ${JSON.stringify(pending(page))}`)
  call.taken = true
  assert.deepEqual(Object.keys(call.opts ?? {}).filter(k => !['method', 'headers', 'body'].includes(k)), [], `fetch options of ${method} ${url}`)
  return call
}
export const settle = async (call, how) => {
  how(call)
  await flush()
}
export const errorText = page => textOf(page.el('error'))
export const LIST_FIRST = '/api/parts?limit=20'
// A page with its first list fetch answered. sample: the parts it gets by default, in the part shape of the caller's stage.
export const readyWith = sample => async (parts = sample, next = null) => {
  const page = await openPage()
  await settle(take(page, 'GET', LIST_FIRST), c => c.reply(200, { parts, next }))
  return page
}

// Holds an exclusive lock on the file for holdMs while `start` sends requests, then lets `finish` wait for their replies.
export async function withLock(file, holdMs, start, finish) {
  const sent = await withDb(file, async db => {
    db.exec('BEGIN EXCLUSIVE')
    const requests = start()
    await sleep(holdMs)
    db.exec('COMMIT')
    return requests
  })
  await finish(sent)
}
