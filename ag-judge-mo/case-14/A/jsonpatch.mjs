// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902).

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.index = index;
  }
}
PatchError.prototype.name = 'PatchError';

const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const INDEX_RE = /^(0|[1-9][0-9]*)$/;
const BAD_ESCAPE_RE = /~(?![01])/;

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (pointer === '') return [];
  if (pointer[0] !== '/' || BAD_ESCAPE_RE.test(pointer)) throw new SyntaxError('invalid pointer');
  return pointer.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function tryParsePointer(pointer) {
  if (typeof pointer !== 'string') return null;
  try {
    return parsePointer(pointer);
  } catch {
    return null;
  }
}

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Sets an own data property; defineProperty keeps names such as `__proto__` ordinary.
function setMember(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

function clone(v) {
  if (Array.isArray(v)) return v.map(clone);
  if (isObject(v)) {
    const out = {};
    for (const k of Object.keys(v)) setMember(out, k, clone(v[k]));
    return out;
  }
  return v;
}

function kind(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function equal(a, b) {
  const t = kind(a);
  if (t !== kind(b)) return false;
  if (t === 'array') return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (t === 'object') {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
      && keys.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return a === b;
}

function fail(index, reason) {
  return new PatchError(`operation ${index}: ${reason}`, index);
}

// Returns the value `token` names in `container`, or throws the matching failure.
function step(container, token, notFound, index) {
  if (Array.isArray(container)) {
    if (INDEX_RE.test(token)) {
      if (Number(token) < container.length) return container[Number(token)];
      throw fail(index, notFound);
    }
    throw fail(index, token === '-' ? notFound : 'bad index');
  }
  if (isObject(container) && Object.hasOwn(container, token)) return container[token];
  throw fail(index, notFound);
}

function resolve(root, tokens, notFound, index) {
  let v = root;
  for (const token of tokens) v = step(v, token, notFound, index);
  return v;
}

function addAt(root, tokens, value, index) {
  if (tokens.length === 0) return value;
  const parent = resolve(root, tokens.slice(0, -1), 'path not found', index);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else if (INDEX_RE.test(last)) {
      if (Number(last) > parent.length) throw fail(index, 'path not found');
      parent.splice(Number(last), 0, value);
    } else {
      throw fail(index, 'bad index');
    }
  } else if (isObject(parent)) {
    setMember(parent, last, value);
  } else {
    throw fail(index, 'path not found');
  }
  return root;
}

// Follows `tokens` (at least one) and returns the parent and last token of the named value.
function locate(root, tokens, notFound, index) {
  const parent = resolve(root, tokens.slice(0, -1), notFound, index);
  const last = tokens[tokens.length - 1];
  step(parent, last, notFound, index);
  return { parent, last };
}

function removeAt(root, tokens, notFound, index) {
  const { parent, last } = locate(root, tokens, notFound, index);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
}

function sameTokens(a, b) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((t, i) => t === tokens[i]);
}

// Returns the form-rule reason the operation breaks, or a checked operation.
function checkForm(op) {
  if (typeof op !== 'object' || op === null || Array.isArray(op)) return { reason: 'not an object' };
  const name = Object.hasOwn(op, 'op') ? op.op : undefined;
  if (typeof name !== 'string' || !OPS.has(name)) return { reason: 'bad op' };
  const path = Object.hasOwn(op, 'path') ? tryParsePointer(op.path) : null;
  if (path === null) return { reason: 'bad path' };
  let from = null;
  if (name === 'move' || name === 'copy') {
    from = Object.hasOwn(op, 'from') ? tryParsePointer(op.from) : null;
    if (from === null) return { reason: 'bad from' };
  }
  const usesValue = name === 'add' || name === 'replace' || name === 'test';
  if (usesValue && !Object.hasOwn(op, 'value')) return { reason: 'missing value' };
  if (name === 'remove' && path.length === 0) return { reason: 'cannot remove root' };
  if (name === 'move' && isProperPrefix(from, path)) return { reason: 'cannot move into own child' };
  return { op: { name, path, from, value: usesValue ? op.value : undefined } };
}

function applyOperation(root, { name, path, from, value }, index) {
  switch (name) {
    case 'add':
      return addAt(root, path, clone(value), index);
    case 'remove':
      removeAt(root, path, 'path not found', index);
      return root;
    case 'replace': {
      if (path.length === 0) return clone(value);
      const { parent, last } = locate(root, path, 'path not found', index);
      if (Array.isArray(parent)) parent[Number(last)] = clone(value);
      else setMember(parent, last, clone(value));
      return root;
    }
    case 'move': {
      const moved = resolve(root, from, 'from not found', index);
      if (sameTokens(from, path)) return root;
      removeAt(root, from, 'from not found', index);
      return addAt(root, path, moved, index);
    }
    case 'copy':
      return addAt(root, path, clone(resolve(root, from, 'from not found', index)), index);
    case 'test':
      if (!equal(resolve(root, path, 'path not found', index), value)) throw fail(index, 'test failed');
      return root;
    default:
      throw new Error(`unreachable op ${name}`);
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const checked = checkForm(patch[i]);
    if (checked.reason) throw fail(i, checked.reason);
    ops.push(checked.op);
  }
  let root = clone(doc);
  ops.forEach((op, i) => {
    root = applyOperation(root, op, i);
  });
  return root;
}
