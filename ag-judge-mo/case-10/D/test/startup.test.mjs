// Startup rules: PORT checks, DATA_FILE resolution and strict data-file reading.
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  LISTEN_RE, ROOT, booking, delay, exists, expectError, getBookings, isPortFree, makeTmpDir,
  MSG, occupyPort, postBooking, request, runToExit, spawnServer, withServer, writeStore,
} from './helpers/server.mjs';

const MAX_POLLS = 500;
// Built from code points so no invisible or look-alike characters sit in the source.
const BOM = String.fromCodePoint(0xfeff);
const ARABIC_INDIC_80 = String.fromCodePoint(0x0668, 0x0660);
const FULLWIDTH_80 = String.fromCodePoint(0xff18, 0xff10);
const dataError = (name) => `cannot read data file ${name}\n`;

/** Asserts a clean one-line startup failure; `stderr` (optional) is the exact expected text. */
function assertFailure(r, stderr) {
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /^[^\n]+\n$/);
  assert.ok(!r.stderr.includes('\n    at '), 'stderr has a stack trace');
  if (stderr !== undefined) assert.strictEqual(r.stderr, stderr);
}

/** A free port number (bound and released). */
async function freePort() {
  const blocker = await occupyPort();
  await blocker.close();
  return blocker.port;
}

/** Starts on a fixed PORT (unset when undefined) and returns stdout after listening (max ~5 s). */
async function listenLine(cwd, port, dataFile) {
  const handle = spawnServer({ cwd, env: { PORT: port, DATA_FILE: dataFile } });
  try {
    for (let i = 0; i < MAX_POLLS && !handle.stdout().includes('\n'); i++) {
      if (handle.child.exitCode !== null) break;
      await delay(10);
    }
    return handle.stdout();
  } finally {
    handle.child.kill();
    await handle.exited;
  }
}

let tmp;
const tmpPath = (...parts) => join(tmp, ...parts);
before(async () => {
  tmp = await makeTmpDir();
});
after(() => rm(tmp, { recursive: true, force: true }));

/** Fresh empty sub-directory of tmp for one test. */
let counter = 0;
async function freshDir() {
  const dir = tmpPath(`case${counter++}`);
  await mkdir(dir);
  return dir;
}

describe('PORT=0', () => {
  test('prints exactly one listening line and nothing else', async () => {
    const dir = await freshDir();
    await withServer({ cwd: dir, env: { DATA_FILE: tmpPath('none.json') } }, async (s) => {
      const m = LISTEN_RE.exec(s.stdout());
      assert.ok(m, 'listening line');
      assert.ok(s.port > 0);
      assert.strictEqual(Number(m[1]), s.port);
      assert.strictEqual((await request(s.port, { path: '/api/rooms' })).status, 200);
      assert.strictEqual((await request(s.port, { path: '/nope' })).status, 404);
      assert.strictEqual((await postBooking(s.port, '{bad')).status, 400);
      assert.strictEqual((await request(s.port, { method: 'PUT', path: '/api/rooms' })).status, 405);
      const line = s.stdout();
      assert.strictEqual(line, `listening on http://127.0.0.1:${s.port}\n`);
      assert.strictEqual(s.stderr(), '');
    });
  });
});

describe('default port 3000', () => {
  for (const [label, port] of [['unset', undefined], ['empty', '']]) {
    test(`PORT ${label}`, async (t) => {
      if (!(await isPortFree(3000))) return t.skip('port 3000 busy');
      const dir = await freshDir();
      const out = await listenLine(dir, port, tmpPath('none.json'));
      assert.strictEqual(out, 'listening on http://127.0.0.1:3000\n');
    });
  }
});

describe('PORT digits', () => {
  test('leading zeros are accepted', async () => {
    const p = await freePort();
    const dir = await freshDir();
    const out = await listenLine(dir, `000${p}`, tmpPath('none.json'));
    assert.strictEqual(out, `listening on http://127.0.0.1:${p}\n`);
  });

  test('PORT=0000 listens on an OS-picked port', async () => {
    const dir = await freshDir();
    const out = await listenLine(dir, '0000', tmpPath('none.json'));
    const m = LISTEN_RE.exec(out);
    assert.ok(m, out);
    assert.ok(Number(m[1]) > 0);
  });

  test('PORT=65535', async (t) => {
    if (!(await isPortFree(65535))) return t.skip('port 65535 busy');
    const dir = await freshDir();
    const out = await listenLine(dir, '65535', tmpPath('none.json'));
    assert.strictEqual(out, 'listening on http://127.0.0.1:65535\n');
  });
});

describe('bad PORT is checked before the data file', () => {
  const bad = ['abc', '-1', '65536', '100000', ' 80', '80 ', '1e3', '0x50', '+80', '8 0', '8.0',
    ARABIC_INDIC_80, FULLWIDTH_80, '99999999999999999999', '80\n'];
  for (const value of bad) {
    test(`PORT=${JSON.stringify(value)}`, async () => {
      const dir = await freshDir();
      const r = await runToExit({ cwd: dir, env: { PORT: value, DATA_FILE: dir } });
      assertFailure(r);
      assert.notStrictEqual(r.stderr, dataError(dir));
    });
  }
});

