// public/app.js booking submit and cancel flows, run in the fake browser.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flush } from './helpers/fake-dom.mjs';
import { FAILED, NO_REPLY, boot, errorText } from './helpers/app.mjs';

const ALPHA_BOOKING = { id: 7, room: 'Aurora', title: 'Alpha', date: '2026-11-03', start: '09:00', end: '10:00' };
const BETA_BOOKING = { id: 12, room: 'Cosmos', title: 'Beta', date: '2026-11-04', start: '11:00', end: '12:00' };
const CONFLICT = 'room is already booked from 09:00 to 10:00';
const VALUES = { room: 'Borealis', title: '  Team  sync ', date: '2026-11-3', start: '9:00', end: '' };

function fillForm(page, values = VALUES) {
  for (const [id, v] of Object.entries(values)) page.el(id).value = v;
}

const cancelButton = (page, index) => page.el('booking-list').children[index].children[0];
const submit = (page) => page.el('booking-form').dispatch('submit');
const formValues = (page) => Object.fromEntries(Object.keys(VALUES).map((k) => [k, page.el(k).value]));

/** Submits and returns the POST call. */
function startSubmit(page) {
  const before = page.fetches.length;
  submit(page);
  assert.strictEqual(page.fetches.length, before + 1);
  return page.lastFetch();
}

/** Boots, fills the form, and shows `message` in #error through a 409 submit. */
async function bootWithError(bookings, message = CONFLICT) {
  const page = await boot({ bookings });
  fillForm(page);
  startSubmit(page).reply(409, { error: message });
  await flush();
  assert.strictEqual(errorText(page), message);
  return page;
}

const SETTLERS = {
  'reply 201': (call) => call.reply(201, ALPHA_BOOKING),
  'reply 409': (call) => call.reply(409, { error: CONFLICT }),
  'fail()': (call) => call.fail(),
  'replyNotJson(201)': (call) => call.replyNotJson(201),
};

test('submit sends the exact POST request and disables Book', async () => {
  const page = await boot();
  fillForm(page);
  const before = page.fetches.length;
  const event = submit(page);
  assert.strictEqual(event.preventDefaultCalls, 1);
  assert.strictEqual(page.fetches.length, before + 1);
  const call = page.lastFetch();
  assert.strictEqual(call.url, '/api/bookings');
  assert.deepStrictEqual(Object.keys(call.options).sort(), ['body', 'headers', 'method']);
  assert.strictEqual(call.method, 'POST');
  // Entries: the headers object comes from the vm realm, so its prototype differs.
  assert.deepStrictEqual(Object.entries(call.options.headers), [['Content-Type', 'application/json']]);
  assert.deepStrictEqual(JSON.parse(call.options.body), VALUES);
  assert.strictEqual(page.el('book').disabled, true);
  assert.deepStrictEqual(page.violations, []);
});

test('second submit while pending is prevented and sends nothing', async () => {
  const page = await boot();
  fillForm(page);
  startSubmit(page);
  const count = page.fetches.length;
  const event = submit(page);
  assert.strictEqual(event.preventDefaultCalls, 1);
  assert.strictEqual(page.fetches.length, count);
  assert.deepStrictEqual(page.violations, []);
});

test('submit with Book disabled by the test sends nothing', async () => {
  const page = await boot();
  fillForm(page);
  page.el('book').disabled = true;
  const count = page.fetches.length;
  const event = submit(page);
  assert.strictEqual(event.preventDefaultCalls, 1);
  assert.strictEqual(page.fetches.length, count);
  assert.deepStrictEqual(page.violations, []);
});

for (const [name, settle] of Object.entries(SETTLERS)) {
  test(`Book is enabled first when the request settles: ${name}`, async () => {
    const page = await boot();
    fillForm(page);
    const call = startSubmit(page);
    const index = page.log.length;
    settle(call);
    await flush();
    const after = page.log.slice(index).filter((entry) => !entry.startsWith('response.'));
    assert.strictEqual(after[0], '#book.disabled=false');
    assert.strictEqual(page.el('book').disabled, false);
    assert.deepStrictEqual(page.violations, []);
  });
}

