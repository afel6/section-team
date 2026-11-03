// Successful operations, member order, equality and copying.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { assertPatchError, isNegZero } from './helpers.mjs';

const J = JSON.parse;
const keys = (x) => Object.keys(x);
const op = (o, path, extra = {}) => ({ op: o, path, ...extra });
const add = (path, value) => op('add', path, { value });
const rep = (path, value) => op('replace', path, { value });
const tst = (path, value) => op('test', path, { value });
const rem = (path) => op('remove', path);
const mv = (from, path) => op('move', path, { from });
const cp = (from, path) => op('copy', path, { from });

function deepFreeze(x) {
  const stack = [x];
  while (stack.length) {
    const v = stack.pop();
    if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      stack.push(...Object.values(v));
    }
  }
  return x;
}

describe('own members only on objects', () => {
  const inherited = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  for (const name of inherited) {
    for (const mk of [() => tst(`/${name}`, 1), () => rem(`/${name}`), () => rep(`/${name}`, 1)]) {
      test(`${mk().op} /${name} on {} is path not found`, () => {
        assertPatchError(() => applyPatch({}, [mk()]), 'operation 0: path not found', 0);
      });
    }
  }

  test('remove /__proto__ removes the own member', () => {
    const r = applyPatch(J('{"__proto__":1,"constructor":2,"toString":3}'), [rem('/__proto__')]);
    assert.deepEqual(keys(r), ['constructor', 'toString']);
    assert.equal(Object.hasOwn(r, '__proto__'), false);
  });

  test('replace /__proto__ sets the own member and keeps the prototype', () => {
    const r = applyPatch(J('{"__proto__":1,"constructor":2}'), [rep('/__proto__', 9)]);
    assert.equal(Object.getOwnPropertyDescriptor(r, '__proto__').value, 9);
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
    assert.deepEqual(keys(r), ['__proto__', 'constructor']);
  });

  test('add /__proto__ to {} creates an own member', () => {
    const r = applyPatch({}, [add('/__proto__', J('{"x":1}'))]);
    assert.equal(Object.hasOwn(r, '__proto__'), true);
    assert.deepEqual(keys(r), ['__proto__']);
    assert.equal(Object.getPrototypeOf(r), Object.prototype);
    assert.equal(r.x, undefined);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptor(r, '__proto__').value, J('{"x":1}'));
  });

  test('add /constructor to {} creates an own member', () => {
    const r = applyPatch({}, [add('/constructor', 5)]);
    assert.deepEqual(keys(r), ['constructor']);
    assert.equal(Object.hasOwn(r, 'constructor'), true);
    assert.equal(r.constructor, 5);
  });

  test('test /toString passes on an own toString member', () => {
    assert.deepStrictEqual(applyPatch(J('{"toString":3}'), [tst('/toString', 3)]), J('{"toString":3}'));
  });
});

describe('array index tokens', () => {
  const arr = () => [10, 20, 30];
  test('indexes 0 and 2 are found', () => {
    assert.deepStrictEqual(applyPatch(arr(), [tst('/0', 10), tst('/2', 30)]), [10, 20, 30]);
  });
  test('index equal to length is path not found for test', () => {
    assertPatchError(() => applyPatch(arr(), [tst('/3', 1)]), 'operation 0: path not found', 0);
  });
  test('index length-1 can be removed and replaced, length cannot', () => {
    assert.deepStrictEqual(applyPatch(arr(), [rem('/2')]), [10, 20]);
    assert.deepStrictEqual(applyPatch(arr(), [rep('/2', 0)]), [10, 20, 0]);
    assertPatchError(() => applyPatch(arr(), [rem('/3')]), 'operation 0: path not found', 0);
    assertPatchError(() => applyPatch(arr(), [rep('/3', 0)]), 'operation 0: path not found', 0);
  });
  for (const tok of ['01', '+1', '1.0', '1e0', ' 1', '1 ', 'length', '', '-1', '0x1', '１']) {
    for (const mk of [() => tst(`/${tok}`, 1), () => rem(`/${tok}`), () => rep(`/${tok}`, 1)]) {
      test(`${mk().op} token ${JSON.stringify(tok)} is bad index`, () => {
        assertPatchError(() => applyPatch(arr(), [mk()]), 'operation 0: bad index', 0);
      });
    }
  }
  for (const mk of [() => tst('/-', 1), () => rem('/-'), () => rep('/-', 1)]) {
    test(`${mk().op} /- is path not found`, () => {
      assertPatchError(() => applyPatch(arr(), [mk()]), 'operation 0: path not found', 0);
    });
  }
  test('huge digit index is path not found', () => {
    assertPatchError(() => applyPatch(arr(), [tst('/99999999999999999999', 1)]), 'operation 0: path not found', 0);
  });
});

