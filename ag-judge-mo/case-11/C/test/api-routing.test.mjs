import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { request, postBooking, validBooking, JSON_TYPE } from './helpers/server-harness.mjs';
import { assertJsonError, listBookings, useServer, MSG } from './helpers/api-assert.mjs';

const PUBLIC_DIR = new URL('../public/', import.meta.url);

function send(port, method, path) {
  const hasBody = method === 'POST';
  return request(port, {
    method,
    path,
    headers: hasBody ? { 'Content-Type': 'application/json' } : {},
    body: hasBody ? JSON.stringify(validBooking()) : undefined,
  });
}

describe('api routing', () => {
  const ctx = useServer();

  describe('GET /api/rooms', () => {
    for (const path of ['/api/rooms', '/api/rooms?', '/api/rooms?x=1', '/api/rooms?/x']) {
      it(`answers the room list for ${path}`, async () => {
        const res = await request(ctx.port, { path });
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], JSON_TYPE);
        assert.deepEqual(res.json(), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
      });
    }
  });

  describe('404 not found', () => {
    const paths = [
      '/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/Rooms', '/api/bookings/',
      '/api/bookings/1/', '/api/bookings/1/2', '/api/bookings//1', '/api/bookings%2F1',
      '/api/rooms/', '/api', '/api/', '/nope', '/index.html', '/app.js/', '//',
      '/public/app.js', '/api/bookings/?date=2026-11-03', '/nope?/api/rooms',
    ];
    for (const path of paths) {
      for (const method of ['GET', 'POST', 'DELETE', 'PUT']) {
        it(`${method} ${path}`, async () => {
          assertJsonError(await send(ctx.port, method, path), 404, MSG.notFound);
        });
      }
    }

    it('created nothing through the POST variants', async () => {
      assert.deepEqual(await listBookings(ctx.port), []);
    });
  });

  describe('405 method not allowed', () => {
    const cases = [
      ['/api/rooms', ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']],
      ['/api/bookings', ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']],
      ['/api/bookings/1', ['GET', 'POST', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']],
      ['/api/bookings/abc', ['GET', 'POST', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']],
      ['/', ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']],
      ['/app.js', ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']],
    ];
    for (const [path, methods] of cases) {
      for (const method of methods) {
        it(`${method} ${path}`, async () => {
          const res = await send(ctx.port, method, path);
          if (method === 'HEAD') assert.equal(res.status, 405);
          else assertJsonError(res, 405, MSG.method);
        });
      }
    }

    it('GET /api/bookings/abc is 405', async () => {
      assertJsonError(await request(ctx.port, { path: '/api/bookings/abc' }), 405, MSG.method);
    });

    it('GET /api/bookings/%31 is 405 because it is the DELETE route', async () => {
      assertJsonError(await request(ctx.port, { path: '/api/bookings/%31' }), 405, MSG.method);
    });
  });

  describe('DELETE /api/bookings/<id>', () => {
    const badIds = ['0', '01', '-1', '1.0', 'abc', '%31', '+1', '1e0', '0x1', '1%20', '99999999999999999999', '2'];

    it('rejects ids that are not a plain existing id and keeps booking 1', async () => {
      const created = await postBooking(ctx.port, validBooking());
      assert.equal(created.status, 201);
      const booking = created.json();
      assert.equal(booking.id, 1);
      for (const id of badIds) {
        const res = await request(ctx.port, { method: 'DELETE', path: `/api/bookings/${id}` });
        assertJsonError(res, 404, MSG.bookingNotFound);
      }
      assert.deepEqual(await listBookings(ctx.port), [booking]);
    });

    it('deletes booking 1 ignoring the query, then reports it gone', async () => {
      const res = await request(ctx.port, { method: 'DELETE', path: '/api/bookings/1?x=y' });
      assert.equal(res.status, 204);
      assert.equal(res.body.length, 0);
      assert.deepEqual(await listBookings(ctx.port), []);
      const again = await request(ctx.port, { method: 'DELETE', path: '/api/bookings/1' });
      assertJsonError(again, 404, MSG.bookingNotFound);
    });

    it('never reuses an id after a delete', async () => {
      const second = await postBooking(ctx.port, validBooking());
      assert.equal(second.status, 201);
      assert.equal(second.json().id, 2);
      const deleted = await request(ctx.port, { method: 'DELETE', path: '/api/bookings/2' });
      assert.equal(deleted.status, 204);
      assert.equal(deleted.body.length, 0);
      const third = await postBooking(ctx.port, validBooking());
      assert.equal(third.status, 201);
      assert.equal(third.json().id, 3);
    });
  });

  describe('page files', () => {
    const files = [
      ['/', 'index.html', 'text/html; charset=utf-8'],
      ['/?x=1', 'index.html', 'text/html; charset=utf-8'],
      ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ];
    for (const [path, file, type] of files) {
      it(`serves ${path} from files next to server.mjs, not from the working directory`, async () => {
        const res = await request(ctx.port, { path });
        assert.equal(res.status, 200);
        assert.equal(res.headers['content-type'], type);
        assert.deepEqual(res.body, readFileSync(new URL(file, PUBLIC_DIR)));
      });
    }
  });

  describe('POST reply', () => {
    it('is 201 with exactly the six booking keys', async () => {
      const res = await postBooking(ctx.port, validBooking({ room: 'Cosmos', date: '2026-12-01' }));
      assert.equal(res.status, 201);
      assert.equal(res.headers['content-type'], JSON_TYPE);
      const body = res.json();
      assert.deepEqual(Object.keys(body).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
      assert.equal(typeof body.id, 'number');
    });
  });
});
