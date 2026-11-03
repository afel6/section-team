import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';

// Records structure, key order and values so changes are detectable.
function snapshot(value) {
  return { clone: structuredClone(value), order: orderOf(value) };
}

function orderOf(value) {
  if (Array.isArray(value)) return value.map(orderOf);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).map((k) => [k, orderOf(value[k])]);
  }
  return Object.is(value, -0) ? '-0' : value;
}

function assertUnchanged(value, snap) {
  assert.deepEqual(value, snap.clone);
  assert.deepEqual(orderOf(value), snap.order);
}

// Runs applyPatch and checks doc and patch are untouched whether or not it throws.
function applyChecked(doc, patch) {
  const d = snapshot(doc);
  const p = snapshot(patch);
  try {
    return applyPatch(doc, patch);
  } catch (err) {
    assert.ok(err instanceof PatchError);
    return err;
  } finally {
    assertUnchanged(doc, d);
    assertUnchanged(patch, p);
  }
}

function collect(value, set = new Set()) {
  if (value !== null && typeof value === 'object') {
    set.add(value);
    for (const k of Object.keys(value)) collect(value[k], set);
  }
  return set;
}

function assertNoSharing(result, doc, patch) {
  const mine = collect(result);
  const theirs = collect(patch, collect(doc));
  for (const obj of mine) assert.ok(!theirs.has(obj), 'result shares an object with doc or patch');
}

const OPS = {
  add: { op: 'add', path: '/a/-', value: { z: [1] } },
  remove: { op: 'remove', path: '/a/0' },
  replace: { op: 'replace', path: '/a', value: [{ q: 1 }] },
  move: { op: 'move', from: '/a/0', path: '/b' },
  copy: { op: 'copy', from: '/a', path: '/c' },
  test: { op: 'test', path: '/a/1', value: { k: 2 } },
};
const mkDoc = () => ({ b: 0, a: [{ k: 1 }, { k: 2 }], 2: 'x', 1: 'y' });

describe('doc and patch are never changed', () => {
  for (const [name, op] of Object.entries(OPS)) {
    test(`${name} succeeds without touching inputs`, () => {
      const result = applyChecked(mkDoc(), [op]);
      assert.ok(!(result instanceof Error));
    });
  }

  test('failing apply-time ops leave inputs untouched', () => {
    const bad = [
      { op: 'remove', path: '/nope' },
      { op: 'replace', path: '/nope', value: 1 },
      { op: 'move', from: '/nope', path: '/x' },
      { op: 'copy', from: '/nope', path: '/x' },
      { op: 'test', path: '/b', value: 99 },
      { op: 'add', path: '/nope/x', value: 1 },
    ];
    for (const op of bad) {
      const err = applyChecked(mkDoc(), [{ op: 'add', path: '/ok', value: [1] }, op]);
      assert.ok(err instanceof PatchError);
      assert.equal(err.index, 1);
    }
  });

  test('failure at a later index after earlier ops succeeded', () => {
    const doc = { a: [1, 2] };
    const patch = [
      { op: 'add', path: '/a/-', value: { z: 1 } },
      { op: 'remove', path: '/a/0' },
      { op: 'test', path: '/q', value: 1 },
    ];
    const err = applyChecked(doc, patch);
    assert.equal(err.message, 'operation 2: path not found');
    assert.deepEqual(doc, { a: [1, 2] });
  });

  test('form errors leave inputs untouched', () => {
    const patch = [{ op: 'add', path: '/x', value: 1 }, { op: 'bogus', path: '/y' }];
    const err = applyChecked(mkDoc(), patch);
    assert.equal(err.message, 'operation 1: bad op');
  });
});

describe('no shared references', () => {
  const cases = {
    'empty patch': [],
    'add object': [{ op: 'add', path: '/n', value: { x: [{ y: 1 }] } }],
    'replace array': [{ op: 'replace', path: '/a', value: [[1], { w: 2 }] }],
    copy: [{ op: 'copy', from: '/a', path: '/c' }],
    move: [{ op: 'move', from: '/a', path: '/m' }],
    test: [{ op: 'test', path: '/a', value: [{ k: 1 }, { k: 2 }] }],
  };
  for (const [name, patch] of Object.entries(cases)) {
    test(name, () => {
      const doc = mkDoc();
      const result = applyPatch(doc, patch);
      assert.notEqual(result, doc);
      assertNoSharing(result, doc, patch);
    });
  }

  test('empty patch returns a deep copy', () => {
    const doc = { a: [{ k: 1 }], o: { p: {} } };
    const result = applyPatch(doc, []);
    assert.deepEqual(result, doc);
    assert.notEqual(result.a, doc.a);
    assert.notEqual(result.a[0], doc.a[0]);
    assert.notEqual(result.o.p, doc.o.p);
  });

  test('mutating the result does not affect doc or patch', () => {
    const doc = { a: [1] };
    const patch = [{ op: 'add', path: '/b', value: [1, 2] }];
    const result = applyPatch(doc, patch);
    result.b.push(3);
    result.a.push(2);
    assert.deepEqual(patch[0].value, [1, 2]);
    assert.deepEqual(doc, { a: [1] });
    const again = applyPatch(doc, patch);
    assert.deepEqual(again.b, [1, 2]);
  });
});

