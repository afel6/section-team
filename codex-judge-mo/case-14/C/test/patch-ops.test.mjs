import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { expectPatchError } from './helpers/assert-patch-error.mjs';

const PATH_NOT_FOUND = 'path not found';
const FROM_NOT_FOUND = 'from not found';
const BAD_INDEX = 'bad index';

const fail = (doc, ops, reason, i = 0) =>
  expectPatchError(() => applyPatch(doc, ops), `operation ${i}: ${reason}`, i);
const failOp = (doc, op, reason) => fail(doc, [op], reason);
const applyOps = (doc, ...ops) => applyPatch(doc, ops);
const keys = (x) => Object.keys(x);

describe('own-member lookup', () => {
  for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
    test(`test on {} at /${name} is path not found`, () => {
      failOp({}, { op: 'test', path: `/${name}`, value: 1 }, PATH_NOT_FOUND);
    });
  }

  test('remove /toString on {}', () => {
    failOp({}, { op: 'remove', path: '/toString' }, PATH_NOT_FOUND);
  });

  test('replace /constructor on {} is path not found', () => {
    failOp({}, { op: 'replace', path: '/constructor', value: 1 }, PATH_NOT_FOUND);
  });

  test('own __proto__ and constructor members are found', () => {
    const doc = JSON.parse('{"__proto__":1,"constructor":2}');
    assert.deepEqual(applyOps(doc, { op: 'test', path: '/__proto__', value: 1 }), doc);
    assert.deepEqual(applyOps(doc, { op: 'test', path: '/constructor', value: 2 }).constructor, 2);
  });

  test('replace /__proto__ gives an own member', () => {
    const doc = JSON.parse('{"__proto__":1,"constructor":2}');
    const result = applyOps(doc, { op: 'replace', path: '/__proto__', value: 5 });
    assert.ok(Object.hasOwn(result, '__proto__'));
    assert.equal(Object.getOwnPropertyDescriptor(result, '__proto__').value, 5);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
  });

  test('add /__proto__ on {} creates an own member', () => {
    const result = applyOps({}, { op: 'add', path: '/__proto__', value: { x: 1 } });
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(result.x, undefined);
    assert.deepEqual(keys(result), ['__proto__']);
    assert.deepEqual(Object.getOwnPropertyDescriptor(result, '__proto__').value, { x: 1 });
  });

  test('"-" is an ordinary member name on objects', () => {
    const added = applyOps({}, { op: 'add', path: '/-', value: 1 });
    assert.deepEqual(keys(added), ['-']);
    assert.deepEqual(applyOps({ '-': 1, b: 2 }, { op: 'remove', path: '/-' }), { b: 2 });
    failOp({}, { op: 'test', path: '/-', value: 1 }, PATH_NOT_FOUND);
    failOp({ a: [1] }, { op: 'add', path: '/a/-/x', value: 1 }, PATH_NOT_FOUND);
  });

  test('copy and move from /constructor on {} is from not found', () => {
    failOp({}, { op: 'copy', from: '/constructor', path: '/a' }, FROM_NOT_FOUND);
    failOp({}, { op: 'move', from: '/constructor', path: '/a' }, FROM_NOT_FOUND);
  });
});

