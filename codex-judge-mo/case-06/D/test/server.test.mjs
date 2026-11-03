import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  JSON_TYPE, ROOT, booking, cleanup, del, get, mkTmp, parseRaw, post, rawGet,
  request, runToExit, start, uniqueDate, writeData,
} from './helpers.mjs';

after(cleanup);

const ERR = {
  notFound: 'not found',
  method: 'method not allowed',
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  after: 'end must be after start',
  json: 'body must be a JSON object',
  type: 'content type must be application/json',
  large: 'body too large',
  gone: 'booking not found',
  internal: 'internal error',
};

function expectJson(res, status, body) {
  assert.equal(res.status, status, res.text);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(res.json, body);
}

function expectError(res, status, message) {
  expectJson(res, status, { error: message });
}

function stored(id, overrides = {}) {
  return { id, ...booking(), ...overrides };
}

function dataFile(nextId, bookings) {
  return { nextId, bookings };
}

async function withServer(options, fn) {
  const s = await start(options);
  try {
    return await fn(s);
  } finally {
    await s.stop();
  }
}

function oneLine(text) {
  return /^[^\n]+\n$/.test(text);
}

// ---------------------------------------------------------------- Startup

describe('startup: PORT', () => {
  for (const port of ['abc', '-1', '1.5', ' 80', '65536', '99999999999999999999', '+80', '0x10']) {
    it(`rejects PORT=${JSON.stringify(port)}`, async () => {
      const r = await runToExit({ env: { PORT: port } });
      assert.equal(r.code, 1);
      assert.equal(r.stdout, '');
      assert.ok(oneLine(r.stderr), r.stderr);
    });
  }

  it('checks PORT before reading the data file', async () => {
    const dir = mkTmp();
    const r = await runToExit({ env: { PORT: 'abc', DATA_FILE: dir } });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.ok(oneLine(r.stderr));
    assert.notEqual(r.stderr, `cannot read data file ${dir}\n`);
  });

  it('accepts an empty PORT (then reads the data file)', async () => {
    const cwd = mkTmp();
    fs.mkdirSync(path.join(cwd, 'adir'));
    const r = await runToExit({ env: { PORT: '', DATA_FILE: 'adir' }, cwd });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, 'cannot read data file adir\n');
  });

  it('fails with one stderr line when the port is in use', async () => {
    await withServer({}, async (first) => {
      const r = await runToExit({ env: { PORT: String(first.port) } });
      assert.equal(r.code, 1);
      assert.equal(r.stdout, '');
      assert.ok(oneLine(r.stderr), r.stderr);
    });
  });
});

