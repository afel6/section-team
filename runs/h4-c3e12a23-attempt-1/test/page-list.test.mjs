import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, makeReply, flush } from './helpers/fake-dom.mjs';

const APP = new URL('../public/app.js', import.meta.url).pathname;
const NO_REPLY = 'Could not reach the server.';
const FALLBACK = 'Request failed.';
const BOOKING = { id: 1, room: 'Aurora', title: 'one', date: '2026-11-03', start: '09:00', end: '10:00' };

function booking(id, title) {
  return { ...BOOKING, id, title };
}

async function withList(bookings = [BOOKING]) {
  const p = loadPage(APP);
  p.calls[1].reply(makeReply(200, { bookings }));
  await flush();
  return p;
}

function listOf(els) {
  return [...els['booking-list'].children];
}

function assertSameChildren(els, before) {
  const after = listOf(els);
  assert.equal(after.length, before.length);
  before.forEach((node, i) => assert.equal(after[i], node));
}

async function refetchWith(settle) {
  const { els, calls } = await withList();
  const before = listOf(els);
  els['filter-date'].dispatch('change');
  settle(calls[2]);
  await flush();
  return { els, before };
}

test('latest list fetch 500 shows the error and keeps the list', async () => {
  const { els, before } = await refetchWith((c) => c.reply(makeReply(500, { error: 'boom' })));
  assert.equal(els.error.textContent, 'boom');
  assertSameChildren(els, before);
});

test('latest list fetch rejection shows no-reply and keeps the list', async () => {
  const { els, before } = await refetchWith((c) => c.fail());
  assert.equal(els.error.textContent, NO_REPLY);
  assertSameChildren(els, before);
});

test('latest list fetch 200 with unreadable json shows no-reply', async () => {
  const { els, before } = await refetchWith((c) => c.reply(makeReply(200, null, { badJson: true })));
  assert.equal(els.error.textContent, NO_REPLY);
  assertSameChildren(els, before);
});

test('list success leaves #error alone', async () => {
  const { els, calls } = loadPage(APP);
  els.error.textContent = 'old';
  calls[1].reply(makeReply(200, { bookings: [BOOKING] }));
  await flush();
  assert.equal(els.error.textContent, 'old');
  assert.equal(els['booking-list'].children.length, 1);
});

test('earlier fetch succeeding after the later one is ignored', async () => {
  const { els, calls } = loadPage(APP);
  els['filter-date'].dispatch('change');
  calls[2].reply(makeReply(200, { bookings: [booking(7, 'X')] }));
  await flush();
  calls[1].reply(makeReply(200, { bookings: [booking(8, 'Y'), booking(9, 'Z')] }));
  await flush();
  const items = listOf(els);
  assert.equal(items.length, 1);
  assert.match(items[0].children[0].textContent, /: X$/);
});

function submit(p) {
  p.els['booking-form'].dispatch('submit');
}

test('POST 201 enables Book before the follow-up list fetch', async () => {
  const p = loadPage(APP);
  submit(p);
  p.calls[2].reply(makeReply(201, {}));
  await flush();
  assert.equal(p.calls.length, 4);
  assert.equal(p.calls[3].bookDisabled, false);
});

test('POST 409 enables Book before the error is shown', async () => {
  const p = loadPage(APP);
  const seen = [];
  p.els.error.onTextSet = () => seen.push(p.els.book.disabled);
  submit(p);
  p.calls[2].reply(makeReply(409, { error: 'taken' }));
  await flush();
  assert.equal(p.els.book.disabled, false);
  assert.equal(p.els.error.textContent, 'taken');
  assert.deepEqual(seen, [false]);
});

test('POST 201 with unreadable json shows no-reply, keeps title', async () => {
  const p = loadPage(APP);
  p.els.title.value = 'Standup';
  submit(p);
  p.calls[2].reply(makeReply(201, null, { badJson: true }));
  await flush();
  assert.equal(p.els.error.textContent, NO_REPLY);
  assert.equal(p.els.title.value, 'Standup');
  assert.equal(p.calls.length, 3);
  assert.equal(p.els.book.disabled, false);
});

test('Cancel 404 re-enables the Cancel button', async () => {
  const { els, calls } = await withList();
  const button = els['booking-list'].children[0].children[1];
  button.dispatch('click');
  calls[2].reply(makeReply(404, { error: 'booking not found' }));
  await flush();
  assert.equal(button.disabled, false);
});

test('rooms 200 with malformed body shows fallback, select empty', async () => {
  const { els, calls } = loadPage(APP);
  calls[0].reply(makeReply(200, {}));
  await flush();
  assert.equal(els.error.textContent, FALLBACK);
  assert.equal(els.room.children.length, 0);
});

test('list 200 with malformed body shows fallback, list unchanged', async () => {
  const { els, before } = await refetchWith((c) => c.reply(makeReply(200, { bookings: 'x' })));
  assert.equal(els.error.textContent, FALLBACK);
  assertSameChildren(els, before);
});

test('DELETE answered 200 with an error body shows it and refetches', async () => {
  const { els, calls } = await withList();
  els['booking-list'].children[0].children[1].dispatch('click');
  calls[2].reply(makeReply(200, { error: 'nope' }));
  await flush();
  assert.equal(els.error.textContent, 'nope');
  assert.equal(calls.length, 4);
});

test('rooms GET answered 204 shows fallback and never reads json', async () => {
  const { els, calls } = loadPage(APP);
  const reply = makeReply(204);
  calls[0].reply(reply);
  await flush();
  assert.equal(els.error.textContent, FALLBACK);
  assert.equal(reply.jsonCalls, 0);
});
