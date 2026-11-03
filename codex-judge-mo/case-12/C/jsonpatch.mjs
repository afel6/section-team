// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902).

const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const INDEX_RE = /^(0|[1-9][0-9]*)$/;

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'PatchError';
    this.index = index;
  }
}

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  const tokens = tryParsePointer(pointer);
  if (tokens === null) throw new SyntaxError('invalid pointer');
  return tokens;
}

// Returns the decoded tokens, or null when the pointer is invalid.
function tryParsePointer(pointer) {
  if (pointer === '') return [];
  if (pointer[0] !== '/') return null;
  if (/~([^01]|$)/.test(pointer)) return null;
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

// Sets an own data property without triggering setters such as __proto__.
function setMember(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

// Deep copy of a JSON value, iterative so deep values do not overflow the stack.
function clone(value) {
  if (!isContainer(value)) return value;
  const emptyLike = (v) => (Array.isArray(v) ? [] : {});
  const root = emptyLike(value);
  const stack = [[value, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop();
    const copyChild = (child) => {
      if (!isContainer(child)) return child;
      const copy = emptyLike(child);
      stack.push([child, copy]);
      return copy;
    };
    if (Array.isArray(src)) {
      for (let i = 0; i < src.length; i++) dst.push(copyChild(src[i]));
    } else {
      for (const key of Object.keys(src)) setMember(dst, key, copyChild(src[key]));
    }
  }
  return root;
}

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function deepEqual(a, b) {
  const stack = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    const type = jsonType(x);
    if (type !== jsonType(y)) return false;
    if (type === 'array') {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
    } else if (type === 'object') {
      const keys = Object.keys(x);
      if (keys.length !== Object.keys(y).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(y, key)) return false;
        stack.push([x[key], y[key]]);
      }
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

// The reason a token names nothing on `container`, or null when it names a value.
function missReason(container, token, notFound) {
  if (Array.isArray(container)) {
    if (INDEX_RE.test(token)) return Number(token) < container.length ? null : notFound;
    return token === '-' ? notFound : 'bad index';
  }
  if (isObject(container)) return Object.hasOwn(container, token) ? null : notFound;
  return notFound;
}

function follow(doc, tokens, notFound, fail) {
  let current = doc;
  for (const token of tokens) {
    const reason = missReason(current, token, notFound);
    if (reason !== null) fail(reason);
    current = current[token];
  }
  return current;
}

// Finds the parent of the value named by non-empty `tokens`, checking the value exists.
function locate(doc, tokens, notFound, fail) {
  const parent = follow(doc, tokens.slice(0, -1), notFound, fail);
  const key = tokens[tokens.length - 1];
  const reason = missReason(parent, key, notFound);
  if (reason !== null) fail(reason);
  return { parent, key };
}

function removeAt(doc, tokens, notFound, fail) {
  const { parent, key } = locate(doc, tokens, notFound, fail);
  const removed = parent[key];
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
  return removed;
}

function addAt(doc, tokens, value, fail) {
  if (tokens.length === 0) return value;
  const parent = follow(doc, tokens.slice(0, -1), 'path not found', fail);
  const key = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (key === '-') {
      parent.push(value);
    } else if (!INDEX_RE.test(key)) {
      fail('bad index');
    } else if (Number(key) > parent.length) {
      fail('path not found');
    } else {
      parent.splice(Number(key), 0, value);
    }
  } else if (isObject(parent)) {
    setMember(parent, key, value);
  } else {
    fail('path not found');
  }
  return doc;
}

function sameTokens(a, b) {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((token, i) => token === tokens[i]);
}

// Checks one operation against the form rules; returns its parsed form or a reason string.
function checkOperation(op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return 'not an object';
  const name = Object.hasOwn(op, 'op') ? op.op : undefined;
  if (typeof name !== 'string' || !OPS.has(name)) return 'bad op';
  const path = Object.hasOwn(op, 'path') && typeof op.path === 'string' ? tryParsePointer(op.path) : null;
  if (path === null) return 'bad path';
  const parsed = { op: name, path };
  if (name === 'move' || name === 'copy') {
    parsed.from = Object.hasOwn(op, 'from') && typeof op.from === 'string' ? tryParsePointer(op.from) : null;
    if (parsed.from === null) return 'bad from';
  }
  if (name === 'add' || name === 'replace' || name === 'test') {
    if (!Object.hasOwn(op, 'value')) return 'missing value';
    parsed.value = op.value;
  }
  if (name === 'remove' && path.length === 0) return 'cannot remove root';
  if (name === 'move' && isProperPrefix(parsed.from, path)) return 'cannot move into own child';
  return parsed;
}

function applyOperation(doc, { op, path, from, value }, fail) {
  switch (op) {
    case 'add':
      return addAt(doc, path, clone(value), fail);
    case 'remove':
      removeAt(doc, path, 'path not found', fail);
      return doc;
    case 'replace': {
      if (path.length === 0) return clone(value);
      const { parent, key } = locate(doc, path, 'path not found', fail);
      if (Array.isArray(parent)) parent[Number(key)] = clone(value);
      else setMember(parent, key, clone(value));
      return doc;
    }
    case 'move': {
      if (sameTokens(from, path)) {
        follow(doc, from, 'from not found', fail);
        return doc;
      }
      // The form rules guarantee `from` is not "" here, so it has a parent.
      const moved = removeAt(doc, from, 'from not found', fail);
      return addAt(doc, path, moved, fail);
    }
    case 'copy':
      return addAt(doc, path, clone(follow(doc, from, 'from not found', fail)), fail);
    case 'test':
      if (!deepEqual(follow(doc, path, 'path not found', fail), value)) fail('test failed');
      return doc;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const operations = [];
  for (let i = 0; i < patch.length; i++) {
    const checked = checkOperation(patch[i]);
    if (typeof checked === 'string') throw new PatchError(`operation ${i}: ${checked}`, i);
    operations.push(checked);
  }
  let result = clone(doc);
  operations.forEach((operation, i) => {
    const fail = (reason) => {
      throw new PatchError(`operation ${i}: ${reason}`, i);
    };
    result = applyOperation(result, operation, fail);
  });
  return result;
}
