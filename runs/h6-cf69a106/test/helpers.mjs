import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';

export function expectPatchError(fn, message, index) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof PatchError, 'instanceof PatchError');
    assert.ok(err instanceof Error, 'instanceof Error');
    assert.strictEqual(err.name, 'PatchError');
    assert.strictEqual(err.message, message);
    assert.strictEqual(err.index, index);
    return true;
  });
}

export function expectOpError(doc, op, reason, index = 0) {
  expectPatchError(() => applyPatch(doc, [op]), `operation ${index}: ${reason}`, index);
}

export function expectPatchFail(doc, patch, reason, index) {
  expectPatchError(() => applyPatch(doc, patch), `operation ${index}: ${reason}`, index);
}

export function one(doc, op) {
  return applyPatch(doc, [op]);
}

export function deepFreeze(value) {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  }
  return value;
}

export function nest(depth) {
  let value = [];
  for (let i = 1; i < depth; i++) value = [value];
  return value;
}

export function depthOf(value) {
  let depth = 0;
  let cur = value;
  while (Array.isArray(cur)) {
    depth++;
    cur = cur[0];
  }
  return depth;
}

export function assertNoSharedArrays(a, b) {
  let x = a;
  let y = b;
  while (Array.isArray(x)) {
    assert.notStrictEqual(x, y);
    x = x[0];
    y = y[0];
  }
}
