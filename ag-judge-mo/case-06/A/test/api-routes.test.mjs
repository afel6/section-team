import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, postJson, booking, JSON_CT } from './helpers.mjs';
import {
  fixture, assertJson, create, listBookings, NOT_FOUND, NOT_ALLOWED,
} from './api-util.mjs';

describe('GET /api/rooms', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  for (const p of ['/api/rooms', '/api/rooms?x=1']) {
    it(`200 rooms for ${p}`, async () => {
      assertJson(await request(fx.port, { path: p }), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    });
  }
});

describe('404 routes', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  const paths = [
    '/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/Rooms', '/api/rooms/',
    '/nope', '/index.html', '/app.js/', '//', '/api', '/api/', '/api/bookings//1',
  ];
  for (const p of paths) {
    it(`GET ${p}`, async () => {
      assertJson(await request(fx.port, { path: p }), 404, NOT_FOUND);
    });
  }

  for (const p of ['/api/bookings/', '/api/bookings/1/']) {
    for (const method of ['GET', 'DELETE']) {
      it(`${method} ${p}`, async () => {
        assertJson(await request(fx.port, { method, path: p }), 404, NOT_FOUND);
      });
    }
  }

  it('DELETE /api/bookings//1 and /api/bookings/1/x', async () => {
    for (const p of ['/api/bookings//1', '/api/bookings/1/x', '/api/bookings/?x']) {
      assertJson(await request(fx.port, { method: 'DELETE', path: p }), 404, NOT_FOUND);
    }
  });

  it('404 whatever the method', async () => {
    for (const p of ['/nope', '/api', '/api/rooms/', '/API/rooms', '/api/bookings/1/', '//']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
        assertJson(await request(fx.port, { method, path: p }), 404, NOT_FOUND);
      }
    }
  });
});

describe('405 routes', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  const cases = [
    ['/api/rooms', ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/bookings', ['PUT', 'DELETE', 'PATCH', 'OPTIONS']],
    ['/api/bookings/1', ['GET', 'POST', 'PUT']],
    ['/api/bookings/abc', ['GET']],
    ['/', ['POST', 'DELETE', 'OPTIONS']],
    ['/app.js', ['POST', 'DELETE']],
  ];
  for (const [p, methods] of cases) {
    for (const method of methods) {
      it(`${method} ${p}`, async () => {
        assertJson(await request(fx.port, { method, path: p }), 405, NOT_ALLOWED);
      });
    }
  }

  for (const p of ['/api/rooms', '/api/bookings', '/', '/app.js']) {
    it(`HEAD ${p}`, async () => {
      const res = await request(fx.port, { method: 'HEAD', path: p });
      assert.equal(res.status, 405);
    });
  }
});

describe('DELETE route', () => {
  const fx = fixture();
  before(async () => {
    await fx.start();
    await create(fx.port, { start: '09:00', end: '10:00' });
    await create(fx.port, { start: '10:00', end: '11:00' });
  });
  after(() => fx.stop());

  const bad = ['01', '0', '-1', '1.0', '+1', 'abc', '%31', '%EF%BC%91', '99'];
  for (const id of bad) {
    it(`DELETE /api/bookings/${id} is booking not found`, async () => {
      const res = await request(fx.port, { method: 'DELETE', path: `/api/bookings/${id}` });
      assertJson(res, 404, { error: 'booking not found' });
      const ids = (await listBookings(fx.port)).map((b) => b.id);
      assert.deepEqual(ids, [1, 2]);
    });
  }

  it('DELETE with query removes the booking, then 404', async () => {
    const res = await request(fx.port, { method: 'DELETE', path: '/api/bookings/1?x=2' });
    assert.equal(res.status, 204);
    assert.equal(res.raw.length, 0);
    assert.deepEqual((await listBookings(fx.port)).map((b) => b.id), [2]);
    const again = await request(fx.port, { method: 'DELETE', path: '/api/bookings/1' });
    assertJson(again, 404, { error: 'booking not found' });
  });
});

describe('Content-Type on every JSON reply', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  it('is exactly application/json; charset=utf-8', async () => {
    const big = Buffer.alloc(10001, 0x20);
    const json = { 'Content-Type': 'application/json' };
    const replies = [
      [200, await request(fx.port, { path: '/api/rooms' })],
      [200, await request(fx.port, { path: '/api/bookings' })],
      [201, await postJson(fx.port, booking())],
      [400, await postJson(fx.port, booking({ room: 'X' }))],
      [404, await request(fx.port, { path: '/nope' })],
      [405, await request(fx.port, { method: 'PUT', path: '/api/rooms' })],
      [409, await postJson(fx.port, booking())],
      [413, await postJson(fx.port, big, json)],
      [415, await postJson(fx.port, '{}', { 'Content-Type': 'text/plain' })],
    ];
    for (const [status, res] of replies) {
      assert.equal(res.status, status);
      assert.equal(res.headers['content-type'], JSON_CT, `status ${status}`);
      assert.notEqual(res.json, undefined, `status ${status}`);
    }
  });
});
