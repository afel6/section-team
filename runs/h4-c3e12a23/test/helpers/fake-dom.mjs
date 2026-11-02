import vm from 'node:vm';
import fs from 'node:fs';

const IDS = ['booking-form', 'room', 'title', 'date', 'start', 'end', 'book',
  'filter-date', 'show-all', 'booking-list', 'error'];

function toNode(n) {
  return typeof n === 'string' ? { nodeType: 3, textContent: n } : n;
}

export class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.children = [];
    this.value = '';
    this.type = '';
    this.disabled = false;
    this.listeners = new Map();
  }

  get textContent() {
    return this.children.map((c) => c.textContent).join('');
  }

  set textContent(s) {
    if (this.onTextSet) this.onTextSet(s);
    this.children = s === '' ? [] : [toNode(String(s))];
  }

  append(...nodes) {
    this.children = [...this.children, ...nodes.map(toNode)];
  }

  replaceChildren(...nodes) {
    this.children = nodes.map(toNode);
  }

  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  dispatch(type) {
    const event = { preventDefault() { this.defaultPrevented = true; }, defaultPrevented: false };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export function makeReply(status, body, { badJson = false } = {}) {
  const reply = {
    status,
    jsonCalls: 0,
    json() {
      reply.jsonCalls += 1;
      return badJson ? Promise.reject(new SyntaxError('bad json')) : Promise.resolve(body);
    },
  };
  return reply;
}

export async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
}

export function loadPage(appPath) {
  const els = Object.fromEntries(IDS.map((id) => [id, new FakeElement('x', id)]));
  const calls = [];
  const document = {
    getElementById: (id) => els[id],
    createElement: (tag) => new FakeElement(tag),
  };
  const fetch = (url, options) => {
    const d = deferred();
    calls.push({ url, options, bookDisabled: els.book.disabled, reply: (r) => d.resolve(r), fail: (e) => d.reject(e ?? new TypeError('down')) });
    return d.promise;
  };
  const context = vm.createContext({ document, fetch });
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), context, { filename: 'app.js' });
  return { els, calls };
}
