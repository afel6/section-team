import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import {
  expectOpError,
  expectPatchFail,
  one,
  deepFreeze,
  nest,
  depthOf,
  assertNoSharedArrays,
} from './helpers.mjs';

// ---- applyPatch: purity ----

describe('applyPatch does not mutate inputs', () => {
  const makeDoc = () => ({ a: [1, 2, 3], b: { c: 1 }, d: 'x' });
  const makePatch = () => [
    { op: 'add', path: '/a/0', value: { n: [1] } },
    { op: 'remove', path: '/b/c' },
    { op: 'replace', path: '/d', value: [0] },
    { op: 'move', from: '/a/1', path: '/b/m' },
    { op: 'copy', from: '/a', path: '/e' },
  ];

  it('on success', () => {
    const doc = makeDoc();
    const patch = makePatch();
    const docSnap = structuredClone(doc);
    const patchSnap = structuredClone(patch);
    applyPatch(doc, patch);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
  });

  it('on failure after earlier ops succeeded', () => {
    const doc = makeDoc();
    const patch = [...makePatch(), { op: 'test', path: '/d', value: 'nope' }];
    const docSnap = structuredClone(doc);
    const patchSnap = structuredClone(patch);
    expectPatchFail(doc, patch, 'test failed', 5);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
  });

  for (const first of [
    { op: 'add', path: '/q', value: 1 },
    { op: 'remove', path: '/d' },
    { op: 'replace', path: '/d', value: 1 },
  ]) {
    it(`on failure after ${first.op}`, () => {
      const doc = makeDoc();
      const patch = [first, { op: 'test', path: '/b', value: 'x' }];
      const docSnap = structuredClone(doc);
      const patchSnap = structuredClone(patch);
      expectPatchFail(doc, patch, 'test failed', 1);
      assert.deepStrictEqual(doc, docSnap);
      assert.deepStrictEqual(patch, patchSnap);
    });
  }

  it('works on deeply frozen doc and patch', () => {
    const doc = deepFreeze(makeDoc());
    const patch = deepFreeze(makePatch());
    const result = applyPatch(doc, patch);
    assert.deepStrictEqual(result.a, [{ n: [1] }, 2, 3]);
    assert.deepStrictEqual(result.b, { m: 1 });
    assert.deepStrictEqual(result.d, [0]);
    assert.deepStrictEqual(result.e, [{ n: [1] }, 2, 3]);
  });
});

describe('applyPatch result shares nothing', () => {
  it('empty patch copies deeply', () => {
    const doc = { a: { b: [1] } };
    const r = applyPatch(doc, []);
    assert.deepStrictEqual(r, doc);
    assert.notStrictEqual(r, doc);
    assert.notStrictEqual(r.a, doc.a);
    assert.notStrictEqual(r.a.b, doc.a.b);
  });

  it('add copies the value', () => {
    const op = { op: 'add', path: '/v', value: { x: [1] } };
    const r = one({}, op);
    assert.deepStrictEqual(r.v, { x: [1] });
    assert.notStrictEqual(r.v, op.value);
    assert.notStrictEqual(r.v.x, op.value.x);
  });

  it('replace copies the value', () => {
    const op = { op: 'replace', path: '/v', value: { x: [1] } };
    const r = one({ v: 0 }, op);
    assert.notStrictEqual(r.v, op.value);
    assert.notStrictEqual(r.v.x, op.value.x);
  });

  it('root add copies the value', () => {
    const value = { x: [1] };
    const r = one({}, { op: 'add', path: '', value });
    assert.deepStrictEqual(r, value);
    assert.notStrictEqual(r, value);
    assert.notStrictEqual(r.x, value.x);
  });

  it('root replace copies the value', () => {
    const value = [1];
    const r = one(0, { op: 'replace', path: '', value });
    assert.notStrictEqual(r, value);
  });

  it('copy duplicates the subtree', () => {
    const r = one({ a: { x: [1] } }, { op: 'copy', from: '/a', path: '/b' });
    assert.deepStrictEqual(r.b, { x: [1] });
    assert.notStrictEqual(r.b, r.a);
    assert.notStrictEqual(r.b.x, r.a.x);
  });

  it('test leaves the value unshared', () => {
    const value = { x: 1 };
    const r = one({ a: { x: 1 } }, { op: 'test', path: '/a', value });
    assert.notStrictEqual(r.a, value);
  });
});