describe('startup: data file', () => {
  const good = booking();
  const row = (over = {}) => ({ id: 1, ...good, ...over });
  const bad = {
    'empty file': '',
    'not json': 'not json',
    'array': '[]',
    'null': 'null',
    'BOM prefix': '﻿' + JSON.stringify(dataFile(1, [])),
    'missing bookings': '{"nextId":1}',
    'nextId 0': JSON.stringify(dataFile(0, [])),
    'booking missing a key': JSON.stringify(dataFile(2, [(({ title, ...r }) => r)(row())])),
    'booking with extra key': JSON.stringify(dataFile(2, [row({ extra: 1 })])),
    'id >= nextId': JSON.stringify(dataFile(1, [row()])),
    'duplicate ids': JSON.stringify(dataFile(5, [row(), row({ room: 'Cosmos' })])),
    'bad room': JSON.stringify(dataFile(2, [row({ room: 'aurora' })])),
    'invalid date': JSON.stringify(dataFile(2, [row({ date: '2100-01-01' })])),
  };

  for (const [label, content] of Object.entries(bad)) {
    it(`refuses: ${label}`, async () => {
      const dir = mkTmp();
      writeData(path.join(dir, 'data', 'x.json'), content);
      const r = await runToExit({ env: { DATA_FILE: 'data/x.json' }, cwd: dir });
      assert.equal(r.code, 1);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, 'cannot read data file data/x.json\n');
    });
  }

  it('refuses a directory (name as given, absolute)', async () => {
    const dir = mkTmp();
    const r = await runToExit({ env: { DATA_FILE: dir } });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, `cannot read data file ${dir}\n`);
  });

  it('refuses a path whose parent is a regular file (ENOTDIR)', async () => {
    const dir = mkTmp();
    fs.writeFileSync(path.join(dir, 'f'), 'x');
    const r = await runToExit({ env: { DATA_FILE: 'f/x.json' }, cwd: dir });
    assert.equal(r.code, 1);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, 'cannot read data file f/x.json\n');
  });

  it('refuses invalid UTF-8', async () => {
    const dir = mkTmp();
    writeData(path.join(dir, 'x.json'), Buffer.from([0x7b, 0xff, 0x7d]));
    const r = await runToExit({ env: { DATA_FILE: 'x.json' }, cwd: dir });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'cannot read data file x.json\n');
  });

  it('reports bookings.json when DATA_FILE is empty and unreadable', async () => {
    const dir = mkTmp();
    fs.mkdirSync(path.join(dir, 'bookings.json'));
    const r = await runToExit({ env: { DATA_FILE: '' }, cwd: dir });
    assert.equal(r.code, 1);
    assert.equal(r.stderr, 'cannot read data file bookings.json\n');
  });

  it('starts empty and creates nothing for a missing file', async () => {
    const dir = mkTmp();
    const file = path.join(dir, 'b.json');
    await withServer({ env: { DATA_FILE: file } }, async (s) => {
      expectJson(await get(s.port, '/api/bookings'), 200, { bookings: [] });
      assert.equal(fs.existsSync(file), false);
      assert.deepEqual(fs.readdirSync(dir), []);
    });
  });

  it('starts empty and creates nothing for a missing folder', async () => {
    const dir = mkTmp();
    const file = path.join(dir, 'no', 'such', 'b.json');
    await withServer({ env: { DATA_FILE: file } }, async (s) => {
      expectJson(await get(s.port, '/api/bookings'), 200, { bookings: [] });
      assert.equal(fs.existsSync(file), false);
      assert.equal(fs.existsSync(path.join(dir, 'no')), false);
    });
  });

  it('resolves a relative DATA_FILE against the cwd', async () => {
    const cwd = mkTmp();
    await withServer({ env: { DATA_FILE: 'b.json' }, cwd }, async (s) => {
      assert.equal((await post(s.port, booking())).status, 201);
    });
    assert.ok(fs.existsSync(path.join(cwd, 'b.json')));
  });

  for (const [label, value] of [['unset', undefined], ['empty', '']]) {
    it(`uses bookings.json in cwd when DATA_FILE is ${label}`, async () => {
      const cwd = mkTmp();
      await withServer({ env: { DATA_FILE: value }, cwd }, async (s) => {
        assert.equal((await post(s.port, booking())).status, 201);
      });
      assert.ok(fs.existsSync(path.join(cwd, 'bookings.json')));
    });
  }

  it('loads a valid data file', async () => {
    const dir = mkTmp();
    const file = path.join(dir, 'b.json');
    writeData(file, dataFile(5, [stored(3)]));
    await withServer({ env: { DATA_FILE: file } }, async (s) => {
      expectJson(await get(s.port, '/api/bookings'), 200, { bookings: [stored(3)] });
      const r = await post(s.port, booking({ date: '2026-11-04' }));
      expectJson(r, 201, stored(5, { date: '2026-11-04' }));
    });
  });
});