describe('port in use', () => {
  test('busy port fails with one line', async () => {
    const blocker = await occupyPort();
    try {
      const dir = await freshDir();
      const r = await runToExit({ cwd: dir, env: { PORT: String(blocker.port), DATA_FILE: tmpPath('none.json') } });
      assertFailure(r);
    } finally {
      await blocker.close();
    }
  });

  test('data file is read before listening', async () => {
    const blocker = await occupyPort();
    try {
      const dir = await freshDir();
      await mkdir(join(dir, 'dir.json'));
      const r = await runToExit({ cwd: dir, env: { PORT: String(blocker.port), DATA_FILE: 'dir.json' } });
      assertFailure(r, dataError('dir.json'));
    } finally {
      await blocker.close();
    }
  });
});

describe('no listening on data failure', () => {
  test('nobody can connect while the server dies', async () => {
    const port = await freePort();
    const dir = await freshDir();
    await writeFile(join(dir, 'empty.json'), '');
    const handle = spawnServer({ cwd: dir, env: { PORT: String(port), DATA_FILE: 'empty.json' } });
    let done = false;
    let connected = false;
    handle.exited.then(() => (done = true));
    for (let i = 0; i < MAX_POLLS && !done; i++) {
      await new Promise((resolve) => {
        const s = connect(port, '127.0.0.1');
        s.once('connect', () => { connected = true; s.destroy(); resolve(); });
        s.once('error', () => resolve());
      });
      await delay(10);
    }
    if (!done) {
      handle.child.kill('SIGKILL');
      await handle.exited;
      assert.fail(`server still running after ${MAX_POLLS} connect attempts`);
    }
    const { code } = await handle.exited;
    assert.strictEqual(connected, false);
    assert.strictEqual(code, 1);
    assert.strictEqual(handle.stdout(), '');
    assert.strictEqual(handle.stderr(), dataError('empty.json'));
  });
});

describe('DATA_FILE default and relative resolution', () => {
  const seeded = { id: 1, ...booking() };
  const next = booking({ start: '10:00', end: '11:00' });

  /** Seeds `file` (relative to a fresh dir), runs server with env, checks load and save. */
  async function loadAndSave(file, env, savedName) {
    const dir = await freshDir();
    const target = join(dir, file);
    await mkdir(join(target, '..'), { recursive: true });
    await writeStore(target, [seeded], 5);
    await withServer({ cwd: dir, env }, async (s) => {
      assert.deepStrictEqual(await getBookings(s.port), [seeded]);
      const res = await postBooking(s.port, next);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.id, 5);
    });
    const saved = JSON.parse(await readFile(join(dir, savedName ?? file), 'utf8'));
    assert.deepStrictEqual(saved.bookings.map((b) => b.id), [1, 5]);
    assert.strictEqual(saved.nextId, 6);
    return dir;
  }

  for (const [label, env] of [['unset', {}], ['empty', { DATA_FILE: '' }]]) {
    test(`DATA_FILE ${label} uses cwd/bookings.json`, async () => {
      const before = await exists(join(ROOT, 'bookings.json'));
      await loadAndSave('bookings.json', env);
      assert.strictEqual(await exists(join(ROOT, 'bookings.json')), before);
    });
  }

  test('relative sub/data.json is resolved against cwd', async () => {
    const hadSub = await exists(join(ROOT, 'sub'));
    await loadAndSave('sub/data.json', { DATA_FILE: 'sub/data.json' });
    assert.strictEqual(await exists(join(ROOT, 'sub')), hadSub);
  });

  test('absolute path works', async () => {
    const other = await freshDir();
    const abs = join(other, 'abs.json');
    await writeStore(abs, [seeded], 5);
    const cwd = await freshDir();
    await withServer({ cwd, env: { DATA_FILE: abs } }, async (s) => {
      assert.deepStrictEqual(await getBookings(s.port), [seeded]);
    });
  });
});

describe('ENOENT starts empty', () => {
  test('missing file stays absent after GETs', async () => {
    const dir = await freshDir();
    const file = join(dir, 'none.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async (s) => {
      const res = await request(s.port, { path: '/api/bookings' });
      assert.deepStrictEqual(res.json, { bookings: [] });
      await request(s.port, { path: '/api/bookings' });
    });
    assert.strictEqual(await exists(file), false);
  });

  test('missing folder: starts empty, POST gives 500, folder not created', async () => {
    const dir = await freshDir();
    const file = join(dir, 'a', 'b', 'c.json');
    await withServer({ cwd: dir, env: { DATA_FILE: file } }, async (s) => {
      assert.deepStrictEqual((await request(s.port, { path: '/api/bookings' })).json, { bookings: [] });
      const res = await postBooking(s.port, booking());
      expectError(res, 500, MSG.internal);
    });
    assert.strictEqual(await exists(join(dir, 'a')), false);
  });
});

