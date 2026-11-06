// Shared by the hidden sets of task p1 (the help desk): server processes, raw HTTP, sessions, direct database access, a small
// XML check and a DOM stand-in. TARGET_DIR holds the code under test; S1_DIR the code as it stood after stage 1.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, scryptSync } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { createServer, connect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import vm from 'node:vm'

const TARGET = process.env.TARGET_DIR
export const S1_DIR = process.env.S1_DIR
const JSON_TYPE = 'application/json; charset=utf-8'
const ROOT = mkdtempSync(join(tmpdir(), 'p1-'))
const RM = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }
const running = new Set()

export const ADMIN_PW = 'admin-password-123'
export const USER_PW = 'member-password-123'
// The server is another process, and on Windows each process reads Date.now() through its own timer offset: the same instant
// can read a few ms apart (up to one 15.6 ms timer step). A time the server stores for a request is therefore compared with
// the test's readings taken just before and just after the request, widened by this much on each side. Seconds, a time taken
// at startup or a time of another request are all far outside it.
export const CLOCK_SLACK_MS = 20
export const inWindow = (at, t0, t1) => Number.isInteger(at) && at >= t0 - CLOCK_SLACK_MS && at <= t1 + CLOCK_SLACK_MS
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export const fresh = () => mkdtempSync(join(ROOT, 'c-'))
export const freshDb = () => join(fresh(), 'data.db')
after(async () => {
  for (const s of running) await stopServer(s)
  rmSync(ROOT, RM)
})
// A hung test fails alone instead of running the whole file into the scorer's limit. Node's summary calls it cancelled;
// the scorer counts its `not ok` line as a failure.
export const it = (name, fn, timeout = 90_000) => test(name, { timeout }, fn)
export const tryJson = text => {
  try {
    return JSON.parse(text)
  } catch {
    return `not JSON: ${String(text).slice(0, 200)}`
  }
}
// A failing row of a table test names itself.
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
  const own = ['PORT', 'DB_FILE', 'ADMIN_PASSWORD', 'MODEL_URL', 'NODE_TEST_CONTEXT']
  const kept = Object.entries(process.env).filter(([k]) => !own.includes(k))
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