describe('array index rules', () => {
  const doc = { a: [10, 20, 30] };
  const BAD_TOKENS = ['01', '00', '+1', '-1', '1.0', '1e0', ' 1', '1 ', 'length', '', '0x1', '１'];

  test('valid indexes', () => {
    assert.deepEqual(applyOps(doc, { op: 'test', path: '/a/0', value: 10 }), doc);
    assert.deepEqual(applyOps(doc, { op: 'test', path: '/a/2', value: 30 }), doc);
  });

  for (const token of BAD_TOKENS) {
    for (const name of ['test', 'remove', 'replace']) {
      test(`${name} with token ${JSON.stringify(token)} is bad index`, () => {
        failOp(doc, { op: name, path: `/a/${token}`, value: 1 }, BAD_INDEX);
      });
    }
  }

  test('index equal to length or huge is path not found', () => {
    for (const idx of ['3', '99999999999999999999']) {
      for (const name of ['test', 'remove', 'replace']) {
        failOp(doc, { op: name, path: `/a/${idx}`, value: 1 }, PATH_NOT_FOUND);
      }
    }
  });

  test('- names nothing', () => {
    for (const name of ['test', 'remove', 'replace']) {
      failOp(doc, { op: name, path: '/a/-', value: 1 }, PATH_NOT_FOUND);
    }
    failOp(doc, { op: 'copy', from: '/a/-', path: '/b' }, FROM_NOT_FOUND);
    failOp(doc, { op: 'move', from: '/a/-', path: '/b' }, FROM_NOT_FOUND);
  });

  test('bad index in a middle token', () => {
    failOp(doc, { op: 'test', path: '/a/01/x', value: 1 }, BAD_INDEX);
  });

  test('primitives name nothing', () => {
    const d = { s: 'abc', n: 1, b: true, z: null };
    for (const path of ['/s/0', '/s/length', '/n/0', '/b/x', '/z/x']) {
      failOp(d, { op: 'test', path, value: 1 }, PATH_NOT_FOUND);
    }
    failOp('abc', { op: 'test', path: '/0', value: 'a' }, PATH_NOT_FOUND);
  });

  test('first failing token decides', () => {
    failOp({ a: [1] }, { op: 'remove', path: '/x/01' }, PATH_NOT_FOUND);
    failOp({ a: [1] }, { op: 'remove', path: '/a/01/x' }, BAD_INDEX);
  });
});

describe('add', () => {
  test('empty path replaces whole document, also a primitive one', () => {
    assert.deepEqual(applyOps({ a: 1 }, { op: 'add', path: '', value: [1] }), [1]);
    assert.equal(applyOps(5, { op: 'add', path: '', value: 'x' }), 'x');
    assert.deepEqual(applyOps('s', { op: 'add', path: '', value: { b: 1 } }), { b: 1 });
  });

  test('new member goes last, existing keeps place', () => {
    assert.deepEqual(
      keys(applyOps({ a: 1, b: 2 }, { op: 'add', path: '/c', value: 3 })),
      ['a', 'b', 'c'],
    );
    const r = applyOps({ a: 1, b: 2 }, { op: 'add', path: '/a', value: 9 });
    assert.deepEqual(keys(r), ['a', 'b']);
    assert.equal(r.a, 9);
  });

  test('member order rule', () => {
    const r = applyOps({ b: 0 }, { op: 'add', path: '/1', value: 5 });
    assert.equal(JSON.stringify(r), '{"1":5,"b":0}');
    assert.deepEqual(
      keys(applyOps({ 2: 0, b: 0 }, { op: 'add', path: '/10', value: 1 })),
      ['2', '10', 'b'],
    );
    assert.deepEqual(keys(applyOps({ b: 0 }, { op: 'add', path: '/01', value: 1 })), ['b', '01']);
  });

  test('array append, insert, and insert at length', () => {
    assert.deepEqual(applyOps([1, 2], { op: 'add', path: '/-', value: 3 }), [1, 2, 3]);
    assert.deepEqual(applyOps([1, 2], { op: 'add', path: '/0', value: 0 }), [0, 1, 2]);
    assert.deepEqual(applyOps([1, 2, 3], { op: 'add', path: '/1', value: 9 }), [1, 9, 2, 3]);
    assert.deepEqual(applyOps([1, 2], { op: 'add', path: '/2', value: 3 }), [1, 2, 3]);
  });

  test('array index beyond length is path not found', () => {
    failOp([1, 2], { op: 'add', path: '/3', value: 0 }, PATH_NOT_FOUND);
    failOp([], { op: 'add', path: '/1', value: 0 }, PATH_NOT_FOUND);
  });

  test('bad index tokens on array parent', () => {
    for (const t of ['01', '+1', '1.0', '']) {
      failOp([1, 2], { op: 'add', path: `/${t}`, value: 0 }, BAD_INDEX);
    }
  });

  test('parent not a container is path not found', () => {
    const d = { s: 'x', n: 1, z: null };
    for (const path of ['/s/0', '/n/x', '/z/x']) {
      failOp(d, { op: 'add', path, value: 1 }, PATH_NOT_FOUND);
    }
  });

  test('missing parent is path not found', () => {
    failOp({}, { op: 'add', path: '/nope/x', value: 1 }, PATH_NOT_FOUND);
  });

  test('bad index in parent path', () => {
    failOp({ a: [1] }, { op: 'add', path: '/a/01/x', value: 1 }, BAD_INDEX);
  });

  test('add into / creates empty-name member', () => {
    const r = applyOps({}, { op: 'add', path: '/', value: 7 });
    assert.equal(JSON.stringify(r), '{"":7}');
  });

  test('add null', () => {
    assert.deepEqual(applyOps({}, { op: 'add', path: '/a', value: null }), { a: null });
    assert.equal(applyOps(1, { op: 'add', path: '', value: null }), null);
  });
});

