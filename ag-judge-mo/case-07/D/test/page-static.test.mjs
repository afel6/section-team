// Static checks of the page (public/index.html, public/app.js) and how it is served.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { startServer, request, makeTempDir, removeDir, ROOT } from './helpers.mjs';

const HTML_PATH = path.join(ROOT, 'public', 'index.html');
const JS_PATH = path.join(ROOT, 'public', 'app.js');
const HTML_CT = 'text/html; charset=utf-8';
const JS_CT = 'text/javascript; charset=utf-8';
const VOID = new Set(['meta', 'input', 'br', 'link', 'img', 'hr']);
const RAW = new Set(['script', 'style']);
const ROOMS = ['Aurora', 'Borealis', 'Cosmos'];

// ---- tiny tokenizer ----
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(ATTR_RE)) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

function tokenize(html) {
  const tokens = [];
  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/([a-zA-Z][^\s>]*)\s*>|<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|([^<]+|<)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1]) tokens.push({ t: 'end', name: m[1].toLowerCase() });
    else if (m[2]) {
      const name = m[2].toLowerCase();
      tokens.push({ t: 'start', name, attrs: parseAttrs(m[3]) });
      if (RAW.has(name)) {
        const close = html.toLowerCase().indexOf(`</${name}`, re.lastIndex);
        if (close > re.lastIndex) tokens.push({ t: 'text', text: html.slice(re.lastIndex, close) });
        re.lastIndex = close < 0 ? html.length : close;
      }
    } else if (m[4] !== undefined) tokens.push({ t: 'text', text: m[4] });
  }
  return tokens;
}

// Index of the end token matching the start token at i (i itself for void tags).
function endIndex(tokens, i) {
  const name = tokens[i].name;
  if (VOID.has(name)) return i;
  let depth = 0;
  for (let j = i; j < tokens.length; j++) {
    const tk = tokens[j];
    if (tk.name !== name) continue;
    if (tk.t === 'start') depth++;
    else if (tk.t === 'end' && --depth === 0) return j;
  }
  return -1;
}

function textBetween(tokens, i) {
  const e = endIndex(tokens, i);
  assert.ok(e > i, `no end tag for <${tokens[i].name}>`);
  const inner = tokens.slice(i + 1, e);
  assert.ok(inner.every((x) => x.t === 'text'), `<${tokens[i].name}> holds nested tags`);
  return inner.map((x) => x.text).join('');
}

function starts(tokens, name, attrs = {}) {
  const out = [];
  tokens.forEach((tk, i) => {
    if (tk.t !== 'start' || tk.name !== name) return;
    if (Object.entries(attrs).every(([k, v]) => tk.attrs[k] === v)) out.push(i);
  });
  return out;
}

function only(tokens, name, attrs) {
  const found = starts(tokens, name, attrs);
  assert.equal(found.length, 1, `expected exactly one <${name}> ${JSON.stringify(attrs)}`);
  return found[0];
}

// ---- fixtures ----
let htmlText;
let jsText;
let tokens;
test.before(async () => {
  htmlText = await readFile(HTML_PATH, 'utf8');
  jsText = await readFile(JS_PATH, 'utf8');
  tokens = tokenize(htmlText);
});

// ---- 1. served over HTTP ----
async function withServer(opts, fn) {
  const dir = await makeTempDir();
  let srv;
  try {
    srv = await startServer({ ...opts, env: { DATA_FILE: path.join(dir, 'data.json') } });
    await fn(srv.port, dir);
  } finally {
    if (srv) await srv.stop();
    await removeDir(dir);
  }
}

test('GET / serves index.html with exact content type and bytes', async () => {
  await withServer({}, async (port) => {
    const res = await request(port, { path: '/' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], HTML_CT);
    assert.deepEqual(res.raw, await readFile(HTML_PATH));
  });
});

test('GET /app.js serves app.js with exact content type and bytes', async () => {
  await withServer({}, async (port) => {
    const res = await request(port, { path: '/app.js' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], JS_CT);
    assert.deepEqual(res.raw, await readFile(JS_PATH));
  });
});

