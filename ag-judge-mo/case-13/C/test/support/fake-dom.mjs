// Strict fake DOM + fake fetch for running public/app.js inside a node:vm context.
// Every object handed to the page script is a Proxy that records a violation when the
// script touches anything outside the API allow-list of the spec.
import vm from 'node:vm';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
export const APP_SRC = fs.readFileSync(PUBLIC_DIR + 'app.js', 'utf8');
export const HTML_SRC = fs.readFileSync(PUBLIC_DIR + 'index.html', 'utf8');

const TAGS = {
  'booking-form': 'form', room: 'select', title: 'input', date: 'input', start: 'input',
  end: 'input', book: 'button', 'filter-date': 'input', 'show-all': 'button',
  'booking-list': 'ul', error: 'p',
};
const ELEMENT_ALLOWED = new Set([
  'textContent', 'value', 'type', 'disabled', 'append', 'replaceChildren', 'addEventListener',
]);

export class FakeEl {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.listeners = {};
    this.watchers = [];
    this.type = '';
    this.disabled = false;
    this.rawValue = '';
    this.valueSet = false;
  }

  get value() {
    if (this.tagName === 'select' && !this.valueSet) {
      const first = this.children.find((c) => c.tagName === 'option');
      return first ? first.value : '';
    }
    return this.rawValue;
  }

  set value(v) {
    this.rawValue = String(v);
    this.valueSet = true;
    this.watchers.forEach((w) => w('value', this.rawValue));
  }

  get textContent() {
    return this.children.map((c) => (c.nodeType === 3 ? c.data : c.textContent)).join('');
  }

  set textContent(v) {
    const text = String(v);
    this.children = text === '' ? [] : [{ nodeType: 3, data: text }];
    this.watchers.forEach((w) => w('textContent', text));
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
}

function toNode(node, rawOf) {
  if (typeof node === 'string') return { nodeType: 3, data: node };
  if (node !== null && typeof node === 'object') return rawOf.get(node) ?? node;
  return { nodeType: 3, data: String(node) };
}

function guard(raw, allowed, label, violations, rawOf, ignore = new Set()) {
  const proxy = new Proxy(raw, {
    get(target, prop) {
      if (typeof prop === 'symbol' || ignore.has(prop)) return undefined;
      if (!allowed.has(prop)) {
        violations.push(`${label}.${prop} (get)`);
        return undefined;
      }
      const member = Reflect.get(target, prop, target);
      return typeof member === 'function' ? member.bind(target) : member;
    },
    set(target, prop, value) {
      if (!allowed.has(prop)) violations.push(`${label}.${String(prop)} (set)`);
      return Reflect.set(target, prop, value, target);
    },
    has(target, prop) {
      violations.push(`${label}.${String(prop)} (has)`);
      return Reflect.has(target, prop);
    },
  });
  rawOf.set(proxy, raw);
  return proxy;
}

function patchContainer(el, rawOf) {
  el.append = (...nodes) => { el.children.push(...nodes.map((n) => toNode(n, rawOf))); };
  el.replaceChildren = (...nodes) => { el.children = nodes.map((n) => toNode(n, rawOf)); };
}

function makeReply(spec, violations, rawOf) {
  const raw = {
    status: spec.status,
    json() {
      spec.jsonCalls = (spec.jsonCalls || 0) + 1;
      if (spec.jsonFn) return spec.jsonFn();
      return spec.badJson ? Promise.reject(new Error('bad json')) : Promise.resolve(spec.body);
    },
  };
  return guard(raw, new Set(['status', 'json']), 'reply', violations, rawOf, new Set(['then']));
}

export function reply(status, body, opts = {}) {
  return { status, body, jsonCalls: 0, ...opts };
}

export const flush = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

export function loadPage(script = () => undefined) {
  const violations = [];
  const rawOf = new WeakMap();
  const els = {};
  const proxies = {};
  for (const [id, tag] of Object.entries(TAGS)) {
    els[id] = new FakeEl(tag, id);
    patchContainer(els[id], rawOf);
    proxies[id] = guard(els[id], ELEMENT_ALLOWED, `#${id}`, violations, rawOf);
  }
  const calls = [];
  const create = (tag) => {
    const el = new FakeEl(tag);
    patchContainer(el, rawOf);
    return guard(el, ELEMENT_ALLOWED, `<${tag}>`, violations, rawOf);
  };
  const document = guard({
    getElementById: (id) => proxies[id] ?? null,
    createElement: create,
  }, new Set(['getElementById', 'createElement']), 'document', violations, rawOf);
  const fetch = (url, options) => {
    const call = { index: calls.length, url, options, bookDisabled: els.book.disabled };
    calls.push(call);
    return new Promise((resolve, reject) => {
      call.resolve = (spec) => resolve(makeReply(spec, violations, rawOf));
      call.reject = (err = new TypeError('network down')) => reject(err);
      const auto = script(call);
      if (auto === 'reject') call.reject();
      else if (auto) call.resolve(auto);
    });
  };
  const context = vm.createContext({ document, fetch });
  const page = { els, calls, violations, context, listeners: {} };
  page.run = () => vm.runInContext(APP_SRC, context, { filename: 'app.js' });
  page.dispatch = (el, type, extras = {}) => dispatch(el, type, extras, violations, rawOf);
  page.respond = (index, spec) => calls[index].resolve(spec);
  page.fail = (index) => calls[index].reject();
  page.urls = () => calls.map((call) => call.url);
  return page;
}

function dispatch(el, type, extras, violations, rawOf) {
  const rawEvent = { ...extras, prevented: false, preventDefault() { rawEvent.prevented = true; } };
  const ev = guard(rawEvent, new Set(['preventDefault']), 'event', violations, rawOf);
  const fns = el.listeners[type] || [];
  fns.forEach((fn) => fn(ev));
  return { prevented: rawEvent.prevented, listenerCount: fns.length };
}

// Default script: rooms and an empty list answer at once.
export const ROOMS = ['Aurora', 'Borealis', 'Cosmos'];
export function okScript(bookings = []) {
  return (call) => {
    if (call.url === '/api/rooms') return reply(200, { rooms: ROOMS });
    if (!call.options || call.options.method === 'GET') return reply(200, { bookings });
    return undefined;
  };
}

export function booking(id, over = {}) {
  return { id, room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...over };
}
