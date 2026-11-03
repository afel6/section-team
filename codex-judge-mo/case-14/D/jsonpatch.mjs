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

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (pointer === '') return [];
  if (pointer[0] !== '/' || /~(?![01])/.test(pointer)) throw new SyntaxError('invalid pointer');
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Defines an own data property, so names like "__proto__" stay ordinary members.
function setMember(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (isObject(v)) {
    const out = {};
    for (const k of Object.keys(v)) setMember(out, k, deepCopy(v[k]));
    return out;
  }
  return v;
}

function deepEqual(a, b) {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a)) {
    if (!isObject(b)) return false;
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return a === b;
}

// Returns the error reason for an operation that breaks the form rules, or null.
function checkForm(op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return 'not an object';
  const name = Object.hasOwn(op, 'op') ? op.op : undefined;
  if (typeof name !== 'string' || !OPS.has(name)) return 'bad op';
  const path = validPointer(op, 'path');
  if (!path) return 'bad path';
  let from = null;
  if (name === 'move' || name === 'copy') {
    from = validPointer(op, 'from');
    if (!from) return 'bad from';
  }
  if ((name === 'add' || name === 'replace' || name === 'test') && !Object.hasOwn(op, 'value')) {
    return 'missing value';
  }
  if (name === 'remove' && path.length === 0) return 'cannot remove root';
  if (name === 'move' && from.length < path.length && from.every((t, i) => t === path[i])) {
    return 'cannot move into own child';
  }
  return null;
}

function validPointer(op, member) {
  if (!Object.hasOwn(op, member) || typeof op[member] !== 'string') return null;
  try {
    return parsePointer(op[member]);
  } catch {
    return null;
  }
}

// An operation that fails while applying; its message is the reason.
class OperationFailure extends Error {}

// Follows tokens from root; returns the value they name or throws an OperationFailure.
function resolve(root, tokens, notFound) {
  let cur = root;
  for (const t of tokens) {
    if (Array.isArray(cur)) {
      if (t === '-') throw new OperationFailure(notFound);
      if (!INDEX_RE.test(t)) throw new OperationFailure('bad index');
      if (Number(t) >= cur.length) throw new OperationFailure(notFound);
      cur = cur[Number(t)];
    } else if (isObject(cur) && Object.hasOwn(cur, t)) {
      cur = cur[t];
    } else {
      throw new OperationFailure(notFound);
    }
  }
  return cur;
}

// Follows all tokens of a non-empty path but the last; returns the parent and the last token.
function resolveParent(doc, path) {
  return [resolve(doc, path.slice(0, -1), 'path not found'), path[path.length - 1]];
}

function addAt(doc, path, value) {
  if (path.length === 0) return value;
  const [parent, last] = resolveParent(doc, path);
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else if (!INDEX_RE.test(last)) {
      throw new OperationFailure('bad index');
    } else if (Number(last) > parent.length) {
      throw new OperationFailure('path not found');
    } else {
      parent.splice(Number(last), 0, value);
    }
  } else if (isObject(parent)) {
    setMember(parent, last, value);
  } else {
    throw new OperationFailure('path not found');
  }
  return doc;
}

// Removes the value at a non-empty path that is known to exist.
function removeAt(doc, path) {
  const [parent, last] = resolveParent(doc, path);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
}

// Replaces the value at a non-empty path that is known to exist, keeping its place.
function replaceAt(doc, path, value) {
  const [parent, last] = resolveParent(doc, path);
  if (Array.isArray(parent)) parent[Number(last)] = value;
  else setMember(parent, last, value);
  return doc;
}

function applyOne(doc, op) {
  const path = parsePointer(op.path);
  switch (op.op) {
    case 'add':
      return addAt(doc, path, deepCopy(op.value));
    case 'remove':
      resolve(doc, path, 'path not found');
      removeAt(doc, path);
      return doc;
    case 'replace':
      if (path.length === 0) return deepCopy(op.value);
      resolve(doc, path, 'path not found');
      return replaceAt(doc, path, deepCopy(op.value));
    case 'move': {
      const from = parsePointer(op.from);
      const value = resolve(doc, from, 'from not found');
      if (op.from === op.path) return doc;
      // The form rules guarantee from is non-empty here (a "" from is a prefix of any other path).
      removeAt(doc, from);
      return addAt(doc, path, value);
    }
    case 'copy': {
      const value = deepCopy(resolve(doc, parsePointer(op.from), 'from not found'));
      return addAt(doc, path, value);
    }
    case 'test':
      if (!deepEqual(resolve(doc, path, 'path not found'), op.value)) {
        throw new OperationFailure('test failed');
      }
      return doc;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const op = patch[i];
    const reason = checkForm(op);
    if (reason) throw new PatchError(`operation ${i}: ${reason}`, i);
    ops.push(op);
  }
  let result = deepCopy(doc);
  for (let i = 0; i < ops.length; i++) {
    try {
      result = applyOne(result, ops[i]);
    } catch (err) {
      if (err instanceof OperationFailure) throw new PatchError(`operation ${i}: ${err.message}`, i);
      throw err;
    }
  }
  return result;
}
