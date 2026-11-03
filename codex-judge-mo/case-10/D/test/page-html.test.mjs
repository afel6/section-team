import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT } from './helpers/server.mjs';
import { parseHtml, elements, byId, textContent, isInside, elementChildren } from './helpers/html.mjs';

const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
const doc = parseHtml(html);
const all = elements(doc);
const form = byId(doc, 'booking-form');
const FIELD_TAGS = new Set(['input', 'select', 'textarea', 'button']);

const byTag = (tag) => all.filter((e) => e.tag === tag);
const labelsFor = (id) => byTag('label').filter((l) => l.attrs.get('for') === id);

function checkLabel(id, expected) {
  const field = byId(doc, id);
  const labels = labelsFor(id);
  assert.strictEqual(labels.length, 1, `exactly one label for ${id}`);
  assert.strictEqual(textContent(labels[0]), expected);
  assert.ok(!isInside(field, labels[0]), 'label must not contain its field');
  const stray = elements(labels[0]).filter((e) => FIELD_TAGS.has(e.tag));
  assert.deepStrictEqual(stray, [], 'label contains no form controls');
}

test('title text is Room bookings', () => {
  const titles = byTag('title');
  assert.strictEqual(titles.length, 1);
  assert.strictEqual(textContent(titles[0]), 'Room bookings');
});

test('exactly one h1 with text Room bookings', () => {
  const h1s = byTag('h1');
  assert.strictEqual(h1s.length, 1);
  assert.strictEqual(textContent(h1s[0]), 'Room bookings');
});

test('form#booking-form exists with novalidate', () => {
  assert.ok(form);
  assert.strictEqual(form.tag, 'form');
  assert.ok(form.attrs.has('novalidate'));
});

const FIELDS = [
  ['room', 'select', null, 'Room'],
  ['title', 'input', 'text', 'Title'],
  ['date', 'input', 'date', 'Date'],
  ['start', 'input', 'time', 'Start'],
  ['end', 'input', 'time', 'End'],
];

for (const [id, tag, type, label] of FIELDS) {
  test(`field #${id} is a ${tag}${type ? ` type ${type}` : ''} inside the form`, () => {
    const el = byId(doc, id);
    assert.ok(el, `#${id} exists`);
    assert.strictEqual(el.tag, tag);
    assert.strictEqual(el.attrs.get('name'), id);
    if (type) assert.strictEqual(el.attrs.get('type'), type);
    assert.ok(isInside(el, form));
  });
  test(`field #${id} has its own label "${label}"`, () => checkLabel(id, label));
}

test('button#book is a submit button inside the form with text Book', () => {
  const b = byId(doc, 'book');
  assert.ok(b);
  assert.strictEqual(b.tag, 'button');
  assert.strictEqual(b.attrs.get('type'), 'submit');
  assert.strictEqual(textContent(b), 'Book');
  assert.ok(isInside(b, form));
});

test('filter-date is a date input outside the form', () => {
  const el = byId(doc, 'filter-date');
  assert.ok(el);
  assert.strictEqual(el.tag, 'input');
  assert.strictEqual(el.attrs.get('type'), 'date');
  assert.ok(!isInside(el, form));
});

test('filter-date has its own label "Show date"', () => checkLabel('filter-date', 'Show date'));

test('show-all is a plain button outside the form with text Show all', () => {
  const b = byId(doc, 'show-all');
  assert.ok(b);
  assert.strictEqual(b.tag, 'button');
  assert.strictEqual(b.attrs.get('type'), 'button');
  assert.strictEqual(textContent(b), 'Show all');
  assert.ok(!isInside(b, form));
});

test('ul#booking-list exists outside the form', () => {
  const ul = byId(doc, 'booking-list');
  assert.ok(ul);
  assert.strictEqual(ul.tag, 'ul');
  assert.ok(!isInside(ul, form));
});

test('p#error has role alert, is empty and outside the form', () => {
  const p = byId(doc, 'error');
  assert.ok(p);
  assert.strictEqual(p.tag, 'p');
  assert.strictEqual(p.attrs.get('role'), 'alert');
  assert.strictEqual(p.children.length, 0);
  assert.ok(!isInside(p, form));
});