describe('startup: stdout and file writes', () => {
  it('stdout is only the listening line after many requests', async () => {
    await withServer({}, async (s) => {
      await get(s.port, '/api/rooms');
      await get(s.port, '/nope');
      await post(s.port, '{', {});
      await post(s.port, booking({ room: 'x' }));
      await post(s.port, booking());
      await post(s.port, booking());
      await del(s.port, '/api/bookings/zzz');
      await del(s.port, '/api/bookings/1');
      await request(s.port, { method: 'PUT', path: '/api/rooms' });
      assert.equal(s.stdout(), `listening on http://127.0.0.1:${s.port}\n`);
    });
  });

  it('a GET-only workload never writes the file', async () => {
    const dir = mkTmp();
    const file = path.join(dir, 'b.json');
    writeData(file, dataFile(2, [stored(1)]));
    const past = new Date(Date.now() - 3600_000);
    fs.utimesSync(file, past, past);
    const before = { text: fs.readFileSync(file, 'utf8'), mtime: fs.statSync(file).mtimeMs };
    await withServer({ env: { DATA_FILE: file } }, async (s) => {
      await get(s.port, '/api/bookings');
      await get(s.port, '/api/bookings?date=2026-11-03');
      await get(s.port, '/api/bookings?date=bad');
      await get(s.port, '/api/rooms');
      await get(s.port, '/nope');
      await request(s.port, { method: 'PUT', path: '/api/rooms' });
      await del(s.port, '/api/bookings/99');
      await post(s.port, '{}');
      await post(s.port, booking({ start: '10:00', end: '10:00' }));
      await post(s.port, booking());
    });
    assert.equal(fs.readFileSync(file, 'utf8'), before.text);
    assert.equal(fs.statSync(file).mtimeMs, before.mtime);
    assert.deepEqual(fs.readdirSync(dir), ['b.json']);
  });
});

// ---------------------------------------------------------------- Routing

describe('routing', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.stop());

  it('GET /api/rooms', async () => {
    expectJson(await get(s.port, '/api/rooms'), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });

  it('ignores the query on /api/rooms', async () => {
    expectJson(await get(s.port, '/api/rooms?x=1'), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });

  const notPaths = [
    '/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/',
    '/api/rooms/', '//api/rooms', '/nope',
  ];
  for (const p of notPaths) {
    for (const method of ['GET', 'POST']) {
      it(`${method} ${p} is 404`, async () => {
        const res = await request(s.port, {
          method, path: p, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined,
        });
        expectError(res, 404, ERR.notFound);
      });
    }
  }

  it('raw GET /api/./rooms is 404 and not normalised', async () => {
    const raw = parseRaw(await rawGet(s.port, '/api/./rooms'));
    assert.equal(raw.status, 404);
    assert.match(raw.head.toLowerCase(), /content-type: application\/json; charset=utf-8/);
    assert.deepEqual(JSON.parse(raw.body), { error: ERR.notFound });
  });

  const wrongMethods = [
    ['PUT', '/api/rooms'], ['DELETE', '/api/rooms'], ['OPTIONS', '/api/rooms'],
    ['PUT', '/api/bookings'], ['GET', '/api/bookings/abc'], ['POST', '/api/bookings/1'],
    ['POST', '/'], ['POST', '/app.js'], ['PUT', '/'], ['DELETE', '/app.js'],
  ];
  for (const [method, p] of wrongMethods) {
    it(`${method} ${p} is 405`, async () => {
      expectError(await request(s.port, { method, path: p }), 405, ERR.method);
    });
  }

  for (const p of ['/api/rooms', '/', '/app.js', '/api/bookings']) {
    it(`HEAD ${p} is 405`, async () => {
      assert.equal((await request(s.port, { method: 'HEAD', path: p })).status, 405);
    });
  }

  it('DELETE /api/bookings/%31 matches the route but the id is invalid', async () => {
    expectError(await del(s.port, '/api/bookings/%31'), 404, ERR.gone);
  });
});

// ---------------------------------------------------------------- Create

