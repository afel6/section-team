// Page script tests: load, rooms, list rendering, stale lists and the filter. Booking and cancel
// live in page-booking.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadPage, reply, flush, okScript, APP_SRC, booking, ROOMS } from './support/fake-dom.mjs';
import {
  FAILED, NO_REPLY, assertFetchOptions, boot, done, firstListOnly, lastCall, listText, method, roomsOnly, rowTexts,
} from './support/page-helpers.mjs';

test('load: two synchronous fetches, rooms then bookings, GET, no wait for rooms', () => {
  const page = loadPage(roomsOnly);
  assert.equal(page.calls.length, 0);
  page.run();
  assert.deepEqual(page.urls(), ['/api/rooms', '/api/bookings']);
  for (const call of page.calls) {
    assert.equal(method(call), 'GET');
    assertFetchOptions(call, 'GET');
  }
  done(page);
});

test('page script sees only document and fetch', async () => {
  const page = await boot();
  for (const name of ['window', 'XMLHttpRequest', 'setTimeout', 'setInterval', 'localStorage']) {
    assert.equal(vm.runInContext(`typeof ${name}`, page.context), 'undefined', name);
  }
  assert.ok(!/\bconsole\b/.test(APP_SRC));
  done(page);
});

test('rooms success fills three options in order', async () => {
  const page = await boot();
  const kids = page.els.room.children;
  assert.equal(kids.length, 3);
  assert.deepEqual(kids.map((option) => option.tagName), ['option', 'option', 'option']);
  assert.deepEqual(kids.map((option) => option.value), ROOMS);
  assert.deepEqual(kids.map((option) => option.textContent), ROOMS);
  assert.equal(page.els.room.value, 'Aurora');
  done(page);
});

test('rooms error replies show the message and leave the select empty', async () => {
  const cases = [
    [500, { error: 'boom' }, 'boom'],
    [500, { error: 5 }, FAILED],
    [500, [], FAILED],
    [500, 'x', FAILED],
    [500, null, FAILED],
    [500, {}, FAILED],
    [201, { rooms: ROOMS }, FAILED],
  ];
  for (const [status, body, message] of cases) {
    const page = await boot((call) => (call.url === '/api/rooms' ? reply(status, body) : undefined));
    assert.equal(page.els.error.textContent, message, JSON.stringify(body));
    assert.equal(page.els.room.children.length, 0);
    done(page);
  }
});

test('rooms: fetch rejection and unreadable body mean no reply', async () => {
  const rejected = await boot((call) => (call.url === '/api/rooms' ? 'reject' : undefined));
  assert.equal(rejected.els.error.textContent, NO_REPLY);
  assert.equal(rejected.els.room.children.length, 0);
  const badBody = await boot((call) => (call.url === '/api/rooms' ? reply(200, null, { badJson: true }) : undefined));
  assert.equal(badBody.els.error.textContent, NO_REPLY);
  assert.equal(badBody.els.room.children.length, 0);
  done(rejected);
  done(badBody);
});

test('list renders one li per booking in reply order with text and Cancel button', async () => {
  const first = booking(1, { date: '2026-12-01', title: 'Later' });
  const second = booking(2);
  const page = await boot(okScript([first, second]));
  assert.deepEqual(listText(page), [
    '2026-12-01 09:00-10:00 Aurora: Later',
    '2026-11-03 09:00-10:00 Aurora: Standup',
  ]);
  for (const item of page.els['booking-list'].children) {
    assert.equal(item.tagName, 'li');
    assert.equal(item.children.length, 2);
    assert.equal(item.children[0].nodeType, 3);
    assert.equal(item.children[1].tagName, 'button');
    assert.equal(item.children[1].type, 'button');
    assert.equal(item.children[1].textContent, 'Cancel');
  }
  done(page);
});

test('list: empty reply shows a single No bookings. item', async () => {
  const page = await boot(okScript([]));
  assert.equal(page.els['booking-list'].children.length, 1);
  assert.deepEqual(rowTexts(page), [['No bookings.']]);
  done(page);
});

