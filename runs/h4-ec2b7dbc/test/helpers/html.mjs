// Tiny HTML tokenizer for structural tests. Not a general-purpose parser.
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);
const RAW = new Set(['script', 'style']);
const ENTITIES = [['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&amp;', '&']];

function decode(text) {
  return ENTITIES.reduce((acc, [from, to]) => acc.split(from).join(to), text);
}

function toText(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '');
  return decode(stripped).trim();
}

function parseAttrs(source) {
  const attrs = new Map();
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const m of source.matchAll(re)) {
    attrs.set(m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return attrs;
}

// Index of the '>' ending a start tag that begins at `from`, honouring quotes.
function tagEnd(text, from) {
  let quote = '';
  for (let i = from; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i;
  }
  return text.length - 1;
}

function close(text, node, innerEnd, end) {
  node.innerHtml = text.slice(node.innerStart, innerEnd);
  node.innerText = toText(node.innerHtml);
  node.end = end;
}

function skipMarkup(text, i) {
  if (text.startsWith('<!--', i)) {
    const e = text.indexOf('-->', i + 4);
    return e < 0 ? text.length : e + 3;
  }
  return tagEnd(text, i) + 1;
}

export function parseHtml(text) {
  const nodes = [];
  const stack = [];
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!', lt)) { i = skipMarkup(text, lt); continue; }
    if (text[lt + 1] === '/') {
      const gt = text.indexOf('>', lt);
      const name = text.slice(lt + 2, gt < 0 ? text.length : gt).trim().toLowerCase();
      const at = stack.map((n) => n.tag).lastIndexOf(name);
      i = (gt < 0 ? text.length : gt) + 1;
      if (at < 0) continue;
      while (stack.length > at + 1) close(text, stack.pop(), lt, lt);
      close(text, stack.pop(), lt, i);
      continue;
    }
    const m = /^<([a-zA-Z][^\s/>]*)/.exec(text.slice(lt, lt + 64));
    if (!m) { i = lt + 1; continue; }
    const gt = tagEnd(text, lt);
    const tag = m[1].toLowerCase();
    const node = {
      tag, attrs: parseAttrs(text.slice(lt + m[0].length, gt)), start: lt, end: gt + 1,
      innerStart: gt + 1, innerText: '', innerHtml: '', children: [],
      parentTags: stack.map((n) => n.tag),
    };
    stack.at(-1)?.children.push(node);
    nodes.push(node);
    i = gt + 1;
    if (VOID.has(tag) || text[gt - 1] === '/') continue;
    if (RAW.has(tag)) {
      const e = text.toLowerCase().indexOf(`</${tag}`, i);
      const rawEnd = e < 0 ? text.length : e;
      i = e < 0 ? text.length : tagEnd(text, e) + 1;
      close(text, node, rawEnd, i);
      node.innerText = '';
    } else stack.push(node);
  }
  while (stack.length) close(text, stack.pop(), text.length, text.length);
  return nodes;
}

export const byId = (nodes, id) => nodes.filter((n) => n.attrs.get('id') === id);
export const byTag = (nodes, tag) => nodes.filter((n) => n.tag === tag);
export const within = (outer, inner) =>
  inner !== outer && inner.start >= outer.start && inner.end <= outer.end;
