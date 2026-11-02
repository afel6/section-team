import { startServer, request, makeTempDir, removeDir } from '../../test/helpers/server-harness.mjs';
const dir = await makeTempDir();
const s = await startServer({ cwd: dir, env: { DATA_FILE: 'data.json' } });
const big = Buffer.alloc(2 * 1024 * 1024, 'a');
const cases = [
  ['415', { method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'text/plain' }, body: big }],
  ['413', { method: 'POST', path: '/api/bookings', headers: { 'Content-Type': 'application/json' }, body: big }],
  ['404', { method: 'POST', path: '/nope', body: big }],
  ['405', { method: 'PUT', path: '/api/rooms', body: big }],
  ['404del', { method: 'DELETE', path: '/api/bookings/1', body: big }],
  ['404delCL', { method: 'DELETE', path: '/api/bookings/1', headers: { 'Content-Length': String(big.length) }, body: big }],
  ['405getCL', { method: 'GET', path: '/api/bookings/1', headers: { 'Content-Length': String(big.length) }, body: big }],
  ['delchunked', { method: 'DELETE', path: '/api/bookings/1', headers: { 'Transfer-Encoding': 'chunked' }, body: [big, big] }],
];
for (const [name, opts] of cases) {
  for (let i = 0; i < 5; i += 1) {
    try {
      const r = await request(s.port, opts);
      process.stdout.write(`${name} ${r.status} ${r.text}\n`);
    } catch (e) {
      process.stdout.write(`${name} ERR ${e.code}\n`);
    }
  }
}
process.stdout.write(`stderr: ${s.output.stderr}\n`);
await s.stop();
await removeDir(dir);
