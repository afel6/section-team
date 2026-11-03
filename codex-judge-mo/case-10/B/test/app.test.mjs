import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const APP_SRC = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const HTML = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

// ---------------------------------------------------------------- fake DOM

const KIDS = new WeakMap();
const LISTENERS = new WeakMap();

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.value = '';
    this.type = '';
    this.disabled = false;
    KIDS.set(this, []);
    LISTENERS.set(this, new Map());
  }

  get textContent() {
    return KIDS.get(this)
      .map((n) => (n.nodeType === 3 ? n.data : n.textContent))
      .join('');
  }

  set textContent(text) {
    KIDS.set(this, text === '' ? [] : [textNode(String(text))]);
  }

  append(...nodes) {
    KIDS.set(this, [...KIDS.get(this), ...nodes.map(toNode)]);
  }

  replaceChildren(...nodes) {
    KIDS.set(this, nodes.map(toNode));
  }

  addEventListener(type, fn) {
    const map = LISTENERS.get(this);
    map.set(type, [...(map.get(type) || []), fn]);
  }
}

function textNode(data) {
  return { nodeType: 3, data };
}

function toNode(n) {
  return typeof n === 'string' ? textNode(n) : { nodeType: 1, __el: n, get textContent() { return n.textContent; } };
}

// Unwrap helper: children are stored wrapped so text/element are distinguishable.
function kids(el) {
  return KIDS.get(el).map((n) => (n.nodeType === 3 ? n : n.__el));
}

function isText(n) {
  return n.nodeType === 3;
}

function dispatch(el, type, event = makeEvent(type)) {
  for (const fn of LISTENERS.get(el).get(type) || []) fn(event);
  return event;
}

