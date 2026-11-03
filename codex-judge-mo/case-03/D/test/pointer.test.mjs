// parsePointer: decoding, validation and error types (spec: Pointers).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePointer } from '../jsonpatch.mjs';

function assertSyntaxError(pointer) {
  assert.throws(
    () => parsePointer(pointer),
    (err) => {
      assert.ok(err instanceof SyntaxError, 'must be a SyntaxError');
      assert.ok(!(err instanceof TypeError), 'must not be a TypeError');
      assert.equal(err.message, 'invalid pointer');
      return true;
    },
  );
}

function assertTypeError(pointer) {
  assert.throws(
    () => parsePointer(pointer),
    (err) => {
      assert.ok(err instanceof TypeError, 'must be a TypeError');
      assert.ok(!(err instanceof SyntaxError), 'must not be a SyntaxError');
      assert.equal(err.message, 'pointer must be a string');
      return true;
    },
  );
}

describe('parsePointer: token splitting', () => {
  const cases = [
    ['the empty string has no tokens', '', []],
    ['"/" has one empty token', '/', ['']],
    ['empty tokens in the middle and at the end are kept', '/a//b/', ['a', '', 'b', '']],
    ['plain tokens are split on slash', '/a/b', ['a', 'b']],
    ['a single token', '/a', ['a']],
    ['two empty tokens', '//', ['', '']],
    ['a leading empty token', '//a', ['', 'a']],
    ['a space is an ordinary character', '/ a', [' a']],
    ['a token with trailing space', '/a /b', ['a ', 'b']],
    ['digits are plain tokens', '/0/01/-', ['0', '01', '-']],
    ['__proto__ is an ordinary token', '/__proto__/constructor', ['__proto__', 'constructor']],
  ];
  for (const [name, pointer, expected] of cases) {
    test(name, () => {
      assert.deepEqual(parsePointer(pointer), expected);
    });
  }
});

describe('parsePointer: escape decoding', () => {
  const cases = [
    ['~01 decodes to the two characters ~1 (not to a slash)', '/~01', ['~1']],
    ['~10 decodes to a slash followed by 0 (not to a tilde)', '/~10', ['/0']],
    ['~0~1 decodes to tilde then slash', '/~0~1', ['~/']],
    ['~1~0 decodes to slash then tilde', '/~1~0', ['/~']],
    ['~00 decodes to tilde followed by 0', '/~00', ['~0']],
    ['~11 decodes to slash followed by 1', '/~11', ['/1']],
    ['~0 alone decodes to a tilde', '/~0', ['~']],
    ['~1 alone decodes to a slash and does not split', '/~1', ['/']],
    ['escapes inside several tokens', '/a~1b/c~0d', ['a/b', 'c~d']],
    ['an escape followed by a separator', '/~1/~0', ['/', '~']],
    ['a tilde escape at token end followed by empty token', '/~0/', ['~', '']],
  ];
  for (const [name, pointer, expected] of cases) {
    test(name, () => {
      assert.deepEqual(parsePointer(pointer), expected);
    });
  }
});

describe('parsePointer: characters are kept exactly', () => {
  test('non-ASCII characters are kept as they are', () => {
    assert.deepEqual(parsePointer('/é/日本'), ['é', '日本']);
  });

  test('control characters NUL, LF and CR are kept as they are', () => {
    const tokens = parsePointer('/\u0000\n\r');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0], '\u0000\n\r');
    assert.equal(tokens[0].length, 3);
  });

  test('decomposed e + combining accent is not normalized', () => {
    const tokens = parsePointer('/é');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].length, 2);
    assert.equal(tokens[0], 'é');
    assert.notEqual(tokens[0], 'é');
  });

  test('precomposed é stays one UTF-16 unit', () => {
    const tokens = parsePointer('/é');
    assert.equal(tokens[0].length, 1);
    assert.equal(tokens[0], 'é');
  });

  test('an astral character is kept as a surrogate pair', () => {
    const tokens = parsePointer('/\u{1F600}');
    assert.equal(tokens[0].length, 2);
    assert.equal(tokens[0], '\u{1F600}');
  });
});

describe('parsePointer: returns a new array', () => {
  test('mutating a result does not affect the next call', () => {
    const first = parsePointer('/a/b');
    first.push('x');
    first[0] = 'changed';
    assert.deepEqual(parsePointer('/a/b'), ['a', 'b']);
  });

  test('two calls return different arrays', () => {
    const first = parsePointer('/a');
    const second = parsePointer('/a');
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
  });

  test('two calls on the empty pointer return different arrays', () => {
    const first = parsePointer('');
    const second = parsePointer('');
    assert.notEqual(first, second);
    first.push('x');
    assert.deepEqual(second, []);
    assert.deepEqual(parsePointer(''), []);
  });

  test('the result is a real array', () => {
    assert.ok(Array.isArray(parsePointer('/a')));
    assert.ok(Array.isArray(parsePointer('')));
  });
});

describe('parsePointer: invalid pointers throw SyntaxError "invalid pointer"', () => {
  const cases = [
    ['a non-empty pointer must start with a slash: "a"', 'a'],
    ['a fragment form is not a pointer: "#/a"', '#/a'],
    ['a leading space is not allowed: " /a"', ' /a'],
    ['a lone tilde', '~'],
    ['a tilde at the end of the token after slash', '/~'],
    ['a tilde at the end of a later token', '/a~'],
    ['~2 is not an escape', '/~2'],
    ['~a is not an escape', '/~a'],
    ['~~ is not an escape', '/~~'],
    ['a tilde followed by a separator', '/~/'],
    ['a bad escape in a middle token', '/a/~x/b'],
    ['~- is not an escape', '/~-1'],
    ['a bad escape after a good one', '/~0~'],
    ['a trailing space-only prefix: "x/"', 'x/'],
    ['a lone space', ' '],
    ['a lone backslash', '\\'],
  ];
  for (const [name, pointer] of cases) {
    test(name, () => assertSyntaxError(pointer));
  }
});

describe('parsePointer: non-strings throw TypeError "pointer must be a string"', () => {
  const cases = [
    ['undefined', undefined],
    ['null', null],
    ['the number 0', 0],
    ['the number 1', 1],
    ['true', true],
    ['false', false],
    ['a String object with a path', new String('/a')],
    ['an empty String object', new String('')],
    ['an array holding a pointer', ['/a']],
    ['an empty array', []],
    ['an empty object', {}],
    ['a symbol', Symbol('x')],
    ['a function', function pointer() {}],
    ['an arrow function', () => '/a'],
    ['a bigint', 1n],
    ['NaN', NaN],
  ];
  for (const [name, value] of cases) {
    test(`rejects ${name}`, () => assertTypeError(value));
  }

  test('an object with a toString returning a pointer is still rejected', () => {
    assertTypeError({ toString: () => '/a' });
  });

  test('called with no argument it is rejected', () => {
    assert.throws(
      () => parsePointer(),
      (err) => err instanceof TypeError && err.message === 'pointer must be a string',
    );
  });
});
