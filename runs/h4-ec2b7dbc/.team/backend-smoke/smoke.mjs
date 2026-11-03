// By-hand smoke test for server.mjs (throwaway; not a node:test suite).
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SERVER = path.join(ROOT, 'server.mjs');
const TMP = path.join(HERE, 'tmp');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];
function check(label, actual, expected) {
  const a = typeof actual === 'string' ? actual : JSON.stringify(actual);
  const e = typeof expected === 'string' ? expected : JSON.stringify(expected);
  if (a === e) { pass++; console.log(`PASS ${label}`); }
  else { fail++; failures.push(label); console.log(`FAIL ${label}\n     expected: ${e}\n     actual:   ${a}`); }
}
const ok = (label, cond, detail = '') => check(label, cond ? 'ok' : `not ok ${detail}`, 'ok');

let dirN = 0;
function newDir(name) {
  const d = path.join(TMP, `${++dirN}-${name}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

const spawned = new Set();
function baseEnv(extra) {
  return { PATH: process.env.PATH, ...extra };
}
function launch(env, cwd) {
  const proc = spawn(process.execPath, [SERVER], { cwd, env: baseEnv(env), stdio: ['ignore', 'pipe', 'pipe'] });
  spawned.add(proc);
  const s = { proc, out: '', err: '', exited: null };
  proc.stdout.on('data', (d) => { s.out += d; });
  proc.stderr.on('data', (d) => { s.err += d; });
  s.done = new Promise((res) => proc.on('exit', (code, sig) => { s.exited = { code, sig }; res(s.exited); }));
  return s;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runExit(env, cwd = newDir('cwd')) {
  const s = launch(env, cwd);
  const r = await Promise.race([s.done, sleep(5000).then(() => null)]);
  if (r === null) { s.proc.kill('SIGKILL'); await s.done; return { code: 'TIMEOUT', out: s.out, err: s.err }; }
  return { code: r.code, out: s.out, err: s.err };
}

async function startServer(env = {}, cwd = newDir('cwd')) {
  const s = launch({ PORT: '0', ...env }, cwd);
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const m = /^listening on http:\/\/127\.0\.0\.1:(\d+)\n/.exec(s.out);
    if (m) { s.port = Number(m[1]); return s; }
    if (s.exited) throw new Error(`server exited early: code=${s.exited.code} stderr=${s.err}`);
    await sleep(20);
  }
  throw new Error('server did not print listening line');
}
async function stopServer(s, label) {
  s.proc.kill('SIGTERM');
  await Promise.race([s.done, sleep(2000)]);
  if (s.exited === null) { s.proc.kill('SIGKILL'); await s.done; }
  if (label) check(`${label}: stdout is only the listening line`, s.out, `listening on http://127.0.0.1:${s.port}\n`);
}

// ---------- raw HTTP ----------
function build(method, target, { headers = {}, body, chunked = false } = {}) {
  const lines = [`${method} ${target} HTTP/1.1`, 'Host: 127.0.0.1', 'Connection: close'];
  for (const [k, v] of Object.entries(headers)) if (v !== undefined) lines.push(`${k}: ${v}`);
  const b = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  if (b && chunked) lines.push('Transfer-Encoding: chunked');
  else if (b) lines.push(`Content-Length: ${b.length}`);
  const head = Buffer.from(lines.join('\r\n') + '\r\n\r\n', 'latin1');
  if (!b) return head;
  if (!chunked) return Buffer.concat([head, b]);
  const parts = [head];
  for (let i = 0; i < b.length; i += 4096) {
    const c = b.subarray(i, i + 4096);
    parts.push(Buffer.from(`${c.length.toString(16)}\r\n`), c, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('0\r\n\r\n'));
  return Buffer.concat(parts);
}
function parseResponse(buf) {
  const i = buf.indexOf('\r\n\r\n');
  if (i === -1) return { status: 0, headers: {}, body: Buffer.alloc(0), rawLen: buf.length };
  const lines = buf.subarray(0, i).toString('latin1').split('\r\n');
  const status = Number(lines[0].split(' ')[1]);
  const headers = {};
  for (const l of lines.slice(1)) { const k = l.indexOf(':'); headers[l.slice(0, k).toLowerCase()] = l.slice(k + 1).trim(); }
  let body = buf.subarray(i + 4);
  if (headers['content-length'] !== undefined) body = body.subarray(0, Number(headers['content-length']));
  return { status, headers, body, rawLen: buf.length };
}
function rawSend(port, buf) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const chunks = [];
    let err = null;
    const timer = setTimeout(() => { err = 'timeout'; sock.destroy(); }, 10000);
    sock.on('data', (d) => chunks.push(d));
    sock.on('error', (e) => { err = e.code || String(e); });
    sock.on('close', () => { clearTimeout(timer); const r = parseResponse(Buffer.concat(chunks)); r.err = err; resolve(r); });
    sock.write(buf);
  });
}
const request = (port, method, target, opts) => rawSend(port, build(method, target, opts));
const jbody = (r) => { try { return JSON.parse(r.body.toString('utf8')); } catch { return `<unparsable: ${r.body.toString('utf8').slice(0, 80)}>`; } };
const JSON_CT = 'application/json; charset=utf-8';

