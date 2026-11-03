// A minimal fake browser for public/app.js: only the APIs the spec allows.
// Any other member the script touches is recorded in `page.violations` (and throws).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { ROOT } from './server.mjs';

export const APP_PATH = join(ROOT, 'public', 'app.js');

const ELEMENT_MEMBERS = new Set([
  'textContent', 'value', 'type', 'disabled', 'append', 'replaceChildren', 'addEventListener',
]);
const PAGE_ELEMENTS = [
  ['booking-form', 'form'], ['room', 'select'], ['title', 'input', 'text'], ['date', 'input', 'date'],
  ['start', 'input', 'time'], ['end', 'input', 'time'], ['book', 'button', 'submit'],
  ['filter-date', 'input', 'date'], ['show-all', 'button', 'button'], ['booking-list', 'ul'],
  ['error', 'p'],
];

export class TextNode {
  constructor(data) {
    this.nodeType = 3;
    this.data = String(data);
  }
}

/** Test-side element. The script only ever sees `el.proxy`. */
export class FakeElement {
  constructor(page, tag, { id = null, type = '' } = {}) {
    this.page = page;
    this.tag = tag;
    this.id = id;
    this.type = type;
    this.disabled = false;
    this.childNodes = [];
    this.listeners = {};
    this.storedValue = '';
    this.proxy = page.wrap(this, this.label(), ELEMENT_MEMBERS);
  }

  label() {
    return this.id ? `#${this.id}` : `<${this.tag}>`;
  }

  get value() {
    if (this.tag === 'select' && this.storedValue === '' && this.childNodes.length > 0) {
      return this.childNodes[0].value;
    }
    return this.storedValue;
  }

  set value(v) {
    this.storedValue = String(v);
  }

  get textContent() {
    return this.childNodes.map((n) => (n instanceof TextNode ? n.data : n.textContent)).join('');
  }

  set textContent(v) {
    const text = String(v);
    this.childNodes = text === '' ? [] : [new TextNode(text)];
  }

  get children() {
    return this.childNodes.filter((n) => n instanceof FakeElement);
  }

  toNodes(items) {
    return items.map((item) => {
      if (typeof item === 'string') return new TextNode(item);
      const el = this.page.unwrap(item);
      if (!el) throw new TypeError('append/replaceChildren got a non-node');
      return el;
    });
  }

  append(...items) {
    this.childNodes = [...this.childNodes, ...this.toNodes(items)];
  }

  replaceChildren(...items) {
    this.childNodes = this.toNodes(items);
  }

  addEventListener(type, fn) {
    this.listeners[type] = [...(this.listeners[type] ?? []), fn];
  }

  /** Test-side: fire an event; resolves to the event (see `defaultPrevented`). */
  dispatch(type) {
    const event = { type, defaultPrevented: false, preventDefaultCalls: 0 };
    const exposed = this.page.wrap(
      { preventDefault: () => { event.defaultPrevented = true; event.preventDefaultCalls += 1; } },
      `${type} event`, new Set(['preventDefault']),
    );
    for (const fn of this.listeners[type] ?? []) fn.call(this.proxy, exposed);
    return event;
  }

  /**
   * Test-side click. Unlike a browser it reaches the listeners even when the
   * button is disabled, so the script's own "disabled sends nothing" guard is tested.
   */
  click() {
    return this.dispatch('click');
  }
}

function makeResponse(page, status, json) {
  return page.wrap({ status, json }, 'response', new Set(['status', 'json']));
}

/** One recorded fetch call, settled by the test. */
class FetchCall {
  constructor(page, url, options) {
    this.page = page;
    this.url = url;
    this.options = options;
    this.method = options?.method ?? 'GET';
    this.promise = new Promise((resolve, reject) => {
      this.resolveFetch = resolve;
      this.rejectFetch = reject;
    });
  }

  /** Reply with a status and a JSON-able body (json() resolves to a copy). */
  reply(status, body) {
    const copy = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
    const json = () => (body === undefined
      ? Promise.reject(new SyntaxError('Unexpected end of JSON input'))
      : Promise.resolve(copy));
    this.resolveFetch(makeResponse(this.page, status, json));
  }

