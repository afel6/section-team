import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { expectPatchError } from './helpers/assert-patch-error.mjs';

const fails = (patch, message, index, doc = {}) =>
  expectPatchError(() => applyPatch(doc, patch), message, index);

describe('patch shape', () => {
  const notArrays = [
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['string', '[]'],
    ['length-only object', { length: 0 }],
    ['array-like', { 0: { op: 'test', path: '', value: 1 }, length: 1 }],
  ];
  for (const [label, patch] of notArrays) {
    test(`${label} is not an array`, () => fails(patch, 'patch must be an array', null));
  }

  test('empty patch returns a deep copy', () => {
    const doc = { a: [1, { b: 2 }] };
    const out = applyPatch(doc, []);
    assert.deepEqual(out, doc);
    assert.notEqual(out, doc);
    assert.notEqual(out.a, doc.a);
    assert.notEqual(out.a[1], doc.a[1]);
  });

  test('empty patch returns primitives', () => {
    for (const p of [1, 'x', null, true]) assert.equal(applyPatch(p, []), p);
  });
});

describe('not an object', () => {
  const bad = [
    ['null', null],
    ['number', 1],
    ['string', 'add'],
    ['boolean', true],
    ['undefined', undefined],
    ['function', Object.assign(() => {}, { op: 'test', path: '', value: 1 })],
    ['empty array', []],
    ['array of op', ['add']],
  ];
  for (const [label, op] of bad) {
    test(label, () => fails([op], 'operation 0: not an object', 0));
  }

  test('hole via literal', () => fails([,], 'operation 0: not an object', 0));
  test('hole via new Array', () => fails(new Array(1), 'operation 0: not an object', 0));
  test('hole at index 1', () =>
    fails([{ op: 'test', path: '', value: 1 }, ,], 'operation 1: not an object', 1, 1));

  test('String object is an object (bad op)', () =>
    fails([new String('x')], 'operation 0: bad op', 0));

  test('Date with own members is accepted', () => {
    const op = Object.assign(new Date(), { op: 'test', path: '', value: 1 });
    assert.equal(applyPatch(1, [op]), 1);
  });

  test('Array.prototype is not consulted for holes', () => {
    try {
      Array.prototype[0] = { op: 'test', path: '', value: 1 };
      fails(new Array(1), 'operation 0: not an object', 0, 1);
    } finally {
      delete Array.prototype[0];
    }
  });
});

describe('bad op', () => {
  const ops = [
    ['missing', { path: '', value: 1 }],
    ['uppercase', { op: 'ADD', path: '', value: 1 }],
    ['trailing space', { op: 'add ', path: '', value: 1 }],
    ['prefix', { op: 'ad', path: '', value: 1 }],
    ['empty', { op: '', path: '', value: 1 }],
    ['null', { op: null, path: '', value: 1 }],
    ['number', { op: 1, path: '', value: 1 }],
    ['String object', { op: new String('add'), path: '', value: 1 }],
    ['array', { op: ['add'], path: '', value: 1 }],
    ['inherited', Object.assign(Object.create({ op: 'add' }), { path: '', value: 1 })],
  ];
  for (const [label, op] of ops) {
    test(label, () => fails([op], 'operation 0: bad op', 0));
  }
});

describe('bad path', () => {
  const ops = [
    ['missing', { op: 'test', value: 1 }],
    ['inherited', Object.assign(Object.create({ path: '' }), { op: 'test', value: 1 })],
    ['number', { op: 'test', path: 1, value: 1 }],
    ['null', { op: 'test', path: null, value: 1 }],
    ['String object', { op: 'test', path: new String('/a'), value: 1 }],
    ['array', { op: 'test', path: ['/a'], value: 1 }],
    ['no slash', { op: 'test', path: 'a', value: 1 }],
    ['bad escape 2', { op: 'test', path: '/~2', value: 1 }],
    ['dangling tilde', { op: 'test', path: '/~', value: 1 }],
  ];
  for (const [label, op] of ops) {
    test(label, () => fails([op], 'operation 0: bad path', 0));
  }
});

