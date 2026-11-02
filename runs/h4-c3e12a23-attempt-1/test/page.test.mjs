import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, makeReply, flush } from './helpers/fake-dom.mjs';

const APP = new URL('../public/app.js', import.meta.url).pathname;
const NO_REPLY = 'Could not reach the server.';
const BOOKING = { id: 1, room: 'Aurora', title: '<b>x</b>', date: '2026-11-03', start: '09:00', end: '10:00' };

function page() {
  return loadPage(APP);
}

async function withList(bookings = [BOOKING]) {
  const p = page();
  p.calls[1].reply(makeReply(200, { bookings }));
  await flush();
  return p;
}

test('on load two fetches start before either resolves', () => {
  const { calls } = page();
  assert.deepEqual(calls.map((c) => c.url), ['/api/rooms', '/api/bookings']);
});

test('rooms 200 fills the select in order', async () => {
  const { els, calls } = page();
  calls[0].reply(makeReply(200, { rooms: ['A', 'B', 'C'] }));
  await flush();
  const opts = els.room.children;
  assert.equal(opts.length, 3);
  assert.deepEqual(opts.map((o) => o.value), ['A', 'B', 'C']);
  assert.deepEqual(opts.map((o) => o.textContent), ['A', 'B', 'C']);
});

test('rooms 500 shows the reply error and leaves select empty', async () => {
  const { els, calls } = page();
  calls[0].reply(makeReply(500, { error: 'x' }));
  await flush();
  assert.equal(els.error.textContent, 'x');
  assert.equal(els.room.children.length, 0);
});

test('rooms with no reply shows the no-reply message', async () => {
  const { els, calls } = page();
  calls[0].fail();
  await flush();
  assert.equal(els.error.textContent, NO_REPLY);
  assert.equal(els.room.children.length, 0);
});

test('rooms 200 with unreadable body counts as no reply', async () => {
  const { els, calls } = page();
  calls[0].reply(makeReply(200, null, { badJson: true }));
  await flush();
  assert.equal(els.error.textContent, NO_REPLY);
});

for (const body of [[], { error: 5 }]) {
  test(`rooms 404 with body ${JSON.stringify(body)} shows fallback`, async () => {
    const { els, calls } = page();
    calls[0].reply(makeReply(404, body));
    await flush();
    assert.equal(els.error.textContent, 'Request failed.');
  });
}

test('list renders text node and Cancel button, never HTML', async () => {
  const { els } = await withList();
  const items = els['booking-list'].children;
  assert.equal(items.length, 1);
  const [text, button] = items[0].children;
  assert.equal(items[0].children.length, 2);
  assert.deepEqual({ ...text }, { nodeType: 3, textContent: '2026-11-03 09:00-10:00 Aurora: <b>x</b>' });
  assert.equal(button.type, 'button');
  assert.equal(button.textContent, 'Cancel');
});

test('empty list shows a single No bookings. item', async () => {
  const { els } = await withList([]);
  const items = els['booking-list'].children;
  assert.equal(items.length, 1);
  assert.equal(items[0].children.length, 1);
  assert.deepEqual({ ...items[0].children[0] }, { nodeType: 3, textContent: 'No bookings.' });
});

test('change on filter-date fetches with the date', () => {
  const { els, calls } = page();
  els['filter-date'].value = '2026-11-03';
  els['filter-date'].dispatch('change');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, '/api/bookings?date=2026-11-03');
});

test('input on filter-date makes no fetch', () => {
  const { els, calls } = page();
  els['filter-date'].value = '2026-11-03';
  els['filter-date'].dispatch('input');
  assert.equal(calls.length, 2);
});

for (const mode of ['error status', 'rejection']) {
  test(`earlier overlapping list fetch ending in ${mode} is ignored`, async () => {
    const { els, calls } = page();
    els['filter-date'].dispatch('change');
    calls[2].reply(makeReply(200, { bookings: [BOOKING] }));
    await flush();
    if (mode === 'rejection') calls[1].fail();
    else calls[1].reply(makeReply(500, { error: 'boom' }));
    await flush();
    assert.equal(els['booking-list'].children.length, 1);
    assert.equal(els.error.textContent, '');
  });
}

