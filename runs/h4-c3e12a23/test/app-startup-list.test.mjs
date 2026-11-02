import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadApp, flush, childSummary, booking, loadReadyApp, assertOnlyAllowedApis, TextNode,
} from './helpers/fake-dom.mjs';

const ROOMS = ['Aurora', 'Borealis', 'Cosmos'];

function isGet(call) {
  return call.options === undefined || call.options.method === 'GET';
}
function callFor(page, url) {
  return page.calls.find((call) => call.url === url);
}
function listItems(page) {
  return page.elements['booking-list'].childNodes;
}
function summaries(page) {
  return listItems(page).map((item) => childSummary(item));
}
function errorText(page) {
  return page.elements.error.textContent;
}
async function changeFilter(page, value) {
  page.elements['filter-date'].value = value;
  const callCountBefore = page.calls.length;
  page.elements['filter-date'].dispatch('change');
  await flush();
  assert.equal(page.calls.length, callCountBefore + 1);
  return page.calls[callCountBefore];
}
async function roomsReply(reply) {
  const page = loadApp();
  await flush();
  reply(callFor(page, '/api/rooms'));
  await flush();
  return page;
}
const rowNodes = (text) => [{ text }, { tag: 'button', type: 'button', text: 'Cancel' }];

test('startup issues both GET fetches synchronously without waiting for rooms', () => {
  const page = loadApp();
  assert.equal(page.calls.length, 2);
  assert.deepEqual(page.calls.map((call) => call.url).sort(), ['/api/bookings', '/api/rooms']);
  for (const call of page.calls) {
    assert.ok(isGet(call));
    assert.equal(call.options?.body, undefined);
  }
  assertOnlyAllowedApis(page);
});

test('rooms success fills #room with one option per room in order, value equals name', async () => {
  const page = await roomsReply((call) => call.respond(200, { rooms: ROOMS }));
  assert.deepEqual(childSummary(page.elements.room), ROOMS.map((text) => ({ tag: 'option', type: undefined, text })));
  assert.deepEqual(page.elements.room.childNodes.map((option) => option.value), ROOMS);
  assertOnlyAllowedApis(page);
});

for (const [status, body, expected] of [
  [500, { error: 'boom' }, 'boom'],
  [404, { error: 5 }, 'Request failed.'],
  [500, ['x'], 'Request failed.'],
  [500, null, 'Request failed.'],
  [201, { rooms: ['A'], error: 'r' }, 'r'],
]) {
  test(`rooms error status ${status} with body ${JSON.stringify(body)} shows "${expected}" and leaves #room empty`, async () => {
    const page = await roomsReply((call) => call.respond(status, body));
    assert.equal(errorText(page), expected);
    assert.deepEqual(page.elements.room.childNodes, []);
    assertOnlyAllowedApis(page);
  });
}

test('rooms 204 with no readable body is an error status (not "no reply"): shows Request failed.', async () => {
  const page = await roomsReply((call) => call.respondUnparseable(204));
  assert.deepEqual(page.elements.room.childNodes, []);
  assert.equal(errorText(page), 'Request failed.');
  assertOnlyAllowedApis(page);
});

test('rooms 204 with an error body is an error status: #room stays empty and #error is not empty', async () => {
  const page = await roomsReply((call) => call.respond(204, { error: 'n', rooms: ['A'] }));
  assert.deepEqual(page.elements.room.childNodes, []);
  assert.notEqual(errorText(page), '');
  assertOnlyAllowedApis(page);
});

for (const [name, act] of [
  ['fetch fails', (call) => call.fail()],
  ['500 unparseable', (call) => call.respondUnparseable(500)],
  ['200 unparseable', (call) => call.respondUnparseable(200)],
]) {
  test(`rooms with no usable reply (${name}) shows unreachable message and leaves #room empty`, async () => {
    const page = await roomsReply(act);
    assert.equal(errorText(page), 'Could not reach the server.');
    assert.deepEqual(page.elements.room.childNodes, []);
    assertOnlyAllowedApis(page);
  });
}

