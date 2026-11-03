import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';
import { assertPatchError } from './helpers.mjs';

const validTest = () => ({ op: 'test', path: '', value: 1 });
const nonEnum = (obj, name, value) => Object.defineProperty(obj, name, { value, enumerable: false });

// Table runner: each row is [label, doc, patch, reason, index].
function failRows(rows) {
  for (const [label, doc, patch, reason, index = 0] of rows) {
    test(label, () => {
      assertPatchError(() => applyPatch(doc, patch), `operation ${index}: ${reason}`, index);
    });
  }
}

describe('patch is not an array', () => {
  const inputs = [
    ['undefined', undefined],
    ['null', null],
    ['plain object', {}],
    ['object with length 0', { length: 0 }],
    ['string "[]"', '[]'],
    ['String object', new String('x')],
    ['number', 0],
    ['array-like object', { 0: { op: 'test', path: '', value: 1 }, length: 1 }],
  ];
  for (const [label, patch] of inputs) {
    test(`rejects ${label}`, () => {
      assertPatchError(() => applyPatch({ a: 1 }, patch), 'patch must be an array', null);
    });
  }

  test('index is exactly null, not undefined', () => {
    assert.throws(() => applyPatch({}, {}), (err) => err instanceof PatchError && err.index === null);
  });
});

describe('PatchError', () => {
  test('has the documented shape for an operation failure', () => {
    assert.throws(
      () => applyPatch({}, [{ op: 'bogus' }]),
      (err) =>
        err instanceof PatchError &&
        err instanceof Error &&
        err.name === 'PatchError' &&
        typeof err.index === 'number' &&
        err.index === 0,
    );
  });
});

describe('not an object', () => {
  const fn = Object.assign(function () {}, { op: 'test', path: '', value: 1 });
  const hole = new Array(1);
  failRows([
    ['null', {}, [null], 'not an object'],
    ['undefined', {}, [undefined], 'not an object'],
    ['hole (new Array(1))', {}, hole, 'not an object'],
    ['hole (literal)', {}, [ , ], 'not an object'], // eslint-disable-line no-sparse-arrays
    ['empty array', {}, [[]], 'not an object'],
    ['array with element', {}, [[1]], 'not an object'],
    ['number', {}, [1], 'not an object'],
    ['string', {}, ['add'], 'not an object'],
    ['boolean', {}, [true], 'not an object'],
    ['function', {}, [() => {}], 'not an object'],
    ['function with own op members', {}, [fn], 'not an object'],
    ['hole in the middle', 1, [validTest(), , validTest()], 'not an object', 1], // eslint-disable-line no-sparse-arrays
    ['array carrying op members', {}, [Object.assign([], { op: 'add', path: '/a', value: 1 })], 'not an object'],
  ]);
});

describe('objects that go on to the next rule', () => {
  failRows([
    ['String object has no op', {}, [new String('x')], 'bad op'],
    ['Date has no op', {}, [new Date(0)], 'bad op'],
    ['null-prototype object has no op', {}, [Object.create(null)], 'bad op'],
  ]);

  test('Date with own members is an operation object', () => {
    const op = Object.assign(new Date(0), { op: 'add', path: '/a', value: 1 });
    assert.deepEqual(applyPatch({}, [op]), { a: 1 });
  });

  test('null-prototype object with members works', () => {
    const op = Object.assign(Object.create(null), { op: 'add', path: '/a', value: 1 });
    assert.deepEqual(applyPatch({}, [op]), { a: 1 });
  });
});

describe('bad op', () => {
  const bad = [
    ['missing', { path: '/a', value: 1 }],
    ['inherited only', Object.create({ op: 'add', path: '/a', value: 1 })],
    ['ADD', { op: 'ADD', path: '/a', value: 1 }],
    ['"add " with trailing space', { op: 'add ', path: '/a', value: 1 }],
    ['" add" with leading space', { op: ' add', path: '/a', value: 1 }],
    ['String object', { op: new String('add'), path: '/a', value: 1 }],
    ['array', { op: ['add'], path: '/a', value: 1 }],
    ['null', { op: null, path: '/a', value: 1 }],
    ['number', { op: 1, path: '/a', value: 1 }],
    ['get', { op: 'get', path: '/a', value: 1 }],
    ['_get', { op: '_get', path: '/a', value: 1 }],
  ];
  failRows(bad.map(([label, op]) => [`rejects op ${label}`, {}, [op], 'bad op']));
});