function post(port, body, { ct = 'application/json', chunked = false } = {}) {
  const b = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  return request(port, 'POST', '/api/bookings', { headers: { 'Content-Type': ct }, body: b, chunked });
}
const get = (port, t) => request(port, 'GET', t);
const del = (port, t) => request(port, 'DELETE', t);

let dateCounter = 0;
function freshDate() {
  const n = dateCounter++;
  return `2030-${String(1 + Math.floor(n / 28)).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`;
}
const valid = (over = {}) => ({ room: 'Aurora', title: 'Standup', date: freshDate(), start: '09:00', end: '10:00', ...over });
const MSG = {
  room: 'room must be one of Aurora, Borealis, Cosmos',
  title: 'title must be 1 to 80 characters',
  date: 'date must be a valid YYYY-MM-DD date',
  start: 'start must be HH:MM',
  end: 'end must be HH:MM',
  order: 'end must be after start',
  obj: 'body must be a JSON object',
  ct: 'content type must be application/json',
};
function checkErr(label, r, status, message) {
  check(`${label} -> ${status} ${message}`, { s: r.status, b: jbody(r) }, { s: status, b: { error: message } });
}

// ---------- startup ----------
async function startupTests() {
  console.log('\n== Startup ==');
  const goodFile = path.join(newDir('d'), 'ok.json');
  for (const p of ['abc', '65536', '+1', ' 80', '1.5', '-1', '0x10', '99999999999999999999']) {
    const r = await runExit({ PORT: p, DATA_FILE: goodFile });
    check(`PORT=${JSON.stringify(p)} exit 1`, r.code, 1);
    ok(`PORT=${JSON.stringify(p)} one stderr line, empty stdout`, /^[^\n]+\n$/.test(r.err) && r.out === '', JSON.stringify(r));
  }
  const free3000 = await new Promise((res) => {
    const t = net.createServer(); t.once('error', () => res(false)); t.listen(3000, '127.0.0.1', () => t.close(() => res(true)));
  });
  if (free3000) {
    const s = await startServer({ PORT: '', DATA_FILE: goodFile }).catch((e) => ({ failed: e.message }));
    check('PORT="" listens on 3000', s.failed ?? s.port, 3000);
    if (!s.failed) await stopServer(s);
  } else console.log('SKIP PORT="" (3000 busy)');
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const used = blocker.address().port;
  const r1 = await runExit({ PORT: String(used), DATA_FILE: goodFile });
  check('PORT in use exit 1', r1.code, 1);
  ok('PORT in use one stderr line, empty stdout', /^[^\n]+\n$/.test(r1.err) && r1.out === '', JSON.stringify(r1));
  blocker.close();

  const dirAsFile = newDir('dirfile');
  const r2 = await runExit({ PORT: 'abc', DATA_FILE: dirAsFile });
  check('PORT invalid + DATA_FILE invalid -> exit 1', r2.code, 1);
  ok('PORT line wins over data line', !r2.err.includes('cannot read data file') && /^[^\n]+\n$/.test(r2.err), r2.err);
  const r3 = await runExit({ PORT: '65536', DATA_FILE: dirAsFile });
  ok('PORT 65536 + bad data: PORT line wins', !r3.err.includes('cannot read data file') && r3.code === 1, r3.err);
}