describe('unreadable data file', () => {
  const b = (o = {}) => ({ id: 1, ...booking(), ...o });
  const store = (o = {}) => JSON.stringify({ nextId: 3, bookings: [b()], ...o });
  const cases = {
    empty: '',
    'whitespace only': '  \n',
    'not json': 'not json',
    truncated: '{"nextId":1,',
    null: 'null',
    array: '[]',
    zero: '0',
    string: '"x"',
    'empty object': '{}',
    'only nextId': '{"nextId":1}',
    'only bookings': '{"bookings":[]}',
    'extra top key': '{"nextId":1,"bookings":[],"x":1}',
    'nextId string': store({ nextId: '3' }),
    'nextId 0': store({ nextId: 0 }),
    'nextId 1.5': store({ nextId: 1.5 }),
    'bookings object': store({ bookings: {} }),
    'missing end': store({ bookings: [(({ end, ...r }) => r)(b())] }),
    'extra booking key': store({ bookings: [b({ x: 1 })] }),
    'id string': store({ bookings: [b({ id: '1' })] }),
    'id equals nextId': store({ nextId: 1 }),
    'duplicate ids': store({ nextId: 5, bookings: [b(), b({ start: '11:00', end: '12:00' })] }),
    'invalid date': store({ bookings: [b({ date: '2023-02-29' })] }),
    'lowercase room': store({ bookings: [b({ room: 'aurora' })] }),
    'end equals start': store({ bookings: [b({ end: '09:00' })] }),
    'untrimmed title': store({ bookings: [b({ title: ' x ' })] }),
    overlapping: store({ bookings: [b(), b({ id: 2, start: '09:30', end: '10:30' })] }),
    'UTF-8 BOM': `${BOM}${store()}`,
  };

  /** Runs the server in a fresh dir after setup(dir); DATA_FILE is dataFile (unset when undefined). */
  async function failsWith(setup, dataFile) {
    const dir = await freshDir();
    await setup(dir);
    return runToExit({ cwd: dir, env: { PORT: '0', DATA_FILE: dataFile } });
  }

  test('data.json is a directory', async () => {
    const r = await failsWith((d) => mkdir(join(d, 'data.json')), 'data.json');
    assertFailure(r, dataError('data.json'));
  });

  for (const [label, content] of Object.entries(cases)) {
    test(label, async () => {
      const r = await failsWith((d) => writeFile(join(d, 'data.json'), content), 'data.json');
      assertFailure(r, dataError('data.json'));
    });
  }

  test('ENOTDIR: a path part is a regular file', async () => {
    const r = await failsWith((d) => writeFile(join(d, 'afile'), 'x'), 'afile/b.json');
    assertFailure(r, dataError('afile/b.json'));
  });

  for (const [label, dataFile] of [['unset', undefined], ['empty', '']]) {
    test(`DATA_FILE ${label} with a directory bookings.json`, async () => {
      const r = await failsWith((d) => mkdir(join(d, 'bookings.json')), dataFile);
      assertFailure(r, dataError('bookings.json'));
    });
  }

  test('name is reported as given: ./data/../bad.json', async () => {
    const name = './data/../bad.json';
    const r = await failsWith(async (d) => {
      await mkdir(join(d, 'data'));
      await writeFile(join(d, 'bad.json'), 'x');
    }, name);
    assertFailure(r, dataError(name));
  });

  test('non-ASCII name', async () => {
    // Name kept readable on purpose: "données.json" (non-ASCII e-acute).
    const r = await failsWith((d) => mkdir(join(d, 'données.json')), 'données.json');
    assertFailure(r, dataError('données.json'));
  });

  test('absolute path is reported as given', async () => {
    const dir = await freshDir();
    const abs = join(dir, 'abs.json');
    await mkdir(abs);
    const r = await runToExit({ cwd: dir, env: { PORT: '0', DATA_FILE: abs } });
    assertFailure(r, dataError(abs));
  });
});

describe('hand-written pretty-printed data file', () => {
  test('loads, sorts on GET and continues ids at nextId', async () => {
    const dir = await freshDir();
    const late = { id: 1, ...booking({ start: '13:00', end: '14:00', title: 'Late' }) };
    const early = { id: 2, ...booking({ start: '09:00', end: '10:00', title: 'Early' }) };
    const file = join(dir, 'pretty.json');
    await writeFile(file, JSON.stringify({ nextId: 7, bookings: [late, early] }, null, 2));
    await withServer({ cwd: dir, env: { DATA_FILE: 'pretty.json' } }, async (s) => {
      assert.deepStrictEqual(await getBookings(s.port), [early, late]);
      const res = await postBooking(s.port, booking({ start: '11:00', end: '12:00' }));
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.json.id, 7);
    });
  });
});
