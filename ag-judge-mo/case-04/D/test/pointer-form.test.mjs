import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer, applyPatch } from '../jsonpatch.mjs';
import { expectPatchError, expectOpError, expectPatchFail, one } from './helpers.mjs';

// ---- parsePointer ----

describe('parsePointer decoding', () => {
  const cases = [
    ['', []],
    ['/', ['']],
    ['/a//b/', ['a', '', 'b', '']],
    ['/~01', ['~1']],
    ['/~10', ['/0']],
    ['/a~0b~1c', ['a~b/c']],
    ['/~0~1', ['~/']],
  ];
  for (const [input, expected] of cases) {
    it(`decodes ${JSON.stringify(input)}`, () => {
      assert.deepStrictEqual(parsePointer(input), expected);
    });
  }

  it('returns a fresh array each call', () => {
    const first = parsePointer('/a/b');
    const second = parsePointer('/a/b');
    assert.notStrictEqual(first, second);
    first.push('zzz');
    first[0] = 'changed';
    assert.deepStrictEqual(parsePointer('/a/b'), ['a', 'b']);
    const e1 = parsePointer('');
    e1.push('x');
    assert.deepStrictEqual(parsePointer(''), []);
  });
});

describe('parsePointer errors', () => {
  for (const input of ['a', ' /a', '/~', '/~2', '/a~', '/~/', '#/a']) {
    it(`SyntaxError for ${JSON.stringify(input)}`, () => {
      assert.throws(() => parsePointer(input), { name: 'SyntaxError', message: 'invalid pointer' });
      assert.throws(() => parsePointer(input), (e) => e instanceof SyntaxError);
    });
  }

  const nonStrings = [
    ['undefined', undefined],
    ['null', null],
    ['number', 1],
    ['array', ['/a']],
    ['String object', new String('/a')],
    ['object', {}],
    ['boolean', true],
  ];
  for (const [label, input] of nonStrings) {
    it(`TypeError for ${label}`, () => {
      assert.throws(() => parsePointer(input), { name: 'TypeError', message: 'pointer must be a string' });
      assert.throws(() => parsePointer(input), (e) => e instanceof TypeError);
    });
  }
});

// ---- applyPatch: patch and operation form ----

describe('applyPatch patch argument', () => {
  const bad = [
    ['null', null],
    ['undefined', undefined],
    ['object', {}],
    ['string', '[]'],
    ['String object', new String('')],
    ['length object', { length: 0 }],
    ['array-like', { 0: { op: 'test', path: '', value: 1 }, length: 1 }],
    ['typed array', new Uint8Array(0)],
  ];
  for (const [label, patch] of bad) {
    it(`rejects ${label}`, () => {
      expectPatchError(() => applyPatch({}, patch), 'patch must be an array', null);
    });
  }
});

describe('applyPatch operation is an object', () => {
  const bad = [
    ['null', null],
    ['array', []],
    ['number', 5],
    ['string', 'x'],
    ['function', () => {}],
    ['undefined', undefined],
  ];
  for (const [label, op] of bad) {
    it(`rejects ${label}`, () => expectOpError({}, op, 'not an object'));
  }

  it('rejects a hole at index 1', () => {
    const patch = [{ op: 'test', path: '', value: 1 }];
    patch.length = 2;
    expectPatchFail(1, patch, 'not an object', 1);
  });

  it('accepts a String object carrying own members', () => {
    const op = Object.assign(new String('x'), { op: 'add', path: '/a', value: 1 });
    assert.deepStrictEqual(one({}, op), { a: 1 });
  });

  it('accepts a Date carrying own members', () => {
    const op = Object.assign(new Date(0), { op: 'add', path: '/a', value: 1 });
    assert.deepStrictEqual(one({}, op), { a: 1 });
  });

  it('accepts a String object remove', () => {
    const op = Object.assign(new String('x'), { op: 'remove', path: '/a' });
    assert.deepStrictEqual(one({ a: 1 }, op), {});
  });
});

describe('applyPatch bad op', () => {
  const inherited = Object.assign(Object.create({ op: 'add' }), { path: '/a', value: 1 });
  const bad = [
    ['missing', { path: '/a', value: 1 }],
    ['uppercase', { op: 'ADD', path: '/a', value: 1 }],
    ['leading space', { op: ' add', path: '/a', value: 1 }],
    ['String object', { op: new String('add'), path: '/a', value: 1 }],
    ['inherited', inherited],
    ['unknown', { op: 'get', path: '/a' }],
  ];
  for (const [label, op] of bad) {
    it(`rejects ${label}`, () => expectOpError({}, op, 'bad op'));
  }

  it('counts a non-enumerable own op', () => {
    const op = Object.defineProperty({ path: '/a', value: 1 }, 'op', { value: 'add', enumerable: false });
    assert.deepStrictEqual(one({}, op), { a: 1 });
  });

  it('counts a non-enumerable own value', () => {
    const op = Object.defineProperty({ op: 'add', path: '/a' }, 'value', { value: 7, enumerable: false });
    assert.deepStrictEqual(one({}, op), { a: 7 });
  });

  it('counts a non-enumerable own path', () => {
    const op = Object.defineProperty({ op: 'add', value: 1 }, 'path', { value: '/a', enumerable: false });
    assert.deepStrictEqual(one({}, op), { a: 1 });
  });
});

