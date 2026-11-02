// Data file behaviour: rejection, loading, path resolution, write discipline, persistence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, JSON_HEADERS, makeTmp, startServer, stopServer, runToExit, request, post, valid, assertError,
} from './helpers/server-harness.mjs';

/** Asserts the server refused the data file `name`: exit 1, empty stdout, the exact one-line message. */
function assertRejected(res, name, label) {
  assert.equal(res.code, 1, `${label}: exit code`);
  assert.equal(res.stdout, '', `${label}: stdout`);
  assert.equal(res.stderr, `cannot read data file ${name}\n`, `${label}: stderr`);
}

const ROOT_BOOKINGS = path.join(ROOT, 'bookings.json');
const rootHadBookings = fs.existsSync(ROOT_BOOKINGS);

const B = { id: 1, room: 'Aurora', title: 'T', date: '2026-11-03', start: '10:00', end: '11:00' };
const file3 = (...bookings) => JSON.stringify({ nextId: 3, bookings });
const empty = (nextId = 1) => JSON.stringify({ nextId, bookings: [] });

const REJECTED = [
  ['empty', ''], ['space', ' '], ['newline', '\n'], ['not json', 'not json'], ['null', 'null'],
  ['array', '[]'], ['string', '"x"'], ['number', '1'], ['true', 'true'], ['empty object', '{}'],
  ['no bookings key', '{"nextId":1}'], ['no nextId', '{"bookings":[]}'],
  ['nextId 0', '{"nextId":0,"bookings":[]}'], ['nextId -1', '{"nextId":-1,"bookings":[]}'],
  ['nextId 1.5', '{"nextId":1.5,"bookings":[]}'], ['nextId string', '{"nextId":"2","bookings":[]}'],
  ['nextId null', '{"nextId":null,"bookings":[]}'], ['bookings object', '{"nextId":2,"bookings":{}}'],
  ['bookings null', '{"nextId":2,"bookings":null}'],
  ['duplicate ids', file3(B, { ...B, room: 'Borealis' })],
  ['id equals nextId', file3({ ...B, id: 3 })],
  ['id above nextId', file3({ ...B, id: 4 })],
  ['id 0', file3({ ...B, id: 0 })],
  ['id string', file3({ ...B, id: '1' })],
  ['id 1.5', file3({ ...B, id: 1.5 })],
  ['extra booking key', file3({ ...B, x: 1 })],
  ['missing end', file3((({ end, ...rest }) => rest)(B))],
  ['title number', file3({ ...B, title: 5 })],
  ['untrimmed title', file3({ ...B, title: ' T' })],
  ['empty title', file3({ ...B, title: '' })],
  ['bad date', file3({ ...B, date: '2026-02-30' })],
  ['bad start', file3({ ...B, start: '24:00' })],
  ['end before start', file3({ ...B, start: '11:00', end: '10:00' })],
  ['lowercase room', file3({ ...B, room: 'aurora' })],
  ['null booking', file3(null)],
  ['array booking', file3([])],
  ['overlapping bookings', file3(B, { ...B, id: 2, start: '10:30', end: '11:30' })],
];

test('rejected data files: exact message, exit 1, empty stdout', async (t) => {
  await Promise.all(REJECTED.map(async ([label, content]) => {
    const dir = makeTmp(t);
    const name = path.join(dir, 'bad.json');
    fs.writeFileSync(name, content);
    const res = await runToExit(t, dir, { env: { DATA_FILE: name } });
    assertRejected(res, name, label);
  }));
});

// Strict reading (decisions.md): the server writes exactly {nextId, bookings}, so more keys are not its layout.
test('rejected data file: extra top-level key', async (t) => {
  const dir = makeTmp(t);
  const name = path.join(dir, 'extra.json');
  fs.writeFileSync(name, '{"nextId":1,"bookings":[],"extra":1}');
  const res = await runToExit(t, dir, { env: { DATA_FILE: name } });
  assertRejected(res, name, 'extra top-level key');
});

