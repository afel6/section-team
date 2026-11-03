import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import {
  createPage, respond, respondBadJson, fail, flush, dispatch, deferred, textOf,
} from './app-fake-dom.mjs';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appSrc = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const NO_REPLY = 'Could not reach the server.';
const B1 = { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' };
const B2 = { id: 2, room: 'Cosmos', title: '<b>x</b>', date: '2026-11-03', start: '11:00', end: '12:00' };

// ---------- Part 1: static checks ----------

const formHtml = html.slice(html.indexOf('<form'), html.indexOf('</form>'));
const outside = html.replace(formHtml, '');

function labelText(id) {
  const m = html.match(new RegExp('<label[^>]*\\bfor="' + id + '"[^>]*>([\\s\\S]*?)</label>'));
  return m ? m[1] : null;
}

test('title and single h1', () => {
  assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], 'Room bookings');
  const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
  assert.equal(h1s.length, 1);
  assert.equal(h1s[0][1], 'Room bookings');
});

test('form has novalidate and its controls', () => {
  assert.match(html, /<form\b[^>]*\bid="booking-form"[^>]*\bnovalidate\b/);
  assert.match(formHtml, /<select\b(?=[^>]*\bid="room")(?=[^>]*\bname="room")[^>]*>/);
  assert.match(formHtml, /<input\b(?=[^>]*\btype="text")(?=[^>]*\bid="title")(?=[^>]*\bname="title")[^>]*>/);
  assert.match(formHtml, /<input\b(?=[^>]*\btype="date")(?=[^>]*\bid="date")(?=[^>]*\bname="date")[^>]*>/);
  assert.match(formHtml, /<input\b(?=[^>]*\btype="time")(?=[^>]*\bid="start")(?=[^>]*\bname="start")[^>]*>/);
  assert.match(formHtml, /<input\b(?=[^>]*\btype="time")(?=[^>]*\bid="end")(?=[^>]*\bname="end")[^>]*>/);
  assert.match(formHtml, /<button\b(?=[^>]*\btype="submit")(?=[^>]*\bid="book")[^>]*>Book<\/button>/);
});

test('labels have exact text and do not wrap fields', () => {
  const expected = { room: 'Room', title: 'Title', date: 'Date', start: 'Start', end: 'End', 'filter-date': 'Show date' };
  for (const [id, text] of Object.entries(expected)) {
    const inner = labelText(id);
    assert.equal(inner, text, 'label for ' + id);
    assert.ok(!inner.includes('<'));
  }
});

test('controls outside the form', () => {
  assert.match(outside, /<input\b(?=[^>]*\btype="date")(?=[^>]*\bid="filter-date")[^>]*>/);
  assert.match(outside, /<button\b(?=[^>]*\btype="button")(?=[^>]*\bid="show-all")[^>]*>Show all<\/button>/);
  assert.match(outside, /<ul\b[^>]*\bid="booking-list"[^>]*>/);
  assert.match(outside, /<p\b(?=[^>]*\bid="error")(?=[^>]*\brole="alert")[^>]*><\/p>/);
});

test('script is the last element of body, single and plain', () => {
  const before = html.slice(0, html.indexOf('</body>')).trim();
  assert.ok(before.endsWith('<script src="/app.js"></script>'));
  assert.equal(html.match(/<script/g).length, 1);
  const tag = html.match(/<script[^>]*>/)[0];
  assert.doesNotMatch(tag, /\b(type|defer|async)\b/);
});

test('no rooms, handlers or absolute URLs in the page', () => {
  assert.doesNotMatch(html, /<option/);
  assert.doesNotMatch(html, /Aurora|Borealis|Cosmos/);
  assert.doesNotMatch(html, / on[a-z]+=/i);
  for (const src of [html, appSrc]) {
    assert.ok(!src.includes('http' + '://'));
    assert.ok(!src.includes('https' + '://'));
  }
  assert.doesNotMatch(appSrc, /^\s*(import|export)\b/m);
});

