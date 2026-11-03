import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  useServer, request, postBooking, rawRequest, expectError, JSON_TYPE, VALID_BOOKING,
} from './helpers/server.mjs';

const PUBLIC = new URL('../public/', import.meta.url);
const ROOMS = { rooms: ['Aurora', 'Borealis', 'Cosmos'] };

const NOT_FOUND = [
  ['GET', '/nope'], ['GET', '/api'], ['GET', '/api/'], ['GET', '/api/rooms/'],
  ['GET', '/api/%62ookings'], ['POST', '/api/%62ookings'], ['GET', '/api/./rooms'],
  ['GET', '/api/../api/rooms'], ['GET', '//api/rooms'], ['GET', '/API/rooms'],
  ['GET', '/api/Rooms'], ['GET', '/index.html'], ['GET', '/App.js'], ['GET', '/app.js/'],
  ['GET', '/%61pp.js'], ['GET', '/api/bookings/'], ['DELETE', '/api/bookings/'],
  ['POST', '/api/bookings/'], ['DELETE', '/api/bookings/1/'], ['DELETE', '/api/bookings/1/2'],
  ['GET', '/api/bookings/1/'], ['DELETE', '/api/bookings%2F1'], ['DELETE', '/api/booking/1'],
  ['PUT', '/nope'], ['OPTIONS', '/nope'], ['HEAD', '/nope'],
];

const NOT_ALLOWED = [
  ['POST', '/api/rooms'], ['DELETE', '/api/rooms'], ['PUT', '/api/rooms'],
  ['PATCH', '/api/bookings'], ['PUT', '/api/bookings'], ['DELETE', '/api/bookings'],
  ['GET', '/api/bookings/abc'], ['GET', '/api/bookings/1'], ['POST', '/api/bookings/1'],
  ['PUT', '/api/bookings/1'], ['POST', '/'], ['DELETE', '/'], ['POST', '/app.js'],
  ['OPTIONS', '/api/rooms'], ['OPTIONS', '/api/bookings'], ['OPTIONS', '/'],
  ['OPTIONS', '/api/bookings/1'], ['HEAD', '/'], ['HEAD', '/app.js'], ['HEAD', '/api/rooms'],
  ['HEAD', '/api/bookings'], ['GET', '/api/bookings/%2F'],
];

describe('routing', () => {
  const ctx = useServer({ before, after });

  describe('404 not found', () => {
    for (const [method, path] of NOT_FOUND) {
      test(`${method} ${path}`, async () => {
        const res = await request(ctx.port, { method, path });
        if (method === 'HEAD') return assert.equal(res.status, 404);
        expectError(res, 404, 'not found');
      });
    }
  });

  describe('405 method not allowed', () => {
    for (const [method, path] of NOT_ALLOWED) {
      test(`${method} ${path}`, async () => {
        const res = await request(ctx.port, { method, path });
        if (method === 'HEAD') {
          assert.equal(res.status, 405);
          return assert.equal(res.body.length, 0);
        }
        expectError(res, 405, 'method not allowed');
      });
    }
  });

  describe('query is cut at the first ?', () => {
    const OK = [['/api/rooms?x=1', 'json'], ['/api/rooms?/../x', 'json'], ['/?a', 'html'], ['/app.js?v=1', 'js']];
    for (const [path, kind] of OK) {
      test(`GET ${path} -> 200`, async () => {
        const res = await request(ctx.port, { path });
        assert.equal(res.status, 200);
        if (kind === 'json') assert.deepEqual(res.json(), ROOMS);
        if (kind === 'html') assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
        if (kind === 'js') assert.equal(res.headers['content-type'], 'text/javascript; charset=utf-8');
      });
    }
    for (const path of ['/nope?x', '/api/rooms/?x']) {
      test(`GET ${path} -> 404`, async () => {
        expectError(await request(ctx.port, { path }), 404, 'not found');
      });
    }
  });

  describe('rooms and static files', () => {
    test('GET /api/rooms', async () => {
      const res = await request(ctx.port, { path: '/api/rooms' });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], JSON_TYPE);
      assert.deepEqual(res.json(), ROOMS);
    });

    const FILES = [
      ['/', 'index.html', 'text/html; charset=utf-8'],
      ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ];
    for (const [path, file, type] of FILES) {
      test(`GET ${path} serves ${file}`, async () => {
        const res = await request(ctx.port, { path });
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], type);
        assert.ok(res.body.equals(readFileSync(new URL(file, PUBLIC))));
      });
    }
  });

  describe('JSON content type on every JSON reply', () => {
    const json = { 'Content-Type': 'application/json' };
    const CASES = [
      ['200 list', () => ({ path: '/api/bookings' }), 200],
      ['201', () => ({ method: 'POST', path: '/api/bookings', headers: json, body: JSON.stringify({ ...VALID_BOOKING, date: '2026-01-05' }) }), 201],
      ['400', () => ({ method: 'POST', path: '/api/bookings', headers: json, body: '[]' }), 400],
      ['404', () => ({ path: '/nope' }), 404],
      ['405', () => ({ method: 'PUT', path: '/api/rooms' }), 405],
      ['409', () => ({ method: 'POST', path: '/api/bookings', headers: json, body: JSON.stringify({ ...VALID_BOOKING, date: '2026-01-05' }) }), 409],
      ['413', () => ({ method: 'POST', path: '/api/bookings', headers: json, body: 'x'.repeat(10001) }), 413],
      ['415', () => ({ method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'text/plain' }, body: '{}' }), 415],
    ];
    test('each status carries the exact JSON content type (in order)', async () => {
      for (const [name, build, status] of CASES) {
        const res = await request(ctx.port, build());
        assert.equal(res.status, status, name);
        assert.equal(res.headers['content-type'], JSON_TYPE, name);
      }
    });
  });

  describe('raw requests', () => {
    const RAW = [
      ['GET /api/./rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', 'HTTP/1.1 404'],
      ['GET /API/rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n', 'HTTP/1.1 404'],
      ['GET /api/rooms HTTP/1.1\r\nConnection: close\r\n\r\n', 'HTTP/1.1 200'],
    ];
    for (const [raw, prefix] of RAW) {
      test(JSON.stringify(raw.split('\r\n')[0]) + (raw.includes('Host') ? '' : ' without Host'), async () => {
        const text = await rawRequest(ctx.port, raw);
        assert.ok(text.startsWith(prefix), text.split('\r\n')[0]);
      });
    }
  });

  test('server is still running', async () => {
    assert.equal((await postBooking(ctx.port, VALID_BOOKING)).status, 201);
    const res = await request(ctx.port, { path: '/api/rooms' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json(), ROOMS);
  });
});
