import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  withTemp, startServer, request, postBooking, expectError, VALID_BOOKING,
} from './helpers/server.mjs';

const INTERNAL_MESSAGE = 'internal error';

/** Runs fn(start) where start() launches a server on `file` and is tracked for cleanup. */
async function withRuns(file, dir, fn) {
  const running = [];
  const start = async () => {
    const server = await startServer({ env: { DATA_FILE: file }, cwd: dir });
    running.push(server);
    return server;
  };
  try {
    return await fn(start);
  } finally {
    await Promise.all(running.map((s) => s.stop()));
  }
}

const at = (hour, extra = {}) => {
  const pad = (n) => String(n).padStart(2, '0');
  return { ...VALID_BOOKING, start: `${pad(hour)}:00`, end: `${pad(hour + 1)}:00`, ...extra };
};
const expected = (id, body) => ({ id, ...body });
const list = async (port, query = '') => (await request(port, { path: `/api/bookings${query}` })).json();
const del = (port, id) => request(port, { method: 'DELETE', path: `/api/bookings/${id}` });

async function createOk(port, body, id) {
  const res = await postBooking(port, body);
  assert.equal(res.status, 201);
  assert.deepEqual(res.json(), expected(id, body));
}

async function assertDeleted(port, id) {
  const res = await del(port, id);
  assert.equal(res.status, 204);
  assert.equal(res.body.length, 0);
}

describe('restart', () => {
  test('bookings and next id survive restarts, ids are never reused', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await withRuns(file, dir, async (start) => {
        const first = await start();
        for (const [i, hour] of [9, 10, 11].entries()) await createOk(first.port, at(hour), i + 1);
        await assertDeleted(first.port, 3);
        await assertDeleted(first.port, 1);
        await first.stop();

        const second = await start();
        assert.deepEqual(await list(second.port), { bookings: [expected(2, at(10))] });
        await createOk(second.port, at(12), 4);
        await assertDeleted(second.port, 2);
        await assertDeleted(second.port, 4);
        await second.stop();

        const third = await start();
        assert.deepEqual(await list(third.port), { bookings: [] });
        await createOk(third.port, at(13), 5);
      });
    });
  });

  test('data file is valid JSON after every change', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await withRuns(file, dir, async (start) => {
        const { port } = await start();
        const parse = async () => JSON.parse(await fs.readFile(file, 'utf8'));
        await createOk(port, at(9), 1);
        await parse();
        await createOk(port, at(10), 2);
        await parse();
        await assertDeleted(port, 1);
        await parse();
        await assertDeleted(port, 2);
        await parse();
      });
    });
  });
});

describe('save failure', () => {
  test('failed saves change nothing and the server keeps running', async () => {
    await withTemp(async (dir) => {
      const folder = path.join(dir, 'missing');
      const file = path.join(folder, 'data.json');
      await withRuns(file, dir, async (start) => {
        const running = await start();
        const { port } = running;
        expectError(await postBooking(port, at(9)), 500, INTERNAL_MESSAGE);
        assert.deepEqual(await list(port), { bookings: [] });
        assert.equal((await request(port, { path: '/api/rooms' })).status, 200);

        await fs.mkdir(folder);
        await createOk(port, at(9), 1);

        await fs.rm(folder, { recursive: true });
        expectError(await del(port, 1), 500, INTERNAL_MESSAGE);
        assert.deepEqual(await list(port), { bookings: [expected(1, at(9))] });
        expectError(await postBooking(port, at(10)), 500, INTERNAL_MESSAGE);

        await fs.mkdir(folder);
        await createOk(port, at(10), 2);
        await assertDeleted(port, 1);
        assert.equal(running.output.stdout, `listening on http://127.0.0.1:${port}\n`);
        assert.equal(running.output.stderr, '');
      });
      await withRuns(file, dir, async (start) => {
        const { port } = await start();
        assert.deepEqual(await list(port), { bookings: [expected(2, at(10))] });
        await createOk(port, at(11), 3);
      });
    });
  });
});

const OVERLAP_409 = { error: 'room is already booked from 09:00 to 10:00' };

describe('concurrency', () => {
  test('identical overlapping POSTs create exactly one booking', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await withRuns(file, dir, async (start) => {
        const { port } = await start();
        const results = await Promise.all(Array.from({ length: 10 }, () => postBooking(port, VALID_BOOKING)));
        const statuses = results.map((r) => r.status).sort();
        assert.deepEqual(statuses, [201, ...Array(9).fill(409)]);
        for (const r of results.filter((x) => x.status === 409)) assert.deepEqual(r.json(), OVERLAP_409);
        assert.deepEqual(await list(port), { bookings: [expected(1, VALID_BOOKING)] });
      });
    });
  });

  test('non-overlapping POSTs get distinct consecutive ids and persist', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await withRuns(file, dir, async (start) => {
        const first = await start();
        await createOk(first.port, VALID_BOOKING, 1);
        const bodies = Array.from({ length: 10 }, (_, i) => at(8 + i, { room: 'Borealis', date: '2026-11-04' }));
        const results = await Promise.all(bodies.map((b) => postBooking(first.port, b)));
        assert.deepEqual(results.map((r) => r.status), Array(10).fill(201));
        const ids = results.map((r) => r.json().id).sort((a, b) => a - b);
        assert.deepEqual(ids, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        results.forEach((r, i) => assert.deepEqual(r.json(), expected(r.json().id, bodies[i])));
        await first.stop();

        const second = await start();
        const { bookings } = await list(second.port);
        assert.equal(bookings.length, 11);
        assert.deepEqual(bookings.map((b) => b.id).sort((a, b) => a - b), [1, ...ids]);
        await createOk(second.port, at(9, { room: 'Cosmos' }), 12);
      });
    });
  });

  test('POST overlapping with a concurrent DELETE matches a sequential order', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await withRuns(file, dir, async (start) => {
        const { port } = await start();
        const old = at(9, { room: 'Cosmos', date: '2026-12-01' });
        const fresh = at(9, { room: 'Cosmos', date: '2026-12-01', end: '10:30' });
        await createOk(port, old, 1);
        const [post, deletion] = await Promise.all([postBooking(port, fresh), del(port, 1)]);
        assert.equal(deletion.status, 204);
        assert.equal(deletion.body.length, 0);
        if (post.status === 409) {
          assert.deepEqual(post.json(), OVERLAP_409);
          assert.deepEqual(await list(port), { bookings: [] });
        } else {
          assert.equal(post.status, 201);
          assert.deepEqual(post.json(), expected(2, fresh));
          assert.deepEqual(await list(port), { bookings: [expected(2, fresh)] });
        }
      });
    });
  });
});