describe('remove', () => {
  test('object member removed, order kept', () => {
    const r = applyOps({ a: 1, b: 2, c: 3 }, { op: 'remove', path: '/b' });
    assert.deepEqual(keys(r), ['a', 'c']);
  });

  test('array element removed, later ones move down', () => {
    assert.deepEqual(applyOps([1, 2, 3], { op: 'remove', path: '/1' }), [1, 3]);
  });

  test('missing targets', () => {
    failOp({ a: 1 }, { op: 'remove', path: '/b' }, PATH_NOT_FOUND);
    failOp({ a: [1, 2, 3] }, { op: 'remove', path: '/a/3' }, PATH_NOT_FOUND);
  });
});

describe('replace', () => {
  test('empty path replaces root', () => {
    assert.deepEqual(applyOps({ a: 1 }, { op: 'replace', path: '', value: [2] }), [2]);
    assert.equal(applyOps([1], { op: 'replace', path: '', value: null }), null);
  });

  test('member keeps its place', () => {
    const r = applyOps({ a: 1, b: 2 }, { op: 'replace', path: '/a', value: 5 });
    assert.deepEqual(keys(r), ['a', 'b']);
    assert.equal(r.a, 5);
  });

  test('array element replaced, not inserted', () => {
    assert.deepEqual(applyOps([1, 2, 3], { op: 'replace', path: '/1', value: 9 }), [1, 9, 3]);
  });

  test('missing targets', () => {
    failOp({ a: 1 }, { op: 'replace', path: '/b', value: 1 }, PATH_NOT_FOUND);
    failOp({ a: [1, 2, 3] }, { op: 'replace', path: '/a/3', value: 1 }, PATH_NOT_FOUND);
    failOp({ a: [1, 2, 3] }, { op: 'replace', path: '/a/-', value: 1 }, PATH_NOT_FOUND);
  });
});

