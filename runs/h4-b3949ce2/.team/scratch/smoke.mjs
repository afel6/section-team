// Backend smoke test (scratch, not part of the app). Run: node .team/scratch/smoke.mjs
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

const SERVER = new URL('../../server.mjs', import.meta.url).pathname;
const dir = await mkdtemp(join(tmpdir(), 'smoke-'));
let failures = 0;
const check = (name, ok, info = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name} ${ok ? '' : info}\n`);
};

function start(env) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, cwd: dir });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/^listening on http:\/\/127\.0\.0\.1:(\d+)\n$/);
      if (m) res({ child, port: Number(m[1]), out: () => out });
    });
    child.stderr.on('data', (d) => (err += d));
    child.on('exit', (code) => res({ code, err, out }));
  });
}

function req(port, method, path, { headers = {}, body } = {}) {
  return new Promise((res, rej) => {
    const framed = body === undefined ? headers : { ...headers, 'Content-Length': Buffer.byteLength(body) };
    const r = request({ host: '127.0.0.1', port, method, path, headers: framed }, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        let json;
        try { json = JSON.parse(text); } catch { json = undefined; }
        res({ status: resp.statusCode, type: resp.headers['content-type'], text, json });
      });
    });
    r.on('error', rej);
    r.end(body);
  });
}

const JT = { 'Content-Type': 'application/json' };
const post = (port, obj, h = JT) => req(port, 'POST', '/api/bookings', { headers: h, body: typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj) });
const B = (o = {}) => ({ room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...o });

const file = join(dir, 'b.json');
const s = await start({ PORT: '0', DATA_FILE: file });
const p = s.port;
let r = await req(p, 'GET', '/api/rooms');
check('rooms', r.status === 200 && r.type === 'application/json; charset=utf-8' && JSON.stringify(r.json) === '{"rooms":["Aurora","Borealis","Cosmos"]}');
r = await req(p, 'GET', '/api/bookings'); check('empty list', r.status === 200 && r.json.bookings.length === 0);
r = await req(p, 'GET', '/api/bookings?date'); check('?date empty 400', r.status === 400 && r.json.error === 'date must be a valid YYYY-MM-DD date');
r = await req(p, 'GET', '/api/bookings?date=2026-02-29'); check('bad leap 400', r.status === 400);
r = await req(p, 'GET', '/api/bookings?date=2028-02-29&date=x'); check('first date used', r.status === 200);
r = await post(p, B(), {}); check('no ct 415', r.status === 415 && r.json.error === 'content type must be application/json');
r = await post(p, '[]', { 'Content-Type': ' \tApplication/JSON ; charset=x' }); check('ct case/space, array 400', r.status === 400 && r.json.error === 'body must be a JSON object');
r = await post(p, 'a'.repeat(20000), { 'Content-Type': 'text/plain' }); check('415 before 413', r.status === 415);
r = await post(p, 'a'.repeat(20000)); check('413', r.status === 413 && r.json.error === 'body too large');
r = await post(p, ' '.repeat(9990) + '{}'); check('10000 bytes ok -> field 400', r.status === 400 && r.json.error.startsWith('room'));
r = await post(p, Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d])); check('BOM 400', r.status === 400 && r.json.error === 'body must be a JSON object');
r = await post(p, B({ room: 'aurora' })); check('room case', r.status === 400 && r.json.error.startsWith('room'));
r = await post(p, B({ title: '   ' })); check('title blank', r.status === 400 && r.json.error === 'title must be 1 to 80 characters');
r = await post(p, B({ title: 'x'.repeat(81) })); check('title 81', r.status === 400);
r = await post(p, B({ date: '2026-11-3' })); check('date short', r.status === 400 && r.json.error.startsWith('date'));
r = await post(p, B({ date: '2100-01-01' })); check('date 2100', r.status === 400);
r = await post(p, B({ start: '9:00' })); check('start', r.status === 400 && r.json.error === 'start must be HH:MM');
r = await post(p, B({ end: '24:00' })); check('end', r.status === 400 && r.json.error === 'end must be HH:MM');
r = await post(p, B({ end: '09:00' })); check('order', r.status === 400 && r.json.error === 'end must be after start');
r = await post(p, B({ title: '  Standup  ', extra: 1 })); check('create 201', r.status === 201 && JSON.stringify(r.json) === JSON.stringify({ id: 1, ...B() }), r.text);
r = await post(p, B({ room: 'Cosmos', start: '08:00', end: '08:30' })); check('create 2', r.json.id === 2);
r = await post(p, B({ start: '10:00', end: '11:00' })); check('adjacent ok', r.status === 201 && r.json.id === 3);
r = await post(p, B({ start: '08:00', end: '12:00' })); check('409 earliest', r.status === 409 && r.json.error === 'room is already booked from 09:00 to 10:00', r.text);
r = await req(p, 'GET', '/api/bookings'); check('sorted', r.json.bookings.map((b) => b.id).join() === '2,1,3', r.text);
for (const [m, path, st, msg] of [
  ['DELETE', '/api/bookings/01', 404, 'booking not found'], ['DELETE', '/api/bookings/abc', 404, 'booking not found'],
  ['DELETE', '/api/bookings/99', 404, 'booking not found'], ['GET', '/api/bookings/abc', 405, 'method not allowed'],
  ['GET', '/api/bookings/', 404, 'not found'], ['DELETE', '/api/bookings/1/', 404, 'not found'], ['GET', '/API/rooms', 404, 'not found'],
  ['GET', '/api/./rooms', 404, 'not found'], ['GET', '/api/%62ookings', 404, 'not found'], ['HEAD', '/api/rooms', 405, null],
  ['OPTIONS', '/', 405, 'method not allowed'], ['PUT', '/api/bookings', 405, 'method not allowed'], ['POST', '/nope', 404, 'not found'],
]) {
  r = await req(p, m, path);
  check(`${m} ${path} ${st}`, r.status === st && (msg === null || r.json?.error === msg), `${r.status} ${r.text}`);
}
r = await req(p, 'GET', '/?x=1'); check('GET / (500 if page missing)', (r.status === 200 && r.type === 'text/html; charset=utf-8') || (r.status === 500 && r.json.error === 'internal error'), `${r.status}`);
r = await req(p, 'GET', '/app.js'); check('GET /app.js', (r.status === 200 && r.type === 'text/javascript; charset=utf-8') || r.status === 500, `${r.status}`);
r = await req(p, 'DELETE', '/api/bookings/1'); check('delete 204', r.status === 204 && r.text === '');
r = await req(p, 'DELETE', '/api/bookings/1', { body: 'x'.repeat(50000) }); check('delete again 404', r.status === 404, `${r.status} ${r.text}`);
const results = await Promise.all(Array.from({ length: 8 }, () => post(p, B({ room: 'Borealis', date: '2026-11-04' }))));
const codes = results.map((x) => x.status).sort();
check('concurrent: one 201', codes.filter((c) => c === 201).length === 1 && codes.filter((c) => c === 409).length === 7, codes.join());
const saved = JSON.parse(await readFile(file, 'utf8'));
check('file nextId 5', saved.nextId === 5 && saved.bookings.length === 3, JSON.stringify(saved));
s.child.kill();

const s2 = await start({ PORT: '0', DATA_FILE: 'b.json' });
r = await post(s2.port, B({ room: 'Cosmos', date: '2000-02-29', start: '00:00', end: '23:59' }));
check('restart, relative DATA_FILE, next id 5', r.status === 201 && r.json.id === 5, r.text);
s2.child.kill();

const s3 = await start({ PORT: '0', DATA_FILE: join(dir, 'missing', 'b.json') });
r = await post(s3.port, B()); check('save fail 500', r.status === 500 && r.json.error === 'internal error');
r = await req(s3.port, 'GET', '/api/bookings'); check('no change', r.json.bookings.length === 0);
const inUse = await start({ PORT: String(s3.port), DATA_FILE: file });
check('port in use exit 1', inUse.code === 1 && inUse.err.split('\n').length === 2 && inUse.out === '', inUse.err);
s3.child.kill();

await writeFile(join(dir, 'empty.json'), '');
await writeFile(join(dir, 'bad.json'), '{"nextId":1,"bookings":[{"id":1,"room":"Aurora","title":"x","date":"2026-11-03","start":"09:00","end":"10:00"}]}');
for (const [env, expect] of [
  [{ PORT: 'abc' }, null], [{ PORT: '65536' }, null], [{ PORT: '+1' }, null],
  [{ PORT: '0', DATA_FILE: dir }, `cannot read data file ${dir}\n`],
  [{ PORT: '0', DATA_FILE: 'empty.json' }, 'cannot read data file empty.json\n'],
  [{ PORT: '0', DATA_FILE: 'bad.json' }, 'cannot read data file bad.json\n'],
  [{ PORT: 'x', DATA_FILE: 'empty.json' }, null],
]) {
  const x = await start(env);
  check(`startup fails ${JSON.stringify(env)}`, x.code === 1 && x.out === '' && (expect === null ? !x.err.includes('data file') && x.err.endsWith('\n') : x.err === expect), x.err);
}
const def = await start({ PORT: '0', DATA_FILE: '' });
r = await post(def.port, B()); check('default bookings.json in cwd', r.status === 201 && JSON.parse(await readFile(join(dir, 'bookings.json'), 'utf8')).nextId === 2);
def.child.kill();

await rm(dir, { recursive: true, force: true });
process.stdout.write(failures === 0 ? 'ALL OK\n' : `${failures} FAILURES\n`);
process.exitCode = failures === 0 ? 0 : 1;
