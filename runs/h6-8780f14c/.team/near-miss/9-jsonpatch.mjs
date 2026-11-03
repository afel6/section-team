// near-miss: copy shares the source object
// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902).

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'PatchError';
    this.index = index;
  }
}

const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
const BAD_TILDE_RE = /~(?![01])/;

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (pointer === '') return [];
  if (pointer[0] !== '/' || BAD_TILDE_RE.test(pointer)) throw new SyntaxError('invalid pointer');
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~[01]/g, (m) => (m === '~0' ? '~' : '/')));
}

// Internal failure while applying one operation; turned into a PatchError by applyPatch.
class OpFailure {
  constructor(reason) {
    this.reason = reason;
  }
}

const isContainer = (v) => v !== null && typeof v === 'object';

// Creates or overwrites an own data member without triggering setters such as __proto__.
function setMember(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

function emptyLike(v) {
  return Array.isArray(v) ? [] : {};
}

// Deep copy of a JSON value; iterative so deep values cannot overflow the stack.
function deepCopy(value) {
  if (!isContainer(value)) return value;
  const root = emptyLike(value);
  const stack = [[value, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop();
    const keys = Array.isArray(src) ? null : Object.keys(src);
    const count = keys ? keys.length : src.length;
    for (let i = 0; i < count; i++) {
      const key = keys ? keys[i] : i;
      let child = src[key];
      if (isContainer(child)) {
        const copy = emptyLike(child);
        stack.push([child, copy]);
        child = copy;
      }
      if (keys) setMember(dst, key, child);
      else dst.push(child);
    }
  }
  return root;
}

function deepEqual(a, b) {
  const stack = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (!isContainer(x) || !isContainer(y)) {
      if (x !== y) return false;
      continue;
    }
    if (Array.isArray(x) !== Array.isArray(y)) return false;
    if (Array.isArray(x)) {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
    } else {
      const keys = Object.keys(x);
      if (keys.length !== Object.keys(y).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(y, key)) return false;
        stack.push([x[key], y[key]]);
      }
    }
  }
  return true;
}

// Returns the key that `token` names on `container`, or throws an OpFailure.
function childKey(container, token, notFound) {
  if (Array.isArray(container)) {
    if (INDEX_RE.test(token)) {
      if (Number(token) < container.length) return Number(token);
      throw new OpFailure(notFound);
    }
    if (token === '-') throw new OpFailure(notFound);
    throw new OpFailure('bad index');
  }
  if (isContainer(container) && Object.hasOwn(container, token)) return token;
  throw new OpFailure(notFound);
}

function follow(doc, tokens, notFound) {
  let current = doc;
  for (const token of tokens) current = current[childKey(current, token, notFound)];
  return current;
}

// Follows all tokens; returns the parent container and the key of the named value.
function locate(doc, tokens, notFound) {
  const parent = follow(doc, tokens.slice(0, -1), notFound);
  return { parent, key: childKey(parent, tokens[tokens.length - 1], notFound) };
}

function add(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = follow(doc, tokens.slice(0, -1), 'path not found');
  const token = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (token === '-') {
      parent.push(value);
    } else if (INDEX_RE.test(token)) {
      const index = Number(token);
      if (index > parent.length) throw new OpFailure('path not found');
      parent.splice(index, 0, value);
    } else {
      throw new OpFailure('bad index');
    }
  } else if (isContainer(parent)) {
    setMember(parent, token, value);
  } else {
    throw new OpFailure('path not found');
  }
  return doc;
}

function remove(doc, tokens, notFound) {
  const { parent, key } = locate(doc, tokens, notFound);
  const value = parent[key];
  if (Array.isArray(parent)) parent.splice(key, 1);
  else delete parent[key];
  return value;
}

function sameTokens(a, b) {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((token, i) => token === tokens[i]);
}

function tryParsePointer(pointer) {
  if (typeof pointer !== 'string') return null;
  try {
    return parsePointer(pointer);
  } catch {
    return null;
  }
}

// Checks one operation against the form rules; returns its parsed form or the failure reason.
function checkOperation(op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return { reason: 'not an object' };
  const name = Object.hasOwn(op, 'op') ? op.op : undefined;
  if (typeof name !== 'string' || !OPS.has(name)) return { reason: 'bad op' };
  const path = Object.hasOwn(op, 'path') ? tryParsePointer(op.path) : null;
  if (path === null) return { reason: 'bad path' };
  let from = null;
  if (name === 'move' || name === 'copy') {
    from = Object.hasOwn(op, 'from') ? tryParsePointer(op.from) : null;
    if (from === null) return { reason: 'bad from' };
  }
  const hasValue = name === 'add' || name === 'replace' || name === 'test';
  if (hasValue && !Object.hasOwn(op, 'value')) return { reason: 'missing value' };
  if (name === 'remove' && path.length === 0) return { reason: 'cannot remove root' };
  if (name === 'move' && isProperPrefix(from, path)) return { reason: 'cannot move into own child' };
  return { op: { name, path, from, value: hasValue ? op.value : undefined } };
}

function applyOperation(doc, { name, path, from, value }) {
  switch (name) {
    case 'add':
      return add(doc, path, deepCopy(value));
    case 'remove':
      remove(doc, path, 'path not found');
      return doc;
    case 'replace': {
      if (path.length === 0) return deepCopy(value);
      const { parent, key } = locate(doc, path, 'path not found');
      if (Array.isArray(parent)) parent[key] = deepCopy(value);
      else setMember(parent, key, deepCopy(value));
      return doc;
    }
    case 'move': {
      if (sameTokens(from, path)) {
        follow(doc, from, 'from not found');
        return doc;
      }
      const moved = remove(doc, from, 'from not found');
      return add(doc, path, moved);
    }
    case 'copy':
      return add(doc, path, follow(doc, from, 'from not found'));
    case 'test':
      if (!deepEqual(follow(doc, path, 'path not found'), value)) throw new OpFailure('test failed');
      return doc;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const checked = checkOperation(patch[i]);
    if (checked.reason) throw new PatchError(`operation ${i}: ${checked.reason}`, i);
    ops.push(checked.op);
  }
  let result = deepCopy(doc);
  for (let i = 0; i < ops.length; i++) {
    try {
      result = applyOperation(result, ops[i]);
    } catch (err) {
      if (err instanceof OpFailure) throw new PatchError(`operation ${i}: ${err.reason}`, i);
      throw err;
    }
  }
  return result;
}
