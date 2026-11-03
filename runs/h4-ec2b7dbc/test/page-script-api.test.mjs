import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { FakeElement, loadPage, listTexts } from './helpers/fake-dom.mjs';
import { parseHtml } from './helpers/html.mjs';
import { flush } from './helpers/page.mjs';

const SOURCE = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

const DENY = ['window', 'self.', 'globalThis', 'location', 'XMLHttpRequest', 'innerHTML',
  'outerHTML', 'insertAdjacentHTML', 'document.write', 'createTextNode', 'querySelector',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'localStorage', 'sessionStorage',
  'DOMContentLoaded', "'load'", '"load"', 'onload', 'onclick', 'onsubmit', 'eval(',
  'new Function', 'dispatchEvent', 'setAttribute', 'classList', 'appendChild', 'innerText',
  'location.reload', "addEventListener('load'"];

const ALLOWED = new Set([
  'document.getElementById', 'document.createElement',
  'element.textContent', 'element.value', 'element.type', 'element.disabled',
  'element.append', 'element.replaceChildren', 'element.addEventListener',
  'event.preventDefault', 'response.status', 'response.json',
]);
const FETCH_OPTIONS = new Set(['method', 'headers', 'body']);

// Removes // and /* */ comments, keeping string and template contents.
function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return out;
}

// ---- recording proxy loader -------------------------------------------------

function makeRecorder() {
  const accesses = [];
  const targets = new WeakMap();
  const unwrap = (v) => (v !== null && typeof v === 'object' && targets.has(v) ? targets.get(v) : v);
  function wrap(kind, target, ignore = []) {
    const proxy = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'symbol' || ignore.includes(prop)) return Reflect.get(t, prop, t);
        accesses.push(`${kind}.${prop}`);
        const v = Reflect.get(t, prop, t);
        if (typeof v !== 'function') return v;
        if (prop === 'append' || prop === 'replaceChildren') {
          return (...args) => v.apply(t, args.map(unwrap));
        }
        return v.bind(t);
      },
      set(t, prop, value) {
        accesses.push(`${kind}.${String(prop)}`);
        return Reflect.set(t, prop, value, t);
      },
    });
    targets.set(proxy, target);
    return proxy;
  }
  return { accesses, wrap, unwrap };
}

// Fake elements built from the real page: one per element that has an id.
function buildElementsFromHtml() {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const elements = new Map();
  for (const node of parseHtml(html)) {
    const id = node.attrs.get('id');
    if (!id) continue;
    const element = new FakeElement(node.tag, id);
    if (node.attrs.has('type')) element.type = node.attrs.get('type');
    if (node.tag === 'button') element.textContent = node.innerText;
    elements.set(id, element);
  }
  return elements;
}

function makeFetch(rec, calls) {
  return (url, options) => new Promise((resolve, reject) => {
    for (const key of Object.keys(options ?? {})) rec.accesses.push(`fetchOption.${key}`);
    const reply = (status, body) => resolve(rec.wrap('response', {
      status, json: () => Promise.resolve(body),
    }, ['then']));
    calls.push({ url, options, reply, reject: () => reject(new TypeError('fetch failed')) });
  });
}

function loadRecorded(source) {
  const rec = makeRecorder();
  const calls = [];
  const els = buildElementsFromHtml();
  const proxies = new Map();
  const doc = {
    getElementById: (id) => {
      if (!proxies.has(id)) proxies.set(id, rec.wrap('element', els.get(id)));
      return proxies.get(id);
    },
    createElement: (tag) => rec.wrap('element', new FakeElement(tag)),
  };
  const document = rec.wrap('document', doc);
  const context = vm.createContext({ document, fetch: makeFetch(rec, calls) });
  vm.runInContext(source, context, { filename: 'app.js' });
  const fire = (target, type) => {
    const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    const proxy = rec.wrap('event', event);
    for (const fn of target.listeners[type] || []) fn(proxy);
    return event;
  };
  return { rec, calls, els, context, fire, syncCalls: calls.length };
}

