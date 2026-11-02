import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, makeReply, flush } from './helpers/fake-dom.mjs';
import { APP, ROOMS, booking, setup, submit } from './helpers/page-harness.mjs';

const NO_REPLY = 'Could not reach the server.';
const FALLBACK = 'Request failed.';
const EXPECTED_FIELDS = { room: 'Cosmos', date: '2026-11-03', start: '09:00', end: '10:00' };

// The page runs in a separate vm realm, so copy values before deepEqual.
function plain(v) {
  return JSON.parse(JSON.stringify(v));
}

function listItems(els) {
  return [...els['booking-list'].children];
}

function sameNodes(actual, expected, msg) {
  assert.equal(actual.length, expected.length, `${msg}: length`);
  expected.forEach((n, i) => assert.equal(actual[i], n, `${msg}: node ${i}`));
}

function lineTexts(els) {
  return listItems(els).map((li) => li.children[0].textContent);
}

function fill(els, over = {}) {
  const v = { room: 'Cosmos', title: 'T', date: '2026-11-03', start: '09:00', end: '10:00', ...over };
  for (const k of Object.keys(v)) els[k].value = v[k];
}

function change(els, value) {
  els['filter-date'].value = value;
  els['filter-date'].dispatch('change');
}

async function postPage(over) {
  const page = await setup();
  fill(page.els, over);
  submit(page.els);
  return { ...page, post: page.calls[2] };
}

// 1. overlapping list fetches
async function threeFetches() {
  const page = await setup({ answerList: false });
  change(page.els, 'a');
  change(page.els, 'b');
  assert.equal(page.calls.length, 4);
  return page;
}

test('overlapping fetches: earlier successes are ignored, last one wins', async () => {
  const { els, calls } = await threeFetches();
  const before = listItems(els);
  calls[1].reply(makeReply(200, { bookings: [booking(1, 'A')] }));
  calls[2].reply(makeReply(200, { bookings: [booking(2, 'B')] }));
  await flush();
  sameNodes(listItems(els), before, 'unchanged');
  assert.equal(els.error.textContent, '');
  calls[3].reply(makeReply(200, { bookings: [booking(3, 'C')] }));
  await flush();
  assert.deepEqual(lineTexts(els), ['2026-11-03 09:00-10:00 Aurora: C']);
});

test('overlapping fetches: earlier 500 and failure after last success are ignored', async () => {
  const { els, calls } = await threeFetches();
  calls[3].reply(makeReply(200, { bookings: [booking(3, 'C')] }));
  await flush();
  const before = listItems(els);
  calls[1].reply(makeReply(500, { error: 'boom' }));
  calls[2].fail();
  await flush();
  sameNodes(listItems(els), before, 'unchanged');
  assert.equal(els.error.textContent, '');
  assert.deepEqual(lineTexts(els), ['2026-11-03 09:00-10:00 Aurora: C']);
});

test('overlapping fetches: earlier bad json and 409 after last success are ignored', async () => {
  const { els, calls } = await threeFetches();
  calls[3].reply(makeReply(200, { bookings: [booking(3, 'C')] }));
  await flush();
  const before = listItems(els);
  calls[1].reply(makeReply(200, null, { badJson: true }));
  calls[2].reply(makeReply(409, { error: 'late' }));
  await flush();
  sameNodes(listItems(els), before, 'unchanged');
  assert.equal(els.error.textContent, '');
});

test('overlapping fetches: last errors, earlier success afterwards changes nothing', async () => {
  const { els, calls } = await threeFetches();
  const before = listItems(els);
  calls[3].reply(makeReply(500, { error: 'x' }));
  await flush();
  calls[1].reply(makeReply(200, { bookings: [booking(1, 'A')] }));
  calls[2].reply(makeReply(200, { bookings: [booking(2, 'B')] }));
  await flush();
  assert.equal(els.error.textContent, 'x');
  sameNodes(listItems(els), before, 'unchanged');
});

// 2. Book button
test('Book is disabled while POST pending and enabled for the follow-up GET', async () => {
  const { els, calls, post } = await postPage();
  assert.equal(post.bookDisabled, true);
  assert.equal(els.book.disabled, true);
  post.reply(makeReply(201, {}));
  await flush();
  assert.equal(calls.length, 4);
  assert.equal(calls[3].bookDisabled, false);
});

test('Book is enabled again before the error text is set on a 500', async () => {
  const { els, post } = await postPage();
  const seen = [];
  els.error.onTextSet = () => seen.push(els.book.disabled);
  post.reply(makeReply(500, { error: 'nope' }));
  await flush();
  assert.deepEqual(seen, [false]);
  assert.equal(els.error.textContent, 'nope');
});

test('Book is enabled after a failed POST and shows no-reply', async () => {
  const { els, post } = await postPage();
  post.fail();
  await flush();
  assert.equal(els.book.disabled, false);
  assert.equal(els.error.textContent, NO_REPLY);
});

test('after the request settles a second submit sends a new POST', async () => {
  const { els, calls, post } = await postPage();
  post.fail();
  await flush();
  submit(els);
  const posts = calls.filter((c) => c.options && c.options.method === 'POST');
  assert.equal(posts.length, 2);
});

