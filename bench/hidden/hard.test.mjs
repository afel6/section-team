import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:net'

const TARGET = process.env.TARGET_DIR
const TOKEN = 'bench-secret-token'

const freePort = () => new Promise((resolve, reject) => {
  const s = createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
})

async function startServer(dbFile) {
  const port = await freePort()
  const child = spawn(process.execPath, [join(TARGET, 'server.mjs')], {
    cwd: TARGET,
    env: { ...process.env, PORT: String(port), DB_FILE: dbFile, ADMIN_TOKEN: TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let out = ''
  let err = ''
  child.stderr.on('data', d => { err += d })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not print "listening on" within 20 s. stdout: ${out.slice(0, 500)} stderr: ${err.slice(0, 500)}`)), 20000)
    child.stdout.on('data', d => {
      out += d
      if (/listening on/i.test(out)) { clearTimeout(timer); resolve() }
    })
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server exited early (${code}). stderr: ${err.slice(0, 800)}`)) })
  })
  return { port, child, base: `http://localhost:${port}` }
}

async function stopServer(s) {
  if (!s || s.child.exitCode !== null) return
  const done = new Promise(resolve => s.child.once('exit', resolve))
  if (process.platform === 'win32') {
    try { execFileSync('taskkill', ['/PID', String(s.child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
  } else {
    s.child.kill('SIGTERM')
  }
  await Promise.race([done, new Promise(r => setTimeout(r, 5000))])
}

const post = (s, body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${s.base}/api/links`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })

let dir
let dbFile
let srv
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'short-'))
  dbFile = join(dir, 'links.db')
  srv = await startServer(dbFile)
})
after(async () => { await stopServer(srv) })

let createdCode
test('POST creates a link with a generated 7-char code', async () => {
  const r = await post(srv, { url: 'https://example.com/a?b=1' })
  assert.equal(r.status, 201)
  assert.match(r.headers.get('content-type') ?? '', /application\/json/)
  const j = await r.json()
  assert.match(j.code, /^[A-Za-z0-9]{7}$/)
  assert.equal(new URL(j.url).href, new URL('https://example.com/a?b=1').href)
  assert.equal(j.short, `http://localhost:${srv.port}/${j.code}`)
  createdCode = j.code
})

test('GET /<code> redirects with 302 and counts the click', async () => {
  const r = await fetch(`${srv.base}/${createdCode}`, { redirect: 'manual' })
  assert.equal(r.status, 302)
  assert.equal(new URL(r.headers.get('location')).href, new URL('https://example.com/a?b=1').href)
  const s = await fetch(`${srv.base}/api/links/${createdCode}`)
  assert.equal(s.status, 200)
  const j = await s.json()
  assert.equal(j.code, createdCode)
  assert.equal(new URL(j.url).href, new URL('https://example.com/a?b=1').href)
  assert.equal(j.clicks, 1)
  assert.ok(!Number.isNaN(Date.parse(j.createdAt)), 'createdAt is a date string')
})

test('custom code works and duplicates are 409', async () => {
  const r = await post(srv, { url: 'http://example.org', code: 'my-link_1' })
  assert.equal(r.status, 201)
  assert.equal((await r.json()).code, 'my-link_1')
  const dup = await post(srv, { url: 'http://example.org/other', code: 'my-link_1' })
  assert.equal(dup.status, 409)
})

test('invalid code → 400', async () => {
  for (const code of ['ab', 'bad code!', 'x'.repeat(33)]) {
    const r = await post(srv, { url: 'https://example.com', code })
    assert.equal(r.status, 400, `code ${code}`)
  }
})

test('invalid url → 400', async () => {
  for (const url of ['ftp://example.com/file', 'not a url', `https://example.com/${'a'.repeat(2048)}`, 42]) {
    const r = await post(srv, { url })
    assert.equal(r.status, 400, `url ${String(url).slice(0, 40)}`)
  }
})

test('wrong content type → 415, invalid JSON → 400, body over 10 KB → 413', async () => {
  const ct = await post(srv, JSON.stringify({ url: 'https://example.com' }), { 'content-type': 'text/plain' })
  assert.equal(ct.status, 415)
  const bad = await post(srv, '{"url": ')
  assert.equal(bad.status, 400)
  const big = await post(srv, JSON.stringify({ url: 'https://example.com/', pad: 'x'.repeat(11 * 1024) }))
  assert.equal(big.status, 413)
})

test('unknown codes → 404', async () => {
  assert.equal((await fetch(`${srv.base}/api/links/zzzzzzz`)).status, 404)
  assert.equal((await fetch(`${srv.base}/zzzzzzz`, { redirect: 'manual' })).status, 404)
})

test('DELETE needs the admin token', async () => {
  const created = await (await post(srv, { url: 'https://delete.me', code: 'to-delete' })).json()
  assert.equal(created.code, 'to-delete')
  assert.equal((await fetch(`${srv.base}/api/links/to-delete`, { method: 'DELETE' })).status, 401)
  assert.equal((await fetch(`${srv.base}/api/links/to-delete`, { method: 'DELETE', headers: { 'x-admin-token': 'wrong' } })).status, 401)
  const ok = await fetch(`${srv.base}/api/links/to-delete`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } })
  assert.equal(ok.status, 204)
  assert.equal((await fetch(`${srv.base}/api/links/to-delete`)).status, 404)
  assert.equal((await fetch(`${srv.base}/api/links/never-was`, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } })).status, 404)
})

test('GET / serves the HTML page with a url form', async () => {
  const r = await fetch(`${srv.base}/`)
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-type') ?? '', /text\/html/)
  const html = await r.text()
  assert.match(html, /<form/i)
  assert.match(html, /name=["']url["']/i)
})

test('frontend never assigns dynamic content to innerHTML', () => {
  const pub = join(TARGET, 'public')
  assert.ok(existsSync(pub), 'public/ exists')
  const files = []
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else if (['.js', '.mjs', '.html'].includes(extname(n))) files.push(p) } }
  walk(pub)
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
    const risky = code.match(/\.(?:inner|outer)HTML\s*\+?=(?!=)(?!\s*(['"`])\1\s*(?:[;,)}\n]|$))/g)
    assert.equal(risky, null, `${f} assigns non-empty content to innerHTML/outerHTML`)
  }
})

test('data persists across a restart', async () => {
  await stopServer(srv)
  srv = await startServer(dbFile)
  const r = await fetch(`${srv.base}/api/links/my-link_1`)
  assert.equal(r.status, 200)
  assert.equal(new URL((await r.json()).url).href, new URL('http://example.org').href)
})

test('rate limit: the 21st POST within a minute → 429', async () => {
  const fresh = await startServer(join(dir, 'rate.db'))
  try {
    const statuses = []
    for (let i = 0; i < 21; i++) statuses.push((await post(fresh, { url: `https://example.com/${i}` })).status)
    assert.deepEqual(statuses.slice(0, 20), Array(20).fill(201))
    assert.equal(statuses[20], 429)
  } finally {
    await stopServer(fresh)
  }
})
