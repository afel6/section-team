// Stage 2, the page: its markup, and its script run against a DOM stand-in that offers only the browser APIs the task allows.
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {
  all, assets, byId, errorText, fire, flush, isDisabled, isEl, isHidden, it, norm, openPage, parseHtml, pending, same, setValue, settle, take, textOf, valueIn, within,
} from './lib.mjs'

const USER = { id: 1, username: 'admin', role: 'admin' }
const SUMMARY = { counts: { open: 2, pending: 1, closed: 4 }, total: 7 }
const NO_REPLY = 'Could not reach the server.'
const FAILED = 'Request failed.'
const SUMMARY_URL = '/api/reports/summary'
const text = (page, id) => textOf(page.el(id))
const hidden = (page, id) => isHidden(page.el(id))
const lis = page => page.el('counts').kids
const shown = (page, ids) => Object.fromEntries(ids.map(id => [id, !hidden(page, id)]))
const lowerKeys = o => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k.toLowerCase(), v]))

// A page whose session check was answered. as: the user, or null for the logged-out view.
async function opened(user = USER) {
  const page = await openPage()
  const first = take(page, 'GET', '/api/session')
  await settle(first, c => (user ? c.reply(200, { user }) : c.reply(401, { error: 'login required' })))
  return page
}
async function ready(user = USER, summary = SUMMARY) {
  const page = await opened(user)
  await settle(take(page, 'GET', SUMMARY_URL), c => c.reply(200, summary))
  return page
}
const srcOf = page => page.el('chart').attrs.src ?? ''
const showsTotal = page => ({ items: lis(page).map(li => textOf(li)), total: text(page, 'total'), chart: srcOf(page) })

export function pageCases() {
  markupCases()
  loadCases()
  loginCases()
  reportCases()
  logoutCases()
}

function markupCases() {
  it('the page markup: the title and h1, the error line, the login form, the dashboard, the filter form and the labels', async () => {
    const { html } = await assets()
    const root = parseHtml(html)
    const el = id => byId(root, id)
    const one = (tag, id, outer) => {
      const n = el(id)
      assert.ok(n, `no element with id ${id}`)
      assert.equal(n.tag, tag, `#${id} is a ${n.tag}`)
      if (outer) assert.ok(within(n, outer), `#${id} is not inside the element it belongs in`)
      return n
    }
    assert.equal(norm(all(root).find(n => n.tag === 'title')), 'Help desk')
    const h1s = all(root).filter(n => n.tag === 'h1')
    assert.deepEqual(h1s.map(norm), ['Help desk'])
    const error = one('p', 'error')
    same('error', { role: error.attrs.role, text: textOf(error).trim() }, { role: 'alert', text: '' })
    const form = one('form', 'login-form')
    const dash = one('section', 'dashboard')
    assert.equal(within(error, form) || within(error, dash), false, '#error is outside the form and the dashboard')
    same('login form', { novalidate: 'novalidate' in form.attrs, hidden: 'hidden' in form.attrs, section: 'hidden' in dash.attrs }, { novalidate: true, hidden: true, section: true })
    same('username', { type: one('input', 'username', form).attrs.type }, { type: 'text' })
    same('password', { type: one('input', 'password', form).attrs.type }, { type: 'password' })
    const login = one('button', 'login', form)
    same('login button', { type: login.attrs.type, text: norm(login) }, { type: 'submit', text: 'Log in' })
    same('who', { text: textOf(one('p', 'who', dash)) }, { text: '' })
    const logout = one('button', 'logout', dash)
    same('logout', { type: logout.attrs.type, text: norm(logout) }, { type: 'button', text: 'Log out' })
    const filter = one('form', 'filter-form', dash)
    assert.ok('novalidate' in filter.attrs)
    for (const [tag, id] of [['ul', 'counts'], ['p', 'total'], ['img', 'chart']]) {
      const n = one(tag, id, dash)
      assert.equal(within(n, filter), false, `#${id} is outside the filter form`)
    }
    same('counts and total', { counts: textOf(el('counts')), total: textOf(el('total')) }, { counts: '', total: '' })
    same('chart', { alt: el('chart').attrs.alt, src: 'src' in el('chart').attrs }, { alt: 'Tickets by status', src: false })
    const select = one('select', 'priority', filter)
    const options = all(select).filter(n => n.tag === 'option')
    assert.equal(all(select).length, 4, 'the select holds four options and nothing else')
    assert.deepEqual(options.map(o => [o.attrs.value, norm(o)]), [['', 'Any'], ['low', 'low'], ['normal', 'normal'], ['high', 'high']])
    same('from', { type: one('input', 'from', filter).attrs.type }, { type: 'date' })
    same('to', { type: one('input', 'to', filter).attrs.type }, { type: 'date' })
    const apply = one('button', 'apply', filter)
    same('apply', { type: apply.attrs.type, text: norm(apply) }, { type: 'submit', text: 'Apply' })
    const labels = all(root).filter(n => n.tag === 'label')
    for (const [id, label] of [['username', 'Username'], ['password', 'Password'], ['priority', 'Priority'], ['from', 'From'], ['to', 'To']]) {
      const mine = labels.filter(l => l.attrs.for === id)
      assert.equal(mine.length, 1, `one label for #${id}`)
      same(`label ${id}`, { text: norm(mine[0]), holdsField: within(el(id), mine[0]) }, { text: label, holdsField: false })
    }
  })

  it('the script is loaded by one <script src="/app.js"> with no other attribute, last in <body>; no inline script, no on... attribute; the script is a classic script', async () => {
    const { html, js } = await assets()
    const root = parseHtml(html)
    const scripts = all(root).filter(n => n.tag === 'script')
    assert.equal(scripts.length, 1)
    assert.deepEqual(scripts[0].attrs, { src: '/app.js' })
    assert.equal(textOf(scripts[0]).trim(), '', 'no inline code')
    const body = all(root).find(n => n.tag === 'body')
    assert.ok(body, 'the page has a body')
    assert.equal(body.kids.filter(isEl).at(-1), scripts[0], 'the script is the last element of <body>')
    assert.equal(all(scripts[0]).length, 0)
    for (const n of all(root)) assert.deepEqual(Object.keys(n.attrs).filter(k => k.startsWith('on')), [], `<${n.tag}> has an event attribute`)
    assert.doesNotThrow(() => new vm.Script(js), 'app.js is a classic script')
    assert.equal(/^\s*(import|export)\b/m.test(js), false)
  })
}