// ADMIN_PASSWORD is given unless env says otherwise (an explicit undefined removes it).
export async function startServer({ file = freshDb(), cwd, dir, env = {}, waitMs } = {}) {
  const port = await freePort()
  const s = await boot({ PORT: String(port), DB_FILE: file ?? undefined, ADMIN_PASSWORD: ADMIN_PW, ...env }, { cwd, dir, waitMs })
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
  const s = await boot({ PORT: String(await freePort()), ADMIN_PASSWORD: ADMIN_PW, ...env }, { cwd, waitMs })
  const code = s.child.exitCode ?? 'still running'
  await stopServer(s)
  return { code, out: s.out, err: s.err }
}
// Node may print its own warnings on stderr; the server's lines are what is left.
const WARNING = /^\(node:\d+\)|^\(Use `node|^Warning:|ExperimentalWarning/
export const errLines = text => text.replaceAll('\r\n', '\n').split('\n').filter(l => l !== '' && !WARNING.test(l))
// A refusal: exit 1, nothing on stdout, and the line given as the only line on stderr.
export const refused = (r, line) => ({ code: r.code, out: r.out, lines: errLines(r.err) })
export const REFUSED = line => ({ code: 1, out: '', lines: [line] })

// --- Raw HTTP ---
// body: object → JSON (type application/json unless `type` says otherwise; null: none), string/Buffer → raw.
// as: a session from sessionOf (its cookie is sent); headers: more request headers.
export function req(s, method, path, { body, parts, type, gap = 50, as, headers: more = {} } = {}) {
  const chunks = parts ?? (body === undefined ? [] : [typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)])
  const framing = parts ? { 'transfer-encoding': 'chunked' } : chunks.length ? { 'content-length': String(Buffer.byteLength(chunks[0])) } : {}
  const headers = {
    ...framing,
    ...(type !== null && (type !== undefined || chunks.length > 0) && { 'content-type': type ?? 'application/json' }),
    ...(as && { cookie: as.cookie }),
    ...more,
  }
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: s.port, method, path, headers, agent: false }, res => {
      const got = []
      res.on('data', d => got.push(d)).on('error', reject).on('end', () => resolve({
        status: res.statusCode, type: res.headers['content-type'], text: Buffer.concat(got).toString('utf8'), headers: res.headers,
      }))
    })
    r.setTimeout(30_000, () => r.destroy(new Error(`${method} ${path}: no reply within 30 s`))).on('error', reject)
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
export const get = (s, path, opts) => req(s, 'GET', path, opts)
export const post = (s, path, body, opts = {}) => req(s, 'POST', path, { body, ...opts })
export const patch = (s, path, body, opts = {}) => req(s, 'PATCH', path, { body, ...opts })
export const del = (s, path, opts) => req(s, 'DELETE', path, opts)
// The same four, bound to a server and a session.
export const api = (s, as) => ({
  get: (path, o) => get(s, path, { as, ...o }),
  post: (path, body, o) => post(s, path, body, { as, ...o }),
  patch: (path, body, o) => patch(s, path, body, { as, ...o }),
  del: (path, o) => del(s, path, { as, ...o }),
  req: (method, path, o) => req(s, method, path, { as, ...o }),
})

export async function ok(pending, status, label = '') {
  const r = await pending
  assert.equal(r.status, status, `${label} replied ${r.status} ${r.text.slice(0, 300)}`)
  return r.text === '' ? null : JSON.parse(r.text)
}

// --- Sessions and the things most cases need ---
export const sha256 = text => createHash('sha256').update(text).digest('hex')
export const cookieOf = r => /^sid=([0-9a-f]{64});/.exec(r.headers['set-cookie']?.[0] ?? '')?.[1]
export async function sessionOf(s, username, password) {
  const r = await post(s, '/api/session', { username, password })
  const token = cookieOf(r)
  assert.ok(token, `login of ${username} replied ${r.status} ${r.text.slice(0, 200)}`)
  return { token, cookie: `sid=${token}`, user: JSON.parse(r.text).user }
}
const admins = new WeakMap()
export const adminOf = s => {
  if (!admins.has(s)) admins.set(s, sessionOf(s, 'admin', ADMIN_PW))
  return admins.get(s)
}
let counter = 0
export const nextName = (prefix = 'u') => `${prefix}_${++counter}`
// A new user made through the API by `A` (an admin session), logged in.
export async function userOf(s, A, { username = nextName(), role = 'member', password = USER_PW } = {}) {
  const made = await ok(post(s, '/api/users', { username, password, role }, { as: A }), 201, `POST user ${username}`)
  return { ...(await sessionOf(s, username, password)), password, made }
}
export const ticketOf = (s, as, title = 'A ticket', description = 'Something is wrong', extra = {}) => ok(post(s, '/api/tickets', { title, description, ...extra }, { as }), 201, `POST ticket ${title}`)
export const commentOf = (s, as, ticketId, text = 'A comment') => ok(post(s, `/api/tickets/${ticketId}/comments`, { text }, { as }), 201, `POST comment on ${ticketId}`)

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

// --- The database, as another tool uses it ---
// The tables of the task text, word for word.
export const SCHEMA_SQL = `CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member'))
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'pending', 'closed')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL
) STRICT;
PRAGMA user_version = 1;`
export const TABLES = ['audit', 'comments', 'login_failures', 'sessions', 'tickets', 'users']

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
export const version = db => db.prepare('PRAGMA user_version').get().user_version
// Plain copies: node:sqlite's rows have a null prototype, which deepEqual tells from an object's.
export const rowsOf = (db, sql, ...params) => db.prepare(sql).all(...params).map(row => ({ ...row }))
export const rows = (file, sql, ...params) => withDb(file, db => rowsOf(db, sql, ...params))

// A version 1 database made as another tool would have made it (no users unless given).
export function plantV1(file, statements = '') {
  withDb(file, db => db.exec(`${SCHEMA_SQL}\n${statements}`))
  return file
}

// What the file holds: everything a refusal must leave alone.
export const dump = file => withDb(file, db => Object.fromEntries([
  ['version', version(db)],
  ...TABLES.map(t => [t, rowsOf(db, `SELECT * FROM ${t} ORDER BY 1`)]),
  ['sequences', rowsOf(db, 'SELECT name, seq FROM sqlite_sequence ORDER BY name')],
]))

// The schema a tool sees, free of how it was written.
export const schemaOf = file => withDb(file, db => ({
  version: version(db),
  tables: rowsOf(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(t => t.name),
  others: rowsOf(db, "SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'view')"),
  strict: rowsOf(db, "SELECT name, strict FROM pragma_table_list WHERE name NOT LIKE 'sqlite_%' ORDER BY name").map(t => [t.name, t.strict]),
  columns: Object.fromEntries(TABLES.map(t => [t, rowsOf(db, `PRAGMA table_info(${t})`).map(c => [c.name, c.type, c.notnull, c.dflt_value, c.pk])])),
  unique: Object.fromEntries(TABLES.map(t => [t, [...new Set(rowsOf(db, `PRAGMA index_list(${t})`).filter(i => i.unique === 1).flatMap(i => rowsOf(db, `PRAGMA index_info("${i.name}")`).map(c => c.name)))].sort()])),
  keys: Object.fromEntries(TABLES.map(t => [t, rowsOf(db, `PRAGMA foreign_key_list(${t})`).map(k => [k.table, k.from, k.to, k.on_delete])])),
  autoincrement: rowsOf(db, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(t => [t.name, /AUTOINCREMENT/i.test(t.sql)]),
  integrity: rowsOf(db, 'PRAGMA integrity_check').map(r => r.integrity_check),
}))
export const EXPECTED_SCHEMA = (() => {
  const file = join(ROOT, 'expected.db')
  plantV1(file)
  return schemaOf(file)
})()

// The password hash of a password, as the task defines it, and the check of a stored one.
export const SCRYPT = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/
export const scryptHash = (password, saltHex = '00112233445566778899aabbccddeeff') => `scrypt$${saltHex}$${scryptSync(Buffer.from(password, 'utf8'), Buffer.from(saltHex, 'hex'), 64).toString('hex')}`
export function passwordMatches(password, stored) {
  const m = SCRYPT.exec(stored)
  return Boolean(m) && scryptHash(password, m[1]) === stored
}

// --- Raw sockets, for requests that arrive in pieces ---
export function rawExchange(port, steps) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    const seen = []
    let got = ''
    socket.setEncoding('utf8').on('data', d => { got += d }).on('error', reject)
    ;(async () => {
      for (const step of steps) {
        if (typeof step === 'number') {
          await sleep(step)
          seen.push(got.length)
        } else {
          socket.write(step)
        }
      }
      await sleep(300)
      socket.destroy()
      resolve({ got, seen })
    })().catch(reject)
  })
}

// --- XML: a strict little parser, enough to tell a well-formed document from one that is not ---
export function parseXml(text) {
  const name = '[A-Za-z_:][-A-Za-z0-9_:.]*'
  const re = new RegExp(`<!--[\\s\\S]*?-->|<\\?[\\s\\S]*?\\?>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>|<!DOCTYPE[^>]*>|</(${name})\\s*>|<(${name})((?:\\s+${name}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>|[^<]+|<`, 'g')
  const entity = /&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);)/
  const root = { tag: '#document', attrs: {}, kids: [] }
  const stack = [root]
  let last = 0
  for (let m; (m = re.exec(text));) {
    if (m.index !== last) throw new Error(`not well-formed XML near ${text.slice(last, last + 30)}`)
    last = re.lastIndex
    const top = stack.at(-1)
    if (m[0] === '<') throw new Error('stray < in XML')
    if (m[1] !== undefined) {
      if (top.tag !== m[1]) throw new Error(`</${m[1]}> closes <${top.tag}>`)
      stack.pop()
    } else if (m[2] !== undefined) {
      const attrs = {}
      for (const [, k, v] of m[3].matchAll(new RegExp(`(${name})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g'))) {
        const value = v ?? ''
        if (Object.hasOwn(attrs, k)) throw new Error(`attribute ${k} twice`)
        if (entity.test(value)) throw new Error('bad entity in attribute')
        attrs[k] = value
      }
      const el = { tag: m[2], attrs, kids: [] }
      top.kids.push(el)
      if (m[4] !== '/') stack.push(el)
    } else if (m[0].startsWith('<!--') || m[0].startsWith('<?') || m[0].startsWith('<!DOCTYPE')) {
      top.kids.push({ tag: '#other', text: m[0] })
    } else {
      if (entity.test(m[0]) || m[0].includes(']]>')) throw new Error('bad entity in text')
      top.kids.push({ tag: '#text', text: m[0] })
    }
  }
  if (last !== text.length || stack.length !== 1) throw new Error('XML does not end well')
  const roots = root.kids.filter(k => k.tag !== '#text' || k.text.trim() !== '')
  if (roots.length !== 1 || roots[0].tag.startsWith('#')) throw new Error('XML needs exactly one root element')
  return roots[0]
}

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
// A select's value is its selected option's, else the first option's; any other field's is the value last set, else its attribute.
export function valueIn(n) {
  if (n.value !== undefined) return n.value
  if (n.tag === 'select') {
    const options = all(n).filter(o => o.tag === 'option')
    const chosen = options.find(o => 'selected' in o.attrs) ?? options[0]
    return chosen ? chosen.attrs.value ?? textOf(chosen) : ''
  }
  return n.attrs.value ?? ''
}
export const setValue = (n, v) => { n.value = v }
export const isHidden = n => n.hiddenSet ?? 'hidden' in n.attrs
export const isDisabled = n => n.disabled ?? 'disabled' in n.attrs
function api_(n) {
  const adopt = xs => xs.forEach(x => put(n, realOf.get(x) ?? textNode(String(x))))
  n.api ??= strict({
    get textContent() { return textOf(n) },
    set textContent(v) {
      n.kids = []
      if (v != null && v !== '') put(n, textNode(String(v)))
    },
    get value() { return valueIn(n) },
    set value(v) { setValue(n, String(v)) },
    get disabled() { return isDisabled(n) },
    set disabled(v) { n.disabled = Boolean(v) },
    get hidden() { return isHidden(n) },
    set hidden(v) { n.hiddenSet = Boolean(v) },
    get src() { return n.attrs.src ?? '' },
    set src(v) { n.attrs.src = String(v) },
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
export const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)) }

