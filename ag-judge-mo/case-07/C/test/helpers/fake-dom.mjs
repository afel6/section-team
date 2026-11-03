import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const APP_URL = new URL('../../public/app.js', import.meta.url);

function textNode(data) {
  return { nodeType: 3, data: String(data) };
}

function toNodes(items) {
  return items.map((item) => (typeof item === 'string' ? textNode(item) : item));
}

function nodeText(node) {
  return node.nodeType === 3 ? node.data : node.textContent;
}

export class FakeElement {
  constructor(tagName, id = '') {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.type = '';
    this.disabled = false;
    this.childNodes = [];
    this.listeners = {};
    this.rawValue = undefined;
  }

  get value() {
    if (this.rawValue !== undefined) return this.rawValue;
    if (this.tagName === 'SELECT') {
      const first = this.childNodes.find((n) => n.tagName === 'OPTION');
      return first ? first.value : '';
    }
    return '';
  }

  set value(v) {
    this.rawValue = String(v);
  }

  get textContent() {
    return this.childNodes.map(nodeText).join('');
  }

  set textContent(text) {
    const s = String(text);
    this.childNodes = s === '' ? [] : [textNode(s)];
  }

  append(...nodes) {
    this.childNodes = this.childNodes.concat(toNodes(nodes));
  }

  replaceChildren(...nodes) {
    this.childNodes = toNodes(nodes);
  }

  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }

  dispatch(type) {
    const event = {
      type,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const fn of this.listeners[type] || []) fn(event);
    return event;
  }
}

const SPECS = [
  ['booking-form', 'form'], ['room', 'select'], ['title', 'input', 'text'],
  ['date', 'input', 'date'], ['start', 'input', 'time'], ['end', 'input', 'time'],
  ['book', 'button', 'submit', 'Book'], ['filter-date', 'input', 'date'],
  ['show-all', 'button', 'button'], ['booking-list', 'ul'], ['error', 'p'],
];

function buildElements() {
  const byId = new Map();
  for (const [id, tag, type, text] of SPECS) {
    const e = new FakeElement(tag, id);
    if (type) e.type = type;
    if (text) e.textContent = text;
    byId.set(id, e);
  }
  return byId;
}

function buildDocument(byId) {
  const document = Object.create(null);
  document.getElementById = (id) => byId.get(id) ?? null;
  document.createElement = (tag) => new FakeElement(tag);
  return document;
}

function makeControlledFetch(calls) {
  return (url, options) => new Promise((resolve, reject) => {
    const call = {
      url, options, jsonCalls: 0,
      resolveWith: (response) => resolve(response),
      resolve(status, body) {
        resolve({ status, json: () => { call.jsonCalls += 1; return Promise.resolve(body); } });
      },
      resolveBadJson(status) {
        resolve({
          status,
          json: () => { call.jsonCalls += 1; return Promise.reject(new SyntaxError('bad json')); },
        });
      },
      reject() { reject(new TypeError('fetch failed')); },
    };
    calls.push(call);
  });
}

async function flush(turns = 5) {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
}

export function loadPage({ fetchImpl } = {}) {
  const calls = [];
  const byId = buildElements();
  const document = buildDocument(byId);
  const fetch = fetchImpl ?? makeControlledFetch(calls);
  const source = readFileSync(APP_URL, 'utf8');
  const context = vm.createContext({ document, fetch });
  vm.runInContext(source, context, { filename: 'app.js' });
  return { document, el: (id) => byId.get(id), calls, flush };
}

function summarizeNode(node) {
  if (node.nodeType === 3) return { text: node.data };
  return { tag: node.tagName, type: node.type, text: node.textContent, disabled: node.disabled };
}

export function listTexts(ul) {
  return ul.childNodes.map((li) => {
    const [first, second] = li.childNodes;
    return {
      text: first && first.nodeType === 3 ? first.data : undefined,
      button: second && second.tagName === 'BUTTON'
        ? { type: second.type, text: second.textContent, disabled: second.disabled }
        : undefined,
      childCount: li.childNodes.length,
      nodes: li.childNodes.map(summarizeNode),
    };
  });
}