test('Book stays disabled until the reply body arrives', async () => {
  const page = await boot();
  fillForm(page);
  const later = startSubmit(page).replyLater(201);
  await flush();
  assert.strictEqual(page.el('book').disabled, true);
  later.send(ALPHA_BOOKING);
  await flush();
  assert.strictEqual(page.el('book').disabled, false);
  assert.deepStrictEqual(page.violations, []);
});

test('201 empties title and error, keeps other values, refetches the filtered list', async () => {
  const page = await bootWithError([ALPHA_BOOKING]);
  page.el('filter-date').value = '2026-11-03';
  const lists = page.listFetches().length;
  startSubmit(page).reply(201, ALPHA_BOOKING);
  await flush();
  assert.strictEqual(page.el('title').value, '');
  assert.deepStrictEqual(formValues(page), { ...VALUES, title: '' });
  assert.strictEqual(errorText(page), '');
  assert.strictEqual(page.listFetches().length, lists + 1);
  assert.strictEqual(page.lastFetch().url, '/api/bookings?date=2026-11-03');
  assert.deepStrictEqual(page.violations, []);
});

const ERROR_CASES = [
  ['409 error message', 409, { error: CONFLICT }, CONFLICT],
  ['400 error message', 400, { error: 'title must be 1 to 80 characters' }, 'title must be 1 to 80 characters'],
  ['500 error message', 500, { error: 'internal error' }, 'internal error'],
  ['200 instead of 201', 200, { id: 1, ...ALPHA_BOOKING }, FAILED],
  ['415 non-string error', 415, { error: 1 }, FAILED],
  ['400 array body', 400, [], FAILED],
];

for (const [name, status, body, expected] of ERROR_CASES) {
  test(`submit error status: ${name}`, async () => {
    const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
    fillForm(page);
    const nodes = [...page.el('booking-list').childNodes];
    const count = page.fetches.length;
    startSubmit(page).reply(status, body);
    await flush();
    assert.strictEqual(errorText(page), expected);
    assert.deepStrictEqual(formValues(page), VALUES);
    assert.strictEqual(page.fetches.length, count + 1);
    const after = page.el('booking-list').childNodes;
    assert.strictEqual(after.length, nodes.length);
    nodes.forEach((node, i) => assert.strictEqual(after[i], node));
    assert.deepStrictEqual(page.violations, []);
  });
}

const NO_REPLY_CASES = [
  ['fail()', (call) => call.fail()],
  ['replyNotJson(201)', (call) => call.replyNotJson(201)],
  ['replyLater(201).fail()', (call) => call.replyLater(201).fail()],
];

for (const [name, settle] of NO_REPLY_CASES) {
  test(`submit with no reply: ${name}`, async () => {
    const page = await boot({ bookings: [ALPHA_BOOKING] });
    fillForm(page);
    const count = page.fetches.length;
    settle(startSubmit(page));
    await flush();
    assert.strictEqual(errorText(page), NO_REPLY);
    assert.deepStrictEqual(formValues(page), VALUES);
    assert.strictEqual(page.fetches.length, count + 1);
    assert.strictEqual(page.el('book').disabled, false);
    assert.deepStrictEqual(page.violations, []);
  });
}

test('after settling, a new submit sends a new POST', async () => {
  const page = await boot();
  fillForm(page);
  startSubmit(page).fail();
  await flush();
  const call = startSubmit(page);
  assert.strictEqual(call.method, 'POST');
  assert.strictEqual(call.url, '/api/bookings');
  assert.deepStrictEqual(page.violations, []);
});

// ---- Cancel ----

test('Cancel disables the button and sends DELETE', async () => {
  const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
  const count = page.fetches.length;
  const button = cancelButton(page, 1);
  button.click();
  assert.strictEqual(button.disabled, true);
  assert.strictEqual(page.fetches.length, count + 1);
  const call = page.lastFetch();
  assert.strictEqual(call.url, '/api/bookings/12');
  assert.strictEqual(call.method, 'DELETE');
  assert.strictEqual(call.options.body, undefined);
  assert.deepStrictEqual(page.violations, []);
});

test('Cancel 204 needs no body, clears the error and refetches the list', async () => {
  const page = await bootWithError([ALPHA_BOOKING, BETA_BOOKING]);
  const button = cancelButton(page, 1);
  const lists = page.listFetches().length;
  button.click();
  page.lastFetch().reply(204);
  await flush();
  assert.strictEqual(button.disabled, false);
  assert.strictEqual(errorText(page), '');
  assert.strictEqual(page.listFetches().length, lists + 1);
  assert.deepStrictEqual(page.violations, []);
});