test('rejected paths: BOM file, directory, path through a file', async (t) => {
  const dir = makeTmp(t);
  const bom = path.join(dir, 'bom.json');
  fs.writeFileSync(bom, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(empty())]));
  const plain = path.join(dir, 'plain');
  fs.writeFileSync(plain, empty());
  const cases = [['BOM', bom], ['directory', dir], ['through a file', path.join(plain, 'data.json')]];
  await Promise.all(cases.map(async ([label, name]) => {
    const res = await runToExit(t, dir, { env: { DATA_FILE: name } });
    assertRejected(res, name, label);
  }));
});

test('the message echoes DATA_FILE as given', async (t) => {
  const cases = [
    ['relative with dots', 'bad.json', 'sub/../bad.json'],
    ['non-ASCII', 'dätä.json', 'dätä.json'],
    ['unset', 'bookings.json', undefined],
    ['empty', 'bookings.json', ''],
  ];
  await Promise.all(cases.map(async ([label, file, given]) => {
    const dir = makeTmp(t);
    fs.writeFileSync(path.join(dir, file), 'not json');
    const res = await runToExit(t, dir, { env: { DATA_FILE: given }, cwd: dir });
    const shown = given === undefined || given === '' ? 'bookings.json' : given;
    assertRejected(res, shown, label);
  }));
});

test('valid files load', async (t) => {
  const dir = makeTmp(t);
  const emptyFile = path.join(dir, 'a.json');
  fs.writeFileSync(emptyFile, empty());
  const emptyServer = await startServer(t, dir, { env: { DATA_FILE: emptyFile } });
  assert.deepEqual((await request(emptyServer.port, 'GET', '/api/bookings')).json, { bookings: [] });

  const b2 = { id: 2, room: 'Cosmos', title: 'Two', date: '2026-11-04', start: '09:00', end: '10:00' };
  const b5 = { id: 5, room: 'Aurora', title: 'Five', date: '2026-11-03', start: '09:00', end: '10:00' };
  const seededFile = path.join(dir, 'b.json');
  fs.writeFileSync(seededFile, JSON.stringify({ nextId: 7, bookings: [b2, b5] }));
  const seededServer = await startServer(t, dir, { env: { DATA_FILE: seededFile } });
  assert.deepEqual((await request(seededServer.port, 'GET', '/api/bookings')).json, { bookings: [b5, b2] });
  const created = await post(seededServer.port, valid({ room: 'Borealis' }));
  assert.equal(created.status, 201);
  assert.equal(created.json.id, 7);
});

test('missing folder: starts empty, saving fails with 500 and creates nothing', async (t) => {
  const dir = makeTmp(t);
  const f = path.join(dir, 'a', 'b', 'data.json');
  const srv = await startServer(t, dir, { env: { DATA_FILE: f } });
  assert.deepEqual((await request(srv.port, 'GET', '/api/bookings')).json, { bookings: [] });
  assertError(await post(srv.port, valid()), 500, 'internal error');
  assert.equal(fs.existsSync(path.join(dir, 'a')), false);
  assert.equal((await request(srv.port, 'GET', '/api/bookings')).status, 200);
});

test('relative paths resolve against the cwd', async (t) => {
  const dir = makeTmp(t);
  const work = path.join(dir, 'work');
  fs.mkdirSync(path.join(work, 'rel'), { recursive: true });
  const rel = path.join(work, 'rel', 'data.json');
  fs.writeFileSync(rel, JSON.stringify({ nextId: 2, bookings: [B] }));
  const a = await startServer(t, dir, { env: { DATA_FILE: 'rel/data.json' }, cwd: work });
  assert.deepEqual((await request(a.port, 'GET', '/api/bookings')).json, { bookings: [B] });
  assert.equal((await post(a.port, valid({ room: 'Cosmos' }))).status, 201);
  assert.equal(JSON.parse(fs.readFileSync(rel, 'utf8')).bookings.length, 2);

  for (const given of [undefined, '']) {
    const w2 = path.join(dir, `w2-${given === undefined ? 'unset' : 'empty'}`);
    fs.mkdirSync(w2);
    fs.writeFileSync(path.join(w2, 'bookings.json'), JSON.stringify({ nextId: 2, bookings: [B] }));
    const s = await startServer(t, dir, { env: { DATA_FILE: given }, cwd: w2 });
    const res = await request(s.port, 'GET', '/api/bookings');
    assert.deepEqual(res.json, { bookings: [B] }, `DATA_FILE=${JSON.stringify(given)}`);
  }
  assert.equal(fs.existsSync(ROOT_BOOKINGS), rootHadBookings, 'no bookings.json next to server.mjs');
});