async function dataFileTests() {
  console.log('\n== DATA_FILE ==');
  const d = newDir('data');
  // missing file
  const missing = path.join(d, 'missing.json');
  let s = await startServer({ DATA_FILE: missing });
  check('missing file: GET /api/bookings', jbody(await get(s.port, '/api/bookings')), { bookings: [] });
  ok('missing file: not created by startup/GET', !fs.existsSync(missing));
  await stopServer(s, 'missing file');
  // missing folder
  const subFile = path.join(d, 'sub', 'x.json');
  s = await startServer({ DATA_FILE: subFile });
  check('missing folder: starts, GET []', jbody(await get(s.port, '/api/bookings')), { bookings: [] });
  const pr = await post(s.port, valid());
  checkErr('missing folder: POST', pr, 500, 'internal error');
  ok('missing folder: folder NOT created', !fs.existsSync(path.join(d, 'sub')));
  check('missing folder: booking not added', jbody(await get(s.port, '/api/bookings')), { bookings: [] });
  await stopServer(s, 'missing folder');

  const bk = { id: 1, room: 'Aurora', title: 'T', date: '2026-11-03', start: '09:00', end: '10:00' };
  const cases = {
    directory: null,
    empty: '',
    'not json': 'not json',
    '[]': '[]',
    '{"nextId":1}': '{"nextId":1}',
    'nextId not > id': JSON.stringify({ nextId: 1, bookings: [bk] }),
    BOM: '﻿' + JSON.stringify({ nextId: 2, bookings: [bk] }),
  };
  for (const [name, content] of Object.entries(cases)) {
    const f = path.join(d, `bad-${name.replace(/\W/g, '_')}.json`);
    if (content === null) fs.mkdirSync(f); else fs.writeFileSync(f, content);
    const r = await runExit({ PORT: '0', DATA_FILE: f });
    check(`bad data file (${name}): exit 1`, r.code, 1);
    check(`bad data file (${name}): stderr`, r.err, `cannot read data file ${f}\n`);
    check(`bad data file (${name}): stdout empty`, r.out, '');
  }
  // valid file loads, not rewritten
  const good = path.join(d, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ nextId: 5, bookings: [bk] }));
  fs.utimesSync(good, new Date(1e12), new Date(1e12));
  const before = fs.statSync(good).mtimeMs;
  s = await startServer({ DATA_FILE: good });
  check('valid file: bookings loaded', jbody(await get(s.port, '/api/bookings')), { bookings: [bk] });
  await get(s.port, '/api/rooms'); await get(s.port, '/api/bookings?date=2026-11-03'); await get(s.port, '/nope');
  check('valid file: mtime unchanged after startup + GETs', fs.statSync(good).mtimeMs, before);
  const nr = await post(s.port, valid());
  check('valid file: next id honoured (nextId 5)', jbody(nr).id, 5);
  await stopServer(s, 'valid file');

  // relative DATA_FILE against cwd
  const cwd = newDir('rel');
  fs.writeFileSync(path.join(cwd, 'rel.json'), JSON.stringify({ nextId: 2, bookings: [bk] }));
  s = await startServer({ DATA_FILE: 'rel.json' }, cwd);
  check('relative DATA_FILE: resolved against cwd', jbody(await get(s.port, '/api/bookings')).bookings?.length, 1);
  await post(s.port, valid());
  check('relative DATA_FILE: saved in cwd', JSON.parse(fs.readFileSync(path.join(cwd, 'rel.json'), 'utf8')).nextId, 3);
  await stopServer(s);
  const cwd2 = newDir('rel2');
  fs.writeFileSync(path.join(cwd2, 'rel.json'), 'garbage');
  let r = await runExit({ PORT: '0', DATA_FILE: 'rel.json' }, cwd2);
  check('relative bad DATA_FILE message as given', r.err, 'cannot read data file rel.json\n');
  // unset / empty DATA_FILE
  const cwd3 = newDir('unset');
  fs.writeFileSync(path.join(cwd3, 'bookings.json'), 'garbage');
  r = await runExit({ PORT: '0' }, cwd3);
  check('unset DATA_FILE names bookings.json', r.err, 'cannot read data file bookings.json\n');
  r = await runExit({ PORT: '0', DATA_FILE: '' }, cwd3);
  check('empty DATA_FILE names bookings.json', r.err, 'cannot read data file bookings.json\n');
  const cwd4 = newDir('unset2');
  s = await startServer({}, cwd4);
  ok('unset DATA_FILE: no file created at startup', !fs.existsSync(path.join(cwd4, 'bookings.json')));
  await post(s.port, valid());
  ok('unset DATA_FILE: POST writes cwd/bookings.json', fs.existsSync(path.join(cwd4, 'bookings.json')));
  await stopServer(s, 'unset DATA_FILE');
}