describe('applyPatch keeps -0', () => {
  it('copies -0 members', () => {
    assert.ok(Object.is(applyPatch({ a: -0 }, []).a, -0));
  });
  it('add', () => {
    assert.ok(Object.is(one({}, { op: 'add', path: '/a', value: -0 }).a, -0));
  });
  it('replace', () => {
    assert.ok(Object.is(one({ a: 1 }, { op: 'replace', path: '/a', value: -0 }).a, -0));
  });
  it('copy', () => {
    assert.ok(Object.is(one({ a: -0 }, { op: 'copy', from: '/a', path: '/b' }).b, -0));
  });
  it('move', () => {
    const r = one({ a: -0 }, { op: 'move', from: '/a', path: '/b' });
    assert.ok(Object.is(r.b, -0));
    assert.deepStrictEqual(r, { b: -0 });
  });
  it('array element copy', () => {
    const r = one({ a: [-0] }, { op: 'copy', from: '/a', path: '/b' });
    assert.ok(Object.is(r.b[0], -0));
    assert.ok(Object.is(r.a[0], -0));
  });
  it('add of an array holding -0', () => {
    const r = one({}, { op: 'add', path: '/a', value: [-0] });
    assert.ok(Object.is(r.a[0], -0));
  });
  it('primitive documents come back unchanged', () => {
    assert.strictEqual(applyPatch(5, []), 5);
    assert.strictEqual(applyPatch('x', []), 'x');
    assert.strictEqual(applyPatch(null, []), null);
    const r = applyPatch(-0, []);
    assert.ok(Object.is(r, -0));
  });
});

// ---- member order and special names ----

describe('applyPatch member order', () => {
  it('copy keeps integer-like keys first, then insertion order', () => {
    const doc = JSON.parse('{"b":1,"a":2,"2":0,"1":0}');
    const r = applyPatch(doc, []);
    assert.deepStrictEqual(Object.keys(r), ['1', '2', 'b', 'a']);
  });

  it('add /1 to {b:0}', () => {
    const r = one({ b: 0 }, { op: 'add', path: '/1', value: 5 });
    assert.deepStrictEqual(Object.keys(r), ['1', 'b']);
    assert.strictEqual(JSON.stringify(r), '{"1":5,"b":0}');
  });

  it('new name goes last', () => {
    const r = one({ b: 0, a: 1 }, { op: 'add', path: '/c', value: 2 });
    assert.deepStrictEqual(Object.keys(r), ['b', 'a', 'c']);
  });

  it('add to existing name keeps place', () => {
    const r = one({ b: 0, a: 1 }, { op: 'add', path: '/b', value: 9 });
    assert.deepStrictEqual(Object.keys(r), ['b', 'a']);
    assert.strictEqual(r.b, 9);
  });

  it('replace keeps place', () => {
    const r = one({ b: 0, a: 1 }, { op: 'replace', path: '/b', value: 9 });
    assert.deepStrictEqual(Object.keys(r), ['b', 'a']);
    assert.strictEqual(r.b, 9);
  });

  it('move relocates the name', () => {
    const r = one({ b: 1, a: 2 }, { op: 'move', from: '/b', path: '/z' });
    assert.deepStrictEqual(Object.keys(r), ['a', 'z']);
    assert.deepStrictEqual(r, { a: 2, z: 1 });
  });
});

