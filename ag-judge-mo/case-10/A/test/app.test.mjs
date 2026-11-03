import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers.mjs';

const SCRIPT = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.type = '';
    this.disabled = false;
    this._text = '';
  }
  get textContent() {
    return this.children.length ? this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join('') : this._text;
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this._text = '';
    this.children = nodes;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  fire(type) {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
}

const IDS = ['booking-form', 'room', 'title', 'date', 'start', 'end', 'book', 'filter-date', 'show-all', 'booking-list', 'error'];

function reply(status, body) {
  return {
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  };
}

function setup(handler) {
  const els = Object.fromEntries(IDS.map((id) => [id, new FakeElement(id)]));
  const calls = [];
  const document = {
    getElementById: (id) => els[id],
    createElement: (tag) => new FakeElement(tag),
  };
  const fetch = (url, opts) => {
    calls.push({ url, ...opts });
    return handler(url, opts, calls.length);
  };
  vm.runInNewContext(SCRIPT, { document, fetch });
  return { els, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const booking = { id: 1, room: 'Aurora', title: '<b>x</b>', date: '2026-11-03', start: '09:00', end: '10:00' };

test('loads rooms and the list at once', async () => {
  const { els, calls } = setup((url) =>
    Promise.resolve(url === '/api/rooms' ? reply(200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] }) : reply(200, { bookings: [booking] }))
  );
  assert.deepEqual(calls.map((c) => c.url), ['/api/rooms', '/api/bookings']);
  await tick();
  assert.deepEqual(els.room.children.map((o) => [o.value, o.textContent]), [['Aurora', 'Aurora'], ['Borealis', 'Borealis'], ['Cosmos', 'Cosmos']]);
  const li = els['booking-list'].children;
  assert.equal(li.length, 1);
  assert.equal(li[0].children[0], '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
  assert.equal(li[0].children[1].type, 'button');
  assert.equal(li[0].children[1].textContent, 'Cancel');
});

test('shows errors and empty list', async () => {
  const { els } = setup((url) =>
    url === '/api/rooms' ? Promise.resolve(reply(500, { error: 'internal error' })) : Promise.resolve(reply(200, { bookings: [] }))
  );
  await tick();
  assert.equal(els.error.textContent, 'internal error');
  assert.equal(els.room.children.length, 0);
  assert.deepEqual(els['booking-list'].children[0].children, ['No bookings.']);
});

test('submits a booking and handles replies', async () => {
  let postReply = reply(409, { error: 'room is already booked from 09:00 to 10:00' });
  const { els, calls } = setup((url, opts) => {
    if (url === '/api/rooms') return Promise.resolve(reply(200, { rooms: ['Aurora'] }));
    if (opts.method === 'POST') return Promise.resolve(postReply);
    return Promise.resolve(reply(200, { bookings: [] }));
  });
  await tick();
  els.room.value = 'Aurora';
  els.title.value = ' Hi ';
  els.date.value = '2026-11-03';
  els.start.value = '09:00';
  els.end.value = '10:00';
  const ev = els['booking-form'].fire('submit');
  assert.ok(ev.defaultPrevented);
  assert.equal(els.book.disabled, true);
  els['booking-form'].fire('submit');
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.deepEqual({ ...posts[0].headers }, { 'Content-Type': 'application/json' });
  assert.deepEqual(JSON.parse(posts[0].body), { room: 'Aurora', title: ' Hi ', date: '2026-11-03', start: '09:00', end: '10:00' });
  await tick();
  assert.equal(els.book.disabled, false);
  assert.equal(els.error.textContent, 'room is already booked from 09:00 to 10:00');
  assert.equal(els.title.value, ' Hi ');

  postReply = reply(201, { ...booking });
  const before = calls.length;
  els['booking-form'].fire('submit');
  await tick();
  assert.equal(els.title.value, '');
  assert.equal(els.error.textContent, '');
  assert.equal(calls.at(-1).url, '/api/bookings');
  assert.equal(calls.length, before + 2);
});

test('filter, show all and stale list replies', async () => {
  const pending = [];
  const { els, calls } = setup((url) => {
    if (url === '/api/rooms') return Promise.resolve(reply(200, { rooms: [] }));
    return new Promise((resolve, reject) => pending.push({ resolve, reject }));
  });
  els['filter-date'].value = '2026-11-03';
  els['filter-date'].fire('input');
  assert.equal(calls.length, 2);
  els['filter-date'].fire('change');
  assert.equal(calls.at(-1).url, '/api/bookings?date=2026-11-03');
  els['show-all'].fire('click');
  assert.equal(els['filter-date'].value, '');
  assert.equal(calls.at(-1).url, '/api/bookings');
  assert.equal(calls.length, 4);
  pending[2].resolve(reply(200, { bookings: [] }));
  pending[0].reject(new Error('down'));
  pending[1].resolve(reply(200, { bookings: [booking] }));
  await tick();
  assert.equal(els.error.textContent, '');
  assert.deepEqual(els['booking-list'].children[0].children, ['No bookings.']);
});

test('cancel sends DELETE and refetches', async () => {
  let deleteReply = reply(404, { error: 'booking not found' });
  const { els, calls } = setup((url, opts) => {
    if (url === '/api/rooms') return Promise.resolve(reply(200, { rooms: [] }));
    if (opts.method === 'DELETE') return deleteReply;
    return Promise.resolve(reply(200, { bookings: [booking] }));
  });
  await tick();
  const button = els['booking-list'].children[0].children[1];
  deleteReply = Promise.resolve(reply(404, { error: 'booking not found' }));
  button.fire('click');
  assert.equal(button.disabled, true);
  assert.equal(calls.at(-1).url, '/api/bookings/1');
  assert.equal(calls.at(-1).method, 'DELETE');
  await tick();
  assert.equal(button.disabled, false);
  assert.equal(els.error.textContent, 'booking not found');
  assert.equal(calls.at(-1).url, '/api/bookings');

  const count = calls.length;
  deleteReply = Promise.reject(new Error('down'));
  deleteReply.catch(() => {});
  els['booking-list'].children[0].children[1].fire('click');
  await tick();
  assert.equal(els.error.textContent, 'Could not reach the server.');
  assert.equal(calls.length, count + 1);
});
