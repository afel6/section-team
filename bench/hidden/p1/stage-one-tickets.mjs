// Stage 1, tickets and comments: shapes, rules, lists, who sees what, and the audit entries they leave.
import assert from 'node:assert/strict'
import { E, inWindow, adminOf, answer, api, commentOf, err, expect, it, ok, req, rows, same, shared, ticketOf, userOf, view, withServer, sessionOf, ADMIN_PW } from './lib.mjs'

const TICKET_KEYS = ['created_at', 'created_by', 'description', 'id', 'priority', 'status', 'title']
const COMMENT_KEYS = ['created_at', 'id', 'text', 'ticket_id', 'user_id']

export function ticketCases() {
  createCases()
  readCases()
  patchCases()
  deleteCases()
  commentCases()
  listCases()
}

function createCases() {
  it('POST /api/tickets: 201 and the ticket (open, normal unless given, trimmed text, the session user, the request time), one audit entry at that time', async () => {
    await withServer({}, async s => {
      const c = api(s, await sessionOf(s, 'admin', ADMIN_PW))
      const t0 = Date.now()
      const r = await c.post('/api/tickets', { title: '  A title\n', description: '  Some text\t ', status: 'closed', created_by: 9, id: 40, created_at: 1 })
      const t1 = Date.now()
      const ticket = JSON.parse(r.text)
      assert.deepEqual(Object.keys(ticket).sort(), TICKET_KEYS)
      same('ticket', { status: r.status, id: ticket.id, title: ticket.title, description: ticket.description, state: ticket.status, priority: ticket.priority, created_by: ticket.created_by }, { status: 201, id: 1, title: 'A title', description: 'Some text', state: 'open', priority: 'normal', created_by: 1 })
      assert.ok(inWindow(ticket.created_at, t0, t1))
      const log = rows(s.file, "SELECT at, user_id, action, target FROM audit WHERE action = 'ticket.create'")
      assert.deepEqual(log, [{ at: ticket.created_at, user_id: 1, action: 'ticket.create', target: 'ticket:1' }])
      for (const priority of ['low', 'normal', 'high']) same(priority, { priority: (await ok(c.post('/api/tickets', { title: 'p', description: 'd', priority }), 201)).priority }, { priority })
    })
  })

  it('POST /api/tickets: title 1 to 120, description 1 to 5000 UTF-16 code units after trim, priority low/normal/high; checked in that order', async () => {
    await withServer({}, async s => {
      const c = api(s, await adminOf(s))
      const good = { title: 'T', description: 'D' }
      const bad = async (label, patch, message) => same(label, view(await c.post('/api/tickets', { ...good, ...patch })), answer(400, err(message)))
      for (const title of ['', '   ', '  ', 'x'.repeat(121), ` ${'x'.repeat(121)} `, '😀'.repeat(61), 5, null, ['t'], {}]) await bad(`title ${JSON.stringify(title)?.slice(0, 20)}`, { title }, E.title)
      for (const description of ['', ' \n ', 'x'.repeat(5001), `  ${'x'.repeat(5001)}`, '😀'.repeat(2501), 5, null]) await bad(`description ${JSON.stringify(description)?.slice(0, 20)}`, { description }, E.description)
      for (const priority of ['urgent', 'HIGH', 'High', '', null, 1, ['low'], 'low ']) await bad(`priority ${JSON.stringify(priority)}`, { priority }, E.priority)
      same('no title', view(await c.post('/api/tickets', { description: 'D' })), answer(400, err(E.title)))
      same('no description', view(await c.post('/api/tickets', { title: 'T' })), answer(400, err(E.description)))
      await bad('all bad', { title: '', description: '', priority: 'x' }, E.title)
      await bad('description and priority bad', { description: '', priority: 'x' }, E.description)
      assert.equal(rows(s.file, 'SELECT count(*) AS n FROM tickets')[0].n, 0)
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action <> 'login'")[0].n, 0)
      for (const [title, want] of [['x'.repeat(120), 'x'.repeat(120)], [` ${'y'.repeat(120)} `, 'y'.repeat(120)], ['😀'.repeat(60), '😀'.repeat(60)], [' z ', 'z']]) {
        same(want.slice(0, 5), { title: (await ok(c.post('/api/tickets', { ...good, title }), 201)).title }, { title: want })
      }
      for (const description of ['x'.repeat(5000), `\n${'q'.repeat(5000)}\n`, '😀'.repeat(2500)]) {
        same('description', { length: (await ok(c.post('/api/tickets', { ...good, description }), 201)).description.length }, { length: description.trim().length })
      }
    })
  })
}

