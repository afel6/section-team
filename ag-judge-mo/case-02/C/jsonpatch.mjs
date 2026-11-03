// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902).

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'PatchError';
    this.index = index;
  }
}

const POINTER_RE = /^(?:\/(?:[^~/]|~[01])*)*$/;
const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
const OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test'];

function isValidPointer(pointer) {
  return typeof pointer === 'string' && POINTER_RE.test(pointer);
}

function decodePointer(pointer) {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (!POINTER_RE.test(pointer)) throw new SyntaxError('invalid pointer');
  return decodePointer(pointer);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function setMember(obj, name, value) {
  // defineProperty avoids the __proto__ setter and keeps an existing member's place.
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

// Iterative deep copy of a JSON value; keeps -0 and member order.
function deepCopy(value) {
  if (value === null || typeof value !== 'object') return value;
  const root = Array.isArray(value) ? [] : {};
  const stack = [[value, root]];
  while (stack.length) {
    const [src, dst] = stack.pop();
    if (Array.isArray(src)) {
      for (let k = 0; k < src.length; k++) {
        const v = src[k];
        if (v !== null && typeof v === 'object') {
          const c = Array.isArray(v) ? [] : {};
          dst.push(c);
          stack.push([v, c]);
        } else {
          dst.push(v);
        }
      }
    } else {
      for (const key of Object.keys(src)) {
        const v = src[key];
        if (v !== null && typeof v === 'object') {
          const c = Array.isArray(v) ? [] : {};
          setMember(dst, key, c);
          stack.push([v, c]);
        } else {
          setMember(dst, key, v);
        }
      }
    }
  }
  return root;
}

function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// Iterative JSON equality.
function deepEqual(a, b) {
  const stack = [[a, b]];
  while (stack.length) {
    const [x, y] = stack.pop();
    const t = jsonType(x);
    if (t !== jsonType(y)) return false;
    if (t === 'array') {
      if (x.length !== y.length) return false;
      for (let k = 0; k < x.length; k++) stack.push([x[k], y[k]]);
    } else if (t === 'object') {
      const kx = Object.keys(x);
      if (kx.length !== Object.keys(y).length) return false;
      for (const key of kx) {
        if (!Object.hasOwn(y, key)) return false;
        stack.push([x[key], y[key]]);
      }
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

const NOT_FOUND = 1;
const BAD_INDEX = 2;

// Returns the status of `token` on `node`: 0 if it names a value, else NOT_FOUND or BAD_INDEX.
function lookup(node, token) {
  if (Array.isArray(node)) {
    if (INDEX_RE.test(token)) return Number(token) < node.length ? 0 : NOT_FOUND;
    return token === '-' ? NOT_FOUND : BAD_INDEX;
  }
  if (node !== null && typeof node === 'object') return Object.hasOwn(node, token) ? 0 : NOT_FOUND;
  return NOT_FOUND;
}

// Follows the first `n` tokens from `doc`, throwing on the first one that names nothing.
function walk(doc, tokens, n, notFound, index) {
  let node = doc;
  for (let k = 0; k < n; k++) {
    const token = tokens[k];
    const status = lookup(node, token);
    if (status === BAD_INDEX) throw new PatchError(`operation ${index}: bad index`, index);
    if (status === NOT_FOUND) throw new PatchError(`operation ${index}: ${notFound}`, index);
    node = Array.isArray(node) ? node[Number(token)] : node[token];
  }
  return node;
}

function doAdd(doc, tokens, value, index) {
  if (tokens.length === 0) return value;
  const parent = walk(doc, tokens, tokens.length - 1, 'path not found', index);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else if (INDEX_RE.test(last)) {
      const n = Number(last);
      if (n > parent.length) throw new PatchError(`operation ${index}: path not found`, index);
      parent.splice(n, 0, value);
    } else {
      throw new PatchError(`operation ${index}: bad index`, index);
    }
  } else if (isObject(parent)) {
    setMember(parent, last, value);
  } else {
    throw new PatchError(`operation ${index}: path not found`, index);
  }
  return doc;
}

// Returns the value removed.
function doRemove(doc, tokens, notFound, index) {
  const parent = walk(doc, tokens, tokens.length - 1, notFound, index);
  const last = tokens[tokens.length - 1];
  walk(parent, [last], 1, notFound, index);
  if (Array.isArray(parent)) return parent.splice(Number(last), 1)[0];
  const value = parent[last];
  delete parent[last];
  return value;
}

function doReplace(doc, tokens, value, index) {
  if (tokens.length === 0) return value;
  const parent = walk(doc, tokens, tokens.length - 1, 'path not found', index);
  const last = tokens[tokens.length - 1];
  walk(parent, [last], 1, 'path not found', index);
  if (Array.isArray(parent)) parent[Number(last)] = value;
  else setMember(parent, last, value);
  return doc;
}

function isProperPrefix(a, b) {
  if (a.length >= b.length) return false;
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}

function checkOperation(op, i) {
  const fail = (reason) => new PatchError(`operation ${i}: ${reason}`, i);
  if (op === null || typeof op !== 'object' || Array.isArray(op)) throw fail('not an object');
  if (!Object.hasOwn(op, 'op') || !OPS.includes(op.op)) throw fail('bad op');
  const name = op.op;
  if (!Object.hasOwn(op, 'path') || !isValidPointer(op.path)) throw fail('bad path');
  const checked = { op: name, path: decodePointer(op.path), pathString: op.path };
  if (name === 'move' || name === 'copy') {
    if (!Object.hasOwn(op, 'from') || !isValidPointer(op.from)) throw fail('bad from');
    checked.from = decodePointer(op.from);
    checked.fromString = op.from;
  }
  if (name === 'add' || name === 'replace' || name === 'test') {
    if (!Object.hasOwn(op, 'value')) throw fail('missing value');
    checked.value = op.value;
  }
  if (name === 'remove' && checked.path.length === 0) throw fail('cannot remove root');
  if (name === 'move' && isProperPrefix(checked.from, checked.path)) {
    throw fail('cannot move into own child');
  }
  return checked;
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) ops.push(checkOperation(patch[i], i));

  let result = deepCopy(doc);
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    switch (op.op) {
      case 'add':
        result = doAdd(result, op.path, deepCopy(op.value), i);
        break;
      case 'remove':
        doRemove(result, op.path, 'path not found', i);
        break;
      case 'replace':
        result = doReplace(result, op.path, deepCopy(op.value), i);
        break;
      case 'move': {
        walk(result, op.from, op.from.length, 'from not found', i);
        if (op.fromString === op.pathString) break;
        const value = doRemove(result, op.from, 'from not found', i);
        result = doAdd(result, op.path, value, i);
        break;
      }
      case 'copy': {
        const value = deepCopy(walk(result, op.from, op.from.length, 'from not found', i));
        result = doAdd(result, op.path, value, i);
        break;
      }
      case 'test': {
        const actual = walk(result, op.path, op.path.length, 'path not found', i);
        if (!deepEqual(actual, op.value)) throw new PatchError(`operation ${i}: test failed`, i);
        break;
      }
    }
  }
  return result;
}