describe('applyPatch bad path', () => {
  const inherited = Object.assign(Object.create({ path: '/a' }), { op: 'add', value: 1 });
  const bad = [
    ['missing', { op: 'add', value: 1 }],
    ['number', { op: 'add', path: 5, value: 1 }],
    ['String object', { op: 'add', path: new String('/a'), value: 1 }],
    ['no leading slash', { op: 'add', path: 'a', value: 1 }],
    ['bad escape', { op: 'add', path: '/~2', value: 1 }],
    ['inherited', inherited],
  ];
  for (const [label, op] of bad) {
    it(`rejects ${label}`, () => expectOpError({}, op, 'bad path'));
  }
});

describe('applyPatch bad from', () => {
  const inherited = (op) => Object.assign(Object.create({ from: '/a' }), { op, path: '/b' });
  for (const name of ['move', 'copy']) {
    const bad = [
      ['missing', { op: name, path: '/b' }],
      ['number', { op: name, path: '/b', from: 5 }],
      ['String object', { op: name, path: '/b', from: new String('/a') }],
      ['invalid escape', { op: name, path: '/b', from: '/~' }],
      ['inherited', inherited(name)],
    ];
    for (const [label, op] of bad) {
      it(`${name}: rejects ${label}`, () => expectOpError({ a: 1 }, op, 'bad from'));
    }
  }

  it('ignores an invalid from on add', () => {
    assert.deepStrictEqual(one({}, { op: 'add', path: '/a', value: 1, from: 5 }), { a: 1 });
  });

  it('ignores an own undefined value on remove', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'remove', path: '/a', value: undefined }), {});
  });

  it('ignores value and from on remove', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'remove', path: '/a', from: 3, value: 1 }), {});
  });
});

describe('applyPatch missing value', () => {
  for (const name of ['add', 'replace', 'test']) {
    it(`${name} without value`, () => expectOpError({ a: 1 }, { op: name, path: '/a' }, 'missing value'));
    it(`${name} with inherited value`, () => {
      const op = Object.assign(Object.create({ value: 1 }), { op: name, path: '/a' });
      expectOpError({ a: 1 }, op, 'missing value');
    });
  }

  it('null counts as present', () => {
    assert.deepStrictEqual(one({}, { op: 'add', path: '/a', value: null }), { a: null });
  });
});

describe('applyPatch structural rules', () => {
  it('cannot remove root', () => {
    expectOpError({ a: 1 }, { op: 'remove', path: '' }, 'cannot remove root');
  });

  const into = [
    ['/a', '/a/b'],
    ['', '/a'],
    ['', '/'],
  ];
  for (const [from, path] of into) {
    it(`cannot move ${JSON.stringify(from)} to ${JSON.stringify(path)}`, () => {
      expectOpError({ a: { b: 1 } }, { op: 'move', from, path }, 'cannot move into own child');
    });
  }

  it('allows move /a to /ab (not a prefix)', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'move', from: '/a', path: '/ab' }), { ab: 1 });
  });

  it('allows move /a to /a (no-op)', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'move', from: '/a', path: '/a' }), { a: 1 });
  });

  it('allows move /a/b to /a', () => {
    assert.deepStrictEqual(one({ a: { b: 5 } }, { op: 'move', from: '/a/b', path: '/a' }), { a: 5 });
  });

  it('allows copy into own child', () => {
    assert.deepStrictEqual(one({ a: 1 }, { op: 'copy', from: '', path: '/b' }), { a: 1, b: { a: 1 } });
  });
});

describe('applyPatch reason precedence', () => {
  it('missing op and path gives bad op', () => expectOpError({}, {}, 'bad op'));

  it('move with bad path and bad from gives bad path', () => {
    expectOpError({}, { op: 'move', path: 'x', from: 'y' }, 'bad path');
  });

  it('add with bad path and no value gives bad path', () => {
    expectOpError({}, { op: 'add', path: 'x' }, 'bad path');
  });

  it('remove root with bad path gives bad path', () => {
    expectOpError({}, { op: 'remove', path: 'x' }, 'bad path');
  });

  it('copy with bad from beats nothing else', () => {
    expectOpError({}, { op: 'copy', path: '/a' }, 'bad from');
  });

  it('add at root without value gives missing value', () => {
    expectOpError({}, { op: 'add', path: '' }, 'missing value');
  });

  it('move from root to /x gives own child', () => {
    expectOpError({}, { op: 'move', from: '', path: '/x' }, 'cannot move into own child');
  });
});

describe('applyPatch validation ordering', () => {
  it('validates every op before applying any', () => {
    const patch = [
      { op: 'add', path: '/a', value: 1 },
      { op: 'test', path: '/zzz', value: 1 },
      { op: 'bogus' },
    ];
    expectPatchFail({}, patch, 'bad op', 2);
  });

  it('stops at the first failure while applying', () => {
    const patch = [
      { op: 'remove', path: '/x' },
      { op: 'remove', path: '/x' },
      { op: 'test', path: '', value: 'never reached' },
    ];
    expectPatchFail({ x: 1 }, patch, 'path not found', 1);
  });

  it('reports failing application at the right index', () => {
    const patch = [
      { op: 'test', path: '/a', value: 1 },
      { op: 'test', path: '/a', value: 1 },
      { op: 'test', path: '/a', value: 2 },
    ];
    expectPatchFail({ a: 1 }, patch, 'test failed', 2);
  });

  it('reports the first form error', () => {
    expectPatchFail({}, [{ op: 'nope' }, 5], 'bad op', 0);
  });
});