describe('non-enumerable own members count', () => {
  test('op', () => {
    const op = nonEnum({ path: '/a', value: 1 }, 'op', 'add');
    assert.deepEqual(applyPatch({}, [op]), { a: 1 });
  });

  test('path', () => {
    const op = nonEnum({ op: 'add', value: 1 }, 'path', '/a');
    assert.deepEqual(applyPatch({}, [op]), { a: 1 });
  });

  test('from', () => {
    const op = nonEnum({ op: 'copy', path: '/b' }, 'from', '/a');
    assert.deepEqual(applyPatch({ a: 1 }, [op]), { a: 1, b: 1 });
  });

  test('value', () => {
    const op = nonEnum({ op: 'add', path: '/a' }, 'value', 1);
    assert.deepEqual(applyPatch({}, [op]), { a: 1 });
  });

  test('value of null counts as present when non-enumerable', () => {
    const op = nonEnum({ op: 'add', path: '/a' }, 'value', null);
    assert.deepEqual(applyPatch({}, [op]), { a: null });
  });
});

describe('bad path', () => {
  const rows = [
    ['missing', { op: 'remove' }],
    ['inherited', Object.assign(Object.create({ path: '/a' }), { op: 'remove' })],
    ['String object', { op: 'remove', path: new String('/a') }],
    ['number', { op: 'remove', path: 1 }],
    ['null', { op: 'remove', path: null }],
    ['array', { op: 'remove', path: ['/a'] }],
    ['no leading slash', { op: 'remove', path: 'a' }],
    ['bad escape ~2', { op: 'remove', path: '/~2' }],
    ['trailing tilde', { op: 'remove', path: '/~' }],
  ];
  failRows(rows.map(([label, op]) => [`rejects ${label} path`, { a: 1 }, [op], 'bad path']));
});

describe('bad from', () => {
  const rows = [];
  for (const name of ['move', 'copy']) {
    const base = { op: name, path: '/b' };
    rows.push(
      [`${name}: missing`, base],
      [`${name}: inherited`, Object.assign(Object.create({ from: '/a' }), base)],
      [`${name}: String object`, { ...base, from: new String('/a') }],
      [`${name}: null`, { ...base, from: null }],
      [`${name}: no leading slash`, { ...base, from: 'a' }],
      [`${name}: bad escape`, { ...base, from: '/~' }],
    );
  }
  failRows(rows.map(([label, op]) => [`rejects ${label}`, { a: 1 }, [op], 'bad from']));

  test('from is ignored for add even when invalid', () => {
    assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/x', value: 1, from: 5 }]), { x: 1 });
  });

  test('from is ignored for remove even when invalid', () => {
    const op = { op: 'remove', path: '/a', value: undefined, from: 'bad' };
    assert.deepEqual(applyPatch({ a: 1 }, [op]), {});
  });

  test('from is ignored for replace and test even when invalid', () => {
    const patch = [
      { op: 'replace', path: '/a', value: 2, from: 'bad' },
      { op: 'test', path: '/a', value: 2, from: {} },
    ];
    assert.deepEqual(applyPatch({ a: 1 }, patch), { a: 2 });
  });
});

describe('missing value', () => {
  const rows = [];
  for (const name of ['add', 'replace', 'test']) {
    rows.push(
      [`${name}: no value member`, { op: name, path: '/a' }],
      [`${name}: inherited value`, Object.assign(Object.create({ value: 1 }), { op: name, path: '/a' })],
    );
  }
  failRows(rows.map(([label, op]) => [`rejects ${label}`, { a: 1 }, [op], 'missing value']));

  test('add with value null is present', () => {
    assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value: null }]), { a: null });
  });

  test('test of whole document null with value null passes', () => {
    assert.equal(applyPatch(null, [{ op: 'test', path: '', value: null }]), null);
  });

  for (const value of [false, 0, '']) {
    test(`add with falsy value ${JSON.stringify(value)} works`, () => {
      assert.deepEqual(applyPatch({}, [{ op: 'add', path: '/a', value }]), { a: value });
    });
  }
});

describe('cannot remove root', () => {
  failRows([['remove with empty path', { a: 1 }, [{ op: 'remove', path: '' }], 'cannot remove root']]);

  test('path "/" names the empty member and is allowed', () => {
    assert.deepEqual(applyPatch({ '': 1 }, [{ op: 'remove', path: '/' }]), {});
  });
});

describe('cannot move into own child', () => {
  const mv = (from, path) => [{ op: 'move', from, path }];
  failRows([
    ['/a into /a/b', { a: {} }, mv('/a', '/a/b'), 'cannot move into own child'],
    ['root into /a', { a: 1 }, mv('', '/a'), 'cannot move into own child'],
    ['root into "/"', { a: 1 }, mv('', '/'), 'cannot move into own child'],
    ['/a/b into /a/b/c/d', { a: { b: {} } }, mv('/a/b', '/a/b/c/d'), 'cannot move into own child'],
  ]);

  test('/a is not a prefix of /ab', () => {
    assert.deepEqual(applyPatch({ a: 1 }, mv('/a', '/ab')), { ab: 1 });
  });

  test('moving to the parent is allowed', () => {
    assert.deepEqual(applyPatch({ a: { b: 2 } }, mv('/a/b', '/a')), { a: 2 });
  });

  test('equal from and path leaves the document', () => {
    assert.deepEqual(applyPatch({ a: 1 }, mv('/a', '/a')), { a: 1 });
  });

  test('root onto root leaves the document', () => {
    assert.deepEqual(applyPatch({ a: 1 }, mv('', '')), { a: 1 });
  });

  test('copy from root into a child is allowed', () => {
    const result = applyPatch({ x: 1 }, [{ op: 'copy', from: '', path: '/a' }]);
    assert.deepEqual(result, { x: 1, a: { x: 1 } });
  });
});

