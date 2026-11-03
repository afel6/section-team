import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../../jsonpatch.mjs';

export function expectPatchError(doc, patch, message, index) {
  assert.throws(() => applyPatch(doc, patch), (err) => {
    assert.ok(err instanceof PatchError);
    assert.strictEqual(err.name, 'PatchError');
    assert.strictEqual(err.message, message);
    assert.strictEqual(err.index, index);
    return true;
  });
}