describe('POST /api/bookings: create', () => {
  it('returns the new booking with only the six keys; ids count up', async () => {
    await withServer({}, async (s) => {
      const first = await post(s.port, booking({ title: '  Standup  ', extra: 'x', id: 99 }));
      expectJson(first, 201, stored(1));
      assert.deepEqual(Object.keys(first.json).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
      expectJson(await post(s.port, booking({ start: '11:00', end: '12:00' })), 201,
        stored(2, { start: '11:00', end: '12:00' }));
      const list = await get(s.port, '/api/bookings');
      assert.deepEqual(list.json.bookings.map((b) => Object.keys(b).sort()),
        [['date', 'end', 'id', 'room', 'start', 'title'], ['date', 'end', 'id', 'room', 'start', 'title']]);
    });
  });
});

describe('POST /api/bookings: rules', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.stop());

  const send = (over) => post(s.port, booking({ date: uniqueDate(), ...over }));
  const rejects = (label, over, message) => it(label, async () => {
    expectError(await send(over), 400, message);
  });
  const accepts = (label, over) => it(label, async () => {
    const res = await send(over);
    assert.equal(res.status, 201, res.text);
    assert.equal(res.headers['content-type'], JSON_TYPE);
  });

  describe('content type (415)', () => {
    for (const ct of [undefined, 'text/plain', 'application/json5', 'application/jsonx', '']) {
      it(`rejects ${JSON.stringify(ct)}`, async () => {
        const headers = ct === undefined ? {} : { 'content-type': ct };
        const res = await request(s.port, {
          method: 'POST', path: '/api/bookings', headers, body: JSON.stringify(booking({ date: uniqueDate() })),
        });
        expectError(res, 415, ERR.type);
      });
    }
    for (const ct of [' APPLICATION/JSON ; charset=utf-8', 'application/json;x', '\tapplication/json\t', 'Application/Json']) {
      it(`accepts ${JSON.stringify(ct)}`, async () => {
        const res = await post(s.port, booking({ date: uniqueDate() }), { 'content-type': ct });
        assert.equal(res.status, 201, res.text);
      });
    }
    it('415 takes precedence over 413', async () => {
      const res = await post(s.port, 'x'.repeat(20000), { 'content-type': 'text/plain' });
      expectError(res, 415, ERR.type);
    });
  });

  describe('body size (413) and shape (400)', () => {
    const padded = (size) => {
      const text = JSON.stringify(booking({ date: uniqueDate() }));
      return text + ' '.repeat(size - Buffer.byteLength(text));
    };
    it('413 for 10001 bytes', async () => {
      expectError(await post(s.port, padded(10001)), 413, ERR.large);
    });
    it('accepts exactly 10000 bytes', async () => {
      const res = await post(s.port, padded(10000));
      assert.equal(res.status, 201, res.text);
    });
    it('413 takes precedence over 400', async () => {
      expectError(await post(s.port, '{'.repeat(10001)), 413, ERR.large);
    });
    for (const body of ['', 'null', '[]', '"s"', '1', 'true', '{']) {
      it(`400 for body ${JSON.stringify(body)}`, async () => {
        expectError(await post(s.port, body), 400, ERR.json);
      });
    }
    it('400 for a BOM before a valid object', async () => {
      const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(booking()))]);
      expectError(await post(s.port, body), 400, ERR.json);
    });
    it('invalid UTF-8 inside a string becomes U+FFFD', async () => {
      const text = JSON.stringify(booking({ date: uniqueDate(), title: 'a#b' }));
      const body = Buffer.concat([...text.split('#').flatMap((p, i) => (i ? [Buffer.from([0xff]), Buffer.from(p)] : [Buffer.from(p)]))]);
      const res = await post(s.port, body);
      assert.equal(res.status, 201, res.text);
      assert.equal(res.json.title, 'a�b');
    });
  });

  describe('room', () => {
    for (const room of ['aurora', 'Aurora ', 1, null, 'Zed', ['Aurora']]) {
      rejects(`rejects ${JSON.stringify(room)}`, { room }, ERR.room);
    }
    it('rejects a missing room', async () => {
      const { room, ...rest } = booking({ date: uniqueDate() });
      expectError(await post(s.port, rest), 400, ERR.room);
    });
  });

  describe('title', () => {
    for (const title of ['', '   ', 'x'.repeat(81), 1, null, ' \n\t']) {
      rejects(`rejects ${JSON.stringify(title)}`, { title }, ERR.title);
    }
    rejects('rejects 41 emoji (82 UTF-16 units)', { title: '😀'.repeat(41) }, ERR.title);
    it('rejects a missing title', async () => {
      const { title, ...rest } = booking({ date: uniqueDate() });
      expectError(await post(s.port, rest), 400, ERR.title);
    });
    it('keeps the trimmed 80-char title', async () => {
      const res = await send({ title: ` \t${'a'.repeat(80)}\n ` });
      assert.equal(res.status, 201, res.text);
      assert.equal(res.json.title, 'a'.repeat(80));
    });
    it('accepts 40 emoji (80 UTF-16 units)', async () => {
      const res = await send({ title: '😀'.repeat(40) });
      assert.equal(res.status, 201, res.text);
      assert.equal(res.json.title, '😀'.repeat(40));
    });
  });

  describe('date', () => {
    const badDates = ['2026-11-3', ' 2026-11-03', '1999-12-31', '2100-01-01', '2026-02-29', '2100-02-29',
      '2026-13-01', '2026-00-10', '2026-04-31', '２０２６-11-03', '2026-11-03 ', '2026/11/03', '', 20261103, null];
    for (const date of badDates) rejects(`rejects ${JSON.stringify(date)}`, { date }, ERR.date);
    it('rejects a missing date', async () => {
      const { date, ...rest } = booking();
      expectError(await post(s.port, rest), 400, ERR.date);
    });
    for (const date of ['2000-02-29', '2000-01-01', '2099-12-31', '2096-02-29']) {
      it(`accepts ${date}`, async () => {
        const res = await post(s.port, booking({ date }));
        assert.equal(res.status, 201, res.text);
        assert.equal(res.json.date, date);
      });
    }
  });

  describe('start, end', () => {
    for (const time of ['9:00', '24:00', '23:60', '09:00 ', '٠٩:٠٠', '0900', '', 900, null]) {
      rejects(`start rejects ${JSON.stringify(time)}`, { start: time }, ERR.start);
      rejects(`end rejects ${JSON.stringify(time)}`, { end: time }, ERR.end);
    }
    it('rejects a missing start and a missing end', async () => {
      const { start: _s, ...noStart } = booking({ date: uniqueDate() });
      expectError(await post(s.port, noStart), 400, ERR.start);
      const { end: _e, ...noEnd } = booking({ date: uniqueDate() });
      expectError(await post(s.port, noEnd), 400, ERR.end);
    });
    rejects('end equal to start', { start: '09:00', end: '09:00' }, ERR.after);
    rejects('end before start', { start: '09:00', end: '08:59' }, ERR.after);
    accepts('accepts 00:00-23:59', { start: '00:00', end: '23:59' });
  });

  describe('rule order', () => {
    rejects('room before title', { room: 'x', title: '' }, ERR.room);
    rejects('title before date', { title: '', date: 'bad' }, ERR.title);
    it('date before start', async () => {
      expectError(await post(s.port, booking({ date: 'bad', start: 'bad' })), 400, ERR.date);
    });
    rejects('start before end', { start: 'bad', end: 'bad' }, ERR.start);
    rejects('end format before ordering', { start: '10:00', end: 'bad' }, ERR.end);
    it('validation (400) comes before conflicts (409)', async () => {
      const date = uniqueDate();
      assert.equal((await post(s.port, booking({ date }))).status, 201);
      expectError(await post(s.port, booking({ date, end: '09:00' })), 400, ERR.after);
    });
  });
});

