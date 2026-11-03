// Behaviour of each patch operation: add, remove, replace, move, copy, test.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { assertExact, assertNoSharing, assertPatchError, j } from './helpers.mjs';

const add = (path, value) => ({ op: 'add', path, value });
const remove = (path) => ({ op: 'remove', path });
const replace = (path, value) => ({ op: 'replace', path, value });
const move = (from, path) => ({ op: 'move', from, path });
const copy = (from, path) => ({ op: 'copy', from, path });
const check = (path, value) => ({ op: 'test', path, value });

// Tokens that are a bad index when they follow an array (the empty token is path "/arr/").
const BAD_INDEX_TOKENS = ['01', '+1', '1.0', '1e0', ' 1', '1 ', '-1', 'length', '0x1', ''];
const HUGE_INDEX = '99999999999999999999';

// Table driver: each row is [name, doc, patch, expected result].
function runTable(rows) {
  for (const [name, doc, patch, expected] of rows) {
    test(name, () => assertExact(applyPatch(doc, patch), expected));
  }
}

// Table driver: each row is [name, doc, patch, message, index].
function failTable(rows) {
  for (const [name, doc, patch, message, index = 0] of rows) {
    test(name, () => assertPatchError(doc, patch, message, index));
  }
}

describe('add', () => {
  describe('whole document and member order', () => {
    runTable([
      ['path "" replaces the whole doc with an object', { a: 1 }, [add('', { z: 1 })], { z: 1 }],
      ['path "" replaces the whole doc with 5', { a: 1 }, [add('', 5)], 5],
      ['path "" replaces the whole doc with null', { a: 1 }, [add('', null)], null],
      ['a new member goes last', { a: 1 }, [add('/b', 2)], { a: 1, b: 2 }],
      ['an existing member keeps its place', { a: 1, b: 2 }, [add('/a', 3)], { a: 3, b: 2 }],
    ]);

    test('an existing member keeps its place (keys)', () => {
      const result = applyPatch({ a: 1, b: 2 }, [add('/a', 3)]);
      assert.deepEqual(Object.keys(result), ['a', 'b']);
      assert.equal(result.a, 3);
    });

    test('an index name sorts before other names', () => {
      const result = applyPatch({ b: 0 }, [add('/1', 5)]);
      assert.deepEqual(Object.keys(result), ['1', 'b']);
    });

    test('index names sort ascending numerically, before other names', () => {
      const result = applyPatch({ b: 0, x: 1 }, [add('/10', 1), add('/2', 2)]);
      assert.deepEqual(Object.keys(result), ['2', '10', 'b', 'x']);
    });

    test('"4294967295" is not an index name, so it goes last', () => {
      const result = applyPatch({ b: 0 }, [add('/4294967295', 1)]);
      assert.deepEqual(Object.keys(result), ['b', '4294967295']);
    });
  });

  describe('arrays', () => {
    runTable([
      ['"-" appends', [1, 2, 3], [add('/-', 4)], [1, 2, 3, 4]],
      ['index 0 inserts at the start', [1, 2, 3], [add('/0', 0)], [0, 1, 2, 3]],
      ['index in the middle shifts later elements up', [1, 2, 3], [add('/1', 9)], [1, 9, 2, 3]],
      ['index equal to the length appends', [1, 2, 3], [add('/3', 4)], [1, 2, 3, 4]],
      ['index 0 on an empty array works', [], [add('/0', 'x')], ['x']],
    ]);

    failTable([
      ['index above the length is path not found', [1, 2, 3], [add('/4', 0)], 'operation 0: path not found'],
      ['huge index is path not found', [1], [add('/99999999999999999999', 0)], 'operation 0: path not found'],
      ...BAD_INDEX_TOKENS.map((token) => [
        `token ${JSON.stringify(token)} is a bad index`,
        { arr: [1, 2] },
        [add(`/arr/${token}`, 0)],
        'operation 0: bad index',
      ]),
    ]);
  });

  describe('parents', () => {
    failTable([
      ['a string parent is path not found', { s: 'x' }, [add('/s/0', 1)], 'operation 0: path not found'],
      ['a number parent is path not found', { s: 5 }, [add('/s/a', 1)], 'operation 0: path not found'],
      ['a null parent is path not found', { s: null }, [add('/s/a', 1)], 'operation 0: path not found'],
      ['a boolean parent is path not found', { s: true }, [add('/s/a', 1)], 'operation 0: path not found'],
      ['a missing parent is path not found', {}, [add('/x/y', 1)], 'operation 0: path not found'],
      ['a bad index in the parent path is bad index', { a: [1] }, [add('/a/01/x', 1)], 'operation 0: bad index'],
      ['"-" in the parent path is path not found', { a: [{}] }, [add('/a/-/x', 1)], 'operation 0: path not found'],
    ]);
  });

  describe('special member names', () => {
    // "-" and "" are ordinary member names on objects; only arrays give them meaning.
    runTable([
      ['"-" on an object is a member name', {}, [add('/-', 1)], { '-': 1 }],
      ['"" on an object is a member name', {}, [add('/', 1)], { '': 1 }],
      ['remove "/-" on an object removes that member', { '-': 1, a: 2 }, [remove('/-')], { a: 2 }],
      ['test and replace "/" on an object use the "" member', { '': 1 }, [check('/', 1), replace('/', 2)], { '': 2 }],
      ['move from "/-" on an object', { '-': 1 }, [move('/-', '/x')], { x: 1 }],
    ]);

    test('/__proto__ becomes an own member, not the prototype', () => {
      const result = applyPatch({}, [add('/__proto__', { x: 1 })]);
      assert.ok(Object.hasOwn(result, '__proto__'));
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.x, undefined);
      assert.deepEqual(Object.keys(result), ['__proto__']);
    });

    test('/constructor creates an own member', () => {
      const result = applyPatch({}, [add('/constructor', 1)]);
      assert.deepEqual(Object.keys(result), ['constructor']);
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
    });

    test('/toString creates an own member', () => {
      const result = applyPatch({}, [add('/toString', 1)]);
      assert.deepEqual(Object.keys(result), ['toString']);
      assert.equal(result.toString, 1);
    });
  });
});

