// POST /api/bookings rules 4-10, rule order and the 201 reply shape.
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';
import {
  JSON_TYPE,
  MSG,
  booking,
  expectError,
  getBookings,
  makeTmpDir,
  postBooking,
  startServer,
  uniqueDate,
} from './helpers/server.mjs';

const tmpDirs = [];
const servers = [];

async function freshServer() {
  const dir = await makeTmpDir();
  tmpDirs.push(dir);
  const srv = await startServer({ cwd: dir });
  servers.push(srv);
  return srv;
}

after(async () => {
  await Promise.all(servers.map((s) => s.stop()));
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

/** Builds a body; a key whose value is the MISSING symbol is left out. */
const MISSING = Symbol('missing');
function body(overrides) {
  const full = booking({ date: uniqueDate(), ...overrides });
  return Object.fromEntries(Object.entries(full).filter(([, v]) => v !== MISSING));
}

describe('201 shape', () => {
  test('first booking has id 1 and exactly six keys', async () => {
    const srv = await freshServer();
    const input = booking();
    const res = await postBooking(srv.port, input);
    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.headers['content-type'], JSON_TYPE);
    assert.deepStrictEqual(res.json, { id: 1, ...input });
  });

  test('extra keys are ignored and ids increment', async () => {
    const srv = await freshServer();
    const first = booking();
    const input = booking({ date: '2026-11-04' });
    assert.strictEqual((await postBooking(srv.port, first)).status, 201);
    const res = await postBooking(srv.port, { ...input, id: 99, extra: 'x', nextId: 5 });
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.json, { id: 2, ...input });
  });

  test('extra keys on the first booking are ignored and the id is 1', async () => {
    const srv = await freshServer();
    const input = booking({ date: '2026-11-04' });
    const res = await postBooking(srv.port, { ...input, id: 99, extra: 'x', nextId: 5 });
    assert.strictEqual(res.status, 201);
    assert.deepStrictEqual(res.json, { id: 1, ...input });
  });

  test('GET list holds the same objects', async () => {
    const srv = await freshServer();
    const inputs = [booking(), booking({ date: '2026-11-04' })];
    const created = [];
    for (const input of inputs) {
      const res = await postBooking(srv.port, input);
      assert.strictEqual(res.status, 201);
      created.push(res.json);
    }
    assert.deepStrictEqual(created, [
      { id: 1, ...inputs[0] },
      { id: 2, ...inputs[1] },
    ]);
    assert.deepStrictEqual(await getBookings(srv.port), created);
  });
});