describe('applyPatch special member names', () => {
  it('copies an own __proto__ key as ordinary data', () => {
    const doc = JSON.parse('{"__proto__":{"x":1}}');
    const r = applyPatch(doc, []);
    assert.ok(Object.hasOwn(r, '__proto__'));
    assert.strictEqual(Object.getPrototypeOf(r), Object.prototype);
    assert.deepStrictEqual(Object.keys(r), ['__proto__']);
    assert.strictEqual(r.x, undefined);
  });

  it('add /__proto__ creates an own member', () => {
    const r = one({}, { op: 'add', path: '/__proto__', value: { y: 1 } });
    assert.ok(Object.hasOwn(r, '__proto__'));
    assert.strictEqual(Object.getPrototypeOf(r), Object.prototype);
    assert.deepStrictEqual(Object.keys(r), ['__proto__']);
    assert.strictEqual(r.y, undefined);
  });

  it('add copies a value containing own __proto__ without changing prototype', () => {
    const value = JSON.parse('{"__proto__":{"z":1}}');
    const r = one({}, { op: 'add', path: '/v', value });
    assert.strictEqual(Object.getPrototypeOf(r.v), Object.prototype);
    assert.ok(Object.hasOwn(r.v, '__proto__'));
  });

  it('inherited names are not found', () => {
    expectOpError({}, { op: 'test', path: '/toString', value: 1 }, 'path not found');
    expectOpError({}, { op: 'remove', path: '/constructor' }, 'path not found');
    expectOpError({}, { op: 'replace', path: '/hasOwnProperty', value: 1 }, 'path not found');
    expectOpError({}, { op: 'test', path: '/__proto__', value: {} }, 'path not found');
    expectOpError({}, { op: 'test', path: '/constructor/name', value: 'Object' }, 'path not found');
  });

  it('add /toString creates an own member', () => {
    const r = one({}, { op: 'add', path: '/toString', value: 1 });
    assert.ok(Object.hasOwn(r, 'toString'));
    assert.deepStrictEqual(r, { toString: 1 });
  });

  it('moves and copies from inherited names fail', () => {
    expectOpError({}, { op: 'copy', from: '/toString', path: '/a' }, 'from not found');
    expectOpError({}, { op: 'move', from: '/__proto__', path: '/a' }, 'from not found');
  });
});

// ---- array indexes ----

describe('applyPatch array index tokens', () => {
  it('test /0 on [1] succeeds', () => {
    assert.deepStrictEqual(one([1], { op: 'test', path: '/0', value: 1 }), [1]);
  });

  const badTokens = ['01', '+1', '1.0', '1e0', ' 1', 'length', '', '-1', '0x1'];
  for (const token of badTokens) {
    for (const name of ['test', 'replace', 'remove']) {
      it(`${name} /${JSON.stringify(token)} is bad index`, () => {
        expectOpError([1], { op: name, path: `/${token}`, value: 1 }, 'bad index');
      });
    }
  }

  for (const name of ['test', 'replace', 'remove']) {
    it(`${name} /- is path not found`, () => {
      expectOpError([1], { op: name, path: '/-', value: 1 }, 'path not found');
    });
    it(`${name} /1 on [1] is path not found`, () => {
      expectOpError([1], { op: name, path: '/1', value: 1 }, 'path not found');
    });
    it(`${name} huge index is path not found`, () => {
      expectOpError([1], { op: name, path: '/99999999999999999999', value: 1 }, 'path not found');
    });
  }

  it('bad index fires in a nested array', () => {
    expectOpError({ a: [{ x: 1 }] }, { op: 'test', path: '/a/01/x', value: 1 }, 'bad index');
  });

  it('first failing token decides the reason', () => {
    expectOpError({ a: [1] }, { op: 'test', path: '/a/5/01', value: 1 }, 'path not found');
    expectOpError({ a: [1] }, { op: 'test', path: '/a/01/5', value: 1 }, 'bad index');
  });
});

