import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer } from '../jsonpatch.mjs';

const isTypeError = (err) =>
  err instanceof TypeError && err.constructor === TypeError && err.message === 'pointer must be a string';
const isSyntaxError = (err) =>
  err instanceof SyntaxError && err.constructor === SyntaxError && err.message === 'invalid pointer';

describe('parsePointer: structure', () => {
  const cases = [
    ['', []],
    ['/', ['']],
    ['/a//b/', ['a', '', 'b', '']],
    ['/a', ['a']],
    ['/a/b', ['a', 'b']],
    ['//', ['', '']],
    ['/ ', [' ']],
  ];
  for (const [pointer, expected] of cases) {
    test(`parses ${JSON.stringify(pointer)}`, () => {
      assert.deepEqual(parsePointer(pointer), expected);
    });
  }
});

describe('parsePointer: escapes', () => {
  const cases = [
    ['/~01', ['~1']],
    ['/~10', ['/0']],
    ['/~0', ['~']],
    ['/~1', ['/']],
    ['/~0~1', ['~/']],
    ['/~00', ['~0']],
    ['/~11', ['/1']],
    ['/a~1b/c~0d', ['a/b', 'c~d']],
    ['/~0~0', ['~~']],
  ];
  for (const [pointer, expected] of cases) {
    test(`decodes ${JSON.stringify(pointer)}`, () => {
      assert.deepEqual(parsePointer(pointer), expected);
    });
  }
});

describe('parsePointer: result', () => {
  test('returns a new array on each call', () => {
    const a = parsePointer('/a');
    const b = parsePointer('/a');
    assert.notEqual(a, b);
    assert.deepEqual(a, b);
  });

  test('returns a new array for the empty pointer', () => {
    assert.notEqual(parsePointer(''), parsePointer(''));
  });

  test('result is a real Array', () => {
    assert.equal(Array.isArray(parsePointer('/a')), true);
    assert.equal(Array.isArray(parsePointer('')), true);
  });

  test('preserves non-ASCII characters and controls', () => {
    assert.deepEqual(parsePointer('/é/日本/\u0000/\n'), ['é', '日本', '\u0000', '\n']);
  });

  test('does not normalize Unicode', () => {
    const decomposed = '/é';
    const [token] = parsePointer(decomposed);
    assert.equal(token, 'é');
    assert.notEqual(token, 'é');
    assert.equal(parsePointer('/é')[0], 'é');
  });
});

describe('parsePointer: non-string input', () => {
  const withToString = { toString: () => '/a' };
  const cases = [
    ['String object', new String('/a')],
    ['empty String object', new String('')],
    ['undefined', undefined],
    ['null', null],
    ['0', 0],
    ['1', 1],
    ['true', true],
    ['empty array', []],
    ['array of pointer', ['/a']],
    ['plain object', {}],
    ['symbol', Symbol('x')],
    ['function', () => '/a'],
    ['object with toString', withToString],
  ];
  for (const [label, input] of cases) {
    test(`throws TypeError for ${label}`, () => {
      assert.throws(() => parsePointer(input), isTypeError);
    });
  }

  test('throws TypeError when called with no argument', () => {
    assert.throws(() => parsePointer(), isTypeError);
  });
});

describe('parsePointer: invalid pointers', () => {
  const invalid = ['a', ' /a', '#/a', '~0', '/~', '/~2', '/a~', '/~a', '/~/', '/a/~', '/~~0', '/~01~', '\\/a'];
  for (const pointer of invalid) {
    test(`throws SyntaxError for ${JSON.stringify(pointer)}`, () => {
      assert.throws(() => parsePointer(pointer), isSyntaxError);
    });
  }
});
