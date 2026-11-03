// Integrity: deep copies, no sharing, no mutation of inputs, deep values, error types.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';
import { assertExact, assertNoSharing, assertPatchError, j } from './helpers.mjs';

function deepFreeze(value) {
  const stack = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    Object.freeze(current);
    for (const key of Reflect.ownKeys(current)) stack.push(current[key]);
  }
  return value;
}

// Builds [[[...]]] with `depth` nested arrays around an empty array core.
function nested(depth) {
  let value = [];
  for (let i = 1; i < depth; i++) value = [value];
  return value;
}

describe('an empty patch returns a deep copy', () => {
  const docs = [
    ['{}', {}],
    ['[]', []],
    ['5', 5],
    ['null', null],
    ['a string', 'x'],
    ['{a:-0}', { a: -0 }],
    ['[-0]', [-0]],
    ['nested objects', { a: { b: { c: [1, { d: null }] } }, e: [[], {}] }],
    ['own __proto__ member', j('{"__proto__":{"x":1},"b":2}')],
    ['member order {"b":1,"a":2}', { b: 1, a: 2 }],
    ['index names {"2":1,"1":0,"z":3}', j('{"2":1,"1":0,"z":3}')],
  ];
  for (const [name, doc] of docs) {
    test(`doc ${name}`, () => {
      const patch = [];
      const result = applyPatch(doc, patch);
      assertExact(result, doc);
      if (doc !== null && typeof doc === 'object') assert.notEqual(result, doc);
      assertNoSharing(result, doc, patch);
    });
  }

  test('-0 stays -0', () => {
    assert.ok(Object.is(applyPatch(-0, []), -0));
  });

  test('{a:-0} keeps -0 in a', () => {
    assert.ok(Object.is(applyPatch({ a: -0 }, []).a, -0));
  });

  test('own __proto__ stays own with Object.prototype as prototype', () => {
    const result = applyPatch(j('{"__proto__":{"x":1},"b":2}'), []);
    assert.ok(Object.hasOwn(result, '__proto__'));
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.deepEqual(Object.keys(result), ['__proto__', 'b']);
    assert.equal(result.x, undefined);
  });

  test('member order {"b":1,"a":2} is kept', () => {
    assert.deepEqual(Object.keys(applyPatch({ b: 1, a: 2 }, [])), ['b', 'a']);
  });

  test('index names come first {"2":1,"1":0,"z":3}', () => {
    assert.deepEqual(Object.keys(applyPatch(j('{"2":1,"1":0,"z":3}'), [])), ['1', '2', 'z']);
  });
});

