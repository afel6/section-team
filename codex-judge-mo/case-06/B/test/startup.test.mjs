import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {
  withTemp, runToExit, startServer, request, postBooking, VALID_BOOKING,
} from './helpers/server.mjs';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE_BOOKING = {
  id: 2, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00',
};
const FIXTURE = '{"nextId":3,"bookings":[{"id":2,"room":"Aurora","title":"Standup","date":"2026-11-03","start":"09:00","end":"10:00"}]}';

async function withServer(opts, fn) {
  const server = await startServer(opts);
  try {
    return await fn(server);
  } finally {
    await server.stop();
  }
}

function listen(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve(srv));
  });
}

const closeServer = (srv) => new Promise((resolve) => srv.close(resolve));

async function withHeldPort(fn) {
  const holder = await listen(0);
  try {
    return await fn(holder.address().port);
  } finally {
    await closeServer(holder);
  }
}

function assertOneLineError(result) {
  assert.equal(result.code, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^[^\n]+\n$/);
  assert.equal(result.stderr.includes('\n    at '), false);
  assert.equal(result.stderr.includes('Error:'), false);
}

async function exists(file) {
  try {
    await fs.stat(file);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

describe('invalid PORT', () => {
  const values = ['abc', '65536', '+1', '-1', ' 80', '80 ', '1e3', '0x10', '8080a', '99999999999999999999', '٣'];
  for (const value of values) {
    test(`PORT=${JSON.stringify(value)} exits 1 with one stderr line`, async () => {
      await withTemp(async (dir) => {
        assertOneLineError(await runToExit({ env: { PORT: value }, cwd: dir }));
      });
    });
  }

  test('PORT is checked before the data file', async () => {
    await withTemp(async (dir) => {
      const result = await runToExit({ env: { PORT: 'abc', DATA_FILE: dir }, cwd: dir });
      assertOneLineError(result);
      assert.notEqual(result.stderr, `cannot read data file ${dir}\n`);
      assert.equal(result.stderr.startsWith('cannot read data file'), false);
    });
  });
});

describe('listening', () => {
  test('PORT=0 prints the bound port and serves', async () => {
    await withTemp(async (dir) => {
      const server = await startServer({ env: { PORT: '0' }, cwd: dir });
      try {
        assert.equal(server.output.stdout, `listening on http://127.0.0.1:${server.port}\n`);
        assert.ok(server.port > 0);
        assert.equal((await request(server.port, { path: '/api/rooms' })).status, 200);
      } finally {
        await server.stop();
      }
      assert.equal(server.output.stdout, `listening on http://127.0.0.1:${server.port}\n`);
      assert.equal(server.output.stderr, '');
    });
  });

  test('PORT with leading zeros is accepted', async () => {
    await withTemp(async (dir) => {
      const probe = await listen(0);
      const port = probe.address().port;
      await closeServer(probe);
      await withServer({ env: { PORT: `0${port}` }, cwd: dir }, async (server) => {
        assert.equal(server.port, port);
        assert.equal(server.output.stdout, `listening on http://127.0.0.1:${port}\n`);
      });
    });
  });

  test('PORT=65535 is not rejected as invalid', async (t) => {
    let probe;
    try {
      probe = await listen(65535);
    } catch (err) {
      if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
      t.skip('port 65535 busy');
      return;
    }
    await closeServer(probe);
    await withTemp(async (dir) => {
      await withServer({ env: { PORT: '65535' }, cwd: dir }, async (server) => {
        assert.equal(server.output.stdout, 'listening on http://127.0.0.1:65535\n');
      });
    });
  });

  test('port in use exits 1 with one stderr line', async () => {
    await withTemp(async (dir) => {
      await withHeldPort(async (port) => {
        assertOneLineError(await runToExit({ env: { PORT: String(port) }, cwd: dir }));
      });
    });
  });

  test('default port is 3000 for unset and empty PORT', async (t) => {
    await withTemp(async (dir) => {
      let holder = null;
      try {
        holder = await listen(3000);
      } catch (err) {
        if (err.code !== 'EADDRINUSE') throw err;
      }
      try {
        assertOneLineError(await runToExit({ env: { PORT: undefined }, cwd: dir }));
        assertOneLineError(await runToExit({ env: { PORT: '' }, cwd: dir }));
      } finally {
        if (holder) await closeServer(holder);
      }
      if (!holder) {
        t.skip('port 3000 busy: success path not checked');
        return;
      }
      for (const port of [undefined, '']) {
        await withServer({ env: { PORT: port }, cwd: dir }, async (server) => {
          assert.equal(server.port, 3000);
          assert.equal(server.output.stdout, 'listening on http://127.0.0.1:3000\n');
        });
      }
    });
  });
});

describe('data file at startup', () => {
  test('data file is read before binding', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'bad.json');
      await fs.writeFile(file, '{');
      await withHeldPort(async (port) => {
        const result = await runToExit({ env: { PORT: String(port), DATA_FILE: file }, cwd: dir });
        assert.equal(result.code, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `cannot read data file ${file}\n`);
      });
    });
  });

  const locations = [
    ['unset DATA_FILE uses bookings.json in cwd', undefined, 'bookings.json'],
    ['empty DATA_FILE uses bookings.json in cwd', '', 'bookings.json'],
    ['relative DATA_FILE resolves against cwd', 'sub/x.json', 'sub/x.json'],
  ];
  for (const [label, dataFile, rel] of locations) {
    test(label, async () => {
      await withTemp(async (dir) => {
        await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
        await fs.writeFile(path.join(dir, rel), FIXTURE);
        await withServer({ env: { DATA_FILE: dataFile }, cwd: dir }, async (server) => {
          const res = await request(server.port, { path: '/api/bookings' });
          assert.deepEqual(res.json(), { bookings: [FIXTURE_BOOKING] });
        });
      });
    });
  }

  test('default file is created in cwd, not in the project root', async () => {
    const rootFile = path.join(PROJECT_ROOT, 'bookings.json');
    const rootExisted = await exists(rootFile);
    await withTemp(async (dir) => {
      await withServer({ env: { DATA_FILE: undefined }, cwd: dir }, async (server) => {
        const res = await postBooking(server.port, { ...VALID_BOOKING, start: '13:00', end: '14:00' });
        assert.equal(res.status, 201);
      });
      assert.equal(await exists(path.join(dir, 'bookings.json')), true);
    });
    if (!rootExisted) assert.equal(await exists(rootFile), false);
  });

  test('missing file starts with no bookings', async () => {
    await withTemp(async (dir) => {
      await withServer({ env: { DATA_FILE: path.join(dir, 'none.json') }, cwd: dir }, async (server) => {
        const res = await request(server.port, { path: '/api/bookings' });
        assert.deepEqual(res.json(), { bookings: [] });
      });
    });
  });

  test('missing folder starts with no bookings and is not created', async () => {
    await withTemp(async (dir) => {
      await withServer({ env: { DATA_FILE: 'nope/deeper/data.json' }, cwd: dir }, async (server) => {
        assert.equal(await exists(path.join(dir, 'nope')), false);
        const res = await request(server.port, { path: '/api/bookings' });
        assert.deepEqual(res.json(), { bookings: [] });
        assert.equal(await exists(path.join(dir, 'nope')), false);
      });
    });
  });

  test('external changes to the file are not noticed', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await fs.writeFile(file, FIXTURE);
      await withServer({ env: { DATA_FILE: file }, cwd: dir }, async (server) => {
        await fs.writeFile(file, '{"nextId":1,"bookings":[]}');
        const res = await request(server.port, { path: '/api/bookings' });
        assert.deepEqual(res.json(), { bookings: [FIXTURE_BOOKING] });
      });
    });
  });
});

