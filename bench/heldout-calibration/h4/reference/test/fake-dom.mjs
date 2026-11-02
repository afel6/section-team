// A minimal DOM and fetch, enough to run public/app.js in a vm context: only the APIs the page may use.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'

export const PUBLIC = join(import.meta.dirname, '..', 'public')
export const PAGE_HTML = readFileSync(join(PUBLIC, 'index.html'), 'utf8')
const SCRIPT = readFileSync(join(PUBLIC, 'app.js'), 'utf8')

class FakeText {
  constructor(data) {
    this.nodeType = 3
    this.data = data
  }
  get textContent() { return this.data }
}

export class FakeElement {
  constructor(tagName, { id = '', type = '' } = {}) {
    this.nodeType = 1
    this.tagName = tagName.toUpperCase()
    this.id = id
    this.type = type
    this.value = ''
    this.disabled = false
    this.childNodes = []
    this.listeners = {}
  }
  append(...nodes) {
    this.childNodes = [...this.childNodes, ...nodes.map(n => (typeof n === 'string' ? new FakeText(n) : n))]
  }
  replaceChildren(...nodes) {
    this.childNodes = []
    this.append(...nodes)
  }
  get textContent() { return this.childNodes.map(n => n.textContent).join('') }
  set textContent(text) { this.childNodes = text === '' ? [] : [new FakeText(String(text))] }
  addEventListener(type, listener) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener]
  }
  // Fires type at this element; returns whether preventDefault was called.
  dispatch(type) {
    let prevented = false
    const event = { type, preventDefault: () => { prevented = true } }
    for (const listener of this.listeners[type] ?? []) listener(event)
    return prevented
  }
}

const attr = (attrs, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1]

// One FakeElement per element of the page that has an id, with its tag and type.
function elementsById(html) {
  const elements = {}
  for (const [, tag, attrs] of html.matchAll(/<([a-z0-9]+)\s([^>]*)>/g)) {
    const id = attr(attrs, 'id')
    if (id !== undefined) elements[id] = new FakeElement(tag, { id, type: attr(attrs, 'type') ?? '' })
  }
  return elements
}

// A fetch whose replies the test controls: each call is kept with reply(status, body) and fail().
// A string body is the raw reply text (JSON.parse may fail on it); any other body is the parsed JSON.
function fakeFetch() {
  const calls = []
  const fetch = (url, init = {}) => new Promise((resolve, reject) => {
    const json = body => async () => (typeof body === 'string' ? JSON.parse(body) : structuredClone(body))
    calls.push({
      url, method: init.method ?? 'GET', headers: init.headers, body: init.body,
      reply: (status, body) => resolve({ status, json: json(body) }),
      fail: () => reject(new TypeError('Failed to fetch')),
    })
  })
  return { fetch, calls }
}

// Lets every pending promise callback run.
export const settle = () => new Promise(resolve => setImmediate(resolve))

// Loads the page: runs app.js at once, as the browser does. Returns the elements by id, the fetch calls and the document.
export function loadPage() {
  const elements = elementsById(PAGE_HTML)
  const document = {
    getElementById: id => elements[id] ?? null,
    createElement: tag => new FakeElement(tag),
  }
  const { fetch, calls } = fakeFetch()
  runInNewContext(SCRIPT, { document, fetch })
  return { el: elements, calls }
}

// The list as plain data: each <li> as an array of its child nodes ('text' or a button summary).
export function listItems(list) {
  return list.childNodes.map(li => li.childNodes.map(n => (n.nodeType === 3 ? n.data : `<${n.tagName} ${n.type}>${n.textContent}`)))
}
