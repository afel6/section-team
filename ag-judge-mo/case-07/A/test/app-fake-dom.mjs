// Fake DOM + fetch for running public/app.js in node:vm. The app only sees
// Proxies that throw on any member outside the allowed list.
import vm from 'node:vm';

const IDS = ['booking-form', 'room', 'title', 'date', 'start', 'end', 'book',
  'filter-date', 'show-all', 'booking-list', 'error'];
const EL_GET = ['textContent', 'value', 'type', 'disabled', 'append',
  'replaceChildren', 'addEventListener'];
const EL_SET = ['textContent', 'value', 'type', 'disabled'];

function forbid(prop) {
  return new Error('forbidden: ' + String(prop));
}

function allowOnly(target, getters, setters, label) {
  return new Proxy(target, {
    get(t, prop) {
      // Promise resolution probes `then`; a real object simply lacks it.
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      if (!getters.includes(prop)) throw forbid(label + '.' + prop);
      return t[prop];
    },
    set(t, prop, value) {
      if (!setters.includes(prop)) throw forbid(label + '.' + prop);
      t[prop] = value;
      return true;
    },
  });
}

export function textOf(node) {
  return node.isText ? node.text : node.children.map(textOf).join('');
}

function makeInternal(tag, id = '') {
  return { tag, id, children: [], listeners: {}, value: '', type: '', disabled: false };
}

function toNode(arg, internals) {
  if (typeof arg === 'string') return { isText: true, text: arg };
  const node = internals.get(arg);
  if (!node) throw new Error('unknown node passed to append');
  return node;
}

function wrapElement(internal, internals) {
  const api = {
    append: (...args) => { internal.children.push(...args.map((a) => toNode(a, internals))); },
    replaceChildren: (...args) => { internal.children = args.map((a) => toNode(a, internals)); },
    addEventListener: (type, fn) => { (internal.listeners[type] ??= []).push(fn); },
    get value() { return internal.value; },
    set value(v) { internal.value = v; },
    get type() { return internal.type; },
    set type(v) { internal.type = v; },
    get disabled() { return internal.disabled; },
    set disabled(v) { internal.disabled = v; },
    get textContent() { return textOf(internal); },
    set textContent(v) {
      internal.children = v === '' ? [] : [{ isText: true, text: String(v) }];
    },
  };
  const proxy = allowOnly(api, EL_GET, EL_SET, 'element');
  internals.set(proxy, internal);
  return proxy;
}

function makeDocument(els, proxies, internals) {
  const api = {
    getElementById: (id) => proxies[id] ?? null,
    createElement: (tag) => wrapElement(makeInternal(tag), internals),
  };
  return allowOnly(api, ['getElementById', 'createElement'], [], 'document');
}

function makeResponse(status, body, opts, tracker) {
  const api = {
    status,
    json() {
      tracker.jsonCalled = true;
      if (opts.badJson) return Promise.reject(new SyntaxError('bad json'));
      const value = structuredClone(body);
      return opts.gate ? opts.gate.then(() => value) : Promise.resolve(value);
    },
  };
  return allowOnly(api, ['status', 'json'], [], 'response');
}

export function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function createPage(appSource) {
  const els = {};
  const proxies = {};
  const internals = new WeakMap();
  for (const id of IDS) {
    els[id] = makeInternal(id === 'booking-list' ? 'ul' : id, id);
    proxies[id] = wrapElement(els[id], internals);
  }
  const calls = [];
  const fetch = (url, options) => {
    const d = deferred();
    calls.push({ url, options, d, jsonCalled: false });
    return d.promise;
  };
  const document = makeDocument(els, proxies, internals);
  const ctx = vm.createContext({ document, fetch });
  const page = { els, calls, ctx, internals };
  page.run = () => vm.runInContext(appSource, ctx);
  return page;
}

export function respond(call, status, body, opts = {}) {
  call.d.resolve(makeResponse(status, body, opts, call));
}

export function respondBadJson(call, status) {
  respond(call, status, null, { badJson: true });
}

export function fail(call) {
  call.d.reject(new TypeError('fetch failed'));
}

export async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) await new Promise((r) => setImmediate(r));
}

export function dispatch(el, type) {
  const record = { prevented: false };
  const event = allowOnly({ preventDefault: () => { record.prevented = true; } },
    ['preventDefault'], [], 'event');
  for (const fn of el.listeners[type] ?? []) fn(event);
  return record;
}
