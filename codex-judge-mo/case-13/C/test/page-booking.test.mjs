// Page script tests: booking form and Cancel buttons.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reply, flush, okScript, booking } from './support/fake-dom.mjs';
import {
  FAILED, NO_REPLY, assertFetchOptions, boot, done, fill, lastCall, listText, method, submit,
} from './support/page-helpers.mjs';

const FILTER_DATE = '2026-11-03';
const FILTERED_LIST_URL = `/api/bookings?date=${FILTER_DATE}`;

test('booking: submit prevents default, disables Book, posts raw values', async () => {
  const page = await boot();
  const values = fill(page, { title: '  Pad  ', start: '9:00' });
  const callCount = page.calls.length;
  const result = submit(page);
  assert.equal(result.prevented, true);
  assert.equal(page.els.book.disabled, true);
  assert.equal(page.calls.length, callCount + 1);
  const call = lastCall(page);
  assert.equal(call.url, '/api/bookings');
  assert.equal(call.options.method, 'POST');
  assert.deepStrictEqual(Object.keys(call.options).sort(), ['body', 'headers', 'method']);
  assert.deepStrictEqual(Object.keys(call.options.headers), ['Content-Type']);
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  // JSON.parse here builds the object in this realm, and key order does not matter.
  assert.deepStrictEqual(JSON.parse(call.options.body), values);
  done(page);
});

test('booking: submit while Book is disabled sends nothing but still prevents default', async () => {
  const page = await boot();
  fill(page);
  submit(page);
  const callCount = page.calls.length;
  const again = submit(page);
  assert.equal(again.prevented, true);
  assert.equal(page.calls.length, callCount);
  assert.equal(page.els.book.disabled, true);
  done(page);
});

test('booking: 201 re-enables Book, empties title only and error, refetches list', async () => {
  const page = await boot();
  const values = fill(page);
  page.els.error.textContent = 'old';
  submit(page);
  const post = lastCall(page).index;
  page.respond(post, reply(201, booking(5)));
  await flush();
  assert.equal(page.els.book.disabled, false);
  assert.equal(page.els.title.value, '');
  for (const id of ['room', 'date', 'start', 'end']) assert.equal(page.els[id].value, values[id], id);
  assert.equal(page.els.error.textContent, '');
  assert.equal(page.calls.length, post + 2);
  assert.equal(lastCall(page).url, '/api/bookings');
  assert.equal(method(lastCall(page)), 'GET');
  assertFetchOptions(lastCall(page), 'GET');
  done(page);
});

test('booking: the list refetch after a 201 keeps the filter value unchanged', async () => {
  const page = await boot();
  fill(page);
  page.els['filter-date'].value = FILTER_DATE;
  submit(page);
  const post = lastCall(page).index;
  page.respond(post, reply(201, booking(5)));
  await flush();
  assert.equal(page.calls.length, post + 2);
  assert.equal(lastCall(page).url, FILTERED_LIST_URL);
  assert.equal(method(lastCall(page)), 'GET');
  done(page);
});

test('booking: error replies show the message and leave form and list alone', async () => {
  const cases = [
    [409, { error: 'room is already booked from 09:00 to 10:00' }, 'room is already booked from 09:00 to 10:00'],
    [400, {}, FAILED],
    [400, { error: 7 }, FAILED],
    [500, [], FAILED],
    [200, { error: 'odd' }, 'odd'],
    [200, { id: 1 }, FAILED],
  ];
  for (const [status, body, message] of cases) {
    const page = await boot(okScript([booking(1)]));
    const values = fill(page);
    const listBefore = listText(page);
    submit(page);
    const post = lastCall(page).index;
    page.respond(post, reply(status, body));
    await flush();
    assert.equal(page.els.error.textContent, message, `${status} ${JSON.stringify(body)}`);
    assert.equal(page.els.title.value, values.title);
    assert.equal(page.els.book.disabled, false);
    assert.equal(page.calls.length, post + 1);
    assert.deepEqual(listText(page), listBefore);
    done(page);
  }
});

test('booking: a 204 reply with an unreadable body is an error status, not a missing reply', async () => {
  const page = await boot(okScript([booking(1)]));
  const values = fill(page);
  const listBefore = listText(page);
  submit(page);
  const post = lastCall(page).index;
  page.respond(post, reply(204, null, { badJson: true }));
  await flush();
  assert.equal(page.els.error.textContent, FAILED);
  assert.notEqual(page.els.error.textContent, NO_REPLY);
  assert.equal(page.els.book.disabled, false);
  assert.equal(page.calls.length, post + 1);
  assert.equal(page.els.title.value, values.title);
  assert.deepEqual(listText(page), listBefore);
  done(page);
});

test('booking: unreadable body and rejection mean no reply', async () => {
  const page = await boot();
  const values = fill(page);
  submit(page);
  page.respond(lastCall(page).index, reply(500, null, { badJson: true }));
  await flush();
  assert.equal(page.els.error.textContent, NO_REPLY);
  assert.equal(page.els.book.disabled, false);
  assert.equal(page.els.title.value, values.title);
  const callCount = page.calls.length;
  submit(page);
  page.fail(lastCall(page).index);
  await flush();
  assert.equal(page.els.error.textContent, NO_REPLY);
  assert.equal(page.els.book.disabled, false);
  assert.equal(page.calls.length, callCount + 1);
  assert.equal(page.els.title.value, values.title);
  done(page);
});