const ROOMS = { rooms: ['Aurora', 'Borealis', 'Cosmos'] };
const AURORA_BOOKING = { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' };
const COSMOS_BOOKING = { ...AURORA_BOOKING, id: 2, room: 'Cosmos', title: '<b>x</b>' };

// Drives the whole page; tolerant so that mutated sources can still run.
async function runScenario(source) {
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  try {
    const page = loadRecorded(source);
    const { calls, els, fire } = page;
    let idx = 0;
    const answer = async (status, body) => {
      const call = calls[idx];
      idx += 1;
      call?.reply(status, body);
      await flush();
      return call;
    };
    await answer(200, ROOMS);
    await answer(200, { bookings: [AURORA_BOOKING, COSMOS_BOOKING] });
    for (const [id, v] of [['room', 'Aurora'], ['title', 'T'], ['date', '2026-11-03'],
      ['start', '09:00'], ['end', '10:00']]) els.get(id).value = v;
    fire(els.get('booking-form'), 'submit');
    await answer(201, AURORA_BOOKING);
    await answer(200, { bookings: [AURORA_BOOKING] });
    fire(els.get('booking-form'), 'submit');
    await answer(409, { error: 'room is already booked from 09:00 to 10:00' });
    fire(els.get('booking-list').childNodes[0]?.childNodes[1] ?? els.get('book'), 'click');
    await answer(204);
    await answer(200, { bookings: [AURORA_BOOKING] });
    fire(els.get('booking-list').childNodes[0]?.childNodes[1] ?? els.get('book'), 'click');
    calls[idx]?.reject();
    idx += 1;
    await flush();
    els.get('filter-date').value = '2026-11-03';
    fire(els.get('filter-date'), 'change');
    await answer(500, { error: 'x' });
    fire(els.get('filter-date'), 'input');
    fire(els.get('show-all'), 'click');
    await answer(200, { bookings: [] });
    await flush();
    return { page, rejections, urls: calls.map((c) => c.url) };
  } finally {
    process.removeListener('unhandledRejection', onRejection);
  }
}

const disallowed = (accesses) => [...new Set(accesses)].filter((a) => !ALLOWED.has(a)
  && !a.startsWith('fetchOption.'));

// ---- tests -----------------------------------------------------------------

describe('app.js source', () => {
  test('is a classic script that compiles', () => {
    assert.doesNotThrow(() => new vm.Script(SOURCE));
    assert.equal(/^\s*(import|export)\b/m.test(SOURCE), false);
    assert.equal(/\bimport\s*\(/.test(SOURCE), false);
  });

  test('contains none of the denied names', () => {
    const code = stripComments(SOURCE);
    const found = DENY.filter((word) => code.includes(word));
    assert.deepEqual(found, []);
  });

  test('stripComments keeps strings and drops comments', () => {
    assert.equal(stripComments("a // window\nb 'window' /* self. */"), "a \nb 'window' ");
  });
});

describe('app.js setup and API use', () => {
  test('requests rooms and list synchronously at load', () => {
    const { calls } = loadPage();
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, '/api/rooms');
    assert.equal(calls[1].url, '/api/bookings');
  });

  test('uses only allowed members over a full scenario', async () => {
    const { page, rejections, urls } = await runScenario(SOURCE);
    assert.equal(page.syncCalls, 2);
    assert.deepEqual(rejections, []);
    assert.deepEqual(disallowed(page.rec.accesses), []);
    assert.deepEqual(Object.keys(page.context).sort(), ['document', 'fetch']);
    for (const call of page.calls) {
      for (const key of Object.keys(call.options)) assert.ok(FETCH_OPTIONS.has(key), key);
    }
    assert.deepEqual(urls, ['/api/rooms', '/api/bookings', '/api/bookings', '/api/bookings',
      '/api/bookings', '/api/bookings/1', '/api/bookings', '/api/bookings/1',
      '/api/bookings?date=2026-11-03', '/api/bookings']);
  });

  test('scenario reaches the expected page state', async () => {
    const { page } = await runScenario(SOURCE);
    const { els } = page;
    assert.equal(els.get('room').childNodes.length, 3);
    assert.deepEqual(listTexts(els.get('booking-list')).map((i) => i.text), ['No bookings.']);
    assert.equal(els.get('error').textContent, 'x');
    assert.equal(els.get('book').disabled, false);
    assert.equal(els.get('filter-date').value, '');
  });

  test('allow-list check bites on textContent -> innerHTML', async () => {
    assert.ok(SOURCE.includes('.textContent = text'));
    const { page } = await runScenario(SOURCE.replace('.textContent = text', '.innerHTML = text'));
    assert.ok(disallowed(page.rec.accesses).includes('element.innerHTML'));
  });

  test('allow-list check bites on option.textContent -> innerText', async () => {
    assert.ok(SOURCE.includes('option.textContent = room'));
    const { page } = await runScenario(
      SOURCE.replace('option.textContent = room', 'option.innerText = room'));
    assert.ok(disallowed(page.rec.accesses).includes('element.innerText'));
  });
});
