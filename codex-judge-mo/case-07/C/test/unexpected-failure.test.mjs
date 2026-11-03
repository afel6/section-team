// An unexpected failure while handling a request is a 500 and the server keeps running.
// The failure is provoked by running a copy of server.mjs that has no public/ folder next to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SERVER_PATH, withTemp, startServer, request, expectError,
} from './helpers/server.mjs';

test('missing page files give 500 internal error and the server keeps running', async () => {
  await withTemp(async (dir) => {
    const copyFolder = path.join(dir, 'copy');
    await fs.mkdir(copyFolder);
    const copyPath = path.join(copyFolder, 'server.mjs');
    await fs.copyFile(SERVER_PATH, copyPath);
    const workFolder = path.join(dir, 'work');
    await fs.mkdir(workFolder);

    const server = await startServer({ cwd: workFolder, serverPath: copyPath });
    try {
      for (const target of ['/', '/app.js']) {
        expectError(await request(server.port, { path: target }), 500, 'internal error');
      }
      const rooms = await request(server.port, { path: '/api/rooms' });
      assert.equal(rooms.status, 200);
      assert.deepEqual(rooms.json(), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
      assert.equal(server.output.stdout, `listening on http://127.0.0.1:${server.port}\n`);
    } finally {
      await server.stop();
    }
  });
});