describe('field rules on a shared server', () => {
  let srv;
  before(async () => {
    srv = await freshServer();
  });

  const reject = (name, overrides, message) =>
    test(name, async () => {
      expectError(await postBooking(srv.port, body(overrides)), 400, message);
    });

  describe('rule 4: room', () => {
    const bad = ['aurora', 'AURORA', ' Aurora', 'Aurora ', 'Aurora\u0000', 'Auroras', '', null, 1, ['Aurora'], {}, MISSING, 'Aurora, Borealis'];
    for (const room of bad) {
      reject(`room ${typeof room === 'symbol' ? 'missing' : JSON.stringify(room)}`, { room }, MSG.room);
    }
    for (const room of ['Aurora', 'Borealis', 'Cosmos']) {
      test(`room ${room} -> 201`, async () => {
        const res = await postBooking(srv.port, body({ room }));
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.json.room, room);
      });
    }
  });

  describe('rule 5: title', () => {
    const bad = [
      ['missing', MISSING], ['null', null], ['number', 5], ['true', true], ['array', ['x']], ['object', {}],
      ['empty', ''], ['space', ' '], ['tab newline', '\t\n'],
      ['unicode whitespace', ' \u{3000}\u{FEFF}'],
      ['no-break and em space', '\u{A0}\u{2003}'],
      ['81 a', 'a'.repeat(81)], ['81 a padded', ` ${'a'.repeat(81)} `],
      ['40 emoji + a (81 units)', '😀'.repeat(40) + 'a'], ['41 emoji', '😀'.repeat(41)],
      ['81 e-acute (81 units)', '\u{e9}'.repeat(81)],
      ['41 combining e-acute (82 units)', 'e\u{301}'.repeat(41)],
    ];
    for (const [name, title] of bad) reject(`title ${name}`, { title }, MSG.title);

    const good = [
      ['80 a', 'a'.repeat(80), 'a'.repeat(80)],
      ['padded 80 a', `  ${'a'.repeat(80)}\n`, 'a'.repeat(80)],
      ['40 emoji', '😀'.repeat(40), '😀'.repeat(40)],
      ['80 e-acute', '\u{e9}'.repeat(80), '\u{e9}'.repeat(80)],
      ['40 combining e-acute (80 units)', 'e\u{301}'.repeat(40), 'e\u{301}'.repeat(40)],
      ['trimmed x', ' x ', 'x'],
      ['unicode-trimmed x', '\u{A0}x\u{2003}', 'x'],
      ['markup', '<b>x</b>', '<b>x</b>'],
      ['inner spaces', 'a  b', 'a  b'],
    ];
    for (const [name, title, expected] of good) {
      test(`title ${name} -> 201 as ${JSON.stringify(expected).slice(0, 20)}`, async () => {
        const input = body({ title });
        const res = await postBooking(srv.port, input);
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.json.title, expected);
        const stored = (await getBookings(srv.port)).find((b) => b.id === res.json.id);
        assert.strictEqual(stored.title, expected);
      });
    }
  });

  describe('rule 6: date', () => {
    const good = ['2000-01-01', '2099-12-31', '2024-02-29', '2000-02-29', '2096-02-29',
      '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
      '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31'];
    for (const date of good) {
      test(`date ${date} -> 201`, async () => {
        const res = await postBooking(srv.port, booking({ date }));
        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.json.date, date);
      });
    }
    const bad = ['1999-12-31', '2100-01-01', '2023-02-29', '2026-02-29', '2098-02-29', '2024-02-30',
      '2026-04-31', '2026-06-31', '2026-09-31', '2026-11-31', '2026-01-32', '2026-00-10', '2026-13-01',
      '2026-11-00', '0000-01-01', '2026-11-3', '2026-1-03', '26-11-03', '02026-11-03', '2026/11/03',
      '20261103', '2026-11-03T00:00', ' 2026-11-03', '2026-11-03 ', '2026-11-03\n',
      '\u{662}\u{660}\u{662}\u{666}-\u{661}\u{661}-\u{660}\u{663}',
      '\u{FF12}\u{FF10}\u{FF12}\u{FF16}-\u{FF11}\u{FF11}-\u{FF10}\u{FF13}', '2026\u{2010}11-03', '+2026-11-03', '', null, 20261103,
      MISSING, ['2026-11-03']];
    for (const date of bad) {
      reject(`date ${typeof date === 'symbol' ? 'missing' : JSON.stringify(date)}`.replace(/\n/g, '\\n'),
        { date }, MSG.date);
    }
  });

  describe('rules 7-8: start and end format', () => {
    const bad = ['24:00', '23:60', '25:00', '99:99', '9:00', '09:0', '0900', '09:00:00', ' 09:00',
      '09:00 ', '09.00', '-1:00', '\u{660}\u{669}:\u{660}\u{660}', '\u{FF10}\u{FF19}:\u{FF10}\u{FF10}', '', null, 900, MISSING];
    for (const v of bad) {
      const label = typeof v === 'symbol' ? 'missing' : JSON.stringify(v);
      reject(`start ${label}`, { start: v }, MSG.start);
      reject(`end ${label}`, { start: '00:00', end: v }, MSG.end);
    }
    test('00:00 to 23:59 -> 201', async () => {
      const res = await postBooking(srv.port, body({ start: '00:00', end: '23:59' }));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.start, '00:00');
      assert.strictEqual(res.json.end, '23:59');
    });
    reject('start 23:00 end 24:00', { start: '23:00', end: '24:00' }, MSG.end);
  });

  describe('rule 9: end after start', () => {
    reject('10:00 to 10:00', { start: '10:00', end: '10:00' }, MSG.order);
    reject('00:00 to 00:00', { start: '00:00', end: '00:00' }, MSG.order);
    reject('10:00 to 09:59', { start: '10:00', end: '09:59' }, MSG.order);
    test('09:59 to 10:00 -> 201', async () => {
      const res = await postBooking(srv.port, body({ start: '09:59', end: '10:00' }));
      assert.strictEqual(res.status, 201);
    });
  });

  describe('rule order: earlier rule wins', () => {
    reject('bad room + bad title -> room', { room: 'X', title: '' }, MSG.room);
    reject('bad title + bad date -> title', { title: '', date: 'nope' }, MSG.title);
    reject('bad date + bad start -> date', { date: 'nope', start: 'nope' }, MSG.date);
    reject('bad start + bad end -> start', { start: 'nope', end: 'nope' }, MSG.start);
    test('end < start while overlapping -> 400, not 409', async () => {
      const date = uniqueDate();
      const seed = await postBooking(srv.port, booking({ date }));
      assert.strictEqual(seed.status, 201);
      const res = await postBooking(srv.port, booking({ date, start: '09:30', end: '09:15' }));
      expectError(res, 400, MSG.order);
    });
  });
});

