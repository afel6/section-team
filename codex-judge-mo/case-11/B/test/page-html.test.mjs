import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { HTML_SRC as html, APP_SRC as appSrc } from './support/fake-dom.mjs';

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
const ATTR_RE = /([^\s=\/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(text) {
  const attrs = {};
  for (const m of text.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return attrs;
}

function scan(src) {
  return [...src.matchAll(TAG_RE)].map((m) => ({
    close: m[1] === '/', name: m[2].toLowerCase(), attrs: parseAttrs(m[3]),
    raw: m[0], start: m.index, end: m.index + m[0].length,
  }));
}

const tokens = scan(html);
const opens = (name) => tokens.filter((t) => !t.close && t.name === name);

function closeOf(tok) {
  let depth = 0;
  for (const t of tokens.filter((x) => x.start >= tok.start && x.name === tok.name)) {
    depth += t.close ? -1 : 1;
    if (depth === 0) return t;
  }
  throw new Error(`no closing tag for ${tok.raw}`);
}

const contentOf = (tok) => html.slice(tok.end, closeOf(tok).start);
const byId = (id) => {
  const found = tokens.filter((t) => !t.close && t.attrs.id === id);
  assert.equal(found.length, 1, `exactly one element with id ${id}`);
  return found[0];
};
const form = () => byId('booking-form');
const inForm = (tok) => tok.start > form().end && tok.start < closeOf(form()).start;

test('title and h1 read Room bookings', () => {
  assert.equal(opens('title').length, 1);
  assert.equal(contentOf(opens('title')[0]), 'Room bookings');
  assert.equal(opens('h1').length, 1);
  assert.equal(contentOf(opens('h1')[0]), 'Room bookings');
});

test('form has novalidate and the five fields plus submit inside it', () => {
  assert.equal(form().name, 'form');
  assert.ok('novalidate' in form().attrs);
  const expected = [
    ['room', 'select', null], ['title', 'input', 'text'], ['date', 'input', 'date'],
    ['start', 'input', 'time'], ['end', 'input', 'time'],
  ];
  for (const [id, name, type] of expected) {
    const t = byId(id);
    assert.equal(t.name, name, id);
    assert.equal(t.attrs.name, id, `${id} name attr`);
    if (type) assert.equal(t.attrs.type, type, `${id} type`);
    assert.ok(inForm(t), `${id} inside form`);
  }
  const book = byId('book');
  assert.equal(book.name, 'button');
  assert.equal(book.attrs.type, 'submit');
  assert.equal(contentOf(book), 'Book');
  assert.ok(inForm(book));
});

test('each field has its own label with exact text and no field inside', () => {
  const texts = { room: 'Room', title: 'Title', date: 'Date', start: 'Start', end: 'End' };
  for (const [id, text] of Object.entries(texts)) {
    const labels = opens('label').filter((l) => l.attrs.for === id);
    assert.equal(labels.length, 1, `one label for ${id}`);
    const inner = contentOf(labels[0]);
    assert.equal(inner, text);
    assert.ok(!/<input|<select|<textarea|<button/i.test(inner));
  }
});

test('controls outside the form: filter, show all, list, error', () => {
  const filter = byId('filter-date');
  assert.equal(filter.name, 'input');
  assert.equal(filter.attrs.type, 'date');
  assert.ok(!inForm(filter));
  const labels = opens('label').filter((l) => l.attrs.for === 'filter-date');
  assert.equal(labels.length, 1);
  assert.equal(contentOf(labels[0]), 'Show date');
  const showAll = byId('show-all');
  assert.equal(showAll.name, 'button');
  assert.equal(showAll.attrs.type, 'button');
  assert.equal(contentOf(showAll), 'Show all');
  assert.ok(!inForm(showAll));
  const list = byId('booking-list');
  assert.equal(list.name, 'ul');
  assert.ok(!inForm(list));
  const err = byId('error');
  assert.equal(err.name, 'p');
  assert.equal(err.attrs.role, 'alert');
  assert.equal(contentOf(err), '');
  assert.ok(!inForm(err));
});

test('exactly one script: src /app.js, no extra attrs, last in body, no inline code', () => {
  assert.equal((html.match(/<script/gi) || []).length, 1);
  const script = opens('script')[0];
  assert.deepEqual(Object.keys(script.attrs), ['src']);
  assert.equal(script.attrs.src, '/app.js');
  assert.equal(contentOf(script), '');
  const closeTok = closeOf(script);
  const bodyClose = tokens.find((t) => t.close && t.name === 'body');
  assert.match(html.slice(closeTok.end, bodyClose.start), /^\s*$/);
});

test('no inline event attributes, no option, no room names, no absolute URLs', () => {
  for (const t of tokens.filter((x) => !x.close)) {
    assert.ok(!/\son[a-z]+\s*=/i.test(t.raw), `event attribute in ${t.raw}`);
  }
  assert.equal(opens('option').length, 0);
  assert.ok(!/<option/i.test(html));
  for (const name of ['Aurora', 'Borealis', 'Cosmos']) assert.ok(!html.includes(name), name);
  for (const src of [html, appSrc]) {
    assert.ok(!src.includes('http://'));
    assert.ok(!src.includes('https://'));
  }
});

test('app.js is a classic script without import or export', () => {
  assert.doesNotThrow(() => new vm.Script(appSrc));
  assert.ok(!/\bimport\s*\(/.test(appSrc));
  assert.ok(!/^\s*(import|export)\b/m.test(appSrc));
});
