// Tiny HTML parser for tests. Not a spec-complete parser.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
// Raw text (script, style) and escapable raw text (title, textarea) hold no markup.
const RAW = new Set(['script', 'style', 'title', 'textarea']);
const NO_REFERENCES = new Set(['script', 'style']);
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: String.fromCharCode(0xa0) };

/** Decodes the common named and all numeric character references. */
export function decodeReferences(text) {
  return text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z]+));/g, (whole, dec, hex, name) => {
    if (dec !== undefined) return String.fromCodePoint(Number(dec));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return Object.hasOwn(NAMED, name) ? NAMED[name] : whole;
  });
}

function makeNode(tag, parent, attrs = new Map()) {
  return { tag, attrs, children: [], parent, text: undefined };
}

function addText(parent, text) {
  if (text === '') return;
  const node = makeNode('#text', parent);
  node.text = NO_REFERENCES.has(parent.tag) ? text : decodeReferences(text);
  parent.children.push(node);
}

// Parses attributes from the inside of a start tag (after the tag name).
function parseAttrs(src) {
  const attrs = new Map();
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    if (attrs.has(name)) continue;
    attrs.set(name, decodeReferences(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

// Finds the end index of a start tag, honouring quoted values.
function findTagEnd(text, from) {
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return i;
    }
  }
  return text.length;
}

function closeTag(current, name) {
  for (let n = current; n && n.tag !== '#root'; n = n.parent) {
    if (n.tag === name) return n.parent;
  }
  return current;
}

function readRawText(text, pos, name, parent) {
  const lower = text.toLowerCase();
  const close = lower.indexOf('</' + name, pos);
  const end = close === -1 ? text.length : close;
  addText(parent, text.slice(pos, end));
  return end;
}

function openTag(text, pos, state) {
  const end = findTagEnd(text, pos);
  const inner = text.slice(pos + 1, end);
  const m = /^([A-Za-z][^\s\/>]*)([\s\S]*)$/.exec(inner);
  if (!m) {
    addText(state.current, text.slice(pos, end + 1));
    return end + 1;
  }
  const name = m[1].toLowerCase();
  const node = makeNode(name, state.current, parseAttrs(m[2]));
  state.current.children.push(node);
  let next = end + 1;
  // Browsers ignore a trailing "/" on non-void elements, so only void elements close at once.
  if (VOID.has(name)) return next;
  if (RAW.has(name)) return readRawText(text, next, name, node);
  state.current = node;
  return next;
}

function step(text, pos, state) {
  if (text.startsWith('<!--', pos)) {
    const end = text.indexOf('-->', pos + 4);
    return end === -1 ? text.length : end + 3;
  }
  if (text.startsWith('<!', pos) || text.startsWith('<?', pos)) {
    const end = text.indexOf('>', pos);
    return end === -1 ? text.length : end + 1;
  }
  if (text.startsWith('</', pos)) {
    const end = text.indexOf('>', pos);
    const name = text.slice(pos + 2, end === -1 ? text.length : end).trim().toLowerCase();
    state.current = closeTag(state.current, name);
    return end === -1 ? text.length : end + 1;
  }
  return openTag(text, pos, state);
}

export function parseHtml(text) {
  const root = makeNode('#root', null);
  const state = { current: root };
  let pos = 0;
  while (pos < text.length) {
    const lt = text.indexOf('<', pos);
    if (lt === -1) {
      addText(state.current, text.slice(pos));
      break;
    }
    addText(state.current, text.slice(pos, lt));
    const isMarkup = /^<(?:[A-Za-z!\/?])/.test(text.slice(lt, lt + 2));
    if (!isMarkup) {
      addText(state.current, '<');
      pos = lt + 1;
      continue;
    }
    pos = step(text, lt, state);
  }
  return root;
}

function isElement(node) {
  return !node.tag.startsWith('#');
}

export function elements(root) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children) {
      if (isElement(c)) {
        out.push(c);
        walk(c);
      }
    }
  };
  walk(root);
  return out;
}

export function byId(root, id) {
  return elements(root).find((e) => e.attrs.get('id') === id) ?? null;
}

export function textContent(node) {
  if (node.tag === '#text') return node.text;
  return node.children.map(textContent).join('');
}

export function isInside(node, ancestor) {
  for (let n = node.parent; n; n = n.parent) {
    if (n === ancestor) return true;
  }
  return false;
}

export function elementChildren(node) {
  return node.children.filter(isElement);
}
