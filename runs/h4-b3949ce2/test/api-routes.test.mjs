import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  JSON_HEADERS,
  JSON_TYPE,
  MSG,
  ROOT,
  booking,
  expectError,
  makeTmpDir,
  rawRequest,
  request,
  startServer,
  withServer,
  withTmpDir,
} from './helpers/server.mjs';

const HTML_TYPE = 'text/html; charset=utf-8';
const JS_TYPE = 'text/javascript; charset=utf-8';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

let dir;
let srv;

before(async () => {
  dir = await makeTmpDir();
  srv = await startServer({ cwd: dir });
});

after(async () => {
  if (srv) await srv.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** Sends a request; POST/PUT/PATCH get a valid JSON booking body. */
function send(method, path) {
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
  return request(srv.port, {
    method,
    path,
    headers: hasBody ? JSON_HEADERS : {},
    body: hasBody ? JSON.stringify(booking()) : undefined,
  });
}

describe('GET /api/rooms', () => {
  test('exact body and content type', async () => {
    const res = await request(srv.port, { path: '/api/rooms' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['content-type'], JSON_TYPE);
    assert.deepStrictEqual(res.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });

  for (const path of ['/api/rooms?x=1', '/api/rooms?']) {
    test(`query ignored: ${path}`, async () => {
      const res = await request(srv.port, { path });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], JSON_TYPE);
      assert.deepStrictEqual(res.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    });
  }
});

const NOT_FOUND_PATHS = [
  '/api/%62ookings',
  '/api/./rooms',
  '/API/rooms',
  '/api/Bookings',
  '/api/bookings/',
  '/api/bookings/1/',
  '/api/bookings//',
  '/api/bookings/1/2',
  '/api/rooms/',
  '/api',
  '/api/',
  '/index.html',
  '/app.js/',
  '/APP.JS',
  '//api/rooms',
  '/api/bookings%2F1',
  '/nope',
];

describe('404 not found', () => {
  for (const path of NOT_FOUND_PATHS) {
    for (const method of METHODS) {
      test(`${method} ${path}`, async () => {
        expectError(await send(method, path), 404, MSG.notFound);
      });
    }
    test(`HEAD ${path}`, async () => {
      const res = await send('HEAD', path);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.text, '');
    });
  }

  test('OPTIONS * is answered with 404', async () => {
    const raw = await rawRequest(
      srv.port,
      'OPTIONS * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    );
    assert.strictEqual(raw.split('\r\n')[0], 'HTTP/1.1 404 Not Found');
  });
});

const NOT_ALLOWED = [
  ['/api/rooms', ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']],
  ['/api/bookings', ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']],
  ['/api/bookings/1', ['GET', 'POST', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']],
  ['/api/bookings/abc', ['GET', 'POST', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']],
  ['/api/bookings/%2F', ['GET', 'POST', 'PUT', 'PATCH', 'HEAD', 'OPTIONS']],
  ['/', ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']],
  ['/app.js', ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']],
];

describe('405 method not allowed', () => {
  for (const [path, methods] of NOT_ALLOWED) {
    for (const method of methods) {
      test(`${method} ${path}`, async () => {
        const res = await send(method, path);
        if (method === 'HEAD') {
          assert.strictEqual(res.status, 405);
          assert.strictEqual(res.headers['content-type'], JSON_TYPE);
          assert.strictEqual(res.text, '');
        } else {
          expectError(res, 405, MSG.method);
        }
      });
    }
  }

  for (const path of ['/api/bookings/1', '/api/rooms']) {
    test(`POST ${path} with valid JSON body`, async () => {
      const res = await request(srv.port, {
        method: 'POST',
        path,
        headers: JSON_HEADERS,
        body: JSON.stringify(booking()),
      });
      expectError(res, 405, MSG.method);
    });
  }
});

describe('page serving', () => {
  const pages = [
    ['/', 'index.html', HTML_TYPE],
    ['/?a=b', 'index.html', HTML_TYPE],
    ['/app.js', 'app.js', JS_TYPE],
    ['/app.js?v=1', 'app.js', JS_TYPE],
  ];
  for (const [path, file, type] of pages) {
    test(`GET ${path}`, async () => {
      const res = await request(srv.port, { path });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['content-type'], type);
      const filePath = join(ROOT, 'public', file);
      const size = statSync(filePath).size;
      assert.strictEqual(res.text, readFileSync(filePath, 'utf8'));
      assert.strictEqual(Buffer.byteLength(res.text), size);
      const length = res.headers['content-length'];
      if (length !== undefined) assert.strictEqual(length, String(size));
    });
  }
});

describe('DELETE route matching', () => {
  test('DELETE /api/bookings/%2F is booking not found', async () => {
    const res = await request(srv.port, { method: 'DELETE', path: '/api/bookings/%2F' });
    expectError(res, 404, MSG.bookingNotFound);
  });
});

describe('unexpected failures', () => {
  test('missing public files reply 500 and the server keeps running', () =>
    withTmpDir(async (tmp) => {
      const script = join(tmp, 'server.mjs');
      await copyFile(join(ROOT, 'server.mjs'), script);
      await withServer({ cwd: tmp, script }, async (server) => {
        for (const path of ['/', '/app.js']) {
          expectError(await request(server.port, { path }), 500, MSG.internal);
        }
        const rooms = await request(server.port, { path: '/api/rooms' });
        assert.strictEqual(rooms.status, 200);
        assert.deepStrictEqual(rooms.json, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
        assert.match(server.stdout(), /^listening on http:\/\/127\.0\.0\.1:\d+\n$/);
      });
    }));
});