describe('remove', () => {
  runTable([
    ['removes an object member', { a: 1, b: 2 }, [remove('/a')], { b: 2 }],
    ['removes an array element and shifts later ones down', { arr: [1, 2, 3] }, [remove('/arr/0')], { arr: [2, 3] }],
    ['removes the last array element', [1, 2, 3], [remove('/2')], [1, 2]],
    ['removes an own "__proto__" member', j('{"__proto__":1,"a":2}'), [remove('/__proto__')], { a: 2 }],
    ['an index-like token on an object is an ordinary name', { a: { '01': 1 } }, [remove('/a/01')], { a: {} }],
  ]);

  test('removing own "__proto__" leaves keys ["a"]', () => {
    const result = applyPatch(j('{"__proto__":1,"a":2}'), [remove('/__proto__')]);
    assert.deepEqual(Object.keys(result), ['a']);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
  });

  failTable([
    ['index equal to the length is path not found', { arr: [1, 2, 3] }, [remove('/arr/3')], 'operation 0: path not found'],
    ['"-" is path not found', { arr: [1] }, [remove('/arr/-')], 'operation 0: path not found'],
    ['leading zero is bad index', { arr: [1, 2] }, [remove('/arr/01')], 'operation 0: bad index'],
    ['"length" is bad index', { arr: [1, 2] }, [remove('/arr/length')], 'operation 0: bad index'],
    ['huge index is path not found', { arr: [1] }, [remove('/arr/99999999999999999999')], 'operation 0: path not found'],
    ['inherited toString is path not found', {}, [remove('/toString')], 'operation 0: path not found'],
    ['inherited constructor is path not found', {}, [remove('/constructor')], 'operation 0: path not found'],
    ['inherited __proto__ is path not found', {}, [remove('/__proto__')], 'operation 0: path not found'],
    ['inherited hasOwnProperty is path not found', {}, [remove('/hasOwnProperty')], 'operation 0: path not found'],
    ['a missing intermediate is path not found', { a: {} }, [remove('/a/b/c')], 'operation 0: path not found'],
    ['going through a string is path not found', { s: 'abc' }, [remove('/s/0')], 'operation 0: path not found'],
    ['a missing member is path not found', { a: 1 }, [remove('/b')], 'operation 0: path not found'],
  ]);
});