// 3. submit while disabled
test('submit while a POST is pending is prevented and sends nothing', async () => {
  const { els, calls } = await postPage();
  const callsBefore = calls.length;
  const event = submit(els);
  assert.equal(event.defaultPrevented, true);
  assert.equal(calls.length, callsBefore);
});

// 4. exact POST options
test('POST request has exact url, options, headers and body', async () => {
  const { post } = await postPage({ title: '  Plan <b>  ' });
  assert.equal(post.url, '/api/bookings');
  assert.deepEqual(Object.keys(post.options).sort(), ['body', 'headers', 'method']);
  assert.equal(post.options.method, 'POST');
  assert.deepEqual(plain(post.options.headers), { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(post.options.body), {
    room: 'Cosmos', title: '  Plan <b>  ', date: '2026-11-03', start: '09:00', end: '10:00',
  });
});

test('POST goes out even when every field is empty', async () => {
  const { els, calls } = await setup();
  const event = submit(els);
  assert.equal(event.defaultPrevented, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[2].options.body), { room: '', title: '', date: '', start: '', end: '' });
});

// 5. 201
test('201 clears only the title, empties error and refetches with the filter', async () => {
  for (const [filter, url] of [['2026-11-03', '/api/bookings?date=2026-11-03'], ['', '/api/bookings']]) {
    const { els, calls, post } = await postPage();
    els.error.textContent = 'old error';
    els['filter-date'].value = filter;
    post.reply(makeReply(201, {}));
    await flush();
    assert.equal(els.title.value, '', `title cleared (${filter})`);
    for (const [field, expectedValue] of Object.entries(EXPECTED_FIELDS)) {
      assert.equal(els[field].value, expectedValue, `${field} kept (${filter})`);
    }
    assert.equal(els['filter-date'].value, filter, `filter kept (${filter})`);
    assert.equal(els.error.textContent, '', `error emptied (${filter})`);
    assert.equal(calls.length, 4, `one list fetch (${filter})`);
    assert.equal(calls[3].url, url, `refetch url (${filter})`);
    assert.equal(calls[3].options.method, 'GET', `refetch method (${filter})`);
  }
});

// 6. other POST statuses
test('POST non-201 statuses show the error, keep the title, no refetch', async () => {
  const msg = 'room is already booked from 09:00 to 10:00';
  const table = [
    [200, { error: 'odd' }, 'odd'],
    [409, { error: msg }, msg],
    [400, { error: 5 }, FALLBACK],
    [400, { error: null }, FALLBACK],
    [400, { message: 'x' }, FALLBACK],
    [400, [], FALLBACK],
    [400, null, FALLBACK],
    [400, 'str', FALLBACK],
    [400, 42, FALLBACK],
  ];
  for (const [status, body, expected] of table) {
    const { els, calls, post } = await postPage({ title: 'keep' });
    post.reply(makeReply(status, body));
    await flush();
    const label = `${status} ${JSON.stringify(body)}`;
    assert.equal(els.error.textContent, expected, label);
    assert.equal(els.title.value, 'keep', label);
    assert.equal(calls.length, 3, label);
  }
});

test('POST 500 with unreadable body shows no-reply', async () => {
  const { els, calls, post } = await postPage({ title: 'keep' });
  post.reply(makeReply(500, null, { badJson: true }));
  await flush();
  assert.equal(els.error.textContent, NO_REPLY);
  assert.equal(els.title.value, 'keep');
  assert.equal(calls.length, 3);
});

// 7. Cancel
async function cancelPage() {
  const page = await setup({ bookings: [booking(7, 'seven'), booking(12, 'twelve')] });
  const button = listItems(page.els)[1].children[1];
  button.dispatch('click');
  return { ...page, button, del: page.calls[2] };
}

test('Cancel sends exact DELETE and disables the button while pending', async () => {
  const { button, del } = await cancelPage();
  assert.equal(del.url, '/api/bookings/12');
  assert.deepEqual(plain(del.options), { method: 'DELETE' });
  assert.deepEqual(Object.keys(del.options), ['method']);
  assert.equal(button.disabled, true);
});

test('Cancel 204 does not read the body, empties error and refetches', async () => {
  const { els, calls, button, del } = await cancelPage();
  els.error.textContent = 'old';
  const reply = makeReply(204, undefined, { badJson: true });
  del.reply(reply);
  await flush();
  assert.equal(reply.jsonCalls, 0);
  assert.equal(els.error.textContent, '');
  assert.equal(calls.length, 4);
  assert.equal(calls[3].url, '/api/bookings');
  assert.equal(button.disabled, false);
});

test('Cancel replies other than 204 show the error and refetch', async () => {
  const table = [
    [404, { error: 'booking not found' }, 'booking not found'],
    [200, {}, FALLBACK],
  ];
  for (const [status, body, expected] of table) {
    const { els, calls, button, del } = await cancelPage();
    del.reply(makeReply(status, body));
    await flush();
    assert.equal(els.error.textContent, expected, `${status}`);
    assert.equal(calls.length, 4, `refetch ${status}`);
    assert.equal(button.disabled, false, `enabled ${status}`);
  }
});