describe('rule 10: overlap', () => {
  let srv;
  before(async () => {
    srv = await freshServer();
  });

  /** Seeds Aurora 09:00-10:00 on a new date, returns that date. */
  async function seeded() {
    const date = uniqueDate();
    const res = await postBooking(srv.port, booking({ date }));
    assert.strictEqual(res.status, 201);
    return date;
  }

  for (const [start, end] of [['10:00', '11:00'], ['08:00', '09:00']]) {
    test(`adjacent ${start}-${end} -> 201`, async () => {
      const date = await seeded();
      const res = await postBooking(srv.port, booking({ date, start, end }));
      assert.strictEqual(res.status, 201);
    });
  }

  const conflicts = [['09:59', '10:30'], ['08:00', '09:01'], ['08:00', '11:00'], ['09:15', '09:45'], ['09:00', '10:00']];
  for (const [start, end] of conflicts) {
    test(`overlapping ${start}-${end} -> 409`, async () => {
      const date = await seeded();
      const res = await postBooking(srv.port, booking({ date, start, end }));
      expectError(res, 409, 'room is already booked from 09:00 to 10:00');
    });
  }

  test('Borealis at the same time -> 201', async () => {
    const date = await seeded();
    const res = await postBooking(srv.port, booking({ date, room: 'Borealis' }));
    assert.strictEqual(res.status, 201);
  });

  test('Aurora on another date at the same time -> 201', async () => {
    await seeded();
    const res = await postBooking(srv.port, booking({ date: uniqueDate() }));
    assert.strictEqual(res.status, 201);
  });

  test('earliest-starting overlap is reported, not the lowest id', async () => {
    const date = uniqueDate();
    for (const [start, end] of [['10:00', '11:00'], ['08:00', '09:00']]) {
      assert.strictEqual((await postBooking(srv.port, booking({ date, start, end }))).status, 201);
    }
    const res = await postBooking(srv.port, booking({ date, start: '08:30', end: '10:30' }));
    expectError(res, 409, 'room is already booked from 08:00 to 09:00');
  });

  test('earliest start wins over insertion order and end time', async () => {
    const date = uniqueDate();
    for (const [start, end] of [['12:00', '13:00'], ['11:00', '12:00'], ['10:00', '11:00']]) {
      assert.strictEqual((await postBooking(srv.port, booking({ date, start, end }))).status, 201);
    }
    const res = await postBooking(srv.port, booking({ date, start: '10:30', end: '12:30' }));
    expectError(res, 409, 'room is already booked from 10:00 to 11:00');
  });
});