const CANCEL_ERRORS = [
  ['404 message', 404, { error: 'booking not found' }, 'booking not found'],
  ['500 message', 500, { error: 'internal error' }, 'internal error'],
  ['404 string body', 404, 'x', FAILED],
  ['200 instead of 204', 200, {}, FAILED],
];

for (const [name, status, body, expected] of CANCEL_ERRORS) {
  test(`Cancel error status: ${name}`, async () => {
    const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
    const button = cancelButton(page, 0);
    const lists = page.listFetches().length;
    button.click();
    assert.strictEqual(page.lastFetch().url, '/api/bookings/7');
    page.lastFetch().reply(status, body);
    await flush();
    assert.strictEqual(errorText(page), expected);
    assert.strictEqual(button.disabled, false);
    assert.strictEqual(page.listFetches().length, lists + 1);
    assert.deepStrictEqual(page.violations, []);
  });
}

const CANCEL_NO_REPLY = [
  ['fail()', (call) => call.fail()],
  ['replyNotJson(404)', (call) => call.replyNotJson(404)],
  ['replyLater(404).fail()', (call) => call.replyLater(404).fail()],
];

for (const [name, settle] of CANCEL_NO_REPLY) {
  test(`Cancel with no reply: ${name}`, async () => {
    const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
    const button = cancelButton(page, 1);
    button.click();
    const count = page.fetches.length;
    settle(page.lastFetch());
    await flush();
    assert.strictEqual(errorText(page), NO_REPLY);
    assert.strictEqual(page.fetches.length, count);
    assert.strictEqual(button.disabled, false);
    assert.deepStrictEqual(page.violations, []);
  });
}

test('Cancel stays disabled while the DELETE body is pending', async () => {
  const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
  const button = cancelButton(page, 0);
  button.click();
  const later = page.lastFetch().replyLater(404);
  await flush();
  assert.strictEqual(button.disabled, true);
  later.send({ error: 'booking not found' });
  await flush();
  assert.strictEqual(button.disabled, false);
  assert.strictEqual(errorText(page), 'booking not found');
  assert.deepStrictEqual(page.violations, []);
});

test('every Cancel button has type button', async () => {
  const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
  assert.deepStrictEqual([0, 1].map((i) => cancelButton(page, i).type), ['button', 'button']);
  assert.deepStrictEqual(page.violations, []);
});

test('double click on a pending Cancel sends one DELETE', async () => {
  const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
  const count = page.fetches.length;
  const button = cancelButton(page, 0);
  button.click();
  button.click();
  assert.strictEqual(page.fetches.length, count + 1);
  assert.strictEqual(page.lastFetch().method, 'DELETE');
  assert.deepStrictEqual(page.violations, []);
});

test('Cancel refetch uses the date filter', async () => {
  const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
  page.el('filter-date').value = '2026-11-03';
  cancelButton(page, 0).click();
  page.lastFetch().reply(204);
  await flush();
  assert.strictEqual(page.lastFetch().method, 'GET');
  assert.strictEqual(page.lastFetch().url, '/api/bookings?date=2026-11-03');
  assert.deepStrictEqual(page.violations, []);
});

test('Cancel refetch obeys last started wins', async () => {
  const page = await boot({ bookings: [ALPHA_BOOKING, BETA_BOOKING] });
  cancelButton(page, 0).click();
  page.lastFetch().reply(204);
  await flush();
  const refetch = page.lastFetch();
  assert.strictEqual(refetch.url, '/api/bookings');
  page.el('filter-date').value = '2026-11-03';
  page.el('filter-date').dispatch('change');
  const filtered = page.lastFetch();
  assert.strictEqual(filtered.url, '/api/bookings?date=2026-11-03');
  filtered.reply(200, { bookings: [ALPHA_BOOKING] });
  await flush();
  refetch.reply(200, { bookings: [BETA_BOOKING] });
  await flush();
  const items = page.el('booking-list').children;
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].childNodes[0].data, '2026-11-03 09:00-10:00 Aurora: Alpha');
  assert.deepStrictEqual(page.violations, []);
});