describe('applyPatch through primitives', () => {
  it('cannot descend into a string member', () => {
    expectOpError({ a: 'str' }, { op: 'test', path: '/a/x', value: 1 }, 'path not found');
    expectOpError({ a: 'str' }, { op: 'test', path: '/a/0', value: 's' }, 'path not found');
  });

  for (const doc of ['abc', 5, true, null]) {
    it(`/0 on ${JSON.stringify(doc)}`, () => {
      expectOpError(doc, { op: 'test', path: '/0', value: 1 }, 'path not found');
    });
  }
});

// ---- add ----

describe('applyPatch add', () => {
  it('empty path replaces the document', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'add', path: '', value: [2] }), [2]);
    assert.strictEqual(one({ a: 1 }, { op: 'add', path: '', value: 3 }), 3);
  });

  it('/- appends', () => {
    assert.deepStrictEqual(one([1], { op: 'add', path: '/-', value: 2 }), [1, 2]);
  });

  it('index == length appends', () => {
    assert.deepStrictEqual(one([1, 2], { op: 'add', path: '/2', value: 3 }), [1, 2, 3]);
  });

  it('inserts and shifts', () => {
    assert.deepStrictEqual(one([1, 2], { op: 'add', path: '/1', value: 9 }), [1, 9, 2]);
    assert.deepStrictEqual(one([1, 2], { op: 'add', path: '/0', value: 9 }), [9, 1, 2]);
  });

  it('index > length is path not found', () => {
    expectOpError([1, 2], { op: 'add', path: '/3', value: 9 }, 'path not found');
  });

  it('bad index forms', () => {
    expectOpError([1], { op: 'add', path: '/01', value: 9 }, 'bad index');
    expectOpError([1], { op: 'add', path: '/x', value: 9 }, 'bad index');
  });

  it('missing or non-container parent is path not found', () => {
    expectOpError({}, { op: 'add', path: '/a/b', value: 1 }, 'path not found');
    expectOpError({ a: 5 }, { op: 'add', path: '/a/b', value: 1 }, 'path not found');
    expectOpError({ a: null }, { op: 'add', path: '/a/b', value: 1 }, 'path not found');
    expectOpError({ a: 'str' }, { op: 'add', path: '/a/0', value: 1 }, 'path not found');
  });

  it('empty member name', () => {
    assert.deepStrictEqual(one({}, { op: 'add', path: '/', value: 1 }), { '': 1 });
  });

  it('into a primitive document is path not found', () => {
    expectOpError(5, { op: 'add', path: '/a', value: 1 }, 'path not found');
  });
});

// ---- remove / replace ----

describe('applyPatch remove', () => {
  it('shifts array elements', () => {
    assert.deepStrictEqual(one([1, 2, 3], { op: 'remove', path: '/1' }), [1, 3]);
  });
  it('removes an object member', () => {
    const r = one({ a: 1, b: 2 }, { op: 'remove', path: '/a' });
    assert.deepStrictEqual(r, { b: 2 });
    assert.deepStrictEqual(Object.keys(r), ['b']);
  });
  it('missing member is path not found', () => {
    expectOpError({ a: 1 }, { op: 'remove', path: '/b' }, 'path not found');
    expectOpError({ a: 1 }, { op: 'remove', path: '/b/c' }, 'path not found');
  });
});

describe('applyPatch replace', () => {
  it('empty path replaces any document', () => {
    assert.strictEqual(one(5, { op: 'replace', path: '', value: 'x' }), 'x');
    assert.deepStrictEqual(one({ a: 1 }, { op: 'replace', path: '', value: null }), null);
  });
  it('replaces members and elements', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'replace', path: '/a', value: 2 }), { a: 2 });
    assert.deepStrictEqual(one([1, 2], { op: 'replace', path: '/1', value: 3 }), [1, 3]);
  });
  it('does not add a missing member', () => {
    expectOpError({}, { op: 'replace', path: '/a', value: 1 }, 'path not found');
  });
  it('/- and index == length are path not found', () => {
    expectOpError([1], { op: 'replace', path: '/-', value: 1 }, 'path not found');
    expectOpError([1], { op: 'replace', path: '/1', value: 1 }, 'path not found');
  });
});