describe('POST /api/bookings: conflicts (409)', () => {
  it('reports the earliest-starting overlap; touching and others are fine', async () => {
    await withServer({}, async (s) => {
      assert.equal((await post(s.port, booking({ start: '09:00', end: '10:00' }))).json.id, 1);
      assert.equal((await post(s.port, booking({ start: '10:30', end: '11:00' }))).json.id, 2);
      const clash = await post(s.port, booking({ start: '09:30', end: '10:45' }));
      expectError(clash, 409, 'room is already booked from 09:00 to 10:00');
      const touching = await post(s.port, booking({ start: '10:00', end: '10:30' }));
      expectJson(touching, 201, stored(3, { start: '10:00', end: '10:30' }));
      expectJson(await post(s.port, booking({ room: 'Cosmos', start: '09:00', end: '10:00' })), 201,
        stored(4, { room: 'Cosmos' }));
      expectJson(await post(s.port, booking({ date: '2026-11-04' })), 201, stored(5, { date: '2026-11-04' }));
    });
  });

  it('reports the earliest start even when listed later; enclosing overlap', async () => {
    await withServer({}, async (s) => {
      await post(s.port, booking({ start: '12:00', end: '13:00' }));
      await post(s.port, booking({ start: '10:00', end: '11:00' }));
      const res = await post(s.port, booking({ start: '09:00', end: '14:00' }));
      expectError(res, 409, 'room is already booked from 10:00 to 11:00');
    });
  });

  it('a 409 does not consume an id', async () => {
    await withServer({}, async (s) => {
      await post(s.port, booking());
      expectError(await post(s.port, booking()), 409, 'room is already booked from 09:00 to 10:00');
      const next = await post(s.port, booking({ start: '11:00', end: '12:00' }));
      assert.equal(next.json.id, 2);
    });
  });
});

