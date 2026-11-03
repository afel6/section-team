import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  flush, booking, loadReadyApp, cancelButtons, assertOnlyAllowedApis,
} from './helpers/fake-dom.mjs';

const el = (page, id) => page.elements[id];
const errorText = (page) => el(page, 'error').textContent;
const bookDisabled = (page) => el(page, 'book').disabled;

function fillForm(page, overrides = {}) {
  const values = { room: 'Borealis', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides };
  for (const [id, value] of Object.entries(values)) el(page, id).value = value;
}
async function readyForm(overrides, bookings = []) {
  const page = await loadReadyApp(bookings);
  fillForm(page, overrides);
  return page;
}
async function submit(page) {
  const before = page.calls.length;
  const result = el(page, 'booking-form').dispatch('submit');
  await flush();
  return { result, post: page.calls[before], count: page.calls.length - before };
}
function assertEnabledAfter(page, index) {
  const after = page.log.slice(index).filter((entry) => entry.id !== 'book');
  assert.ok(after.every((entry) => entry.bookDisabled === false), JSON.stringify(after));
}

test('submit calls preventDefault', async () => {
  const page = await readyForm();
  const { result } = await submit(page);
  assert.equal(result.defaultPrevented, true);
  assertOnlyAllowedApis(page);
});

test('submit calls preventDefault even when Book is disabled', async () => {
  const page = await readyForm();
  await submit(page);
  assert.equal(bookDisabled(page), true);
  const { result, count } = await submit(page);
  assert.equal(result.defaultPrevented, true);
  assert.equal(count, 0);
  assertOnlyAllowedApis(page);
});

test('submit POSTs the five untrimmed field values as JSON and disables Book', async () => {
  const page = await readyForm({ title: '  Standup  ' });
  const { post, count } = await submit(page);
  assert.equal(count, 1);
  assert.equal(post.url, '/api/bookings');
  assert.equal(post.options.method, 'POST');
  // headers is created inside the vm realm; copy it so the prototype check compares equal.
  assert.deepEqual({ ...post.options.headers }, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(post.options.body), {
    room: 'Borealis', title: '  Standup  ', date: '2026-11-03', start: '09:00', end: '10:00',
  });
  assert.equal(bookDisabled(page), true);
  assertOnlyAllowedApis(page);
});

test('empty fields are sent unchanged without client validation', async () => {
  const page = await readyForm({ room: '', title: '', date: '', start: '', end: '' });
  const { post, count } = await submit(page);
  assert.equal(count, 1);
  assert.deepEqual(JSON.parse(post.options.body), { room: '', title: '', date: '', start: '', end: '' });
  assertOnlyAllowedApis(page);
});

test('submitting twice before the reply sends exactly one POST', async () => {
  const page = await readyForm();
  const before = page.calls.length;
  el(page, 'booking-form').dispatch('submit');
  el(page, 'booking-form').dispatch('submit');
  await flush();
  assert.equal(page.calls.length - before, 1);
  assertOnlyAllowedApis(page);
});

test('Book stays disabled until the reply body arrives', async () => {
  const page = await readyForm();
  const { post } = await submit(page);
  const resolveJson = post.respondSlowJson(201);
  await flush();
  assert.equal(bookDisabled(page), true);
  resolveJson(booking());
  await flush();
  assert.equal(bookDisabled(page), false);
  assertOnlyAllowedApis(page);
});

test('201 clears title only, clears #error, re-enables Book first, then refetches the list once', async () => {
  const page = await readyForm({ title: 'Standup' });
  el(page, 'filter-date').value = '2026-11-03';
  el(page, 'error').textContent = 'old';
  const { post } = await submit(page);
  const logIndex = page.log.length;
  const callIndex = page.calls.length;
  post.respond(201, booking());
  await flush();
  assert.equal(el(page, 'title').value, '');
  assert.equal(el(page, 'room').value, 'Borealis');
  assert.equal(el(page, 'date').value, '2026-11-03');
  assert.equal(el(page, 'start').value, '09:00');
  assert.equal(el(page, 'end').value, '10:00');
  assert.equal(errorText(page), '');
  assert.equal(page.calls.length - callIndex, 1);
  assert.equal(page.calls[callIndex].url, '/api/bookings?date=2026-11-03');
  assert.equal(page.calls[callIndex].bookDisabledAtCall, false);
  assert.equal(bookDisabled(page), false);
  assertEnabledAfter(page, logIndex);
  assertOnlyAllowedApis(page);
});

for (const [status, body, expected] of [
  [409, { error: 'room is already booked from 09:00 to 10:00' }, 'room is already booked from 09:00 to 10:00'],
  [400, 'x', 'Request failed.'],
  [500, { error: {} }, 'Request failed.'],
]) {
  test(`submit error ${status} with body ${JSON.stringify(body)} shows "${expected}" and keeps the form`, async () => {
    const page = await readyForm({ title: 'Keep me' });
    const { post } = await submit(page);
    const logIndex = page.log.length;
    const callIndex = page.calls.length;
    post.respond(status, body);
    await flush();
    assert.equal(errorText(page), expected);
    assert.equal(el(page, 'title').value, 'Keep me');
    assert.equal(page.calls.length, callIndex);
    assert.equal(bookDisabled(page), false);
    assertEnabledAfter(page, logIndex);
    assertOnlyAllowedApis(page);
  });
}

