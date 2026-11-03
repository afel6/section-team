import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHtml, byId, byTag, within } from './helpers/html.mjs';

const read = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const HTML = read('index.html');
const APP = read('app.js');

const FIELDS = [
  ['room', 'select', null, 'Room'], ['title', 'input', 'text', 'Title'],
  ['date', 'input', 'date', 'Date'], ['start', 'input', 'time', 'Start'],
  ['end', 'input', 'time', 'End'],
];

function single(nodes, id, problems) {
  const found = byId(nodes, id);
  if (found.length !== 1) problems.push(`#${id} found ${found.length} times`);
  return found[0];
}

function expectAttr(node, name, value, label, problems) {
  if (node && node.attrs.get(name) !== value) problems.push(`${label} ${name} != ${value}`);
}

function checkTitles(nodes, problems) {
  const titles = byTag(nodes, 'title');
  if (titles.length !== 1 || titles[0].innerText !== 'Room bookings') problems.push('title');
  const h1 = byTag(nodes, 'h1');
  if (h1.length !== 1 || h1[0].innerText !== 'Room bookings') problems.push('h1');
}

function checkLabel(nodes, id, text, problems) {
  const labels = byTag(nodes, 'label').filter((l) => l.attrs.get('for') === id);
  if (labels.length !== 1) return problems.push(`label for ${id} found ${labels.length}`);
  const [label] = labels;
  if (label.innerText !== text) problems.push(`label ${id} text`);
  const contained = nodes.filter((n) => within(label, n) && (n.attrs.get('id') === id
    || n.tag === 'input' || n.tag === 'select'));
  if (contained.length) problems.push(`label ${id} contains its field`);
}

function checkFormFields(nodes, form, problems) {
  for (const [id, tag, type, text] of FIELDS) {
    const node = single(nodes, id, problems);
    if (!node) continue;
    if (node.tag !== tag) problems.push(`#${id} tag`);
    if (!within(form, node)) problems.push(`#${id} not in form`);
    expectAttr(node, 'name', id, `#${id}`, problems);
    if (type) expectAttr(node, 'type', type, `#${id}`, problems);
    checkLabel(nodes, id, text, problems);
  }
  const book = single(nodes, 'book', problems);
  if (!book) return;
  if (book.tag !== 'button' || book.innerText !== 'Book') problems.push('#book');
  expectAttr(book, 'type', 'submit', '#book', problems);
  if (!within(form, book)) problems.push('#book not in form');
}

function checkOutside(nodes, form, problems) {
  const outside = [['filter-date', 'input', 'date'], ['show-all', 'button', 'button'],
    ['booking-list', 'ul', null], ['error', 'p', null]];
  for (const [id, tag, type] of outside) {
    const node = single(nodes, id, problems);
    if (!node) continue;
    if (node.tag !== tag) problems.push(`#${id} tag`);
    if (within(form, node)) problems.push(`#${id} inside form`);
    if (type) expectAttr(node, 'type', type, `#${id}`, problems);
  }
  checkLabel(nodes, 'filter-date', 'Show date', problems);
  const label = byTag(nodes, 'label').find((l) => l.attrs.get('for') === 'filter-date');
  if (label && within(form, label)) problems.push('filter label inside form');
  const showAll = byId(nodes, 'show-all')[0];
  if (showAll && showAll.innerText !== 'Show all') problems.push('show-all text');
  const err = byId(nodes, 'error')[0];
  if (err) {
    expectAttr(err, 'role', 'alert', '#error', problems);
    if (err.innerHtml.trim() !== '') problems.push('#error not empty');
  }
}

function checkForm(nodes, problems) {
  const forms = byId(nodes, 'booking-form');
  if (forms.length !== 1 || forms[0].tag !== 'form') return problems.push('form');
  if (!forms[0].attrs.has('novalidate')) problems.push('form novalidate');
  checkFormFields(nodes, forms[0], problems);
  checkOutside(nodes, forms[0], problems);
}

function checkIds(nodes, problems) {
  const ids = nodes.filter((n) => n.attrs.has('id')).map((n) => n.attrs.get('id'));
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`duplicate ids ${dup.join(',')}`);
}

