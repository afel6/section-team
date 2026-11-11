// Stage 1, the order of checks: path, method, session, role, id, body; cookies; ids; bodies.
import assert from 'node:assert/strict'
import {
  E, answer, api, err, expect, get, it, post, rawExchange, req, same, sessionOf, shared, sha256, ticketOf, userOf, view, adminOf, USER_PW, ADMIN_PW,
} from './lib.mjs'

const NOT_LISTED = [
  '/api', '/api/', '/api/nope', '/api/session/', '/api/sessions', '/API/session', '/api//session', '/api/%73ession', '/api/session%00', '/api/tickets%3Fx',
  '/api/users/', '/api/users/1/', '/api/users/1/x', '/api/tickets/', '/api/tickets//comments', '/api/tickets/1/comments/', '/api/tickets/1/comments/2',
  '/api/tickets/1/x', '/api/audit/', '/api/audit/1', '/nope', '/index.html', '//api/session', '/./api/session', '/api/./session', '/api/../api/session', '/api/users/../session',
]
const WRONG_METHOD = [
  ['PUT', '/api/session'], ['PATCH', '/api/session'], ['GET', '/api/users/1'], ['POST', '/api/users/1'], ['DELETE', '/api/users/1'], ['PUT', '/api/users'],
  ['DELETE', '/api/users'], ['PATCH', '/api/users'], ['PUT', '/api/tickets'], ['DELETE', '/api/tickets'], ['POST', '/api/tickets/1'], ['PUT', '/api/tickets/1'],
  ['PUT', '/api/tickets/1/comments'], ['DELETE', '/api/tickets/1/comments'], ['PATCH', '/api/tickets/1/comments'], ['POST', '/api/audit'], ['PUT', '/api/audit'],
  ['DELETE', '/api/audit'], ['PATCH', '/api/audit'], ['OPTIONS', '/api/tickets'], ['OPTIONS', '/api/session'], ['GET', '/api/users/abc'],
]
const NEEDS_SESSION = [
  ['GET', '/api/session'], ['DELETE', '/api/session'], ['GET', '/api/users'], ['POST', '/api/users'], ['PATCH', '/api/users/1'], ['PATCH', '/api/users/abc'],
  ['GET', '/api/tickets'], ['POST', '/api/tickets'], ['GET', '/api/tickets/1'], ['PATCH', '/api/tickets/1'], ['DELETE', '/api/tickets/1'], ['GET', '/api/tickets/zzz'],
  ['GET', '/api/tickets/1/comments'], ['POST', '/api/tickets/1/comments'], ['GET', '/api/audit'],
]
const ADMIN_ONLY = [
  ['GET', '/api/users'], ['POST', '/api/users'], ['PATCH', '/api/users/1'], ['PATCH', '/api/users/abc'], ['PATCH', '/api/users/99999'],
  ['DELETE', '/api/tickets/1'], ['DELETE', '/api/tickets/abc'], ['DELETE', '/api/tickets/99999'], ['GET', '/api/audit'],
]
const BAD_IDS = ['abc', '0', '00', '01', '-1', '+1', '1.0', '1e3', '0x1', '%D9%A3', '1%20', '%31', '%2F', '1%2C2', '1,2', '9999999', '99999999999999999999999999999999', '9223372036854775808', '9223372036854775807']