test('Show all clears the filter and fetches once', () => {
  const { els, calls } = page();
  els['filter-date'].value = '2026-11-03';
  els['show-all'].dispatch('click');
  assert.equal(els['filter-date'].value, '');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, '/api/bookings');
});

function fillForm(els) {
  els.room.value = 'Aurora';
  els.title.value = '  Standup ';
  els.date.value = '2026-11-03';
  els.start.value = '09:00';
  els.end.value = '10:00';
}

test('submit disables Book and POSTs the five raw values', () => {
  const { els, calls } = page();
  fillForm(els);
  const event = els['booking-form'].dispatch('submit');
  assert.equal(event.defaultPrevented, true);
  assert.equal(els.book.disabled, true);
  const post = calls[2];
  assert.equal(post.url, '/api/bookings');
  assert.equal(post.options.method, 'POST');
  assert.deepEqual({ ...post.options.headers }, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(post.options.body), {
    room: 'Aurora', title: '  Standup ', date: '2026-11-03', start: '09:00', end: '10:00',
  });
});

test('second submit while disabled sends nothing but prevents default', () => {
  const { els, calls } = page();
  els['booking-form'].dispatch('submit');
  const event = els['booking-form'].dispatch('submit');
  assert.equal(event.defaultPrevented, true);
  assert.equal(calls.length, 3);
});

test('submit 201 re-enables Book, clears title and error, refetches list', async () => {
  const { els, calls } = page();
  fillForm(els);
  els.error.textContent = 'old';
  els['booking-form'].dispatch('submit');
  calls[2].reply(makeReply(201, {}));
  await flush();
  assert.equal(els.book.disabled, false);
  assert.equal(els.title.value, '');
  assert.equal(els.error.textContent, '');
  assert.equal(calls.length, 4);
  assert.equal(calls[3].url, '/api/bookings');
});

test('submit 409 shows the error, keeps title, no list fetch', async () => {
  const { els, calls } = page();
  fillForm(els);
  els['booking-form'].dispatch('submit');
  calls[2].reply(makeReply(409, { error: 'room is already booked from 09:00 to 10:00' }));
  await flush();
  assert.equal(els.error.textContent, 'room is already booked from 09:00 to 10:00');
  assert.equal(els.title.value, '  Standup ');
  assert.equal(calls.length, 3);
  assert.equal(els.book.disabled, false);
});

test('submit with no reply shows the no-reply message', async () => {
  const { els, calls } = page();
  els['booking-form'].dispatch('submit');
  calls[2].fail();
  await flush();
  assert.equal(els.error.textContent, NO_REPLY);
  assert.equal(els.book.disabled, false);
});

async function clickCancel() {
  const p = await withList();
  const button = p.els['booking-list'].children[0].children[1];
  button.dispatch('click');
  return { ...p, button };
}

test('Cancel disables the button and sends DELETE without body', async () => {
  const { button, calls } = await clickCancel();
  assert.equal(button.disabled, true);
  assert.equal(calls[2].url, '/api/bookings/1');
  assert.equal(calls[2].options.method, 'DELETE');
  assert.ok(!('body' in calls[2].options));
});

test('Cancel 204 clears error, enables button, refetches list', async () => {
  const { els, button, calls } = await clickCancel();
  els.error.textContent = 'old';
  const reply = makeReply(204);
  calls[2].reply(reply);
  await flush();
  assert.equal(reply.jsonCalls, 0);
  assert.equal(button.disabled, false);
  assert.equal(els.error.textContent, '');
  assert.equal(calls.length, 4);
});

test('Cancel 404 shows the error and refetches list', async () => {
  const { els, calls } = await clickCancel();
  calls[2].reply(makeReply(404, { error: 'booking not found' }));
  await flush();
  assert.equal(els.error.textContent, 'booking not found');
  assert.equal(calls.length, 4);
});

test('Cancel with no reply shows message and does not refetch', async () => {
  const { els, button, calls } = await clickCancel();
  calls[2].fail();
  await flush();
  assert.equal(els.error.textContent, NO_REPLY);
  assert.equal(button.disabled, false);
  assert.equal(calls.length, 3);
});