test('Cancel with no reply shows no-reply, re-enables, and does not refetch', async () => {
  const table = [
    ['fail', (d) => d.fail()],
    ['500 bad json', (d) => d.reply(makeReply(500, null, { badJson: true }))],
  ];
  for (const [label, settle] of table) {
    const { els, calls, button, del } = await cancelPage();
    settle(del);
    await flush();
    assert.equal(els.error.textContent, NO_REPLY, label);
    assert.equal(calls.length, 3, label);
    assert.equal(button.disabled, false, label);
  }
});

// 8. Filter
test('change on filter fetches with the raw value, input does nothing', async () => {
  const table = [
    ['a b&c/é', '/api/bookings?date=a b&c/é'],
    ['2026-11-03', '/api/bookings?date=2026-11-03'],
    ['', '/api/bookings'],
  ];
  for (const [value, url] of table) {
    const { els, calls } = await setup();
    els['filter-date'].value = value;
    els['filter-date'].dispatch('input');
    assert.equal(calls.length, 2, `input ${value}`);
    els['filter-date'].dispatch('change');
    assert.equal(calls.length, 3, `change ${value}`);
    assert.equal(calls[2].url, url, `url ${value}`);
    assert.equal(calls[2].options.method, 'GET', `method ${value}`);
  }
});

test('Show all clears the filter and fetches exactly once', async () => {
  const { els, calls } = await setup();
  els['filter-date'].value = '2026-11-03';
  els['show-all'].dispatch('click');
  assert.equal(els['filter-date'].value, '');
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, '/api/bookings');
});

// 9. list error handling
test('list errors show a message and leave the list alone', async () => {
  const table = [
    ['500 error', (c) => c.reply(makeReply(500, { error: 'db down' })), 'db down'],
    ['500 no error', (c) => c.reply(makeReply(500, { nope: 1 })), FALLBACK],
    ['201 wrong success', (c) => c.reply(makeReply(201, { bookings: [] })), FALLBACK],
    ['fail', (c) => c.fail(), NO_REPLY],
  ];
  for (const [label, settle, expected] of table) {
    const { els, calls } = await setup();
    const before = listItems(els);
    els['filter-date'].dispatch('change');
    settle(calls[2]);
    await flush();
    assert.equal(els.error.textContent, expected, label);
    sameNodes(listItems(els), before, label);
  }
});

// 10. rooms
test('rooms errors show a message and leave #room empty', async () => {
  const table = [
    ['500', (c) => c.reply(makeReply(500, { error: 'r' })), 'r'],
    ['fail', (c) => c.fail(), NO_REPLY],
  ];
  for (const [label, settle, expected] of table) {
    const { els, calls } = loadPage(APP);
    settle(calls[0]);
    await flush();
    assert.equal(els.error.textContent, expected, label);
    assert.equal(els.room.children.length, 0, label);
  }
});

test('rooms 200 fills three options in order', async () => {
  const { els } = await setup();
  assert.equal(els.room.children.length, 3);
  els.room.children.forEach((o, i) => {
    assert.equal(o.tagName, 'option', `tag ${i}`);
    assert.equal(o.value, ROOMS[i], `value ${i}`);
    assert.equal(o.textContent, ROOMS[i], `text ${i}`);
  });
});

// 11. rendering
test('booking is rendered as plain text plus a Cancel button', async () => {
  const { els } = await setup({ bookings: [booking(1, '<b>x</b>')] });
  const items = listItems(els);
  assert.equal(items.length, 1);
  const [text, button] = items[0].children;
  assert.equal(items[0].children.length, 2);
  assert.equal(text.nodeType, 3);
  assert.equal(text.textContent, '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
  assert.equal(button.tagName, 'button');
  assert.equal(button.type, 'button');
  assert.equal(button.textContent, 'Cancel');
});

test('empty list shows a single No bookings item', async () => {
  const { els } = await setup({ bookings: [] });
  const items = listItems(els);
  assert.equal(items.length, 1);
  assert.equal(items[0].children.length, 1);
  assert.equal(items[0].children[0].nodeType, 3);
  assert.equal(items[0].children[0].textContent, 'No bookings.');
});

test('title whitespace in data is shown unchanged', async () => {
  const { els } = await setup({ bookings: [booking(1, '  x  ')] });
  assert.deepEqual(lineTexts(els), ['2026-11-03 09:00-10:00 Aurora:   x  ']);
});

// 12. success leaves error alone
test('a successful list fetch leaves #error alone', async () => {
  const { els, calls } = await setup();
  els.error.textContent = 'stay';
  els['filter-date'].dispatch('change');
  calls[2].reply(makeReply(200, { bookings: [booking(5, 'new')] }));
  await flush();
  assert.equal(els.error.textContent, 'stay');
  assert.deepEqual(lineTexts(els), ['2026-11-03 09:00-10:00 Aurora: new']);
});
