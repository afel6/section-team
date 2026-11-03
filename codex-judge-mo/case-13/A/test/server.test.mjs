import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bookings-test-'));
}

// Starts the server; resolves to { port, proc, stderr } once listening.
function start(env, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [SERVER], {
      cwd: cwd ?? tmpDir(),
      env: { ...process.env, PORT: '0', ...env },
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => {
      out += d;
      const m = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/.exec(out);
      if (m) resolve({ port: Number(m[1]), proc, out: () => out });
    });
    proc.stderr.on('data', (d) => (err += d));
    proc.on('exit', (code) => reject(Object.assign(new Error('exited'), { code, stderr: err, stdout: out })));
  });
}

// Runs a server expected to fail at startup.
function run(env, cwd) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [SERVER], { cwd: cwd ?? tmpDir(), env: { ...process.env, ...env } });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('exit', (code) => resolve({ code, stdout: out, stderr: err }));
  });
}

function stop(proc) {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill();
  });
}

function req(port, method, target, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = text === '' ? undefined : JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    r.on('error', reject);
    if (body !== undefined) r.write(body);
    r.end();
  });
}

const JSON_TYPE = { 'Content-Type': 'application/json' };

function post(port, obj) {
  return req(port, 'POST', '/api/bookings', { body: JSON.stringify(obj), headers: JSON_TYPE });
}

const sample = { room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' };

describe('startup', () => {
  test('invalid PORT exits 1', async () => {
    for (const port of ['abc', '-1', '65536', ' 80', '1e3', '+80']) {
      const r = await run({ PORT: port });
      assert.equal(r.code, 1, port);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.length > 0);
    }
  });

  test('port in use exits 1', async () => {
    const a = await start({});
    const r = await run({ PORT: String(a.port) });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    await stop(a.proc);
  });

  test('unreadable or invalid data file', async () => {
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, 'adir'));
    fs.writeFileSync(path.join(dir, 'empty.json'), '');
    fs.writeFileSync(path.join(dir, 'bad.json'), '{nope');
    fs.writeFileSync(path.join(dir, 'arr.json'), '[]');
    for (const name of ['adir', 'empty.json', 'bad.json', 'arr.json']) {
      const r = await run({ PORT: '0', DATA_FILE: name }, dir);
      assert.equal(r.code, 1);
      assert.equal(r.stderr, `cannot read data file ${name}\n`);
      assert.equal(r.stdout, '');
    }
    fs.mkdirSync(path.join(dir, 'bookings.json'));
    const r = await run({ PORT: '0', DATA_FILE: '' }, dir);
    assert.equal(r.stderr, 'cannot read data file bookings.json\n');
  });

  test('PORT is checked before the data file', async () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'bad.json'), 'x');
    const r = await run({ PORT: 'x', DATA_FILE: 'bad.json' }, dir);
    assert.equal(r.code, 1);
    assert.notEqual(r.stderr, 'cannot read data file bad.json\n');
  });

  test('missing file means no bookings and nothing is written', async () => {
    const dir = tmpDir();
    const s = await start({ DATA_FILE: 'sub/none.json' }, dir);
    const r = await req(s.port, 'GET', '/api/bookings');
    assert.deepEqual(r.json, { bookings: [] });
    assert.equal(fs.existsSync(path.join(dir, 'sub')), false);
    await stop(s.proc);
  });
});