test('booking: Book is enabled before any other effect', async () => {
  const settle = [
    (page, index) => page.respond(index, reply(201, booking(5))),
    (page, index) => page.respond(index, reply(409, { error: 'room is already booked from 09:00 to 10:00' })),
    (page, index) => page.respond(index, reply(500, null, { badJson: true })),
    (page, index) => page.fail(index),
  ];
  for (const [caseIndex, run] of settle.entries()) {
    const page = await boot();
    fill(page);
    page.els.error.textContent = 'old';
    submit(page);
    const seen = [];
    const watch = (key) => (name) => seen.push([key, name, page.els.book.disabled]);
    page.els.error.watchers.push(watch('error'));
    page.els.title.watchers.push(watch('title'));
    const post = lastCall(page).index;
    run(page, post);
    await flush();
    assert.ok(seen.length > 0, `case ${caseIndex} has effects`);
    for (const entry of seen) assert.equal(entry[2], false, `case ${caseIndex} ${entry[0]}`);
    for (const call of page.calls.slice(post + 1)) {
      assert.equal(call.bookDisabled, false, `case ${caseIndex} fetch ${call.index}`);
    }
    done(page);
  }
});

test('booking: Book stays disabled while the body is still pending', async () => {
  const page = await boot();
  fill(page);
  submit(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const spec = reply(201, null, { jsonFn: () => pending });
  page.respond(lastCall(page).index, spec);
  await flush();
  assert.equal(spec.jsonCalls, 1);
  assert.equal(page.els.book.disabled, true);
  release(booking(5));
  await flush();
  assert.equal(page.els.book.disabled, false);
  done(page);
});

// Boots a page listing `bookings`, optionally sets the filter, and clicks the Cancel button at `position`.
async function withCancelButton({ bookings = [booking(7)], position = 0, filterDate = '' } = {}) {
  const page = await boot(okScript(bookings));
  const buttons = page.els['booking-list'].children.map((item) => item.children[1]);
  page.els.error.textContent = 'old';
  page.els['filter-date'].value = filterDate;
  const callCount = page.calls.length;
  page.dispatch(buttons[position], 'click');
  return { page, button: buttons[position], buttons, callCount };
}

test('cancel: click disables the button and sends DELETE for its id', async () => {
  const { page, button, callCount } = await withCancelButton();
  assert.equal(button.disabled, true);
  assert.equal(page.calls.length, callCount + 1);
  assert.equal(lastCall(page).url, '/api/bookings/7');
  assert.equal(lastCall(page).options.method, 'DELETE');
  assertFetchOptions(lastCall(page), 'DELETE');
  page.dispatch(button, 'click');
  assert.equal(page.calls.length, callCount + 1);
  done(page);
});

test('cancel: each button deletes its own booking and only the clicked button is disabled', async () => {
  const bookings = [booking(3), booking(8, { title: 'Other', start: '11:00', end: '12:00' })];
  const expectedUrls = ['/api/bookings/3', '/api/bookings/8'];
  for (const position of [0, 1]) {
    const { page, buttons, callCount } = await withCancelButton({ bookings, position });
    assert.equal(page.calls.length, callCount + 1);
    assert.equal(lastCall(page).url, expectedUrls[position]);
    assertFetchOptions(lastCall(page), 'DELETE');
    assert.deepEqual(buttons.map((button) => button.disabled), position === 0 ? [true, false] : [false, true]);
    done(page);
  }
});

test('cancel: 204 is accepted without reading the body, then the list is fetched', async () => {
  const { page, button, callCount } = await withCancelButton();
  const spec = reply(204, null, { badJson: true });
  page.respond(callCount, spec);
  await flush();
  assert.equal(spec.jsonCalls, 0);
  assert.equal(page.els.error.textContent, '');
  assert.equal(button.disabled, false);
  assert.equal(page.calls.length, callCount + 2);
  assert.equal(lastCall(page).url, '/api/bookings');
  assert.equal(method(lastCall(page)), 'GET');
  assertFetchOptions(lastCall(page), 'GET');
  done(page);
});

test('cancel: error statuses show the message and still refetch the list', async () => {
  const cases = [
    [404, { error: 'booking not found' }, 'booking not found'],
    [200, { weird: true }, FAILED],
    [500, null, FAILED],
  ];
  for (const [status, body, message] of cases) {
    const { page, button, callCount } = await withCancelButton();
    page.respond(callCount, reply(status, body));
    await flush();
    assert.equal(page.els.error.textContent, message, String(status));
    assert.equal(button.disabled, false);
    assert.equal(page.calls.length, callCount + 2);
    assert.equal(lastCall(page).url, '/api/bookings');
    done(page);
  }
});

test('cancel: the list refetch after 204 and after 404 keeps the filter value unchanged', async () => {
  for (const settled of [reply(204, null), reply(404, { error: 'booking not found' })]) {
    const { page, callCount } = await withCancelButton({ filterDate: FILTER_DATE });
    page.respond(callCount, settled);
    await flush();
    assert.equal(page.calls.length, callCount + 2, String(settled.status));
    assert.equal(lastCall(page).url, FILTERED_LIST_URL, String(settled.status));
    assert.equal(method(lastCall(page)), 'GET');
    done(page);
  }
});

test('cancel: no reply shows the network message, enables the button, no refetch', async () => {
  const rejected = await withCancelButton();
  rejected.page.fail(rejected.callCount);
  await flush();
  const unreadable = await withCancelButton();
  unreadable.page.respond(unreadable.callCount, reply(500, null, { badJson: true }));
  await flush();
  for (const { page, button, callCount } of [rejected, unreadable]) {
    assert.equal(page.els.error.textContent, NO_REPLY);
    assert.equal(button.disabled, false);
    assert.equal(page.calls.length, callCount + 1);
    done(page);
  }
});