describe('replace', () => {
  runTable([
    ['path "" replaces the doc', { a: 1 }, [replace('', [1])], [1]],
    ['a member keeps its place', { a: 1, b: 2, c: 3 }, [replace('/b', 9)], { a: 1, b: 9, c: 3 }],
    ['replaces an array element', { arr: [1, 2, 3] }, [replace('/arr/1', 'x')], { arr: [1, 'x', 3] }],
    ['replaces the last array element', [1, 2], [replace('/1', 0)], [1, 0]],
  ]);

  test('a replaced member keeps its place (keys)', () => {
    const result = applyPatch({ a: 1, b: 2, c: 3 }, [replace('/b', 9)]);
    assert.deepEqual(Object.keys(result), ['a', 'b', 'c']);
  });

  failTable([
    ['index equal to the length is path not found', { arr: [1, 2, 3] }, [replace('/arr/3', 0)], 'operation 0: path not found'],
    ['"-" is path not found', { arr: [1] }, [replace('/arr/-', 0)], 'operation 0: path not found'],
    ['a missing member is path not found', { a: 1 }, [replace('/b', 0)], 'operation 0: path not found'],
    ['inherited toString is path not found', {}, [replace('/toString', 0)], 'operation 0: path not found'],
    ['a bad index token is bad index', { arr: [1] }, [replace('/arr/01', 0)], 'operation 0: bad index'],
    ['a missing parent is path not found', {}, [replace('/a/b', 0)], 'operation 0: path not found'],
  ]);
});

describe('move', () => {
  runTable([
    ['object to object', { a: 1, b: 2 }, [move('/a', '/c')], { b: 2, c: 1 }],
    ['index counts after removal: /0 to /2', [1, 2, 3], [move('/0', '/2')], [2, 3, 1]],
    ['/2 to /0', [1, 2, 3], [move('/2', '/0')], [3, 1, 2]],
    ['same path keeps member order', { a: 1, b: 2 }, [move('/a', '/a')], { a: 1, b: 2 }],
    ['child to parent works', { a: { b: 1 } }, [move('/a/b', '/a')], { a: 1 }],
    ['between arrays', { x: [1, 2], y: [3] }, [move('/x/0', '/y/-')], { x: [2], y: [3, 1] }],
    ['keeps -0 in a moved value', { a: { x: -0, y: [-0] } }, [move('/a', '/b')], { b: { x: -0, y: [-0] } }],
    ['move to an existing member replaces it', { a: 1, b: 2 }, [move('/a', '/b')], { b: 1 }],
    ['same path on an existing array element is a no-op', { arr: [1, 2] }, [move('/arr/1', '/arr/1')], { arr: [1, 2] }],
  ]);

  test('same path keeps keys a,b', () => {
    const result = applyPatch({ a: 1, b: 2 }, [move('/a', '/a')]);
    assert.deepEqual(Object.keys(result), ['a', 'b']);
  });

  test('the moved value is not shared with the doc', () => {
    const doc = { a: { x: [1] }, b: {} };
    const result = applyPatch(doc, [move('/a', '/b/c')]);
    assertExact(result, { b: { c: { x: [1] } } });
    assertNoSharing(result, doc);
  });

  failTable([
    ['index past the length after removal is path not found', [1, 2, 3], [move('/0', '/3')], 'operation 0: path not found'],
    ['same path but missing is from not found', {}, [move('/x', '/x')], 'operation 0: from not found'],
    ['same path array index out of range is from not found', { arr: [1] }, [move('/arr/5', '/arr/5')], 'operation 0: from not found'],
    ['same path with leading zero is bad index', { arr: [1] }, [move('/arr/01', '/arr/01')], 'operation 0: bad index'],    ['from is followed first: from not found beats a bad path', { a: [] }, [move('/nope', '/a/01')], 'operation 0: from not found'],
    ['from bad index is bad index', { arr: [1] }, [move('/arr/01', '/x')], 'operation 0: bad index'],
    ['from "-" is from not found', { arr: [1] }, [move('/arr/-', '/x')], 'operation 0: from not found'],
    ['a missing path parent after a successful from is path not found', { a: 1 }, [move('/a', '/x/y')], 'operation 0: path not found'],
    ['moving into an own child is rejected', { a: {} }, [move('/a', '/a/b')], 'operation 0: cannot move into own child'],
  ]);
});