// ---------------------------------------------------------------- List

describe('GET /api/bookings', () => {
  let s;
  before(async () => {
    s = await start();
    const rows = [
      ['Cosmos', '2026-11-03', '09:00'], ['Borealis', '2026-11-03', '09:00'], ['Aurora', '2026-11-03', '09:00'],
      ['Aurora', '2026-11-03', '08:00'], ['Aurora', '2026-11-02', '23:00'], ['Cosmos', '2026-11-04', '07:00'],
    ];
    for (const [room, date, start] of rows) {
      const end = `${start.slice(0, 2)}:50`;
      const r = await post(s.port, booking({ room, date, start, end }));
      assert.equal(r.status, 201, r.text);
    }
  });
  after(() => s.stop());

  const keys = (res) => res.json.bookings.map((b) => `${b.date} ${b.start} ${b.room}`);

  it('sorts by date, start, then room order', async () => {
    const res = await get(s.port, '/api/bookings');
    expectJson(res, 200, res.json);
    assert.deepEqual(keys(res), [
      '2026-11-02 23:00 Aurora', '2026-11-03 08:00 Aurora', '2026-11-03 09:00 Aurora',
      '2026-11-03 09:00 Borealis', '2026-11-03 09:00 Cosmos', '2026-11-04 07:00 Cosmos',
    ]);
  });

  const filtered = [
    '?date=2026-11-03', '?date=2026-11-03&date=bad', '?x=1&date=2026-11-03', '?date=2026%2D11%2D03',
  ];
  for (const q of filtered) {
    it(`filters with ${q}`, async () => {
      const res = await get(s.port, `/api/bookings${q}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], JSON_TYPE);
      assert.equal(res.json.bookings.length, 4);
      assert.ok(res.json.bookings.every((b) => b.date === '2026-11-03'));
    });
  }

  it('filter keeps the sort order and can be empty', async () => {
    expectJson(await get(s.port, '/api/bookings?date=2030-01-01'), 200, { bookings: [] });
  });

  for (const q of ['?date', '?date=', '?date=bad&date=2026-11-03', '?date=2026-02-30', '?date=2026-11-3', '?date=%202026-11-03']) {
    it(`400 for ${q}`, async () => {
      expectError(await get(s.port, `/api/bookings${q}`), 400, ERR.date);
    });
  }

  it('ignores other parameters', async () => {
    const res = await get(s.port, '/api/bookings?x=1&y');
    assert.equal(res.json.bookings.length, 6);
  });
});

// ---------------------------------------------------------------- Delete

describe('DELETE /api/bookings/<id>', () => {
  it('deletes (204, empty), then 404 on repeat', async () => {
    await withServer({}, async (s) => {
      await post(s.port, booking());
      const res = await del(s.port, '/api/bookings/1');
      assert.equal(res.status, 204);
      assert.equal(res.text, '');
      expectJson(await get(s.port, '/api/bookings'), 200, { bookings: [] });
      expectError(await del(s.port, '/api/bookings/1'), 404, ERR.gone);
    });
  });

  it('404 for ids that are not canonical positive integers', async () => {
    await withServer({}, async (s) => {
      await post(s.port, booking());
      for (const id of ['01', '0', '-1', '1.0', '+1', 'abc', '1e0', '%31']) {
        expectError(await del(s.port, `/api/bookings/${id}`), 404, ERR.gone);
      }
      // A fullwidth digit cannot be sent: Node's HTTP parser itself rejects non-ASCII targets (400).
      // The percent-encoded form is the closest testable case.
      expectError(await del(s.port, '/api/bookings/%EF%BC%91'), 404, ERR.gone);
      assert.equal((await get(s.port, '/api/bookings')).json.bookings.length, 1);
    });
  });

  it('never reuses ids, across deletes and restarts', async () => {
    const file = path.join(mkTmp(), 'b.json');
    const env = { DATA_FILE: file };
    await withServer({ env }, async (s) => {
      await post(s.port, booking({ start: '08:00', end: '09:00' }));
      await post(s.port, booking({ start: '09:00', end: '10:00' }));
      assert.equal((await del(s.port, '/api/bookings/2')).status, 204);
      const third = await post(s.port, booking({ start: '10:00', end: '11:00' }));
      assert.equal(third.json.id, 3);
    });
    await withServer({ env }, async (s) => {
      const list = await get(s.port, '/api/bookings');
      assert.deepEqual(list.json.bookings.map((b) => b.id), [1, 3]);
      const next = await post(s.port, booking({ start: '12:00', end: '13:00' }));
      assert.equal(next.json.id, 4);
    });
  });

  it('keeps the next id after deleting the highest booking and restarting', async () => {
    const file = path.join(mkTmp(), 'b.json');
    const env = { DATA_FILE: file };
    await withServer({ env }, async (s) => {
      await post(s.port, booking());
      await del(s.port, '/api/bookings/1');
    });
    await withServer({ env }, async (s) => {
      expectJson(await get(s.port, '/api/bookings'), 200, { bookings: [] });
      assert.equal((await post(s.port, booking())).json.id, 2);
    });
  });
});

// ---------------------------------------------------------------- Failures

describe('save failures', () => {
  it('POST: 500, nothing changes, id not consumed, server keeps running', async () => {
    const folder = path.join(mkTmp(), 'sub');
    fs.mkdirSync(folder);
    await withServer({ env: { DATA_FILE: path.join(folder, 'b.json') } }, async (s) => {
      fs.rmSync(folder, { recursive: true });
      expectError(await post(s.port, booking()), 500, ERR.internal);
      expectJson(await get(s.port, '/api/bookings'), 200, { bookings: [] });
      assert.equal(fs.existsSync(folder), false);
      fs.mkdirSync(folder);
      expectJson(await post(s.port, booking()), 201, stored(1));
      assert.equal(s.child.exitCode, null);
    });
  });

  it('DELETE: 500 and the booking stays', async () => {
    const folder = path.join(mkTmp(), 'sub');
    const file = path.join(folder, 'b.json');
    writeData(file, dataFile(2, [stored(1)]));
    await withServer({ env: { DATA_FILE: file } }, async (s) => {
      fs.rmSync(folder, { recursive: true });
      expectError(await del(s.port, '/api/bookings/1'), 500, ERR.internal);
      expectJson(await get(s.port, '/api/bookings'), 200, { bookings: [stored(1)] });
      fs.mkdirSync(folder);
      assert.equal((await del(s.port, '/api/bookings/1')).status, 204);
      assert.equal(s.child.exitCode, null);
    });
  });
});

describe('unexpected failures', () => {
  // A copy of server.mjs with no public/ folder next to it: serving a page throws.
  it('500 internal error for a failing handler; the server keeps running', async () => {
    const script = path.join(mkTmp(), 'server.mjs');
    fs.copyFileSync(path.join(ROOT, 'server.mjs'), script);
    await withServer({ script }, async (s) => {
      expectError(await get(s.port, '/'), 500, ERR.internal);
      expectError(await get(s.port, '/app.js'), 500, ERR.internal);
      expectJson(await get(s.port, '/api/rooms'), 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
      assert.equal(s.child.exitCode, null);
      assert.equal(s.stdout(), `listening on http://127.0.0.1:${s.port}\n`);
    });
  });
});