function loadCases() {
  it('on load: GET /api/session; 200 shows the logged-in view and starts a report fetch; 401 shows the logged-out view with no message', async () => {
    const page = await openPage()
    same('before the reply', { calls: pending(page) }, { calls: ['GET /api/session'] })
    await settle(take(page, 'GET', '/api/session'), c => c.reply(200, { user: { id: 2, username: 'ann', role: 'member' } }))
    same('logged in', { who: text(page, 'who'), ...shown(page, ['login-form', 'dashboard']), calls: pending(page), error: errorText(page) }, { who: 'ann (member)', 'login-form': false, dashboard: true, calls: ['GET /api/reports/summary'], error: '' })
    const out = await opened(null)
    same('logged out', { ...shown(out, ['login-form', 'dashboard']), error: errorText(out), calls: pending(out) }, { 'login-form': true, dashboard: false, error: '', calls: [] })
  })

  it('on load, any other reply is an error on the logged-out view: the message of the body, `Request failed.`, or `Could not reach the server.`', async () => {
    const cases = [
      [500, { error: 'boom' }, 'boom'], [403, { error: 'no way' }, 'no way'], [500, {}, FAILED], [500, { error: 5 }, FAILED], [500, [], FAILED], [500, null, FAILED], [500, 'null', FAILED],
      [404, { error: { text: 'x' } }, FAILED], [200, 'oops', NO_REPLY], [500, '<html>', NO_REPLY], [204, '', FAILED], [201, { user: {} }, FAILED],
    ]
    for (const [status, body, message] of cases) {
      const page = await openPage()
      await settle(take(page, 'GET', '/api/session'), c => c.reply(status, body))
      same(`${status} ${JSON.stringify(body)}`, { error: errorText(page), ...shown(page, ['login-form', 'dashboard']) }, { error: message, 'login-form': true, dashboard: false })
    }
    const gone = await openPage()
    await settle(take(gone, 'GET', '/api/session'), c => c.fail())
    same('no reply', { error: errorText(gone), ...shown(gone, ['login-form', 'dashboard']) }, { error: NO_REPLY, 'login-form': true, dashboard: false })
  })
}