  /** Reply whose body is not JSON: json() rejects. */
  replyNotJson(status) {
    this.resolveFetch(makeResponse(this.page, status, () => Promise.reject(new SyntaxError('bad json'))));
  }

  /** Reply whose body arrives later: returns { send(body), fail() }. */
  replyLater(status) {
    let settle;
    const bodyPromise = new Promise((resolve, reject) => { settle = { resolve, reject }; });
    this.resolveFetch(makeResponse(this.page, status, () => bodyPromise));
    return {
      send: (body) => settle.resolve(JSON.parse(JSON.stringify(body))),
      fail: () => settle.reject(new TypeError('body stream failed')),
    };
  }

  /** No reply at all (network error). */
  fail() {
    this.rejectFetch(new TypeError('Failed to fetch'));
  }
}

class FakePage {
  constructor() {
    this.violations = [];
    this.log = [];
    this.fetches = [];
    this.proxies = new WeakMap();
    this.elements = new Map();
    for (const [id, tag, type] of PAGE_ELEMENTS) {
      this.elements.set(id, new FakeElement(this, tag, { id, type }));
    }
  }

  el(id) {
    return this.elements.get(id);
  }

  unwrap(proxy) {
    return this.proxies.get(proxy);
  }

  /** Wraps a target so the script may use only `allowed` members; logs sets and calls. */
  wrap(target, label, allowed) {
    const page = this;
    const proxy = new Proxy(target, {
      get(t, prop) {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        if (!allowed.has(prop)) return page.violate(`get ${label}.${prop}`);
        const value = t[prop];
        if (typeof value !== 'function') return value;
        return (...args) => {
          page.log.push(`${label}.${prop}()`);
          return value.apply(t, args);
        };
      },
      set(t, prop, value) {
        if (typeof prop === 'symbol' || !allowed.has(prop)) return page.violate(`set ${label}.${String(prop)}`);
        page.log.push(`${label}.${prop}=${JSON.stringify(value)}`);
        t[prop] = value;
        return true;
      },
      has: (t, prop) => allowed.has(prop),
      deleteProperty: (t, prop) => page.violate(`delete ${label}.${String(prop)}`),
      defineProperty: (t, prop) => page.violate(`define ${label}.${String(prop)}`),
    });
    this.proxies.set(proxy, target);
    return proxy;
  }

  violate(what) {
    this.violations.push(what);
    throw new Error(`app.js used a forbidden API: ${what}`);
  }

  makeDocument() {
    const doc = {
      getElementById: (id) => this.elements.get(id)?.proxy ?? null,
      createElement: (tag) => {
        const name = String(tag).toLowerCase();
        // As in a browser, a new <button> is type "submit" until set.
        return new FakeElement(this, name, { type: name === 'button' ? 'submit' : '' }).proxy;
      },
    };
    return this.wrap(doc, 'document', new Set(['getElementById', 'createElement']));
  }

  makeFetch() {
    return (url, options) => {
      const call = new FetchCall(this, url, options);
      this.log.push(`fetch ${call.method} ${url}`);
      this.fetches.push(call);
      return call.promise;
    };
  }

  /** Fetch calls whose URL is a bookings list request. */
  listFetches() {
    return this.fetches.filter((f) => f.method === 'GET' && /^\/api\/bookings(\?|$)/.test(f.url));
  }

  lastFetch() {
    return this.fetches[this.fetches.length - 1];
  }
}

/**
 * Loads public/app.js (or `source`) into a fresh fake page. The script's only
 * globals are `document` and `fetch` (plus the JS built-ins).
 */
export function loadApp({ source = readFileSync(APP_PATH, 'utf8'), setup } = {}) {
  const page = new FakePage();
  if (setup) setup(page);
  const context = vm.createContext({ document: page.makeDocument(), fetch: page.makeFetch() });
  new vm.Script(source, { filename: 'app.js' }).runInContext(context);
  return page;
}

/** Lets every pending promise chain run to the end. */
export async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Text of each child node of an element, as [kind, text] pairs. */
export const describeChildren = (el) =>
  el.childNodes.map((n) => (n instanceof TextNode ? ['text', n.data] : [n.tag, n.textContent]));