test('query strings do not change the served files', async () => {
  await withServer({}, async (port) => {
    const page = await request(port, { path: '/?x=1' });
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-type'], HTML_CT);
    const js = await request(port, { path: '/app.js?v=2' });
    assert.equal(js.status, 200);
    assert.equal(js.headers['content-type'], JS_CT);
  });
});

test('public/ is resolved from the server folder, not the cwd', async () => {
  const cwd = await makeTempDir();
  try {
    await withServer({ cwd }, async (port) => {
      const res = await request(port, { path: '/' });
      assert.equal(res.status, 200);
      assert.equal(res.headers['content-type'], HTML_CT);
      assert.deepEqual(res.raw, await readFile(HTML_PATH));
    });
  } finally {
    await removeDir(cwd);
  }
});

// ---- 2. index.html structure ----
test('title and h1 are exactly "Room bookings"', () => {
  assert.equal(textBetween(tokens, only(tokens, 'title')), 'Room bookings');
  assert.equal(textBetween(tokens, only(tokens, 'h1')), 'Room bookings');
});

test('form exists with novalidate', () => {
  const form = tokens[only(tokens, 'form', { id: 'booking-form' })];
  assert.ok('novalidate' in form.attrs);
});

function formRange() {
  const i = only(tokens, 'form', { id: 'booking-form' });
  return [i, endIndex(tokens, i)];
}

const FORM_FIELDS = [
  ['select', { id: 'room', name: 'room' }],
  ['input', { type: 'text', id: 'title', name: 'title' }],
  ['input', { type: 'date', id: 'date', name: 'date' }],
  ['input', { type: 'time', id: 'start', name: 'start' }],
  ['input', { type: 'time', id: 'end', name: 'end' }],
];
const LABELS = { room: 'Room', title: 'Title', date: 'Date', start: 'Start', end: 'End' };

test('form holds the five fields and the Book button', () => {
  const [from, to] = formRange();
  assert.ok(to > from);
  for (const [name, attrs] of FORM_FIELDS) {
    const i = only(tokens, name, attrs);
    assert.ok(i > from && i < to, `#${attrs.id} is inside the form`);
  }
  const b = only(tokens, 'button', { type: 'submit', id: 'book' });
  assert.ok(b > from && b < to);
  assert.equal(textBetween(tokens, b), 'Book');
});

function checkLabel(id, text) {
  const l = only(tokens, 'label', { for: id });
  assert.equal(textBetween(tokens, l), text);
  const field = starts(tokens, 'select').concat(starts(tokens, 'input'))
    .find((i) => tokens[i].attrs.id === id);
  assert.ok(field !== undefined, `field #${id} exists`);
  assert.ok(field < l || field > endIndex(tokens, l), `#${id} is not inside its label`);
}

test('each form field has its own exact label outside of it', () => {
  for (const [id, text] of Object.entries(LABELS)) checkLabel(id, text);
});