function loginCases() {
  it('a login submit: preventDefault, #login disabled while it runs, POST /api/session with the exact header and the fields\' values; a second submit sends nothing', async () => {
    const page = await opened(null)
    setValue(page.el('username'), ' Ali ceé ')
    setValue(page.el('password'), ' p&ss"w\\ordあ ')
    assert.equal(fire(page.el('login-form'), 'submit'), true, 'preventDefault')
    same('while it runs', { disabled: isDisabled(page.el('login')), calls: pending(page) }, { disabled: true, calls: ['POST /api/session'] })
    const call = take(page, 'POST', '/api/session')
    assert.deepEqual(lowerKeys(call.opts.headers), { 'content-type': 'application/json' })
    assert.deepEqual(JSON.parse(call.opts.body), { username: ' Ali ceé ', password: ' p&ss"w\\ordあ ' })
    assert.deepEqual(Object.keys(JSON.parse(call.opts.body)).sort(), ['password', 'username'])
    assert.equal(fire(page.el('login-form'), 'submit'), true, 'preventDefault also when disabled')
    await flush()
    same('nothing more sent', { calls: pending(page) }, { calls: [] })
    await settle(call, c => c.reply(200, { user: { id: 2, username: 'ann', role: 'member' } }))
    same('after 200', {
      disabled: isDisabled(page.el('login')), password: valueIn(page.el('password')), username: valueIn(page.el('username')), error: errorText(page), who: text(page, 'who'),
      ...shown(page, ['login-form', 'dashboard']), calls: pending(page),
    }, { disabled: false, password: '', username: ' Ali ceé ', error: '', who: 'ann (member)', 'login-form': false, dashboard: true, calls: ['GET /api/reports/summary'] })
    assert.equal(page.calls.filter(c => c.method === 'GET' && c.url === '/api/session').length, 1, 'no second request to /api/session')
  })

  it('a login that fails shows the message, enables #login again, empties #password and keeps #username; a later success empties #error', async () => {
    const page = await opened(null)
    const attempt = async how => {
      setValue(page.el('username'), 'ann')
      setValue(page.el('password'), 'secret')
      fire(page.el('login-form'), 'submit')
      await settle(take(page, 'POST', '/api/session'), how)
      return { disabled: isDisabled(page.el('login')), password: valueIn(page.el('password')), username: valueIn(page.el('username')), error: errorText(page), ...shown(page, ['login-form', 'dashboard']) }
    }
    const bad = { disabled: false, password: '', username: 'ann', 'login-form': false, dashboard: true }
    const stay = { disabled: false, password: '', username: 'ann', 'login-form': true, dashboard: false }
    same('401', await attempt(c => c.reply(401, { error: 'wrong username or password' })), { ...stay, error: 'wrong username or password' })
    same('429', await attempt(c => c.reply(429, { error: 'too many login attempts' })), { ...stay, error: 'too many login attempts' })
    same('no error key', await attempt(c => c.reply(500, { message: 'x' })), { ...stay, error: FAILED })
    same('no reply', await attempt(c => c.fail()), { ...stay, error: NO_REPLY })
    same('not JSON', await attempt(c => c.reply(200, 'oops')), { ...stay, error: NO_REPLY })
    same('204', await attempt(c => c.reply(204, '')), { ...stay, error: FAILED })
    same('a 201 is not the success status', await attempt(c => c.reply(201, { user: USER })), { ...stay, error: FAILED })
    same('success', await attempt(c => c.reply(200, { user: USER })), { ...bad, error: '' })
  })
}