describe('rule priority', () => {
  failRows([
    ['bad op beats bad path', {}, [{ op: 'bogus' }], 'bad op'],
    ['bad path beats bad from', {}, [{ op: 'move', path: 'bad', from: 'bad' }], 'bad path'],
    ['bad path beats missing value', {}, [{ op: 'add', path: 'bad' }], 'bad path'],
    ['bad from (copy)', {}, [{ op: 'copy', path: '/a', from: 'x' }], 'bad from'],
    ['bad from beats missing value', {}, [{ op: 'move', from: 'bad', path: '/a' }], 'bad from'],
    ['missing value beats nothing else on replace root', {}, [{ op: 'replace', path: '' }], 'missing value'],
    ['remove root ignores bad from', {}, [{ op: 'remove', path: '', from: 'bad' }], 'cannot remove root'],
    [
      'move into child ignores value',
      { a: {} },
      [{ op: 'move', path: '/a/b', from: '/a', value: undefined }],
      'cannot move into own child',
    ],
  ]);
});

describe('form checks run before applying', () => {
  failRows([
    [
      'later bad op wins over earlier failing test',
      {},
      [{ op: 'test', path: '/nope', value: 1 }, { op: 'bogus' }],
      'bad op',
      1,
    ],
    [
      'later remove root wins over earlier valid adds',
      {},
      [
        { op: 'add', path: '/a', value: 1 },
        { op: 'add', path: '/b', value: 2 },
        { op: 'remove', path: '' },
      ],
      'cannot remove root',
      2,
    ],
  ]);
});

describe('unused members are ignored', () => {
  test('value on remove', () => {
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', value: 'whatever' }]), {});
  });

  test('from on test', () => {
    assert.deepEqual(applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 1, from: {} }]), { a: 1 });
  });
});

describe('inputs are never changed', () => {
  const deepFreeze = (v) => {
    if (v !== null && typeof v === 'object') {
      Object.freeze(v);
      Object.values(v).forEach(deepFreeze);
    }
    return v;
  };

  test('form error leaves doc and patch intact', () => {
    const doc = { a: [1, 2], b: { c: 3 } };
    const patch = [{ op: 'add', path: '/x', value: { y: 1 } }, { op: 'bogus' }];
    const [docSnap, patchSnap, keys] = [structuredClone(doc), structuredClone(patch), Object.keys(doc)];
    assert.throws(() => applyPatch(doc, patch), PatchError);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
    assert.deepStrictEqual(Object.keys(doc), keys);
  });

  test('apply-time error leaves doc and patch intact', () => {
    const doc = { a: [1, 2], b: { c: 3 } };
    const patch = [
      { op: 'add', path: '/x', value: { y: 1 } },
      { op: 'test', path: '/a/0', value: 99 },
    ];
    const [docSnap, patchSnap, keys] = [structuredClone(doc), structuredClone(patch), Object.keys(doc)];
    assertPatchError(() => applyPatch(doc, patch), 'operation 1: test failed', 1);
    assert.deepStrictEqual(doc, docSnap);
    assert.deepStrictEqual(patch, patchSnap);
    assert.deepStrictEqual(Object.keys(doc), keys);
  });

  test('frozen doc and patch work and give the correct result', () => {
    const doc = deepFreeze({ a: [1, 2], b: { c: 3 } });
    const patch = deepFreeze([
      { op: 'add', path: '/a/1', value: { k: 1 } },
      { op: 'move', from: '/b/c', path: '/d' },
      { op: 'copy', from: '/a', path: '/e' },
      { op: 'replace', path: '/b', value: [] },
    ]);
    const result = applyPatch(doc, patch);
    assert.deepEqual(result, { a: [1, { k: 1 }, 2], b: [], d: 3, e: [1, { k: 1 }, 2] });
  });

  test('non-array patch never applies anything', () => {
    const doc = { a: 1 };
    const fake = { 0: { op: 'remove', path: '/a' }, length: 1 };
    assertPatchError(() => applyPatch(doc, fake), 'patch must be an array', null);
    assert.deepEqual(doc, { a: 1 });
  });
});
