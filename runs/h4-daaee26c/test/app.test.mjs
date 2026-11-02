import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  boot, readList, cancelButtons, text, childCount, optionsOf, plain, APP_PATH, HTML_PATH,
} from './helpers/fake-dom.mjs';

const BOOKING = {
  id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00',
};
const ERR_UNREACHABLE = 'Could not reach the server.';
const ERR_FALLBACK = 'Request failed.';

// Boots the page and answers the two load fetches.
async function loaded({ rooms = ['Aurora'], bookings = [BOOKING] } = {}) {
  const page = boot();
  page.respond(page.calls[0], 200, { rooms });
  page.respond(page.calls[1], 200, { bookings });
  await page.flush();
  return page;
}

const liText = (page) => readList(page).map((li) => li.children.map((c) => c.text));

// ---------------------------------------------------------------- Load

test('load: two fetches start synchronously, rooms first then bookings', () => {
  const page = boot();
  assert.equal(page.calls.length, 2);
  assert.equal(page.calls[0].url, '/api/rooms');
  assert.equal(page.calls[1].url, '/api/bookings');
  for (const call of page.calls) {
    const options = call.options === undefined ? {} : plain(call.options);
    assert.ok(options.method === undefined || options.method === 'GET');
    assert.equal(options.body, undefined);
  }
});