// ---------- API ----------
async function routingTests() {
  console.log('\n== Routing ==');
  const d = newDir('route');
  const s = await startServer({ DATA_FILE: path.join(d, 'b.json') });
  const p = s.port;
  const rooms = await get(p, '/api/rooms');
  check('GET /api/rooms status', rooms.status, 200);
  check('GET /api/rooms content-type', rooms.headers['content-type'], JSON_CT);
  check('GET /api/rooms body', jbody(rooms), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });

  for (const t of ['/api/%62ookings', '/api/./rooms', '/API/rooms', '/api/bookings/', '/api/bookings/1/', '/nope', '/api/rooms/']) {
    for (const m of ['GET', 'DELETE']) {
      const r = await request(p, m, t);
      checkErr(`${m} ${t}`, r, 404, 'not found');
      check(`${m} ${t} content-type`, r.headers['content-type'], JSON_CT);
    }
  }
  const m405 = [['GET', '/api/bookings/abc'], ['OPTIONS', '/api/bookings'], ['PUT', '/api/rooms'], ['POST', '/'], ['DELETE', '/api/bookings'],
    ['POST', '/app.js'], ['POST', '/api/rooms'], ['PATCH', '/api/bookings'], ['GET', '/api/bookings/1'], ['POST', '/api/bookings/1']];
  for (const [m, t] of m405) checkErr(`${m} ${t}`, await request(p, m, t), 405, 'method not allowed');
  const head = await request(p, 'HEAD', '/api/rooms');
  check('HEAD /api/rooms status', head.status, 405);
  check('HEAD /api/rooms no body', head.body.length, 0);
  const q = await get(p, '/api/rooms?x=1');
  check('GET /api/rooms?x=1 works (query ignored)', q.status, 200);

  const pub = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'] };
  for (const [t, [file, type]] of Object.entries(pub)) {
    const exists = fs.existsSync(path.join(ROOT, 'public', file));
    const r = await get(p, t);
    if (exists) {
      check(`GET ${t} status (public/${file} exists)`, r.status, 200);
      check(`GET ${t} content-type`, r.headers['content-type'], type);
      check(`GET ${t} body equals file`, r.body.equals(fs.readFileSync(path.join(ROOT, 'public', file))), true);
    } else {
      console.log(`INFO public/${file} missing`);
      checkErr(`GET ${t} (file missing)`, r, 500, 'internal error');
    }
  }
  const rs = await get(p, '/?a=b');
  check('GET /?a=b serves page', rs.status, fs.existsSync(path.join(ROOT, 'public/index.html')) ? 200 : 500);
  check('final GET /api/rooms still works', (await get(p, '/api/rooms')).status, 200);
  await stopServer(s, 'routing server');
}

function sizedBody(total) {
  const base = { room: 'Aurora', title: 'Big', date: freshDate(), start: '09:00', end: '10:00', pad: '' };
  const len = Buffer.byteLength(JSON.stringify(base));
  base.pad = 'x'.repeat(total - len);
  const s = JSON.stringify(base);
  if (Buffer.byteLength(s) !== total) throw new Error('size calc');
  return s;
}