test('each id appears once in the document', () => {
  const ids = tokens.filter((x) => x.t === 'start' && 'id' in x.attrs).map((x) => x.attrs.id);
  for (const id of [...Object.keys(LABELS), 'book', 'booking-form', 'filter-date', 'show-all', 'booking-list', 'error']) {
    assert.equal(ids.filter((x) => x === id).length, 1, `id ${id}`);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test('filter, Show all, list and error live outside the form', () => {
  const [from, to] = formRange();
  const outside = (i) => i < from || i > to;
  const f = only(tokens, 'input', { type: 'date', id: 'filter-date' });
  assert.ok(outside(f));
  checkLabel('filter-date', 'Show date');
  assert.ok(outside(only(tokens, 'label', { for: 'filter-date' })));
  const s = only(tokens, 'button', { type: 'button', id: 'show-all' });
  assert.ok(outside(s));
  assert.equal(textBetween(tokens, s), 'Show all');
  assert.ok(outside(only(tokens, 'ul', { id: 'booking-list' })));
});

test('#error is an empty p with role=alert, outside the form', () => {
  const [from, to] = formRange();
  const p = only(tokens, 'p', { id: 'error', role: 'alert' });
  assert.ok(p < from || p > to);
  assert.deepEqual(tokens[p + 1], { t: 'end', name: 'p' });
});

test('no option elements and no room names in the HTML', () => {
  assert.equal(/<option/i.test(htmlText), false);
  assert.equal(starts(tokens, 'option').length, 0);
  for (const name of ROOMS) assert.equal(htmlText.includes(name), false, name);
});

test('single external script /app.js, last in body, no inline code', () => {
  assert.equal((htmlText.match(/<script/gi) || []).length, 1);
  const s = only(tokens, 'script');
  assert.deepEqual(tokens[s].attrs, { src: '/app.js' });
  assert.deepEqual(tokens[s + 1], { t: 'end', name: 'script' });
  const bodyEnd = tokens.findIndex((x) => x.t === 'end' && x.name === 'body');
  assert.ok(bodyEnd > s);
  for (const tk of tokens.slice(s + 2, bodyEnd)) {
    assert.equal(tk.t, 'text');
    assert.equal(tk.text.trim(), '');
  }
});

test('no on* attributes and no javascript: URLs', () => {
  for (const tk of tokens.filter((x) => x.t === 'start')) {
    for (const [k, v] of Object.entries(tk.attrs)) {
      assert.equal(/^on/i.test(k), false, `<${tk.name} ${k}>`);
      assert.equal(/^\s*javascript:/i.test(v), false, `<${tk.name} ${k}>`);
    }
  }
  assert.equal(/javascript:/i.test(htmlText), false);
});

test('neither file contains http:// or https://', () => {
  assert.equal(/https?:\/\//i.test(htmlText), false);
  assert.equal(/https?:\/\//i.test(jsText), false);
});

// ---- 3. app.js static checks ----
test('app.js is a classic script', () => {
  assert.equal(/^\s*(import|export)\b/m.test(jsText), false);
  assert.equal(/\bimport\s*\(/.test(jsText), false);
  assert.doesNotThrow(() => new vm.Script(jsText));
});

const FORBIDDEN = [
  ['DOMContentLoaded', /DOMContentLoaded/],
  ['load listener', /['"]load['"]/],
  ['onload', /onload/i],
  ['window.', /\bwindow\./],
  ['innerHTML', /innerHTML/],
  ['outerHTML', /outerHTML/],
  ['insertAdjacentHTML', /insertAdjacentHTML/],
  ['document.write', /document\.write/],
  ['querySelector', /querySelector/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['setTimeout', /setTimeout/],
  ['localStorage', /localStorage/],
  ['classList', /classList/],
  ['setAttribute', /setAttribute/],
  ['appendChild', /appendChild/],
  ['.text()', /\.text\s*\(/],
  // The fake Response in fake-dom.mjs has only status and json(), so any other
  // reply member fails the behaviour tests; this catches the common names.
  ['reply.ok', /\b(response|res|reply|resp)\.(ok|statusText|text|blob)\b/],
  ['location', /\blocation\b/],
];

test('app.js uses none of the disallowed browser APIs', () => {
  for (const [label, re] of FORBIDDEN) assert.equal(re.test(jsText), false, label);
});

test('only getElementById and createElement are used on document', () => {
  const members = [...jsText.matchAll(/\bdocument\s*\.\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(members.length > 0);
  for (const m of members) assert.ok(['getElementById', 'createElement'].includes(m), `document.${m}`);
  assert.equal(/\bdocument\s*\[/.test(jsText), false);
});

test('app.js names the API paths and no http', () => {
  assert.ok(jsText.includes('/api/rooms'));
  assert.ok(jsText.includes('/api/bookings'));
  assert.equal(/https?:\/\//i.test(jsText), false);
});