describe('copy', () => {
  runTable([
    ['copies a value', { a: 1 }, [copy('/a', '/b')], { a: 1, b: 1 }],
    [
      'copies are independent: a later op on one does not affect the other',
      { a: {} },
      [copy('/a', '/b'), add('/b/x', 1)],
      { a: {}, b: { x: 1 } },
    ],
    ['into its own child', { a: { b: 1 } }, [copy('/a', '/a/c')], { a: { b: 1, c: { b: 1 } } }],
    ['from "" copies the doc taken before the change', { a: 1 }, [copy('', '/x')], { a: 1, x: { a: 1 } }],
    ['from "" into an array index', [1, 2], [copy('', '/0')], [[1, 2], 1, 2]],
    ['keeps -0', { a: [-0] }, [copy('/a', '/b')], { a: [-0], b: [-0] }],
    ['keeps member order', { a: { z: 1, y: 2, 3: 0 } }, [copy('/a', '/b')], { a: { 3: 0, z: 1, y: 2 }, b: { 3: 0, z: 1, y: 2 } }],
  ]);

  test('the copy shares nothing with the original', () => {
    const doc = { a: { x: [1] } };
    const result = applyPatch(doc, [copy('/a', '/b')]);
    assertNoSharing(result, doc);
    assert.notEqual(result.a, result.b);
    assert.notEqual(result.a.x, result.b.x);
  });

  failTable([
    ['a missing from is from not found', {}, [copy('/a', '/b')], 'operation 0: from not found'],
    ['an inherited name in from is from not found', {}, [copy('/toString', '/b')], 'operation 0: from not found'],
    ['array index above the length is path not found', [1], [copy('/0', '/2')], 'operation 0: path not found'],
    ['from bad index is bad index', { arr: [1] }, [copy('/arr/01', '/x')], 'operation 0: bad index'],
  ]);
});

describe('test', () => {
  test('success returns an unchanged copy of the doc', () => {
    const doc = { a: [1, { b: 2 }] };
    const result = applyPatch(doc, [check('/a/1/b', 2)]);
    assertExact(result, doc);
    assert.notEqual(result, doc);
    assertNoSharing(result, doc);
  });

  test('path "" names the whole document', () => {
    assertExact(applyPatch({ a: 1 }, [check('', { a: 1 })]), { a: 1 });
  });

  describe('equality matrix', () => {
    const rows = [
      ['1 equals 1.0', 1, 1.0, true],
      ['1 equals 1e0', 1, j('1e0'), true],
      ['0 equals -0', 0, -0, true],
      ['-0 equals 0', -0, 0, true],
      ['[0] equals [-0]', [0], [-0], true],
      ['[-0] equals [0]', [-0], [0], true],
      ['{a:-0} equals {a:0}', { a: -0 }, { a: 0 }, true],
      ['{a:0} equals {a:-0}', { a: 0 }, { a: -0 }, true],
      ['1 differs from "1"', 1, '1', false],
      ['true differs from 1', true, 1, false],
      ['false differs from 0', false, 0, false],
      ['null differs from false', null, false, false],
      ['null differs from {}', null, {}, false],
      ['{} differs from null', {}, null, false],
      ['null equals null', null, null, true],
      ['true equals true', true, true, true],
      ['true differs from false', true, false, false],
      ['false differs from true', false, true, false],
      ['false equals false', false, false, true],
      ['1 differs from 2', 1, 2, false],
      ['"a" differs from "b"', 'a', 'b', false],
      ['[] differs from {}', [], {}, false],
      ['{} differs from []', {}, [], false],
      ['[1,2] differs from [2,1]', [1, 2], [2, 1], false],
      ['[1] differs from [1,1]', [1], [1, 1], false],
      ['[1,1] differs from [1]', [1, 1], [1], false],
      ['{a:1,b:2} equals {b:2,a:1}', { a: 1, b: 2 }, { b: 2, a: 1 }, true],
      ['{a:1} differs from {a:1,b:2}', { a: 1 }, { a: 1, b: 2 }, false],
      ['{a:1,b:2} differs from {a:1}', { a: 1, b: 2 }, { a: 1 }, false],
      ['{a:1} differs from {b:1}', { a: 1 }, { b: 1 }, false],
      ['{a:1,b:2} differs from {a:1,c:2}', { a: 1, b: 2 }, { a: 1, c: 2 }, false],
      ['{constructor:1} differs from {toString:1}', { constructor: 1 }, { toString: 1 }, false],
      ['composed "é" differs from decomposed "é"', 'é', 'é', false],
      ['"a" differs from "a "', 'a', 'a ', false],
      ['equal strings are equal', 'abc', 'abc', true],
      ['nested deep structures are equal', { a: [1, { b: [null, 'x', { c: -0 }] }] }, { a: [1, { b: [null, 'x', { c: 0 }] }] }, true],
      ['nested deep structures differ in a leaf', { a: [1, { b: [null, 'x'] }] }, { a: [1, { b: [null, 'y'] }] }, false],
      ['own __proto__ equals own __proto__', j('{"__proto__":1}'), j('{"__proto__":1}'), true],
      ['own __proto__ differs from {}', j('{"__proto__":1}'), {}, false],
      ['{} differs from own __proto__', {}, j('{"__proto__":1}'), false],
      ['own __proto__ with different values differs', j('{"__proto__":1}'), j('{"__proto__":2}'), false],
    ];
    for (const [name, doc, value, equal] of rows) {
      test(name, () => {
        const patch = [check('', value)];
        if (equal) assertExact(applyPatch(doc, patch), doc);
        else assertPatchError(doc, patch, 'operation 0: test failed', 0);
      });
    }
  });

  failTable([
    ['a missing path is path not found', {}, [check('/a', 1)], 'operation 0: path not found'],
    ['a bad index is bad index', { arr: [1] }, [check('/arr/01', 1)], 'operation 0: bad index'],
    ['"-" is path not found', { arr: [1] }, [check('/arr/-', 1)], 'operation 0: path not found'],
    ['index equal to the length is path not found', [1], [check('/1', 1)], 'operation 0: path not found'],
    ['an inherited name is path not found', {}, [check('/toString', 1)], 'operation 0: path not found'],
  ]);
});