function readCases() {
  it('a member\'s own tickets are the ones they created: every other ticket does not exist for them, an admin sees all', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const M = await userOf(s, A)
    const N = await userOf(s, A)
    const mine = await ticketOf(s, M, 'mine')
    const theirs = await ticketOf(s, N, 'theirs')
    const admins = await ticketOf(s, A, 'admins')
    for (const t of [theirs, admins]) {
      for (const [method, tail, body] of [['GET', '', undefined], ['PATCH', '', { title: 'x' }], ['GET', '/comments', undefined], ['POST', '/comments', { text: 'hi' }]]) {
        same(`${method} ${t.title}${tail}`, view(await req(s, method, `/api/tickets/${t.id}${tail}`, { as: M, body })), answer(404, err(E.ticketNotFound)))
      }
      same('DELETE is admin only', view(await req(s, 'DELETE', `/api/tickets/${t.id}`, { as: M })), answer(403, err(E.forbidden)))
    }
    await expect('own ticket', req(s, 'GET', `/api/tickets/${mine.id}`, { as: M }), 200, mine)
    await expect('admin sees it', req(s, 'GET', `/api/tickets/${theirs.id}`, { as: A }), 200, theirs)
    const list = await ok(req(s, 'GET', '/api/tickets?limit=100', { as: M }), 200)
    assert.deepEqual(list.tickets.map(t => t.id), [mine.id])
    assert.deepEqual(list.next, null)
    const every = await ok(req(s, 'GET', '/api/tickets?limit=100', { as: A }), 200)
    for (const t of [mine, theirs, admins]) assert.ok(every.tickets.some(x => x.id === t.id), `admin list holds ${t.title}`)
  })

  it('GET /api/tickets/<id> is the ticket itself, with exactly its seven keys', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const t = await ticketOf(s, A, 'shape', 'checks', { priority: 'high' })
    const r = await ok(req(s, 'GET', `/api/tickets/${t.id}`, { as: A }), 200)
    assert.deepEqual(Object.keys(r).sort(), TICKET_KEYS)
    assert.deepEqual(r, t)
  })
}

function patchCases() {
  it('PATCH /api/tickets/<id>: rules in order (nothing, member rights, title, description, status, priority), only the keys given change, one audit entry', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const M = await userOf(s, A)
      const c = api(s, A)
      const m = api(s, M)
      const t = await ticketOf(s, M, 'Original', 'First text', { priority: 'low' })
      const path = `/api/tickets/${t.id}`
      const log = () => rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'ticket.update'")[0].n
      same('nothing', view(await c.patch(path, { id: 5, created_by: 2, color: 'red' })), answer(400, err(E.nothing)))
      same('member: status', view(await m.patch(path, { status: 'closed' })), answer(403, err(E.forbidden)))
      same('member: priority', view(await m.patch(path, { priority: 'high' })), answer(403, err(E.forbidden)))
      same('member: 403 before the value rules', view(await m.patch(path, { title: '', status: 'nope' })), answer(403, err(E.forbidden)))
      same('member: invalid priority is still 403', view(await m.patch(path, { priority: 'urgent' })), answer(403, err(E.forbidden)))
      same('title', view(await c.patch(path, { title: ' ', description: '', status: 'x', priority: 'x' })), answer(400, err(E.title)))
      same('description', view(await c.patch(path, { description: '', status: 'x', priority: 'x' })), answer(400, err(E.description)))
      same('status', view(await c.patch(path, { status: 'Open', priority: 'x' })), answer(400, err(E.status)))
      same('priority', view(await c.patch(path, { priority: 'x' })), answer(400, err(E.priority)))
      for (const status of [null, '', 'done', 1]) same(`status ${status}`, view(await c.patch(path, { status })), answer(400, err(E.status)))
      assert.equal(log(), 0)
      assert.deepEqual(await ok(c.get(path), 200), t, 'nothing changed')
      same('member title and description', view(await m.patch(path, { title: '  New title ', description: ' New text ' })), answer(200, { ...t, title: 'New title', description: 'New text' }))
      same('admin status', view(await c.patch(path, { status: 'pending' })), answer(200, { ...t, title: 'New title', description: 'New text', status: 'pending' }))
      same('admin priority and status', view(await c.patch(path, { priority: 'high', status: 'closed', created_by: 1, id: 77, created_at: 5 })), answer(200, { ...t, title: 'New title', description: 'New text', status: 'closed', priority: 'high' }))
      same('closed tickets can be edited', view(await c.patch(path, { status: 'open' })), answer(200, { ...t, title: 'New title', description: 'New text', status: 'open', priority: 'high' }))
      assert.equal(log(), 4)
      assert.deepEqual(rows(s.file, "SELECT user_id, target FROM audit WHERE action = 'ticket.update'").map(e => e.target), Array(4).fill(`ticket:${t.id}`))
      assert.deepEqual(rows(s.file, "SELECT user_id FROM audit WHERE action = 'ticket.update' ORDER BY id").map(e => e.user_id), [M.user.id, 1, 1, 1])
    })
  })
}

