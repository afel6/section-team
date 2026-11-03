import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer } from '../jsonpatch.mjs';

describe('parsePointer valid', () => {
  const cases = [
    ['', []],
    ['/', ['']],
    ['/a//b/', ['a', '', 'b', '']],
    ['/~01', ['~1']],
    ['/~10', ['/0']],
    ['/~0~1', ['~/']],
    ['/~1~0', ['/~']],
    ['/~0/~1', ['~', '/']],
    ['/~00', ['~0']],
    ['/~0~01', ['~~1']],
    ['/~1~11', ['//1']],
    ['/\u0000\r\n', ['\u0000\r\n']],
    ['/a~1b', ['a/b']],
    ['/~0', ['~']],
    ['/é/日本', ['é', '日本']],
    ['/a b', ['a b']],
  ];
  for (const [pointer, tokens] of cases) {
    test(`parses ${JSON.stringify(pointer)}`, () => {
      assert.deepEqual(parsePointer(pointer), tokens);
    });
  }

  test('returns a new array each call', () => {
    const first = parsePointer('/a/b');
    const second = parsePointer('/a/b');
    assert.notEqual(first, second);
    first.push('x');
    first[0] = 'changed';
    assert.deepEqual(parsePointer('/a/b'), ['a', 'b']);
    const e1 = parsePointer('');
    e1.push('x');
    assert.deepEqual(parsePointer(''), []);
  });
});

describe('parsePointer invalid', () => {
  const bad = ['a', ' /a', '#/a', '/~', '/~2', '/a~', '/~a', '/~~0', '/a/~/b', '~0'];
  for (const pointer of bad) {
    test(`rejects ${JSON.stringify(pointer)}`, () => {
      assert.throws(
        () => parsePointer(pointer),
        (err) => {
          assert.ok(err instanceof SyntaxError);
          assert.equal(err.message, 'invalid pointer');
          return true;
        },
      );
    });
  }
});

describe('parsePointer non-string', () => {
  const values = [
    ['String object', new String('/a')],
    ['empty String object', new String('')],
    ['undefined', undefined],
    ['null', null],
    ['number', 1],
    ['array', ['/a']],
    ['object', {}],
    ['boolean', true],
  ];
  for (const [label, value] of values) {
    test(`TypeError for ${label}`, () => {
      assert.throws(
        () => parsePointer(value),
        (err) => {
          assert.ok(err instanceof TypeError);
          assert.ok(!(err instanceof SyntaxError));
          assert.equal(err.message, 'pointer must be a string');
          return true;
        },
      );
    });
  }

  test('no argument is a TypeError', () => {
    assert.throws(() => parsePointer(), { name: 'TypeError', message: 'pointer must be a string' });
  });
});
