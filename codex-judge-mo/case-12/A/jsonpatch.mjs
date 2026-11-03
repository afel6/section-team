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
  if (pointer === '') return [];
  if (pointer[0] !== '/' || /~(?![01])/.test(pointer)) throw new SyntaxError('invalid pointer');
  return pointer
    .slice(1)
    .split('/')
    .map((token) => token.replace(/~[01]/g, (m) => (m === '~0' ? '~' : '/')));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Defines an own data member, so names such as `__proto__` stay ordinary members.
function setMember(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

function emptyLike(value) {
  if (Array.isArray(value)) return [];
  return isObject(value) ? {} : value;
}

// Iterative deep copy of a JSON value: keeps -0 and member order, never recurses.
function deepCopy(value) {
  const root = emptyLike(value);
  const stack = root === value ? [] : [[value, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop();
    const isArray = Array.isArray(src);
    for (const key of isArray ? src.keys() : Object.keys(src)) {
      const child = src[key];
      const copy = emptyLike(child);
      if (isArray) dst.push(copy);
      else setMember(dst, key, copy);
      if (copy !== child) stack.push([child, copy]);
    }
  }
  return root;
}

function jsonEqual(a, b) {
  const stack = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i++) stack.push([x[i], y[i]]);
    } else if (isObject(x) || isObject(y)) {
      if (!isObject(x) || !isObject(y)) return false;
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

class ApplyFailure extends Error {}

// Returns the array index a token names on `arr`, or throws.
function arrayIndex(arr, token, notFound, allowEnd) {
  if (!INDEX_RE.test(token)) throw new ApplyFailure(token === '-' ? notFound : 'bad index');
  const index = Number(token);
  if (index < arr.length || (allowEnd && index === arr.length)) return index;
  throw new ApplyFailure(notFound);
}

// Returns the value that `token` names on `value`, or throws.
function child(value, token, notFound) {
  if (Array.isArray(value)) return value[arrayIndex(value, token, notFound, false)];
  if (isObject(value) && Object.hasOwn(value, token)) return value[token];
  throw new ApplyFailure(notFound);
}

function walk(root, tokens, notFound) {
  let value = root;
  for (const token of tokens) value = child(value, token, notFound);
  return value;
}

function add(root, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = walk(root, tokens.slice(0, -1), 'path not found');
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') parent.push(value);
    else parent.splice(arrayIndex(parent, last, 'path not found', true), 0, value);
  } else if (isObject(parent)) {
    setMember(parent, last, value);
  } else {
    throw new ApplyFailure('path not found');
  }
  return root;
}

function remove(root, tokens, notFound) {
  const parent = walk(root, tokens.slice(0, -1), notFound);
  const last = tokens[tokens.length - 1];
  const value = child(parent, last, notFound);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
  return value;
}

function replace(root, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = walk(root, tokens.slice(0, -1), 'path not found');
  const last = tokens[tokens.length - 1];
  child(parent, last, 'path not found');
  setMember(parent, last, value);
  return root;
}

function isProperPrefix(prefix, tokens) {
  return prefix.length < tokens.length && prefix.every((token, i) => token === tokens[i]);
}

function tryParse(pointer) {
  if (typeof pointer !== 'string') return null;
  try {
    return parsePointer(pointer);
  } catch {
    return null;
  }
}

function member(op, name) {
  return Object.hasOwn(op, name) ? op[name] : undefined;
}

// Checks one operation against the form rules: returns `{ reason }` for the first rule it
// breaks, otherwise `{ op }` with its pointers parsed.
function checkOperation(op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return { reason: 'not an object' };
  const name = member(op, 'op');
  if (typeof name !== 'string' || !OPS.has(name)) return { reason: 'bad op' };
  const path = tryParse(member(op, 'path'));
  if (path === null) return { reason: 'bad path' };
  const usesFrom = name === 'move' || name === 'copy';
  const from = usesFrom ? tryParse(member(op, 'from')) : null;
  if (usesFrom && from === null) return { reason: 'bad from' };
  const usesValue = name === 'add' || name === 'replace' || name === 'test';
  if (usesValue && !Object.hasOwn(op, 'value')) return { reason: 'missing value' };
  if (name === 'remove' && path.length === 0) return { reason: 'cannot remove root' };
  if (name === 'move' && isProperPrefix(from, path)) return { reason: 'cannot move into own child' };
  return {
    op: {
      name,
      path,
      from,
      value: usesValue ? op.value : undefined,
      // The ~0/~1 encoding is one-to-one, so equal pointer strings mean equal token lists.
      samePath: usesFrom && op.from === op.path,
    },
  };
}

function applyOperation(root, op) {
  switch (op.name) {
    case 'add':
      return add(root, op.path, deepCopy(op.value));
    case 'remove':
      remove(root, op.path, 'path not found');
      return root;
    case 'replace':
      return replace(root, op.path, deepCopy(op.value));
    case 'move': {
      if (op.samePath) {
        walk(root, op.from, 'from not found');
        return root;
      }
      const value = remove(root, op.from, 'from not found');
      return add(root, op.path, value);
    }
    case 'copy':
      return add(root, op.path, deepCopy(walk(root, op.from, 'from not found')));
    case 'test':
      if (!jsonEqual(walk(root, op.path, 'path not found'), op.value)) {
        throw new ApplyFailure('test failed');
      }
      return root;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const { reason, op } = checkOperation(patch[i]);
    if (reason) throw new PatchError(`operation ${i}: ${reason}`, i);
    ops.push(op);
  }
  let result = deepCopy(doc);
  for (let i = 0; i < ops.length; i++) {
    try {
      result = applyOperation(result, ops[i]);
    } catch (err) {
      if (err instanceof ApplyFailure) throw new PatchError(`operation ${i}: ${err.message}`, i);
      throw err;
    }
  }
  return result;
}
