import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const APP_PATH = fileURLToPath(new URL('../../public/app.js', import.meta.url));
const IDS = [
  'booking-form', 'room', 'title', 'date', 'start', 'end', 'book',
  'error', 'filter-date', 'show-all', 'booking-list'
];
// Members the page script may touch (plus test-only ones).
const ALLOWED = new Set([
  'textContent', 'value', 'type', 'disabled', 'append', 'replaceChildren',
  'addEventListener', 'children', 'tagName', 'dispatch', 'listeners', 'id'
]);

function textNode(text) {
  return { nodeType: 3, textContent: String(text) };
}

function toNodes(nodes) {
  return nodes.map((n) => (typeof n === 'string' ? textNode(n) : n));
}

class FakeElement {
  constructor(tag, id, log) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.type = '';
    this._text = '';
    this._value = '';
    this._disabled = false;
    this._listeners = new Map();
    this._log = log;
  }

  get label() {
    return this.id || this.tagName;
  }

  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }

  set textContent(text) {
    this.children = [];
    this._text = String(text);
    if (this.id === 'error') this._log.push(['textContent', this.id, this._text]);
  }

  get value() { return this._value; }

  set value(v) {
    this._value = v;
    this._log.push(['value', this.label, v]);
  }

  get disabled() { return this._disabled; }

  set disabled(v) {
    this._disabled = v;
    this._log.push(['disabled', this.label, v]);
  }

  append(...nodes) {
    this.children = [...this.children, ...toNodes(nodes)];
  }

  replaceChildren(...nodes) {
    this._log.push(['replaceChildren', this.label]);
    this.children = toNodes(nodes);
    this._text = '';
  }

  addEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    this._listeners.set(type, [...list, fn]);
  }

  listeners(type) {
    return [...(this._listeners.get(type) || [])];
  }

  listenerTypes() {
    return [...this._listeners.keys()].filter((t) => this._listeners.get(t).length > 0);
  }

  dispatch(type, event) {
    return this.listeners(type).map((fn) => fn(event));
  }
}

// Proxy enforcing the allow-list of members; symbols pass through.
function guard(el) {
  return new Proxy(el, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'listenerTypes') return target.listenerTypes.bind(target);
      if (!ALLOWED.has(prop)) throw new Error(`Disallowed element member read: ${prop}`);
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
    set(target, prop, value) {
      if (!ALLOWED.has(prop)) throw new Error(`Disallowed element member write: ${String(prop)}`);
      return Reflect.set(target, prop, value, target);
    }
  });
}

export function createFakeDom() {
  const log = [];
  const elements = {};
  for (const id of IDS) elements[id] = guard(new FakeElement('div', id, log));
  const document = {
    getElementById: (id) => (Object.hasOwn(elements, id) ? elements[id] : null),
    createElement: (tag) => guard(new FakeElement(tag, '', log))
  };
  return { document, elements, log };
}

export function createFakeFetch(log = []) {
  const calls = [];
  const fetch = (...args) => {
    const call = { url: args[0], options: args[1], argCount: args.length, jsonCalls: 0 };
    calls.push(call);
    log.push(['fetch', args[0]]);
    return new Promise((resolve, reject) => {
      call.resolve = resolve;
      call.reject = reject;
    });
  };
  return {
    fetch,
    calls,
    respond(call, status, body) {
      call.resolve({
        status,
        json: () => { call.jsonCalls += 1; return Promise.resolve(body); }
      });
    },
    respondRaw(call, status, jsonImpl) {
      call.resolve({
        status,
        json: () => { call.jsonCalls += 1; return jsonImpl(); }
      });
    },
    fail(call) {
      call.reject(new TypeError('fetch failed'));
    }
  };
}

export function loadApp({ document, fetch }) {
  const src = readFileSync(APP_PATH, 'utf8');
  vm.runInNewContext(src, { fetch, document });
}

export async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
}