export function routingCases({ stage }) {
  const listed = stage === 1 ? [...NOT_LISTED, '/', '/app.js'] : NOT_LISTED

  it('a path that is not listed is 404 `not found`, whatever the method, session or body', async () => {
    const s = await shared()
    const A = await adminOf(s)
    for (const path of listed) {
      for (const method of ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS']) {
        for (const as of [undefined, A]) {
          same(`${method} ${path}`, view(await req(s, method, path, { as })), answer(404, err(E.notFound)))
        }
      }
      same(`POST ${path} with a wrong type`, view(await req(s, 'POST', path, { body: 'not json', type: 'text/plain' })), answer(404, err(E.notFound)))
      same(`PATCH ${path} too big`, view(await req(s, 'PATCH', path, { body: 'x'.repeat(100_001) })), answer(404, err(E.notFound)))
    }
    assert.equal((await req(s, 'HEAD', '/api/nope')).status, 404)
  })

  it('the path ends at the first ?: the query never changes the route', async () => {
    const s = await shared()
    const A = await adminOf(s)
    same('query on a route', { status: (await get(s, '/api/session?/x', { as: A })).status }, { status: 200 })
    same('query with a slash', { status: (await get(s, '/api/tickets?x=1/comments', { as: A })).status }, { status: 200 })
    same('?? ', { status: (await get(s, '/api/session??', { as: A })).status }, { status: 200 })
    same('an unlisted path with a query', view(await get(s, '/api/nope?/api/session', { as: A })), answer(404, err(E.notFound)))
    same('%3F is part of the path', view(await get(s, '/api/session%3Fx', { as: A })), answer(404, err(E.notFound)))
  })

  it('a listed path with an unlisted method is 405 `method not allowed`, before any session check', async () => {
    const s = await shared()
    const A = await adminOf(s)
    for (const [method, path] of WRONG_METHOD) {
      for (const as of [undefined, A]) same(`${method} ${path}`, view(await req(s, method, path, { as })), answer(405, err(E.methodNotAllowed)))
    }
    assert.equal((await req(s, 'HEAD', '/api/session')).status, 405)
    same('405 before the body checks', view(await req(s, 'PUT', '/api/users', { body: '{', type: 'text/plain' })), answer(405, err(E.methodNotAllowed)))
  })

  it('a route that needs a session answers 401 `login required` without one, before the role, id and body checks', async () => {
    const s = await shared()
    for (const [method, path] of NEEDS_SESSION) {
      same(`${method} ${path}`, view(await req(s, method, path)), answer(401, err(E.login)))
      same(`${method} ${path} bad body`, view(await req(s, method, path, { body: '{', type: 'text/plain' })), answer(401, err(E.login)))
    }
    for (const cookie of ['sid=', 'sid=abc', `sid=${'0'.repeat(64)}`, 'other=1', 'sid', 'SID=x']) {
      same(cookie, view(await get(s, '/api/session', { headers: { cookie } })), answer(401, err(E.login)))
    }
    const invalid = await post(s, '/api/session', 'x', { type: 'text/plain' })
    same('login needs no session, so the body is checked', view(invalid), answer(415, err(E.contentType)))
  })

  it('an admin-only route answers 403 `forbidden` to a member, before the id and body checks, and 401 comes first', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const M = await userOf(s, A)
    for (const [method, path] of ADMIN_ONLY) {
      same(`${method} ${path}`, view(await req(s, method, path, { as: M })), answer(403, err(E.forbidden)))
      same(`${method} ${path} bad body`, view(await req(s, method, path, { as: M, body: '{', type: 'text/plain' })), answer(403, err(E.forbidden)))
    }
  })

  it('the session cookie: the first piece that starts with sid= is the token; pieces are cut at ; and trimmed of spaces and tabs', async () => {
    const s = await shared()
    const { token } = await adminOf(s)
    const T = token
    const accepted = [`sid=${T}`, ` sid=${T}`, `a=b; sid=${T}`, `a=b;sid=${T}`, `a=b;\tsid=${T}\t`, `sid=${T}; a=b`, `sid=${T} ;a=b`, `a=b; sid=${T}; sid=bad`, `sidx=1; sid=${T}`, `xsid=bad; sid=${T}`,
      `SID=bad; sid=${T}`, `;;sid=${T}`, `a=sid=bad; sid=${T}`, ` \t sid=${T}`]
    const rejected = [`sid=bad; sid=${T}`, 'sid=', `sid=${T}.`, `sid=${T.toUpperCase()}`, `sid="${T}"`, `xsid=${T}`, `SID=${T}`, `sidT`, `sid =${T}`, `sid%3D${T}`, `a=sid=${T}`, `sid=${T},x`, `sid=${T}x`, `sid=${sha256(T)}`]
    for (const cookie of accepted) same(cookie, { status: (await get(s, '/api/session', { headers: { cookie } })).status }, { status: 200 })
    for (const cookie of rejected) same(cookie, view(await get(s, '/api/session', { headers: { cookie } })), answer(401, err(E.login)))
  })

  it('an <id> that is not a positive integer without a leading zero, or names no row, is 404 before any body check', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const made = await ticketOf(s, A, 'exists')
    const ids = [...BAD_IDS, `%3${made.id}`, `${made.id}%20`, String(made.id + 1_000_000)]
    const bad = { as: A, body: '{', type: 'text/plain' }
    for (const id of ids) {
      same(`user ${id}`, view(await req(s, 'PATCH', `/api/users/${id}`, bad)), answer(404, err(E.userNotFound)))
      same(`user ${id} valid body`, view(await req(s, 'PATCH', `/api/users/${id}`, { as: A, body: { role: 'member' } })), answer(404, err(E.userNotFound)))
      for (const [method, tail] of [['GET', ''], ['PATCH', ''], ['DELETE', ''], ['GET', '/comments'], ['POST', '/comments']]) {
        same(`${method} ticket ${id}${tail}`, view(await req(s, method, `/api/tickets/${id}${tail}`, bad)), answer(404, err(E.ticketNotFound)))
      }
    }
    same('a good id still works', { status: (await get(s, `/api/tickets/${made.id}`, { as: A })).status }, { status: 200 })
  })

  it('POST and PATCH check Content-Type first: the media type before the first ;, trimmed of spaces and tabs, letter case ignored', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const rules400 = answer(400, err(E.username))
    for (const type of [null, '', 'text/plain', 'application/jsonp', 'application/json-patch+json', 'application/x-www-form-urlencoded', 'json', 'application', 'application/json/x', 'xapplication/json', ';application/json']) {
      same(`type ${JSON.stringify(type)}`, view(await post(s, '/api/users', {}, { as: A, type })), answer(415, err(E.contentType)))
    }
    for (const type of ['application/json', 'APPLICATION/JSON', 'Application/Json; charset=utf-8', 'application/json ; charset=utf-8', 'application/json;', 'application/json;charset', 'application/json\t;x=1', 'application/json; a="b;c"']) {
      same(`type ${JSON.stringify(type)}`, view(await post(s, '/api/users', {}, { as: A, type })), rules400)
    }
    same('PATCH checks it too', view(await req(s, 'PATCH', '/api/tickets/9999999', { as: A, body: '{}', type: 'text/plain' })), answer(404, err(E.ticketNotFound)))
    const t = await ticketOf(s, A)
    same('PATCH wrong type', view(await req(s, 'PATCH', `/api/tickets/${t.id}`, { as: A, body: '{"title":"x"}', type: 'text/plain' })), answer(415, err(E.contentType)))
  })

  it('a body over 100000 bytes is 413 after the type check and before the JSON check; the limit counts bytes', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const padded = (bytes, ch = 'a') => {
      const head = '{"pad":"'
      const tail = '"}'
      const unit = Buffer.byteLength(ch)
      const n = Math.floor((bytes - head.length - tail.length) / unit)
      const body = head + ch.repeat(n) + tail
      return body + ' '.repeat(bytes - Buffer.byteLength(body))
    }
    for (const [label, body] of [['100000 ascii bytes', padded(100_000)], ['100000 bytes with 2-byte characters', padded(100_000, 'é')], ['100000 bytes with 4-byte characters', padded(100_000, '😀')]]) {
      assert.equal(Buffer.byteLength(body), 100_000)
      same(label, view(await post(s, '/api/users', body, { as: A })), answer(400, err(E.username)))
    }
    for (const [label, body] of [['100001 ascii bytes', padded(100_001)], ['100002 bytes with 2-byte characters', padded(100_002, 'é')], ['not JSON at all', 'x'.repeat(100_001)], ['two megabytes', padded(2_000_000)]]) {
      same(label, view(await post(s, '/api/users', body, { as: A })), answer(413, err(E.tooLarge)))
    }
    same('in pieces', view(await post(s, '/api/users', undefined, { as: A, parts: [padded(60_000), padded(60_000)], gap: 20 })), answer(413, err(E.tooLarge)))
    same('the type check comes first', view(await post(s, '/api/users', padded(100_001), { as: A, type: 'text/plain' })), answer(415, err(E.contentType)))
    same('PATCH has the limit too', view(await req(s, 'PATCH', '/api/users/1', { as: A, body: padded(100_001) })), answer(413, err(E.tooLarge)))
  })

  it('a body that is not a JSON object is 400 `body must be a JSON object`; the body is decoded as UTF-8 and given to JSON.parse', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const raw = ['', ' ', '{', '[]', '[{}]', 'null', '"x"', '1', 'true', '{"a":1}x', '{} {}', "{'a':1}", '﻿{}', '{"a":1,}', 'undefined', '{"a":1}\u0000']
    for (const body of raw) same(JSON.stringify(body), view(await post(s, '/api/users', body, { as: A })), answer(400, err(E.notObject)))
    for (const body of [' {} ', '\n{"a":1}\r\n', '{"username":"\\u00e9"}']) same(JSON.stringify(body), view(await post(s, '/api/users', body, { as: A })), answer(400, err(E.username)))
    const badBytes = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0xfe, 0x22, 0x7d])
    same('invalid UTF-8 inside a string is replaced, not refused', view(await post(s, '/api/users', badBytes, { as: A })), answer(400, err(E.username)))
    same('PATCH', view(await req(s, 'PATCH', '/api/users/1', { as: A, body: '[]' })), answer(400, err(E.notObject)))
    same('login', view(await post(s, '/api/session', '[]')), answer(400, err(E.notObject)))
  })

  it('a key counts as present when the object has it, null included; other keys are ignored', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const t = await ticketOf(s, A)
    const c = api(s, A)
    same('null title', view(await c.patch(`/api/tickets/${t.id}`, { title: null })), answer(400, err(E.title)))
    same('null priority', view(await c.patch(`/api/tickets/${t.id}`, { priority: null })), answer(400, err(E.priority)))
    same('only unknown keys', view(await c.patch(`/api/tickets/${t.id}`, { color: 'red', __proto__: { title: 'x' } })), answer(400, err(E.nothing)))
    same('inherited names are not keys', view(await c.patch(`/api/tickets/${t.id}`, JSON.parse('{"constructor":1,"toString":2,"hasOwnProperty":3}'))), answer(400, err(E.nothing)))
    same('null password', view(await c.patch('/api/users/1', { password: null })), answer(400, err(E.password)))
    same('null role', view(await c.patch('/api/users/1', { role: null })), answer(400, err(E.role)))
  })

  it('the whole request body is read before any reply, also for a 404, 401 or 415', async () => {
    const s = await shared()
    for (const [path, want] of [['/api/nope', '404'], ['/api/users', '401'], ['/api/session', '415']]) {
      const head = `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Length: 10\r\nConnection: close\r\n\r\nabcde`
      const { got, seen } = await rawExchange(s.port, [head, 500, 'fghij'])
      same(path, { early: seen[0], status: /^HTTP\/1\.1 (\d+)/.exec(got)?.[1] }, { early: 0, status: want })
    }
  })

  it('GET and DELETE ignore a body they were sent', async () => {
    const s = await shared()
    const A = await sessionOf(s, 'admin', ADMIN_PW)
    same('GET with a body and a wrong type', { status: (await req(s, 'GET', '/api/session', { as: A, body: '{{', type: 'text/plain' })).status }, { status: 200 })
    same('DELETE with a body', { status: (await req(s, 'DELETE', '/api/session', { as: A, body: '[1,2' })).status }, { status: 204 })
  })

  it('every reply with a body is JSON with the charset; 204 has no body', async () => {
    const s = await shared()
    const A = await adminOf(s)
    const M = await userOf(s, A)
    const replies = [await get(s, '/api/nope'), await req(s, 'PUT', '/api/users'), await get(s, '/api/users'), await get(s, '/api/users', { as: M }), await post(s, '/api/users', {}, { as: A }),
      await get(s, '/api/tickets', { as: A }), await post(s, '/api/session', { username: 'admin', password: 'wrong' }), await get(s, '/api/audit', { as: A })]
    for (const r of replies) assert.equal(r.type, 'application/json; charset=utf-8', `${r.status} ${r.text.slice(0, 60)}`)
    const out = await post(s, '/api/session', { username: M.made.username, password: USER_PW })
    const gone = await req(s, 'DELETE', '/api/session', { headers: { cookie: `sid=${/sid=([0-9a-f]{64})/.exec(out.headers['set-cookie'][0])[1]}` } })
    same('204', { status: gone.status, text: gone.text }, { status: 204, text: '' })
    await expect('error shape', get(s, '/api/nope'), 404, { error: E.notFound })
  })
}