describe('add', () => {
  test('/- appends to an array', () => {
    assert.deepStrictEqual(applyPatch([1, 2], [add('/-', 3)]), [1, 2, 3]);
  });
  test('/0 inserts at the front', () => {
    assert.deepStrictEqual(applyPatch([1, 2], [add('/0', 0)]), [0, 1, 2]);
  });
  test('index equal to length appends', () => {
    assert.deepStrictEqual(applyPatch([1, 2, 3], [add('/3', 4)]), [1, 2, 3, 4]);
  });
  test('index in the middle moves later elements up', () => {
    assert.deepStrictEqual(applyPatch([1, 2, 3], [add('/1', 9)]), [1, 9, 2, 3]);
  });
  test('index beyond length is path not found', () => {
    assertPatchError(() => applyPatch([1, 2, 3], [add('/4', 4)]), 'operation 0: path not found', 0);
  });
  for (const p of ['/01', '/1.0', '/']) {
    test(`array add at ${JSON.stringify(p)} is bad index`, () => {
      assertPatchError(() => applyPatch([1, 2, 3], [add(p, 4)]), 'operation 0: bad index', 0);
    });
  }
  test('new index-like name is placed first', () => {
    const r = applyPatch({ b: 0 }, [add('/1', 5)]);
    assert.deepEqual(keys(r), ['1', 'b']);
    assert.deepStrictEqual(r, { 1: 5, b: 0 });
  });
  test('existing member keeps its place', () => {
    const r = applyPatch(J('{"b":0,"a":1}'), [add('/b', 7)]);
    assert.deepEqual(keys(r), ['b', 'a']);
    assert.deepStrictEqual(r, { b: 7, a: 1 });
  });
  test('new member goes last', () => {
    const r = applyPatch(J('{"b":0,"a":1}'), [add('/c', 2)]);
    assert.deepEqual(keys(r), ['b', 'a', 'c']);
  });
  test('empty name creates member ""', () => {
    const r = applyPatch({}, [add('/', 1)]);
    assert.deepEqual(keys(r), ['']);
    assert.deepStrictEqual(r, { '': 1 });
  });
  test('missing parent is path not found', () => {
    assertPatchError(() => applyPatch({ x: {} }, [add('/x/y/z', 1)]), 'operation 0: path not found', 0);
  });
  for (const child of ['s', 5, true, null]) {
    test(`parent ${JSON.stringify(child)} is path not found`, () => {
      assertPatchError(() => applyPatch({ x: child }, [add('/x/y', 1)]), 'operation 0: path not found', 0);
    });
  }
  for (const doc of [5, 's', null, true, { a: 1 }, [1]]) {
    test(`path "" replaces the whole document ${JSON.stringify(doc)}`, () => {
      assert.deepStrictEqual(applyPatch(doc, [add('', { n: 1 })]), { n: 1 });
    });
  }
});

describe('remove', () => {
  test('object member keeps order of the rest', () => {
    const r = applyPatch(J('{"a":1,"b":2,"c":3}'), [rem('/b')]);
    assert.deepEqual(keys(r), ['a', 'c']);
    assert.deepStrictEqual(r, { a: 1, c: 3 });
  });
  test('array element moves later ones down', () => {
    assert.deepStrictEqual(applyPatch([1, 2, 3], [rem('/0')]), [2, 3]);
    assert.deepStrictEqual(applyPatch([1, 2, 3], [rem('/1')]), [1, 3]);
  });
  test('nested member', () => {
    assert.deepStrictEqual(applyPatch({ a: [{ b: 1, c: 2 }] }, [rem('/a/0/b')]), { a: [{ c: 2 }] });
  });
  test('missing member is path not found', () => {
    assertPatchError(() => applyPatch({}, [rem('/a')]), 'operation 0: path not found', 0);
  });
  test('below a primitive is path not found', () => {
    assertPatchError(() => applyPatch({ a: 1 }, [rem('/a/b')]), 'operation 0: path not found', 0);
  });
});