test('rooms: one option per room in order, value and text are the name', async () => {
  const page = boot();
  page.respond(page.calls[0], 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  await page.flush();
  assert.deepEqual(optionsOf(page.els.room), ['Aurora', 'Borealis', 'Cosmos'].map((n) => (
    { tag: 'option', value: n, text: n })));
});

test('rooms: error status shows the error message and leaves the select empty', async () => {
  const page = boot();
  page.respond(page.calls[0], 500, { error: 'boom' });
  await page.flush();
  assert.equal(text(page.els.error), 'boom');
  assert.equal(childCount(page.els.room), 0);
});

test('rooms: error status with a non-usable body shows Request failed.', async () => {
  for (const body of [{ error: 5 }, [], 'str']) {
    const page = boot();
    page.respond(page.calls[0], 500, body);
    await page.flush();
    assert.equal(text(page.els.error), ERR_FALLBACK, JSON.stringify(body));
    assert.equal(childCount(page.els.room), 0);
  }
});

test('rooms: unreadable body or failed fetch shows the unreachable message', async () => {
  const a = boot();
  a.respondJsonFails(a.calls[0], 200);
  await a.flush();
  assert.equal(text(a.els.error), ERR_UNREACHABLE);
  assert.equal(childCount(a.els.room), 0);
  const b = boot();
  b.fail(b.calls[0]);
  await b.flush();
  assert.equal(text(b.els.error), ERR_UNREACHABLE);
  assert.equal(childCount(b.els.room), 0);
});

test('rooms: a non-200 success-looking status is an error', async () => {
  const page = boot();
  page.respond(page.calls[0], 201, { rooms: ['X'] });
  await page.flush();
  assert.equal(childCount(page.els.room), 0);
  assert.equal(text(page.els.error), ERR_FALLBACK);
});

// ---------------------------------------------------------------- List

test('list: item has exactly a text node and a Cancel button', async () => {
  const page = await loaded();
  assert.deepEqual(readList(page), [{
    tag: 'li',
    children: [
      { kind: 'text', text: '2026-11-03 09:00-10:00 Aurora: Standup' },
      { kind: 'el', tag: 'button', type: 'button', text: 'Cancel' },
    ],
  }]);
});

test('list: reply order is preserved exactly', async () => {
  const bookings = [
    { ...BOOKING, id: 3, title: 'C', date: '2026-12-01', start: '15:00', end: '16:00' },
    { ...BOOKING, id: 1, title: 'A', date: '2026-11-03', start: '11:00', end: '12:00' },
    { ...BOOKING, id: 2, title: 'B', date: '2026-11-03', start: '09:00', end: '10:00', room: 'Cosmos' },
  ];
  const page = await loaded({ bookings });
  assert.deepEqual(liText(page).map(([t]) => t), [
    '2026-12-01 15:00-16:00 Aurora: C',
    '2026-11-03 11:00-12:00 Aurora: A',
    '2026-11-03 09:00-10:00 Cosmos: B',
  ]);
});

test('list: empty reply shows a single No bookings. item', async () => {
  const page = await loaded({ bookings: [] });
  assert.deepEqual(readList(page), [{
    tag: 'li', children: [{ kind: 'text', text: 'No bookings.' }],
  }]);
});

test('list: an empty reply replaces earlier items', async () => {
  const page = await loaded();
  page.els['filter-date'].value = '2030-01-01';
  page.els['filter-date']._dispatch('change');
  page.respond(page.calls[2], 200, { bookings: [] });
  await page.flush();
  assert.deepEqual(liText(page), [['No bookings.']]);
});

test('list: titles are shown as plain text', async () => {
  const page = await loaded({ bookings: [{ ...BOOKING, title: '<b>x</b>' }] });
  assert.equal(liText(page)[0][0], '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
});

test('list: error status shows the message and keeps the list', async () => {
  const page = await loaded();
  const before = readList(page);
  page.els['filter-date'].value = 'bad';
  page.els['filter-date']._dispatch('change');
  page.respond(page.calls[2], 400, { error: 'date must be a valid YYYY-MM-DD date' });
  await page.flush();
  assert.equal(text(page.els.error), 'date must be a valid YYYY-MM-DD date');
  assert.deepEqual(readList(page), before);
});

test('list: 204 or 201 on a GET is an error status', async () => {
  const page = await loaded();
  const before = readList(page);
  page.els['filter-date']._dispatch('change');
  page.respond(page.calls[2], 201, { bookings: [] });
  await page.flush();
  assert.equal(text(page.els.error), ERR_FALLBACK);
  assert.deepEqual(readList(page), before);
});

test('list: no reply shows unreachable and keeps the list', async () => {
  const page = await loaded();
  const before = readList(page);
  page.els['filter-date']._dispatch('change');
  page.fail(page.calls[2]);
  await page.flush();
  assert.equal(text(page.els.error), ERR_UNREACHABLE);
  assert.deepEqual(readList(page), before);
  page.els['filter-date']._dispatch('change');
  page.respondJsonFails(page.calls[3], 200);
  await page.flush();
  assert.equal(text(page.els.error), ERR_UNREACHABLE);
  assert.deepEqual(readList(page), before);
});

test('list: a successful fetch leaves #error alone', async () => {
  const page = boot();
  page.respond(page.calls[0], 500, { error: 'boom' });
  page.respond(page.calls[1], 200, { bookings: [BOOKING] });
  await page.flush();
  assert.equal(text(page.els.error), 'boom');
  assert.equal(liText(page).length, 1);
});

test('overlap: the last started fetch wins even if an earlier one resolves later', async () => {
  const page = boot();
  const [, a] = page.calls;
  page.els['filter-date'].value = '2026-11-03';
  page.els['filter-date']._dispatch('change');
  const b = page.calls[2];
  page.respond(b, 200, { bookings: [{ ...BOOKING, title: 'FromB' }] });
  await page.flush();
  page.respond(a, 200, { bookings: [{ ...BOOKING, title: 'FromA' }] });
  await page.flush();
  assert.deepEqual(liText(page).map(([t]) => t), ['2026-11-03 09:00-10:00 Aurora: FromB']);
});

test('overlap: earlier fetch ending in error or no reply after the last changes nothing', async () => {
  for (const finish of ['error', 'fail', 'jsonfail']) {
    const page = boot();
    const a = page.calls[1];
    page.els['filter-date']._dispatch('change');
    page.respond(page.calls[2], 200, { bookings: [BOOKING] });
    await page.flush();
    page.els.error.textContent = 'prev';
    const before = readList(page);
    if (finish === 'error') page.respond(a, 400, { error: 'late' });
    if (finish === 'fail') page.fail(a);
    if (finish === 'jsonfail') page.respondJsonFails(a, 200);
    await page.flush();
    assert.equal(text(page.els.error), 'prev', finish);
    assert.deepEqual(readList(page), before, finish);
  }
});

test('overlap: earlier fetch erroring before the last one is ignored', async () => {
  for (const finish of ['error', 'fail']) {
    const page = boot();
    const a = page.calls[1];
    page.els['filter-date']._dispatch('change');
    page.els.error.textContent = 'prev';
    if (finish === 'error') page.respond(a, 400, { error: 'early' });
    else page.fail(a);
    await page.flush();
    assert.equal(text(page.els.error), 'prev', finish);
    assert.equal(childCount(page.els['booking-list']), 0, finish);
    page.respond(page.calls[2], 200, { bookings: [BOOKING] });
    await page.flush();
    assert.equal(text(page.els.error), 'prev');
    assert.equal(liText(page).length, 1);
  }
});

// ---------------------------------------------------------------- Filter

test('filter: change fetches /api/bookings?date=<value>', async () => {
  const page = await loaded();
  page.els['filter-date'].value = '2026-11-03';
  page.els['filter-date']._dispatch('change');
  assert.equal(page.calls.length, 3);
  assert.equal(page.calls[2].url, '/api/bookings?date=2026-11-03');
});

test('filter: the value is passed unchanged, not encoded', async () => {
  const page = await loaded();
  page.els['filter-date'].value = 'a b&c';
  page.els['filter-date']._dispatch('change');
  assert.equal(page.calls[2].url, '/api/bookings?date=a b&c');
});

test('filter: input event does nothing', async () => {
  const page = await loaded();
  page.els['filter-date'].value = '2026-11-03';
  page.els['filter-date']._dispatch('input');
  assert.equal(page.calls.length, 2);
});

test('filter: an empty value on change fetches plain /api/bookings', async () => {
  const page = await loaded();
  page.els['filter-date']._dispatch('change');
  assert.equal(page.calls[2].url, '/api/bookings');
});

test('show all: clears the filter and fetches the list exactly once', async () => {
  const page = await loaded();
  page.els['filter-date'].value = '2026-11-03';
  page.els['show-all']._dispatch('click');
  assert.equal(page.els['filter-date'].value, '');
  assert.equal(page.calls.length, 3);
  assert.equal(page.calls[2].url, '/api/bookings');
});

// ---------------------------------------------------------------- Booking

function fillForm(page, overrides = {}) {
  const values = {
    room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides,
  };
  for (const [id, value] of Object.entries(values)) page.els[id].value = value;
  return values;
}

test('submit: prevents default, POSTs exactly the five values and disables Book', async () => {
  const page = await loaded();
  const values = fillForm(page, { title: '  hi  ' });
  const event = page.els['booking-form']._dispatch('submit');
  assert.equal(event._prevented, true);
  assert.equal(page.els.book.disabled, true);
  assert.equal(page.calls.length, 3);
  const call = page.calls[2];
  assert.equal(call.url, '/api/bookings');
  const options = call.options;
  assert.equal(options.method, 'POST');
  assert.deepEqual(Object.keys(options.headers), ['Content-Type']);
  assert.deepEqual(plain(options.headers), { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(options.body), values);
  assert.equal(JSON.parse(options.body).title, '  hi  ');
});

test('submit: empty or invalid fields are still sent as they are', async () => {
  const page = await loaded();
  fillForm(page, { room: '', title: '', date: '2026-1-3', start: '', end: '9' });
  page.els['booking-form']._dispatch('submit');
  assert.deepEqual(JSON.parse(page.calls[2].options.body), {
    room: '', title: '', date: '2026-1-3', start: '', end: '9',
  });
});

test('submit while Book is disabled prevents default and sends nothing', async () => {
  const page = await loaded();
  page.els.book.disabled = true;
  const event = page.els['booking-form']._dispatch('submit');
  assert.equal(event._prevented, true);
  assert.equal(page.calls.length, 2);
});

test('a second submit during a pending POST sends nothing', async () => {
  const page = await loaded();
  fillForm(page);
  page.els['booking-form']._dispatch('submit');
  const second = page.els['booking-form']._dispatch('submit');
  assert.equal(second._prevented, true);
  assert.equal(page.calls.length, 3);
});

test('201: title emptied, others kept, error emptied, Book enabled before list refetch', async () => {
  const page = await loaded();
  const values = fillForm(page);
  page.els.error.textContent = 'old';
  page.els['booking-form']._dispatch('submit');
  const post = page.calls[2];
  const handle = page.respondDeferredJson(post, 201, { id: 9 });
  await page.flush();
  assert.equal(page.els.book.disabled, true, 'still disabled before the body arrives');
  assert.equal(page.calls.length, 3);
  handle.resolveJson();
  await page.flush();
  assert.equal(page.els.book.disabled, false);
  assert.equal(page.els.title.value, '');
  for (const id of ['room', 'date', 'start', 'end']) assert.equal(page.els[id].value, values[id]);
  assert.equal(text(page.els.error), '');
  assert.equal(page.calls.length, 4);
  assert.equal(page.calls[3].url, '/api/bookings');
  assert.equal(page.calls[3].bookDisabled, false);
});

test('409: shows the message, keeps the title, no refetch, Book enabled', async () => {
  const page = await loaded();
  fillForm(page);
  page.els['booking-form']._dispatch('submit');
  page.respond(page.calls[2], 409, { error: 'room is already booked from 09:00 to 10:00' });
  await page.flush();
  assert.equal(text(page.els.error), 'room is already booked from 09:00 to 10:00');
  assert.equal(page.els.title.value, 'Standup');
  assert.equal(page.calls.length, 3);
  assert.equal(page.els.book.disabled, false);
  assert.equal(liText(page).length, 1);
});

test('POST error with a non-object-error body shows Request failed.', async () => {
  for (const body of [[], 'x', null, { error: 3 }, {}]) {
    const page = await loaded();
    fillForm(page);
    page.els['booking-form']._dispatch('submit');
    page.respond(page.calls[2], 400, body);
    await page.flush();
    assert.equal(text(page.els.error), ERR_FALLBACK, JSON.stringify(body));
    assert.equal(page.els.book.disabled, false);
  }
});

test('POST: unreadable error body or failed fetch shows unreachable', async () => {
  const a = await loaded();
  fillForm(a);
  a.els['booking-form']._dispatch('submit');
  a.respondJsonFails(a.calls[2], 400);
  await a.flush();
  assert.equal(text(a.els.error), ERR_UNREACHABLE);
  assert.equal(a.els.book.disabled, false);
  assert.equal(a.calls.length, 3);
  const b = await loaded();
  fillForm(b);
  b.els['booking-form']._dispatch('submit');
  b.fail(b.calls[2]);
  await b.flush();
  assert.equal(text(b.els.error), ERR_UNREACHABLE);
  assert.equal(b.els.book.disabled, false);
  assert.equal(b.els.title.value, 'Standup');
  assert.equal(b.calls.length, 3);
});

test('POST answered with 204 never reads the body and is an error', async () => {
  const page = await loaded();
  fillForm(page);
  page.els['booking-form']._dispatch('submit');
  page.respond(page.calls[2], 204, null);
  await page.flush();
  assert.equal(page.calls[2].jsonCalls, 0);
  assert.equal(text(page.els.error), ERR_FALLBACK);
  assert.equal(page.els.book.disabled, false);
  assert.equal(page.calls.length, 3);
});

test('POST answered with 200 is an error status', async () => {
  const page = await loaded();
  fillForm(page);
  page.els['booking-form']._dispatch('submit');
  page.respond(page.calls[2], 200, { id: 1 });
  await page.flush();
  assert.equal(text(page.els.error), ERR_FALLBACK);
  assert.equal(page.els.title.value, 'Standup');
  assert.equal(page.calls.length, 3);
});

// ---------------------------------------------------------------- Cancel

async function withCancel() {
  const page = await loaded({ bookings: [{ ...BOOKING, id: 7 }] });
  const button = cancelButtons(page)[0];
  page.els.error.textContent = 'old';
  button._dispatch('click');
  return { page, button, call: page.calls[2] };
}

test('cancel: click sends DELETE /api/bookings/<id> and disables the button', async () => {
  const { page, button, call } = await withCancel();
  assert.equal(call.url, '/api/bookings/7');
  assert.equal(call.options.method, 'DELETE');
  assert.equal(button.disabled, true);
  assert.equal(page.calls.length, 3);
});

test('cancel: 204 clears the error, never reads the body, refetches, re-enables', async () => {
  const { page, button, call } = await withCancel();
  page.respond(call, 204, null);
  await page.flush();
  assert.equal(call.jsonCalls, 0);
  assert.equal(text(page.els.error), '');
  assert.equal(button.disabled, false);
  assert.equal(page.calls.length, 4);
  assert.equal(page.calls[3].url, '/api/bookings');
});

test('cancel: 404 shows the message and still refetches', async () => {
  const { page, button, call } = await withCancel();
  page.respond(call, 404, { error: 'booking not found' });
  await page.flush();
  assert.equal(text(page.els.error), 'booking not found');
  assert.equal(button.disabled, false);
  assert.equal(page.calls.length, 4);
  assert.equal(page.calls[3].url, '/api/bookings');
});

test('cancel: a 200 reply to DELETE is an error status and refetches', async () => {
  const { page, call } = await withCancel();
  page.respond(call, 200, {});
  await page.flush();
  assert.equal(text(page.els.error), ERR_FALLBACK);
  assert.equal(page.calls.length, 4);
});

test('cancel: failed fetch shows unreachable, re-enables, no refetch', async () => {
  const { page, button, call } = await withCancel();
  page.fail(call);
  await page.flush();
  assert.equal(text(page.els.error), ERR_UNREACHABLE);
  assert.equal(button.disabled, false);
  assert.equal(page.calls.length, 3);
});

test('cancel: unreadable error body is no reply, no refetch', async () => {
  const { page, button, call } = await withCancel();
  page.respondJsonFails(call, 404);
  await page.flush();
  assert.equal(text(page.els.error), ERR_UNREACHABLE);
  assert.equal(button.disabled, false);
  assert.equal(page.calls.length, 3);
});

test('cancel: a click while the button is disabled sends nothing', async () => {
  const { page, button } = await withCancel();
  button._dispatch('click');
  assert.equal(page.calls.length, 3);
});

// ---------------------------------------------------------------- Static HTML

const html = fs.readFileSync(HTML_PATH, 'utf8');
const source = fs.readFileSync(APP_PATH, 'utf8');

function parseAttrs(tag) {
  const attrs = {};
  const re = /([^\s=<>/"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  const inner = tag.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
  for (const m of inner.matchAll(re)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return attrs;
}

function tagsIn(fragment) {
  return [...fragment.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*>/g)].map((m) => ({
    name: m[1].toLowerCase(), attrs: parseAttrs(m[0]), index: m.index,
  }));
}

function byId(fragment, id) {
  const found = tagsIn(fragment).filter((t) => t.attrs.id === id);
  assert.equal(found.length, 1, `exactly one element with id ${id}`);
  return found[0];
}

function elementContent(fragment, tag) {
  const open = fragment.slice(tag.index).match(/^<[^>]*>/)[0];
  const rest = fragment.slice(tag.index + open.length);
  const close = rest.search(new RegExp(`</${tag.name}\\s*>`, 'i'));
  return rest.slice(0, close);
}

const formMatch = html.match(/<form\b[^>]*>[\s\S]*?<\/form\s*>/i);
const formHtml = formMatch ? formMatch[0] : '';
const outsideForm = formMatch ? html.replace(formHtml, '') : html;

test('html: title and the only h1 are Room bookings', () => {
  assert.equal(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)[1].trim(), 'Room bookings');
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  assert.equal(h1s.length, 1);
  assert.equal(h1s[0][1].trim(), 'Room bookings');
});

test('html: form has novalidate and the five fields plus Book button inside', () => {
  const formTag = tagsIn(formHtml)[0];
  assert.equal(formTag.name, 'form');
  assert.equal(formTag.attrs.id, 'booking-form');
  assert.ok('novalidate' in formTag.attrs);
  const expected = [
    ['room', 'select', { name: 'room' }],
    ['title', 'input', { type: 'text', name: 'title' }],
    ['date', 'input', { type: 'date', name: 'date' }],
    ['start', 'input', { type: 'time', name: 'start' }],
    ['end', 'input', { type: 'time', name: 'end' }],
    ['book', 'button', { type: 'submit' }],
  ];
  for (const [id, name, attrs] of expected) {
    const tag = byId(formHtml, id);
    assert.equal(tag.name, name, id);
    for (const [k, v] of Object.entries(attrs)) assert.equal(tag.attrs[k], v, `${id}.${k}`);
  }
  assert.equal(elementContent(formHtml, byId(formHtml, 'book')).trim(), 'Book');
});

function labelsOf(fragment) {
  return [...fragment.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label\s*>/gi)].map((m) => ({
    forId: parseAttrs(`<label ${m[1]}>`)['for'], inner: m[2],
  }));
}

test('html: each field has its own label with exact text that does not contain the field', () => {
  const expected = {
    room: 'Room', title: 'Title', date: 'Date', start: 'Start', end: 'End', 'filter-date': 'Show date',
  };
  const labels = labelsOf(html);
  for (const [id, label] of Object.entries(expected)) {
    const mine = labels.filter((l) => l.forId === id);
    assert.equal(mine.length, 1, id);
    assert.equal(mine[0].inner, label, id);
    assert.doesNotMatch(mine[0].inner, /<(input|select|button|textarea)/i);
    assert.doesNotMatch(mine[0].inner, /</);
  }
});

test('html: the filter, Show all, list and error elements sit outside the form', () => {
  assert.ok(formMatch, 'form exists');
  const filter = byId(outsideForm, 'filter-date');
  assert.equal(filter.name, 'input');
  assert.equal(filter.attrs.type, 'date');
  const showAll = byId(outsideForm, 'show-all');
  assert.equal(showAll.name, 'button');
  assert.equal(showAll.attrs.type, 'button');
  assert.equal(elementContent(outsideForm, showAll).trim(), 'Show all');
  assert.equal(byId(outsideForm, 'booking-list').name, 'ul');
  const error = byId(outsideForm, 'error');
  assert.equal(error.name, 'p');
  assert.equal(error.attrs.role, 'alert');
  assert.equal(elementContent(outsideForm, error), '');
  assert.equal(labelsOf(outsideForm).filter((l) => l.forId === 'filter-date').length, 1);
  assert.equal(elementContent(outsideForm, byId(outsideForm, 'booking-list')), '');
});

test('html: no options, no room names, no absolute URLs, no inline code', () => {
  assert.doesNotMatch(html, /<option/i);
  for (const name of ['Aurora', 'Borealis', 'Cosmos']) assert.ok(!html.includes(name), name);
  assert.ok(!/https?:\/\//i.test(html));
  assert.ok(!/https?:\/\//i.test(source));
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
  assert.ok(scripts.length > 0);
  for (const s of scripts) assert.ok('src' in parseAttrs(s[0]), 'script has src');
  assert.doesNotMatch(html, /\son\w+\s*=/i);
});

test('html: one plain script /app.js as the last element of body', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
  assert.equal(scripts.length, 1);
  assert.deepEqual(parseAttrs(scripts[0][0]), { src: '/app.js' });
  const after = html.slice(html.search(/<\/script\s*>/i)).replace(/^<\/script\s*>/i, '');
  assert.match(after, /^\s*<\/body\s*>/i);
});

// ---------------------------------------------------------------- Static app.js

test('app.js: classic script with no import or export', () => {
  assert.doesNotMatch(source, /^\s*(import|export)\b/m);
  assert.doesNotMatch(source, /\bimport\s*\(/);
});

test('app.js: uses none of the forbidden browser APIs', () => {
  const forbidden = [
    /innerHTML/, /outerHTML/, /insertAdjacentHTML/, /createTextNode/, /querySelector/,
    /setAttribute/, /URLSearchParams/, /encodeURIComponent/, /\bwindow\./,
    /DOMContentLoaded/, /addEventListener\(\s*['"]load['"]/, /XMLHttpRequest/, /\.ok\b/,
    /\.text\(/, /localStorage/, /console/,
  ];
  for (const re of forbidden) assert.doesNotMatch(source, re, String(re));
});
