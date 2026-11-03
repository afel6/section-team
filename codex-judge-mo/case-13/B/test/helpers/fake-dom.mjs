// Fake DOM + controllable fetch for running public/app.js in node:vm.
// Every object handed to the script is a Proxy that records any member outside the
// spec's allowed list in `page.forbidden`, so tests can assert only allowed APIs were used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const APP_PATH = new URL('../../public/app.js', import.meta.url);
const ELEMENT_MEMBERS = new Set(['textContent', 'value', 'type', 'disabled', 'append', 'replaceChildren', 'addEventListener']);
const DOCUMENT_MEMBERS = new Set(['getElementById', 'createElement']);
const REPLY_MEMBERS = new Set(['status', 'json']);
const EVENT_MEMBERS = new Set(['preventDefault']);
const BROWSER_GLOBALS = ['window', 'self', 'console', 'setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame',
  'XMLHttpRequest', 'location', 'navigator', 'alert', 'localStorage', 'sessionStorage', 'Headers', 'Request', 'Response',
  'URL', 'URLSearchParams', 'Event', 'CustomEvent', 'structuredClone', 'addEventListener'];
// The page's elements: id -> [tag, type].
const PAGE_ELEMENTS = {
  'booking-form': ['form'], room: ['select'], title: ['input', 'text'], date: ['input', 'date'],
  start: ['input', 'time'], end: ['input', 'time'], book: ['button', 'submit'], 'filter-date': ['input', 'date'],
  'show-all': ['button', 'button'], 'booking-list': ['ul'], error: ['p'],
};

/** A text node made by `append(string)`. */
export class TextNode {
  constructor(data) { this.data = String(data); }
}

/** Minimal element: children, textContent, value, type, disabled, listeners. */
export class FakeElement {
  constructor(page, tag, id) {
    this.page = page;
    this.tagName = tag;
    this.id = id;
    this.childNodes = [];
    this.listeners = {};
    this.attrs = { value: '', type: undefined, disabled: false };
  }
  get textContent() {
    return this.childNodes.map((n) => (n instanceof TextNode ? n.data : n.textContent)).join('');
  }
  set textContent(text) {
    this.page.log.push({ id: this.id, prop: 'textContent', value: String(text), bookDisabled: this.page.bookDisabled() });
    this.childNodes = String(text) === '' ? [] : [new TextNode(text)];
  }
  get value() { return this.tagName === 'select' ? this.selectValue() : this.attrs.value; }
  set value(v) {
    this.page.log.push({ id: this.id, prop: 'value', value: String(v), bookDisabled: this.page.bookDisabled() });
    if (this.tagName === 'select') this.selectedValue = String(v);
    else this.attrs = { ...this.attrs, value: String(v) };
  }
  get type() { return this.attrs.type; }
  set type(v) { this.attrs = { ...this.attrs, type: String(v) }; }
  get disabled() { return this.attrs.disabled; }
  set disabled(v) { this.attrs = { ...this.attrs, disabled: Boolean(v) }; }
  selectValue() {
    if (this.selectedValue !== undefined) return this.selectedValue;
    const first = this.childNodes.find((n) => n instanceof FakeElement && n.tagName === 'option');
    return first ? first.value : '';
  }
  append(...nodes) {
    this.childNodes = [...this.childNodes, ...nodes.map((n) => (typeof n === 'string' ? new TextNode(n) : unwrap(n)))];
  }
  replaceChildren(...nodes) {
    this.page.log.push({ id: this.id, prop: 'replaceChildren', value: nodes.length, bookDisabled: this.page.bookDisabled() });
    this.childNodes = nodes.map((n) => (typeof n === 'string' ? new TextNode(n) : unwrap(n)));
  }
  addEventListener(type, handler) {
    this.listeners = { ...this.listeners, [type]: [...(this.listeners[type] ?? []), handler] };
  }
  /** Test side: fires an event; returns { defaultPrevented }. */
  dispatch(type) {
    const state = { defaultPrevented: false };
    const event = guard(this.page, 'event', { preventDefault() { state.defaultPrevented = true; } }, EVENT_MEMBERS);
    (this.listeners[type] ?? []).forEach((handler) => handler.call(this.proxy, event));
    return state;
  }
}

const RAW = Symbol('raw');
function unwrap(node) { return node?.[RAW] ?? node; }