// ---------- Part 2: behaviour ----------

function load() {
  const page = createPage(appSrc);
  page.run();
  return page;
}

const listItems = (page) => page.els['booking-list'].children;
const errorText = (page) => textOf(page.els.error);
const isGet = (c) => !c.options || !c.options.method || c.options.method === 'GET';

async function renderList(page, bookings) {
  respond(page.calls[1], 200, { bookings });
  await flush();
}

function fillForm(page) {
  const v = { room: 'Aurora', title: '  Standup  ', date: '2026-11-03', start: '09:00', end: '10:00' };
  for (const [k, val] of Object.entries(v)) page.els[k].value = val;
  return v;
}

test('1. load starts rooms and list fetches synchronously', () => {
  const page = load();
  assert.equal(page.calls.length, 2);
  assert.equal(page.calls[0].url, '/api/rooms');
  assert.equal(page.calls[1].url, '/api/bookings');
  assert.ok(page.calls.every(isGet));
});

test('2. rooms fill the select', async () => {
  const page = load();
  respond(page.calls[0], 200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  await flush();
  const opts = page.els.room.children;
  assert.equal(opts.length, 3);
  ['Aurora', 'Borealis', 'Cosmos'].forEach((n, i) => {
    assert.equal(opts[i].tag, 'option');
    assert.equal(opts[i].value, n);
    assert.equal(textOf(opts[i]), n);
  });
  assert.equal(errorText(page), '');
});

test('3. rooms error statuses', async () => {
  const cases = [[{ error: 'internal error' }, 'internal error'], [{ error: 5 }, 'Request failed.'],
    [['x'], 'Request failed.'], [null, 'Request failed.']];
  for (const [body, expected] of cases) {
    const page = load();
    respond(page.calls[0], 500, body);
    await flush();
    assert.equal(errorText(page), expected);
    assert.equal(page.els.room.children.length, 0);
  }
});

test('4. rooms without a reply', async () => {
  let page = load();
  fail(page.calls[0]);
  await flush();
  assert.equal(errorText(page), NO_REPLY);
  assert.equal(page.els.room.children.length, 0);
  page = load();
  respondBadJson(page.calls[0], 200);
  await flush();
  assert.equal(errorText(page), NO_REPLY);
});

test('5. list rendering', async () => {
  const page = load();
  await renderList(page, [B1, B2]);
  const items = listItems(page);
  assert.equal(items.length, 2);
  for (const li of items) {
    assert.equal(li.tag, 'li');
    assert.equal(li.children.length, 2);
    assert.equal(li.children[1].tag, 'button');
    assert.equal(li.children[1].type, 'button');
    assert.equal(textOf(li.children[1]), 'Cancel');
    assert.ok(li.children[0].isText);
  }
  assert.equal(items[0].children[0].text, '2026-11-03 09:00-10:00 Aurora: Standup');
  assert.equal(items[1].children[0].text, '2026-11-03 11:00-12:00 Cosmos: <b>x</b>');
});

test('6. empty list', async () => {
  const page = load();
  await renderList(page, []);
  const items = listItems(page);
  assert.equal(items.length, 1);
  assert.equal(items[0].tag, 'li');
  assert.equal(items[0].children.length, 1);
  assert.deepEqual(items[0].children[0], { isText: true, text: 'No bookings.' });
});

test('7. list errors keep the list; success keeps the error', async () => {
  let page = load();
  await renderList(page, [B1]);
  const before = listItems(page);
  dispatch(page.els['filter-date'], 'change');
  respond(page.calls[2], 400, { error: 'date must be a valid YYYY-MM-DD date' });
  await flush();
  assert.equal(errorText(page), 'date must be a valid YYYY-MM-DD date');
  assert.equal(listItems(page), before);
  dispatch(page.els['filter-date'], 'change');
  fail(page.calls[3]);
  await flush();
  assert.equal(errorText(page), NO_REPLY);
  assert.equal(listItems(page), before);

  page = load();
  fail(page.calls[0]);
  await flush();
  await renderList(page, [B1]);
  assert.equal(errorText(page), NO_REPLY);
  assert.equal(listItems(page).length, 1);
});

test('8. filter change fetches, input does not', async () => {
  const page = load();
  page.els['filter-date'].value = '2026-11-03';
  dispatch(page.els['filter-date'], 'input');
  assert.equal(page.calls.length, 2);
  dispatch(page.els['filter-date'], 'change');
  assert.equal(page.calls.length, 3);
  assert.equal(page.calls[2].url, '/api/bookings?date=2026-11-03');
  page.els['filter-date'].value = 'a b&c';
  dispatch(page.els['filter-date'], 'change');
  assert.equal(page.calls[3].url, '/api/bookings?date=a b&c');
});

test('9. overlapping list fetches: only the last one counts', async () => {
  let page = load();
  dispatch(page.els['filter-date'], 'change');
  respond(page.calls[2], 200, { bookings: [B1] });
  await flush();
  respond(page.calls[1], 200, { bookings: [B2, B2] });
  await flush();
  assert.equal(listItems(page).length, 1);
  assert.equal(listItems(page)[0].children[0].text, '2026-11-03 09:00-10:00 Aurora: Standup');

  for (const stale of [(c) => fail(c), (c) => respond(c, 500, { error: 'boom' })]) {
    page = load();
    dispatch(page.els['filter-date'], 'change');
    respond(page.calls[2], 200, { bookings: [B1] });
    await flush();
    stale(page.calls[1]);
    await flush();
    assert.equal(errorText(page), '');
    assert.equal(listItems(page).length, 1);
  }

  page = load();
  dispatch(page.els['filter-date'], 'change');
  respond(page.calls[1], 200, { bookings: [B2] });
  await flush();
  assert.equal(listItems(page).length, 0);
  assert.equal(errorText(page), '');
  respond(page.calls[2], 200, { bookings: [B1] });
  await flush();
  assert.equal(listItems(page).length, 1);
});

test('10. show all clears the filter and fetches once', () => {
  const page = load();
  page.els['filter-date'].value = '2026-11-03';
  const n = page.calls.length;
  dispatch(page.els['show-all'], 'click');
  assert.equal(page.els['filter-date'].value, '');
  assert.equal(page.calls.length, n + 1);
  assert.equal(page.calls[n].url, '/api/bookings');
});

test('11. submit happy path', async () => {
  const page = load();
  const v = fillForm(page);
  page.els.error.children = [{ isText: true, text: 'old' }];
  const ev = dispatch(page.els['booking-form'], 'submit');
  assert.ok(ev.prevented);
  assert.equal(page.els.book.disabled, true);
  assert.equal(page.calls.length, 3);
  const post = page.calls[2];
  assert.equal(post.url, '/api/bookings');
  assert.equal(post.options.method, 'POST');
  // The headers object comes from the vm realm, so compare a same-realm copy.
  assert.deepEqual({ ...post.options.headers }, { 'Content-Type': 'application/json' });
  assert.deepEqual(Object.keys(JSON.parse(post.options.body)).sort(), Object.keys(v).sort());
  assert.deepEqual(JSON.parse(post.options.body), v);
  assert.ok(dispatch(page.els['booking-form'], 'submit').prevented);
  assert.equal(page.calls.length, 3);
  respond(post, 201, B1);
  await flush();
  assert.equal(page.els.book.disabled, false);
  assert.equal(page.els.title.value, '');
  assert.equal(page.els.room.value, 'Aurora');
  assert.equal(page.els.date.value, '2026-11-03');
  assert.equal(page.els.start.value, '09:00');
  assert.equal(page.els.end.value, '10:00');
  assert.equal(errorText(page), '');
  assert.equal(page.calls.length, 4);
  assert.equal(page.calls[3].url, '/api/bookings');
  assert.ok(isGet(page.calls[3]));
});

test('12. Book re-enabled only after the body has arrived', async () => {
  const page = load();
  fillForm(page);
  dispatch(page.els['booking-form'], 'submit');
  const gate = deferred();
  respond(page.calls[2], 201, B1, { gate: gate.promise });
  await flush();
  assert.equal(page.els.book.disabled, true);
  gate.resolve();
  await flush();
  assert.equal(page.els.book.disabled, false);
});

test('13. submit failures keep form and skip refetch', async () => {
  const cases = [
    (c) => respond(c, 409, { error: 'room is already booked from 09:00 to 10:00' }),
    (c) => fail(c),
    (c) => respondBadJson(c, 201),
  ];
  const expected = ['room is already booked from 09:00 to 10:00', NO_REPLY, NO_REPLY];
  for (const [i, settle] of cases.entries()) {
    const page = load();
    fillForm(page);
    dispatch(page.els['booking-form'], 'submit');
    settle(page.calls[2]);
    await flush();
    assert.equal(errorText(page), expected[i]);
    assert.equal(page.els.book.disabled, false);
    assert.equal(page.els.title.value, '  Standup  ');
    assert.equal(page.calls.length, 3);
  }
});

async function cancelSetup() {
  const page = load();
  await renderList(page, [{ ...B1, id: 7 }]);
  page.els.error.children = [{ isText: true, text: 'old' }];
  const button = listItems(page)[0].children[1];
  dispatch(button, 'click');
  return { page, button };
}

test('14. cancel: 204 clears error and refetches without reading body', async () => {
  const { page, button } = await cancelSetup();
  assert.equal(button.disabled, true);
  const del = page.calls[2];
  assert.equal(del.url, '/api/bookings/7');
  assert.equal(del.options.method, 'DELETE');
  respond(del, 204, null);
  await flush();
  assert.equal(del.jsonCalled, false);
  assert.equal(button.disabled, false);
  assert.equal(errorText(page), '');
  assert.equal(page.calls.length, 4);
  assert.equal(page.calls[3].url, '/api/bookings');
});

test('14b. cancel: error status shows message and refetches', async () => {
  const { page, button } = await cancelSetup();
  respond(page.calls[2], 404, { error: 'booking not found' });
  await flush();
  assert.equal(errorText(page), 'booking not found');
  assert.equal(button.disabled, false);
  assert.equal(page.calls.length, 4);
  assert.equal(page.calls[3].url, '/api/bookings');
});

test('14c. cancel: no reply shows message and does not refetch', async () => {
  const settlers = [(c) => fail(c), (c) => respondBadJson(c, 404)];
  for (const settle of settlers) {
    const { page, button } = await cancelSetup();
    settle(page.calls[2]);
    await flush();
    assert.equal(errorText(page), NO_REPLY);
    assert.equal(button.disabled, false);
    assert.equal(page.calls.length, 3);
  }
});

test('15. fakes enforce the API allowlist', () => {
  const page = load();
  assert.throws(() => vm.runInContext('document.body', page.ctx), /forbidden/);
  assert.throws(() => vm.runInContext("document.getElementById('room').innerHTML = 'x'", page.ctx), /forbidden/);
  assert.throws(() => vm.runInContext("document.getElementById('room').appendChild", page.ctx), /forbidden/);
  assert.equal(vm.runInContext('typeof window', page.ctx), 'undefined');
});

test('16. a 204 to a GET is an error status without reading the body', async () => {
  const page = load();
  respond(page.calls[0], 204, null);
  await flush();
  assert.equal(page.calls[0].jsonCalled, false);
  assert.equal(errorText(page), 'Request failed.');
  assert.equal(page.els.room.children.length, 0);
});
