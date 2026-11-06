// Stage 2: the reporting API and the chart (here), the page and its script (stage-two-page.mjs). Runs on the code after stage 2
// (set s2) and on the final code (set reg3).
import assert from 'node:assert/strict'
import { E, adminOf, answer, err, expect, get, it, ok, parseXml, req, same, userOf, view, withDb, withServer } from './lib.mjs'
import { pageCases } from './stage-two-page.mjs'

const DAY = 86_400_000
const at = iso => Date.parse(iso)
const M = { priority: 'priority must be low, normal or high', from: 'from must be a valid YYYY-MM-DD date', to: 'to must be a valid YYYY-MM-DD date', order: 'from must not be after to', by: 'created_by must be a positive whole number' }
const STATUSES = ['open', 'pending', 'closed']

export function stageTwoCases() {
  reportCases()
  chartCases()
  pageCases()
}

// Tickets planted straight into the database: [owner key, status, priority, created_at]. Two members own most of them.
const PLANTED = [
  ['m1', 'open', 'low', at('2026-03-09T23:59:59.999Z')], ['m1', 'open', 'low', at('2026-03-10T00:00:00.000Z')], ['m1', 'pending', 'normal', at('2026-03-10T12:00:00.000Z')],
  ['m2', 'closed', 'high', at('2026-03-10T23:59:59.999Z')], ['m2', 'open', 'high', at('2026-03-11T00:00:00.000Z')], ['a', 'closed', 'low', at('2028-02-29T12:00:00.000Z')],
  ['a', 'pending', 'high', at('2000-01-01T00:00:00.000Z')], ['a', 'open', 'normal', at('2099-12-31T23:59:59.999Z')], ['m1', 'closed', 'normal', at('2026-03-15T08:00:00.000Z')],
  ['m2', 'pending', 'low', at('2026-03-15T09:00:00.000Z')],
]

async function reportWorld(s) {
  const A = await adminOf(s)
  const m1 = await userOf(s, A)
  const m2 = await userOf(s, A)
  const owner = { a: A.user.id, m1: m1.made.id, m2: m2.made.id }
  const tickets = PLANTED.map(([who, status, priority, created_at]) => ({ title: 't', description: 'd', status, priority, created_by: owner[who], created_at }))
  withDb(s.file, db => {
    const add = db.prepare('INSERT INTO tickets (title, description, status, priority, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    for (const t of tickets) add.run(t.title, t.description, t.status, t.priority, t.created_by, t.created_at)
  })
  return { A, m1, m2, tickets }
}

// What the task says a filter keeps, written the plain way.
function expected(tickets, user, f = {}) {
  const kept = tickets.filter(t => (user.role === 'admin' || t.created_by === user.id)
    && (!f.priority || t.priority === f.priority)
    && (!f.from || t.created_at >= at(`${f.from}T00:00:00.000Z`))
    && (!f.to || t.created_at < at(`${f.to}T00:00:00.000Z`) + DAY)
    && (user.role !== 'admin' || f.created_by === undefined || t.created_by === f.created_by))
  const counts = Object.fromEntries(STATUSES.map(st => [st, kept.filter(t => t.status === st).length]))
  return { counts, total: kept.length }
}
const query = f => {
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v !== undefined))
  return q.size ? `?${q}` : ''
}

const FILTERS = [
  {}, { priority: 'low' }, { priority: 'high' }, { priority: '' }, { from: '2026-03-10' }, { to: '2026-03-10' }, { from: '2026-03-10', to: '2026-03-10' }, { from: '2026-03-11', to: '2026-03-11' },
  { to: '2026-03-09' }, { from: '2026-03-10', priority: 'high' }, { from: '2026-02-01', to: '2026-03-31', priority: 'normal' }, { from: '2028-02-29', to: '2028-02-29' }, { from: '2000-01-01', to: '2000-01-01' },
  { from: '2099-12-31' }, { to: '2099-12-31' }, { from: '2000-01-01', to: '2099-12-31' }, { from: '', to: '2026-03-10' }, { from: '2026-03-10', to: '' }, { from: '2000-02-29', to: '2096-02-29' },
]