describe('bad from', () => {
  for (const name of ['move', 'copy']) {
    const ops = [
      ['missing', { op: name, path: '/a' }],
      ['inherited', Object.assign(Object.create({ from: '' }), { op: name, path: '/a' })],
      ['number', { op: name, path: '/a', from: 1 }],
      ['String object', { op: name, path: '/a', from: new String('/a') }],
      ['invalid', { op: name, path: '/a', from: 'x' }],
      ['dangling tilde', { op: name, path: '/a', from: '/~' }],
    ];
    for (const [label, op] of ops) {
      test(`${name} ${label}`, () => fails([op], 'operation 0: bad from', 0));
    }
  }

  test('from is ignored for add', () =>
    assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: 1, from: 5 }]), { a: 1 }));
  test('from is ignored for remove', () =>
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', from: 'bad' }]), {}));
  test('from is ignored for replace', () =>
    assert.deepEqual(
      applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 2, from: 'bad' }]),
      { a: 2 },
    ));
  test('from is ignored for test', () =>
    assert.deepEqual(
      applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 1, from: {} }]),
      { a: 1 },
    ));
});

describe('missing value', () => {
  for (const name of ['add', 'replace', 'test']) {
    test(`${name} without value`, () =>
      fails([{ op: name, path: '/a' }], 'operation 0: missing value', 0, { a: 1 }));
    test(`${name} with inherited value`, () => {
      const op = Object.assign(Object.create({ value: 1 }), { op: name, path: '/a' });
      fails([op], 'operation 0: missing value', 0, { a: 1 });
    });
  }

  test('null value is present', () =>
    assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: null }]), { a: null }));

  test('remove ignores value', () =>
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', value: 'whatever' }]), {}));
  test('move ignores value', () =>
    assert.deepEqual(
      applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/b', value: 'x' }]),
      { b: 1 },
    ));
  test('copy ignores value', () =>
    assert.deepEqual(
      applyPatch({ a: 1 }, [{ op: 'copy', from: '/a', path: '/b', value: 'x' }]),
      { a: 1, b: 1 },
    ));
  test('move and copy work without value', () => {
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/b' }]), { b: 1 });
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'copy', from: '/a', path: '/b' }]), { a: 1, b: 1 });
  });
});

describe('non-enumerable members', () => {
  test('op, path and value count', () => {
    const op = {};
    for (const [k, v] of [['op', 'add'], ['path', '/x'], ['value', 1]]) {
      Object.defineProperty(op, k, { value: v, enumerable: false });
    }
    assert.deepEqual(applyPatch({}, [op]), { x: 1 });
  });
});

describe('cannot remove root', () => {
  test('remove ""', () =>
    fails([{ op: 'remove', path: '' }], 'operation 0: cannot remove root', 0));
  test('remove "/" removes the empty-named member', () =>
    assert.deepEqual(applyPatch({ '': 1 }, [{ op: 'remove', path: '/' }]), {}));
});