async function postRuleTests() {
  console.log('\n== POST rules ==');
  const d = newDir('post');
  const s = await startServer({ DATA_FILE: path.join(d, 'b.json') });
  const p = s.port;
  // 415
  let r = await request(p, 'POST', '/api/bookings', { body: JSON.stringify(valid()) });
  checkErr('missing Content-Type', r, 415, MSG.ct);
  checkErr('text/plain', await post(p, valid(), { ct: 'text/plain' }), 415, MSG.ct);
  checkErr('application/jsonx', await post(p, valid(), { ct: 'application/jsonx' }), 415, MSG.ct);
  checkErr('text/plain; application/json', await post(p, valid(), { ct: 'text/plain; application/json' }), 415, MSG.ct);
  checkErr('415 before 400 (non-object body)', await post(p, '[]', { ct: 'text/plain' }), 415, MSG.ct);
  r = await post(p, valid(), { ct: ' \tAPPLICATION/JSON ; charset=x' });
  check('odd media type accepted', r.status, 201);
  check('application/json;charset=utf-8 accepted', (await post(p, valid(), { ct: 'application/json;charset=utf-8' })).status, 201);
  // sizes
  checkErr('415 before 413 (20000 bytes text/plain)', await post(p, 'x'.repeat(20000), { ct: 'text/plain' }), 415, MSG.ct);
  r = await post(p, sizedBody(10000));
  check('10000-byte body not 413', r.status, 201);
  r = await post(p, sizedBody(10001));
  checkErr('10001-byte body', r, 413, 'body too large');
  ok('10001-byte reply fully received without socket error', r.err === null, r.err);
  r = await post(p, 'y'.repeat(1024 * 1024));
  checkErr('1MB body', r, 413, 'body too large');
  ok('1MB reply received without socket error', r.err === null, r.err);
  r = await post(p, sizedBody(10001), { chunked: true });
  checkErr('10001 chunked', r, 413, 'body too large');
  r = await post(p, sizedBody(10000), { chunked: true });
  check('10000 chunked not 413', r.status, 201);
  r = await post(p, 'z'.repeat(1024 * 1024), { chunked: true });
  checkErr('1MB chunked', r, 413, 'body too large');
  ok('1MB chunked reply received without socket error', r.err === null, r.err);
  r = await post(p, 'z'.repeat(1024 * 1024), { ct: 'text/plain' });
  checkErr('1MB text/plain', r, 415, MSG.ct);
  ok('1MB text/plain reply received without socket error', r.err === null, r.err);
  // 400 body
  const badBodies = { empty: '', null: 'null', '[]': '[]', '"x"': '"x"', 1: '1', true: 'true', 'invalid JSON': '{bad', 'BOM + {}': '﻿{}', 'BOM + valid': '﻿' + JSON.stringify(valid()) };
  for (const [n, b] of Object.entries(badBodies)) {
    const res = n === 'empty' ? await request(p, 'POST', '/api/bookings', { headers: { 'Content-Type': 'application/json' }, body: '' })
      : await post(p, b);
    checkErr(`body ${n}`, res, 400, MSG.obj);
  }
  const noBody = await request(p, 'POST', '/api/bookings', { headers: { 'Content-Type': 'application/json', 'Content-Length': '0' } });
  checkErr('no body at all', noBody, 400, MSG.obj);
  // field rules
  checkErr('room aurora', await post(p, valid({ room: 'aurora' })), 400, MSG.room);
  checkErr('room number', await post(p, valid({ room: 1 })), 400, MSG.room);
  checkErr('room missing', await post(p, (({ room, ...x }) => x)(valid())), 400, MSG.room);
  checkErr('title spaces', await post(p, valid({ title: '   ' })), 400, MSG.title);
  checkErr('title 81', await post(p, valid({ title: 'a'.repeat(81) })), 400, MSG.title);
  checkErr('title number', await post(p, valid({ title: 5 })), 400, MSG.title);
  checkErr('title 41 emoji (82 units)', await post(p, valid({ title: '😀'.repeat(41) })), 400, MSG.title);
  r = await post(p, valid({ title: '😀'.repeat(40) }));
  check('title 40 emoji (80 units) accepted', r.status, 201);
  r = await post(p, valid({ title: ` \t${'a'.repeat(80)}\n ` }));
  check('title 80 after trim -> 201', r.status, 201);
  check('title stored trimmed', jbody(r).title, 'a'.repeat(80));
  r = await post(p, valid({ title: ' x ' }));
  check('NBSP trimmed', jbody(r).title, 'x');
  r = await post(p, Buffer.concat([Buffer.from(`{"room":"Aurora","title":"a`), Buffer.from([0xff]), Buffer.from(`b","date":"${freshDate()}","start":"09:00","end":"10:00"}`)]));
  check('invalid UTF-8 -> U+FFFD, accepted', { s: r.status, t: jbody(r).title }, { s: 201, t: 'a�b' });
  for (const dt of [' 2026-11-03', '2026-11-3', '2100-01-01', '1999-12-31', '2001-02-29', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026/01/01', 20261103, '2026-11-03 ', '٢٠٢٦-11-03']) {
    checkErr(`date ${JSON.stringify(dt)}`, await post(p, valid({ date: dt })), 400, MSG.date);
  }
  for (const dt of ['2004-02-29', '2000-01-01', '2099-12-31', '2000-02-29', '2096-02-29']) {
    check(`date ${dt} ok`, (await post(p, valid({ date: dt, room: 'Cosmos' }))).status, 201);
  }
  checkErr('date 2100-02-29', await post(p, valid({ date: '2100-02-29' })), 400, MSG.date);
  for (const t of ['9:00', '24:00', '23:60', '09:0', '9:00 ', 900, '']) {
    checkErr(`start ${JSON.stringify(t)}`, await post(p, valid({ start: t })), 400, MSG.start);
  }
  for (const t of ['9:00', '24:00', '23:60', null]) {
    checkErr(`end ${JSON.stringify(t)}`, await post(p, valid({ end: t })), 400, MSG.end);
  }
  checkErr('end == start', await post(p, valid({ start: '09:00', end: '09:00' })), 400, MSG.order);
  checkErr('end < start', await post(p, valid({ start: '10:00', end: '09:00' })), 400, MSG.order);
  check('00:00-23:59 ok', (await post(p, valid({ start: '00:00', end: '23:59', room: 'Borealis' }))).status, 201);
  // order of rules
  checkErr('bad room + bad title -> room', await post(p, valid({ room: 'x', title: '' })), 400, MSG.room);
  checkErr('bad title + bad date -> title', await post(p, valid({ title: '', date: 'x' })), 400, MSG.title);
  checkErr('bad date + bad start -> date', await post(p, valid({ date: 'x', start: 'x' })), 400, MSG.date);
  checkErr('bad start + bad end -> start', await post(p, valid({ start: 'x', end: 'x' })), 400, MSG.start);
  checkErr('bad end + would-be order -> end', await post(p, valid({ start: '10:00', end: '9:00' })), 400, MSG.end);
  checkErr('non-object beats field errors', await post(p, '[{"room":"x"}]'), 400, MSG.obj);
  // extras
  r = await post(p, { ...valid(), id: 999, extra: 1, nested: { a: 1 } });
  check('extra keys ignored: 201', r.status, 201);
  check('reply keys exactly id,room,title,date,start,end', Object.keys(jbody(r)).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
  ok('id not taken from body', jbody(r).id !== 999);
  check('POST reply content-type', r.headers['content-type'], JSON_CT);
  check('POST /api/bookings?x=1 works', (await request(p, 'POST', '/api/bookings?x=1', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid()) })).status, 201);
  check('final GET /api/rooms works', (await get(p, '/api/rooms')).status, 200);
  await stopServer(s, 'post rules server');
}