describe('replace', () => {
  test('"" replaces the whole document', () => {
    assert.deepStrictEqual(applyPatch({ a: 1 }, [rep('', [1])]), [1]);
    assert.deepStrictEqual(applyPatch(1, [rep('', null)]), null);
  });
  test('object member keeps its place', () => {
    const r = applyPatch(J('{"a":1,"b":2}'), [rep('/a', 9)]);
    assert.deepEqual(keys(r), ['a', 'b']);
    assert.deepStrictEqual(r, { a: 9, b: 2 });
  });
  test('array element', () => {
    assert.deepStrictEqual(applyPatch([1, 2, 3], [rep('/1', 'x')]), [1, 'x', 3]);
  });
  test('missing member is path not found', () => {
    assertPatchError(() => applyPatch({}, [rep('/a', 1)]), 'operation 0: path not found', 0);
  });
});

describe('move', () => {
  test('member to a new name', () => {
    assert.deepStrictEqual(applyPatch({ a: 1 }, [mv('/a', '/b')]), { b: 1 });
  });
  test('array index counts after removal', () => {
    assert.deepStrictEqual(applyPatch([1, 2, 3], [mv('/0', '/2')]), [2, 3, 1]);
  });
  test('index equal to the pre-removal length is path not found', () => {
    assertPatchError(() => applyPatch([1, 2, 3], [mv('/0', '/3')]), 'operation 0: path not found', 0);
  });
  test('from equal to path leaves the document as is', () => {
    assert.deepStrictEqual(applyPatch({ a: [1, 2] }, [mv('/a', '/a')]), { a: [1, 2] });
  });
  test('from equal to path keeps member order', () => {
    const r = applyPatch(J('{"a":1,"b":2}'), [mv('/a', '/a')]);
    assert.deepEqual(keys(r), ['a', 'b']);
  });
  test('from equal to path but missing is from not found', () => {
    assertPatchError(() => applyPatch({}, [mv('/a', '/a')]), 'operation 0: from not found', 0);
  });
  test('child to its parent', () => {
    assert.deepStrictEqual(applyPatch({ a: { b: 1 } }, [mv('/a/b', '/a')]), { a: 1 });
  });
  test('missing from is from not found', () => {
    assertPatchError(() => applyPatch({}, [mv('/a', '/b')]), 'operation 0: from not found', 0);
  });
  test('bad index in from is bad index', () => {
    assertPatchError(() => applyPatch([1], [mv('/01', '/0')]), 'operation 0: bad index', 0);
  });
  test('from is reported before path', () => {
    assertPatchError(() => applyPatch({}, [mv('/a', '/x/y')]), 'operation 0: from not found', 0);
  });
});

describe('copy', () => {
  test('result copy is a separate object', () => {
    const r = applyPatch({ a: { x: 1 } }, [cp('/a', '/b')]);
    assert.deepStrictEqual(r, { a: { x: 1 }, b: { x: 1 } });
    assert.notEqual(r.b, r.a);
    r.b.x = 2;
    assert.equal(r.a.x, 1);
  });
  test('path inside from copies the value as it was before', () => {
    const r = applyPatch({ a: { b: 1 } }, [cp('/a', '/a/c')]);
    assert.deepStrictEqual(r, { a: { b: 1, c: { b: 1 } } });
    assert.equal(Object.hasOwn(r.a.c, 'c'), false);
  });
  test('from "" copies the whole document', () => {
    assert.deepStrictEqual(applyPatch({ y: 1 }, [cp('', '/x')]), { y: 1, x: { y: 1 } });
  });
  test('array element onto its own index inserts', () => {
    assert.deepStrictEqual(applyPatch({ arr: [1] }, [cp('/arr/0', '/arr/0')]), { arr: [1, 1] });
  });
  test('missing from is from not found', () => {
    assertPatchError(() => applyPatch({}, [cp('/a', '/b')]), 'operation 0: from not found', 0);
  });
  test('from is followed before path', () => {
    assertPatchError(() => applyPatch({}, [cp('/a', '/x/y')]), 'operation 0: from not found', 0);
  });
});

