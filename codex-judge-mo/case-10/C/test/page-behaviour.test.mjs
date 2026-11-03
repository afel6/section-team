import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDom, createFakeFetch, loadApp, flush } from './helpers/fake-dom.mjs';

const NO_REPLY = 'Could not reach the server.';
const unhandled = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));

const B1 = { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' };
const B2 = { id: 2, room: 'Cosmos', title: 'Review', date: '2026-11-01', start: '13:00', end: '14:30' };

function boot() {
  const dom = createFakeDom();
  const f = createFakeFetch(dom.log);
  loadApp({ document: dom.document, fetch: f.fetch });
  const els = dom.elements;
  return { dom, f, els, log: dom.log, rooms: f.calls[0], list: f.calls[1] };
}

async function bootWithList(bookings) {
  const t = boot();
  t.f.respond(t.list, 200, { bookings });
  await flush();
  return t;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function itemsOf(t) {
  return t.els['booking-list'].children;
}

async function fillAndSubmit(t) {
  const { els } = t;
  els.room.value = 'Aurora';
  els.title.value = '  Standup  ';
  els.date.value = '2026-11-03';
  els.start.value = '09:00';
  els.end.value = '10:00';
  const ev = { prevented: 0, preventDefault() { this.prevented += 1; } };
  els['booking-form'].dispatch('submit', ev);
  return ev;
}

// ---------- Load ----------

test('load: two fetches start synchronously with one argument', () => {
  const t = boot();
  assert.equal(t.f.calls.length, 2);
  assert.equal(t.f.calls[0].url, '/api/rooms');
  assert.equal(t.f.calls[1].url, '/api/bookings');
  for (const c of t.f.calls) {
    assert.equal(c.options, undefined);
  }
});

test('load: only the three expected listeners are registered', () => {
  const t = boot();
  for (const [id, el] of Object.entries(t.els)) {
    const expected = { 'booking-form': ['submit'], 'filter-date': ['change'], 'show-all': ['click'] }[id] || [];
    assert.deepEqual(el.listenerTypes(), expected, id);
  }
  assert.equal(t.els['filter-date'].listeners('input').length, 0);
});

test('load: no unexpected globals needed and no stray DOM writes', () => {
  const t = boot();
  assert.deepEqual(t.log.filter((e) => e[0] !== 'fetch'), []);
});

// ---------- Rooms ----------

test('rooms: fills one option per room in order', async () => {
  const t = boot();
  t.f.respond(t.rooms, 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  await flush();
  const opts = t.els.room.children;
  assert.equal(opts.length, 3);
  assert.deepEqual(opts.map((o) => o.tagName), ['OPTION', 'OPTION', 'OPTION']);
  assert.deepEqual(opts.map((o) => o.value), ['Aurora', 'Borealis', 'Cosmos']);
  assert.deepEqual(opts.map((o) => o.textContent), ['Aurora', 'Borealis', 'Cosmos']);
});

test('rooms: error status shows the error string and leaves select empty', async () => {
  const t = boot();
  t.f.respond(t.rooms, 500, { error: 'boom' });
  await flush();
  assert.equal(t.els.error.textContent, 'boom');
  assert.equal(t.els.room.children.length, 0);
});

for (const body of [{ error: 5 }, [], 'x', {}, [{ error: 'x' }], null]) {
  test(`rooms: error body ${JSON.stringify(body)} gives fallback message`, async () => {
    const t = boot();
    t.f.respond(t.rooms, 500, body);
    await flush();
    assert.equal(t.els.error.textContent, 'Request failed.');
    assert.equal(t.els.room.children.length, 0);
  });
}

test('rooms: no reply (fetch rejects)', async () => {
  const t = boot();
  t.f.fail(t.rooms);
  await flush();
  assert.equal(t.els.error.textContent, NO_REPLY);
  assert.equal(t.els.room.children.length, 0);
});

test('rooms: json() rejecting on non-204 counts as no reply', async () => {
  const t = boot();
  t.f.respondRaw(t.rooms, 200, () => Promise.reject(new SyntaxError('bad')));
  await flush();
  assert.equal(t.els.error.textContent, NO_REPLY);
  assert.equal(t.els.room.children.length, 0);
});

test('rooms: reply arriving after the list reply works', async () => {
  const t = boot();
  t.f.respond(t.list, 200, { bookings: [B1] });
  await flush();
  t.f.respond(t.rooms, 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  await flush();
  assert.equal(t.els.room.children.length, 3);
  assert.equal(itemsOf(t).length, 1);
});

test('rooms: 201 reply with rooms is an error status, select stays empty', async () => {
  const t = boot();
  t.f.respond(t.rooms, 201, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  await flush();
  assert.equal(t.els.error.textContent, 'Request failed.');
  assert.equal(t.els.room.children.length, 0);
});

// ---------- List rendering ----------

test('list: renders items in reply order with text node and Cancel button', async () => {
  const t = await bootWithList([B1, B2]);
  const items = itemsOf(t);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.tagName), ['LI', 'LI']);
  const texts = ['2026-11-03 09:00-10:00 Aurora: Standup', '2026-11-01 13:00-14:30 Cosmos: Review'];
  items.forEach((li, i) => {
    assert.equal(li.children.length, 2);
    assert.equal(li.children[0].nodeType, 3);
    assert.equal(li.children[0].textContent, texts[i]);
    assert.equal(li.children[1].tagName, 'BUTTON');
    assert.equal(li.children[1].type, 'button');
    assert.equal(li.children[1].textContent, 'Cancel');
  });
});

test('list: HTML in a title stays plain text', async () => {
  const t = await bootWithList([{ ...B1, title: '<b>x</b>' }]);
  const li = itemsOf(t)[0];
  assert.equal(li.children.length, 2);
  assert.equal(li.children[0].nodeType, 3);
  assert.equal(li.children[0].textContent, '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
});

test('list: title is shown untrimmed', async () => {
  const t = await bootWithList([{ ...B1, title: ' x ' }]);
  assert.equal(itemsOf(t)[0].children[0].textContent, '2026-11-03 09:00-10:00 Aurora:  x ');
});

test('list: empty list shows a single No bookings. item', async () => {
  const t = await bootWithList([]);
  const items = itemsOf(t);
  assert.equal(items.length, 1);
  assert.equal(items[0].tagName, 'LI');
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].nodeType, 3);
  assert.equal(items[0].children[0].textContent, 'No bookings.');
});

test('list: success leaves #error alone', async () => {
  const t = boot();
  t.f.respond(t.rooms, 500, { error: 'boom' });
  await flush();
  t.f.respond(t.list, 200, { bookings: [B1] });
  await flush();
  assert.equal(t.els.error.textContent, 'boom');
  assert.equal(itemsOf(t).length, 1);
});

// ---------- List errors ----------

test('list errors: error status shows message, list keeps same children', async () => {
  const t = await bootWithList([B1, B2]);
  const before = [...itemsOf(t)];
  t.els['filter-date'].dispatch('change', {});
  t.f.respond(t.f.calls[2], 500, { error: 'date must be a valid YYYY-MM-DD date' });
  await flush();
  assert.equal(t.els.error.textContent, 'date must be a valid YYYY-MM-DD date');
  assert.equal(itemsOf(t).length, 2);
  itemsOf(t).forEach((li, i) => assert.equal(li, before[i]));
});

test('list errors: no reply shows message, list unchanged', async () => {
  const t = await bootWithList([B1]);
  const before = [...itemsOf(t)];
  t.els['filter-date'].dispatch('change', {});
  t.f.fail(t.f.calls[2]);
  await flush();
  assert.equal(t.els.error.textContent, NO_REPLY);
  assert.equal(itemsOf(t)[0], before[0]);
  assert.equal(itemsOf(t).length, 1);
});

test('list errors: 204 reply is an error status without a body, list unchanged', async () => {
  const t = await bootWithList([B1]);
  const before = [...itemsOf(t)];
  t.els['filter-date'].dispatch('change', {});
  const call = t.f.calls[2];
  t.f.respondRaw(call, 204, () => Promise.reject(new Error('must not be read')));
  await flush();
  assert.equal(call.jsonCalls, 0);
  assert.equal(t.els.error.textContent, 'Request failed.');
  assert.equal(itemsOf(t).length, 1);
  assert.equal(itemsOf(t)[0], before[0]);
});

test('list errors: 201 reply with bookings is an error status, list unchanged', async () => {
  const t = await bootWithList([B1]);
  const before = [...itemsOf(t)];
  t.els['filter-date'].dispatch('change', {});
  t.f.respond(t.f.calls[2], 201, { bookings: [] });
  await flush();
  assert.equal(t.els.error.textContent, 'Request failed.');
  assert.equal(itemsOf(t).length, 1);
  assert.equal(itemsOf(t)[0], before[0]);
});

// ---------- Filter ----------

test('filter: change fetches with the date appended', async () => {
  const t = boot();
  t.els['filter-date'].value = '2026-11-03';
  t.els['filter-date'].dispatch('change', {});
  assert.equal(t.f.calls.length, 3);
  assert.equal(t.f.calls[2].url, '/api/bookings?date=2026-11-03');
  assert.equal(t.f.calls[2].options, undefined);
});

test('filter: value is not encoded', () => {
  const t = boot();
  t.els['filter-date'].value = 'a b&c';
  t.els['filter-date'].dispatch('change', {});
  assert.equal(t.f.calls[2].url, '/api/bookings?date=a b&c');
});

test('filter: empty value fetches the plain URL', () => {
  const t = boot();
  t.els['filter-date'].dispatch('change', {});
  assert.equal(t.f.calls[2].url, '/api/bookings');
});

test('filter: input event does nothing', async () => {
  const t = boot();
  t.els['filter-date'].value = '2026-11-03';
  t.els['filter-date'].dispatch('input', {});
  await flush();
  assert.equal(t.f.calls.length, 2);
});

// ---------- Show all ----------

test('show all: clears filter and fetches exactly once', async () => {
  const t = boot();
  t.els['filter-date'].value = 'x';
  t.els['show-all'].dispatch('click', {});
  assert.equal(t.els['filter-date'].value, '');
  assert.equal(t.f.calls.length, 3);
  assert.equal(t.f.calls[2].url, '/api/bookings');
  await flush();
  assert.equal(t.f.calls.length, 3);
});

// ---------- Last started wins ----------

test('last started wins: B then A success applies B', async () => {
  const t = boot();
  t.els['filter-date'].dispatch('change', {});
  const [a, b] = [t.list, t.f.calls[2]];
  t.f.respond(b, 200, { bookings: [B2] });
  await flush();
  t.f.respond(a, 200, { bookings: [B1] });
  await flush();
  assert.equal(itemsOf(t).length, 1);
  assert.match(itemsOf(t)[0].children[0].textContent, /Cosmos: Review$/);
});

test('last started wins: stale error status after B is ignored', async () => {
  const t = boot();
  t.els['filter-date'].dispatch('change', {});
  t.f.respond(t.f.calls[2], 200, { bookings: [B2] });
  await flush();
  t.f.respond(t.list, 500, { error: 'stale' });
  await flush();
  assert.equal(t.els.error.textContent, '');
  assert.equal(itemsOf(t).length, 1);
});

test('last started wins: stale no-reply after B is ignored', async () => {
  const t = boot();
  t.els['filter-date'].dispatch('change', {});
  t.f.respond(t.f.calls[2], 200, { bookings: [B2] });
  await flush();
  t.f.fail(t.list);
  await flush();
  assert.equal(t.els.error.textContent, '');
});

test('last started wins: A resolving first is ignored entirely, then B applies', async () => {
  const t = boot();
  t.els['filter-date'].dispatch('change', {});
  t.f.respond(t.list, 200, { bookings: [B1] });
  await flush();
  assert.equal(itemsOf(t).length, 0);
  assert.equal(t.els.error.textContent, '');
  t.f.respond(t.f.calls[2], 200, { bookings: [B2] });
  await flush();
  assert.equal(itemsOf(t).length, 1);
  assert.match(itemsOf(t)[0].children[0].textContent, /Cosmos/);
});

// ---------- Submit ----------

test('submit: preventDefault exactly once, even when Book is disabled', async () => {
  const t = boot();
  const ev1 = await fillAndSubmit(t);
  assert.equal(ev1.prevented, 1);
  const ev2 = { prevented: 0, preventDefault() { this.prevented += 1; } };
  t.els['booking-form'].dispatch('submit', ev2);
  assert.equal(ev2.prevented, 1);
});

test('submit: disabled Book sends nothing', async () => {
  const t = boot();
  t.els.book.disabled = true;
  await fillAndSubmit(t);
  await flush();
  assert.equal(t.f.calls.length, 2);
});

test('submit: disables Book synchronously and posts untrimmed values', async () => {
  const t = boot();
  await fillAndSubmit(t);
  assert.equal(t.els.book.disabled, true);
  const call = t.f.calls[2];
  assert.equal(call.url, '/api/bookings');
  assert.equal(call.argCount, 2);
  const o = call.options;
  assert.deepEqual(Object.keys(o).sort(), ['body', 'headers', 'method']);
  assert.equal(o.method, 'POST');
  assert.deepEqual(Object.keys(o.headers), ['Content-Type']);
  assert.equal(o.headers['Content-Type'], 'application/json');
  assert.deepEqual(plain(JSON.parse(o.body)), {
    room: 'Aurora', title: '  Standup  ', date: '2026-11-03', start: '09:00', end: '10:00'
  });
  assert.equal(Object.keys(JSON.parse(o.body)).length, 5);
});

test('submit: second submit while pending sends nothing', async () => {
  const t = boot();
  await fillAndSubmit(t);
  t.els['booking-form'].dispatch('submit', { preventDefault() {} });
  await flush();
  assert.equal(t.f.calls.length, 3);
});

test('submit 201: re-enables Book first, then clears title and error, then refetches', async () => {
  const t = boot();
  await fillAndSubmit(t);
  const mark = t.log.length;
  t.f.respond(t.f.calls[2], 201, { id: 3 });
  await flush();
  const after = t.log.slice(mark);
  assert.deepEqual(after[0], ['disabled', 'book', false]);
  const idx = (entry) => after.findIndex((e) => JSON.stringify(e) === JSON.stringify(entry));
  assert.ok(idx(['value', 'title', '']) > 0);
  assert.ok(idx(['textContent', 'error', '']) > 0);
  assert.ok(idx(['fetch', '/api/bookings']) > idx(['value', 'title', '']));
  assert.ok(idx(['fetch', '/api/bookings']) > idx(['textContent', 'error', '']));
  assert.equal(t.els.title.value, '');
  assert.equal(t.els.room.value, 'Aurora');
  assert.equal(t.els.date.value, '2026-11-03');
  assert.equal(t.els.start.value, '09:00');
  assert.equal(t.els.end.value, '10:00');
  assert.equal(t.els.error.textContent, '');
  assert.equal(t.f.calls.length, 4);
  assert.equal(t.f.calls[3].url, '/api/bookings');
});

/** The first log entry after `mark` re-enables Book, and the error text `msg` comes after it. */
function assertBookEnabledBeforeError(t, mark, msg) {
  const after = t.log.slice(mark);
  assert.deepEqual(after[0], ['disabled', 'book', false]);
  const errIdx = after.findIndex((e) => JSON.stringify(e) === JSON.stringify(['textContent', 'error', msg]));
  assert.ok(errIdx > 0, `error text ${JSON.stringify(msg)} must be set after Book is re-enabled`);
}

test('submit 409: shows the message, keeps title, enables Book, no refetch', async () => {
  const t = boot();
  await fillAndSubmit(t);
  const msg = 'room is already booked from 09:00 to 10:00';
  const mark = t.log.length;
  t.f.respond(t.f.calls[2], 409, { error: msg });
  await flush();
  assertBookEnabledBeforeError(t, mark, msg);
  assert.equal(t.els.error.textContent, msg);
  assert.equal(t.els.title.value, '  Standup  ');
  assert.equal(t.els.book.disabled, false);
  assert.equal(t.f.calls.length, 3);
});

test('submit 400 with empty object body gives fallback', async () => {
  const t = boot();
  await fillAndSubmit(t);
  const mark = t.log.length;
  t.f.respond(t.f.calls[2], 400, {});
  await flush();
  assertBookEnabledBeforeError(t, mark, 'Request failed.');
  assert.equal(t.els.error.textContent, 'Request failed.');
  assert.equal(t.els.book.disabled, false);
});

test('submit: no reply', async () => {
  const t = boot();
  await fillAndSubmit(t);
  const mark = t.log.length;
  t.f.fail(t.f.calls[2]);
  await flush();
  assertBookEnabledBeforeError(t, mark, NO_REPLY);
  assert.equal(t.els.error.textContent, NO_REPLY);
  assert.equal(t.els.book.disabled, false);
  assert.equal(t.els.title.value, '  Standup  ');
  assert.equal(t.f.calls.length, 3);
});

test('submit: json() rejecting on 201 counts as no reply', async () => {
  const t = boot();
  await fillAndSubmit(t);
  const mark = t.log.length;
  t.f.respondRaw(t.f.calls[2], 201, () => Promise.reject(new SyntaxError('bad')));
  await flush();
  assertBookEnabledBeforeError(t, mark, NO_REPLY);
  assert.equal(t.els.error.textContent, NO_REPLY);
  assert.equal(t.els.book.disabled, false);
  assert.equal(t.els.title.value, '  Standup  ');
  assert.equal(t.f.calls.length, 3);
});

test('submit 200: is an error status, keeps title, enables Book, no refetch', async () => {
  const t = boot();
  await fillAndSubmit(t);
  const mark = t.log.length;
  t.f.respond(t.f.calls[2], 200, { id: 1, ...B1 });
  await flush();
  assertBookEnabledBeforeError(t, mark, 'Request failed.');
  assert.equal(t.els.error.textContent, 'Request failed.');
  assert.equal(t.els.title.value, '  Standup  ');
  assert.equal(t.els.book.disabled, false);
  assert.equal(t.f.calls.length, 3);
});

// ---------- Cancel ----------

async function bootWithCancel() {
  const t = boot();
  t.f.respond(t.rooms, 500, { error: 'old' });
  t.f.respond(t.list, 200, { bookings: [{ ...B1, id: 7 }] });
  await flush();
  const button = itemsOf(t)[0].children[1];
  button.dispatch('click', {});
  return { t, button, call: t.f.calls[2] };
}

test('cancel: disables the button synchronously and sends DELETE', async () => {
  const { button, call } = await bootWithCancel();
  assert.equal(button.disabled, true);
  assert.equal(call.url, '/api/bookings/7');
  assert.equal(call.argCount, 2);
  assert.deepEqual(plain(call.options), { method: 'DELETE' });
  assert.deepEqual(Object.keys(call.options), ['method']);
});

test('cancel 204: json never read, error emptied, list refetched', async () => {
  const { t, button, call } = await bootWithCancel();
  assert.equal(t.els.error.textContent, 'old');
  t.f.respondRaw(call, 204, () => Promise.reject(new Error('must not be read')));
  await flush();
  assert.equal(call.jsonCalls, 0);
  assert.equal(button.disabled, false);
  assert.equal(t.els.error.textContent, '');
  assert.equal(t.f.calls.length, 4);
  assert.equal(t.f.calls[3].url, '/api/bookings');
});

test('cancel 404: shows message, enables button, refetches', async () => {
  const { t, button, call } = await bootWithCancel();
  t.f.respond(call, 404, { error: 'booking not found' });
  await flush();
  assert.equal(t.els.error.textContent, 'booking not found');
  assert.equal(button.disabled, false);
  assert.equal(t.f.calls.length, 4);
  assert.equal(t.f.calls[3].url, '/api/bookings');
});

test('cancel 200 with empty object: is an error status, fallback message, refetches', async () => {
  const { t, button, call } = await bootWithCancel();
  t.f.respond(call, 200, {});
  await flush();
  assert.equal(t.els.error.textContent, 'Request failed.');
  assert.equal(button.disabled, false);
  assert.equal(t.f.calls.length, 4);
  assert.equal(t.f.calls[3].url, '/api/bookings');
});

test('cancel 200 with an error string: shows it and refetches', async () => {
  const { t, call } = await bootWithCancel();
  t.f.respond(call, 200, { error: 'x' });
  await flush();
  assert.equal(t.els.error.textContent, 'x');
  assert.equal(t.f.calls.length, 4);
  assert.equal(t.f.calls[3].url, '/api/bookings');
});

test('cancel: non-JSON error body counts as no reply, no refetch', async () => {
  const { t, call } = await bootWithCancel();
  t.f.respondRaw(call, 500, () => Promise.reject(new SyntaxError('bad')));
  await flush();
  assert.equal(t.els.error.textContent, NO_REPLY);
  assert.equal(t.f.calls.length, 3);
});

test('cancel: fetch rejects shows no-reply, enables button, no refetch', async () => {
  const { t, button, call } = await bootWithCancel();
  t.f.fail(call);
  await flush();
  assert.equal(t.els.error.textContent, NO_REPLY);
  assert.equal(button.disabled, false);
  assert.equal(t.f.calls.length, 3);
});

// ---------- Globals / unhandled rejections ----------

test('script needs only fetch and document, and leaves no unhandled rejections', async () => {
  const t = boot();
  t.f.fail(t.rooms);
  t.f.fail(t.list);
  await flush();
  assert.deepEqual(unhandled, []);
});