describe('values put into the result are copies', () => {
  test('add: value shares nothing with the patch and keeps -0', () => {
    const doc = { x: 1 };
    const patch = [{ op: 'add', path: '/a', value: -0 }];
    const result = applyPatch(doc, patch);
    assert.ok(Object.is(result.a, -0));
    assertNoSharing(result, doc, patch);
  });

  test('add: a container value is copied', () => {
    const doc = {};
    const patch = [{ op: 'add', path: '/a', value: { k: [1, { z: 2 }] } }];
    const result = applyPatch(doc, patch);
    assertExact(result, { a: { k: [1, { z: 2 }] } });
    assertNoSharing(result, doc, patch);
    assert.notEqual(result.a, patch[0].value);
  });

  test('replace with [-0] keeps -0 and shares nothing', () => {
    const doc = { a: 1 };
    const patch = [{ op: 'replace', path: '/a', value: [-0] }];
    const result = applyPatch(doc, patch);
    assertExact(result, { a: [-0] });
    assertNoSharing(result, doc, patch);
  });

  test('replace of the whole doc copies the value', () => {
    const patch = [{ op: 'replace', path: '', value: { a: [1] } }];
    const result = applyPatch({}, patch);
    assertExact(result, { a: [1] });
    assertNoSharing(result, patch);
  });

  test('add of the whole doc copies the value', () => {
    const patch = [{ op: 'add', path: '', value: [{ a: 1 }] }];
    const result = applyPatch(null, patch);
    assertExact(result, [{ a: 1 }]);
    assertNoSharing(result, patch);
  });

  test('value {a:-0,b:[-0]} keeps every -0', () => {
    const patch = [{ op: 'add', path: '/v', value: { a: -0, b: [-0] } }];
    const result = applyPatch({}, patch);
    assertExact(result, { v: { a: -0, b: [-0] } });
    assertNoSharing(result, patch);
  });

  test('value member order {z:1,a:2} is preserved', () => {
    const patch = [{ op: 'add', path: '/v', value: { z: 1, a: 2 } }];
    assert.deepEqual(Object.keys(applyPatch({}, patch).v), ['z', 'a']);
  });

  test('value {"__proto__":[1]} stays an own member', () => {
    const patch = [{ op: 'add', path: '/v', value: j('{"__proto__":[1]}') }];
    const result = applyPatch({}, patch);
    assert.ok(Object.hasOwn(result.v, '__proto__'));
    assert.equal(Object.getPrototypeOf(result.v), Object.prototype);
    assertExact(result.v, j('{"__proto__":[1]}'));
  });

  test('copy: the copied value shares nothing with the doc', () => {
    const doc = { a: { b: [-0] } };
    const patch = [{ op: 'copy', from: '/a', path: '/c' }];
    const result = applyPatch(doc, patch);
    assertExact(result, { a: { b: [-0] }, c: { b: [-0] } });
    assertNoSharing(result, doc, patch);
  });

  test('the same patch applied twice gives independent results', () => {
    const patch = [{ op: 'add', path: '/a', value: { k: 1 } }];
    const first = applyPatch({}, patch);
    const second = applyPatch({}, patch);
    assert.notEqual(first.a, second.a);
  });
});

describe('doc and patch are never mutated', () => {
  const makeDoc = () => j('{"a":{"x":[1,2,3]},"b":[0,{"k":-0}],"c":"s","d":null,"__proto__":{"p":1}}');
  const cases = [
    [
      'a successful multi-op patch',
      [
        { op: 'add', path: '/n', value: { v: [1] } },
        { op: 'remove', path: '/c' },
        { op: 'replace', path: '/d', value: [true] },
        { op: 'move', from: '/a/x', path: '/m' },
        { op: 'copy', from: '/b', path: '/b2' },
        { op: 'test', path: '/b2/1/k', value: 0 },
        { op: 'add', path: '/b/-', value: 9 },
      ],
      true,
    ],
    [
      'a patch failing at its last op after earlier ops changed things',
      [{ op: 'remove', path: '/a' }, { op: 'add', path: '/z', value: 1 }, { op: 'test', path: '/z', value: 2 }],
      false,
    ],
    ['a patch failing the form check', [{ op: 'remove', path: '/a' }, { op: 'add', path: '/z' }], false],
    ['a failing move', [{ op: 'remove', path: '/c' }, { op: 'move', from: '/a/x', path: '/q/r' }], false],
    ['a failing copy', [{ op: 'add', path: '/k', value: 1 }, { op: 'copy', from: '/nope', path: '/q' }], false],
    ['a failing array insert', [{ op: 'remove', path: '/d' }, { op: 'add', path: '/b/5', value: 1 }], false],
    ['a patch that is not an array', { op: 'remove', path: '/a' }, false],
  ];

  for (const [name, patch, succeeds] of cases) {
    test(`${name}: doc and patch are unchanged`, () => {
      const doc = makeDoc();
      const docSnapshot = structuredClone(doc);
      const patchSnapshot = structuredClone(patch);
      if (succeeds) applyPatch(doc, patch);
      else assert.throws(() => applyPatch(doc, patch), PatchError);
      assertExact(doc, docSnapshot);
      assertExact(patch, patchSnapshot);
      assert.ok(Object.hasOwn(doc, '__proto__'));
    });

    if (succeeds) {
      test(`${name}: works on deeply frozen doc and patch`, () => {
        const doc = deepFreeze(makeDoc());
        const frozenPatch = deepFreeze(structuredClone(patch));
        const expected = applyPatch(makeDoc(), patch);
        const result = applyPatch(doc, frozenPatch);
        assertExact(result, expected);
        assert.ok(!Object.isFrozen(result));
      });
    } else {
      test(`${name}: throws a PatchError (not a TypeError) on frozen inputs`, () => {
        const doc = deepFreeze(makeDoc());
        const frozenPatch = deepFreeze(structuredClone(patch));
        assert.throws(() => applyPatch(doc, frozenPatch), PatchError);
      });
    }
  }

  test('frozen doc with an empty patch returns a copy', () => {
    const doc = deepFreeze(makeDoc());
    assertExact(applyPatch(doc, []), makeDoc());
  });

  test('the result of a successful patch can be mutated without touching the inputs', () => {
    const doc = { a: [1] };
    const patch = [{ op: 'add', path: '/b', value: { c: 1 } }];
    const result = applyPatch(doc, patch);
    result.a.push(2);
    result.b.c = 2;
    assertExact(doc, { a: [1] });
    assertExact(patch[0].value, { c: 1 });
  });
});