describe('cannot move into own child', () => {
  const bad = [
    ['', '/a'],
    ['/a', '/a/b'],
    ['/a', '/a/'],
    ['/a/b', '/a/b/c/d'],
  ];
  for (const [from, path] of bad) {
    test(`from ${JSON.stringify(from)} to ${JSON.stringify(path)}`, () =>
      fails([{ op: 'move', from, path }], 'operation 0: cannot move into own child', 0));
  }

  test('/a is not a prefix of /ab', () =>
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/ab' }]), { ab: 1 }));
  test('moving to the parent', () =>
    assert.deepEqual(
      applyPatch({ a: { b: 2 } }, [{ op: 'move', from: '/a/b', path: '/a' }]),
      { a: 2 },
    ));
  test('same path is a no-op', () =>
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/a' }]), { a: 1 }));
  test('root to root is a copy', () => {
    const doc = { a: 1 };
    const out = applyPatch(doc, [{ op: 'move', from: '', path: '' }]);
    assert.deepEqual(out, doc);
    assert.notEqual(out, doc);
  });
  test('/a is not a prefix of /ab/c', () =>
    assert.deepEqual(
      applyPatch({ a: 1, ab: {} }, [{ op: 'move', from: '/a', path: '/ab/c' }]),
      { ab: { c: 1 } },
    ));
  test('/ab to /a', () =>
    assert.deepEqual(applyPatch({ ab: 1 }, [{ op: 'move', from: '/ab', path: '/a' }]), { a: 1 }));
  test('copy may go inside from', () =>
    assert.deepEqual(
      applyPatch({ x: 1 }, [{ op: 'copy', from: '', path: '/a' }]),
      { x: 1, a: { x: 1 } },
    ));
});

describe('precedence', () => {
  test('not an object over bad op', () => fails([null], 'operation 0: not an object', 0));
  test('bad op over bad path', () => fails([{ op: 'bogus' }], 'operation 0: bad op', 0));
  test('bad path over bad from', () =>
    fails([{ op: 'move', path: 5 }], 'operation 0: bad path', 0));
  test('bad path over missing value', () =>
    fails([{ op: 'add', path: 5 }], 'operation 0: bad path', 0));
  test('bad from over cannot move into own child', () =>
    fails([{ op: 'move', path: '/a', from: 1 }], 'operation 0: bad from', 0));
  test('from is ignored for test, missing value reported', () =>
    fails([{ op: 'test', path: '/a', from: 'bad' }], 'operation 0: missing value', 0));
  test('missing value', () => fails([{ op: 'add', path: '/a' }], 'operation 0: missing value', 0));
  test("replace '' without value is missing value", () =>
    fails([{ op: 'replace', path: '' }], 'operation 0: missing value', 0));
  test('cannot remove root', () =>
    fails([{ op: 'remove', path: '' }], 'operation 0: cannot remove root', 0));
  test('cannot move into own child', () =>
    fails([{ op: 'move', from: '', path: '/a' }], 'operation 0: cannot move into own child', 0));
});

describe('form checks run before applying', () => {
  test('bad op after a failing test', () =>
    fails([{ op: 'test', path: '/nope', value: 1 }, { op: 'bogus' }], 'operation 1: bad op', 1));
  test('first of two form errors wins', () => {
    fails(
      [{ op: 'bogus' }, { op: 'add', path: 'a', value: 1 }],
      'operation 0: bad op',
      0,
    );
    fails(
      [{ op: 'add', path: '/a', value: 1 }, { op: 'remove', path: '' }, { op: 'x' }],
      'operation 1: cannot remove root',
      1,
    );
  });
  test('cannot remove root after an add', () =>
    fails(
      [{ op: 'add', path: '/a', value: 1 }, { op: 'remove', path: '' }],
      'operation 1: cannot remove root',
      1,
    ));
  test('cannot move into own child after a failing remove', () =>
    fails(
      [{ op: 'remove', path: '/missing' }, { op: 'move', from: '/a', path: '/a/b' }],
      'operation 1: cannot move into own child',
      1,
    ));
  test('index 2', () => {
    const ok = { op: 'test', path: '', value: {} };
    fails([ok, ok, { op: 'add', path: '/a' }], 'operation 2: missing value', 2);
  });
  test('index 3', () => {
    const ok = { op: 'test', path: '', value: {} };
    fails([ok, ok, ok, { op: 'add', path: 'a', value: 1 }], 'operation 3: bad path', 3);
  });
  test('doc and patch are not changed on form errors', () => {
    const doc = { a: 1 };
    const patch = [{ op: 'add', path: '/b', value: 2 }, { op: 'bogus' }];
    const patchCopy = structuredClone(patch);
    assert.throws(() => applyPatch(doc, patch));
    assert.deepEqual(doc, { a: 1 });
    assert.deepEqual(patch, patchCopy);
  });
});
