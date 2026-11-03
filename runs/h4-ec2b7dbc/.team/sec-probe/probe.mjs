// Supervisor's security probe (throwaway). Run from project root: node .team/sec-probe/probe.mjs
import { spawn } from 'node:child_process';
import net from 'node:net';
import { readFileSync, rmSync, mkdirSync } from 'node:fs';

const dir = '.team/sec-probe/tmp';
mkdirSync(dir, { recursive: true });
const p = spawn('node', ['server.mjs'], { env: { ...process.env, PORT: '0', DATA_FILE: `${dir}/d.json` } });
p.stderr.on('data', (d) => console.log('STDERR', String(d)));
let out = '';
await new Promise((r) => p.stdout.on('data', (d) => { out += d; if (out.includes('\n')) r(); }));
const port = Number(out.match(/:(\d+)\n/)[1]);
const B = `http://127.0.0.1:${port}`;
const post = (b) => fetch(`${B}/api/bookings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b })
  .then(async (r) => [r.status, await r.text()]);

console.log('proto room', await post('{"__proto__":{"room":"Aurora"},"title":"t","date":"2026-11-03","start":"09:00","end":"10:00"}'));
console.log('proto extra', await post('{"__proto__":{"x":1},"room":"Aurora","title":"t","date":"2026-11-03","start":"09:00","end":"10:00"}'));
console.log('constructor', await post('{"room":"constructor"}'));
console.log('del constructor', await fetch(`${B}/api/bookings/constructor`, { method: 'DELETE' }).then((r) => r.status));
console.log('del huge', await fetch(`${B}/api/bookings/99999999999999999999999`, { method: 'DELETE' }).then((r) => r.status));
await new Promise((res) => {
  const s = net.connect(port, '127.0.0.1', () => {
    s.write('POST /api/bookings HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"a":');
    setTimeout(() => { s.destroy(); res(); }, 100);
  });
});
await new Promise((res) => {
  const s = net.connect(port, '127.0.0.1', () => s.write('GET /\x01 bad\r\n\r\n'));
  s.on('data', (d) => console.log('malformed ->', String(d).split('\r\n')[0]));
  s.on('error', () => {}); s.on('close', res);
});
console.log('big', await post('x'.repeat(50000)));
console.log('alive', await fetch(`${B}/api/rooms`).then((r) => r.status));
console.log('file', readFileSync(`${dir}/d.json`, 'utf8'));
p.kill();
rmSync(dir, { recursive: true, force: true });