describe('test equality', () => {
  // [docJson, valueJson, equal]
  const cases = [
    ['1', '1.0', true], ['1', '1e0', true], ['1', '1.00', true], ['1.0', '1e0', true],
    ['0', '-0', true], ['-0', '0', true],
    ['"1"', '1', false], ['"0"', '0', false], ['true', '1', false], ['false', '0', false],
    ['null', '0', false], ['null', 'false', false], ['""', 'null', false],
    ['[]', '{}', false], ['{}', '[]', false],
    ['[1,2]', '[2,1]', false], ['[1]', '[1,1]', false], ['[1,1]', '[1]', false],
    ['{"a":1,"b":2}', '{"b":2,"a":1}', true],
    ['{"a":1}', '{"a":1,"b":2}', false], ['{"a":1,"b":2}', '{"a":1}', false],
    ['{"a":null}', '{"b":null}', false], ['{"a":1}', '{"a":2}', false],
    ['"é"', '"é"', false], ['"é"', '"é"', false],
    ['"abc"', '"abd"', false], ['"abc"', '"abc"', true],
    ['[[]]', '[{}]', false], ['[[1,[2,{"a":[3]}]]]', '[[1,[2,{"a":[3]}]]]', true],
    ['[[1,[2,{"a":[3]}]]]', '[[1,[2,{"a":[4]}]]]', false],
    ['{"__proto__":1}', '{"__proto__":1}', true], ['{"__proto__":1}', '{}', false],
    ['{}', '{"__proto__":1}', false],
    ['true', 'true', true], ['true', 'false', false], ['null', 'null', true],
  ];
  for (const [d, v, eq] of cases) {
    test(`${d} vs ${v} is ${eq ? 'equal' : 'test failed'}`, () => {
      const run = () => applyPatch(J(d), [tst('', J(v))]);
      if (eq) assert.deepStrictEqual(run(), J(d));
      else assertPatchError(run, 'operation 0: test failed', 0);
    });
  }
  test('test returns a deep copy of the document', () => {
    const doc = { a: [1, { b: 2 }] };
    const r = applyPatch(doc, [tst('/a/1/b', 2)]);
    assert.deepStrictEqual(r, doc);
    assert.notEqual(r, doc);
    assert.notEqual(r.a, doc.a);
  });
  test('test on a nested path compares that value only', () => {
    assert.deepStrictEqual(applyPatch({ a: { b: 1 } }, [tst('/a', { b: 1 })]), { a: { b: 1 } });
  });
  test('-0 and 0 compare equal inside nested values', () => {
    assert.doesNotThrow(() => applyPatch(J('{"a":[-0]}'), [tst('/a', J('[0]'))]));
  });
});

describe('number preservation', () => {
  test('patch [] keeps -0 in a member', () => {
    const r = applyPatch(J('{"a":-0}'), []);
    assert.ok(isNegZero(r.a));
    assert.deepStrictEqual(r, { a: -0 });
  });
  test('root -0 survives', () => {
    assert.ok(isNegZero(applyPatch(J('-0'), [])));
  });
  test('add value -0', () => {
    const r = applyPatch({}, [add('/a', -0)]);
    assert.ok(isNegZero(r.a));
  });
  test('add value containing -0', () => {
    const r = applyPatch({}, [add('/a', J('[-0]'))]);
    assert.ok(isNegZero(r.a[0]));
  });
  test('replace value -0', () => {
    assert.ok(isNegZero(applyPatch({ a: 1 }, [rep('/a', -0)]).a));
    assert.ok(isNegZero(applyPatch(1, [rep('', -0)])));
  });
  test('copy keeps -0', () => {
    const r = applyPatch({ a: -0 }, [cp('/a', '/b')]);
    assert.ok(isNegZero(r.a));
    assert.ok(isNegZero(r.b));
  });
  test('move keeps -0', () => {
    const r = applyPatch({ a: -0 }, [mv('/a', '/b')]);
    assert.ok(isNegZero(r.b));
  });
  test('array element and nested -0', () => {
    assert.ok(isNegZero(applyPatch([-0], [])[0]));
    assert.ok(isNegZero(applyPatch(J('{"x":[{"y":-0}]}'), []).x[0].y));
  });
  test('large and tiny numbers are kept exactly', () => {
    const doc = J('[1e308,5e-324,9007199254740993]');
    const r = applyPatch(doc, []);
    assert.equal(r[0], 1e308);
    assert.equal(r[1], 5e-324);
    assert.ok(Object.is(r[2], doc[2]));
  });
});