function guard(page, kind, target, allowed) {
  return new Proxy(target, {
    get(obj, key) {
      if (key === RAW) return obj;
      // `then` is probed by the engine when a reply resolves a promise; not a script access.
      const engineProbe = kind === 'reply' && key === 'then';
      if (typeof key === 'string' && !allowed.has(key) && !engineProbe) page.forbidden.push(`${kind}.${key}`);
      const value = Reflect.get(obj, key, obj);
      return typeof value === 'function' ? value.bind(obj) : value;
    },
    set(obj, key, value) {
      if (typeof key === 'string' && !allowed.has(key)) page.forbidden.push(`${kind}.${key}=`);
      return Reflect.set(obj, key, value, obj);
    },
  });
}

function makeElement(page, tag, id) {
  const element = new FakeElement(page, tag, id);
  element.proxy = guard(page, `<${tag}>`, element, ELEMENT_MEMBERS);
  return element;
}

/** One fetch call the test can settle: respond(), respondSlowJson(), respondUnparseable(), fail(). */
class FetchCall {
  constructor(page, url, options) {
    this.page = page;
    this.url = url;
    this.options = options;
    this.jsonCalls = 0;
    this.bookDisabledAtCall = page.bookDisabled();
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }
  reply(status, json) {
    const call = this;
    const target = { status, json() { call.jsonCalls += 1; return json(); } };
    this.resolve(guard(this.page, 'reply', target, REPLY_MEMBERS));
  }
  /** Settles with `status` and a body that json() parses (a fresh copy each time). */
  respond(status, body) {
    const text = JSON.stringify(body);
    this.reply(status, () => Promise.resolve(JSON.parse(text)));
  }
  /** Settles the status now; json() stays pending until the returned resolveJson(body) is called. */
  respondSlowJson(status) {
    let resolveJson;
    const pending = new Promise((resolve) => { resolveJson = resolve; });
    this.reply(status, () => pending);
    return (body) => resolveJson(JSON.parse(JSON.stringify(body)));
  }
  /** Settles with `status` and a body whose json() rejects (unparseable). */
  respondUnparseable(status) {
    this.reply(status, () => Promise.reject(new SyntaxError('Unexpected token')));
  }
  /** No reply at all: fetch rejects. */
  fail() { this.reject(new TypeError('Failed to fetch')); }
}

/** Runs app.js against a fresh fake page. Returns the page handle used by tests. */
export function loadApp({ source = readFileSync(APP_PATH, 'utf8') } = {}) {
  const page = { forbidden: [], log: [], calls: [], elements: {} };
  page.bookDisabled = () => page.elements.book?.attrs.disabled ?? false;
  Object.entries(PAGE_ELEMENTS).forEach(([id, [tag, type]]) => {
    const element = makeElement(page, tag, id);
    element.attrs = { ...element.attrs, type };
    page.elements[id] = element;
  });
  page.created = [];
  const document = guard(page, 'document', {
    getElementById: (id) => page.elements[id]?.proxy ?? null,
    createElement: (tag) => {
      const element = makeElement(page, String(tag).toLowerCase(), undefined);
      page.created.push(element);
      return element.proxy;
    },
  }, DOCUMENT_MEMBERS);
  const fetch = (url, options) => {
    const call = new FetchCall(page, url, options);
    page.calls.push(call);
    return call.promise;
  };
  const sandbox = { document, fetch };
  BROWSER_GLOBALS.forEach((name) => {
    Object.defineProperty(sandbox, name, { get() { page.forbidden.push(`global.${name}`); return undefined; } });
  });
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app.js' });
  return page;
}

/** Lets pending promise chains in the script run to completion. */
export async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Describes an element's children for exact assertions: strings for text nodes, elements as-is. */
export function childSummary(element) {
  return element.childNodes.map((n) => (n instanceof TextNode ? { text: n.data } : { tag: n.tagName, type: n.type, text: n.textContent }));
}

/** Booking fixture. */
export function booking(overrides = {}) {
  return { id: 1, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides };
}

/**
 * Loads the app and settles the two startup fetches: rooms with the three rooms,
 * the list with `bookings`. Returns the page with no pending calls.
 */
export async function loadReadyApp(bookings = []) {
  const page = loadApp();
  await flush();
  page.calls.find((c) => c.url === '/api/rooms').respond(200, { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  page.calls.find((c) => c.url === '/api/bookings').respond(200, { bookings });
  await flush();
  return page;
}

/** Asserts the script touched no browser API outside the spec's allowed list. */
export function assertOnlyAllowedApis(page) {
  assert.deepEqual(page.forbidden, []);
}

/** The Cancel button elements currently in the list, in order. */
export function cancelButtons(page) {
  return page.elements['booking-list'].childNodes.flatMap((li) => li.childNodes.filter((n) => n instanceof FakeElement && n.tagName === 'button'));
}
