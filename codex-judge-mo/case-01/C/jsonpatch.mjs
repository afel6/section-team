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
  enumerable: false,
  configurable: true,
});

const hasOwn = Object.hasOwn;
const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
const OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test'];

// Returns the decoded tokens, or null when the pointer is invalid.
function tryParse(pointer) {
  if (pointer === '') return [];
  if (pointer[0] !== '/') return null;
  const tokens = pointer.slice(1).split('/');
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (/~(?![01])/.test(t)) return null;
    tokens[i] = t.replace(/~1/g, '/').replace(/~0/g, '~');
  }
  return tokens;
}

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  const tokens = tryParse(pointer);
  if (tokens === null) throw new SyntaxError('invalid pointer');
  return tokens;
}

function isContainer(v) {
  return typeof v === 'object' && v !== null;
}

function setMember(obj, name, value) {
  // defineProperty keeps an existing member's place and treats names such as
  // __proto__ as ordinary own members.
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

// Iterative deep copy of a JSON value, keeping -0 and member order.
function clone(value) {
  if (!isContainer(value)) return value;
  const root = Array.isArray(value) ? [] : {};
  const stack = [[value, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop();
    if (Array.isArray(src)) {
      for (let i = 0; i < src.length; i++) {
        const v = src[i];
        if (isContainer(v)) {
          const c = Array.isArray(v) ? [] : {};
          dst.push(c);
          stack.push([v, c]);
        } else {
          dst.push(v);
        }
      }
    } else {
      for (const k of Object.keys(src)) {
        const v = src[k];
        if (isContainer(v)) {
          const c = Array.isArray(v) ? [] : {};
          setMember(dst, k, c);
          stack.push([v, c]);
        } else {
          setMember(dst, k, v);
        }
      }
    }
  }
  return root;
}

// Iterative JSON equality.
function equal(a, b) {
  const stack = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (!isContainer(x) || !isContainer(y)) {
      if (x !== y) return false;
      continue;
    }
    const xa = Array.isArray(x);
    if (xa !== Array.isArray(y)) return false;
    if (xa) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
    } else {
      const kx = Object.keys(x);
      if (kx.length !== Object.keys(y).length) return false;
      for (const k of kx) {
        if (!hasOwn(y, k)) return false;
        stack.push([x[k], y[k]]);
      }
    }
  }
  return true;
}

class Failure {
  constructor(reason) {
    this.reason = reason;
  }
}

// Follows one token; returns the value it names or throws a Failure.
function step(container, token, notFound) {
  if (Array.isArray(container)) {
    if (token === '-') throw new Failure(notFound);
    if (!INDEX_RE.test(token)) throw new Failure('bad index');
    const i = Number(token);
    if (i < container.length) return container[i];
    throw new Failure(notFound);
  }
  if (isContainer(container) && hasOwn(container, token)) return container[token];
  throw new Failure(notFound);
}

function follow(doc, tokens, count, notFound) {
  let cur = doc;
  for (let i = 0; i < count; i++) cur = step(cur, tokens[i], notFound);
  return cur;
}

function addAt(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = follow(doc, tokens, tokens.length - 1, 'path not found');
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else if (INDEX_RE.test(last)) {
      const i = Number(last);
      if (i > parent.length) throw new Failure('path not found');
      parent.splice(i, 0, value);
    } else {
      throw new Failure('bad index');
    }
  } else if (isContainer(parent)) {
    setMember(parent, last, value);
  } else {
    throw new Failure('path not found');
  }
  return doc;
}

// The path must name a value (tokens non-empty).
function removeAt(doc, tokens, notFound) {
  const parent = follow(doc, tokens, tokens.length - 1, notFound);
  const last = tokens[tokens.length - 1];
  const value = step(parent, last, notFound);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
  return value;
}

function isProperPrefix(a, b) {
  if (a.length >= b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameTokens(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function checkOp(op) {
  if (typeof op !== 'object' || op === null || Array.isArray(op)) return 'not an object';
  const name = hasOwn(op, 'op') ? op.op : undefined;
  if (typeof name !== 'string' || !OPS.includes(name)) return 'bad op';
  const path = hasOwn(op, 'path') ? op.path : undefined;
  const pathTokens = typeof path === 'string' ? tryParse(path) : null;
  if (pathTokens === null) return 'bad path';
  const checked = { op: name, path: pathTokens };
  if (name === 'move' || name === 'copy') {
    const from = hasOwn(op, 'from') ? op.from : undefined;
    const fromTokens = typeof from === 'string' ? tryParse(from) : null;
    if (fromTokens === null) return 'bad from';
    checked.from = fromTokens;
  }
  if (name === 'add' || name === 'replace' || name === 'test') {
    if (!hasOwn(op, 'value')) return 'missing value';
    checked.value = op.value;
  }
  if (name === 'remove' && pathTokens.length === 0) return 'cannot remove root';
  if (name === 'move' && isProperPrefix(checked.from, pathTokens)) return 'cannot move into own child';
  return checked;
}

function applyOne(doc, op) {
  switch (op.op) {
    case 'add':
      return addAt(doc, op.path, clone(op.value));
    case 'remove':
      removeAt(doc, op.path, 'path not found');
      return doc;
    case 'replace': {
      if (op.path.length === 0) return clone(op.value);
      const parent = follow(doc, op.path, op.path.length - 1, 'path not found');
      const last = op.path[op.path.length - 1];
      step(parent, last, 'path not found');
      if (Array.isArray(parent)) parent[Number(last)] = clone(op.value);
      else setMember(parent, last, clone(op.value));
      return doc;
    }
    case 'move': {
      follow(doc, op.from, op.from.length, 'from not found');
      if (sameTokens(op.from, op.path)) return doc;
      const value = removeAt(doc, op.from, 'from not found');
      return addAt(doc, op.path, value);
    }
    case 'copy': {
      const value = clone(follow(doc, op.from, op.from.length, 'from not found'));
      return addAt(doc, op.path, value);
    }
    case 'test': {
      const actual = follow(doc, op.path, op.path.length, 'path not found');
      if (!equal(actual, op.value)) throw new Failure('test failed');
      return doc;
    }
  }
  throw new Error('unreachable');
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  const n = patch.length;
  for (let i = 0; i < n; i++) {
    const checked = checkOp(patch[i]);
    if (typeof checked === 'string') throw new PatchError(`operation ${i}: ${checked}`, i);
    ops.push(checked);
  }
  let result = clone(doc);
  for (let i = 0; i < ops.length; i++) {
    try {
      result = applyOne(result, ops[i]);
    } catch (e) {
      if (e instanceof Failure) throw new PatchError(`operation ${i}: ${e.reason}`, i);
      throw e;
    }
  }
  return result;
}
