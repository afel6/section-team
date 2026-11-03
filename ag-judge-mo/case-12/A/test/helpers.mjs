// Shared assertions for the jsonpatch tests (exports only, no tests).
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';

// Deep equality that also checks member order, prototypes and -0 (Object.is).
export function assertExact(actual, expected, where = '$') {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${where}: expected an array`);
    assert.equal(actual.length, expected.length, `${where}: length`);
    expected.forEach((item, i) => assertExact(actual[i], item, `${where}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === 'object') {
    assert.ok(
      actual !== null && typeof actual === 'object' && !Array.isArray(actual),
      `${where}: expected an object`,
    );
    assert.equal(Object.getPrototypeOf(actual), Object.prototype, `${where}: prototype`);
    assert.deepEqual(Object.keys(actual), Object.keys(expected), `${where}: member names/order`);
    for (const key of Object.keys(expected)) {
      assert.ok(Object.hasOwn(actual, key), `${where}: own member ${key}`);
      assertExact(actual[key], expected[key], `${where}.${key}`);
    }
    return;
  }
  assert.ok(Object.is(actual, expected), `${where}: ${String(actual)} is not ${String(expected)}`);
}

// Asserts applyPatch(doc, patch) throws a PatchError with exactly this message and index.
export function assertPatchError(doc, patch, message, index) {
  let caught;
  try {
    applyPatch(doc, patch);
  } catch (err) {
    caught = err;
  }
  assert.ok(caught !== undefined, `expected PatchError "${message}", nothing was thrown`);
  assert.ok(caught instanceof PatchError, `expected PatchError, got ${caught && caught.name}: ${caught && caught.message}`);
  assert.ok(caught instanceof Error);
  assert.equal(caught.name, 'PatchError');
  assert.equal(caught.message, message);
  assert.ok(Object.is(caught.index, index), `index ${String(caught.index)} is not ${String(index)}`);
}

// Parses JSON text so names such as "__proto__" become own members, as JSON.parse does.
export const j = (text) => JSON.parse(text);

// Collects every object and array reachable from a value.
export function containers(value, found = new Set()) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || found.has(current)) continue;
    found.add(current);
    for (const key of Reflect.ownKeys(current)) stack.push(current[key]);
  }
  return found;
}

// Asserts that no object or array of `result` is also reachable from any of `sources`.
export function assertNoSharing(result, ...sources) {
  const seen = new Set();
  for (const source of sources) containers(source, seen);
  for (const item of containers(result)) assert.ok(!seen.has(item), 'result shares an object with its inputs');
}
