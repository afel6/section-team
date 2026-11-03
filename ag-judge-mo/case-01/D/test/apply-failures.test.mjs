// Failures while applying valid operations.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';
import { assertPatchError } from './helpers.mjs';

const J = JSON.parse;
const add = (path, value) => ({ op: 'add', path, value });
const tst = (path, value) => ({ op: 'test', path, value });
const fails = (doc, patch, reason, index = 0) =>
  assertPatchError(() => applyPatch(doc, patch), `operation ${index}: ${reason}`, index);

describe('first token naming nothing stops the operation', () => {
  // [description, doc, path, reason]
  const cases = [
    ['through a primitive', { a: 1 }, '/a/b/c', 'path not found'],
    ['through null', { a: null }, '/a/b', 'path not found'],
    ['through a boolean', { a: true }, '/a/b', 'path not found'],
    ['bad index on nested array', { a: [1] }, '/a/x/y', 'bad index'],
    ['empty token on nested array', { a: [1] }, '/a//y', 'bad index'],
    ['leading zero on nested array', { a: [1] }, '/a/01', 'bad index'],
    ['missing index on nested array', { a: [1] }, '/a/5/x', 'path not found'],
    ['dash in the middle', { a: [1] }, '/a/-/x', 'path not found'],
    ['token on a string document', 'abc', '/0', 'path not found'],
    ['length on a string member', { a: 'abc' }, '/a/length', 'path not found'],
    ['token on a number document', 5, '/0', 'path not found'],
    ['token on a null document', null, '/a', 'path not found'],
    ['missing member then more tokens', {}, '/a/b/c', 'path not found'],
    ['bad index before a missing one', [[1]], '/x/5', 'bad index'],
  ];
  for (const [name, doc, path, reason] of cases) {
    test(`test ${name}: ${reason}`, () => {
      fails(doc, [tst(path, 1)], reason);
    });
    test(`remove ${name}: ${reason}`, () => {
      fails(doc, [{ op: 'remove', path }], reason);
    });
    test(`replace ${name}: ${reason}`, () => {
      fails(doc, [{ op: 'replace', path, value: 1 }], reason);
    });
  }
  test('deep array path works when everything exists', () => {
    assert.deepStrictEqual(applyPatch([[[1]]], [tst('/0/0/0', 1)]), [[[1]]]);
  });
});

describe('add parent rules', () => {
  test('primitive parent is path not found', () => {
    fails({ a: 1 }, [add('/a/b', 1)], 'path not found');
    fails('abc', [add('/0', 1)], 'path not found');
    fails(null, [add('/a', 1)], 'path not found');
  });
  test('array index greater than length is path not found', () => {
    fails([1], [add('/2', 0)], 'path not found');
    fails({ a: [] }, [add('/a/1', 0)], 'path not found');
  });
  for (const tok of ['01', 'x', '', '+1', '1.0', '-1']) {
    test(`array parent with token ${JSON.stringify(tok)} is bad index`, () => {
      fails({ a: [1] }, [add(`/a/${tok}`, 0)], 'bad index');
    });
  }
  test('missing parent is path not found', () => {
    fails({}, [add('/a/b', 1)], 'path not found');
  });
  test('bad index while following the parent is bad index', () => {
    fails({ a: [1] }, [add('/a/x/y', 1)], 'bad index');
  });
});

describe('copy and move wording', () => {
  for (const name of ['copy', 'move']) {
    test(`${name}: missing from is from not found`, () => {
      fails({}, [{ op: name, from: '/a', path: '/b' }], 'from not found');
    });
    test(`${name}: from of /- on an array is from not found`, () => {
      fails({ a: [1] }, [{ op: name, from: '/a/-', path: '/b' }], 'from not found');
    });
    test(`${name}: from index equal to length is from not found`, () => {
      fails({ a: [1] }, [{ op: name, from: '/a/1', path: '/b' }], 'from not found');
    });
    test(`${name}: from through a primitive is from not found`, () => {
      fails({ a: 1 }, [{ op: name, from: '/a/b', path: '/c' }], 'from not found');
    });
    test(`${name}: bad index in from on an array`, () => {
      fails([1], [{ op: name, from: '/x', path: '/0' }], 'bad index');
    });
    test(`${name}: missing parent of path is path not found`, () => {
      fails({ a: 1 }, [{ op: name, from: '/a', path: '/x/y' }], 'path not found');
    });
    test(`${name}: bad index in path is bad index`, () => {
      fails({ a: 1, b: [] }, [{ op: name, from: '/a', path: '/b/01' }], 'bad index');
    });
    test(`${name}: path index beyond length is path not found`, () => {
      fails({ a: 1, b: [] }, [{ op: name, from: '/a', path: '/b/2' }], 'path not found');
    });
    test(`${name}: from is reported when both from and path fail`, () => {
      fails({}, [{ op: name, from: '/a', path: '/x/y' }], 'from not found');
    });
  }
});

