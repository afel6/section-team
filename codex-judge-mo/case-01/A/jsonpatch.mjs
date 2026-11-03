// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902).

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'PatchError';
    this.index = index;
  }
}

const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const INDEX_RE = /^(0|[1-9][0-9]*)$/;

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (pointer === '') return [];
  if (pointer[0] !== '/' || /~(?![01])/.test(pointer)) throw new SyntaxError('invalid pointer');
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~[01]/g, (m) => (m === '~0' ? '~' : '/')));
}

function isContainer(value) {
  return typeof value === 'object' && value !== null;
}

function setMember(obj, name, value) {
  // defineProperty keeps an existing member's place and treats __proto__ as an ordinary name.
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

function emptyLike(value) {
  return Array.isArray(value) ? new Array(value.length) : {};
}

// Iterative deep copy: keeps -0 and member order, and survives very deep values.
function deepCopy(value) {
  if (!isContainer(value)) return value;
  const root = emptyLike(value);
  const stack = [[value, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop();
    const keys = Array.isArray(src) ? src.keys() : Object.keys(src);
    for (const key of keys) {
      const child = src[key];
      if (isContainer(child)) {
        const copy = emptyLike(child);
        setMember(dst, key, copy);
        stack.push([child, copy]);
      } else {
        setMember(dst, key, child);
      }
    }
  }
  return root;
}

function jsonEqual(a, b) {
  if (a === b) return true;
  if (!isContainer(a) || !isContainer(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((item, i) => jsonEqual(item, b[i]));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]));
}

class Failure {
  constructor(reason) {
    this.reason = reason;
  }
}

function fail(reason) {
  throw new Failure(reason);
}

// Checks that `token` names a value in `container`; fails with `notFound` or `bad index`.
function checkNames(container, token, notFound) {
  if (Array.isArray(container)) {
    if (token === '-') fail(notFound);
    if (!INDEX_RE.test(token)) fail('bad index');
    if (Number(token) >= container.length) fail(notFound);
  } else if (!isContainer(container) || !Object.hasOwn(container, token)) {
    fail(notFound);
  }
}

function follow(doc, tokens, notFound) {
  let current = doc;
  for (const token of tokens) {
    checkNames(current, token, notFound);
    current = current[token];
  }
  return current;
}

function removeValue(doc, tokens, notFound) {
  const parent = follow(doc, tokens.slice(0, -1), notFound);
  const last = tokens[tokens.length - 1];
  checkNames(parent, last, notFound);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
}

function replaceValue(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = follow(doc, tokens.slice(0, -1), 'path not found');
  const last = tokens[tokens.length - 1];
  checkNames(parent, last, 'path not found');
  setMember(parent, last, value);
  return doc;
}

function addValue(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = follow(doc, tokens.slice(0, -1), 'path not found');
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else if (!INDEX_RE.test(last)) {
      fail('bad index');
    } else if (Number(last) > parent.length) {
      fail('path not found');
    } else {
      parent.splice(Number(last), 0, value);
    }
  } else if (isContainer(parent)) {
    setMember(parent, last, value);
  } else {
    fail('path not found');
  }
  return doc;
}

function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((token, i) => token === tokens[i]);
}

function sameTokens(a, b) {
  return a.length === b.length && a.every((token, i) => token === b[i]);
}

function pointerMember(op, name) {
  if (!Object.hasOwn(op, name) || typeof op[name] !== 'string') return null;
  try {
    return parsePointer(op[name]);
  } catch {
    return null;
  }
}

// Returns the checked form of an operation, or the reason it breaks the form rules.
function checkForm(op) {
  if (op === null || Array.isArray(op) || typeof op !== 'object') return 'not an object';
  const name = Object.hasOwn(op, 'op') ? op.op : undefined;
  if (typeof name !== 'string' || !OPS.has(name)) return 'bad op';
  const path = pointerMember(op, 'path');
  if (path === null) return 'bad path';
  let from = null;
  if (name === 'move' || name === 'copy') {
    from = pointerMember(op, 'from');
    if (from === null) return 'bad from';
  }
  if ((name === 'add' || name === 'replace' || name === 'test') && !Object.hasOwn(op, 'value')) {
    return 'missing value';
  }
  if (name === 'remove' && path.length === 0) return 'cannot remove root';
  if (name === 'move' && isProperPrefix(from, path)) return 'cannot move into own child';
  return { name, path, from, value: op.value };
}

function applyOne(doc, { name, path, from, value }) {
  switch (name) {
    case 'add':
      return addValue(doc, path, deepCopy(value));
    case 'remove':
      removeValue(doc, path, 'path not found');
      return doc;
    case 'replace':
      return replaceValue(doc, path, deepCopy(value));
    case 'move': {
      const moved = follow(doc, from, 'from not found');
      if (sameTokens(from, path)) return doc;
      removeValue(doc, from, 'from not found');
      return addValue(doc, path, moved);
    }
    case 'copy':
      return addValue(doc, path, deepCopy(follow(doc, from, 'from not found')));
    case 'test':
      if (!jsonEqual(follow(doc, path, 'path not found'), value)) fail('test failed');
      return doc;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const checked = checkForm(patch[i]);
    if (typeof checked === 'string') throw new PatchError(`operation ${i}: ${checked}`, i);
    ops.push(checked);
  }
  let result = deepCopy(doc);
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
