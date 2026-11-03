import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHtml, findAll, byId, textOf, isDescendant, elementChildren } from './helpers/html-tree.mjs';

const htmlText = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appText = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const root = parseHtml(htmlText);
const form = byId(root, 'booking-form');
const tagged = (tag) => findAll(root, (n) => n.tag === tag);

describe('parser self-tests', () => {
  it('handles quoted, single-quoted, unquoted and boolean attributes', () => {
    const r = parseHtml(`<DIV ID=a Class='b c' data-x="d>e" hidden></DIV>`);
    assert.deepEqual(byId(r, 'a').attrs, { id: 'a', class: 'b c', 'data-x': 'd>e', hidden: '' });
  });
  it('treats void input inside label as childless', () => {
    const r = parseHtml('<label for="x">A<input id="x"/>B</label><p>t</p>');
    const label = findAll(r, (n) => n.tag === 'label')[0];
    assert.equal(textOf(label), 'AB');
    assert.equal(isDescendant(byId(r, 'x'), label), true);
    assert.equal(elementChildren(r).length, 2);
  });
  it('ignores comments and doctype', () => {
    const r = parseHtml('<!DOCTYPE html><!-- <b>x</b> --><p>hi</p>');
    assert.equal(findAll(r, () => true).length, 1);
    assert.equal(textOf(r), 'hi');
  });
  it('keeps raw text in script', () => {
    const r = parseHtml('<script>var a="<b>";</script><i></i>');
    const s = findAll(r, (n) => n.tag === 'script')[0];
    assert.equal(textOf(s), 'var a="<b>";');
    assert.equal(findAll(r, (n) => n.tag === 'b').length, 0);
    assert.equal(findAll(r, (n) => n.tag === 'i').length, 1);
  });
});

describe('index.html', () => {
  it('has title and a single h1 "Room bookings"', () => {
    assert.equal(textOf(tagged('title')[0]), 'Room bookings');
    const headings = tagged('h1');
    assert.equal(headings.length, 1);
    assert.equal(textOf(headings[0]), 'Room bookings');
  });

  it('has form#booking-form with novalidate', () => {
    assert.ok(form);
    assert.equal(form.tag, 'form');
    assert.ok('novalidate' in form.attrs);
  });

  const fields = [
    ['select', 'room', undefined, 'room'],
    ['input', 'title', 'text', 'title'],
    ['input', 'date', 'date', 'date'],
    ['input', 'start', 'time', 'start'],
    ['input', 'end', 'time', 'end'],
  ];
  for (const [tag, id, type, name] of fields) {
    it(`form contains ${tag}#${id}`, () => {
      const field = byId(root, id);
      assert.ok(field);
      assert.equal(field.tag, tag);
      assert.ok(isDescendant(field, form));
      assert.equal(field.attrs.name, name);
      if (type) assert.equal(field.attrs.type, type);
    });
  }

  it('form contains submit button#book "Book"', () => {
    const bookButton = byId(root, 'book');
    assert.ok(bookButton);
    assert.equal(bookButton.tag, 'button');
    assert.ok(isDescendant(bookButton, form));
    assert.equal(bookButton.attrs.type, 'submit');
    assert.equal(textOf(bookButton), 'Book');
  });

  const labels = [['room', 'Room'], ['title', 'Title'], ['date', 'Date'], ['start', 'Start'], ['end', 'End'], ['filter-date', 'Show date']];
  for (const [id, text] of labels) {
    it(`has exactly one label for=${id} with text "${text}"`, () => {
      const matchingLabels = findAll(root, (n) => n.tag === 'label' && n.attrs.for === id);
      assert.equal(matchingLabels.length, 1);
      assert.equal(textOf(matchingLabels[0]), text);
      assert.equal(isDescendant(byId(root, id), matchingLabels[0]), false);
    });
  }

  it('has filter controls and list outside the form', () => {
    const filterDate = byId(root, 'filter-date');
    assert.equal(filterDate.tag, 'input');
    assert.equal(filterDate.attrs.type, 'date');
    const showAll = byId(root, 'show-all');
    assert.equal(showAll.tag, 'button');
    assert.equal(showAll.attrs.type, 'button');
    assert.equal(textOf(showAll), 'Show all');
    const list = byId(root, 'booking-list');
    assert.equal(list.tag, 'ul');
    const errorBox = byId(root, 'error');
    assert.equal(errorBox.tag, 'p');
    assert.equal(errorBox.attrs.role, 'alert');
    assert.equal(errorBox.children.length, 0);
    for (const outside of [filterDate, showAll, list, errorBox]) assert.equal(isDescendant(outside, form), false);
  });

  it('has no options and no seeded room names', () => {
    assert.equal(tagged('option').length, 0);
    for (const roomName of ['Aurora', 'Borealis', 'Cosmos']) assert.ok(!htmlText.includes(roomName), roomName);
  });

  it('has exactly one plain script as last element of body', () => {
    const scripts = tagged('script');
    assert.equal(scripts.length, 1);
    const script = scripts[0];
    assert.equal(script.attrs.src, '/app.js');
    for (const attr of ['type', 'defer', 'async']) assert.ok(!(attr in script.attrs), attr);
    assert.equal(textOf(script), '');
    const body = tagged('body')[0];
    const bodyElements = elementChildren(body);
    assert.equal(bodyElements[bodyElements.length - 1], script);
    const after = body.children.slice(body.children.indexOf(script) + 1);
    assert.ok(after.every((c) => c.text !== undefined && c.text.trim() === ''));
  });

  it('has no on* attributes', () => {
    const bad = findAll(root, (n) => Object.keys(n.attrs).some((k) => k.toLowerCase().startsWith('on')));
    assert.equal(bad.length, 0);
  });

  it('has unique ids', () => {
    const ids = findAll(root, (n) => 'id' in n.attrs).map((n) => n.attrs.id);
    assert.deepEqual(ids, [...new Set(ids)]);
  });
});

describe('no external URLs', () => {
  for (const [name, src] of [['index.html', htmlText], ['app.js', appText]]) {
    it(`${name} has no http(s) URL`, () => {
      assert.ok(!/https?:\/\//i.test(src));
    });
  }
});

describe('app.js', () => {
  it('is a classic script', () => {
    assert.doesNotThrow(() => new vm.Script(appText));
    assert.ok(!/import\s*\(/.test(appText));
    assert.ok(!/^\s*(import|export)\b/m.test(appText));
  });
  it('does setup at once', () => {
    for (const w of ['DOMContentLoaded', "'load'", '"load"', 'onload', 'window']) {
      assert.ok(!appText.includes(w), w);
    }
  });
});