describe('bad index tokens and huge indexes in every position', () => {
  const doc = () => ({ arr: [1, 2] });
  const ops = [
    ['remove', (p) => remove(p), 'path not found'],
    ['replace', (p) => replace(p, 9), 'path not found'],
    ['test', (p) => check(p, 1), 'path not found'],
    ['move from', (p) => move(p, '/x'), 'from not found'],
    ['copy from', (p) => copy(p, '/x'), 'from not found'],
  ];
  for (const [name, build, notFound] of ops) {
    for (const token of BAD_INDEX_TOKENS) {
      test(`${name}: token ${JSON.stringify(token)} is a bad index`, () => {
        assertPatchError(doc(), [build(`/arr/${token}`)], 'operation 0: bad index', 0);
      });
    }
    test(`${name}: a huge index is ${notFound}`, () => {
      assertPatchError(doc(), [build(`/arr/${HUGE_INDEX}`)], `operation 0: ${notFound}`, 0);
    });
  }

  for (const token of BAD_INDEX_TOKENS) {
    test(`add: non-last token ${JSON.stringify(token)} is a bad index`, () => {
      assertPatchError({ arr: [{}] }, [add(`/arr/${token}/x`, 0)], 'operation 0: bad index', 0);
    });
  }
});

describe('failure index', () => {
  test('the error index is the position of the failing operation', () => {
    assertPatchError({ a: 1 }, [add('/b', 2), replace('/a', 3), check('/a', 1)], 'operation 2: test failed', 2);
  });

  test('operations after the failing one are not applied', () => {
    const doc = { a: 1 };
    const patch = [check('/a', 2), add('/b', 1)];
    assertPatchError(doc, patch, 'operation 0: test failed', 0);
    assertExact(doc, { a: 1 });
  });

  test('a later form error stops everything before anything is applied', () => {
    assertPatchError({ a: 1 }, [remove('/zzz'), { op: 'nope', path: '' }], 'operation 1: bad op', 1);
  });

  test('a failure at index 1 reports index 1', () => {
    assertPatchError({}, [add('/a', 1), remove('/b')], 'operation 1: path not found', 1);
  });
});