test('list: HTML in a title stays plain text', async () => {
  const page = await boot(okScript([booking(1, { title: '<b>x</b>' })]));
  assert.equal(listText(page)[0], '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
  done(page);
});

test('list: a new render replaces the previous content', async () => {
  const page = await boot(okScript([booking(1), booking(2), booking(3)]));
  assert.equal(page.els['booking-list'].children.length, 3);
  page.dispatch(page.els['filter-date'], 'change');
  await flush();
  assert.equal(page.els['booking-list'].children.length, 3);
  const second = await boot(roomsOnly);
  second.respond(1, reply(200, { bookings: [booking(1), booking(2)] }));
  await flush();
  second.dispatch(second.els['filter-date'], 'change');
  second.respond(2, reply(200, { bookings: [booking(9)] }));
  await flush();
  assert.equal(second.els['booking-list'].children.length, 1);
  done(page);
  done(second);
});

test('list: error status shows message and keeps the list', async () => {
  const page = await boot(firstListOnly([booking(1)]));
  const before = listText(page);
  page.dispatch(page.els['filter-date'], 'change');
  page.respond(2, reply(400, { error: 'date must be a valid YYYY-MM-DD date' }));
  await flush();
  assert.equal(page.els.error.textContent, 'date must be a valid YYYY-MM-DD date');
  assert.deepEqual(listText(page), before);
  done(page);
});

test('list: a non-200 success-like status is an error', async () => {
  const page = await boot(firstListOnly([booking(1)]));
  const before = listText(page);
  page.dispatch(page.els['filter-date'], 'change');
  page.respond(2, reply(201, { bookings: [] }));
  await flush();
  assert.equal(page.els.error.textContent, FAILED);
  assert.deepEqual(listText(page), before);
  page.dispatch(page.els['filter-date'], 'change');
  page.respond(3, reply(500, { error: 'from body' }));
  await flush();
  assert.equal(page.els.error.textContent, 'from body');
  done(page);
});

test('list: a 204 reply has no readable body, so it is an error status with Request failed.', async () => {
  const page = await boot(firstListOnly([booking(1)]));
  const before = listText(page);
  page.dispatch(page.els['filter-date'], 'change');
  page.respond(2, reply(204, null, { badJson: true }));
  await flush();
  assert.equal(page.els.error.textContent, FAILED);
  assert.deepEqual(listText(page), before);
  done(page);
});

test('list: no reply shows the network message and keeps the list', async () => {
  const page = await boot(firstListOnly([booking(1)]));
  const before = listText(page);
  page.dispatch(page.els['filter-date'], 'change');
  page.fail(2);
  await flush();
  assert.equal(page.els.error.textContent, NO_REPLY);
  assert.deepEqual(listText(page), before);
  page.dispatch(page.els['filter-date'], 'change');
  page.respond(3, reply(200, null, { badJson: true }));
  await flush();
  assert.equal(page.els.error.textContent, NO_REPLY);
  assert.deepEqual(listText(page), before);
  done(page);
});

test('list: success leaves #error alone', async () => {
  const page = await boot(okScript([booking(1)]));
  page.els.error.textContent = 'keep';
  page.dispatch(page.els['filter-date'], 'change');
  await flush();
  assert.equal(page.els.error.textContent, 'keep');
  done(page);
});

const OUTCOMES = {
  success: (page, index) => page.respond(index, reply(200, { bookings: [booking(index, { title: `T${index}` })] })),
  errorStatus: (page, index) => page.respond(index, reply(500, { error: `late ${index}` })),
  rejection: (page, index) => page.fail(index),
};

test('stale lists: the later fetch wins when the earlier one settles after it', async () => {
  for (const [name, settleEarlier] of Object.entries(OUTCOMES)) {
    const page = await boot(roomsOnly);
    page.dispatch(page.els['filter-date'], 'change');
    page.els.error.textContent = 'keep';
    page.respond(2, reply(200, { bookings: [booking(2, { title: 'B' })] }));
    await flush();
    settleEarlier(page, 1);
    await flush();
    assert.deepEqual(listText(page), ['2026-11-03 09:00-10:00 Aurora: B'], name);
    assert.equal(page.els.error.textContent, 'keep', name);
    done(page);
  }
});

test('stale lists: the earlier outcome is ignored even when it arrives first', async () => {
  for (const [name, settleEarlier] of Object.entries(OUTCOMES)) {
    const page = await boot(roomsOnly);
    page.dispatch(page.els['filter-date'], 'change');
    page.els.error.textContent = 'keep';
    settleEarlier(page, 1);
    await flush();
    assert.equal(page.els['booking-list'].children.length, 0, name);
    assert.equal(page.els.error.textContent, 'keep', name);
    OUTCOMES.success(page, 2);
    await flush();
    assert.deepEqual(listText(page), ['2026-11-03 09:00-10:00 Aurora: T2'], name);
    done(page);
  }
});

test('filter: change fetches synchronously with the value unchanged', async () => {
  const page = await boot();
  const callCount = page.calls.length;
  page.els['filter-date'].value = '2026-11-03';
  page.dispatch(page.els['filter-date'], 'change');
  assert.equal(page.calls.length, callCount + 1);
  assert.equal(lastCall(page).url, '/api/bookings?date=2026-11-03');
  assert.equal(method(lastCall(page)), 'GET');
  assertFetchOptions(lastCall(page), 'GET');
  page.els['filter-date'].value = 'a b&c';
  page.dispatch(page.els['filter-date'], 'change');
  assert.equal(lastCall(page).url, '/api/bookings?date=a b&c');
  page.els['filter-date'].value = '';
  page.dispatch(page.els['filter-date'], 'change');
  assert.equal(lastCall(page).url, '/api/bookings');
  assert.equal(page.calls.length, callCount + 3);
  done(page);
});

test('filter: input event does nothing', async () => {
  const page = await boot();
  const callCount = page.calls.length;
  page.els['filter-date'].value = '2026-11-03';
  page.dispatch(page.els['filter-date'], 'input');
  assert.equal(page.calls.length, callCount);
  done(page);
});

test('show all: clears the filter and fetches exactly once without events', async () => {
  const page = await boot();
  const spy = [];
  page.els['filter-date'].addEventListener('change', () => spy.push('change'));
  page.els['filter-date'].addEventListener('input', () => spy.push('input'));
  page.els['filter-date'].value = '2026-11-03';
  const callCount = page.calls.length;
  const result = page.dispatch(page.els['show-all'], 'click');
  assert.equal(result.listenerCount, 1);
  assert.equal(page.els['filter-date'].value, '');
  assert.equal(page.calls.length, callCount + 1);
  assert.equal(lastCall(page).url, '/api/bookings');
  await flush();
  assert.equal(page.calls.length, callCount + 1);
  assert.deepEqual(spy, []);
  done(page);
});
