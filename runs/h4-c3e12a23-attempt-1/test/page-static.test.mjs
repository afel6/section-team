import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../public/', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const js = fs.readFileSync(new URL('app.js', root), 'utf8');

function tag(re) {
  const m = html.match(re);
  assert.ok(m, `missing ${re}`);
  return m[0];
}

test('title and single h1 are Room bookings', () => {
  assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], 'Room bookings');
  const h1s = html.match(/<h1[\s>]/g) ?? [];
  assert.equal(h1s.length, 1);
  assert.equal(html.match(/<h1[^>]*>([^<]*)<\/h1>/)[1], 'Room bookings');
});

test('form has novalidate and holds the controls', () => {
  assert.match(tag(/<form\b[^>]*>/), /id="booking-form"/);
  assert.match(tag(/<form\b[^>]*>/), /\snovalidate\b/);
  assert.match(tag(/<select\b[^>]*>/), /id="room"[^>]*name="room"|name="room"[^>]*id="room"/);
});

const fields = [['text', 'title'], ['date', 'date'], ['time', 'start'], ['time', 'end']];
for (const [type, id] of fields) {
  test(`input #${id} has type ${type} and matching name`, () => {
    const el = tag(new RegExp(`<input\\b[^>]*id="${id}"[^>]*>`));
    assert.match(el, new RegExp(`type="${type}"`));
    assert.match(el, new RegExp(`name="${id}"`));
  });
}

const labels = { room: 'Room', title: 'Title', date: 'Date', start: 'Start', end: 'End', 'filter-date': 'Show date' };
for (const [id, text] of Object.entries(labels)) {
  test(`label for ${id} has text ${text} and no field inside`, () => {
    const m = html.match(new RegExp(`<label\\b[^>]*for="${id}"[^>]*>([\\s\\S]*?)</label>`));
    assert.ok(m, 'label missing');
    assert.equal(m[1], text);
  });
}

test('buttons, list and error paragraph', () => {
  const book = html.match(/<button\b[^>]*id="book"[^>]*>([^<]*)<\/button>/);
  assert.match(book[0], /type="submit"/);
  assert.equal(book[1], 'Book');
  const all = html.match(/<button\b[^>]*id="show-all"[^>]*>([^<]*)<\/button>/);
  assert.match(all[0], /type="button"/);
  assert.equal(all[1], 'Show all');
  assert.match(tag(/<input\b[^>]*id="filter-date"[^>]*>/), /type="date"/);
  assert.match(html, /<ul\b[^>]*id="booking-list"[^>]*><\/ul>/);
  assert.match(html, /<p id="error" role="alert"><\/p>/);
});

test('no options, room names or absolute urls', () => {
  assert.doesNotMatch(html, /<option/);
  for (const name of ['Aurora', 'Borealis', 'Cosmos']) assert.ok(!html.includes(name));
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, / on[a-z]+=/);
});

test('exactly one plain script tag, last element in body', () => {
  assert.equal((html.match(/<script\b/g) ?? []).length, 1);
  assert.ok(html.includes('<script src="/app.js"></script>'));
  assert.match(html, /<script src="\/app\.js"><\/script>\s*<\/body>/);
});

test('app.js is a classic script without forbidden constructs', () => {
  assert.doesNotMatch(js, /^\s*(import|export)\b/m);
  assert.doesNotMatch(js, /https?:\/\//);
  const banned = ['innerHTML', 'outerHTML', 'querySelector', 'createTextNode', 'setAttribute',
    'dataset', 'classList', 'console', 'URLSearchParams', 'encodeURIComponent', 'location',
    'setTimeout', 'insertAdjacent', 'document.write', "addEventListener('load'",
    "addEventListener('DOMContentLoaded'", 'addEventListener("load"', 'addEventListener("DOMContentLoaded"'];
  for (const word of banned) assert.ok(!js.includes(word), `app.js uses ${word}`);
});