test('ids are unique across the document', () => {
  const ids = all.filter((e) => e.attrs.has('id')).map((e) => e.attrs.get('id'));
  assert.deepStrictEqual(ids, [...new Set(ids)]);
});

test('no option element and no room names in the HTML', () => {
  assert.strictEqual(byTag('option').length, 0);
  assert.ok(!/<option/i.test(html));
  for (const name of ['Aurora', 'Borealis', 'Cosmos']) {
    assert.ok(!html.toLowerCase().includes(name.toLowerCase()), name);
  }
});

test('exactly one script: src /app.js, no type/defer/async, no text', () => {
  const scripts = byTag('script');
  assert.strictEqual(scripts.length, 1);
  const s = scripts[0];
  assert.strictEqual(s.attrs.get('src'), '/app.js');
  for (const a of ['type', 'defer', 'async']) assert.ok(!s.attrs.has(a), a);
  assert.strictEqual(textContent(s), '');
});

test('script is the last element child of body', () => {
  const [body] = byTag('body');
  assert.ok(body);
  const [s] = byTag('script');
  assert.strictEqual(s.parent, body);
  const kids = elementChildren(body);
  assert.strictEqual(kids[kids.length - 1], s);
});

test('no element has an on... attribute', () => {
  for (const e of all) {
    for (const name of e.attrs.keys()) {
      assert.ok(!name.toLowerCase().startsWith('on'), `${e.tag} has ${name}`);
    }
  }
});

test('index.html and app.js contain no http:// or https://', () => {
  for (const src of [html, js]) assert.ok(!/https?:\/\//i.test(src));
});

test('app.js is a classic script', () => {
  assert.doesNotThrow(() => new vm.Script(js));
  assert.ok(!/^\s*(import|export)\b/m.test(js));
  assert.ok(!/\bimport\s*\(/.test(js));
});

test('app.js avoids forbidden browser APIs', () => {
  const banned = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write',
    'querySelector', 'setTimeout', 'setInterval', 'window', 'location',
    'XMLHttpRequest', 'DOMContentLoaded', "'load'", 'localStorage', 'console'];
  for (const word of banned) assert.ok(!js.includes(word), `app.js mentions ${word}`);
});

test('parser: void elements do not swallow siblings', () => {
  const r = parseHtml('<p>a<br>b<input type=text></p><i>x</i>');
  const p = elements(r)[0];
  assert.deepStrictEqual(elementChildren(p).map((e) => e.tag), ['br', 'input']);
  assert.strictEqual(textContent(p), 'ab');
  assert.strictEqual(elements(r).at(-1).parent, r);
});

test('parser: bare, single-quoted, double-quoted and unquoted attrs', () => {
  const r = parseHtml(`<form NoValidate id='f' class="a b" data-x=y></form>`);
  const f = byId(r, 'f');
  assert.strictEqual(f.attrs.get('novalidate'), '');
  assert.strictEqual(f.attrs.get('class'), 'a b');
  assert.strictEqual(f.attrs.get('data-x'), 'y');
});

test('parser: script content is raw text', () => {
  const r = parseHtml('<script>var a = "<b>x</b>";</script><p>t</p>');
  const [s, p] = elements(r);
  assert.strictEqual(s.children.length, 1);
  assert.strictEqual(textContent(s), 'var a = "<b>x</b>";');
  assert.strictEqual(p.tag, 'p');
  assert.strictEqual(elements(r).length, 2);
});

test('parser: comments and doctype are skipped', () => {
  const r = parseHtml('<!DOCTYPE html><!-- <p id="no"> --><div>ok</div>');
  assert.deepStrictEqual(elements(r).map((e) => e.tag), ['div']);
  assert.strictEqual(byId(r, 'no'), null);
});

test('parser: close tag pops to the matching element', () => {
  const r = parseHtml('<div><span><b>x</div><p>y</p>');
  const p = elements(r).find((e) => e.tag === 'p');
  assert.strictEqual(p.parent, r);
});