test('list renders each booking as li with one text node and a Cancel button, in reply order', async () => {
  const laterBooking = booking({ id: 2, room: 'Borealis', title: 'Later', date: '2026-11-05', start: '13:00', end: '14:30' });
  const earlierBooking = booking({ id: 1 });
  const page = await loadReadyApp([laterBooking, earlierBooking]);
  assert.equal(listItems(page).length, 2);
  assert.deepEqual(summaries(page), [
    rowNodes('2026-11-05 13:00-14:30 Borealis: Later'),
    rowNodes('2026-11-03 09:00-10:00 Aurora: Standup'),
  ]);
  assert.equal(listItems(page)[0].childNodes[0] instanceof TextNode, true);
  assertOnlyAllowedApis(page);
});

test('list shows a title with markup literally as text', async () => {
  const page = await loadReadyApp([booking({ title: '<b>x</b>' })]);
  assert.deepEqual(summaries(page), [rowNodes('2026-11-03 09:00-10:00 Aurora: <b>x</b>')]);
  assertOnlyAllowedApis(page);
});

test('list text has no extra whitespace beyond the title', async () => {
  const page = await loadReadyApp([booking({ title: 'Plan  ' })]);
  assert.equal(listItems(page)[0].childNodes[0].data, '2026-11-03 09:00-10:00 Aurora: Plan  ');
  assertOnlyAllowedApis(page);
});

test('empty list shows exactly one li containing only the text node "No bookings."', async () => {
  const page = await loadReadyApp([]);
  assert.equal(listItems(page).length, 1);
  assert.deepEqual(childSummary(listItems(page)[0]), [{ text: 'No bookings.' }]);
  assertOnlyAllowedApis(page);
});

test('a refetch replaces the rendered list instead of appending', async () => {
  const page = await loadReadyApp([booking({ id: 1 }), booking({ id: 2 }), booking({ id: 3 })]);
  assert.equal(listItems(page).length, 3);
  const call = await changeFilter(page, '2026-11-03');
  call.respond(200, { bookings: [booking({ id: 4, title: 'Only' })] });
  await flush();
  assert.equal(listItems(page).length, 1);
  assert.deepEqual(summaries(page), [rowNodes('2026-11-03 09:00-10:00 Aurora: Only')]);
  assertOnlyAllowedApis(page);
});

for (const [name, act, expected] of [
  ['error status', (call) => call.respond(400, { error: 'date must be a valid YYYY-MM-DD date' }), 'date must be a valid YYYY-MM-DD date'],
  ['status 201 with an error body', (call) => call.respond(201, { bookings: [], error: 'l' }), 'l'],
  ['no reply', (call) => call.fail(), 'Could not reach the server.'],
  ['unparseable', (call) => call.respondUnparseable(200), 'Could not reach the server.'],
]) {
  test(`list fetch failure (${name}) shows the error and leaves the list unchanged`, async () => {
    const page = await loadReadyApp([booking()]);
    const itemsBefore = [...listItems(page)];
    const summariesBefore = summaries(page);
    const call = await changeFilter(page, 'bad');
    act(call);
    await flush();
    assert.equal(errorText(page), expected);
    assert.equal(listItems(page).length, itemsBefore.length);
    assert.ok(listItems(page).every((item, index) => item === itemsBefore[index]));
    assert.deepEqual(summaries(page), summariesBefore);
    assertOnlyAllowedApis(page);
  });
}

test('list 204 is an error status: the list is not rendered and #error is not empty', async () => {
  const page = await loadReadyApp([booking()]);
  const itemsBefore = [...listItems(page)];
  const summariesBefore = summaries(page);
  const call = await changeFilter(page, '2026-11-03');
  call.respond(204, { bookings: [] });
  await flush();
  assert.notEqual(errorText(page), '');
  assert.ok(listItems(page).every((item, index) => item === itemsBefore[index]));
  assert.equal(listItems(page).length, itemsBefore.length);
  assert.deepEqual(summaries(page), summariesBefore);
  assertOnlyAllowedApis(page);
});

test('list success leaves an existing #error message alone', async () => {
  const page = loadApp();
  await flush();
  callFor(page, '/api/rooms').respond(500, { error: 'boom' });
  callFor(page, '/api/bookings').respond(200, { bookings: [booking()] });
  await flush();
  assert.equal(errorText(page), 'boom');
  assert.equal(listItems(page).length, 1);
  assertOnlyAllowedApis(page);
});

test('stale list fetch (a): older success arriving after newer success is ignored', async () => {
  const page = loadApp();
  const olderCall = callFor(page, '/api/bookings');
  const newerCall = await changeFilter(page, '2026-11-03');
  newerCall.respond(200, { bookings: [booking({ title: 'b1' })] });
  await flush();
  olderCall.respond(200, { bookings: [booking({ title: 'a1' })] });
  await flush();
  assert.deepEqual(summaries(page), [rowNodes('2026-11-03 09:00-10:00 Aurora: b1')]);
  assertOnlyAllowedApis(page);
});