describe('move', () => {
  test('object to object', () => {
    const r = applyOps({ a: 1, b: 2, c: 3 }, { op: 'move', from: '/a', path: '/z' });
    assert.deepEqual(keys(r), ['b', 'c', 'z']);
    assert.equal(r.z, 1);
  });

  test('within array, index counts after removal', () => {
    const m = (from, path) => applyOps([0, 1, 2, 3], { op: 'move', from, path });
    assert.deepEqual(m('/0', '/3'), [1, 2, 3, 0]);
    assert.deepEqual(m('/3', '/0'), [3, 0, 1, 2]);
    assert.deepEqual(m('/1', '/-'), [0, 2, 3, 1]);
    failOp([0, 1, 2, 3], { op: 'move', from: '/0', path: '/4' }, PATH_NOT_FOUND);
  });

  test('from equal to path leaves document as is', () => {
    const r = applyOps({ a: 1, b: 2 }, { op: 'move', from: '/a', path: '/a' });
    assert.deepEqual(keys(r), ['a', 'b']);
    assert.deepEqual(
      applyOps({ arr: [1, 2] }, { op: 'move', from: '/arr/1', path: '/arr/1' }),
      { arr: [1, 2] },
    );
  });

  test('from equal to path but missing is from not found', () => {
    failOp({ a: 1 }, { op: 'move', from: '/x', path: '/x' }, FROM_NOT_FOUND);
    failOp({ a: [1] }, { op: 'move', from: '/a/-', path: '/a/-' }, FROM_NOT_FOUND);
  });

  test('from is followed first', () => {
    failOp({}, { op: 'move', from: '/x', path: '/y/z' }, FROM_NOT_FOUND);
  });

  test('bad path parent after from found', () => {
    failOp({ a: 1 }, { op: 'move', from: '/a', path: '/b/c' }, PATH_NOT_FOUND);
  });

  test('bad index in from', () => {
    failOp({ a: [1] }, { op: 'move', from: '/a/01', path: '/b' }, BAD_INDEX);
  });

  test('move child onto its parent', () => {
    assert.deepEqual(
      applyOps({ a: { b: 2 } }, { op: 'move', from: '/a/b', path: '/a' }),
      { a: 2 },
    );
  });

  test('move into root', () => {
    assert.deepEqual(applyOps({ a: { x: 1 } }, { op: 'move', from: '/a', path: '' }), { x: 1 });
  });
});

describe('copy', () => {
  test('deep copy, independent of the source', () => {
    const r = applyOps({ a: { x: [1] } }, { op: 'copy', from: '/a', path: '/b' });
    assert.deepEqual(r.b, r.a);
    assert.notEqual(r.b, r.a);
    assert.notEqual(r.b.x, r.a.x);
    r.b.x.push(2);
    assert.deepEqual(r.a.x, [1]);
  });

  test('copy into own child', () => {
    const r = applyOps({ a: { x: 1 } }, { op: 'copy', from: '/a', path: '/a/b' });
    assert.deepEqual(r, { a: { x: 1, b: { x: 1 } } });
  });

  test('copy from root', () => {
    assert.deepEqual(
      applyOps({ a: 1 }, { op: 'copy', from: '', path: '/c' }),
      { a: 1, c: { a: 1 } },
    );
  });

  test('copy array element to - and to index', () => {
    assert.deepEqual(applyOps([1, 2], { op: 'copy', from: '/0', path: '/-' }), [1, 2, 1]);
    assert.deepEqual(applyOps([1, 2], { op: 'copy', from: '/1', path: '/0' }), [2, 1, 2]);
  });

  test('failures', () => {
    failOp({ a: 1 }, { op: 'copy', from: '/x', path: '/b' }, FROM_NOT_FOUND);
    failOp({ a: 1 }, { op: 'copy', from: '/a', path: '/x/y' }, PATH_NOT_FOUND);
    failOp({ a: [1] }, { op: 'copy', from: '/a/01', path: '/b' }, BAD_INDEX);
  });

  test('from is followed first', () => {
    failOp({}, { op: 'copy', from: '/x', path: '/y/z' }, FROM_NOT_FOUND);
  });
});

describe('sequencing', () => {
  test('operations apply in order to the previous result', () => {
    const r = applyPatch({}, [
      { op: 'add', path: '/a', value: [] },
      { op: 'add', path: '/a/-', value: 1 },
      { op: 'copy', from: '/a/0', path: '/b' },
      { op: 'test', path: '/b', value: 1 },
    ]);
    assert.deepEqual(r, { a: [1], b: 1 });
  });

  test('first failure stops and carries its index', () => {
    fail(
      {},
      [
        { op: 'add', path: '/a', value: 1 },
        { op: 'add', path: '/b', value: 2 },
        { op: 'remove', path: '/missing' },
        { op: 'add', path: '/never', value: 3 },
      ],
      PATH_NOT_FOUND,
      2,
    );
  });
});