let assetsP
export const assets = () => (assetsP ??= (async () => {
  const s = await shared()
  return { html: (await get(s, '/')).text, js: (await get(s, '/app.js')).text }
})())

// app.js in a vm; each fetch call waits for call.reply(status, body) or call.fail().
export async function openPage() {
  const { html, js } = await assets()
  const root = parseHtml(html)
  const page = { calls: [], root, el: id => byId(root, id) }
  const ctx = vm.createContext({})
  const [P, J, TypeErr] = vm.runInContext('[Promise, JSON, TypeError]', ctx)
  ctx.document = strict({ getElementById: id => { const n = byId(root, String(id)); return n ? api_(n) : null }, createElement: tag => api_(elem(String(tag).toLowerCase())) }, 'document')
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

// The error messages of the task text.
export const E = {
  notFound: 'not found', methodNotAllowed: 'method not allowed', login: 'login required', forbidden: 'forbidden',
  contentType: 'content type must be application/json', tooLarge: 'body too large', notObject: 'body must be a JSON object',
  userNotFound: 'user not found', ticketNotFound: 'ticket not found',
  strings: 'username and password must be strings', tooMany: 'too many login attempts', wrong: 'wrong username or password',
  username: 'username must be 3 to 32 lowercase letters, digits or underscores', password: 'password must be 12 to 200 characters',
  role: 'role must be admin or member', exists: 'username already exists', nothing: 'nothing to change', lastAdmin: 'cannot remove the last admin',
  title: 'title must be 1 to 120 characters', description: 'description must be 1 to 5000 characters', priority: 'priority must be low, normal or high',
  status: 'status must be open, pending or closed', text: 'text must be 1 to 2000 characters', closed: 'ticket is closed',
  limit: 'limit must be 1 to 100', before: 'before must be a positive whole number', busy: 'database busy', internal: 'internal error',
}
