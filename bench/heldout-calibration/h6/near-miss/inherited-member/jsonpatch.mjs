// jsonpatch.mjs: JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) without dependencies.
// The patch is applied to a private deep copy, so doc and patch are never changed, even on a throw.
// Copy, depth and equality walks use explicit stacks, so deep values cannot overflow the call stack.

const OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const NEEDS_FROM = new Set(['move', 'copy']);
const NEEDS_VALUE = new Set(['add', 'replace', 'test']);
const INDEX = /^(?:0|[1-9][0-9]*)$/;
const BAD_TILDE = /~(?![01])/;
const ESCAPE = /~[01]/g;

export class PatchError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'PatchError';
    this.index = index;
  }
}

const isContainer = value => value !== null && typeof value === 'object';

// Returns the decoded tokens, or null when the string is not a valid pointer.
function decodePointer(pointer) {
  if (pointer === '') return [];
  if (pointer[0] !== '/' || BAD_TILDE.test(pointer)) return null;
  return pointer.slice(1).split('/').map(token => token.replace(ESCAPE, m => (m === '~1' ? '/' : '~')));
}

export function parsePointer(pointer) {
  if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');
  const tokens = decodePointer(pointer);
  if (tokens === null) throw new SyntaxError('invalid pointer');
  return tokens;
}

// defineProperty, not assignment: a "__proto__" member must stay an own data property.
function setMember(obj, key, value) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

// Deep copy of a JSON value: keeps -0, member order and "__proto__" members.
function deepCopy(value) {
  if (!isContainer(value)) return value;
  const root = Array.isArray(value) ? [] : {};
  const stack = [[value, root]];
  while (stack.length > 0) {
    const [source, target] = stack.pop();
    for (const key of Object.keys(source)) {
      const child = source[key];
      const copy = isContainer(child) ? (Array.isArray(child) ? [] : {}) : child;
      if (copy !== child) stack.push([child, copy]);
      if (Array.isArray(target)) target.push(copy); // JSON arrays are dense: keys come 0, 1, 2...
      else setMember(target, key, copy);
    }
  }
  return root;
}

// Pushes the child pairs of x and y onto stack; returns false when their shapes differ.
function pushChildPairs(x, y, stack) {
  if (!isContainer(x) || !isContainer(y)) return x === y; // 0 === -0; type mismatch is false
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const keys = Object.keys(x);
  if (keys.length !== Object.keys(y).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(y, key)) return false;
    stack.push([x[key], y[key]]);
  }
  return true;
}

function jsonEqual(a, b) {
  const stack = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop();
    if (!pushChildPairs(x, y, stack)) return false;
  }
  return true;
}

// One step of a pointer: { found, value } or { error } ('bad index' or null for "names nothing").
function step(node, token) {
  if (Array.isArray(node)) {
    if (token === '-') return { error: null };
    if (!INDEX.test(token)) return { error: 'bad index' };
    const index = Number(token);
    return index < node.length ? { value: node[index] } : { error: null };
  }
  if (isContainer(node) && token in node) return { value: node[token] };
  return { error: null };
}

// Follows tokens from root; returns the value they name or throws the operation's failure.
function follow(root, tokens, notFound, fail) {
  let node = root;
  for (const token of tokens) {
    const next = step(node, token);
    if (next.error !== undefined) fail(next.error ?? notFound);
    node = next.value;
  }
  return node;
}

function addAt(root, tokens, value, fail) {
  if (tokens.length === 0) return value;
  const parent = follow(root, tokens.slice(0, -1), 'path not found', fail);
  const last = tokens[tokens.length - 1];
  if (Array.isArray(parent)) {
    if (last === '-') parent.push(value);
    else if (!INDEX.test(last)) fail('bad index');
    else if (Number(last) > parent.length) fail('path not found');
    else parent.splice(Number(last), 0, value);
  } else if (isContainer(parent)) {
    setMember(parent, last, value);
  } else {
    fail('path not found');
  }
  return root;
}

// Removes the value at tokens (never the root) and returns it.
function removeAt(root, tokens, notFound, fail) {
  const parent = follow(root, tokens.slice(0, -1), notFound, fail);
  const last = tokens[tokens.length - 1];
  const removed = follow(parent, [last], notFound, fail);
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete parent[last];
  return removed;
}

function replaceAt(root, tokens, value, fail) {
  if (tokens.length === 0) return value;
  const parent = follow(root, tokens.slice(0, -1), 'path not found', fail);
  const last = tokens[tokens.length - 1];
  follow(parent, [last], 'path not found', fail);
  if (Array.isArray(parent)) parent[Number(last)] = value;
  else setMember(parent, last, value);
  return root;
}

const sameTokens = (a, b) => a.length === b.length && a.every((token, i) => token === b[i]);
const isProperPrefix = (a, b) => a.length < b.length && a.every((token, i) => token === b[i]);

function applyOne(root, op, fail) {
  switch (op.op) {
    case 'add': return addAt(root, op.path, deepCopy(op.value), fail);
    case 'remove': removeAt(root, op.path, 'path not found', fail); return root;
    case 'replace': return replaceAt(root, op.path, deepCopy(op.value), fail);
    case 'copy': return addAt(root, op.path, deepCopy(follow(root, op.from, 'from not found', fail)), fail);
    case 'move': {
      follow(root, op.from, 'from not found', fail);
      if (sameTokens(op.from, op.path)) return root;
      return addAt(root, op.path, removeAt(root, op.from, 'from not found', fail), fail);
    }
    default: // 'test'
      if (!jsonEqual(follow(root, op.path, 'path not found', fail), op.value)) fail('test failed');
      return root;
  }
}

// Checks one operation against the form rules; returns { reason } or the normalized operation.
function checkForm(op) {
  if (op === null || Array.isArray(op) || typeof op !== 'object') return { reason: 'not an object' };
  const name = Object.hasOwn(op, 'op') ? op.op : undefined;
  if (!OPS.has(name)) return { reason: 'bad op' };
  const path = Object.hasOwn(op, 'path') && typeof op.path === 'string' ? decodePointer(op.path) : null;
  if (path === null) return { reason: 'bad path' };
  let from = null;
  if (NEEDS_FROM.has(name)) {
    from = Object.hasOwn(op, 'from') && typeof op.from === 'string' ? decodePointer(op.from) : null;
    if (from === null) return { reason: 'bad from' };
  }
  if (NEEDS_VALUE.has(name) && !Object.hasOwn(op, 'value')) return { reason: 'missing value' };
  if (name === 'remove' && path.length === 0) return { reason: 'cannot remove root' };
  if (name === 'move' && isProperPrefix(from, path)) return { reason: 'cannot move into own child' };
  return { op: name, path, from, value: NEEDS_VALUE.has(name) ? op.value : undefined };
}

export function applyPatch(doc, patch) {
  if (!Array.isArray(patch)) throw new PatchError('patch must be an array', null);
  const ops = [];
  for (let i = 0; i < patch.length; i++) { // an index loop, so a hole is seen as undefined
    const checked = checkForm(patch[i]);
    if (checked.reason !== undefined) throw new PatchError(`operation ${i}: ${checked.reason}`, i);
    ops.push(checked);
  }
  let result = deepCopy(doc);
  ops.forEach((op, i) => {
    const fail = (reason) => { throw new PatchError(`operation ${i}: ${reason}`, i); };
    result = applyOne(result, op, fail);
  });
  return result;
}
