import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { tempDir, runToExit, startServer, api, rawRequest, sample } from './helpers.mjs';

const JSON_TYPE = 'application/json; charset=utf-8';

describe('startup', () => {
  test('rejects invalid PORT values', async () => {
    for (const port of ['abc', '-1', '65536', '1e3', ' 80', '+80', '８０']) {
      const r = await runToExit({ PORT: port, DATA_FILE: path.join(tempDir(), 'x.json') });
      assert.equal(r.code, 1, `PORT=${port}`);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.length > 0);
    }
  });

  test('checks PORT before reading the data file', async () => {
    const dir = tempDir();
    const r = await runToExit({ PORT: 'nope', DATA_FILE: dir });
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stderr, /cannot read data file/);
  });

  test('fails on unreadable or invalid data files', async () => {
    const dir = tempDir();
    const bad = {
      empty: '',
      garbage: 'not json',
      arr: '[]',
      nul: 'null',
      wrong: '{"bookings": "x", "nextId": 1}',
    };
    for (const [name, content] of Object.entries(bad)) {
      fs.writeFileSync(path.join(dir, name), content);
      const r = await runToExit({ PORT: '0', DATA_FILE: name }, dir);
      assert.equal(r.code, 1, name);
      assert.equal(r.stderr, `cannot read data file ${name}\n`);
      assert.equal(r.stdout, '');
    }
    const r = await runToExit({ PORT: '0', DATA_FILE: dir });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, `cannot read data file ${dir}\n`);
  });

  test('default data file is bookings.json in the cwd', async () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, 'bookings.json'));
    const r = await runToExit({ PORT: '0', DATA_FILE: '' }, dir);
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'cannot read data file bookings.json\n');
  });

  test('fails when the port is in use', async () => {
    const blocker = net.createServer();
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const r = await runToExit({ PORT: String(blocker.address().port), DATA_FILE: path.join(tempDir(), 'x.json') });
    blocker.close();
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.length > 0);
  });

  test('missing file means no bookings and is not created by startup', async () => {
    const dir = tempDir();
    const s = await startServer({ DATA_FILE: 'data.json' }, dir);
    try {
      const r = await api(s.base, 'GET', '/api/bookings');
      assert.deepEqual(r.json, { bookings: [] });
      assert.equal(fs.existsSync(path.join(dir, 'data.json')), false);
    } finally {
      await s.stop();
    }
  });
});

