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

// Thrown internally while applying one operation; turned into a PatchError
// that carries the operation's index.
class Failure {
  constructor(reason) {
    this.reason = reason;
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
  if (pointer[0] !== '/' || /~(?![01])/.test(pointer)) return null;
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~[01]/g, (esc) => (esc === '~1' ? '/' : '~')));
}

function isContainer(value) {
  return value !== null && typeof value === 'object';
}

// Defines an own enumerable member, so names such as "__proto__" stay data.
function setMember(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

// Deep copy of a JSON value; iterative so very deep results cannot overflow the stack.
function clone(value) {
  if (!isContainer(value)) return value;
  const root = Array.isArray(value) ? [] : {};
  const stack = [[value, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop();
    const copyChild = (child) => {
      if (!isContainer(child)) return child;
      const copy = Array.isArray(child) ? [] : {};
      stack.push([child, copy]);
      return copy;
    };
    if (Array.isArray(src)) {
      for (let i = 0; i < src.length; i++) dst.push(copyChild(src[i]));
    } else {
      for (const name of Object.keys(src)) setMember(dst, name, copyChild(src[name]));
    }
  }
  return root;
}

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// JSON equality; iterative for the same reason as clone.
function equal(a, b) {
  const stack = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    const type = jsonType(x);
    if (type !== jsonType(y)) return false;
    if (type === 'array') {
      if (x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
    } else if (type === 'object') {
      const names = Object.keys(x);
      if (names.length !== Object.keys(y).length) return false;
      for (const name of names) {
        if (!Object.hasOwn(y, name)) return false;
        stack.push([x[name], y[name]]);
      }
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

// Returns the array index a token names on `arr`, or throws.
function existingIndex(arr, token, notFound) {
  if (token === '-') throw new Failure(notFound);
  if (!INDEX_RE.test(token)) throw new Failure('bad index');
  const index = Number(token);
  if (index >= arr.length) throw new Failure(notFound);
  return index;
}

function child(value, token, notFound) {
  if (Array.isArray(value)) return value[existingIndex(value, token, notFound)];
  if (isContainer(value) && Object.hasOwn(value, token)) return value[token];
  throw new Failure(notFound);
}

function resolve(doc, tokens, notFound) {
  let value = doc;
  for (const token of tokens) value = child(value, token, notFound);
  return value;
}

function add(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = resolve(doc, tokens.slice(0, -1), 'path not found');
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else if (!INDEX_RE.test(last)) {
      throw new Failure('bad index');
    } else {
      const index = Number(last);
      if (index > parent.length) throw new Failure('path not found');
      parent.splice(index, 0, value);
    }
  } else if (isContainer(parent)) {
    setMember(parent, last, value);
  } else {
    throw new Failure('path not found');
  }
  return doc;
}

// Removes the value `tokens` names (tokens is non-empty) and returns it.
function remove(doc, tokens, notFound) {
  const parent = resolve(doc, tokens.slice(0, -1), notFound);
  const last = tokens[tokens.length - 1];
  const removed = child(parent, last, notFound);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
  return removed;
}

function replace(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = resolve(doc, tokens.slice(0, -1), 'path not found');
  const last = tokens[tokens.length - 1];
  child(parent, last, 'path not found');
  if (Array.isArray(parent)) parent[Number(last)] = value;
  else setMember(parent, last, value);
  return doc;
}

function sameTokens(a, b) {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((token, i) => token === tokens[i]);
}

// Checks one operation against the form rules; returns the parsed form or a reason string.
function checkForm(op) {
  if (op === null || Array.isArray(op) || typeof op !== 'object') return 'not an object';
  if (!Object.hasOwn(op, 'op') || !OPS.has(op.op)) return 'bad op';
  const name = op.op;
  const path = Object.hasOwn(op, 'path') && typeof op.path === 'string' ? tryParsePointer(op.path) : null;
  if (path === null) return 'bad path';
  let from = null;
  if (name === 'move' || name === 'copy') {
    from = Object.hasOwn(op, 'from') && typeof op.from === 'string' ? tryParsePointer(op.from) : null;
    if (from === null) return 'bad from';
  }
  const usesValue = name === 'add' || name === 'replace' || name === 'test';
  if (usesValue && !Object.hasOwn(op, 'value')) return 'missing value';
  if (name === 'remove' && path.length === 0) return 'cannot remove root';
  if (name === 'move' && isProperPrefix(from, path)) return 'cannot move into own child';
  return { name, path, from, value: usesValue ? op.value : undefined };
}

function applyOne(doc, { name, path, from, value }) {
  switch (name) {
    case 'add':
      return add(doc, path, clone(value));
    case 'remove':
      remove(doc, path, 'path not found');
      return doc;
    case 'replace':
      return replace(doc, path, clone(value));
    case 'move': {
      resolve(doc, from, 'from not found');
      if (sameTokens(from, path)) return doc;
      return add(doc, path, remove(doc, from, 'from not found'));
    }
    case 'copy':
      return add(doc, path, clone(resolve(doc, from, 'from not found')));
    case 'test':
      if (!equal(resolve(doc, path, 'path not found'), value)) throw new Failure('test failed');
      return doc;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const form = checkForm(Object.hasOwn(patch, i) ? patch[i] : undefined);
    if (typeof form === 'string') throw new PatchError(`operation ${i}: ${form}`, i);
    ops.push(form);
  }
  let result = clone(doc);
  for (let i = 0; i < ops.length; i++) {
    try {
      result = applyOne(result, ops[i]);
    } catch (err) {
      if (err instanceof Failure) throw new PatchError(`operation ${i}: ${err.reason}`, i);
      throw err;
    }
  }
  return result;
}
