// Minimal fake DOM + controllable fake fetch for running public/app.js in node:vm.
// Only the members the spec allows the script to use exist; others are absent (calling one throws a TypeError).
import vm from 'node:vm';
import fs from 'node:fs';

const APP_PATH = new URL('../public/app.js', import.meta.url);

export class FakeText {
  constructor(data) {
    this.nodeType = 3;
    this.data = data;
  }
}

function toNodes(items) {
  return items.map((item) => (typeof item === 'string' ? new FakeText(item) : item));
}

function textOf(node) {
  return node.nodeType === 3 ? node.data : node.childNodes.map(textOf).join('');
}

export class FakeElement {
  #value = undefined;

  constructor(tag, props = {}) {
    this.tagName = tag.toUpperCase();
    this.id = props.id ?? '';
    this.childNodes = [];
    this.listeners = new Map();
    this.type = props.type ?? '';
    this.disabled = false;
  }

  get value() {
    if (this.#value !== undefined) return this.#value;
    if (this.tagName === 'SELECT') {
      const first = this.childNodes[0];
      return first ? first.value : '';
    }
    return '';
  }

  set value(v) {
    this.#value = String(v);
  }

  get textContent() {
    return this.childNodes.map(textOf).join('');
  }

  set textContent(text) {
    const s = String(text);
    this.childNodes = s === '' ? [] : [new FakeText(s)];
  }

  append(...items) {
    this.childNodes = [...this.childNodes, ...toNodes(items)];
  }

  replaceChildren(...items) {
    this.childNodes = toNodes(items);
  }

  addEventListener(type, fn) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  // Test-only: fire an event and return it.
  dispatch(type) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const fn of this.listeners.get(type) ?? []) fn(event);
    return event;
  }
}

function makeFetch(calls, elements) {
  return function fetch(url, options) {
    return new Promise((resolve, reject) => {
      calls.push({
        url,
        options,
        bookDisabledAtCall: elements.book.disabled,
        respond(status, body) {
          const hasBody = status !== 204;
          resolve({
            status,
            json() {
              if (!hasBody) return Promise.reject(new SyntaxError('no body'));
              if (typeof body === 'string') {
                try { return Promise.resolve(JSON.parse(body)); } catch (e) { return Promise.reject(e); }
              }
              return Promise.resolve(JSON.parse(JSON.stringify(body)));
            },
          });
        },
        fail() { reject(new TypeError('fetch failed')); },
      });
    });
  };
}

function makeElements() {
  return {
    form: new FakeElement('form', { id: 'booking-form' }),
    room: new FakeElement('select', { id: 'room' }),
    title: new FakeElement('input', { id: 'title', type: 'text' }),
    date: new FakeElement('input', { id: 'date', type: 'date' }),
    start: new FakeElement('input', { id: 'start', type: 'time' }),
    end: new FakeElement('input', { id: 'end', type: 'time' }),
    book: new FakeElement('button', { id: 'book', type: 'submit' }),
    filter: new FakeElement('input', { id: 'filter-date', type: 'date' }),
    showAll: new FakeElement('button', { id: 'show-all', type: 'button' }),
    list: new FakeElement('ul', { id: 'booking-list' }),
    error: new FakeElement('p', { id: 'error' }),
  };
}

const tick = () => new Promise((r) => setImmediate(r));

export async function flush() {
  for (let i = 0; i < 6; i += 1) await tick();
}

// Runs the app. Returns { ...elements, fetchCalls, flush, listTexts }.
export function loadApp() {
  const elements = makeElements();
  const byId = new Map(Object.values(elements).map((el) => [el.id, el]));
  const fetchCalls = [];
  const document = {
    getElementById: (id) => byId.get(id) ?? null,
    createElement: (tag) => new FakeElement(tag),
  };
  const ctx = vm.createContext({ document, fetch: makeFetch(fetchCalls, elements) });
  new vm.Script(fs.readFileSync(APP_PATH, 'utf8'), { filename: 'app.js' }).runInContext(ctx);
  const listTexts = () => elements.list.childNodes.map((li) => {
    const [first, second] = li.childNodes;
    return [li.childNodes.length, first?.nodeType, first?.data,
      second?.tagName, second?.type, second?.textContent];
  });
  return { ...elements, fetchCalls, flush, listTexts };
}

// Convert a cross-realm value into a host-realm plain value for deepStrictEqual.
export const plain = (value) => JSON.parse(JSON.stringify(value));

export const booking = (id, over = {}) => ({
  id, room: 'Aurora', title: 'T', date: '2026-11-03', start: '09:00', end: '10:00', ...over,
});

// Load the app, answer the rooms and list fetches, and settle.
export async function loadReady(bookings = [], rooms = ['Aurora', 'Borealis', 'Cosmos']) {
  const app = loadApp();
  app.fetchCalls[0].respond(200, { rooms });
  app.fetchCalls[1].respond(200, { bookings });
  await app.flush();
  return app;
}