describe('numbers are kept exactly', () => {
  const addVal = (value) => applyPatch({}, [{ op: 'add', path: '/v', value }]).v;

  test('-0 in copies', () => {
    assert.ok(Object.is(applyPatch({ a: -0 }, []).a, -0));
    assert.ok(Object.is(applyPatch(-0, []), -0));
  });

  test('-0 through each op', () => {
    assert.ok(Object.is(addVal(-0), -0));
    assert.ok(Object.is(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: -0 }]).a, -0));
    assert.ok(Object.is(addVal({ x: [-0] }).x[0], -0));
    assert.ok(Object.is(applyPatch({ a: -0 }, [{ op: 'copy', from: '/a', path: '/b' }]).b, -0));
    assert.ok(Object.is(applyPatch({ a: -0 }, [{ op: 'move', from: '/a', path: '/b' }]).b, -0));
  });

  test('other numbers', () => {
    for (const n of [1e308, 5e-324, 0.1, -1.5, Number.MAX_SAFE_INTEGER + 2]) {
      assert.ok(Object.is(addVal(n), n));
      assert.ok(Object.is(applyPatch({ a: n }, []).a, n));
    }
  });
});

describe('member order on copy', () => {
  test('top level and nested', () => {
    const doc = JSON.parse('{"b":1,"a":2,"2":3,"1":4}');
    assert.deepEqual(Object.keys(applyPatch(doc, [])), ['1', '2', 'b', 'a']);
    const nested = JSON.parse('{"o":{"z":1,"y":2,"10":3,"9":4}}');
    assert.deepEqual(Object.keys(applyPatch(nested, []).o), ['9', '10', 'z', 'y']);
  });

  test('own __proto__ is copied as own member in place', () => {
    const doc = JSON.parse('{"b":1,"__proto__":{"x":1},"a":2}');
    const result = applyPatch(doc, []);
    assert.deepEqual(Object.keys(result), ['b', '__proto__', 'a']);
    assert.ok(Object.hasOwn(result, '__proto__'));
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__').value, { x: 1 });
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.x, undefined);
  });

  test('own __proto__ in an added value', () => {
    const value = JSON.parse('{"__proto__":{"x":1}}');
    const result = applyPatch({}, [{ op: 'add', path: '/v', value }]);
    assert.equal(Object.getPrototypeOf(result.v), Object.prototype);
    assert.deepEqual(Object.keys(result.v), ['__proto__']);
  });
});

describe('deep documents', () => {
  const nest = (depth) => {
    let v = [];
    for (let i = 1; i < depth; i++) v = [v];
    return v;
  };

  test('1000-deep doc with empty patch', () => {
    const doc = nest(1000);
    const result = applyPatch(doc, []);
    assert.deepEqual(result, doc);
    assert.notEqual(result, doc);
  });

  test('1000-deep added value', () => {
    const value = nest(1000);
    const result = applyPatch({}, [{ op: 'add', path: '/v', value }]);
    assert.deepEqual(result.v, value);
    assert.notEqual(result.v, value);
  });
});

describe('only PatchError is thrown', () => {
  const badPatches = [
    undefined, null, 5, 'str', {}, { length: 0 }, () => [],
    [undefined], [null], [5], ['add'], [[]], [() => 1], [new Array(1)],
    [{}], [{ op: 'nope', path: '' }], [{ op: 'add' }], [{ op: 'add', path: 5, value: 1 }],
    [{ op: 'add', path: 'a', value: 1 }], [{ op: 'add', path: '/~2', value: 1 }],
    [{ op: 'add', path: '/a' }], [{ op: 'remove', path: '' }],
    [{ op: 'move', path: '/a' }], [{ op: 'copy', from: 'x', path: '/a' }],
    [{ op: 'move', from: '/a', path: '/a/b' }],
    [{ op: new String('add'), path: '', value: 1 }],
    [{ op: 'add', path: new String('/a'), value: 1 }],
    [{ op: 'remove', path: '/nope' }], [{ op: 'test', path: '', value: 'zz' }],
  ];

  badPatches.forEach((patch, i) => {
    test(`bad patch #${i}`, () => {
      assert.throws(
        () => applyPatch({ a: 1 }, patch),
        (err) => {
          assert.ok(err instanceof PatchError, String(err));
          return true;
        },
      );
    });
  });
});