describe('API', () => {
  let s;
  let dir;
  before(async () => {
    dir = tempDir();
    s = await startServer({ DATA_FILE: path.join(dir, 'b.json') });
  });
  after(() => s.stop());

  test('rooms', async () => {
    const r = await api(s.base, 'GET', '/api/rooms');
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), JSON_TYPE);
    assert.deepEqual(r.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });

  test('create, list, filter, delete', async () => {
    const a = await api(s.base, 'POST', '/api/bookings', { body: sample({ title: '  Standup  ', extra: 1 }) });
    assert.equal(a.status, 201);
    assert.deepEqual(a.json, { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' });
    const b = await api(s.base, 'POST', '/api/bookings', { body: sample({ room: 'Cosmos', start: '08:00', end: '09:00' }) });
    const c = await api(s.base, 'POST', '/api/bookings', { body: sample({ room: 'Borealis', start: '09:00' }) });
    const d = await api(s.base, 'POST', '/api/bookings', { body: sample({ date: '2026-11-02' }) });
    assert.deepEqual([b.json.id, c.json.id, d.json.id], [2, 3, 4]);

    const all = await api(s.base, 'GET', '/api/bookings');
    assert.deepEqual(all.json.bookings.map((x) => x.id), [4, 2, 1, 3]);

    const f = await api(s.base, 'GET', '/api/bookings?date=2026-11-03&date=2026-11-02&x=1');
    assert.deepEqual(f.json.bookings.map((x) => x.id), [2, 1, 3]);

    for (const q of ['?date', '?date=', '?date=2026-02-30', '?date=2026-11-3']) {
      const e = await api(s.base, 'GET', '/api/bookings' + q);
      assert.equal(e.status, 400, q);
      assert.deepEqual(e.json, { error: 'date must be a valid YYYY-MM-DD date' });
    }

    const del = await api(s.base, 'DELETE', '/api/bookings/2');
    assert.equal(del.status, 204);
    assert.equal(del.text, '');
    const again = await api(s.base, 'DELETE', '/api/bookings/2');
    assert.equal(again.status, 404);
    assert.deepEqual(again.json, { error: 'booking not found' });

    for (const id of ['01', '0', '-1', '1.0', 'abc', '%31']) {
      const r = await api(s.base, 'DELETE', '/api/bookings/' + id);
      assert.equal(r.status, 404, id);
      assert.deepEqual(r.json, { error: 'booking not found' });
    }

    const next = await api(s.base, 'POST', '/api/bookings', { body: sample({ date: '2027-01-01' }) });
    assert.equal(next.json.id, 5);
  });

  test('validation rules in order', async () => {
    const cases = [
      [{ headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(sample()) }, 415, 'content type must be application/json'],
      [{ headers: { 'Content-Type': 'text/plain' }, body: 'x'.repeat(20000) }, 415, 'content type must be application/json'],
      [{ body: JSON.stringify({ ...sample(), pad: 'x'.repeat(10000) }) }, 413, 'body too large'],
      [{ body: '' }, 400, 'body must be a JSON object'],
      [{ body: 'null' }, 400, 'body must be a JSON object'],
      [{ body: '[]' }, 400, 'body must be a JSON object'],
      [{ body: '"x"' }, 400, 'body must be a JSON object'],
      [{ body: '﻿{}' }, 400, 'body must be a JSON object'],
      [{ body: sample({ room: 'aurora' }) }, 400, 'room must be one of Aurora, Borealis, Cosmos'],
      [{ body: sample({ title: '   ' }) }, 400, 'title must be 1 to 80 characters'],
      [{ body: sample({ title: 'x'.repeat(81) }) }, 400, 'title must be 1 to 80 characters'],
      [{ body: sample({ title: 5 }) }, 400, 'title must be 1 to 80 characters'],
      [{ body: sample({ date: '1999-12-31' }) }, 400, 'date must be a valid YYYY-MM-DD date'],
      [{ body: sample({ date: '2100-01-01' }) }, 400, 'date must be a valid YYYY-MM-DD date'],
      [{ body: sample({ date: '2027-02-29' }) }, 400, 'date must be a valid YYYY-MM-DD date'],
      [{ body: sample({ date: ' 2026-11-03' }) }, 400, 'date must be a valid YYYY-MM-DD date'],
      [{ body: sample({ start: '9:00' }) }, 400, 'start must be HH:MM'],
      [{ body: sample({ start: '24:00' }) }, 400, 'start must be HH:MM'],
      [{ body: sample({ end: '10:60' }) }, 400, 'end must be HH:MM'],
      [{ body: sample({ end: '09:00' }) }, 400, 'end must be after start'],
    ];
    for (const [opts, status, message] of cases) {
      const r = await api(s.base, 'POST', '/api/bookings', opts);
      assert.equal(r.status, status, message);
      assert.equal(r.headers.get('content-type'), JSON_TYPE);
      assert.deepEqual(r.json, { error: message });
    }
    const ok = await api(s.base, 'POST', '/api/bookings', {
      headers: { 'Content-Type': ' \tApplication/JSON ; charset=utf-8' },
      body: JSON.stringify(sample({ date: '2028-02-29', title: 'x'.repeat(80) })),
    });
    assert.equal(ok.status, 201);
    const missing = await rawRequest(s.port, 'POST', '/api/bookings', { body: '{}' });
    assert.equal(missing.status, 415);
  });

  test('overlap reports the earliest overlapping booking', async () => {
    const date = '2030-05-05';
    await api(s.base, 'POST', '/api/bookings', { body: sample({ date, start: '10:00', end: '11:00' }) });
    await api(s.base, 'POST', '/api/bookings', { body: sample({ date, start: '08:00', end: '09:00' }) });
    const r = await api(s.base, 'POST', '/api/bookings', { body: sample({ date, start: '08:30', end: '10:30' }) });
    assert.equal(r.status, 409);
    assert.deepEqual(r.json, { error: 'room is already booked from 08:00 to 09:00' });
    const touch = await api(s.base, 'POST', '/api/bookings', { body: sample({ date, start: '09:00', end: '10:00' }) });
    assert.equal(touch.status, 201);
  });

  test('concurrent overlapping bookings: exactly one wins', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        api(s.base, 'POST', '/api/bookings', { body: sample({ date: '2031-01-01', start: '10:00', end: `1${1 + (i % 8)}:00` }) })
      )
    );
    assert.equal(results.filter((r) => r.status === 201).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 19);
  });

  test('routing, 404 and 405', async () => {
    const cases = [
      ['GET', '/api/%62ookings', 404, 'not found'],
      ['GET', '/api/./rooms', 404, 'not found'],
      ['GET', '/API/rooms', 404, 'not found'],
      ['GET', '/api/bookings/', 404, 'not found'],
      ['DELETE', '/api/bookings/1/', 404, 'not found'],
      ['POST', '/nope', 404, 'not found'],
      ['GET', '/api/bookings/abc', 405, 'method not allowed'],
      ['POST', '/api/rooms', 405, 'method not allowed'],
      ['PUT', '/api/bookings', 405, 'method not allowed'],
      ['OPTIONS', '/', 405, 'method not allowed'],
      ['DELETE', '/app.js', 405, 'method not allowed'],
    ];
    for (const [method, target, status, message] of cases) {
      const r = await rawRequest(s.port, method, target);
      assert.equal(r.status, status, `${method} ${target}`);
      assert.deepEqual(JSON.parse(r.body), { error: message });
    }
    const head = await rawRequest(s.port, 'HEAD', '/api/rooms');
    assert.equal(head.status, 405);
    const q = await rawRequest(s.port, 'GET', '/api/rooms?x=1');
    assert.equal(q.status, 200);
  });

  test('serves the page and the script', async () => {
    const page = await fetch(s.base + '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
    const html = await page.text();
    assert.match(html, /<script src="\/app\.js"><\/script>\s*<\/body>/);
    assert.doesNotMatch(html, /https?:\/\/|<option|Aurora|Borealis|Cosmos|\son\w+=/i);
    const js = await fetch(s.base + '/app.js');
    assert.equal(js.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.doesNotMatch(await js.text(), /https?:\/\/|\bimport\b|\bexport\b/);
  });
});