function reportCases() {
  it('a report fetch: /api/reports/summary and the query of priority, from and to in that order, each non-empty value through encodeURIComponent', async () => {
    const page = await ready()
    const fetchWith = async (priority, from, to) => {
      setValue(page.el('priority'), priority)
      setValue(page.el('from'), from)
      setValue(page.el('to'), to)
      assert.equal(fire(page.el('filter-form'), 'submit'), true, 'preventDefault')
      const url = pending(page)
      for (const c of page.calls) if (!c.taken) c.taken = true
      return url
    }
    same('none', await fetchWith('', '', ''), ['GET /api/reports/summary'])
    same('priority', await fetchWith('low', '', ''), ['GET /api/reports/summary?priority=low'])
    same('all three', await fetchWith('high', '2026-01-02', '2026-02-03'), ['GET /api/reports/summary?priority=high&from=2026-01-02&to=2026-02-03'])
    same('only to', await fetchWith('', '', '2026-02-03'), ['GET /api/reports/summary?to=2026-02-03'])
    same('encoded', await fetchWith('a b', '&=?é/', ' '), ['GET /api/reports/summary?priority=a%20b&from=%26%3D%3F%C3%A9%2F&to=%20'])
    same('unicode', await fetchWith('', 'あ😀', ''), ['GET /api/reports/summary?from=%E3%81%82%F0%9F%98%80'])
  })

  it('a report that arrives: three <li> for open, pending and closed, the total, the chart source with the same query, and an empty #error', async () => {
    const page = await ready()
    same('first', showsTotal(page), { items: ['open: 2', 'pending: 1', 'closed: 4'], total: 'Total: 7', chart: '/api/reports/chart.svg' })
    same('shape', { n: page.el('counts').kids.length, tags: page.el('counts').kids.map(k => k.tag), each: lis(page).map(li => li.kids.length) }, { n: 3, tags: ['li', 'li', 'li'], each: [1, 1, 1] })
    assert.deepEqual(lis(page).map(li => textOf(li)), ['open: 2', 'pending: 1', 'closed: 4'], 'exactly the text, nothing around it')
    setValue(page.el('priority'), 'high')
    setValue(page.el('from'), '2026-05-06')
    fire(page.el('filter-form'), 'submit')
    await settle(take(page, 'GET', '/api/reports/summary?priority=high&from=2026-05-06'), c => c.reply(200, { counts: { open: 0, pending: 10, closed: 0 }, total: 10 }))
    same('second', { items: lis(page).map(li => textOf(li)), total: text(page, 'total'), chart: srcOf(page), n: page.el('counts').kids.length, error: errorText(page) },
      { items: ['open: 0', 'pending: 10', 'closed: 0'], total: 'Total: 10', chart: '/api/reports/chart.svg?priority=high&from=2026-05-06', n: 3, error: '' })
  })

  it('a report that fails shows the message and changes nothing else; a later success empties #error', async () => {
    const page = await ready()
    const before = showsTotal(page)
    const tries = async how => {
      fire(page.el('filter-form'), 'submit')
      await settle(take(page, 'GET', SUMMARY_URL), how)
      return { error: errorText(page), same: JSON.stringify(showsTotal(page)) === JSON.stringify(before) }
    }
    same('500', await tries(c => c.reply(500, { error: 'broken' })), { error: 'broken', same: true })
    same('no key', await tries(c => c.reply(503, {})), { error: FAILED, same: true })
    same('no reply', await tries(c => c.fail()), { error: NO_REPLY, same: true })
    same('not JSON', await tries(c => c.reply(200, '<html>')), { error: NO_REPLY, same: true })
    same('204', await tries(c => c.reply(204, '')), { error: FAILED, same: true })
    same('401 is only an error here too', await tries(c => c.reply(401, { error: 'login required' })), { error: 'login required', same: true })
    fire(page.el('filter-form'), 'submit')
    await settle(take(page, 'GET', SUMMARY_URL), c => c.reply(200, SUMMARY))
    same('after a success', { error: errorText(page) }, { error: '' })
  })

  it('every value is shown as plain text, never as HTML', async () => {
    const evil = '<img src=x onerror=alert(1)>'
    const page = await ready({ id: 3, username: evil, role: '<b>admin</b>' }, { counts: { open: evil, pending: '<b>1</b>', closed: 0 }, total: '<i>9</i>' })
    same('who', { who: text(page, 'who'), kids: page.el('who').kids.map(k => k.tag) }, { who: `${evil} (<b>admin</b>)`, kids: ['#text'] })
    same('counts', { items: lis(page).map(li => textOf(li)), kinds: lis(page).map(li => li.kids.map(k => k.tag).join()), total: text(page, 'total') }, { items: [`open: ${evil}`, 'pending: <b>1</b>', 'closed: 0'], kinds: ['#text', '#text', '#text'], total: 'Total: <i>9</i>' })
    fire(page.el('filter-form'), 'submit')
    await settle(take(page, 'GET', SUMMARY_URL), c => c.reply(500, { error: evil }))
    same('error', { text: errorText(page), kids: page.el('error').kids.map(k => k.tag) }, { text: evil, kids: ['#text'] })
  })

  it('report fetches that overlap: only the outcome of the last one started is used, an error or a missing reply of an earlier one included', async () => {
    const page = await ready()
    const start = async () => {
      fire(page.el('filter-form'), 'submit')
      const calls = page.calls.filter(c => !c.taken)
      calls.forEach(c => { c.taken = true })
      return calls.at(-1)
    }
    const view = () => ({ items: lis(page).map(li => textOf(li)), error: errorText(page) })
    const S = n => ({ counts: { open: n, pending: n, closed: n }, total: 3 * n })
    const first = await start()
    const second = await start()
    const third = await start()
    await settle(second, c => c.reply(200, S(2)))
    same('an earlier success changes nothing', view(), { items: ['open: 2', 'pending: 1', 'closed: 4'], error: '' })
    await settle(third, c => c.reply(200, S(3)))
    same('the last one counts', view(), { items: ['open: 3', 'pending: 3', 'closed: 3'], error: '' })
    await settle(first, c => c.reply(500, { error: 'late failure' }))
    same('an earlier error afterwards changes nothing', view(), { items: ['open: 3', 'pending: 3', 'closed: 3'], error: '' })
    const a = await start()
    const b = await start()
    await settle(b, c => c.reply(500, { error: 'the last failed' }))
    await settle(a, c => c.reply(200, S(8)))
    same('an earlier success after the last failed', view(), { items: ['open: 3', 'pending: 3', 'closed: 3'], error: 'the last failed' })
    const c1 = await start()
    const c2 = await start()
    await settle(c1, c => c.fail())
    same('an earlier missing reply', view(), { items: ['open: 3', 'pending: 3', 'closed: 3'], error: 'the last failed' })
    await settle(c2, c => c.reply(200, S(5)))
    same('then the last', view(), { items: ['open: 5', 'pending: 5', 'closed: 5'], error: '' })
  })

  it('a submit of the filter form never reloads and starts a fetch at once, also while another is running', async () => {
    const page = await ready()
    for (let i = 0; i < 3; i++) assert.equal(fire(page.el('filter-form'), 'submit'), true)
    same('three fetches', { calls: pending(page).length }, { calls: 3 })
  })
}