test('stale list fetch (b): older success arriving while newer is pending changes nothing', async () => {
  const page = loadApp();
  const olderCall = callFor(page, '/api/bookings');
  const newerCall = await changeFilter(page, '2026-11-03');
  olderCall.respond(200, { bookings: [booking({ title: 'a1' })] });
  await flush();
  assert.deepEqual(listItems(page), []);
  newerCall.respond(200, { bookings: [booking({ title: 'b1' })] });
  await flush();
  assert.deepEqual(summaries(page), [rowNodes('2026-11-03 09:00-10:00 Aurora: b1')]);
  assertOnlyAllowedApis(page);
});

test('stale list fetch (c): older error status after newer success leaves #error and list alone', async () => {
  const page = loadApp();
  const olderCall = callFor(page, '/api/bookings');
  const newerCall = await changeFilter(page, '2026-11-03');
  newerCall.respond(200, { bookings: [booking({ title: 'b1' })] });
  await flush();
  olderCall.respond(500, { error: 'old' });
  await flush();
  assert.equal(errorText(page), '');
  assert.deepEqual(summaries(page), [rowNodes('2026-11-03 09:00-10:00 Aurora: b1')]);
  assertOnlyAllowedApis(page);
});

test('stale list fetch (d): older network failure after newer success leaves #error alone', async () => {
  const page = loadApp();
  const olderCall = callFor(page, '/api/bookings');
  const newerCall = await changeFilter(page, '2026-11-03');
  newerCall.respond(200, { bookings: [booking({ title: 'b1' })] });
  await flush();
  olderCall.fail();
  await flush();
  assert.equal(errorText(page), '');
  assert.equal(listItems(page).length, 1);
  assertOnlyAllowedApis(page);
});

test('stale list fetch (e): of three overlapping fetches only the third applies', async () => {
  const page = loadApp();
  const first = callFor(page, '/api/bookings');
  const second = await changeFilter(page, '2026-11-03');
  const third = await changeFilter(page, '2026-11-04');
  third.respond(200, { bookings: [booking({ title: 'third' })] });
  await flush();
  second.respond(200, { bookings: [booking({ title: 'second' })] });
  first.respond(200, { bookings: [booking({ title: 'first' })] });
  await flush();
  assert.deepEqual(summaries(page), [rowNodes('2026-11-03 09:00-10:00 Aurora: third')]);
  assertOnlyAllowedApis(page);
});

test('filter change fetches exactly once with the date appended', async () => {
  const page = await loadReadyApp([]);
  const call = await changeFilter(page, '2026-11-03');
  assert.equal(call.url, '/api/bookings?date=2026-11-03');
  assert.ok(isGet(call));
  assertOnlyAllowedApis(page);
});

test('filter value is put into the URL unchanged', async () => {
  const page = await loadReadyApp([]);
  const call = await changeFilter(page, 'x y&z');
  assert.equal(call.url, '/api/bookings?date=x y&z');
  assertOnlyAllowedApis(page);
});

test('filter input event does not fetch', async () => {
  const page = await loadReadyApp([]);
  const callCountBefore = page.calls.length;
  page.elements['filter-date'].value = '2026-11-03';
  page.elements['filter-date'].dispatch('input');
  await flush();
  assert.equal(page.calls.length, callCountBefore);
  assertOnlyAllowedApis(page);
});

test('empty filter value fetches the unfiltered URL', async () => {
  const page = await loadReadyApp([]);
  const call = await changeFilter(page, '');
  assert.equal(call.url, '/api/bookings');
  assertOnlyAllowedApis(page);
});

test('Show all clears the filter and fetches exactly once without a date', async () => {
  const page = await loadReadyApp([]);
  page.elements['filter-date'].value = '2026-11-03';
  const callCountBefore = page.calls.length;
  page.elements['show-all'].dispatch('click');
  await flush();
  assert.equal(page.elements['filter-date'].value, '');
  assert.equal(page.calls.length, callCountBefore + 1);
  assert.equal(page.calls[callCountBefore].url, '/api/bookings');
  assert.ok(isGet(page.calls[callCountBefore]));
  assertOnlyAllowedApis(page);
});