describe('persistence', () => {
  test('bookings and next id survive restarts', async () => {
    const dir = tempDir();
    const env = { DATA_FILE: 'store.json' };
    let s = await startServer(env, dir);
    await api(s.base, 'POST', '/api/bookings', { body: sample() });
    await api(s.base, 'POST', '/api/bookings', { body: sample({ room: 'Cosmos' }) });
    await api(s.base, 'DELETE', '/api/bookings/2');
    await s.stop();
    s = await startServer(env, dir);
    try {
      const list = await api(s.base, 'GET', '/api/bookings');
      assert.deepEqual(list.json.bookings.map((b) => b.id), [1]);
      const r = await api(s.base, 'POST', '/api/bookings', { body: sample({ room: 'Borealis' }) });
      assert.equal(r.json.id, 3);
      assert.equal(s.stdout, `listening on http://127.0.0.1:${s.port}\n`);
    } finally {
      await s.stop();
    }
  });

  test('a failed save replies 500 and changes nothing', async () => {
    const dir = tempDir();
    const sub = path.join(dir, 'missing');
    const s = await startServer({ DATA_FILE: path.join(sub, 'data.json') });
    try {
      const r = await api(s.base, 'POST', '/api/bookings', { body: sample() });
      assert.equal(r.status, 500);
      assert.deepEqual(r.json, { error: 'internal error' });
      assert.equal(fs.existsSync(sub), false);
      assert.deepEqual((await api(s.base, 'GET', '/api/bookings')).json, { bookings: [] });
      fs.mkdirSync(sub);
      const ok = await api(s.base, 'POST', '/api/bookings', { body: sample() });
      assert.equal(ok.status, 201);
      assert.equal(ok.json.id, 1);
      fs.rmSync(sub, { recursive: true });
      const del = await api(s.base, 'DELETE', '/api/bookings/1');
      assert.equal(del.status, 500);
      assert.equal((await api(s.base, 'GET', '/api/bookings')).json.bookings.length, 1);
    } finally {
      await s.stop();
    }
  });
});