describe('api', () => {
  let s;
  let dir;
  before(async () => {
    dir = tmpDir();
    s = await start({}, dir);
  });
  after(() => stop(s.proc));

  test('rooms', async () => {
    const r = await req(s.port, 'GET', '/api/rooms');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(r.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });

  test('routing', async () => {
    for (const p of ['/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/', '/nope']) {
      const r = await req(s.port, 'GET', p);
      assert.equal(r.status, 404, p);
      assert.deepEqual(r.json, { error: 'not found' });
    }
    for (const [m, p] of [['GET', '/api/bookings/abc'], ['HEAD', '/api/rooms'], ['OPTIONS', '/api/bookings'], ['POST', '/'], ['PUT', '/api/bookings']]) {
      const r = await req(s.port, m, p);
      assert.equal(r.status, 405, `${m} ${p}`);
      if (m !== 'HEAD') assert.deepEqual(r.json, { error: 'method not allowed' });
    }
    assert.equal((await req(s.port, 'GET', '/api/rooms?x=1')).status, 200);
  });

  test('page and script', async () => {
    const page = await req(s.port, 'GET', '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(page.text, /<script src="\/app\.js"><\/script>\s*<\/body>/);
    assert.doesNotMatch(page.text, /<option|Aurora|Borealis|Cosmos|https?:\/\//);
    const js = await req(s.port, 'GET', '/app.js');
    assert.equal(js.status, 200);
    assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
    assert.doesNotMatch(js.text, /https?:\/\//);
  });

  test('booking rules', async () => {
    const cases = [
      [{ headers: {} , body: '{}' }, 415, 'content type must be application/json'],
      [{ headers: { 'Content-Type': 'text/plain' }, body: '{}' }, 415, 'content type must be application/json'],
      [{ headers: JSON_TYPE, body: 'x'.repeat(10001) }, 413, 'body too large'],
      [{ headers: JSON_TYPE, body: '' }, 400, 'body must be a JSON object'],
      [{ headers: JSON_TYPE, body: '[]' }, 400, 'body must be a JSON object'],
      [{ headers: JSON_TYPE, body: 'null' }, 400, 'body must be a JSON object'],
      [{ headers: JSON_TYPE, body: '﻿{}' }, 400, 'body must be a JSON object'],
    ];
    for (const [opts, status, error] of cases) {
      const r = await req(s.port, 'POST', '/api/bookings', opts);
      assert.equal(r.status, status, error);
      assert.deepEqual(r.json, { error });
    }
    const ok = await req(s.port, 'POST', '/api/bookings', {
      headers: { 'Content-Type': ' \tAPPLICATION/Json ; charset=utf-8' },
      body: JSON.stringify({ ...sample, date: '2030-01-01' }),
    });
    assert.equal(ok.status, 201);

    const fieldCases = [
      [{ room: 'aurora' }, 'room must be one of Aurora, Borealis, Cosmos'],
      [{ title: '   ' }, 'title must be 1 to 80 characters'],
      [{ title: 'x'.repeat(81) }, 'title must be 1 to 80 characters'],
      [{ date: '2026-11-3' }, 'date must be a valid YYYY-MM-DD date'],
      [{ date: ' 2026-11-03' }, 'date must be a valid YYYY-MM-DD date'],
      [{ date: '2100-01-01' }, 'date must be a valid YYYY-MM-DD date'],
      [{ date: '2027-02-29' }, 'date must be a valid YYYY-MM-DD date'],
      [{ start: '9:00' }, 'start must be HH:MM'],
      [{ start: '24:00' }, 'start must be HH:MM'],
      [{ end: '10:60' }, 'end must be HH:MM'],
      [{ end: '09:00' }, 'end must be after start'],
    ];
    for (const [patch, error] of fieldCases) {
      const r = await post(s.port, { ...sample, ...patch });
      assert.equal(r.status, 400, error);
      assert.deepEqual(r.json, { error });
    }
    const leap = await post(s.port, { ...sample, date: '2028-02-29', title: '  Leap  ', extra: 1 });
    assert.equal(leap.status, 201);
    assert.equal(leap.json.title, 'Leap');
    assert.deepEqual(Object.keys(leap.json).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
  });

  test('create, overlap, list, delete', async () => {
    const day = '2031-05-05';
    const a = await post(s.port, { ...sample, date: day, start: '10:00', end: '11:00' });
    const b = await post(s.port, { ...sample, date: day, start: '09:00', end: '10:00' });
    const c = await post(s.port, { ...sample, date: day, room: 'Borealis', start: '09:00', end: '12:00' });
    assert.deepEqual([a.status, b.status, c.status], [201, 201, 201]);
    const clash = await post(s.port, { ...sample, date: day, start: '09:30', end: '10:30' });
    assert.equal(clash.status, 409);
    assert.deepEqual(clash.json, { error: 'room is already booked from 09:00 to 10:00' });

    const list = await req(s.port, 'GET', `/api/bookings?date=${day}`);
    assert.deepEqual(list.json.bookings.map((x) => x.id), [b.json.id, c.json.id, a.json.id]);
    assert.equal((await req(s.port, 'GET', '/api/bookings?date')).status, 400);
    assert.equal((await req(s.port, 'GET', '/api/bookings?date=2031-5-5')).status, 400);

    const del = await req(s.port, 'DELETE', `/api/bookings/${a.json.id}`);
    assert.equal(del.status, 204);
    assert.equal(del.text, '');
    for (const id of [String(a.json.id), '0', '01', 'abc', '%31']) {
      const r = await req(s.port, 'DELETE', `/api/bookings/${id}`);
      assert.equal(r.status, 404, id);
      assert.deepEqual(r.json, { error: 'booking not found' });
    }
    const next = await post(s.port, { ...sample, date: '2032-01-01' });
    assert.equal(next.json.id, c.json.id + 1);
  });

  test('large bodies are read and answered', async () => {
    const big = 'a'.repeat(2_000_000);
    const tooLarge = await req(s.port, 'POST', '/api/bookings', { body: big, headers: JSON_TYPE });
    assert.equal(tooLarge.status, 413);
    const wrongType = await req(s.port, 'POST', '/api/bookings', {
      body: big,
      headers: { 'Content-Type': 'text/plain', 'Transfer-Encoding': 'chunked' },
    });
    assert.equal(wrongType.status, 415);
  });

  test('relative default data file is in the working directory', async () => {
    const r = await post(s.port, { ...sample, date: '2050-01-01' });
    assert.equal(r.status, 201);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'bookings.json'), 'utf8'));
    assert.ok(saved.bookings.some((b) => b.id === r.json.id));
  });

  test('concurrent overlapping bookings', async () => {
    const replies = await Promise.all(
      Array.from({ length: 10 }, () => post(s.port, { ...sample, date: '2040-01-01' })),
    );
    assert.equal(replies.filter((r) => r.status === 201).length, 1);
    assert.equal(replies.filter((r) => r.status === 409).length, 9);
  });
});

describe('persistence', () => {
  test('bookings and next id survive a restart', async () => {
    const dir = tmpDir();
    let s = await start({ DATA_FILE: 'data.json' }, dir);
    await post(s.port, sample);
    const two = await post(s.port, { ...sample, start: '10:00', end: '11:00' });
    await req(s.port, 'DELETE', `/api/bookings/${two.json.id}`);
    await stop(s.proc);
    s = await start({ DATA_FILE: 'data.json' }, dir);
    const list = await req(s.port, 'GET', '/api/bookings');
    assert.equal(list.json.bookings.length, 1);
    const three = await post(s.port, { ...sample, start: '12:00', end: '13:00' });
    assert.equal(three.json.id, 3);
    await stop(s.proc);
  });

  test('save failure is 500 and changes nothing', async () => {
    const dir = tmpDir();
    const s = await start({ DATA_FILE: path.join(dir, 'missing', 'data.json') }, dir);
    const r = await post(s.port, sample);
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: 'internal error' });
    assert.deepEqual((await req(s.port, 'GET', '/api/bookings')).json, { bookings: [] });
    fs.mkdirSync(path.join(dir, 'missing'));
    const ok = await post(s.port, sample);
    assert.equal(ok.status, 201);
    assert.equal(ok.json.id, 1);
    await stop(s.proc);
  });
});
