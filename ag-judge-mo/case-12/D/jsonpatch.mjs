// JSON Pointer (RFC 6901) and JSON Patch (RFC 6902).

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'PatchError';
    this.index = index;
  }
}

const OPS = ['add', 'remove', 'replace', 'move', 'copy', 'test'];
const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;

function isValidPointer(pointer) {
  if (pointer === '') return true;
  if (pointer[0] !== '/') return false;
  return !/~(?![01])/.test(pointer);
}

function decodeTokens(pointer) {
  if (pointer === '') return [];
  return pointer
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~[01]/g, (m) => (m === '~1' ? '/' : '~')));
}

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  if (!isValidPointer(pointer)) throw new SyntaxError('invalid pointer');
  return decodeTokens(pointer);
}

function isContainer(v) {
  return typeof v === 'object' && v !== null;
}

function defineMember(obj, key, value) {
  Object.defineProperty(obj, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

// Iterative deep copy of a JSON value; keeps member order and -0.
function deepCopy(value) {
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
          defineMember(dst, k, c);
          stack.push([v, c]);
        } else {
          defineMember(dst, k, v);
        }
      }
    }
  }
  return root;
}

// Iterative JSON equality.
function jsonEqual(a, b) {
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
        if (!Object.hasOwn(y, k)) return false;
        stack.push([x[k], y[k]]);
      }
    }
  }
  return true;
}

// Returns the child named by token, or throws with the right reason.
function step(node, token, notFound, fail) {
  if (Array.isArray(node)) {
    if (token === '-') fail(notFound);
    if (!INDEX_RE.test(token)) fail('bad index');
    const i = Number(token);
    if (i >= node.length) fail(notFound);
    return node[i];
  }
  if (isContainer(node)) {
    if (!Object.hasOwn(node, token)) fail(notFound);
    return node[token];
  }
  return fail(notFound);
}

function resolve(doc, tokens, notFound, fail) {
  let node = doc;
  for (const t of tokens) node = step(node, t, notFound, fail);
  return node;
}

function resolveParent(doc, tokens, notFound, fail) {
  return resolve(doc, tokens.slice(0, -1), notFound, fail);
}

function addAt(doc, tokens, value, fail) {
  if (tokens.length === 0) return value;
  const parent = resolveParent(doc, tokens, 'path not found', fail);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(value);
    } else {
      if (!INDEX_RE.test(last)) fail('bad index');
      const i = Number(last);
      if (i > parent.length) fail('path not found');
      parent.splice(i, 0, value);
    }
  } else if (isContainer(parent)) {
    defineMember(parent, last, value);
  } else {
    fail('path not found');
  }
  return doc;
}

function removeAt(doc, tokens, notFound, fail) {
  const parent = resolveParent(doc, tokens, notFound, fail);
  const last = tokens[tokens.length - 1];
  step(parent, last, notFound, fail);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
}

function isProperPrefix(a, b) {
  if (a.length >= b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameTokens(a, b) {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function checkOperation(op) {
  if (typeof op !== 'object' || op === null || Array.isArray(op)) return 'not an object';
  if (!Object.hasOwn(op, 'op') || !OPS.includes(op.op)) return 'bad op';
  const name = op.op;
  if (!Object.hasOwn(op, 'path') || typeof op.path !== 'string' || !isValidPointer(op.path)) {
    return 'bad path';
  }
  const path = decodeTokens(op.path);
  let from;
  if (name === 'move' || name === 'copy') {
    if (!Object.hasOwn(op, 'from') || typeof op.from !== 'string' || !isValidPointer(op.from)) {
      return 'bad from';
    }
    from = decodeTokens(op.from);
  }
  if ((name === 'add' || name === 'replace' || name === 'test') && !Object.hasOwn(op, 'value')) {
    return 'missing value';
  }
  if (name === 'remove' && path.length === 0) return 'cannot remove root';
  if (name === 'move' && isProperPrefix(from, path)) return 'cannot move into own child';
  return { op: name, path, from, value: op.value };
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) {
    const r = checkOperation(patch[i]);
    if (typeof r === 'string') throw new PatchError(`operation ${i}: ${r}`, i);
    ops.push(r);
  }
  let result = deepCopy(doc);
  for (let i = 0; i < ops.length; i++) {
    const fail = (reason) => {
      throw new PatchError(`operation ${i}: ${reason}`, i);
    };
    const { op, path, from, value } = ops[i];
    switch (op) {
      case 'add':
        result = addAt(result, path, deepCopy(value), fail);
        break;
      case 'remove':
        removeAt(result, path, 'path not found', fail);
        break;
      case 'replace': {
        if (path.length === 0) {
          result = deepCopy(value);
          break;
        }
        const parent = resolveParent(result, path, 'path not found', fail);
        const last = path[path.length - 1];
        step(parent, last, 'path not found', fail);
        if (Array.isArray(parent)) parent[Number(last)] = deepCopy(value);
        else defineMember(parent, last, deepCopy(value));
        break;
      }
      case 'move': {
        const v = resolve(result, from, 'from not found', fail);
        // A from of "" is either equal to path or rejected by the form rules.
        if (sameTokens(from, path)) break;
        removeAt(result, from, 'from not found', fail);
        result = addAt(result, path, v, fail);
        break;
      }
      case 'copy': {
        const v = deepCopy(resolve(result, from, 'from not found', fail));
        result = addAt(result, path, v, fail);
        break;
      }
      case 'test': {
        const v = resolve(result, path, 'path not found', fail);
        if (!jsonEqual(v, value)) fail('test failed');
        break;
      }
    }
  }
  return result;
}
