import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer, applyPatch } from '../jsonpatch.mjs';
import { expectPatchError } from './helpers/patch-assert.mjs';

const invalid = { name: 'SyntaxError', message: 'invalid pointer' };

function check(doc, path, value = 1) {
  return applyPatch(doc, [{ op: 'test', path, value }]);
}

describe('parsePointer valid', () => {
  const cases = [
    ['', []],
    ['/', ['']],
    ['/a//b/', ['a', '', 'b', '']],
    ['/~01', ['~1']],
    ['/~10', ['/0']],
    ['/a~1b/~0c', ['a/b', '~c']],
    ['/~0~1', ['~/']],
    ['/ é/ü', [' é', 'ü']],
    ['/é', ['é']],
    ['/a\nb', ['a\nb']],
  ];
  for (const [input, expected] of cases) {
    test(`parses ${JSON.stringify(input)}`, () => {
      assert.deepStrictEqual(parsePointer(input), expected);
    });
  }

  test('"/~01" is not decoded as "/"', () => {
    assert.notDeepStrictEqual(parsePointer('/~01'), ['/']);
    assert.deepStrictEqual(parsePointer('/~01'), ['~1']);
  });

  test('no unicode normalization', () => {
    assert.deepStrictEqual(parsePointer('/é'), ['é']);
    assert.notDeepStrictEqual(parsePointer('/é'), ['é']);
  });
});

describe('parsePointer invalid', () => {
  for (const input of ['/~~01', '/~', '/a~', '/~2', '/~a', 'a', ' /a', '#/a']) {
    test(`rejects ${JSON.stringify(input)}`, () => {
      assert.throws(() => parsePointer(input), invalid);
    });
  }

  test('error is a SyntaxError exactly', () => {
    assert.throws(() => parsePointer('a'), (err) => {
      assert.strictEqual(err.constructor, SyntaxError);
      assert.strictEqual(err.message, 'invalid pointer');
      return true;
    });
  });
});

describe('parsePointer input type and freshness', () => {
  const inputs = [
    ['number', 1],
    ['null', null],
    ['undefined', undefined],
    ['array', ['/a']],
    ['object', { a: 1 }],
    ['String object', new String('/a')],
  ];
  for (const [label, input] of inputs) {
    test(`rejects ${label}`, () => {
      assert.throws(() => parsePointer(input), (err) => {
        assert.strictEqual(err.constructor, TypeError);
        assert.strictEqual(err.message, 'pointer must be a string');
        return true;
      });
    });
  }

  test('returns a new array each call', () => {
    const a = parsePointer('/a/b');
    const b = parsePointer('/a/b');
    assert.notStrictEqual(a, b);
    assert.deepStrictEqual(a, b);
  });

  test('mutating result does not affect later calls', () => {
    const a = parsePointer('/a/b');
    a.push('x');
    a[0] = 'changed';
    assert.deepStrictEqual(parsePointer('/a/b'), ['a', 'b']);
    const e = parsePointer('');
    e.push('x');
    assert.deepStrictEqual(parsePointer(''), []);
  });
});

describe('following: object members', () => {
  for (const name of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
    test(`inherited name ${name} is not found`, () => {
      assert.throws(() => check({}, `/${name}`), {
        name: 'PatchError',
        message: 'operation 0: path not found',
      });
    });
  }

  test('own members with special names are ordinary', () => {
    const doc = JSON.parse('{"__proto__":1,"constructor":2,"toString":3}');
    assert.deepStrictEqual(check(doc, '/__proto__', 1), doc);
    assert.deepStrictEqual(check(doc, '/constructor', 2), doc);
    assert.deepStrictEqual(check(doc, '/toString', 3), doc);
  });

  test('prototype members never count', () => {
    assert.throws(() => check(Object.create({ a: 1 }), '/a'), {
      name: 'PatchError',
      message: 'operation 0: path not found',
    });
  });

  test('case sensitive', () => {
    assert.throws(() => check({ a: 1 }, '/A'), {
      name: 'PatchError',
      message: 'operation 0: path not found',
    });
  });

  test('exact name, no trimming', () => {
    assert.throws(() => check({ 'a ': 1 }, '/a'), {
      name: 'PatchError',
      message: 'operation 0: path not found',
    });
  });
});

describe('following: array indices', () => {
  const doc = [10, 20];

  test('valid index names the element', () => {
    assert.deepStrictEqual(check(doc, '/1', 20), [10, 20]);
    assert.deepStrictEqual(check(doc, '/0', 10), [10, 20]);
  });

  test('index at length is not found', () => {
    assert.throws(() => check(doc, '/2'), {
      name: 'PatchError',
      message: 'operation 0: path not found',
    });
  });

  test('"-" is not found, not a bad index', () => {
    assert.throws(() => check(doc, '/-'), {
      name: 'PatchError',
      message: 'operation 0: path not found',
    });
  });

  test('huge index is not found', () => {
    assert.throws(() => check(doc, '/99999999999999999999'), {
      name: 'PatchError',
      message: 'operation 0: path not found',
    });
  });

  const bad = ['01', '+1', '1.0', '1e0', ' 1', '1 ', '-1', 'length', '', '0x1', '١'];
  for (const token of bad) {
    test(`bad index token ${JSON.stringify(token)}`, () => {
      assert.throws(() => check(doc, `/${token}`), {
        name: 'PatchError',
        message: 'operation 0: bad index',
      });
    });
  }
});

describe('following: scalars name nothing', () => {
  const cases = [
    [{ s: 'abc' }, '/s/0'],
    [{ s: 'abc' }, '/s/length'],
    [{ n: 5 }, '/n/0'],
    [{ b: true }, '/b/x'],
    [{ z: null }, '/z/0'],
  ];
  for (const [doc, path] of cases) {
    test(`${JSON.stringify(doc)} ${path}`, () => {
      assert.throws(() => check(doc, path), {
        name: 'PatchError',
        message: 'operation 0: path not found',
      });
    });
  }
});

describe('following: first failing token wins', () => {
  test('bad index before later tokens', () => {
    assert.throws(() => check({ a: [1] }, '/a/x/y'), {
      name: 'PatchError',
      message: 'operation 0: bad index',
    });
  });

  test('missing member before bad later tokens', () => {
    assert.throws(() => check({ a: [1] }, '/b/0/x'), {
      name: 'PatchError',
      message: 'operation 0: path not found',
    });
  });

  test('nested array bad index', () => {
    assert.throws(() => check([[1, 2]], '/0/01'), {
      name: 'PatchError',
      message: 'operation 0: bad index',
    });
  });
});

describe('PatchError shape', () => {
  test('first operation', () => {
    expectPatchError({}, [{ op: 'test', path: '/x', value: 1 }], 'operation 0: path not found', 0);
  });

  test('later operation reports its index', () => {
    const patch = [
      { op: 'test', path: '/a', value: 1 },
      { op: 'test', path: '/b', value: 1 },
    ];
    expectPatchError({ a: 1 }, patch, 'operation 1: path not found', 1);
  });
});
