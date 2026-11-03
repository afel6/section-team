// Runs public/app.js against a tiny fake DOM and a fake fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'app.js'),
  'utf8',
);

class Text {
  constructor(text) {
    this.textContent = text;
  }
}

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.type = '';
    this.disabled = false;
  }
  get textContent() {
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(text) {
    this.children = text === '' ? [] : [new Text(text)];
  }
  append(...nodes) {
    for (const n of nodes) this.children.push(typeof n === 'string' ? new Text(n) : n);
  }
  replaceChildren(...nodes) {
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  dispatch(type) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of this.listeners[type] ?? []) fn(event);
    return event;
  }
}

const flush = () => new Promise((r) => setImmediate(r));

function setup(handler) {
  const ids = ['booking-form', 'room', 'title', 'date', 'start', 'end', 'book', 'filter-date', 'show-all', 'booking-list', 'error'];
  const elements = Object.fromEntries(ids.map((id) => [id, new Element(id)]));
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    const reply = await handler(url, options);
    if (reply === null) throw new TypeError('network');
    return { status: reply.status, json: async () => reply.body };
  };
  const document = {
    getElementById: (id) => elements[id],
    createElement: (tag) => new Element(tag),
  };
  vm.runInNewContext(SCRIPT, { document, fetch });
  return { el: elements, calls };
}

const bookings = [
  { id: 1, room: 'Aurora', title: '<b>x</b>', date: '2026-11-03', start: '09:00', end: '10:00' },
];

test('loads rooms and list', async () => {
  const { el } = setup((url) => {
    if (url === '/api/rooms') return { status: 200, body: { rooms: ['Aurora', 'Borealis', 'Cosmos'] } };
    return { status: 200, body: { bookings } };
  });
  await flush();
  assert.deepEqual(el.room.children.map((o) => [o.value, o.textContent]), [
    ['Aurora', 'Aurora'], ['Borealis', 'Borealis'], ['Cosmos', 'Cosmos'],
  ]);
  const li = el['booking-list'].children[0];
  assert.equal(li.children.length, 2);
  assert.equal(li.children[0].textContent, '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
  assert.equal(li.children[1].textContent, 'Cancel');
  assert.equal(li.children[1].type, 'button');
});

test('no bookings and unreachable rooms', async () => {
  const { el } = setup((url) => (url === '/api/rooms' ? null : { status: 200, body: { bookings: [] } }));
  await flush();
  assert.equal(el.error.textContent, 'Could not reach the server.');
  assert.equal(el['booking-list'].children.length, 1);
  assert.equal(el['booking-list'].textContent, 'No bookings.');
});

test('submit posts values and handles errors', async () => {
  let postReply = { status: 409, body: { error: 'room is already booked from 09:00 to 10:00' } };
  const { el, calls } = setup((url, options) => {
    if (options.method === 'POST') return postReply;
    if (url === '/api/rooms') return { status: 200, body: { rooms: ['Aurora'] } };
    return { status: 200, body: { bookings: [] } };
  });
  await flush();
  el.room.value = 'Aurora';
  el.title.value = ' Standup ';
  el.date.value = '2026-11-03';
  el.start.value = '09:00';
  el.end.value = '10:00';
  const event = el['booking-form'].dispatch('submit');
  assert.equal(event.defaultPrevented, true);
  assert.equal(el.book.disabled, true);
  el['booking-form'].dispatch('submit'); // ignored while disabled
  await flush();
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual({ ...posts[0].headers }, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(posts[0].body), {
    room: 'Aurora', title: ' Standup ', date: '2026-11-03', start: '09:00', end: '10:00',
  });
  assert.equal(el.book.disabled, false);
  assert.equal(el.error.textContent, 'room is already booked from 09:00 to 10:00');
  assert.equal(el.title.value, ' Standup ');

  postReply = { status: 201, body: { id: 1 } };
  const before = calls.length;
  el['booking-form'].dispatch('submit');
  await flush();
  assert.equal(el.title.value, '');
  assert.equal(el.error.textContent, '');
  assert.equal(calls.slice(before).filter((c) => c.method === 'GET' && c.url === '/api/bookings').length, 1);
});

test('filter, show all and stale list replies', async () => {
  const pending = [];
  const { el, calls } = setup((url) => {
    if (url === '/api/rooms') return { status: 200, body: { rooms: [] } };
    return new Promise((resolve) => pending.push({ url, resolve }));
  });
  el['filter-date'].value = '2026-11-03';
  el['filter-date'].dispatch('input');
  el['filter-date'].dispatch('change');
  assert.equal(calls.at(-1).url, '/api/bookings?date=2026-11-03');
  pending[1].resolve({ status: 200, body: { bookings } });
  await flush();
  pending[0].resolve({ status: 500, body: { error: 'old' } });
  await flush();
  assert.equal(el.error.textContent, '');
  assert.equal(el['booking-list'].children.length, 1);
  el['show-all'].dispatch('click');
  assert.equal(el['filter-date'].value, '');
  assert.equal(calls.at(-1).url, '/api/bookings');
  assert.equal(calls.filter((c) => c.url.startsWith('/api/bookings')).length, 3);
});

test('cancel deletes and refetches', async () => {
  let deleteReply = { status: 404, body: { error: 'booking not found' } };
  const { el, calls } = setup((url, options) => {
    if (options.method === 'DELETE') return deleteReply;
    if (url === '/api/rooms') return { status: 200, body: { rooms: [] } };
    return { status: 200, body: { bookings } };
  });
  await flush();
  const cancel = el['booking-list'].children[0].children[1];
  cancel.dispatch('click');
  assert.equal(cancel.disabled, true);
  await flush();
  assert.equal(cancel.disabled, false);
  assert.equal(calls.find((c) => c.method === 'DELETE').url, '/api/bookings/1');
  assert.equal(el.error.textContent, 'booking not found');
  const listCalls = calls.filter((c) => c.url === '/api/bookings').length;
  assert.equal(listCalls, 2);

  deleteReply = null;
  el['booking-list'].children[0].children[1].dispatch('click');
  await flush();
  assert.equal(el.error.textContent, 'Could not reach the server.');
  assert.equal(calls.filter((c) => c.url === '/api/bookings').length, 2);
});