describe('deep values', () => {
  test('a 1000-deep doc with an empty patch returns a copy', () => {
    const doc = nested(1000);
    const result = applyPatch(doc, []);
    assertExact(result, nested(1000));
    assert.notEqual(result, doc);
    assertNoSharing(result, doc);
  });

  test('a 1000-deep doc passes a test against a separately built equal value', () => {
    const doc = nested(1000);
    const patch = [{ op: 'test', path: '', value: nested(1000) }];
    const result = applyPatch(doc, patch);
    assertExact(result, nested(1000));
    assertNoSharing(result, doc, patch);
  });

  test('a 1000-deep doc fails a test against a different deep value', () => {
    const other = nested(1000);
    let inner = other;
    while (inner.length > 0) inner = inner[0];
    inner.push(1);
    assertPatchError(nested(1000), [{ op: 'test', path: '', value: other }], 'operation 0: test failed', 0);
  });

  test('a 1000-deep value can be added at /a', () => {
    const patch = [{ op: 'add', path: '/a', value: nested(1000) }];
    const result = applyPatch({}, patch);
    assertExact(result, { a: nested(1000) });
    assertNoSharing(result, patch);
  });

  test('a 1000-deep object chain is copied', () => {
    let doc = {};
    for (let i = 1; i < 1000; i++) doc = { k: doc };
    const result = applyPatch(doc, []);
    assertExact(result, doc);
    assertNoSharing(result, doc);
  });
});

describe('applyPatch throws nothing but PatchError', () => {
  const samples = [
    ['a non-array patch', {}, 'x', 'patch must be an array', null],
    ['a null patch', {}, null, 'patch must be an array', null],
    ['a bad op', {}, [{ op: 'nope', path: '' }], 'operation 0: bad op', 0],
    ['a null operation', {}, [null], 'operation 0: not an object', 0],
    ['a hole', {}, new Array(1), 'operation 0: not an object', 0],
    ['a non-string path', {}, [{ op: 'remove', path: 5 }], 'operation 0: bad path', 0],
    ['a String object path', {}, [{ op: 'remove', path: new String('/a') }], 'operation 0: bad path', 0],
    ['an invalid pointer', {}, [{ op: 'remove', path: '/~2' }], 'operation 0: bad path', 0],
    ['a missing member', {}, [{ op: 'remove', path: '/a' }], 'operation 0: path not found', 0],
    ['a failed test', 1, [{ op: 'test', path: '', value: 2 }], 'operation 0: test failed', 0],
    [
      'a move into own child',
      { a: {} },
      [{ op: 'move', from: '/a', path: '/a/b' }],
      'operation 0: cannot move into own child',
      0,
    ],
    ['a null doc followed through', null, [{ op: 'remove', path: '/a/b' }], 'operation 0: path not found', 0],
  ];
  for (const [name, doc, patch, message, index] of samples) {
    test(name, () => assertPatchError(doc, patch, message, index));
  }
});