async function conflictAndListTests() {
  console.log('\n== 409, list, delete ==');
  const d = newDir('list');
  const file = path.join(d, 'b.json');
  let s = await startServer({ DATA_FILE: file });
  let p = s.port;
  const D = '2026-11-03';
  const mk = (room, date, start, end, title = 'T') => ({ room, title, date, start, end });
  check('Aurora 09-10', (await post(p, mk('Aurora', D, '09:00', '10:00'))).status, 201);
  check('Aurora 11-12', (await post(p, mk('Aurora', D, '11:00', '12:00'))).status, 201);
  checkErr('Aurora 09:30-11:30', await post(p, mk('Aurora', D, '09:30', '11:30')), 409, 'room is already booked from 09:00 to 10:00');
  check('409 content-type', (await post(p, mk('Aurora', D, '09:30', '11:30'))).headers['content-type'], JSON_CT);
  check('touching 10-11 ok', (await post(p, mk('Aurora', D, '10:00', '11:00'))).status, 201);
  check('other room same time ok', (await post(p, mk('Borealis', D, '09:00', '10:00'))).status, 201);
  checkErr('inside existing', await post(p, mk('Aurora', D, '09:10', '09:20')), 409, 'room is already booked from 09:00 to 10:00');
  checkErr('enclosing 08-13 reports earliest', await post(p, mk('Aurora', D, '08:00', '13:00')), 409, 'room is already booked from 09:00 to 10:00');
  check('same room other date ok', (await post(p, mk('Aurora', '2026-11-04', '09:00', '10:00'))).status, 201);
  checkErr('400 beats 409', await post(p, mk('Aurora', D, '09:30', '9:30')), 400, MSG.end);
  await stopServer(s);

  // sorting on a fresh data file
  const file2 = path.join(d, 'sort.json');
  s = await startServer({ DATA_FILE: file2 });
  p = s.port;
  const D1 = '2026-11-03'; const D2 = '2026-11-04';
  const ins = [['Cosmos', D2, '08:00', '09:00'], ['Aurora', D2, '08:00', '09:00'], ['Borealis', D2, '07:00', '08:00'], ['Aurora', D1, '15:00', '16:00'], ['Borealis', D2, '08:00', '09:00']];
  for (const [i, [room, date, start, end]] of ins.entries()) await post(p, mk(room, date, start, end, `t${i}`));
  const brief = (r) => jbody(r).bookings?.map((b) => `${b.date} ${b.start} ${b.room}`);
  const sortedAll = [`${D1} 15:00 Aurora`, `${D2} 07:00 Borealis`, `${D2} 08:00 Aurora`, `${D2} 08:00 Borealis`, `${D2} 08:00 Cosmos`];
  check('GET /api/bookings sorted date,start,room', brief(await get(p, '/api/bookings')), sortedAll);
  check('?date=D2 filter', brief(await get(p, `/api/bookings?date=${D2}`)), sortedAll.slice(1));
  check('?date=D1 filter', brief(await get(p, `/api/bookings?date=${D1}`)), sortedAll.slice(0, 1));
  check('?date=other date empty', jbody(await get(p, '/api/bookings?date=2026-12-01')), { bookings: [] });
  checkErr('?date (no =)', await get(p, '/api/bookings?date'), 400, MSG.date);
  checkErr('?date=', await get(p, '/api/bookings?date='), 400, MSG.date);
  checkErr('?date=bad', await get(p, '/api/bookings?date=bad'), 400, MSG.date);
  checkErr('?date=2100-01-01', await get(p, '/api/bookings?date=2100-01-01'), 400, MSG.date);
  check('?date=D2&date=bad uses first', brief(await get(p, `/api/bookings?date=${D2}&date=bad`)), sortedAll.slice(1));
  checkErr('?date=bad&date=D2 uses first', await get(p, `/api/bookings?date=bad&date=${D2}`), 400, MSG.date);
  check('?x=1 ignored', brief(await get(p, '/api/bookings?x=1')), sortedAll);
  check('?date=2026%2D11%2D03 decoded', brief(await get(p, '/api/bookings?date=2026%2D11%2D03')), sortedAll.slice(0, 1));
  checkErr('?x=1&date=bad', await get(p, '/api/bookings?x=1&date=bad'), 400, MSG.date);
  check('GET list content-type', (await get(p, '/api/bookings')).headers['content-type'], JSON_CT);
  const list = jbody(await get(p, '/api/bookings')).bookings;
  check('listed keys', Object.keys(list[0]).sort(), ['date', 'end', 'id', 'room', 'start', 'title']);
  // delete
  for (const id of ['01', '0', '1e0', '+1', '-1', '9007199254740993', 'abc', '%31', '1.0', '%201', '1%20','١']) {
    checkErr(`DELETE /api/bookings/${id}`, await del(p, `/api/bookings/${id}`), 404, 'booking not found');
  }
  check('nothing deleted by bad ids', jbody(await get(p, '/api/bookings')).bookings.length, 5);
  const target = list[0];
  const dr = await del(p, `/api/bookings/${target.id}`);
  check('DELETE existing -> 204', dr.status, 204);
  check('204 empty body', dr.body.length, 0);
  check('204 no content-type', dr.headers['content-type'], undefined);
  checkErr('DELETE again', await del(p, `/api/bookings/${target.id}`), 404, 'booking not found');
  check('list after delete', jbody(await get(p, '/api/bookings')).bookings.length, 4);
  check('DELETE /api/bookings/1?x=1 treated as id "1?x=1"? (path is up to ?)', (await del(p, `/api/bookings/${list[1].id}?x=1`)).status, 204);
  // ids never reused
  const maxId = Math.max(...jbody(await get(p, '/api/bookings')).bookings.map((b) => b.id));
  check('delete highest id', (await del(p, `/api/bookings/${maxId}`)).status, 204);
  const np = await post(p, mk('Cosmos', '2026-12-01', '09:00', '10:00'));
  ok(`next id after deleting highest is new (${maxId} not reused)`, jbody(np).id > maxId, JSON.stringify(jbody(np)));
  const snapshot = jbody(await get(p, '/api/bookings')).bookings;
  const nextExpected = jbody(np).id + 1;
  await stopServer(s, 'list server');
  s = await startServer({ DATA_FILE: file2 });
  p = s.port;
  check('restart preserves bookings', jbody(await get(p, '/api/bookings')).bookings, snapshot);
  check('restart preserves next id', jbody(await post(p, mk('Cosmos', '2026-12-02', '09:00', '10:00'))).id, nextExpected);
  // delete everything then restart: nextId still preserved
  for (const b of jbody(await get(p, '/api/bookings')).bookings) await del(p, `/api/bookings/${b.id}`);
  await stopServer(s);
  s = await startServer({ DATA_FILE: file2 });
  p = s.port;
  check('restart after deleting all: empty', jbody(await get(p, '/api/bookings')), { bookings: [] });
  check('restart after deleting all: id keeps counting', jbody(await post(p, mk('Cosmos', '2026-12-02', '09:00', '10:00'))).id, nextExpected + 1);
  await stopServer(s, 'restart server');
}

