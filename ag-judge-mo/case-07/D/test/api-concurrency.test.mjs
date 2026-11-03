import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, postJson, booking } from './helpers.mjs';
import { fixture, assertJson, create, listBookings } from './api-util.mjs';

describe('body draining', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());
  const FIVE_MB = Buffer.alloc(5 * 1024 * 1024, 0x61);

  it('415 with a 5 MB text/plain body is received', async () => {
    const res = await postJson(fx.port, FIVE_MB, { 'Content-Type': 'text/plain' });
    assertJson(res, 415, { error: 'content type must be application/json' });
  });

  it('413 with a 5 MB json body is received', async () => {
    const res = await postJson(fx.port, FIVE_MB, { 'Content-Type': 'application/json' });
    assertJson(res, 413, { error: 'body too large' });
  });

  it('GET /api/rooms with a 1 MB body is 200', async () => {
    const res = await request(fx.port, { path: '/api/rooms', body: Buffer.alloc(1024 * 1024, 0x62) });
    assertJson(res, 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });
});

describe('concurrency', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  it('20 overlapping POSTs: one 201, nineteen 409', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) =>
      postJson(fx.port, booking({ title: `t${i}` }))));
    const created = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    assert.equal(created.length, 1);
    assert.equal(conflicts.length, 19);
    assert.equal(created[0].json.id, 1);
    for (const c of conflicts) {
      assertJson(c, 409, { error: 'room is already booked from 09:00 to 10:00' });
    }
  });

});

describe('concurrency: 30 non-overlapping POSTs', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  it('ids are exactly 1..30 and persist across restart; next id is 31', async () => {
    const rooms = ['Aurora', 'Borealis', 'Cosmos'];
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) =>
      postJson(fx.port, booking({
        room: rooms[i % 3], title: `n${i}`, date: `2027-01-${String(i + 1).padStart(2, '0')}`,
      }))));
    for (const r of results) assert.equal(r.status, 201, r.text);
    const ids = results.map((r) => r.json.id).sort((a, b) => a - b);
    assert.deepEqual(ids, Array.from({ length: 30 }, (_, i) => i + 1));
    assert.equal((await listBookings(fx.port)).length, 30);

    await fx.restart();
    const stored = (await listBookings(fx.port)).map((b) => b.id).sort((a, b) => a - b);
    assert.deepEqual(stored, ids);
    const next = await create(fx.port, { room: 'Cosmos', date: '2028-05-05' });
    assert.equal(next.id, 31);
  });
});

describe('concurrency: simultaneous DELETEs', () => {
  const fx = fixture();
  before(() => fx.start());
  after(() => fx.stop());

  it('10 concurrent DELETEs of one id: one 204, nine 404', async () => {
    const target = await create(fx.port, { room: 'Borealis', date: '2029-03-03' });
    assert.equal(target.id, 1);
    const results = await Promise.all(Array.from({ length: 10 }, () =>
      request(fx.port, { method: 'DELETE', path: `/api/bookings/${target.id}` })));
    assert.equal(results.filter((r) => r.status === 204).length, 1);
    const missing = results.filter((r) => r.status === 404);
    assert.equal(missing.length, 9);
    for (const m of missing) assertJson(m, 404, { error: 'booking not found' });
    assert.deepEqual(await listBookings(fx.port), []);
  });
});