// A 204 body is never read, so an unreadable 204 is an error status with the fallback message, not "no reply".
for (const [status, body, expected] of [
  [200, { error: 'x' }, 'x'],
  [204, undefined, 'Request failed.'],
]) {
  test(`submit status ${status} is an error status: keeps title, no list fetch, Book enabled`, async () => {
    const page = await readyForm({ title: 'Keep me' });
    const { post } = await submit(page);
    const callIndex = page.calls.length;
    if (status === 204) post.respondUnparseable(status);
    else post.respond(status, body);
    await flush();
    assert.equal(errorText(page), expected);
    assert.equal(el(page, 'title').value, 'Keep me');
    assert.equal(page.calls.length, callIndex);
    assert.equal(bookDisabled(page), false);
    assertOnlyAllowedApis(page);
  });
}

for (const [name, act] of [
  ['fetch fails', (call) => call.fail()],
  ['201 unparseable', (call) => call.respondUnparseable(201)],
]) {
  test(`submit with no usable reply (${name}) shows unreachable, keeps title, no list fetch`, async () => {
    const page = await readyForm({ title: 'Keep me' });
    const { post } = await submit(page);
    const callIndex = page.calls.length;
    act(post);
    await flush();
    assert.equal(errorText(page), 'Could not reach the server.');
    assert.equal(el(page, 'title').value, 'Keep me');
    assert.equal(page.calls.length, callIndex);
    assert.equal(bookDisabled(page), false);
    assertOnlyAllowedApis(page);
  });
}

async function startCancel(bookings = [booking({ id: 7 })], index = 0) {
  const page = await loadReadyApp(bookings);
  el(page, 'error').textContent = 'old';
  const button = cancelButtons(page)[index];
  const before = page.calls.length;
  button.dispatch('click');
  await flush();
  return { page, button, call: page.calls[before], before };
}

test('Cancel disables its button and sends DELETE to the booking URL', async () => {
  const { page, button, call, before } = await startCancel();
  assert.equal(button.disabled, true);
  assert.equal(page.calls.length - before, 1);
  assert.equal(call.url, '/api/bookings/7');
  assert.equal(call.options.method, 'DELETE');
  assertOnlyAllowedApis(page);
});

test('Cancel 204 never reads the body, clears #error, refetches once, re-enables the button', async () => {
  const { page, button, call, before } = await startCancel();
  call.respondUnparseable(204);
  await flush();
  assert.equal(call.jsonCalls, 0);
  assert.equal(errorText(page), '');
  assert.equal(page.calls.length - before, 2);
  assert.equal(page.calls[before + 1].url, '/api/bookings');
  assert.equal(button.disabled, false);
  assertOnlyAllowedApis(page);
});

for (const [status, body, expected] of [
  [404, { error: 'booking not found' }, 'booking not found'],
  [500, 'nope', 'Request failed.'],
]) {
  test(`Cancel ${status} with body ${JSON.stringify(body)} shows "${expected}" and refetches once`, async () => {
    const { page, button, call, before } = await startCancel();
    call.respond(status, body);
    await flush();
    assert.equal(errorText(page), expected);
    assert.equal(page.calls.length - before, 2);
    assert.equal(page.calls[before + 1].url, '/api/bookings');
    assert.equal(button.disabled, false);
    assertOnlyAllowedApis(page);
  });
}

for (const [status, body, expected] of [
  [200, { error: 'x' }, 'x'],
  [201, { error: 'z' }, 'z'],
]) {
  test(`Cancel ${status} is an error status: shows "${expected}", refetches once, button enabled`, async () => {
    const { page, button, call, before } = await startCancel();
    call.respond(status, body);
    await flush();
    assert.equal(errorText(page), expected);
    assert.equal(page.calls.length - before, 2);
    assert.equal(page.calls[before + 1].url, '/api/bookings');
    assert.equal(button.disabled, false);
    assertOnlyAllowedApis(page);
  });
}

for (const [name, act] of [
  ['fetch fails', (call) => call.fail()],
  ['404 unparseable', (call) => call.respondUnparseable(404)],
]) {
  test(`Cancel with no usable reply (${name}) shows unreachable, no refetch, button enabled`, async () => {
    const { page, button, call, before } = await startCancel();
    act(call);
    await flush();
    assert.equal(errorText(page), 'Could not reach the server.');
    assert.equal(page.calls.length - before, 1);
    assert.equal(button.disabled, false);
    assertOnlyAllowedApis(page);
  });
}

test('Cancel uses the id of its own booking', async () => {
  const { page, call } = await startCancel([booking({ id: 3 }), booking({ id: 9 })], 1);
  assert.equal(call.url, '/api/bookings/9');
  assertOnlyAllowedApis(page);
});
