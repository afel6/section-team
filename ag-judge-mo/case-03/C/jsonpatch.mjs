// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) with no dependencies.

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'PatchError';
    this.index = index;
  }
}

const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
const BAD_ESCAPE_RE = /~(?![01])/;

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (pointer === '') return [];
  if (pointer[0] !== '/') throw new SyntaxError('invalid pointer');
  return pointer.slice(1).split('/').map((token) => {
    if (BAD_ESCAPE_RE.test(token)) throw new SyntaxError('invalid pointer');
    return token.replace(/~[01]/g, (esc) => (esc === '~1' ? '/' : '~'));
  });
}

const isContainer = (v) => v !== null && typeof v === 'object';

// Defines an own data property without triggering setters such as __proto__.
function setMember(obj, name, value) {
  Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
}

// Iterative deep copy: keeps -0 and member order, safe for very deep values.
function deepCopy(value) {
  if (!isContainer(value)) return value;
  const emptyLike = (v) => (Array.isArray(v) ? [] : {});
  const root = emptyLike(value);
  const stack = [[value, root]];
  while (stack.length > 0) {
    const [src, dst] = stack.pop();
    const isArr = Array.isArray(src);
    const keys = isArr ? null : Object.keys(src);
    const count = isArr ? src.length : keys.length;
    for (let i = 0; i < count; i++) {
      const item = isArr ? src[i] : src[keys[i]];
      let copy = item;
      if (isContainer(item)) {
        copy = emptyLike(item);
        stack.push([item, copy]);
      }
      if (isArr) dst.push(copy);
      else setMember(dst, keys[i], copy);
    }
  }
  return root;
}

// Iterative JSON equality: 0 equals -0, object member order is ignored.
function jsonEqual(a, b) {
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
      for (const k of keys) {
        if (!Object.hasOwn(y, k)) return false;
        stack.push([x[k], y[k]]);
      }
    }
  }
  return true;
}

class StepError extends Error {}

// Returns the child of `node` named by `token`, or throws a StepError reason.
function step(node, token, notFound) {
  if (Array.isArray(node)) {
    if (token !== '-' && !INDEX_RE.test(token)) throw new StepError('bad index');
    if (token !== '-' && Number(token) < node.length) return node[Number(token)];
    throw new StepError(notFound);
  }
  if (isContainer(node) && Object.hasOwn(node, token)) return node[token];
  throw new StepError(notFound);
}

function follow(doc, tokens, notFound) {
  let node = doc;
  for (const token of tokens) node = step(node, token, notFound);
  return node;
}

function parentOf(doc, tokens, notFound) {
  return follow(doc, tokens.slice(0, -1), notFound);
}

function addAt(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = parentOf(doc, tokens, 'path not found');
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else if (!INDEX_RE.test(last)) {
      throw new StepError('bad index');
    } else if (Number(last) > parent.length) {
      throw new StepError('path not found');
    } else {
      parent.splice(Number(last), 0, value);
    }
  } else if (isContainer(parent)) {
    setMember(parent, last, value);
  } else {
    throw new StepError('path not found');
  }
  return doc;
}

// Removes the value at non-empty `tokens`, returning it.
function removeAt(doc, tokens, notFound) {
  const parent = parentOf(doc, tokens, notFound);
  const last = tokens[tokens.length - 1];
  const value = step(parent, last, notFound);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
  return value;
}

function replaceAt(doc, tokens, value) {
  if (tokens.length === 0) return value;
  const parent = parentOf(doc, tokens, 'path not found');
  const last = tokens[tokens.length - 1];
  step(parent, last, 'path not found');
  if (Array.isArray(parent)) parent[Number(last)] = value;
  else setMember(parent, last, value);
  return doc;
}

const startsWith = (tokens, prefix) => prefix.every((t, i) => t === tokens[i]);
const sameTokens = (a, b) => a.length === b.length && startsWith(b, a);
const isProperPrefix = (a, b) => a.length < b.length && startsWith(b, a);

function tryParse(pointer) {
  if (typeof pointer !== 'string') return null;
  try {
    return parsePointer(pointer);
  } catch {
    return null;
  }
}

// Returns the form-rule reason for `op`, or a normalized operation.
function checkForm(op) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) return 'not an object';
  const has = (name) => Object.hasOwn(op, name);
  if (!has('op') || !OPS.has(op.op)) return 'bad op';
  const path = has('path') ? tryParse(op.path) : null;
  if (path === null) return 'bad path';
  const kind = op.op;
  let from = null;
  if (kind === 'move' || kind === 'copy') {
    from = has('from') ? tryParse(op.from) : null;
    if (from === null) return 'bad from';
  }
  if ((kind === 'add' || kind === 'replace' || kind === 'test') && !has('value')) return 'missing value';
  if (kind === 'remove' && path.length === 0) return 'cannot remove root';
  if (kind === 'move' && isProperPrefix(from, path)) return 'cannot move into own child';
  return { kind, path, from, value: op.value };
}

function applyOne(doc, { kind, path, from, value }) {
  switch (kind) {
    case 'add':
      return addAt(doc, path, deepCopy(value));
    case 'remove':
      removeAt(doc, path, 'path not found');
      return doc;
    case 'replace':
      return replaceAt(doc, path, deepCopy(value));
    case 'move': {
      follow(doc, from, 'from not found');
      if (sameTokens(from, path)) return doc;
      const moved = removeAt(doc, from, 'from not found');
      return addAt(doc, path, moved);
    }
    case 'copy':
      return addAt(doc, path, deepCopy(follow(doc, from, 'from not found')));
    case 'test':
      if (!jsonEqual(follow(doc, path, 'path not found'), value)) throw new StepError('test failed');
      return doc;
  }
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const form = checkForm(patch[i]);
    if (typeof form === 'string') throw new PatchError(`operation ${i}: ${form}`, i);
    ops.push(form);
  }
  let result = deepCopy(doc);
  for (let i = 0; i < ops.length; i++) {
    try {
      result = applyOne(result, ops[i]);
    } catch (err) {
      if (err instanceof StepError) throw new PatchError(`operation ${i}: ${err.message}`, i);
      throw err;
    }
  }
  return result;
}