const dirCase = (rel, absolute) => async (dir) => {
  await fs.mkdir(path.join(dir, rel));
  const given = absolute ? path.join(dir, rel) : rel;
  return { dataFile: given, name: given };
};
const fileCase = (content, rel = 'data.json') => async (dir) => {
  await fs.writeFile(path.join(dir, rel), content);
  return { dataFile: rel, name: rel };
};
const booking = (patch) => ({ ...FIXTURE_BOOKING, ...patch });
const storeCase = (nextId, bookings) => fileCase(JSON.stringify({ nextId, bookings }));
const store = (b) => JSON.stringify({ nextId: 5, bookings: [b] });
const withoutRoom = (() => { const { room, ...rest } = FIXTURE_BOOKING; return rest; })();

const BAD_DATA = [
  ['absolute directory', dirCase('adirabs', true)],
  ['relative directory', dirCase('adir', false)],
  ['non-ASCII directory name', dirCase('données.json', false)],
  ['default name is a directory (unset)', async (dir) => {
    await fs.mkdir(path.join(dir, 'bookings.json'));
    return { dataFile: undefined, name: 'bookings.json' };
  }],
  ['default name is a directory (empty)', async (dir) => {
    await fs.mkdir(path.join(dir, 'bookings.json'));
    return { dataFile: '', name: 'bookings.json' };
  }],
  ['empty file', fileCase('')],
  ['whitespace-only file', fileCase(' \n\t ')],
  ['open brace', fileCase('{')],
  ['null', fileCase('null')],
  ['empty array', fileCase('[]')],
  ['empty object', fileCase('{}')],
  ['string', fileCase('"x"')],
  ['only nextId', fileCase('{"nextId":1}')],
  ['only bookings', fileCase('{"bookings":[]}')],
  ['bookings is an object', fileCase('{"nextId":1,"bookings":{}}')],
  ['booking missing a key', fileCase(store(withoutRoom))],
  ['booking with an extra key', fileCase(store(booking({ extra: 1 })))],
  ['nextId equal to the largest id', storeCase(2, [FIXTURE_BOOKING])],
  ['nextId below the largest id', storeCase(1, [FIXTURE_BOOKING])],
  ['duplicate ids', storeCase(3, [
    booking({ id: 1 }), booking({ id: 1, start: '11:00', end: '12:00' }),
  ])],
  ['nextId 0', storeCase(0, [])],
  ['nextId 1.5', storeCase(1.5, [])],
  ['nextId as a string', storeCase('3', [FIXTURE_BOOKING])],
  ['id 1.5', storeCase(5, [booking({ id: 1.5 })])],
  ['id as a string', storeCase(5, [booking({ id: '1' })])],
  ['id 0', storeCase(5, [booking({ id: 0 })])],
  ['date 2026-02-30', storeCase(5, [booking({ date: '2026-02-30' })])],
  ['start 24:00', storeCase(5, [booking({ start: '24:00', end: '24:30' })])],
  ['end before start', storeCase(5, [booking({ start: '10:00', end: '09:00' })])],
  ['untrimmed title', storeCase(5, [booking({ title: ' x' })])],
  ['title of 81 characters', storeCase(5, [booking({ title: 'a'.repeat(81) })])],
  ['room aurora (wrong case)', storeCase(5, [booking({ room: 'aurora' })])],
  ['overlapping bookings', storeCase(5, [
    booking({ id: 1, start: '09:00', end: '10:00' }), booking({ id: 2, start: '09:30', end: '10:30' }),
  ])],
  ['UTF-8 BOM before valid JSON', fileCase(`\u{FEFF}${FIXTURE}`)],
  ['ENOTDIR', async (dir) => {
    await fs.writeFile(path.join(dir, 'plain.txt'), 'x');
    return { dataFile: 'plain.txt/data.json', name: 'plain.txt/data.json' };
  }],
];

