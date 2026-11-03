// Tiny HTML parser for tests: tags, attributes and text only.
const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));
const RAW = new Set(['script', 'style', 'title', 'textarea']);
const ATTR_RE = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/y;

function parseAttrs(src) {
  const attrs = {};
  let pos = 0;
  while (pos < src.length) {
    if (/[\s\/]/.test(src[pos])) { pos++; continue; }
    ATTR_RE.lastIndex = pos;
    const m = ATTR_RE.exec(src);
    if (!m) { pos++; continue; }
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    pos = ATTR_RE.lastIndex;
  }
  return attrs;
}

function closeTag(text, i, root, cur) {
  const end = text.indexOf('>', i);
  const name = text.slice(i + 2, end < 0 ? text.length : end).trim().toLowerCase();
  let next = cur;
  for (let n = cur; n && n !== root; n = n.parent) {
    if (n.tag === name) { next = n.parent; break; }
  }
  return { cur: next, i: end < 0 ? text.length : end + 1 };
}

function openTag(text, i, cur) {
  const m = /^<([a-zA-Z][^\s\/>]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(text.slice(i));
  if (!m) return null;
  const tag = m[1].toLowerCase();
  const node = { tag, attrs: parseAttrs(m[2]), children: [], parent: cur };
  cur.children.push(node);
  i += m[0].length;
  if (VOID.has(tag)) return { cur, i };
  if (!RAW.has(tag)) return { cur: node, i };
  const close = new RegExp('</' + tag + '\\s*>', 'i').exec(text.slice(i));
  const stop = close ? i + close.index : text.length;
  if (stop > i) node.children.push({ text: text.slice(i, stop), parent: node });
  return { cur, i: close ? stop + close[0].length : text.length };
}

export function parseHtml(text) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  const addText = (t) => { if (t) cur.children.push({ text: t, parent: cur }); };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { addText(text.slice(i)); break; }
    addText(text.slice(i, lt));
    i = lt;
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      i = end < 0 ? text.length : end + 3;
    } else if (text.startsWith('<!', i) || text.startsWith('<?', i)) {
      const end = text.indexOf('>', i);
      i = end < 0 ? text.length : end + 1;
    } else if (text.startsWith('</', i)) {
      ({ cur, i } = closeTag(text, i, root, cur));
    } else {
      const r = openTag(text, i, cur);
      if (!r) { addText('<'); i++; } else { cur = r.cur; i = r.i; }
    }
  }
  return root;
}

export function findAll(root, predicate) {
  const out = [];
  const walk = (n) => {
    for (const c of n.children ?? []) {
      if (c.tag === undefined) continue;
      if (predicate(c)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

export const byId = (root, id) => findAll(root, (n) => n.attrs.id === id)[0] ?? null;

export function textOf(node) {
  if (node.text !== undefined) return node.text;
  return (node.children ?? []).map(textOf).join('');
}

export function isDescendant(node, ancestor) {
  for (let n = node.parent; n; n = n.parent) if (n === ancestor) return true;
  return false;
}

export const elementChildren = (node) => node.children.filter((c) => c.tag !== undefined);