async function saveFailureTests() {
  console.log('\n== Save failure ==');
  const d = newDir('savefail');
  const file = path.join(d, 'b.json');
  const s = await startServer({ DATA_FILE: file });
  const p = s.port;
  const mk = (n) => ({ room: 'Aurora', title: `t${n}`, date: '2026-11-03', start: `${String(n).padStart(2, '0')}:00`, end: `${String(n).padStart(2, '0')}:30` });
  check('first booking id 1', jbody(await post(p, mk(8))).id, 1);
  fs.rmSync(file); fs.mkdirSync(file);
  checkErr('POST with unwritable data file', await post(p, mk(9)), 500, 'internal error');
  check('failed POST left list unchanged', jbody(await get(p, '/api/bookings')).bookings.length, 1);
  fs.rmdirSync(file);
  const r = await post(p, mk(9));
  check('POST after recovery -> 201 with id 2 (nextId unchanged)', { s: r.status, id: jbody(r).id }, { s: 201, id: 2 });
  fs.rmSync(file); fs.mkdirSync(file);
  checkErr('DELETE with unwritable data file', await del(p, '/api/bookings/1'), 500, 'internal error');
  check('failed DELETE: booking still listed', jbody(await get(p, '/api/bookings')).bookings.map((b) => b.id), [1, 2]);
  checkErr('POST conflict still 409 while unwritable (validation first)', await post(p, mk(8)), 409, 'room is already booked from 08:00 to 08:30');
  fs.rmdirSync(file);
  check('DELETE after recovery -> 204', (await del(p, '/api/bookings/1')).status, 204);
  check('file content after recovery', JSON.parse(fs.readFileSync(file, 'utf8')).nextId, 3);
  check('server alive', (await get(p, '/api/rooms')).status, 200);
  await stopServer(s, 'save-failure server (after 500s)');
}