describe('valid multi-booking data file', () => {
  test('3 bookings with nextId 10 load and are listed sorted', async () => {
    await withTemp(async (dir) => {
      const late = booking({ id: 7, room: 'Cosmos', date: '2026-11-04', start: '08:00', end: '09:00' });
      const afternoon = booking({ id: 3, start: '14:00', end: '15:00' });
      const morning = booking({ id: 9, room: 'Borealis' });
      const file = path.join(dir, 'data.json');
      await fs.writeFile(file, JSON.stringify({ nextId: 10, bookings: [late, afternoon, morning] }));
      await withServer({ env: { DATA_FILE: file }, cwd: dir }, async (server) => {
        const res = await request(server.port, { path: '/api/bookings' });
        assert.deepEqual(res.json(), { bookings: [morning, afternoon, late] });
        const created = await postBooking(server.port, { ...VALID_BOOKING, start: '16:00', end: '17:00' });
        assert.equal(created.status, 201);
        assert.equal(created.json().id, 10);
      });
    });
  });
});

describe('unreadable or invalid data file', () => {
  for (const [label, setup] of BAD_DATA) {
    test(label, async () => {
      await withTemp(async (dir) => {
        const { dataFile, name } = await setup(dir);
        const result = await runToExit({ env: { PORT: '0', DATA_FILE: dataFile }, cwd: dir });
        assert.equal(result.code, 1);
        assert.equal(result.stdout, '');
        assert.equal(result.stderr, `cannot read data file ${name}\n`);
      });
    });
  }
});