function deleteCases() {
  it('DELETE /api/tickets/<id> (admin only): 204, the ticket and its comments are gone, one audit entry; ids are never used twice', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const t = await ticketOf(s, A, 'to delete')
      const other = await ticketOf(s, A, 'to keep')
      const gone = await commentOf(s, A, t.id)
      const kept = await commentOf(s, A, other.id)
      const r = await c.del(`/api/tickets/${t.id}`)
      same('reply', { status: r.status, text: r.text }, { status: 204, text: '' })
      await expect('gone', c.get(`/api/tickets/${t.id}`), 404, err(E.ticketNotFound))
      await expect('twice', c.del(`/api/tickets/${t.id}`), 404, err(E.ticketNotFound))
      assert.deepEqual(rows(s.file, 'SELECT id FROM comments').map(x => x.id), [kept.id])
      assert.deepEqual(rows(s.file, "SELECT user_id, target FROM audit WHERE action = 'ticket.delete'"), [{ user_id: 1, target: `ticket:${t.id}` }])
      const next = await ticketOf(s, A, 'after')
      assert.ok(next.id > other.id, `id ${next.id} after the deleted ${t.id} and ${other.id}`)
      const last = await ticketOf(s, A, 'last')
      await ok(c.del(`/api/tickets/${last.id}`), 204)
      const again = await ticketOf(s, A, 'again')
      assert.ok(again.id > last.id, `the highest id ${last.id} was deleted and ${again.id} must be higher`)
      const c2 = await commentOf(s, A, again.id)
      assert.ok(c2.id > gone.id)
    })
  })
}

function commentCases() {
  it('comments: 201 and the comment, trimmed, by the session user at the request time, one audit entry; GET lists them by id', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const M = await userOf(s, A)
      const t = await ticketOf(s, M, 'ticket')
      const path = `/api/tickets/${t.id}/comments`
      await expect('none yet', api(s, M).get(path), 200, { comments: [] })
      const t0 = Date.now()
      const r = await api(s, A).post(path, { text: '  Hello\n', user_id: 5, ticket_id: 99, created_at: 1 })
      const t1 = Date.now()
      const first = JSON.parse(r.text)
      assert.equal(r.status, 201)
      assert.deepEqual(Object.keys(first).sort(), COMMENT_KEYS)
      same('comment', { ...first, created_at: undefined }, { id: 1, ticket_id: t.id, user_id: 1, text: 'Hello', created_at: undefined })
      assert.ok(inWindow(first.created_at, t0, t1))
      const second = await ok(api(s, M).post(path, { text: 'Second' }), 201)
      assert.equal(second.user_id, M.user.id)
      assert.deepEqual(await ok(api(s, M).get(path), 200), { comments: [first, second] })
      assert.deepEqual(rows(s.file, "SELECT at, user_id, target FROM audit WHERE action = 'comment.create' ORDER BY id"), [
        { at: first.created_at, user_id: 1, target: 'comment:1' }, { at: second.created_at, user_id: M.user.id, target: 'comment:2' },
      ])
      same('2000 characters', { status: (await api(s, M).post(path, { text: ` ${'x'.repeat(2000)} ` })).status }, { status: 201 })
    })
  })

  it('comments: text 1 to 2000 code units after trim, then 409 `ticket is closed` (also for a text that is fine); 404 comes first; a closed ticket can still be read', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      const t = await ticketOf(s, A)
      const path = `/api/tickets/${t.id}/comments`
      for (const text of ['', '   ', ' ', 'x'.repeat(2001), '😀'.repeat(1001), 5, null, ['x']]) same(`text ${JSON.stringify(text)?.slice(0, 12)}`, view(await c.post(path, { text })), answer(400, err(E.text)))
      same('no text', view(await c.post(path, {})), answer(400, err(E.text)))
      await commentOf(s, A, t.id, 'before closing')
      await ok(c.patch(`/api/tickets/${t.id}`, { status: 'closed' }), 200)
      await expect('closed', c.post(path, { text: 'late' }), 409, err(E.closed))
      await expect('the text rule comes before closed', c.post(path, { text: '' }), 400, err(E.text))
      assert.equal((await ok(c.get(path), 200)).comments.length, 1)
      await ok(c.patch(`/api/tickets/${t.id}`, { status: 'pending' }), 200)
      await commentOf(s, A, t.id, 'reopened')
      await ok(c.patch(`/api/tickets/${t.id}`, { status: 'closed' }), 200)
      assert.equal(rows(s.file, "SELECT count(*) AS n FROM audit WHERE action = 'comment.create'")[0].n, 2, 'no entry for the refused ones')
      await expect('unknown ticket', c.post('/api/tickets/99999/comments', { text: 'x' }), 404, err(E.ticketNotFound))
      await expect('unknown ticket list', c.get('/api/tickets/99999/comments'), 404, err(E.ticketNotFound))
    })
  })
}