describe('test failed and indexes', () => {
  test('third operation failing reports operation 2 with numeric index', () => {
    const patch = [add('/a', 1), add('/b', 2), tst('/a', 2)];
    assertPatchError(() => applyPatch({}, patch), 'operation 2: test failed', 2);
  });
  test('index 10 is written in full', () => {
    const patch = Array.from({ length: 10 }, (_, i) => add(`/k${i}`, i));
    patch.push(tst('/k0', 99));
    fails({}, patch, 'test failed', 10);
  });
  test('index 10 with path not found', () => {
    const patch = Array.from({ length: 10 }, () => tst('', {}));
    patch.push({ op: 'remove', path: '/zz' });
    fails({}, patch, 'path not found', 10);
  });
});

describe('failing op stops and leaves nothing behind', () => {
  test('doc and patch are unchanged when an op fails', () => {
    const doc = J('{"b":[1,2],"a":{"z":1}}');
    const patch = [add('/c', { q: 1 }), { op: 'move', from: '/b/0', path: '/a/x' }, tst('/c/q', 2), add('/never', 1)];
    const docSnap = structuredClone(doc);
    const patchSnap = structuredClone(patch);
    assertPatchError(() => applyPatch(doc, patch), 'operation 2: test failed', 2);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
    assert.deepEqual(Object.keys(doc), ['b', 'a']);
  });
  test('operations after the failing one are not looked at', () => {
    // The later add would succeed; the earlier remove fails first.
    fails({}, [{ op: 'remove', path: '/a' }, add('/a', 1)], 'path not found', 0);
  });
  test('a failing first op takes precedence over a later test failure', () => {
    fails({}, [tst('/a', 1), tst('', 5)], 'path not found', 0);
  });
  test('earlier operations are visible to later ones before the failure', () => {
    fails({}, [add('/a', 1), tst('/a', 1), tst('/a', 2)], 'test failed', 2);
  });
});

describe('only PatchError escapes', () => {
  const sym = Symbol('s');
  test('thrown errors are PatchError instances', () => {
    assert.throws(
      () => applyPatch({}, [tst('/a', 1)]),
      (e) => e instanceof PatchError && e instanceof Error && e.name === 'PatchError',
    );
  });
  test('extra members of odd types are ignored', () => {
    const o = { op: 'add', path: '/a', value: 1, [sym]: 1, from: 5, extra: () => 1, other: new Date(0), n: NaN };
    assert.deepStrictEqual(applyPatch({}, [o]), { a: 1 });
  });
  test('remove with odd value member is fine', () => {
    assert.deepStrictEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', value: undefined, from: Symbol('x') }]), {});
  });
  test('operation being a String object with no op fails as bad op', () => {
    fails({}, [new String('x')], 'bad op');
  });
  test('non-enumerable own members count', () => {
    const o = { op: 'test', path: '' };
    Object.defineProperty(o, 'value', { value: 1, enumerable: false });
    assert.equal(applyPatch(1, [o]), 1);
  });
  test('inherited members never count', () => {
    const o = Object.create({ op: 'add', path: '/a', value: 1 });
    fails({}, [o], 'bad op');
  });
  test('deep tokens of odd but legal pointers do not throw other errors', () => {
    const doc = { '': { '': [0] }, '~': { '/': 1 } };
    assert.deepStrictEqual(applyPatch(doc, [tst('//', [0]), tst('/~0/~1', 1), tst('///0', 0)]), doc);
  });
});
