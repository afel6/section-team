// Startup behaviour: PORT checks, data file reading, ordering, stdout.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {
  startServer, runUntilExit, request, postJson, booking, makeTempDir, removeDir, LISTEN_RE,
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

function listenBusy() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function closeNet(srv) {
  return new Promise((resolve) => srv.close(() => resolve()));
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

function assertOneLineFailure(res) {
  assert.equal(res.code, 1);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /^[^\n]+\n$/);
  assert.doesNotMatch(res.stderr, /^\s+at /m);
  assert.doesNotMatch(res.stderr, /Error/);
}

describe('A. PORT validation', () => {
  const bad = ['+80', ' 80', '80 ', '65536', '1e3', '0x50', '-1', 'abc', '８０', '99999999999999999999'];
  for (const port of bad) {
    test(`PORT ${JSON.stringify(port)} exits 1 with one stderr line`, () => withTmp(async (dir) => {
      const res = await runUntilExit({ env: { PORT: port, DATA_FILE: path.join(dir, 'b.json') } });
      assertOneLineFailure(res);
    }));
  }

  for (const port of ['00000', '65535']) {
    test(`PORT ${port} starts`, () => withTmp(async (dir) => {
      await withServer({ env: { PORT: port, DATA_FILE: path.join(dir, 'b.json') } }, async (s) => {
        if (port === '65535') assert.equal(s.port, 65535);
        else assert.ok(s.port > 0);
      });
    }));
  }

  for (const [label, value] of [['empty', ''], ['unset', undefined]]) {
    test(`${label} PORT means 3000`, async (t) => {
      if (await isPortInUse(3000)) { t.skip('port 3000 is in use'); return; }
      await withTmp(async (dir) => {
        let server;
        try {
          server = await startServer({ env: { PORT: value, DATA_FILE: path.join(dir, 'b.json') } });
        } catch (err) {
          if (await isPortInUse(3000)) { t.skip('port 3000 is in use'); return; }
          throw err;
        }
        try {
          assert.equal(server.port, 3000);
          assert.equal(server.out.stdout, 'listening on http://127.0.0.1:3000\n');
        } finally {
          await server.stop();
        }
      });
    });
  }

  test('port in use exits 1 with one stderr line', () => withTmp(async (dir) => {
    const busy = await listenBusy();
    try {
      const port = String(busy.address().port);
      const res = await runUntilExit({ env: { PORT: port, DATA_FILE: path.join(dir, 'b.json') } });
      assertOneLineFailure(res);
    } finally {
      await closeNet(busy);
    }
  }));
});

describe('B. startup order', () => {
  test('invalid PORT is checked before the data file', () => withTmp(async (dir) => {
    const res = await runUntilExit({ env: { PORT: 'abc', DATA_FILE: dir } });
    assert.equal(res.code, 1);
    assert.equal(res.stdout, '');
    assert.doesNotMatch(res.stderr, /cannot read data file/);
  }));

  test('data file is read before listening', () => withTmp(async (dir) => {
    const busy = await listenBusy();
    try {
      const file = path.join(dir, 'bad.json');
      fs.writeFileSync(file, 'not json');
      const res = await runUntilExit({ env: { PORT: String(busy.address().port), DATA_FILE: file } });
      assert.equal(res.code, 1);
      assert.equal(res.stdout, '');
      assert.equal(res.stderr, `cannot read data file ${file}\n`);
    } finally {
      await closeNet(busy);
    }
  }));
});

describe('C. unreadable data file', () => {
  async function expectBad(dir, name, env = {}, cwd) {
    const res = await runUntilExit({ env: { PORT: '0', DATA_FILE: name, ...env }, cwd });
    assert.equal(res.code, 1);
    assert.equal(res.stdout, '');
    assert.equal(res.stderr, `cannot read data file ${name}\n`);
  }

  const contents = {
    'empty file': '',
    'not json': 'not json',
    'JSON array': '[]',
    'JSON null': 'null',
    'empty object': '{}',
  };
  for (const [label, content] of Object.entries(contents)) {
    test(label, () => withTmp(async (dir) => {
      const file = path.join(dir, 'b.json');
      fs.writeFileSync(file, content);
      await expectBad(dir, file);
    }));
  }

  test('path is a directory', () => withTmp(async (dir) => {
    await expectBad(dir, dir);
  }));

  test('valid store with a UTF-8 BOM', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    fs.writeFileSync(file, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"nextId":1,"bookings":[]}'),
    ]));
    await expectBad(dir, file);
  }));

  test('relative DATA_FILE is shown as given', () => withTmp(async (dir) => {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'bad.json'), 'nope');
    await expectBad(dir, 'sub/../bad.json', {}, dir);
  }));

  test('parent is a regular file', () => withTmp(async (dir) => {
    const file = path.join(dir, 'plain');
    fs.writeFileSync(file, 'x');
    await expectBad(dir, `${file}/x.json`);
  }));

  for (const [label, env] of [['unset', {}], ['empty', { DATA_FILE: '' }]]) {
    test(`DATA_FILE ${label}: bookings.json directory in cwd`, () => withTmp(async (dir) => {
      fs.mkdirSync(path.join(dir, 'bookings.json'));
      const res = await runUntilExit({ env: { PORT: '0', ...env }, cwd: dir });
      assert.equal(res.code, 1);
      assert.equal(res.stdout, '');
      assert.equal(res.stderr, 'cannot read data file bookings.json\n');
    }));
  }
});

describe('D. ENOENT means no bookings', () => {
  async function checkMissing(file, probe) {
    await withServer({ env: { DATA_FILE: file } }, async (s) => {
      const res = await request(s.port, { path: '/api/bookings' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.json, { bookings: [] });
      await request(s.port, { path: '/api/rooms' });
      assert.equal(fs.existsSync(probe), false);
    });
    assert.equal(fs.existsSync(probe), false);
  }

  test('missing file', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    await checkMissing(file, file);
  }));

  test('missing folder', () => withTmp(async (dir) => {
    const file = path.join(dir, 'nope', 'deeper', 'b.json');
    await checkMissing(file, path.join(dir, 'nope'));
  }));
});

describe('E. stdout', () => {
  test('only the listening line is ever written', () => withTmp(async (dir) => {
    const file = path.join(dir, 'b.json');
    let port;
    let out;
    await withServer({ env: { DATA_FILE: file } }, async (s) => {
      port = s.port;
      out = s.out;
      assert.equal((await request(port, { path: '/api/bookings' })).status, 200);
      const created = await postJson(port, booking());
      assert.equal(created.status, 201);
      assert.equal((await postJson(port, booking({ room: 'x' }))).status, 400);
      const del = await request(port, { method: 'DELETE', path: `/api/bookings/${created.json.id}` });
      assert.equal(del.status, 204);
      assert.equal((await request(port, { path: '/nothing' })).status, 404);
    });
    assert.equal(typeof port, 'number');
    assert.ok(port > 0);
    assert.equal(out.stdout, `listening on http://127.0.0.1:${port}\n`);
    assert.match(out.stdout, LISTEN_RE);
  }));
});