describe('no sharing and no mutation', () => {
  function walkNotShared(a, b) {
    const stack = [[a, b]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x !== null && typeof x === 'object') {
        assert.notEqual(x, y);
        for (const k of Object.keys(x)) stack.push([x[k], y[k]]);
      }
    }
  }
  test('patch [] returns a deep copy', () => {
    const doc = J('{"a":[{"b":[1,{"c":2}]}],"d":{"e":{}}}');
    const r = applyPatch(doc, []);
    assert.deepStrictEqual(r, doc);
    walkNotShared(r, doc);
  });
  test('add and replace values are copied', () => {
    const value = { k: [1] };
    const r = applyPatch({}, [add('/a', value), rep('/a', value), add('/b', value)]);
    assert.notEqual(r.a, value);
    assert.notEqual(r.a.k, value.k);
    r.a.k.push(2);
    r.b.k.push(3);
    assert.deepStrictEqual(value, { k: [1] });
  });
  test('whole-document add copies the value', () => {
    const value = { k: 1 };
    const r = applyPatch(null, [add('', value)]);
    assert.notEqual(r, value);
  });
  test('result of a test op is not the doc', () => {
    const doc = { a: 1 };
    assert.notEqual(applyPatch(doc, [tst('/a', 1)]), doc);
  });
  test('doc and patch are unchanged after a successful apply', () => {
    const doc = J('{"b":[1,2],"a":{"z":1,"y":2}}');
    const patch = [add('/c', { q: 1 }), mv('/b/0', '/a/x'), cp('/a', '/d'), rem('/a/z'), rep('/b/0', 7)];
    const docSnap = structuredClone(doc);
    const patchSnap = structuredClone(patch);
    applyPatch(doc, patch);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
    assert.deepEqual(keys(doc), keys(docSnap));
    assert.deepEqual(keys(doc.a), ['z', 'y']);
  });
  test('deep-frozen doc and patch work', () => {
    const doc = deepFreeze(J('{"a":[1,{"b":2}],"c":3}'));
    const patch = deepFreeze([add('/d', { e: [1] }), mv('/c', '/f'), cp('/a', '/g'), rem('/a/0'), tst('/d/e/0', 1)]);
    const r = applyPatch(doc, patch);
    assert.deepStrictEqual(r, { a: [{ b: 2 }], d: { e: [1] }, f: 3, g: [1, { b: 2 }] });
  });
});

describe('primitive documents and sequencing', () => {
  test('primitive doc with []', () => {
    assert.equal(applyPatch(5, []), 5);
    assert.equal(applyPatch('s', []), 's');
    assert.equal(applyPatch(null, []), null);
  });
  test('test "" on a string document', () => {
    assert.equal(applyPatch('s', [tst('', 's')]), 's');
  });
  test('add "" turns null into an object', () => {
    assert.deepStrictEqual(applyPatch(null, [add('', {})]), {});
  });
  test('test /a on null is path not found', () => {
    assertPatchError(() => applyPatch(null, [tst('/a', 1)]), 'operation 0: path not found', 0);
  });
  test('operations apply in order to the previous result', () => {
    const r = applyPatch({}, [add('/a', {}), add('/a/b', 1), tst('/a/b', 1)]);
    assert.deepStrictEqual(r, { a: { b: 1 } });
  });
  test('"/" names "" and "//" names "" inside ""', () => {
    const r = applyPatch({}, [add('/', {}), add('//', 1)]);
    assert.deepStrictEqual(r, { '': { '': 1 } });
    assert.doesNotThrow(() => applyPatch(r, [tst('//', 1)]));
  });
});

describe('deep documents', () => {
  test('1000 levels deep copies without throwing', () => {
    let doc = [];
    for (let i = 1; i < 1000; i++) doc = i % 2 ? [doc] : { k: doc };
    const r = applyPatch(doc, []);
    let a = doc;
    let b = r;
    let depth = 0;
    while (a !== null && typeof a === 'object' && Object.keys(a).length) {
      assert.notEqual(a, b);
      assert.deepEqual(Object.keys(a), Object.keys(b));
      const k = Object.keys(a)[0];
      a = a[k];
      b = b[k];
      depth++;
    }
    assert.equal(depth, 999);
    assert.deepEqual(b, []);
  });
});
