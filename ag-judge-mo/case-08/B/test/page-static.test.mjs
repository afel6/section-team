import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const rawHtml = read('index.html');
const appSrc = read('app.js');

// ---- tolerant HTML scanning ----

function cleanHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length))
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, b, c) => a + ' '.repeat(b.length) + c);
}

function parseAttrs(text) {
  const attrs = new Map();
  const re = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of (text || '').matchAll(re)) {
    attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function scanElements(html) {
  const out = [];
  const re = /<([a-zA-Z][\w-]*)(\s[^>]*)?>/g;
  for (const m of html.matchAll(re)) {
    out.push({
      tag: m[1].toLowerCase(),
      attrs: parseAttrs(m[2]),
      start: m.index,
      openEnd: m.index + m[0].length,
    });
  }
  return out;
}

const html = cleanHtml(rawHtml);
const elements = scanElements(html);

function innerOf(el) {
  const close = html.toLowerCase().indexOf(`</${el.tag}`, el.openEnd);
  assert.notEqual(close, -1, `no closing tag for <${el.tag}>`);
  return { inner: html.slice(el.openEnd, close), closeStart: close };
}

function byId(id) {
  return elements.filter((e) => e.attrs.get('id') === id);
}

function one(id, tag, attrs = {}) {
  const found = byId(id);
  assert.equal(found.length, 1, `id ${id} should appear exactly once`);
  const el = found[0];
  assert.equal(el.tag, tag, `#${id} tag`);
  for (const [k, v] of Object.entries(attrs)) assert.equal(el.attrs.get(k), v, `#${id} ${k}`);
  return el;
}

const form = byId('booking-form')[0];
const formEnd = form ? html.toLowerCase().indexOf('</form', form.openEnd) : -1;
const inForm = (el) => el.start > form.start && el.start < formEnd;

// ---- title / heading ----

test('title text is exactly "Room bookings"', () => {
  const titles = elements.filter((e) => e.tag === 'title');
  assert.equal(titles.length, 1);
  assert.equal(innerOf(titles[0]).inner, 'Room bookings');
});

test('exactly one h1 with text "Room bookings"', () => {
  const h1s = elements.filter((e) => e.tag === 'h1');
  assert.equal(h1s.length, 1);
  assert.equal(innerOf(h1s[0]).inner, 'Room bookings');
});

// ---- form ----

test('form#booking-form exists with novalidate', () => {
  const f = one('booking-form', 'form');
  assert.ok(f.attrs.has('novalidate'));
  assert.notEqual(formEnd, -1, 'form has a closing tag');
});

test('form holds the five fields and the Book button', () => {
  const fields = [
    ['room', 'select', { name: 'room' }],
    ['title', 'input', { type: 'text', name: 'title' }],
    ['date', 'input', { type: 'date', name: 'date' }],
    ['start', 'input', { type: 'time', name: 'start' }],
    ['end', 'input', { type: 'time', name: 'end' }],
    ['book', 'button', { type: 'submit' }],
  ];
  for (const [id, tag, attrs] of fields) {
    const el = one(id, tag, attrs);
    assert.ok(inForm(el), `#${id} should be inside the form`);
  }
  assert.equal(innerOf(byId('book')[0]).inner, 'Book');
});

// ---- labels ----

const labelCases = [
  ['room', 'Room'],
  ['title', 'Title'],
  ['date', 'Date'],
  ['start', 'Start'],
  ['end', 'End'],
  ['filter-date', 'Show date'],
];
for (const [id, text] of labelCases) {
  test(`label for ${id} has exactly one label with text "${text}"`, () => {
    const labels = elements.filter((e) => e.tag === 'label' && e.attrs.get('for') === id);
    assert.equal(labels.length, 1);
    const { inner } = innerOf(labels[0]);
    assert.ok(!inner.includes('<'), 'label must not contain tags or fields');
    assert.equal(inner.trim(), text);
  });
}

// ---- outside the form ----

test('filter controls, list and error live outside the form', () => {
  const filter = one('filter-date', 'input', { type: 'date' });
  const showAll = one('show-all', 'button', { type: 'button' });
  const list = one('booking-list', 'ul');
  const err = one('error', 'p', { role: 'alert' });
  for (const el of [filter, showAll, list, err]) {
    assert.ok(!inForm(el), `<${el.tag} id=${el.attrs.get('id')}> must be outside the form`);
  }
  assert.equal(innerOf(showAll).inner, 'Show all');
});

test('ul#booking-list is empty', () => {
  assert.equal(innerOf(byId('booking-list')[0]).inner.trim(), '');
});

test('p#error is exactly empty', () => {
  assert.equal(innerOf(byId('error')[0]).inner, '');
});

test('every listed id appears exactly once', () => {
  const ids = ['booking-form', 'room', 'title', 'date', 'start', 'end', 'book',
    'filter-date', 'show-all', 'booking-list', 'error'];
  for (const id of ids) assert.equal(byId(id).length, 1, `id ${id}`);
});

// ---- rooms not in HTML ----

test('select#room is empty', () => {
  assert.equal(innerOf(byId('room')[0]).inner.trim(), '');
});

test('no <option> anywhere and no room names in raw HTML', () => {
  assert.ok(!/<option/i.test(rawHtml));
  for (const name of ['Aurora', 'Borealis', 'Cosmos']) {
    assert.ok(!rawHtml.toLowerCase().includes(name.toLowerCase()), name);
  }
});

// ---- script element ----

test('exactly one script: src=/app.js, no type/defer/async, no content', () => {
  const scripts = elements.filter((e) => e.tag === 'script');
  assert.equal(scripts.length, 1);
  const s = scripts[0];
  assert.equal(s.attrs.get('src'), '/app.js');
  for (const a of ['type', 'defer', 'async']) assert.ok(!s.attrs.has(a), a);
  assert.equal(innerOf(s).inner, '');
});

test('script is the last element in body', () => {
  const s = elements.find((e) => e.tag === 'script');
  const { closeStart } = innerOf(s);
  const rest = html.slice(closeStart);
  assert.match(rest, /^<\/script\s*>\s*<\/body\s*>/i);
});

test('no inline script, no on* attributes, no javascript:', () => {
  for (const e of elements.filter((x) => x.tag === 'script')) assert.ok(e.attrs.has('src'));
  for (const e of elements) {
    for (const name of e.attrs.keys()) {
      assert.ok(!name.toLowerCase().startsWith('on'), `<${e.tag}> has ${name}`);
    }
  }
  assert.ok(!/javascript:/i.test(rawHtml));
});

test('no http:// or https:// in index.html or app.js', () => {
  assert.ok(!/https?:\/\//i.test(rawHtml));
  assert.ok(!/https?:\/\//i.test(appSrc));
});

// ---- app.js ----

test('app.js is a classic script', () => {
  assert.doesNotThrow(() => new vm.Script(appSrc));
  assert.ok(!/^\s*(import|export)\b/m.test(appSrc));
  assert.ok(!/\bimport\s*\(/.test(appSrc));
});

// Remove comments and string/template literals; also collect literal contents.
function stripCode(src) {
  let code = '';
  const literals = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      literals.push(src.slice(i + 1, j));
      code += '""';
      i = j + 1;
    } else {
      code += c;
      i++;
    }
  }
  return { code, literals };
}

const { code: bareCode, literals } = stripCode(appSrc);

test('app.js only uses document.getElementById and document.createElement', () => {
  const used = new Set([...bareCode.matchAll(/\bdocument\s*\.\s*(\w+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), ['createElement', 'getElementById']);
  assert.ok(!/\bdocument\s*\[/.test(bareCode));
});

test('app.js avoids denied browser APIs', () => {
  const words = ['window', 'globalThis', 'self', 'location', 'XMLHttpRequest', 'innerHTML',
    'outerHTML', 'insertAdjacentHTML', 'querySelector', 'querySelectorAll', 'setTimeout',
    'setInterval', 'localStorage', 'sessionStorage', 'history', 'navigator', 'alert',
    'console', 'eval', 'appendChild', 'innerText', 'createTextNode', 'classList', 'dataset',
    'setAttribute', 'checked', 'style', 'children'];
  for (const w of words) {
    assert.ok(!new RegExp(`\\b${w}\\b`).test(bareCode), `uses ${w}`);
  }
  assert.ok(!/\bFunction\s*\(/.test(bareCode), 'uses Function(');
  assert.ok(!/\.\s*remove\s*\(/.test(bareCode), 'uses .remove(');
  assert.ok(!/\.on[a-z]+\s*=(?!=)/.test(bareCode), 'assigns an on* handler');
});

test('app.js does not wait for load events', () => {
  const noComments = appSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/addEventListener\(\s*['"`](DOMContentLoaded|load)['"`]/.test(noComments));
});

test('app.js fetch URLs are limited to the allowed paths', () => {
  const allowed = new Set(['/api/rooms', '/api/bookings', '/api/bookings?date=', '/api/bookings/']);
  const slashed = literals.filter((l) => l.startsWith('/'));
  assert.ok(slashed.length > 0, 'expected some URL literals');
  for (const l of slashed) assert.ok(allowed.has(l), `unexpected URL literal ${l}`);
});
