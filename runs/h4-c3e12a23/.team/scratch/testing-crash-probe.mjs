// Final-review crash probes against a live server; prints one line per probe.
import { connect } from 'node:net';
import { startServer, request, postBooking, validBooking, makeTempDir, removeDir } from '../../test/helpers/server-harness.mjs';

function raw(port, text, { endAfterMs } = {}) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(text);
      if (endAfterMs !== undefined) setTimeout(() => socket.destroy(), endAfterMs);
    });
    const chunks = [];
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', (e) => resolve(`socket error ${e.code}`));
    socket.on('close', () => resolve(Buffer.concat(chunks).toString('utf8').split('\r\n')[0] + ' | ' + Buffer.concat(chunks).toString('utf8').split('\r\n\r\n')[1]));
  });
}

const out = (line) => process.stdout.write(`${line}\n`);
const dir = await makeTempDir();
const s = await startServer({ cwd: dir, env: { DATA_FILE: 'data.json' } });
const p = s.port;
out(`abort mid-body: ${await raw(p, 'POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{"room"', { endAfterMs: 50 })}`);
out(`abort chunked: ${await raw(p, 'POST /api/bookings HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nabcde\r\n', { endAfterMs: 50 })}`);
out(`garbage: ${await raw(p, 'HELLO\r\n\r\n')}`);
out(`OPTIONS *: ${await raw(p, 'OPTIONS * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')}`);
out(`GET *: ${await raw(p, 'GET * HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')}`);
out(`absolute-form: ${await raw(p, `GET http://127.0.0.1:${p}/api/rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)}`);
out(`absolute DELETE: ${await raw(p, `DELETE http://127.0.0.1:${p}/api/bookings/1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`)}`);
out(`HTTP/1.0 no host: ${await raw(p, 'GET /api/rooms HTTP/1.0\r\n\r\n')}`);
out(`pipelined: ${await raw(p, 'GET /api/rooms HTTP/1.1\r\nHost: x\r\n\r\nGET /nope HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n')}`);
const bodies = [
  ['__proto__ holds room', '{"__proto__":{"room":"Aurora","title":"t","date":"2026-11-03","start":"09:00","end":"10:00"}}'],
  ['__proto__ extra key', JSON.stringify(validBooking()).replace('{', '{"__proto__":{"polluted":1},')],
  ['constructor/toString keys', JSON.stringify(validBooking({ date: '2026-11-04', constructor: 1, toString: 2, hasOwnProperty: 3 }))],
  ['title toString', JSON.stringify(validBooking({ date: '2026-11-05', title: 'toString' }))],
  ['deep nesting', '{"a":' + '['.repeat(100000) + ']'.repeat(100000) + '}'],
  ['huge number', '{"room":1e999}'],
];
for (const [name, body] of bodies) {
  const r = await postBooking(p, body, { raw: true });
  out(`${name}: ${r.status} ${r.text.slice(0, 160)}`);
}
out(`list: ${(await request(p, { path: '/api/bookings' })).text}`);
out(`DELETE /api/bookings/__proto__: ${(await request(p, { method: 'DELETE', path: '/api/bookings/__proto__' })).text}`);
out(`GET /api/bookings?__proto__=1&date=2026-11-03: ${(await request(p, { path: '/api/bookings?__proto__=1&date=2026-11-03' })).status}`);
out(`GET /__proto__: ${(await request(p, { path: '/__proto__' })).text}`);
out(`GET /constructor: ${(await request(p, { path: '/constructor' })).text}`);
out(`GET /hasOwnProperty: ${(await request(p, { path: '/hasOwnProperty' })).text}`);
out(`still running: ${s.isRunning()} rooms=${(await request(p, { path: '/api/rooms' })).status}`);
out(`stdout: ${JSON.stringify(s.output.stdout)}`);
out(`stderr: ${JSON.stringify(s.output.stderr)}`);
await s.stop();
await removeDir(dir);
