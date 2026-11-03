// Data file behaviour: location, write discipline, persistence, save failures.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  startServer, request, postJson, booking, makeTempDir, removeDir, ROOT, JSON_CT,
} from './helpers.mjs';

async function withTmp(fn) {
  const dir = await makeTempDir();
  try {
    return await fn(dir);
  } finally {
    await removeDir(dir);
  }
}

async function withServer(options, fn) {
  const server = await startServer(options);
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}

const del = (port, id) => request(port, { method: 'DELETE', path: `/api/bookings/${id}` });
const list = async (port) => (await request(port, { path: '/api/bookings' })).json;
const STORE = '{"nextId":1,"bookings":[]}';

describe('F. relative DATA_FILE', () => {
  test('resolved against cwd', () => withTmp(async (dir) => {
    const rootCopy = path.join(ROOT, 'rel.json');
    const existed = fs.existsSync(rootCopy);
    await withServer({ env: { DATA_FILE: 'rel.json' }, cwd: dir }, async (s) => {
      assert.equal((await postJson(s.port, booking())).status, 201);
    });
    assert.equal(fs.existsSync(path.join(dir, 'rel.json')), true);
    assert.equal(fs.existsSync(rootCopy), existed);
  }));

  test('unset DATA_FILE defaults to bookings.json in cwd', () => withTmp(async (dir) => {
    await withServer({ cwd: dir }, async (s) => {
      assert.equal((await postJson(s.port, booking())).status, 201);
    });
    assert.equal(fs.existsSync(path.join(dir, 'bookings.json')), true);
  }));
});

describe('G. no writes except successful POST/DELETE', () => {
  test('existing file is untouched', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    fs.writeFileSync(file, STORE);
    const before = fs.readFileSync(file);
    const mtime = fs.statSync(file).mtimeMs;
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      await request(port, { path: '/api/rooms' });
      await request(port, { path: '/api/bookings' });
      assert.equal((await postJson(port, booking({ room: 'x' }))).status, 400);
      assert.equal((await postJson(port, booking(), { 'Content-Type': 'text/plain' })).status, 415);
      assert.equal((await del(port, 99)).status, 404);
      await request(port, { path: '/' });
    });
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.statSync(file).mtimeMs, mtime);
  }));

  test('missing file is not created by failed requests', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      await postJson(port, booking({ title: '' }));
      await postJson(port, booking(), { 'Content-Type': 'text/plain' });
      await del(port, 1);
      assert.equal(fs.existsSync(file), false);
    });
    assert.equal(fs.existsSync(file), false);
  }));
});

describe('H. persistence', () => {
  async function seed(file) {
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      for (const start of ['09:00', '10:00', '11:00']) {
        const end = `${Number(start.slice(0, 2)) + 1}:00`;
        const res = await postJson(port, booking({ start, end }));
        assert.equal(res.status, 201);
      }
    });
  }

  test('state and next id survive restart', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    let first;
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      const ids = [];
      for (const start of ['09:00', '10:00', '11:00']) {
        const res = await postJson(port, booking({ start, end: `${Number(start.slice(0, 2)) + 1}:00` }));
        ids.push(res.json.id);
      }
      assert.deepEqual(ids, [1, 2, 3]);
      assert.equal((await del(port, 3)).status, 204);
      assert.equal((await del(port, 2)).status, 204);
      first = (await list(port)).bookings;
    });
    assert.equal(first.length, 1);
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      assert.deepEqual((await list(port)).bookings, first);
      assert.equal(first[0].id, 1);
      assert.equal((await postJson(port, booking({ start: '15:00', end: '16:00' }))).json.id, 4);
    });
  }));

  test('next id continues after deleting everything', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    await seed(file);
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      for (const id of [1, 2, 3]) assert.equal((await del(port, id)).status, 204);
    });
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      assert.deepEqual(await list(port), { bookings: [] });
      assert.equal((await postJson(port, booking())).json.id, 4);
    });
  }));

  test('memory is the truth after startup', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    await withServer({ env: { DATA_FILE: file } }, async ({ port }) => {
      await postJson(port, booking());
      const before = await list(port);
      fs.writeFileSync(file, STORE);
      assert.deepEqual(await list(port), before);
      assert.equal(before.bookings.length, 1);
    });
  }));
});

describe('I. save failure', () => {
  function assertInternal(res) {
    assert.equal(res.status, 500);
    assert.deepEqual(res.json, { error: 'internal error' });
    assert.equal(res.headers['content-type'], JSON_CT);
  }

  test('POST save failure changes nothing', () => withTmp(async (dir) => {
    const folder = path.join(dir, 'folder');
    await withServer({ env: { DATA_FILE: path.join(folder, 'b.json') } }, async ({ port, child }) => {
      assertInternal(await postJson(port, booking()));
      assert.equal(fs.existsSync(folder), false);
      assert.deepEqual(await list(port), { bookings: [] });
      assert.equal(child.exitCode, null);
      fs.mkdirSync(folder);
      const res = await postJson(port, booking());
      assert.equal(res.status, 201);
      assert.equal(res.json.id, 1);
    });
  }));

  test('DELETE save failure changes nothing', () => withTmp(async (dir) => {
    const sub = path.join(dir, 'd');
    const file = path.join(sub, 'b.json');
    fs.mkdirSync(sub);
    const stored = { id: 1, ...booking() };
    fs.writeFileSync(file, JSON.stringify({ nextId: 2, bookings: [stored] }));
    await withServer({ env: { DATA_FILE: file } }, async ({ port, child }) => {
      fs.rmSync(sub, { recursive: true, force: true });
      assertInternal(await del(port, 1));
      assert.deepEqual(await list(port), { bookings: [stored] });
      assert.equal(child.exitCode, null);
      fs.mkdirSync(sub);
      const res = await postJson(port, booking({ start: '12:00', end: '13:00' }));
      assert.equal(res.status, 201);
      assert.equal(res.json.id, 2);
    });
  }));
});

describe('J. file content', () => {
  test('file after POST is JSON', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    await withServer({ env: { DATA_FILE: file } }, async ({ port, out }) => {
      assert.equal((await postJson(port, booking())).status, 201);
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, 'utf8')));
      assert.equal(out.stdout, `listening on http://127.0.0.1:${port}\n`);
    });
  }));
});