describe('concurrency', () => {
  it('overlapping POSTs: exactly one 201, the rest 409', async () => {
    await withServer({}, async (s) => {
      const results = await Promise.all(Array.from({ length: 10 }, () => post(s.port, booking())));
      assert.equal(results.filter((r) => r.status === 201).length, 1);
      const conflicts = results.filter((r) => r.status === 409);
      assert.equal(conflicts.length, 9);
      for (const c of conflicts) expectError(c, 409, 'room is already booked from 09:00 to 10:00');
    });
  });

  it('non-overlapping concurrent POSTs all succeed with distinct ids', async () => {
    await withServer({}, async (s) => {
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => {
        const h = String(i + 8).padStart(2, '0');
        return post(s.port, booking({ start: `${h}:00`, end: `${h}:30` }));
      }));
      assert.ok(results.every((r) => r.status === 201));
      assert.deepEqual(results.map((r) => r.json.id).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });
});

describe('request body is drained', () => {
  let s;
  before(async () => { s = await start(); });
  after(() => s.stop());

  it('405 reply for a 1 MB body', async () => {
    const res = await request(s.port, { method: 'POST', path: '/api/rooms', body: 'x'.repeat(1 << 20) });
    expectError(res, 405, ERR.method);
  });

  it('415 reply for a 1 MB text/plain body', async () => {
    expectError(await post(s.port, 'x'.repeat(1 << 20), { 'content-type': 'text/plain' }), 415, ERR.type);
  });

  it('413 reply for a 2 MB JSON body', async () => {
    expectError(await post(s.port, ' '.repeat(2 << 20)), 413, ERR.large);
  });

  it('404 reply for a body on an unknown path', async () => {
    const res = await request(s.port, { method: 'POST', path: '/nope', body: 'x'.repeat(1 << 20) });
    expectError(res, 404, ERR.notFound);
  });

  it('still serves requests afterwards', async () => {
    assert.equal((await get(s.port, '/api/rooms')).status, 200);
  });
});

// ---------------------------------------------------------------- Pages

describe('pages', () => {
  const pages = [
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/?x=1', 'index.html', 'text/html; charset=utf-8'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/app.js?v=2', 'app.js', 'text/javascript; charset=utf-8'],
  ];
  let s;
  before(async () => { s = await start(); });
  after(() => s.stop());

  for (const [target, file, type] of pages) {
    it(`GET ${target}`, async (t) => {
      const full = path.join(ROOT, 'public', file);
      if (!fs.existsSync(full)) {
        t.skip('page file not written yet');
        return;
      }
      const res = await get(s.port, target);
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], type);
      assert.equal(res.text, fs.readFileSync(full, 'utf8'));
    });
  }
});
