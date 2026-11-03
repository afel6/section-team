import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReady, booking, plain } from './fake-dom.mjs';

const NO_REPLY = 'Could not reach the server.';
const FAILED = 'Request failed.';

function fillForm(app) {
  app.room.value = 'Cosmos';
  app.title.value = '  Plan  ';
  app.date.value = '2026-11-03';
  app.start.value = '09:00';
  app.end.value = '10:00';
}

// Ready app with a filled form and one submit in flight (call index 2).
async function submitted() {
  const app = await loadReady();
  fillForm(app);
  app.error.textContent = 'old';
  const event = app.form.dispatch('submit');
  return { app, event, call: app.fetchCalls[2] };
}

test('submit: prevents default, disables Book, posts exact request', async () => {
  const { app, event, call } = await submitted();
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.book.disabled, true);
  assert.equal(app.fetchCalls.length, 3);
  assert.equal(call.url, '/api/bookings');
  assert.equal(call.options.method, 'POST');
  assert.deepEqual(plain(call.options.headers), { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(call.options.body), {
    room: 'Cosmos', title: '  Plan  ', date: '2026-11-03', start: '09:00', end: '10:00',
  });
  assert.deepEqual(Object.keys(JSON.parse(call.options.body)).sort(),
    ['date', 'end', 'room', 'start', 'title']);
});

test('submit: second submit while disabled sends nothing', async () => {
  const { app } = await submitted();
  const event = app.form.dispatch('submit');
  assert.equal(event.defaultPrevented, true);
  assert.equal(app.fetchCalls.length, 3);
});

test('submit: 201 re-enables, clears title only, clears error, refetches list', async () => {
  const { app, call } = await submitted();
  call.respond(201, booking(9));
  await app.flush();
  assert.equal(app.book.disabled, false);
  assert.equal(app.title.value, '');
  assert.equal(app.room.value, 'Cosmos');
  assert.equal(app.date.value, '2026-11-03');
  assert.equal(app.start.value, '09:00');
  assert.equal(app.end.value, '10:00');
  assert.equal(app.error.textContent, '');
  assert.equal(app.fetchCalls.length, 4);
  assert.equal(app.fetchCalls[3].url, '/api/bookings');
  assert.equal(app.fetchCalls[3].bookDisabledAtCall, false);
});

test('submit: 201 refetch keeps the filter date', async () => {
  const { app, call } = await submitted();
  app.filter.value = '2026-11-03';
  call.respond(201, booking(9));
  await app.flush();
  assert.equal(app.fetchCalls[3].url, '/api/bookings?date=2026-11-03');
});

test('submit: 409 shows message, keeps form, no list fetch', async () => {
  const { app, call } = await submitted();
  call.respond(409, { error: 'room is already booked from 09:00 to 10:00' });
  await app.flush();
  assert.equal(app.error.textContent, 'room is already booked from 09:00 to 10:00');
  assert.equal(app.book.disabled, false);
  assert.equal(app.title.value, '  Plan  ');
  assert.equal(app.fetchCalls.length, 3);
});

test('submit: rejected fetch shows no-reply message', async () => {
  const { app, call } = await submitted();
  call.fail();
  await app.flush();
  assert.equal(app.error.textContent, NO_REPLY);
  assert.equal(app.book.disabled, false);
  assert.equal(app.title.value, '  Plan  ');
  assert.equal(app.fetchCalls.length, 3);
});

test('submit: 500 with non-JSON body counts as no reply', async () => {
  const { app, call } = await submitted();
  call.respond(500, 'oops');
  await app.flush();
  assert.equal(app.error.textContent, NO_REPLY);
  assert.equal(app.book.disabled, false);
  assert.equal(app.title.value, '  Plan  ');
  assert.equal(app.fetchCalls.length, 3);
});

test('submit: 400 without string error gives fallback', async () => {
  const { app, call } = await submitted();
  call.respond(400, { message: 'x' });
  await app.flush();
  assert.equal(app.error.textContent, FAILED);
  assert.equal(app.book.disabled, false);
  assert.equal(app.fetchCalls.length, 3);
});

test('submit: empty fields are sent as empty strings', async () => {
  const app = await loadReady([], []);
  app.form.dispatch('submit');
  assert.equal(app.fetchCalls.length, 3);
  assert.deepEqual(JSON.parse(app.fetchCalls[2].options.body),
    { room: '', title: '', date: '', start: '', end: '' });
});

async function withCancel() {
  const app = await loadReady([booking(7)]);
  app.error.textContent = 'old';
  const button = app.list.childNodes[0].childNodes[1];
  button.dispatch('click');
  return { app, button, call: app.fetchCalls[2] };
}

test('cancel: disables button and sends DELETE', async () => {
  const { app, button, call } = await withCancel();
  assert.equal(button.disabled, true);
  assert.equal(app.fetchCalls.length, 3);
  assert.equal(call.url, '/api/bookings/7');
  assert.equal(call.options.method, 'DELETE');
});

test('cancel: 204 re-enables, clears error, refetches list', async () => {
  const { app, button, call } = await withCancel();
  call.respond(204);
  await app.flush();
  assert.equal(button.disabled, false);
  assert.equal(app.error.textContent, '');
  assert.equal(app.fetchCalls.length, 4);
  assert.equal(app.fetchCalls[3].url, '/api/bookings');
});

test('cancel: 404 shows message and still refetches list', async () => {
  const { app, button, call } = await withCancel();
  call.respond(404, { error: 'booking not found' });
  await app.flush();
  assert.equal(button.disabled, false);
  assert.equal(app.error.textContent, 'booking not found');
  assert.equal(app.fetchCalls.length, 4);
  assert.equal(app.fetchCalls[3].url, '/api/bookings');
});

test('cancel: rejected fetch shows no-reply message, no list fetch', async () => {
  const { app, button, call } = await withCancel();
  call.fail();
  await app.flush();
  assert.equal(button.disabled, false);
  assert.equal(app.error.textContent, NO_REPLY);
  assert.equal(app.fetchCalls.length, 3);
});

test('cancel: 500 with non-JSON body counts as no reply, no list fetch', async () => {
  const { app, button, call } = await withCancel();
  call.respond(500, 'oops');
  await app.flush();
  assert.equal(button.disabled, false);
  assert.equal(app.error.textContent, NO_REPLY);
  assert.equal(app.fetchCalls.length, 3);
});