function reportCases() {
  it('GET /api/reports/summary: the counts of the tickets the user sees that pass the filters; days are UTC and both ends are inclusive days', async () => {
    await withServer({}, async s => {
      const { A, m1, m2, tickets } = await reportWorld(s)
      for (const who of [A, m1, m2]) {
        for (const f of FILTERS) {
          const user = who.user
          same(`${user.role}${user.id} ${JSON.stringify(f)}`, view(await get(s, `/api/reports/summary${query(f)}`, { as: who })), answer(200, expected(tickets, user, f)))
        }
      }
      const byAdmin = [{ created_by: A.user.id }, { created_by: m1.made.id }, { created_by: m2.made.id }, { created_by: 999 }, { created_by: 99999999999999999999 }, { created_by: m1.made.id, priority: 'low', from: '2026-03-10' }]
      for (const f of byAdmin) same(`created_by ${JSON.stringify(f)}`, view(await get(s, `/api/reports/summary${query({ ...f, created_by: String(BigInt(f.created_by)) })}`, { as: A })), answer(200, expected(tickets, A.user, f)))
      const r = await ok(get(s, '/api/reports/summary', { as: A }), 200)
      assert.equal(Object.values(r.counts).every(n => typeof n === 'number') && typeof r.total === 'number', true, 'counts are JSON numbers')
      assert.deepEqual(Object.keys(r.counts), STATUSES)
    })
  })

  it('a member\'s report counts only their own tickets and ignores created_by, even when it is invalid', async () => {
    await withServer({}, async s => {
      const { m1, m2, tickets } = await reportWorld(s)
      for (const by of ['abc', '0', `${m2.made.id}`, `${m1.made.id}`, '', '-1', '99999']) {
        same(`created_by=${by}`, view(await get(s, `/api/reports/summary?created_by=${by}&priority=low`, { as: m1 })), answer(200, expected(tickets, m1.user, { priority: 'low' })))
      }
      same('the other member', view(await get(s, '/api/reports/summary', { as: m2 })), answer(200, expected(tickets, m2.user)))
    })
  })

  it('the filters are checked in the order priority, from, to, from-after-to, created_by; an empty value counts as absent; a repeated name means its first value', async () => {
    await withServer({}, async s => {
      const { A, m1, tickets } = await reportWorld(s)
      const dates = ['2026-02-29', '2023-02-29', '2001-02-29', '2000-02-30', '2100-01-01', '1999-12-31', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32', '2026-1-1', '26-01-01', '%EF%BC%92026-01-01',
        '2026-01-01T00:00:00', '%202026-01-01', '2026-01-01%20', '2026/01/01', 'abcd-ef-gh', '2026-01-01x', '0000-01-01', '2026-01-01Z', '%D9%A2026-01-01']
      for (const d of dates) {
        await expect(`from=${d}`, get(s, `/api/reports/summary?from=${d}`, { as: A }), 400, err(M.from))
        await expect(`to=${d}`, get(s, `/api/reports/summary?to=${d}`, { as: m1 }), 400, err(M.to))
      }
      for (const d of ['2000-01-01', '2099-12-31', '2028-02-29', '2000-02-29', '2096-02-29', '2026-02-28', '2026-12-31', '2026-03-10']) {
        assert.equal((await get(s, `/api/reports/summary?from=${d}&to=${d}`, { as: A })).status, 200, d)
      }
      for (const p of ['urgent', 'HIGH', 'Low', '%20', 'low%20', 'normal,high', '0']) await expect(`priority=${p}`, get(s, `/api/reports/summary?priority=${p}`, { as: A }), 400, err(M.priority))
      for (const by of ['abc', '0', '00', '01', '-1', '1.5', '%201', '1e2', '%D9%A1', '0x1', '1%20']) await expect(`created_by=${by}`, get(s, `/api/reports/summary?created_by=${by}`, { as: A }), 400, err(M.by))
      const order = [
        ['priority=x&from=bad&to=bad&created_by=bad', M.priority], ['from=bad&to=bad&created_by=bad', M.from], ['to=bad&created_by=bad', M.to], ['from=2026-03-10&to=2026-03-09&created_by=bad', M.order],
        ['created_by=bad', M.by], ['from=bad&to=2026-03-01', M.from], ['from=2026-03-01&to=bad', M.to], ['from=2026-03-11&to=2026-03-10', M.order], ['from=2099-12-31&to=2000-01-01', M.order],
        ['priority=low&priority=bad', null], ['priority=bad&priority=low', M.priority], ['from=bad&from=2026-03-10', M.from], ['from=2026-03-10&from=bad&to=2026-03-10', null],
        ['priority=&from=&to=&created_by=', null], ['priority=&from=bad', M.from], ['from=&to=2026-03-10', null], ['created_by=&priority=low', null],
      ]
      for (const [q, message] of order) {
        const r = view(await get(s, `/api/reports/summary?${q}`, { as: A }))
        same(q, { status: r.status, error: r.status === 400 ? r.body.error : undefined }, message ? { status: 400, error: message } : { status: 200, error: undefined })
      }
      same('equal days are fine', { status: (await get(s, '/api/reports/summary?from=2026-03-10&to=2026-03-10', { as: A })).status }, { status: 200 })
      same('a first value wins', view(await get(s, '/api/reports/summary?priority=low&priority=high', { as: A })), answer(200, expected(tickets, A.user, { priority: 'low' })))
      same('percent-encoded names and values', view(await get(s, '/api/reports/summary?%70riority=%6Cow', { as: A })), answer(200, expected(tickets, A.user, { priority: 'low' })))
      same('other names are ignored', view(await get(s, '/api/reports/summary?color=red&limit=abc', { as: A })), answer(200, expected(tickets, A.user)))
    })
  })

  it('the report routes need a session, answer 405 to other methods, and read the database each time', async () => {
    await withServer({}, async s => {
      const { A, tickets } = await reportWorld(s)
      for (const path of ['/api/reports/summary', '/api/reports/chart.svg']) {
        await expect(`${path} without a session`, get(s, path), 401, err(E.login))
        for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
          await expect(`${method} ${path}`, req(s, method, path, { as: A }), 405, err(E.methodNotAllowed))
          await expect(`${method} ${path} without a session`, req(s, method, path), 405, err(E.methodNotAllowed))
        }
        await expect(`${path}/`, get(s, `${path}/`, { as: A }), 404, err(E.notFound))
      }
      await expect('unknown report', get(s, '/api/reports/other', { as: A }), 404, err(E.notFound))
      withDb(s.file, db => db.exec("UPDATE tickets SET status = 'closed' WHERE id <= 3"))
      const now = tickets.map((t, i) => (i < 3 ? { ...t, status: 'closed' } : t))
      same('changed by another tool', view(await get(s, '/api/reports/summary', { as: A })), answer(200, expected(now, A.user)))
      withDb(s.file, db => db.exec('DELETE FROM tickets'))
      same('emptied by another tool', view(await get(s, '/api/reports/summary', { as: A })), answer(200, { counts: { open: 0, pending: 0, closed: 0 }, total: 0 }))
    })
  })
}