function listCases() {
  it('GET /api/tickets: newest first, `limit` default 50 and at most 100, `before`, and `next` only when more tickets follow', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const c = api(s, A)
      await expect('empty', c.get('/api/tickets'), 200, { tickets: [], next: null })
      const made = []
      for (let i = 0; i < 7; i++) made.push(await ticketOf(s, A, `t${i}`))
      const ids = made.map(t => t.id).reverse()
      const page = async path => ok(c.get(path), 200, path)
      same('all', { ids: (await page('/api/tickets')).tickets.map(t => t.id), next: (await page('/api/tickets')).next }, { ids, next: null })
      const p1 = await page('/api/tickets?limit=3')
      same('first', { ids: p1.tickets.map(t => t.id), next: p1.next }, { ids: ids.slice(0, 3), next: ids[2] })
      const p2 = await page(`/api/tickets?limit=3&before=${p1.next}`)
      same('second', { ids: p2.tickets.map(t => t.id), next: p2.next }, { ids: ids.slice(3, 6), next: ids[5] })
      const p3 = await page(`/api/tickets?limit=3&before=${p2.next}`)
      same('last', { ids: p3.tickets.map(t => t.id), next: p3.next }, { ids: ids.slice(6), next: null })
      same('exactly 7 fit', { next: (await page('/api/tickets?limit=7')).next }, { next: null })
      same('6 leave one', { next: (await page('/api/tickets?limit=6')).next }, { next: ids[5] })
      same('before the lowest', { n: (await page(`/api/tickets?before=${ids[6]}`)).tickets.length }, { n: 0 })
      same('before is exclusive', { ids: (await page(`/api/tickets?before=${ids[0]}&limit=1`)).tickets.map(t => t.id) }, { ids: [ids[1]] })
      same('a huge before', { n: (await page('/api/tickets?before=99999999999999999999')).tickets.length }, { n: 7 })
      same('encoded digits are decoded', { n: (await page('/api/tickets?limit=%32')).tickets.length }, { n: 2 })
      same('the first of a repeated limit', { n: (await page('/api/tickets?limit=2&limit=abc')).tickets.length }, { n: 2 })
      same('the first of a repeated before', { n: (await page(`/api/tickets?before=${ids[3]}&before=zzz`)).tickets.length }, { n: 3 })
      same('unknown names', { n: (await page('/api/tickets?x=1&limit=1')).tickets.length }, { n: 1 })
      for (const limit of ['0', '101', '-1', '01', '1.5', 'abc', '', '%205', '5%20', '+5', '1e1', '%D9%A3', '100000000000000000000', '00']) await expect(`limit=${limit}`, c.get(`/api/tickets?limit=${limit}`), 400, err(E.limit))
      for (const before of ['0', '01', '-3', 'abc', '', '1.5', '%204', '0x5', '%D9%A3']) await expect(`before=${before}`, c.get(`/api/tickets?before=${before}`), 400, err(E.before))
      await expect('limit is checked first', c.get('/api/tickets?before=x&limit=x'), 400, err(E.limit))
      await expect('a repeated bad limit', c.get('/api/tickets?limit=abc&limit=2'), 400, err(E.limit))
      for (let i = 0; i < 50; i++) await ticketOf(s, A, `more${i}`)
      const big = await page('/api/tickets')
      same('default 50', { n: big.tickets.length, next: big.next }, { n: 50, next: big.tickets[49].id })
      same('at most 100', { n: (await page('/api/tickets?limit=100')).tickets.length }, { n: 57 })
    })
  })

  it('a member\'s list leaves out other tickets before it counts `limit` and `next`', async () => {
    await withServer({}, async s => {
      const A = await sessionOf(s, 'admin', ADMIN_PW)
      const M = await userOf(s, A)
      const mine = []
      for (let i = 0; i < 4; i++) {
        mine.push(await ticketOf(s, M, `mine${i}`))
        await ticketOf(s, A, `admin${i}`)
        await ticketOf(s, A, `admin${i}b`)
      }
      const ids = mine.map(t => t.id).reverse()
      const c = api(s, M)
      const p1 = await ok(c.get('/api/tickets?limit=3'), 200)
      same('first', { ids: p1.tickets.map(t => t.id), next: p1.next }, { ids: ids.slice(0, 3), next: ids[2] })
      const p2 = await ok(c.get(`/api/tickets?limit=3&before=${p1.next}`), 200)
      same('second', { ids: p2.tickets.map(t => t.id), next: p2.next }, { ids: ids.slice(3), next: null })
      same('exactly all', { next: (await ok(c.get('/api/tickets?limit=4'), 200)).next }, { next: null })
    })
  })
}
