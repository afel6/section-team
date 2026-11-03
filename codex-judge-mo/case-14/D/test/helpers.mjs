import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';

export function expectPatchError(doc, patch, message, index) {
  let thrown;
  try {
    applyPatch(doc, patch);
  } catch (err) {
    thrown = err;
  }
  assert.notStrictEqual(thrown, undefined, 'expected applyPatch to throw');
  assert.ok(thrown instanceof PatchError, 'instanceof PatchError');
  assert.ok(thrown instanceof Error, 'instanceof Error');
  assert.strictEqual(thrown.name, 'PatchError');
  assert.strictEqual(thrown.message, message);
  assert.strictEqual(thrown.index, index);
}

export function expectOpError(doc, op, reason) {
  expectPatchError(doc, [op], `operation 0: ${reason}`, 0);
}

export function deepClone(v) {
  if (Array.isArray(v)) return v.map(deepClone);
  if (v !== null && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      Object.defineProperty(out, k, {
        value: deepClone(v[k]),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    return out;
  }
  return v;
}

export function collectObjects(v, set = new Set()) {
  if (v !== null && typeof v === 'object' && !set.has(v)) {
    set.add(v);
    for (const k of Object.keys(v)) collectObjects(v[k], set);
  }
  return set;
}
