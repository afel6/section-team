import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Pull the script out of server.mjs without starting the server.
const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const SCRIPT = /const SCRIPT = `([\s\S]*?)`;/.exec(source)[1];

class El {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.disabled = false;
    this._text = '';
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('') : this._text;
  }
  set textContent(v) { this.children = []; this._text = v; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  fire(type, event = { preventDefault() { this.prevented = true; } }) {
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
}

function setup(handler) {
  const ids = ['booking-form', 'room', 'title', 'date', 'start', 'end', 'book', 'filter-date', 'show-all', 'booking-list', 'error'];
  const els = Object.fromEntries(ids.map((id) => [id, new El(id)]));
  const calls = [];
  const fetch = (url, opts = {}) => {
    calls.push({ url, ...opts });
    return handler(url, opts);
  };
  const document = { getElementById: (id) => els[id], createElement: (tag) => new El(tag) };
  vm.runInNewContext(SCRIPT, { document, fetch });
  return { els, calls };
}

const reply = (status, body) => Promise.resolve({ status, json: () => Promise.resolve(body) });
const tick = () => new Promise((r) => setTimeout(r, 0));

test('loads rooms and list, renders text safely', async () => {
  const booking = { id: 1, room: 'Aurora', title: '<b>x</b>', date: '2026-11-03', start: '09:00', end: '10:00' };
  const { els, calls } = setup((url) =>
    url === '/api/rooms' ? reply(200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] }) : reply(200, { bookings: [booking] }));
  assert.deepEqual(calls.map((c) => c.url), ['/api/rooms', '/api/bookings']);
  await tick();
  assert.deepEqual(els.room.children.map((o) => [o.value, o.textContent]), [['Aurora', 'Aurora'], ['Borealis', 'Borealis'], ['Cosmos', 'Cosmos']]);
  const li = els['booking-list'].children[0];
  assert.equal(li.children[0], '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
  assert.equal(li.children[1].textContent, 'Cancel');
  assert.equal(li.children[1].type, 'button');
});

test('submit posts values, handles errors and no reply', async () => {
  let next = () => reply(409, { error: 'room is already booked from 09:00 to 10:00' });
  const { els, calls } = setup((url, opts) =>
    opts.method === 'POST' ? next() : url === '/api/rooms' ? reply(200, { rooms: [] }) : reply(200, { bookings: [] }));
  await tick();
  assert.equal(els['booking-list'].children[0].children[0], 'No bookings.');
  els.title.value = ' Standup ';
  const ev = els['booking-form'].fire('submit');
  assert.ok(ev.prevented);
  assert.equal(els.book.disabled, true);
  els['booking-form'].fire('submit'); // ignored while disabled
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(JSON.stringify(posts[0].headers), '{"Content-Type":"application/json"}');
  assert.equal(JSON.parse(posts[0].body).title, ' Standup ');
  await tick();
  assert.equal(els.book.disabled, false);
  assert.equal(els.error.textContent, 'room is already booked from 09:00 to 10:00');

  next = () => Promise.reject(new TypeError('down'));
  els['booking-form'].fire('submit');
  await tick();
  assert.equal(els.error.textContent, 'Could not reach the server.');

  next = () => reply(201, {});
  els['booking-form'].fire('submit');
  await tick();
  assert.equal(els.title.value, '');
  assert.equal(els.error.textContent, '');
  assert.equal(calls.at(-1).url, '/api/bookings');
});

test('only the last list fetch counts; filter and show all', async () => {
  const pending = [];
  const { els, calls } = setup((url) => {
    if (url === '/api/rooms') return reply(200, { rooms: [] });
    return new Promise((resolve) => pending.push(resolve));
  });
  els['filter-date'].value = '2026-11-03';
  els['filter-date'].fire('input');
  assert.equal(calls.length, 2);
  els['filter-date'].fire('change');
  assert.equal(calls.at(-1).url, '/api/bookings?date=2026-11-03');
  els['show-all'].fire('click');
  assert.equal(els['filter-date'].value, '');
  assert.equal(calls.at(-1).url, '/api/bookings');
  pending[2]({ status: 200, json: async () => ({ bookings: [] }) });
  await tick();
  pending[0]({ status: 500, json: async () => ({ error: 'internal error' }) });
  pending[1]({ status: 200, json: async () => { throw new Error('bad'); } });
  await tick();
  assert.equal(els.error.textContent, '');
  assert.equal(els['booking-list'].children[0].children[0], 'No bookings.');
});
