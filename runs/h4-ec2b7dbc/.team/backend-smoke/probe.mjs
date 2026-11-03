import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdirSync } from 'node:fs';

const dir = new URL('./tmp/probe/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const child = spawn('node', [new URL('../../server.mjs', import.meta.url).pathname], {
  cwd: dir, env: { ...process.env, PORT: '0', DATA_FILE: 'p.json' },
});
const port = await new Promise((r) => child.stdout.once('data', (d) => r(Number(String(d).trim().split(':').pop()))));
const raw = (text) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  let out = '';
  s.on('data', (d) => { out += d; });
  s.on('close', () => resolve(out.slice(0, 200)));
  s.on('error', (e) => resolve('ERR ' + e.code));
  s.write(text);
  setTimeout(() => s.destroy(), 800);
});
const cases = [
  'CONNECT /api/rooms HTTP/1.1\r\nHost: x\r\n\r\n',
  'CONNECT x:80 HTTP/1.1\r\nHost: x\r\n\r\n',
  'GET /api/rooms HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
  'GET /api/rooms HTTP/1.1\r\n\r\n',
  'GET /api/rooms HTTP/1.1\r\nHost: x\r\nExpect: foo\r\nConnection: close\r\n\r\n',
  'GET http://x/api/rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
  'GET /api/bookings?date=2026-11-03 HTTP/1.0\r\n\r\n',
  'POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nExpect: 100-continue\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}',
];
for (const c of cases) process.stdout.write(`--- ${JSON.stringify(c.split('\r\n')[0])}\n${await raw(c)}\n`);
child.kill();