function svgOf(text) {
  assert.ok(text.startsWith('<svg'), `the body starts with ${JSON.stringify(text.slice(0, 20))}`)
  const root = parseXml(text)
  const significant = root.kids.filter(k => !(k.tag === '#text' && k.text.trim() === ''))
  assert.equal(significant.every(k => k.tag !== '#text' && k.tag !== '#other'), true, 'the root holds elements and whitespace only')
  return { root, kids: significant }
}

function checkChart(text, counts) {
  const { root, kids } = svgOf(text)
  same('root', { tag: root.tag, xmlns: root.attrs.xmlns, width: root.attrs.width, height: root.attrs.height, viewBox: root.attrs.viewBox }, { tag: 'svg', xmlns: 'http://www.w3.org/2000/svg', width: '320', height: '200', viewBox: '0 0 320 200' })
  assert.deepEqual(kids.map(k => k.tag), ['title', 'rect', 'text', 'rect', 'text', 'rect', 'text'])
  assert.equal(kids[0].kids.map(k => k.text ?? '').join(''), 'Tickets by status')
  const most = Math.max(...STATUSES.map(st => counts[st]))
  STATUSES.forEach((status, i) => {
    const h = most === 0 ? 0 : Math.round(150 * counts[status] / most)
    const rect = kids[1 + 2 * i]
    const label = kids[2 + 2 * i]
    same(`rect ${status}`, { x: rect.attrs.x, y: rect.attrs.y, width: rect.attrs.width, height: rect.attrs.height }, { x: String(20 + 100 * i), y: String(170 - h), width: '80', height: String(h) })
    same(`text ${status}`, { x: label.attrs.x, y: label.attrs.y, anchor: label.attrs['text-anchor'], text: label.kids.map(k => k.text ?? 'ELEMENT').join('') }, { x: String(60 + 100 * i), y: '190', anchor: 'middle', text: `${status} ${counts[status]}` })
    for (const value of [rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height, label.attrs.x, label.attrs.y]) assert.match(value, /^[0-9]+$/, 'numbers are plain ASCII digits')
  })
}

