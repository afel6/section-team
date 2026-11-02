// near-miss: copy shares the source reference
// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902).

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.index = index;
  }
}
Object.defineProperty(PatchError.prototype, 'name', {
  value: 'PatchError',
  writable: true,
  configurable: true,
});

const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (pointer === '') return [];
  if (pointer[0] !== '/' || /~(?![01])/.test(pointer)) throw new SyntaxError('invalid pointer');
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~([01])/g, (_, c) => (c === '0' ? '~' : '/')));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Defines an own data member without triggering setters such as __proto__.
function setMember(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const copy = {};
    for (const name of Object.keys(value)) setMember(copy, name, clone(value[name]));
    return copy;
  }
  return value;
}

function equal(a, b) {
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => equal(item, b[i]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const names = Object.keys(a);
    return (
      names.length === Object.keys(b).length &&
      names.every((name) => Object.hasOwn(b, name) && equal(a[name], b[name]))
    );
  }
  return a === b;
}

function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((token, i) => token === tokens[i]);
}

// Returns the reason the operation breaks the form rules, or null.
function formError(op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return 'not an object';
  if (!Object.hasOwn(op, 'op') || !OPS.has(op.op)) return 'bad op';
  const path = pointerTokens(op, 'path');
  if (!path) return 'bad path';
  let from = null;
  if (op.op === 'move' || op.op === 'copy') {
    from = pointerTokens(op, 'from');
    if (!from) return 'bad from';
  }
  if ((op.op === 'add' || op.op === 'replace' || op.op === 'test') && !Object.hasOwn(op, 'value')) {
    return 'missing value';
  }
  if (op.op === 'remove' && path.length === 0) return 'cannot remove root';
  if (op.op === 'move' && isProperPrefix(from, path)) return 'cannot move into own child';
  return null;
}

function pointerTokens(op, member) {
  if (!Object.hasOwn(op, member) || typeof op[member] !== 'string') return null;
  try {
    return parsePointer(op[member]);
  } catch {
    return null;
  }
}

class OpFailure extends Error {}

// Returns the value the token names in container, or throws OpFailure.
function child(container, token, notFound) {
  if (Array.isArray(container)) {
    if (token === '-') throw new OpFailure(notFound);
    if (!INDEX_RE.test(token)) throw new OpFailure('bad index');
    if (Number(token) >= container.length) throw new OpFailure(notFound);
    return container[Number(token)];
  }
  if (isObject(container) && Object.hasOwn(container, token)) return container[token];
  throw new OpFailure(notFound);
}

function follow(doc, tokens, notFound) {
  let value = doc;
  for (const token of tokens) value = child(value, token, notFound);
  return value;
}

class Document {
  constructor(root) {
    this.root = root;
  }

  get(tokens, notFound) {
    return follow(this.root, tokens, notFound);
  }

  add(tokens, value) {
    if (tokens.length === 0) {
      this.root = value;
      return;
    }
    const parent = follow(this.root, tokens.slice(0, -1), 'path not found');
    const last = tokens[tokens.length - 1];
    if (Array.isArray(parent)) {
      if (last === '-') {
        parent.push(value);
        return;
      }
      if (!INDEX_RE.test(last)) throw new OpFailure('bad index');
      const index = Number(last);
      if (index > parent.length) throw new OpFailure('path not found');
      parent.splice(index, 0, value);
    } else if (isObject(parent)) {
      setMember(parent, last, value);
    } else {
      throw new OpFailure('path not found');
    }
  }

  // Removes and returns the value tokens name; tokens is never empty.
  remove(tokens, notFound) {
    const parent = follow(this.root, tokens.slice(0, -1), notFound);
    const last = tokens[tokens.length - 1];
    const value = child(parent, last, notFound);
    if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete parent[last];
    return value;
  }

  replace(tokens, value) {
    if (tokens.length === 0) {
      this.root = value;
      return;
    }
    const parent = follow(this.root, tokens.slice(0, -1), 'path not found');
    const last = tokens[tokens.length - 1];
    child(parent, last, 'path not found');
    setMember(parent, Array.isArray(parent) ? Number(last) : last, value);
  }
}

function applyOperation(doc, op) {
  const path = parsePointer(op.path);
  switch (op.op) {
    case 'add':
      doc.add(path, clone(op.value));
      break;
    case 'remove':
      doc.remove(path, 'path not found');
      break;
    case 'replace':
      doc.replace(path, clone(op.value));
      break;
    case 'move': {
      const from = parsePointer(op.from);
      // Pointer encoding is unique, so equal strings mean equal tokens.
      if (op.from === op.path) {
        doc.get(from, 'from not found');
        break;
      }
      doc.add(path, doc.remove(from, 'from not found'));
      break;
    }
    case 'copy':
      doc.add(path, doc.get(parsePointer(op.from), 'from not found'));
      break;
    case 'test':
      if (!equal(doc.get(path, 'path not found'), op.value)) throw new OpFailure('test failed');
      break;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const op = Object.hasOwn(patch, i) ? patch[i] : undefined;
    const reason = formError(op);
    if (reason) throw new PatchError(`operation ${i}: ${reason}`, i);
    ops.push(op);
  }
  const working = new Document(clone(doc));
  ops.forEach((op, i) => {
    try {
      applyOperation(working, op);
    } catch (err) {
      if (err instanceof OpFailure) throw new PatchError(`operation ${i}: ${err.message}`, i);
      throw err;
    }
  });
  return working.root;
}