// ---- move / copy ----

describe('applyPatch move', () => {
  it('index is counted after removal', () => {
    assert.deepStrictEqual(one([1, 2, 3], { op: 'move', from: '/0', path: '/2' }), [2, 3, 1]);
  });
  it('to /- appends', () => {
    assert.deepStrictEqual(one([1, 2, 3], { op: 'move', from: '/0', path: '/-' }), [2, 3, 1]);
  });
  it('same from and path is a no-op that keeps order', () => {
    const r = one({ a: 1, b: 2 }, { op: 'move', from: '/a', path: '/a' });
    assert.deepStrictEqual(r, { a: 1, b: 2 });
    assert.deepStrictEqual(Object.keys(r), ['a', 'b']);
  });
  it('same missing from and path is from not found', () => {
    expectOpError({ b: 1 }, { op: 'move', from: '/a', path: '/a' }, 'from not found');
  });
  it('missing from', () => {
    expectOpError({}, { op: 'move', from: '/x', path: '/y' }, 'from not found');
  });
  it('missing parent of path', () => {
    expectOpError({ a: 1 }, { op: 'move', from: '/a', path: '/x/y' }, 'path not found');
  });
  it('bad index in from', () => {
    expectOpError([1, 2], { op: 'move', from: '/01', path: '/0' }, 'bad index');
  });
  it('missing from and missing path reports from first', () => {
    expectOpError({}, { op: 'move', from: '/x', path: '/y/z' }, 'from not found');
  });
  it('moves into the root', () => {
    assert.deepStrictEqual(one({ a: { b: 1 } }, { op: 'move', from: '/a', path: '' }), { b: 1 });
  });
  it('from /- is from not found', () => {
    expectOpError([1], { op: 'move', from: '/-', path: '/0' }, 'from not found');
  });
});

describe('applyPatch copy', () => {
  it('copies into its own subtree without cycles', () => {
    const r = one({ a: { b: 1 } }, { op: 'copy', from: '/a', path: '/a/c' });
    assert.deepStrictEqual(r, { a: { b: 1, c: { b: 1 } } });
  });
  it('copies the whole document to /-', () => {
    assert.deepStrictEqual(one([1], { op: 'copy', from: '', path: '/-' }), [1, [1]]);
  });
  it('missing from', () => {
    expectOpError({}, { op: 'copy', from: '/x', path: '/y' }, 'from not found');
  });
  it('missing from and missing path reports from first', () => {
    expectOpError({}, { op: 'copy', from: '/x', path: '/y/z' }, 'from not found');
  });
  it('missing path parent', () => {
    expectOpError({ a: 1 }, { op: 'copy', from: '/a', path: '/x/y' }, 'path not found');
  });
  it('keeps the source in place', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'copy', from: '/a', path: '/b' }), { a: 1, b: 1 });
  });
});

// ---- test op equality ----