function chartCases() {
  it('GET /api/reports/chart.svg: image/svg+xml, well-formed, the exact elements and numbers of the task, for the same tickets and filters as the summary', async () => {
    await withServer({}, async s => {
      const { A, m1, m2, tickets } = await reportWorld(s)
      for (const who of [A, m1, m2]) {
        for (const f of FILTERS) {
          const r = await get(s, `/api/reports/chart.svg${query(f)}`, { as: who })
          same(`${who.user.role}${who.user.id} ${JSON.stringify(f)} type`, { status: r.status, type: r.type }, { status: 200, type: 'image/svg+xml; charset=utf-8' })
          checkChart(r.text, expected(tickets, who.user, f).counts)
        }
      }
      same('created_by', { status: (await get(s, `/api/reports/chart.svg?created_by=${m1.made.id}`, { as: A })).status }, { status: 200 })
      checkChart((await get(s, `/api/reports/chart.svg?created_by=${m1.made.id}`, { as: A })).text, expected(tickets, A.user, { created_by: m1.made.id }).counts)
    })
  })

  it('the chart bars: heights are Math.round(150 * count / largest), 0 when nothing matches, and the labels hold the counts', async () => {
    await withServer({}, async s => {
      const A = await adminOf(s)
      const sets = [[0, 0, 0], [1, 2, 3], [1, 2, 7], [1, 3, 4], [5, 0, 0], [0, 0, 2], [2, 2, 2], [1, 1, 200], [3, 1, 4], [7, 3, 1]]
      for (const triple of sets) {
        withDb(s.file, db => {
          db.exec('DELETE FROM tickets')
          const add = db.prepare("INSERT INTO tickets (title, description, status, priority, created_by, created_at) VALUES ('t', 'd', ?, 'low', 1, 5)")
          STATUSES.forEach((st, i) => { for (let n = 0; n < triple[i]; n++) add.run(st) })
        })
        const counts = Object.fromEntries(STATUSES.map((st, i) => [st, triple[i]]))
        const r = await get(s, '/api/reports/chart.svg', { as: A })
        checkChart(r.text, counts)
        same(`summary ${triple}`, view(await get(s, '/api/reports/summary', { as: A })), answer(200, { counts, total: triple.reduce((a, b) => a + b, 0) }))
      }
    })
  })

  it('the chart answers the same errors as the summary, as JSON', async () => {
    await withServer({}, async s => {
      const { A, m1 } = await reportWorld(s)
      for (const [q, who, message] of [['priority=x', A, M.priority], ['from=2026-02-30', A, M.from], ['to=x', m1, M.to], ['from=2026-03-11&to=2026-03-10', A, M.order], ['created_by=x', A, M.by]]) {
        await expect(q, get(s, `/api/reports/chart.svg?${q}`, { as: who }), 400, err(message))
      }
    })
  })

  it('/ and /app.js need no session and no database: text/html and text/javascript, 200, even while the database is locked', async () => {
    await withServer({}, async s => {
      const page = await get(s, '/')
      const script = await get(s, '/app.js')
      same('page', { status: page.status, type: page.type, html: /^\s*<!doctype html/i.test(page.text) }, { status: 200, type: 'text/html; charset=utf-8', html: true })
      same('script', { status: script.status, type: script.type, text: script.text.length > 100 }, { status: 200, type: 'text/javascript; charset=utf-8', text: true })
      same('with a query', { page: (await get(s, '/?x=1')).status, script: (await get(s, '/app.js?v=2')).status }, { page: 200, script: 200 })
      await withDb(s.file, async db => {
        db.exec('BEGIN EXCLUSIVE')
        try {
          const t0 = Date.now()
          same('locked', { page: (await get(s, '/')).status, script: (await get(s, '/app.js')).status }, { page: 200, script: 200 })
          assert.ok(Date.now() - t0 < 2000)
        } finally {
          db.exec('ROLLBACK')
        }
      })
      for (const path of ['/', '/app.js']) {
        await expect(`POST ${path}`, req(s, 'POST', path), 405, err(E.methodNotAllowed))
        await expect(`DELETE ${path}`, req(s, 'DELETE', path), 405, err(E.methodNotAllowed))
      }
      for (const path of ['/app.js/', '//', '/index.html', '/APP.JS', '/app.js%2F']) same(path, view(await get(s, path)), answer(404, err(E.notFound)))
    })
  })
}
