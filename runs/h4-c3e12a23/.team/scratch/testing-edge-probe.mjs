// Probes CONNECT and Expect handling on a live server; prints the raw status line of each reply.
import { connect } from 'node:net';
import { startServer, request, makeTempDir, removeDir } from '../../test/helpers/server-harness.mjs';

function raw(port, text) {
  return new Promise((resolve) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    const chunks = [];
    const timer = setTimeout(() => socket.destroy(), 1500);
    socket.on('data', (c) => chunks.push(c));
    socket.on('error', (e) => resolve(`socket error ${e.code}`));
    socket.on('close', () => { clearTimeout(timer); resolve(JSON.stringify(Buffer.concat(chunks).toString('utf8'))); });
  });
}
const out = (line) => process.stdout.write(`${line}\n`);
const dir = await makeTempDir();
const s = await startServer({ cwd: dir, env: { DATA_FILE: 'data.json' } });
out(`CONNECT /api/rooms: ${await raw(s.port, 'CONNECT /api/rooms HTTP/1.1\r\nHost: x\r\n\r\n')}`);
out(`CONNECT host:port: ${await raw(s.port, 'CONNECT 127.0.0.1:80 HTTP/1.1\r\nHost: 127.0.0.1:80\r\n\r\n')}`);
out(`Expect foo: ${await raw(s.port, 'POST /api/bookings HTTP/1.1\r\nHost: x\r\nExpect: foo\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi')}`);
out(`Expect 100-continue: ${await raw(s.port, 'POST /api/bookings HTTP/1.1\r\nHost: x\r\nExpect: 100-continue\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nConnection: close\r\n\r\nhi')}`);
out(`still running: ${s.isRunning()} ${(await request(s.port, { path: '/api/rooms' })).status} stderr=${JSON.stringify(s.output.stderr)}`);
await s.stop();
await removeDir(dir);