describe('applyPatch test equality', () => {
  const equal = [
    ['1 vs 1.0', JSON.parse('1.0'), 1],
    ['1 vs 1e0', JSON.parse('1e0'), 1],
    ['1e0 doc vs 1', 1, JSON.parse('1e0')],
    ['0 vs -0', 0, -0],
    ['-0 vs 0', -0, 0],
    ['object order', { a: 1, b: 2 }, { b: 2, a: 1 }],
    ['nested', { a: [1, { b: [null, 'x', { c: true }] }] }, { a: [1, { b: [null, 'x', { c: true }] }] }],
    ['empty array', [], []],
    ['empty object', {}, {}],
    ['null', null, null],
    ['string', 'a', 'a'],
  ];
  for (const [label, doc, value] of equal) {
    it(`passes ${label}`, () => {
      const r = one(doc, { op: 'test', path: '', value });
      assert.deepStrictEqual(r, doc);
    });
  }

  const unequal = [
    ['a vs A', 'a', 'A'],
    ['NFC vs NFD', 'é', 'é'],
    ['NFD vs NFC', 'é', 'é'],
    ['[1,2] vs [2,1]', [1, 2], [2, 1]],
    ['[] vs {}', [], {}],
    ['{} vs []', {}, []],
    ['{a:1} vs {a:1,b:2}', { a: 1 }, { a: 1, b: 2 }],
    ['{a:1,b:2} vs {a:1}', { a: 1, b: 2 }, { a: 1 }],
    ['{a:1} vs {b:1}', { a: 1 }, { b: 1 }],
    ['null vs {}', null, {}],
    ['{} vs null', {}, null],
    ['null vs 0', null, 0],
    ['false vs 0', false, 0],
    ['true vs 1', true, 1],
    ['"1" vs 1', '1', 1],
    ['nested differs', { a: [1, { b: 2 }] }, { a: [1, { b: 3 }] }],
    ['array longer', [1], [1, 2]],
    ['array shorter', [1, 2], [1]],
    ['{length:0} vs []', { length: 0 }, []],
    ['[] vs {length:0}', [], { length: 0 }],
    ['{} vs own __proto__', {}, JSON.parse('{"__proto__":1}')],
    ['own __proto__ vs {}', JSON.parse('{"__proto__":1}'), {}],
    ['own __proto__ differing', JSON.parse('{"__proto__":1}'), JSON.parse('{"__proto__":2}')],
    ['own vs inherited member', { a: 1 }, Object.create({ a: 1 })],
  ];
  for (const [label, doc, value] of unequal) {
    it(`fails ${label}`, () => {
      expectOpError(doc, { op: 'test', path: '', value }, 'test failed');
    });
  }

  it('equal own __proto__ passes', () => {
    const doc = JSON.parse('{"__proto__":1}');
    const r = one(doc, { op: 'test', path: '', value: JSON.parse('{"__proto__":1}') });
    assert.ok(Object.hasOwn(r, '__proto__'));
  });

  it('tests a nested path', () => {
    assert.deepStrictEqual(one({ a: [5] }, { op: 'test', path: '/a/0', value: 5 }), { a: [5] });
  });

  it('missing test path is path not found', () => {
    expectOpError({}, { op: 'test', path: '/a', value: 1 }, 'path not found');
  });

  it('reports the failing op index', () => {
    const patch = [
      { op: 'test', path: '/a', value: 1 },
      { op: 'add', path: '/b', value: 2 },
      { op: 'test', path: '/b', value: 3 },
    ];
    expectPatchFail({ a: 1 }, patch, 'test failed', 2);
  });
});

// ---- depth ----

describe('applyPatch deep documents', () => {
  const DEPTH = 1000;

  it('copies a deep document without overflow', () => {
    const doc = nest(DEPTH);
    const r = applyPatch(doc, []);
    assert.strictEqual(depthOf(r), DEPTH);
    assertNoSharedArrays(r, doc);
  });

  it('adds inside a deep document', () => {
    const doc = nest(DEPTH);
    const r = one(doc, { op: 'add', path: `${'/0'.repeat(DEPTH - 1)}/-`, value: 'x' });
    assert.strictEqual(depthOf(r), DEPTH);
    let src = doc;
    let out = r;
    for (let i = 1; i < DEPTH; i++) {
      src = src[0];
      out = out[0];
    }
    assert.deepStrictEqual(src, []);
    assert.deepStrictEqual(out, ['x']);
  });

  it('adds a deep value', () => {
    const value = nest(DEPTH);
    const r = one({}, { op: 'add', path: '/v', value });
    assert.strictEqual(depthOf(r.v), DEPTH);
    assertNoSharedArrays(r.v, value);
  });

  it('copies a deep subtree', () => {
    const r = one({ a: nest(DEPTH) }, { op: 'copy', from: '/a', path: '/b' });
    assert.strictEqual(depthOf(r.b), DEPTH);
    assertNoSharedArrays(r.b, r.a);
  });
});