const JSON_HEADERS = { 'Content-Type': 'application/json' };
/** Requests that must never write the data file, with the status each one gets. */
const NON_MUTATING_BASE = [
  [{ path: '/api/rooms' }, 200],
  [{ path: '/api/bookings' }, 200],
  [{ path: '/api/bookings?date=2026-11-03' }, 200],
  [{ path: '/' }, 200],
  [{ path: '/app.js' }, 200],
  [{ path: '/nope' }, 404],
  [{ method: 'HEAD', path: '/' }, 405],
  [{ method: 'OPTIONS', path: '/api/bookings' }, 405],
  [{ method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, body: '{}' }, 400],
  [{ method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'text/plain' }, body: 'x' }, 415],
  [{ method: 'DELETE', path: '/api/bookings/999' }, 404],
  [{ method: 'DELETE', path: '/api/bookings/abc' }, 404],
];
/** Only meaningful with the fixture loaded: this booking overlaps the stored one. */
const NON_MUTATING_FIXTURE_ONLY = [
  [{ method: 'POST', path: '/api/bookings', headers: JSON_HEADERS, body: JSON.stringify(VALID_BOOKING) }, 409],
];

async function fireRequests(port, calls) {
  for (const [req, status] of calls) {
    const res = await request(port, req);
    assert.equal(res.status, status, `${req.method ?? 'GET'} ${req.path}`);
  }
}

describe('no write without a change', () => {
  test('existing file keeps its bytes and mtime', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await fs.writeFile(file, FIXTURE);
      const before = await fs.stat(file);
      await withServer({ env: { DATA_FILE: file }, cwd: dir }, async (server) => {
        await fireRequests(server.port, [...NON_MUTATING_BASE, ...NON_MUTATING_FIXTURE_ONLY]);
      });
      const after = await fs.stat(file);
      assert.equal(await fs.readFile(file, 'utf8'), FIXTURE);
      assert.equal(after.mtimeMs, before.mtimeMs);
    });
  });

  test('missing file is still missing', async () => {
    await withTemp(async (dir) => {
      const file = path.join(dir, 'data.json');
      await withServer({ env: { DATA_FILE: file }, cwd: dir }, async (server) => {
        assert.equal(await exists(file), false);
        await fireRequests(server.port, NON_MUTATING_BASE);
      });
      assert.equal(await exists(file), false);
    });
  });
});