function makeEvent(type) {
  return {
    type,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

const IDS = [
  ['booking-form', 'form'], ['room', 'select'], ['title', 'input'], ['date', 'input'],
  ['start', 'input'], ['end', 'input'], ['book', 'button'], ['filter-date', 'input'],
  ['show-all', 'button'], ['booking-list', 'ul'], ['error', 'p'],
];

function makeDom() {
  const els = {};
  for (const [id, tag] of IDS) els[id] = new FakeElement(tag, id);
  const document = {
    getElementById(id) {
      return Object.hasOwn(els, id) ? els[id] : null;
    },
    createElement(tag) {
      return new FakeElement(tag);
    },
  };
  return { els, document };
}

// ---------------------------------------------------------------- fake fetch

function makeFetch() {
  const calls = [];
  function fetch(url, init) {
    return new Promise((resolve, reject) => {
      const call = { url, init, jsonCalled: false };
      call.respond = (status, body, opts = {}) => {
        const res = {
          status,
          json() {
            call.jsonCalled = true;
            if (opts.deferBody) {
              return new Promise((res2, rej2) => {
                call.resolveBody = () => res2(structuredClone(body));
                call.rejectBody = () => rej2(new SyntaxError('bad json'));
              });
            }
            return Promise.resolve(structuredClone(body));
          },
        };
        resolve(res);
      };
      call.respondInvalidJson = (status) => {
        resolve({
          status,
          json() {
            call.jsonCalled = true;
            return Promise.reject(new SyntaxError('Unexpected token'));
          },
        });
      };
      call.fail = () => reject(new TypeError('fetch failed'));
      calls.push(call);
    });
  }
  return { fetch, calls };
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function boot() {
  const { els, document } = makeDom();
  const { fetch, calls } = makeFetch();
  const context = vm.createContext({ document, fetch });
  vm.runInContext(APP_SRC, context);
  return { els, calls, document };
}

const B1 = { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00' };
const B2 = { id: 7, room: 'Cosmos', title: 'Review', date: '2026-11-02', start: '13:00', end: '14:30' };

async function bootWithList(bookings = [B1, B2]) {
  const ctx = boot();
  ctx.calls[1].respond(200, { bookings });
  await flush();
  return ctx;
}

// Describes the list: each li as array of 'T:<text>' or 'E:<tag>/<type>/<text>'.
function listShape(els) {
  return kids(els['booking-list']).map((li) =>
    kids(li).map((n) => (isText(n) ? 'T:' + n.data : `E:${n.tagName}/${n.type}/${n.textContent}`)));
}

function cancelButton(els, index) {
  return kids(kids(els['booking-list'])[index])[1];
}

function fillForm(els) {
  els.room.value = 'Borealis';
  els.title.value = '  Hello  ';
  els.date.value = '2026-11-03';
  els.start.value = '09:00';
  els.end.value = '10:00';
}

const EXPECTED_BODY = {
  room: 'Borealis', title: '  Hello  ', date: '2026-11-03', start: '09:00', end: '10:00',
};

// ---------------------------------------------------------------- html helpers

function parseAttrs(s) {
  const attrs = {};
  const re = /([a-zA-Z][\w-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(s)) !== null) attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  return attrs;
}

function findTags(html, name) {
  const re = new RegExp(`<${name}(\\s[^>]*)?>`, 'gi');
  return [...html.matchAll(re)].map((m) => ({ attrs: parseAttrs(m[1] || ''), index: m.index, len: m[0].length }));
}

function findById(html, name, id) {
  return findTags(html, name).filter((t) => t.attrs.id === id);
}

const FORM_START = HTML.indexOf('<form');
const FORM_END = HTML.indexOf('</form>');
const FORM_HTML = HTML.slice(FORM_START, FORM_END);

function inForm(tag) {
  return tag.index > FORM_START && tag.index < FORM_END;
}

function oneIn(name, id, expected, where = 'form') {
  const found = findById(HTML, name, id);
  assert.equal(found.length, 1, `exactly one <${name} id=${id}>`);
  assert.equal(inForm(found[0]), where === 'form', `${id} location`);
  for (const [k, v] of Object.entries(expected)) assert.equal(found[0].attrs[k], v, `${id} ${k}`);
  return found[0];
}

function textAfter(tag, name) {
  const rest = HTML.slice(tag.index + tag.len);
  return rest.slice(0, rest.indexOf(`</${name}>`));
}

// ---------------------------------------------------------------- tests

describe('markup', () => {
  it('script is last element in body, plain, only one, not inline', () => {
    const scripts = findTags(HTML, 'script');
    assert.equal(scripts.length, 1);
    assert.equal((HTML.match(/<script/gi) || []).length, 1);
    assert.deepEqual(scripts[0].attrs, { src: '/app.js' });
    assert.match(HTML, /<script src="\/app\.js"><\/script>/);
    const after = HTML.slice(HTML.indexOf('</script>') + '</script>'.length);
    assert.match(after, /^\s*<\/body>/);
  });

  it('has no on* attributes, no urls, no option, no room names', () => {
    for (const m of HTML.matchAll(/<[^>]+>/g)) assert.doesNotMatch(m[0], /\son[a-z]+\s*=/i);
    assert.doesNotMatch(HTML, /https?:\/\//);
    assert.doesNotMatch(HTML, /<option/i);
    for (const n of ['Aurora', 'Borealis', 'Cosmos']) assert.ok(!HTML.includes(n), n);
  });

  it('has the title and a single h1', () => {
    assert.match(HTML, /<title>Room bookings<\/title>/);
    assert.equal((HTML.match(/<h1[\s>]/gi) || []).length, 1);
    assert.match(HTML, /<h1[^>]*>Room bookings<\/h1>/);
  });

  it('form has novalidate and the exact controls inside', () => {
    const form = findById(HTML, 'form', 'booking-form');
    assert.equal(form.length, 1);
    assert.ok('novalidate' in form[0].attrs);
    assert.ok(FORM_START >= 0 && FORM_END > FORM_START);
    oneIn('select', 'room', { name: 'room' });
    oneIn('input', 'title', { type: 'text', name: 'title' });
    oneIn('input', 'date', { type: 'date', name: 'date' });
    oneIn('input', 'start', { type: 'time', name: 'start' });
    oneIn('input', 'end', { type: 'time', name: 'end' });
    const book = oneIn('button', 'book', { type: 'submit' });
    assert.equal(textAfter(book, 'button'), 'Book');
    assert.ok(FORM_HTML.includes('id="book"'));
  });

  it('labels have exact text, for the right control, and do not wrap', () => {
    const labels = [...HTML.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/gi)]
      .map((m) => ({ attrs: parseAttrs(m[1]), text: m[2] }));
    const want = {
      room: 'Room', title: 'Title', date: 'Date', start: 'Start', end: 'End', 'filter-date': 'Show date',
    };
    assert.equal(labels.length, 6);
    for (const [id, text] of Object.entries(want)) {
      const l = labels.filter((x) => x.attrs.for === id);
      assert.equal(l.length, 1, id);
      assert.equal(l[0].text, text);
      assert.doesNotMatch(l[0].text, /<(input|select)/i);
    }
  });

  it('outside the form: filter, show-all, list and empty alert', () => {
    oneIn('input', 'filter-date', { type: 'date' }, 'outside');
    const show = oneIn('button', 'show-all', { type: 'button' }, 'outside');
    assert.equal(textAfter(show, 'button'), 'Show all');
    oneIn('ul', 'booking-list', {}, 'outside');
    const err = oneIn('p', 'error', { role: 'alert' }, 'outside');
    assert.equal(textAfter(err, 'p'), '');
  });
});

describe('script scan', () => {
  it('is a classic script with no urls', () => {
    assert.doesNotMatch(APP_SRC, /^\s*(import|export)\b/m);
    assert.doesNotMatch(APP_SRC, /https?:\/\//);
  });

  it('avoids forbidden APIs', () => {
    const banned = [
      'querySelector', 'innerHTML', 'outerHTML', 'insertAdjacent', 'createTextNode',
      'document.write', '.ok', '.text(', 'encodeURIComponent', 'setTimeout', 'window.',
      'DOMContentLoaded', "addEventListener('load'", 'addEventListener("load"',
    ];
    for (const b of banned) assert.ok(!APP_SRC.includes(b), `uses ${b}`);
  });
});

describe('boot and rooms', () => {
  it('starts rooms and list fetches synchronously', () => {
    const { calls } = boot();
    assert.equal(calls.length, 2);
    const urls = calls.map((c) => c.url).sort();
    assert.deepEqual(urls, ['/api/bookings', '/api/rooms']);
    for (const c of calls) assert.equal(c.init.method, 'GET');
  });

  it('list fetch does not wait for the rooms reply', () => {
    const { calls } = boot();
    assert.ok(calls.some((c) => c.url === '/api/bookings'));
  });

  it('fills the select in order', async () => {
    const { els, calls } = boot();
    calls[0].respond(200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
    await flush();
    const opts = kids(els.room);
    assert.equal(opts.length, 3);
    assert.deepEqual(opts.map((o) => o.tagName), ['option', 'option', 'option']);
    assert.deepEqual(opts.map((o) => o.value), ['Aurora', 'Borealis', 'Cosmos']);
    assert.deepEqual(opts.map((o) => o.textContent), ['Aurora', 'Borealis', 'Cosmos']);
  });

  it('shows the error message on an error status', async () => {
    const { els, calls } = boot();
    calls[0].respond(500, { error: 'boom' });
    await flush();
    assert.equal(els.error.textContent, 'boom');
    assert.equal(kids(els.room).length, 0);
  });

  it('falls back to Request failed. when body has no usable error', async () => {
    for (const body of [{ foo: 1 }, { error: 5 }]) {
      const { els, calls } = boot();
      calls[0].respond(500, body);
      await flush();
      assert.equal(els.error.textContent, 'Request failed.');
      assert.equal(kids(els.room).length, 0);
    }
  });

  it('says it could not reach the server on reject or bad JSON', async () => {
    const a = boot();
    a.calls[0].fail();
    await flush();
    assert.equal(a.els.error.textContent, 'Could not reach the server.');
    assert.equal(kids(a.els.room).length, 0);
    const b = boot();
    b.calls[0].respondInvalidJson(200);
    await flush();
    assert.equal(b.els.error.textContent, 'Could not reach the server.');
    assert.equal(kids(b.els.room).length, 0);
  });
});

describe('list rendering', () => {
  it('renders one li per booking in reply order', async () => {
    const { els } = await bootWithList([B2, B1]);
    assert.deepEqual(listShape(els), [
      ['T:2026-11-02 13:00-14:30 Cosmos: Review', 'E:button/button/Cancel'],
      ['T:2026-11-03 09:00-10:00 Aurora: Standup', 'E:button/button/Cancel'],
    ]);
    assert.ok(kids(els['booking-list']).every((li) => li.tagName === 'li'));
  });

  it('renders the empty message', async () => {
    const { els } = await bootWithList([]);
    assert.deepEqual(listShape(els), [['T:No bookings.']]);
  });

  it('shows titles as plain text', async () => {
    const { els } = await bootWithList([{ ...B1, title: '<b>x</b>' }]);
    const nodes = kids(kids(els['booking-list'])[0]);
    assert.equal(nodes.length, 2);
    assert.ok(isText(nodes[0]));
    assert.ok(nodes[0].data.includes('<b>x</b>'));
    assert.equal(nodes[0].data, '2026-11-03 09:00-10:00 Aurora: <b>x</b>');
    assert.ok(!isText(nodes[1]) && nodes[1].tagName === 'button');
  });
});

describe('list errors', () => {
  it('error status shows message and keeps the list', async () => {
    const { els, calls } = await bootWithList();
    const before = listShape(els);
    dispatch(els['filter-date'], 'change');
    calls[2].respond(400, { error: 'date must be a valid YYYY-MM-DD date' });
    await flush();
    assert.equal(els.error.textContent, 'date must be a valid YYYY-MM-DD date');
    assert.deepEqual(listShape(els), before);
  });

  it('no reply or bad JSON shows the unreachable message and keeps the list', async () => {
    const { els, calls } = await bootWithList();
    const before = listShape(els);
    dispatch(els['filter-date'], 'change');
    calls[2].fail();
    await flush();
    assert.equal(els.error.textContent, 'Could not reach the server.');
    assert.deepEqual(listShape(els), before);
    els.error.textContent = '';
    dispatch(els['filter-date'], 'change');
    calls[3].respondInvalidJson(200);
    await flush();
    assert.equal(els.error.textContent, 'Could not reach the server.');
    assert.deepEqual(listShape(els), before);
  });

  it('a successful list fetch leaves #error alone', async () => {
    const { els, calls } = boot();
    els.error.textContent = 'keep me';
    calls[1].respond(200, { bookings: [B1] });
    await flush();
    assert.equal(els.error.textContent, 'keep me');
    assert.equal(kids(els['booking-list']).length, 1);
  });
});

describe('overlapping list fetches', () => {
  it('only the last started fetch is used for the list', async () => {
    const { els, calls } = boot();
    dispatch(els['filter-date'], 'change');
    calls[2].respond(200, { bookings: [{ ...B1, title: 'x' }] });
    await flush();
    calls[1].respond(200, { bookings: [{ ...B1, title: 'y' }] });
    await flush();
    assert.deepEqual(listShape(els), [['T:2026-11-03 09:00-10:00 Aurora: x', 'E:button/button/Cancel']]);
  });

  it('an older error status changes nothing', async () => {
    const { els, calls } = boot();
    dispatch(els['filter-date'], 'change');
    calls[2].respond(200, { bookings: [B1] });
    await flush();
    els.error.textContent = 'mine';
    calls[1].respond(500, { error: 'old' });
    await flush();
    assert.equal(els.error.textContent, 'mine');
    assert.equal(kids(els['booking-list']).length, 1);
  });

  it('an older failure changes nothing', async () => {
    const { els, calls } = boot();
    dispatch(els['filter-date'], 'change');
    calls[2].respond(200, { bookings: [B1] });
    await flush();
    els.error.textContent = 'mine';
    calls[1].fail();
    await flush();
    assert.equal(els.error.textContent, 'mine');
  });

  it('an older result arriving first is ignored until the newest arrives', async () => {
    const { els, calls } = boot();
    dispatch(els['filter-date'], 'change');
    calls[1].respond(200, { bookings: [B2] });
    await flush();
    assert.equal(kids(els['booking-list']).length, 0);
    calls[2].respond(200, { bookings: [B1] });
    await flush();
    assert.deepEqual(listShape(els), [['T:2026-11-03 09:00-10:00 Aurora: Standup', 'E:button/button/Cancel']]);
  });
});

describe('filter', () => {
  it('change fetches with the date unchanged', () => {
    const { els, calls } = boot();
    els['filter-date'].value = '2026-11-03';
    dispatch(els['filter-date'], 'change');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url, '/api/bookings?date=2026-11-03');
    assert.equal(calls[2].init.method, 'GET');
  });

  it('does not encode odd values', () => {
    const { els, calls } = boot();
    els['filter-date'].value = 'a b&c';
    dispatch(els['filter-date'], 'change');
    assert.equal(calls[2].url, '/api/bookings?date=a b&c');
  });

  it('input event does nothing', () => {
    const { els, calls } = boot();
    els['filter-date'].value = '2026-11-03';
    dispatch(els['filter-date'], 'input');
    assert.equal(calls.length, 2);
  });

  it('empty filter fetches the plain URL', () => {
    const { els, calls } = boot();
    dispatch(els['filter-date'], 'change');
    assert.equal(calls[2].url, '/api/bookings');
  });

  it('Show all clears the filter and fetches exactly once', () => {
    const { els, calls } = boot();
    els['filter-date'].value = '2026-11-03';
    dispatch(els['show-all'], 'click');
    assert.equal(els['filter-date'].value, '');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url, '/api/bookings');
  });
});

describe('submit', () => {
  it('posts the five values unchanged and disables Book while pending', () => {
    const { els, calls } = boot();
    fillForm(els);
    const ev = dispatch(els['booking-form'], 'submit');
    assert.equal(ev.defaultPrevented, true);
    assert.equal(calls.length, 3);
    const { url, init } = calls[2];
    assert.equal(url, '/api/bookings');
    assert.equal(init.method, 'POST');
    assert.deepEqual(Object.keys(init.headers), ['Content-Type']);
    assert.equal(init.headers['Content-Type'], 'application/json');
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ['date', 'end', 'room', 'start', 'title']);
    assert.deepEqual(body, EXPECTED_BODY);
    assert.equal(els.book.disabled, true);
  });

  it('a second submit while pending sends nothing but prevents default', () => {
    const { els, calls } = boot();
    fillForm(els);
    dispatch(els['booking-form'], 'submit');
    const ev = dispatch(els['booking-form'], 'submit');
    assert.equal(ev.defaultPrevented, true);
    assert.equal(calls.length, 3);
  });

  it('on 201 clears the title, the error, and refetches the list once', async () => {
    const { els, calls } = boot();
    fillForm(els);
    els.error.textContent = 'old';
    dispatch(els['booking-form'], 'submit');
    calls[2].respond(201, { id: 9 });
    await flush();
    assert.equal(els.book.disabled, false);
    assert.equal(els.title.value, '');
    assert.equal(els.room.value, 'Borealis');
    assert.equal(els.date.value, '2026-11-03');
    assert.equal(els.start.value, '09:00');
    assert.equal(els.end.value, '10:00');
    assert.equal(els.error.textContent, '');
    assert.equal(calls.length, 4);
    assert.equal(calls[3].url, '/api/bookings');
    assert.equal(calls[3].init.method, 'GET');
  });

  it('on 409 shows the message, keeps the form, does not refetch', async () => {
    const { els, calls } = boot();
    fillForm(els);
    dispatch(els['booking-form'], 'submit');
    calls[2].respond(409, { error: 'room is already booked from 09:00 to 10:00' });
    await flush();
    assert.equal(els.error.textContent, 'room is already booked from 09:00 to 10:00');
    assert.equal(els.title.value, '  Hello  ');
    assert.equal(calls.length, 3);
    assert.equal(els.book.disabled, false);
  });

  it('on network failure shows the unreachable message', async () => {
    const { els, calls } = boot();
    fillForm(els);
    dispatch(els['booking-form'], 'submit');
    calls[2].fail();
    await flush();
    assert.equal(els.error.textContent, 'Could not reach the server.');
    assert.equal(els.book.disabled, false);
    assert.equal(els.title.value, '  Hello  ');
    assert.equal(calls.length, 3);
  });

  it('201 with invalid JSON counts as no reply', async () => {
    const { els, calls } = boot();
    fillForm(els);
    dispatch(els['booking-form'], 'submit');
    calls[2].respondInvalidJson(201);
    await flush();
    assert.equal(els.error.textContent, 'Could not reach the server.');
    assert.equal(els.title.value, '  Hello  ');
    assert.equal(calls.length, 3);
  });

  it('re-enables Book only after the body has been read', async () => {
    const { els, calls } = boot();
    fillForm(els);
    dispatch(els['booking-form'], 'submit');
    calls[2].respond(409, { error: 'nope' }, { deferBody: true });
    await flush();
    assert.equal(calls[2].jsonCalled, true);
    assert.equal(els.book.disabled, true);
    calls[2].resolveBody();
    await flush();
    assert.equal(els.book.disabled, false);
    assert.equal(els.error.textContent, 'nope');
  });
});

describe('cancel', () => {
  async function clicked() {
    const ctx = await bootWithList([B2, B1]);
    ctx.button = cancelButton(ctx.els, 0);
    ctx.els.error.textContent = 'old';
    dispatch(ctx.button, 'click');
    return ctx;
  }

  it('disables the button and sends DELETE', async () => {
    const { button, calls } = await clicked();
    assert.equal(button.disabled, true);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].url, '/api/bookings/7');
    assert.equal(calls[2].init.method, 'DELETE');
  });

  it('204 clears the error without reading the body, and refetches', async () => {
    const { button, els, calls } = await clicked();
    calls[2].respond(204, null);
    await flush();
    assert.equal(calls[2].jsonCalled, false);
    assert.equal(button.disabled, false);
    assert.equal(els.error.textContent, '');
    assert.equal(calls.length, 4);
    assert.equal(calls[3].url, '/api/bookings');
    assert.equal(calls[3].init.method, 'GET');
  });

  it('404 shows the message, enables the button, and refetches', async () => {
    const { button, els, calls } = await clicked();
    calls[2].respond(404, { error: 'booking not found' });
    await flush();
    assert.equal(els.error.textContent, 'booking not found');
    assert.equal(button.disabled, false);
    assert.equal(calls.length, 4);
    assert.equal(calls[3].url, '/api/bookings');
  });

  it('network failure shows the unreachable message and does not refetch', async () => {
    const { button, els, calls } = await clicked();
    calls[2].fail();
    await flush();
    assert.equal(els.error.textContent, 'Could not reach the server.');
    assert.equal(button.disabled, false);
    assert.equal(calls.length, 3);
  });

  it('404 with invalid JSON counts as no reply', async () => {
    const { button, els, calls } = await clicked();
    calls[2].respondInvalidJson(404);
    await flush();
    assert.equal(els.error.textContent, 'Could not reach the server.');
    assert.equal(button.disabled, false);
    assert.equal(calls.length, 3);
  });
});