async function readOnlySession(port) {
  const big = 'a'.repeat(10001);
  const steps = [
    ['GET', '/api/rooms', 200], ['GET', '/api/bookings', 200],
    ['GET', '/api/bookings?date=2026-11-03', 200], ['GET', '/api/bookings?date=bad', 400],
    ['DELETE', '/api/bookings/99', 404], ['DELETE', '/api/bookings/abc', 404],
    ['PUT', '/api/rooms', 405], ['GET', '/nope', 404], ['GET', '/', 200], ['GET', '/app.js', 200],
  ];
  for (const [m, p, status] of steps) {
    assert.equal((await request(port, m, p)).status, status, `${m} ${p}`);
  }
  assert.equal((await post(port, valid(), { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await post(port, big, JSON_HEADERS)).status, 413);
  assert.equal((await post(port, valid({ room: 'x' }))).status, 400);
  assert.equal((await post(port, valid({ title: 'T' }))).status, 409);
}

test('the data file is untouched by anything but a successful POST or DELETE', async (t) => {
  const dir = makeTmp(t);
  const f = path.join(dir, 'data.json');
  fs.writeFileSync(f, JSON.stringify({ nextId: 2, bookings: [B] }));
  const past = new Date('2001-01-01T00:00:00Z');
  fs.utimesSync(f, past, past);
  const bytes = fs.readFileSync(f);
  const mtime = fs.statSync(f).mtimeMs;
  const srv = await startServer(t, dir, { env: { DATA_FILE: f } });
  await readOnlySession(srv.port);
  assert.deepEqual(fs.readFileSync(f), bytes);
  assert.equal(fs.statSync(f).mtimeMs, mtime);
  assert.deepEqual(fs.readdirSync(dir), ['data.json']);
  assert.equal((await post(srv.port, valid({ room: 'Cosmos' }))).status, 201);
  assert.notDeepEqual(fs.readFileSync(f), bytes);
});

const restart = async (t, dir, child) => {
  await stopServer(child);
  return startServer(t, dir);
};

test('persistence and ids survive restarts and are never reused', async (t) => {
  const dir = makeTmp(t);
  let srv = await startServer(t, dir);
  const one = await post(srv.port, valid());
  const two = await post(srv.port, valid({ start: '12:00', end: '13:00' }));
  assert.deepEqual([one.json.id, two.json.id], [1, 2]);
  assert.equal((await request(srv.port, 'DELETE', '/api/bookings/2')).status, 204);
  const before = (await request(srv.port, 'GET', '/api/bookings')).json;

  srv = await restart(t, dir, srv.child);
  assert.deepEqual((await request(srv.port, 'GET', '/api/bookings')).json, before);
  const three = await post(srv.port, valid({ start: '14:00', end: '15:00' }));
  assert.equal(three.json.id, 3);
  for (const id of [1, 3]) {
    assert.equal((await request(srv.port, 'DELETE', `/api/bookings/${id}`)).status, 204);
  }

  srv = await restart(t, dir, srv.child);
  assert.deepEqual((await request(srv.port, 'GET', '/api/bookings')).json, { bookings: [] });
  assert.equal((await post(srv.port, valid())).json.id, 4);
});