function checkScript(html, nodes, problems) {
  const scripts = byTag(nodes, 'script');
  if (scripts.length !== 1) return problems.push(`script count ${scripts.length}`);
  const [s] = scripts;
  if (s.attrs.get('src') !== '/app.js') problems.push('script src');
  for (const a of ['type', 'defer', 'async']) {
    if (s.attrs.has(a)) problems.push(`script has ${a}`);
  }
  if (s.innerHtml !== '') problems.push('inline script');
  if (s.parentTags.at(-1) !== 'body') problems.push('script not direct child of body');
  const tail = html.slice(s.end, html.toLowerCase().lastIndexOf('</body'));
  if (tail.replace(/<!--[\s\S]*?-->/g, '').trim() !== '') problems.push('script not last');
}

function checkMisc(html, nodes, problems) {
  if (/<option/i.test(html)) problems.push('option element');
  for (const room of ['Aurora', 'Borealis', 'Cosmos']) {
    if (html.includes(room)) problems.push(`room name ${room}`);
  }
  for (const n of nodes) {
    for (const name of n.attrs.keys()) {
      if (name.startsWith('on')) problems.push(`event attribute ${name}`);
    }
  }
  if (/https?:\/\//i.test(html)) problems.push('url scheme in html');
}

export function checkPage(html) {
  const nodes = parseHtml(html);
  const problems = [];
  checkTitles(nodes, problems);
  checkForm(nodes, problems);
  checkIds(nodes, problems);
  checkScript(html, nodes, problems);
  checkMisc(html, nodes, problems);
  return problems;
}

describe('index.html structure', () => {
  test('real page has no problems', () => {
    assert.deepEqual(checkPage(HTML), []);
  });

  test('neither html nor app.js contains http:// or https://', () => {
    assert.equal(/https?:\/\//i.test(HTML), false);
    assert.equal(/https?:\/\//i.test(APP), false);
  });

  test('tokenizer reads key facts of the real page', () => {
    const nodes = parseHtml(HTML);
    assert.equal(byTag(nodes, 'h1')[0].innerText, 'Room bookings');
    assert.equal(byId(nodes, 'book')[0].innerText, 'Book');
    assert.equal(byTag(nodes, 'script')[0].attrs.get('src'), '/app.js');
    assert.deepEqual(byId(nodes, 'error')[0].parentTags, ['html', 'body']);
  });
});

describe('checkPage bites on bad variants', () => {
  const variants = {
    'label wraps input': ['<label for="title">Title</label>\n  <input type="text" id="title" name="title">',
      '<label for="title">Title <input type="text" id="title" name="title"></label>'],
    'script with defer': ['<script src', '<script defer src'],
    'script not last': ['<script src="/app.js"></script>', '<script src="/app.js"></script><p>x</p>'],
    'two h1': ['</h1>', '</h1><h1>Room bookings</h1>'],
    'form without novalidate': [' novalidate', ''],
    'option present': ['<select id="room" name="room">', '<select id="room" name="room"><option>a</option>'],
    'inline script': ['<script src="/app.js"></script>', '<script src="/app.js">var a;</script>'],
    'onclick attribute': ['<button type="submit"', '<button onclick="x()" type="submit"'],
    'wrong label text': ['>Start</label>', '>Begin</label>'],
    'absolute url': ['src="/app.js"', 'src="http://x/app.js"'],
    'room name in html': ['<ul id="booking-list">', '<ul id="booking-list">Aurora'],
    'error not empty': ['<p id="error" role="alert">', '<p id="error" role="alert"> x '],
    'duplicate id': ['<h1>', '<h1 id="room">'],
    'filter inside form': ['<button type="submit" id="book">Book</button>',
      '<button type="submit" id="book">Book</button><button type="button" id="show-all">Show all</button>'],
  };
  for (const [name, [from, to]] of Object.entries(variants)) {
    test(name, () => {
      assert.ok(HTML.includes(from), `fixture text missing: ${from}`);
      const bad = HTML.replace(from, () => to);
      assert.notEqual(bad, HTML);
      assert.notDeepEqual(checkPage(bad), []);
    });
  }
});
