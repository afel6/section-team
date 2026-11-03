// A strict fake browser for public/app.js: any member the spec does not allow throws.
import fs from 'node:fs';
import vm from 'node:vm';

export const APP_PATH = new URL('../../public/app.js', import.meta.url);
export const HTML_PATH = new URL('../../public/index.html', import.meta.url);

const ELEMENT_ALLOWED = new Set([
  'textContent', 'value', 'type', 'disabled', 'append', 'replaceChildren', 'addEventListener',
]);
const ELEMENT_SETTABLE = new Set(['textContent', 'value', 'type', 'disabled']);

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.textContent = text;
  }
}

function toNode(item) {
  return typeof item === 'string' ? new FakeText(item) : item;
}

function nodeText(node) {
  return node.textContent;
}

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.value = '';
    this.type = undefined;
    this.disabled = false;
    this.listeners = new Map();
  }

  get textContent() {
    return this.children.map(nodeText).join('');
  }

  set textContent(text) {
    this.children = text === '' ? [] : [new FakeText(String(text))];
  }

  append(...items) {
    this.children = [...this.children, ...items.map(toNode)];
  }

  replaceChildren(...items) {
    this.children = items.map(toNode);
  }

  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  _dispatch(type) {
    const event = guard({
      _prevented: false,
      preventDefault() {
        this._prevented = true;
      },
    }, new Set(['preventDefault']), 'event');
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
}

function guard(target, allowed, label, settable = new Set()) {
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (prop === '_raw') return obj;
      if (typeof prop === 'string' && (prop.startsWith('_') || allowed.has(prop))) {
        const value = obj[prop];
        return typeof value === 'function' ? value.bind(obj) : value;
      }
      throw new Error(`${label}: forbidden member read: ${String(prop)}`);
    },
    set(obj, prop, value) {
      if (!settable.has(prop)) throw new Error(`${label}: forbidden member write: ${String(prop)}`);
      obj[prop] = value;
      return true;
    },
  });
}

export function makeElement(tagName, id = '') {
  return guard(new FakeElement(tagName, id), ELEMENT_ALLOWED, `<${tagName}>`, ELEMENT_SETTABLE);
}

const ELEMENT_SPECS = [
  ['booking-form', 'form'], ['room', 'select'], ['title', 'input'], ['date', 'input'],
  ['start', 'input'], ['end', 'input'], ['book', 'button'], ['filter-date', 'input'],
  ['show-all', 'button'], ['booking-list', 'ul'], ['error', 'p'],
];

function makeFetch(calls, book) {
  return function fetch(url, options) {
    const call = { url, options, bookDisabled: book.disabled, jsonCalls: 0 };
    call.promise = new Promise((resolve, reject) => {
      call.resolve = resolve;
      call.reject = reject;
    });
    calls.push(call);
    return call.promise;
  };
}

function makeReply(call, status, body, mode) {
  let jsonResult;
  if (mode === 'reject') jsonResult = () => Promise.reject(new SyntaxError('bad json'));
  else if (mode === 'deferred') {
    call.jsonDeferred = {};
    const promise = new Promise((resolve) => { call.jsonDeferred.resolve = () => resolve(body); });
    jsonResult = () => promise;
  } else jsonResult = () => Promise.resolve(body);
  const json = () => {
    call.jsonCalls += 1;
    return jsonResult();
  };
  return guard({ status, json }, new Set(['status', 'json']), 'reply');
}

export async function flush() {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

export function boot() {
  const els = {};
  for (const [id, tag] of ELEMENT_SPECS) els[id] = makeElement(tag, id);
  const calls = [];
  const document = guard({
    getElementById: (id) => els[id] ?? null,
    createElement: (tag) => makeElement(String(tag).toLowerCase()),
  }, new Set(['getElementById', 'createElement']), 'document');
  const fetch = makeFetch(calls, els.book);
  const page = { els, calls, flush };
  page.respond = (call, status, body) => call.resolve(makeReply(call, status, body, 'value'));
  page.respondJsonFails = (call, status) => call.resolve(makeReply(call, status, null, 'reject'));
  page.respondDeferredJson = (call, status, body) => {
    call.resolve(makeReply(call, status, body, 'deferred'));
    return { resolveJson: () => call.jsonDeferred.resolve() };
  };
  page.fail = (call) => call.reject(new TypeError('fetch failed'));
  const source = fs.readFileSync(APP_PATH, 'utf8');
  const context = vm.createContext({ document, fetch });
  vm.runInContext(source, context);
  page.callsAtLoad = calls.length;
  return page;
}

// Plain-data view of a node: text node or element.
function describe(node) {
  const raw = node._raw ?? node;
  if (raw instanceof FakeText) return { kind: 'text', text: raw.textContent };
  return { kind: 'el', tag: raw.tagName, type: raw.type, text: raw.textContent };
}

export function readList(page) {
  return page.els['booking-list']._raw.children.map((li) => ({
    tag: li._raw.tagName,
    children: li._raw.children.map(describe),
  }));
}

export function cancelButtons(page) {
  return page.els['booking-list']._raw.children.map((li) => li._raw.children[1]);
}

export const text = (el) => el._raw.textContent;
export const childCount = (el) => el._raw.children.length;
export const optionsOf = (el) => el._raw.children.map((o) => ({
  tag: o._raw.tagName, value: o._raw.value, text: o._raw.textContent,
}));
export const plain = (x) => JSON.parse(JSON.stringify(x));