function logoutCases() {
  it('a logout click: #logout is disabled while DELETE /api/session runs; a click while disabled sends nothing', async () => {
    const page = await ready()
    fire(page.el('logout'), 'click')
    same('running', { disabled: isDisabled(page.el('logout')), calls: pending(page) }, { disabled: true, calls: ['DELETE /api/session'] })
    fire(page.el('logout'), 'click')
    await flush()
    same('a second click', { calls: pending(page) }, { calls: ['DELETE /api/session'] })
    await settle(take(page, 'DELETE', '/api/session'), c => c.reply(204, ''))
    same('done', { disabled: isDisabled(page.el('logout')), calls: pending(page) }, { disabled: false, calls: [] })
  })

  it('a logout that works (204) empties #error, #who, #counts, #total and the chart source, keeps the field values and shows the logged-out view', async () => {
    const page = await ready()
    setValue(page.el('username'), 'ann')
    setValue(page.el('password'), 'pw')
    setValue(page.el('priority'), 'low')
    setValue(page.el('from'), '2026-01-01')
    setValue(page.el('to'), '2026-02-02')
    fire(page.el('filter-form'), 'submit')
    await settle(take(page, 'GET', '/api/reports/summary?priority=low&from=2026-01-01&to=2026-02-02'), c => c.reply(500, { error: 'some error' }))
    fire(page.el('logout'), 'click')
    await settle(take(page, 'DELETE', '/api/session'), c => c.reply(204, ''))
    same('logged out', {
      error: errorText(page), who: text(page, 'who'), counts: page.el('counts').kids.length, total: text(page, 'total'), chart: srcOf(page),
      username: valueIn(page.el('username')), password: valueIn(page.el('password')), priority: valueIn(page.el('priority')), from: valueIn(page.el('from')), to: valueIn(page.el('to')), ...shown(page, ['login-form', 'dashboard']),
    }, { error: '', who: '', counts: 0, total: '', chart: '', username: 'ann', password: 'pw', priority: 'low', from: '2026-01-01', to: '2026-02-02', 'login-form': true, dashboard: false })
  })

  it('a logout that fails keeps the view and shows the message: an error status, a reply that is not 204, no reply', async () => {
    const page = await ready()
    const attempt = async how => {
      fire(page.el('logout'), 'click')
      await settle(take(page, 'DELETE', '/api/session'), how)
      return { error: errorText(page), enabled: !isDisabled(page.el('logout')), who: text(page, 'who'), ...shown(page, ['login-form', 'dashboard']), counts: lis(page).length }
    }
    const stay = { enabled: true, who: 'admin (admin)', 'login-form': false, dashboard: true, counts: 3 }
    same('500', await attempt(c => c.reply(500, { error: 'cannot' })), { ...stay, error: 'cannot' })
    same('no reply', await attempt(c => c.fail()), { ...stay, error: NO_REPLY })
    same('200 is not the success status of a DELETE', await attempt(c => c.reply(200, {})), { ...stay, error: FAILED })
    same('not JSON', await attempt(c => c.reply(502, 'bad gateway')), { ...stay, error: NO_REPLY })
  })

  it('a report fetch started before a successful logout changes nothing when it settles; before a failed logout it still counts', async () => {
    const page = await ready()
    fire(page.el('filter-form'), 'submit')
    const late = take(page, 'GET', SUMMARY_URL)
    fire(page.el('logout'), 'click')
    await settle(take(page, 'DELETE', '/api/session'), c => c.reply(204, ''))
    await settle(late, c => c.reply(200, { counts: { open: 9, pending: 9, closed: 9 }, total: 27 }))
    same('after the logout', { counts: lis(page).length, total: text(page, 'total'), chart: srcOf(page), error: errorText(page) }, { counts: 0, total: '', chart: '', error: '' })
    const second = await ready()
    fire(second.el('filter-form'), 'submit')
    const failing = take(second, 'GET', SUMMARY_URL)
    fire(second.el('logout'), 'click')
    await settle(take(second, 'DELETE', '/api/session'), c => c.reply(500, { error: 'no' }))
    await settle(failing, c => c.reply(200, { counts: { open: 9, pending: 9, closed: 9 }, total: 27 }))
    same('after a failed logout', { items: lis(second).map(li => textOf(li)), total: text(second, 'total') }, { items: ['open: 9', 'pending: 9', 'closed: 9'], total: 'Total: 27' })
    const third = await ready()
    fire(third.el('filter-form'), 'submit')
    const lateFail = take(third, 'GET', SUMMARY_URL)
    fire(third.el('logout'), 'click')
    await settle(take(third, 'DELETE', '/api/session'), c => c.reply(204, ''))
    await settle(lateFail, c => c.fail())
    same('a late failure after a logout', { error: errorText(third) }, { error: '' })
  })

  it('after a logout the page can log in again and fetches a new report', async () => {
    const page = await ready()
    fire(page.el('logout'), 'click')
    await settle(take(page, 'DELETE', '/api/session'), c => c.reply(204, ''))
    setValue(page.el('username'), 'admin')
    setValue(page.el('password'), 'pw')
    fire(page.el('login-form'), 'submit')
    await settle(take(page, 'POST', '/api/session'), c => c.reply(200, { user: USER }))
    await settle(take(page, 'GET', SUMMARY_URL), c => c.reply(200, SUMMARY))
    same('again', { items: lis(page).map(li => textOf(li)), ...shown(page, ['login-form', 'dashboard']), who: text(page, 'who') }, { items: ['open: 2', 'pending: 1', 'closed: 4'], 'login-form': false, dashboard: true, who: 'admin (admin)' })
  })
}