async function concurrencyTests() {
  console.log('\n== Concurrency ==');
  const d = newDir('conc');
  const s = await startServer({ DATA_FILE: path.join(d, 'b.json') });
  const p = s.port;
  const same = { room: 'Cosmos', title: 'race', date: '2026-11-05', start: '09:00', end: '10:00' };
  const rs = await Promise.all(Array.from({ length: 10 }, () => post(p, same)));
  const counts = rs.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  check('10 overlapping -> one 201, nine 409', counts, { 201: 1, 409: 9 });
  const rs2 = await Promise.all(Array.from({ length: 10 }, (_, i) => post(p, { ...same, room: 'Aurora', start: `${String(i).padStart(2, '0')}:00`, end: `${String(i).padStart(2, '0')}:30` })));
  check('10 non-overlapping all 201', rs2.map((r) => r.status), Array(10).fill(201));
  const ids = rs2.map((r) => jbody(r).id);
  check('10 distinct ids', new Set(ids).size, 10);
  const all = jbody(await get(p, '/api/bookings')).bookings;
  check('list has 11 bookings, ids distinct', new Set(all.map((b) => b.id)).size, 11);
  const mixed = await Promise.all([post(p, { ...same, room: 'Borealis' }), del(p, `/api/bookings/${ids[0]}`), get(p, '/api/bookings'), post(p, { ...same, room: 'Borealis' })]);
  check('mixed concurrent statuses', mixed.map((r) => r.status).sort(), [200, 201, 204, 409]);
  check('server alive after concurrency', (await get(p, '/api/rooms')).status, 200);
  await stopServer(s, 'concurrency server');
}

async function main() {
  try {
    await startupTests();
    await dataFileTests();
    await routingTests();
    await postRuleTests();
    await conflictAndListTests();
    await saveFailureTests();
    await concurrencyTests();
  } catch (e) {
    fail++; failures.push('SCRIPT ERROR');
    console.log(`FAIL script error: ${e.stack}`);
  } finally {
    for (const pr of spawned) if (pr.exitCode === null) pr.kill('SIGKILL');
  }
  console.log(`\nTOTAL: ${pass} passed, ${fail} failed (${pass + fail} checks)`);
  if (fail) console.log('FAILED: ' + failures.join(' | '));
  process.exit(fail ? 1 : 0);
}
main();
