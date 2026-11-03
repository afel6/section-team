import assert from 'node:assert/strict';
import { PatchError } from '../../jsonpatch.mjs';

export function expectPatchError(fn, message, index) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof PatchError, 'instanceof PatchError');
    assert.ok(err instanceof Error, 'instanceof Error');
    assert.equal(err.name, 'PatchError');
    assert.equal(err.message, message);
    assert.equal(err.index, index);
    return true;
  });
}
