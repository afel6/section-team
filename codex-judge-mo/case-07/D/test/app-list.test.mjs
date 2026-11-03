import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, loadReady, booking, plain } from './fake-dom.mjs';

const NO_REPLY = 'Could not reach the server.';
const FAILED = 'Request failed.';

test('load order: rooms then list fetch start synchronously', () => {
  const app = loadApp();
  assert.equal(app.fetchCalls.length, 2);
  assert.equal(app.fetchCalls[0].url, '/api/rooms');
  assert.equal(app.fetchCalls[1].url, '/api/bookings');
  for (const call of app.fetchCalls) {
    assert.ok(call.options === undefined || (call.options.method ?? 'GET') === 'GET');
  }
});

test('rooms: filled in order with value and text', async () => {
  const app = loadApp();
  app.fetchCalls[0].respond(200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  await app.flush();
  assert.equal(app.room.childNodes.length, 3);
  ['Aurora', 'Borealis', 'Cosmos'].forEach((name, i) => {
    const option = app.room.childNodes[i];
    assert.equal(option.tagName, 'OPTION');
    assert.equal(option.value, name);
    assert.equal(option.textContent, name);
  });
});

test('rooms: error status shows the reply message, select stays empty', async () => {
  const app = loadApp();
  app.fetchCalls[0].respond(500, { error: 'internal error' });
  await app.flush();
  assert.equal(app.error.textContent, 'internal error');
  assert.equal(app.room.childNodes.length, 0);
});

test('rooms: error body without string error gives fallback', async () => {
  const app = loadApp();
  app.fetchCalls[0].respond(500, { error: 5 });
  await app.flush();
  assert.equal(app.error.textContent, FAILED);
  assert.equal(app.room.childNodes.length, 0);
});

test('rooms: rejected fetch shows no-reply message', async () => {
  const app = loadApp();
  app.fetchCalls[0].fail();
  await app.flush();
  assert.equal(app.error.textContent, NO_REPLY);
  assert.equal(app.room.childNodes.length, 0);
});

test('rooms: 200 with invalid JSON counts as no reply', async () => {
  const app = loadApp();
  app.fetchCalls[0].respond(200, 'not json{');
  await app.flush();
  assert.equal(app.error.textContent, NO_REPLY);
  assert.equal(app.room.childNodes.length, 0);
});

test('list render: text node plus Cancel button, plain text, reply order', async () => {
  const app = loadApp();
  app.error.textContent = 'keep';
  app.fetchCalls[1].respond(200, {
    bookings: [
      booking(2, { title: '<b>x</b>', date: '2026-11-03', start: '09:00', end: '10:00' }),
      booking(1, { room: 'Cosmos', title: 'Early', date: '2026-01-01', start: '08:00', end: '08:30' }),
    ],
  });
  await app.flush();
  assert.deepEqual(app.listTexts(), [
    [2, 3, '2026-11-03 09:00-10:00 Aurora: <b>x</b>', 'BUTTON', 'button', 'Cancel'],
    [2, 3, '2026-01-01 08:00-08:30 Cosmos: Early', 'BUTTON', 'button', 'Cancel'],
  ]);
  assert.equal(app.error.textContent, 'keep');
});

test('plain text: only a text node and the button are children of li', async () => {
  const app = loadApp();
  app.fetchCalls[1].respond(200, { bookings: [booking(1, { title: '<b>x</b>' })] });
  await app.flush();
  const li = app.list.childNodes[0];
  const elementChildren = li.childNodes.filter((n) => n.nodeType !== 3);
  assert.equal(elementChildren.length, 1);
  assert.equal(elementChildren[0].tagName, 'BUTTON');
  assert.ok(li.childNodes[0].data.endsWith(': <b>x</b>'));
});

test('list render: empty reply shows No bookings.', async () => {
  const app = await loadReady([booking(1)]);
  app.filter.value = '2026-12-01';
  app.filter.dispatch('change');
  app.fetchCalls[2].respond(200, { bookings: [] });
  await app.flush();
  assert.equal(app.list.childNodes.length, 1);
  assert.deepEqual(app.listTexts(), [[1, 3, 'No bookings.', undefined, undefined, undefined]]);
});

test('list errors: error status keeps the list', async () => {
  const app = await loadReady([booking(1)]);
  const before = app.listTexts();
  app.filter.value = 'bad';
  app.filter.dispatch('change');
  app.fetchCalls[2].respond(400, { error: 'date must be a valid YYYY-MM-DD date' });
  await app.flush();
  assert.equal(app.error.textContent, 'date must be a valid YYYY-MM-DD date');
  assert.deepEqual(app.listTexts(), before);
});

test('list errors: rejected fetch keeps the list', async () => {
  const app = await loadReady([booking(1)]);
  const before = app.listTexts();
  app.filter.dispatch('change');
  app.fetchCalls[2].fail();
  await app.flush();
  assert.equal(app.error.textContent, NO_REPLY);
  assert.deepEqual(app.listTexts(), before);
});

test('list errors: non-object error body gives fallback', async () => {
  const app = await loadReady([booking(1)]);
  const before = app.listTexts();
  app.filter.dispatch('change');
  app.fetchCalls[2].respond(500, []);
  await app.flush();
  assert.equal(app.error.textContent, FAILED);
  assert.deepEqual(app.listTexts(), before);
});

test('list errors: 500 with non-JSON body counts as no reply', async () => {
  const app = await loadReady([booking(1)]);
  const before = app.listTexts();
  app.filter.dispatch('change');
  app.fetchCalls[2].respond(500, 'oops');
  await app.flush();
  assert.equal(app.error.textContent, NO_REPLY);
  assert.deepEqual(app.listTexts(), before);
});

async function overlapping() {
  const app = loadApp();
  app.fetchCalls[0].respond(200, { rooms: ['Aurora'] });
  app.filter.value = '2026-11-03';
  app.filter.dispatch('change');
  assert.equal(app.fetchCalls.length, 3);
  return { app, earlier: app.fetchCalls[1], later: app.fetchCalls[2] };
}

const reply = (id, title) => ({ bookings: [booking(id, { title })] });
const textOfFirst = (app) => app.listTexts()[0][2];

test('stale list: later responds first, earlier result is ignored', async () => {
  const { app, earlier, later } = await overlapping();
  later.respond(200, reply(1, 'A'));
  await app.flush();
  earlier.respond(200, reply(2, 'B'));
  await app.flush();
  assert.equal(app.listTexts().length, 1);
  assert.equal(textOfFirst(app), '2026-11-03 09:00-10:00 Aurora: A');
});

test('stale list: earlier failing after later succeeded changes nothing', async () => {
  const { app, earlier, later } = await overlapping();
  later.respond(200, reply(1, 'A'));
  await app.flush();
  earlier.fail();
  await app.flush();
  assert.equal(app.error.textContent, '');
  assert.equal(textOfFirst(app), '2026-11-03 09:00-10:00 Aurora: A');
});

test('stale list: earlier error status after later succeeded changes nothing', async () => {
  const { app, earlier, later } = await overlapping();
  later.respond(200, reply(1, 'A'));
  await app.flush();
  earlier.respond(500, { error: 'boom' });
  await app.flush();
  assert.equal(app.error.textContent, '');
  assert.equal(textOfFirst(app), '2026-11-03 09:00-10:00 Aurora: A');
});

test('stale list: earlier error arriving before the later reply is ignored too', async () => {
  const { app, earlier, later } = await overlapping();
  earlier.respond(500, { error: 'boom' });
  await app.flush();
  assert.equal(app.error.textContent, '');
  later.respond(200, reply(1, 'A'));
  await app.flush();
  assert.equal(app.error.textContent, '');
  assert.equal(textOfFirst(app), '2026-11-03 09:00-10:00 Aurora: A');
});

test('stale list: earlier first then later gives the later result', async () => {
  const { app, earlier, later } = await overlapping();
  earlier.respond(200, reply(2, 'B'));
  await app.flush();
  later.respond(200, reply(1, 'A'));
  await app.flush();
  assert.equal(textOfFirst(app), '2026-11-03 09:00-10:00 Aurora: A');
});

test('filter url: change fetches with the date', () => {
  const app = loadApp();
  app.filter.value = '2026-11-03';
  app.filter.dispatch('change');
  assert.equal(app.fetchCalls.length, 3);
  assert.equal(app.fetchCalls[2].url, '/api/bookings?date=2026-11-03');
});

test('filter url: input event does nothing', () => {
  const app = loadApp();
  app.filter.value = '2026-11-03';
  app.filter.dispatch('input');
  assert.equal(app.fetchCalls.length, 2);
});

test('filter url: empty value fetches without query', () => {
  const app = loadApp();
  app.filter.value = '';
  app.filter.dispatch('change');
  assert.equal(app.fetchCalls[2].url, '/api/bookings');
});

test('filter url: value is passed unchanged', () => {
  const app = loadApp();
  app.filter.value = 'a b&c';
  app.filter.dispatch('change');
  assert.equal(app.fetchCalls[2].url, '/api/bookings?date=a b&c');
});

test('show all: clears filter and fetches exactly once', () => {
  const app = loadApp();
  app.filter.value = '2026-11-03';
  app.showAll.dispatch('click');
  assert.equal(app.filter.value, '');
  assert.equal(app.fetchCalls.length, 3);
  assert.equal(app.fetchCalls[2].url, '/api/bookings');
  assert.equal(plain(app.fetchCalls[2].options ?? null)?.method ?? 'GET', 'GET');
});
