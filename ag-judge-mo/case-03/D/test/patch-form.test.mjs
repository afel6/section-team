// applyPatch: patch shape, form rules, their precedence and error shape (spec: Patches, Form rules, Errors).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, PatchError } from '../jsonpatch.mjs';
import { assertExact, assertPatchError, assertNoSharing } from './helpers.mjs';

const passingTest = () => ({ op: 'test', path: '', value: {} });
const validOps = () => [passingTest(), passingTest()];

// An object with the given own members, none inherited.
const own = (members) => Object.assign(Object.create(null), members);

// An operation whose `name` member is own but not enumerable.
function hidden(base, name, value) {
  const op = { ...base };
  delete op[name];
  return Object.defineProperty(op, name, { value, enumerable: false, writable: true, configurable: true });
}

// Asserts a form error at index 0 and, after two valid ops, at index 2.
function assertFormError(bad, reason) {
  assertPatchError({}, [bad], `operation 0: ${reason}`, 0);
  assertPatchError({}, [...validOps(), bad], `operation 2: ${reason}`, 2);
}

describe('patch must be an array', () => {
  const cases = [
    ['undefined', undefined],
    ['null', null],
    ['a plain object', {}],
    ['a string "[]"', '[]'],
    ['the number 0', 0],
    ['an array-like with length 0', { length: 0 }],
    ['a Uint8Array', new Uint8Array(0)],
    ['an arguments-like object', { 0: { op: 'test', path: '', value: 1 }, length: 1 }],
    ['true', true],
    ['a function', () => []],
  ];
  for (const [name, patch] of cases) {
    test(`${name} gives "patch must be an array" with index null`, () => {
      assertPatchError({ a: 1 }, patch, 'patch must be an array', null);
    });
  }

  test('an empty array is fine and returns a copy of the document', () => {
    const doc = { a: [1, { b: -0 }] };
    const result = applyPatch(doc, []);
    assertExact(result, { a: [1, { b: -0 }] });
    assertNoSharing(result, doc);
  });
});

describe('PatchError shape', () => {
  function catchError(patch) {
    try {
      applyPatch({}, patch);
    } catch (err) {
      return err;
    }
    return assert.fail('nothing thrown');
  }

  test('a form error is a PatchError and an Error named PatchError', () => {
    const err = catchError([{ op: 'nope' }]);
    assert.ok(err instanceof PatchError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'PatchError');
    assert.equal(err.message, 'operation 0: bad op');
    assert.equal(typeof err.index, 'number');
    assert.equal(err.index, 0);
  });

  test('a non-array error is a PatchError with index exactly null', () => {
    const err = catchError(undefined);
    assert.ok(err instanceof PatchError);
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'PatchError');
    assert.equal(err.index, null);
    assert.notEqual(err.index, undefined);
    assert.ok(Object.hasOwn(err, 'index'));
  });

  test('an apply error also carries a numeric index', () => {
    const err = catchError([passingTest(), { op: 'remove', path: '/zz' }]);
    assert.ok(err instanceof PatchError);
    assert.equal(typeof err.index, 'number');
    assert.equal(err.index, 1);
    assert.equal(err.message, 'operation 1: path not found');
  });
});

describe('not an object', () => {
  const fn = () => {};
  const fnWithMembers = Object.assign(() => {}, { op: 'add', path: '/a', value: 1 });
  const cases = [
    ['null', null],
    ['undefined', undefined],
    ['a number', 1],
    ['a string', 'add'],
    ['true', true],
    ['an empty array', []],
    ['an array holding an operation', [{ op: 'add' }]],
    ['a function', fn],
    ['a function with own op, path and value', fnWithMembers],
    ['a symbol', Symbol('op')],
    ['a bigint', 1n],
  ];
  for (const [name, bad] of cases) {
    test(`${name} is "not an object" at index 0 and index 2`, () => assertFormError(bad, 'not an object'));
  }

  test('a hole in a one-element array is "not an object" at index 0', () => {
    assertPatchError({}, new Array(1), 'operation 0: not an object', 0);
  });

  test('a trailing hole after a valid op is "not an object" at index 1', () => {
    // eslint-disable-next-line no-sparse-arrays
    assertPatchError({}, [{ op: 'test', path: '', value: {} }, ,], 'operation 1: not an object', 1);
  });

  test('a hole in the middle is "not an object" at index 1', () => {
    const patch = [passingTest(), , passingTest()];
    assertPatchError({}, patch, 'operation 1: not an object', 1);
  });
});

describe('objects that are not plain still go on to the next rule', () => {
  test('a String object has no own op: "bad op"', () => {
    assertFormError(new String('x'), 'bad op');
  });

  test('a Date has no own op: "bad op"', () => {
    assertFormError(new Date(0), 'bad op');
  });

  test('a Date with own op, path and value is applied', () => {
    const op = Object.assign(new Date(0), { op: 'add', path: '/a', value: 1 });
    assertExact(applyPatch({}, [op]), { a: 1 });
  });

  test('a String object with own op, path and value is applied', () => {
    const op = Object.assign(new String('s'), { op: 'add', path: '/a', value: 1 });
    assertExact(applyPatch({}, [op]), { a: 1 });
  });

  test('an object without a prototype is applied', () => {
    const op = own({ op: 'add', path: '/a', value: 1 });
    assertExact(applyPatch({}, [op]), { a: 1 });
  });
});

describe('bad op', () => {
  const base = { path: '/a', value: 1 };
  const cases = [
    ['missing', { ...base }],
    ['null', { op: null, ...base }],
    ['undefined', { op: undefined, ...base }],
    ['upper case ADD', { op: 'ADD', ...base }],
    ['trailing space "add "', { op: 'add ', ...base }],
    ['capitalised Add', { op: 'Add', ...base }],
    ['a String object', { op: new String('add'), ...base }],
    ['an array', { op: ['add'], ...base }],
    ['a number', { op: 1, ...base }],
    ['an unknown name', { op: 'merge', ...base }],
    ['the empty string', { op: '', ...base }],
    ['inherited from the prototype', Object.create({ op: 'add', path: '/a', value: 1 })],
    ['inherited op with own path and value', Object.assign(Object.create({ op: 'add' }), base)],
  ];
  for (const [name, bad] of cases) {
    test(`op ${name} gives "bad op"`, () => assertFormError(bad, 'bad op'));
  }

  test('a non-enumerable own op counts as present', () => {
    assertExact(applyPatch({}, [hidden({ op: 'add', ...base }, 'op', 'add')]), { a: 1 });
  });
});

describe('bad path', () => {
  const cases = [
    ['missing', { op: 'add', value: 1 }],
    ['null', { op: 'add', path: null, value: 1 }],
    ['a number', { op: 'add', path: 5, value: 1 }],
    ['a String object', { op: 'add', path: new String('/a'), value: 1 }],
    ['not starting with a slash', { op: 'add', path: 'a', value: 1 }],
    ['containing a bad escape', { op: 'add', path: '/~2', value: 1 }],
    ['an array', { op: 'add', path: ['/a'], value: 1 }],
    ['inherited', Object.assign(Object.create({ path: '/a' }), { op: 'add', value: 1 })],
    ['bad on remove', { op: 'remove', path: 'x' }],
    ['bad on replace', { op: 'replace', path: '~', value: 1 }],
    ['bad on test', { op: 'test', path: '#/a', value: 1 }],
    ['bad on move', { op: 'move', path: 'a', from: '/a' }],
    ['bad on copy', { op: 'copy', path: ' /a', from: '/a' }],
  ];
  for (const [name, bad] of cases) {
    test(`path ${name} gives "bad path"`, () => assertFormError(bad, 'bad path'));
  }

  test('a non-enumerable own path counts as present', () => {
    assertExact(applyPatch({}, [hidden({ op: 'add', path: '/a', value: 1 }, 'path', '/a')]), { a: 1 });
  });
});

describe('bad from (move and copy only)', () => {
  const badFroms = [
    ['missing', undefined, false],
    ['a number', 5, true],
    ['a String object', new String('/a'), true],
    ['not starting with a slash', 'x', true],
    ['containing a bad escape', '/~', true],
  ];
  for (const opName of ['move', 'copy']) {
    for (const [name, from, present] of badFroms) {
      test(`${opName} with from ${name} gives "bad from"`, () => {
        const bad = { op: opName, path: '/z' };
        if (present) bad.from = from;
        assertFormError(bad, 'bad from');
      });
    }
    test(`${opName} with an inherited from gives "bad from"`, () => {
      const bad = Object.assign(Object.create({ from: '/a' }), { op: opName, path: '/z' });
      assertFormError(bad, 'bad from');
    });
  }

  for (const opName of ['move', 'copy']) {
    test(`${opName} with an own from of undefined gives "bad from"`, () => {
      assertFormError({ op: opName, path: '/z', from: undefined }, 'bad from');
    });

    test(`${opName} with a from of null gives "bad from"`, () => {
      assertFormError({ op: opName, path: '/z', from: null }, 'bad from');
    });
  }

  test('a non-enumerable own from counts as present: move applies', () => {
    const op = hidden({ op: 'move', path: '/b' }, 'from', '/a');
    assertExact(applyPatch({ a: 1 }, [op]), { b: 1 });
  });

  test('a non-enumerable own from counts as present: copy applies', () => {
    const op = hidden({ op: 'copy', path: '/b' }, 'from', '/a');
    assertExact(applyPatch({ a: 1 }, [op]), { a: 1, b: 1 });
  });

  test('from is ignored on add even when it is not a string', () => {
    assertExact(applyPatch({}, [{ op: 'add', path: '/a', value: 1, from: 5 }]), { a: 1 });
  });

  test('from is ignored on remove even when it is not a pointer', () => {
    assertExact(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a', from: 'bad' }]), {});
  });

  test('from is ignored on replace', () => {
    assertExact(applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 2, from: {} }]), { a: 2 });
  });

  test('from is ignored on test', () => {
    assertExact(applyPatch({ a: 1 }, [{ op: 'test', path: '/a', value: 1, from: null }]), { a: 1 });
  });
});

describe('missing value (add, replace, test)', () => {
  for (const name of ['add', 'replace', 'test']) {
    test(`${name} without value gives "missing value"`, () => {
      assertFormError({ op: name, path: '/a' }, 'missing value');
    });

    test(`${name} with an inherited value gives "missing value"`, () => {
      const bad = Object.assign(Object.create({ value: 1 }), { op: name, path: '/a' });
      assertFormError(bad, 'missing value');
    });
  }

  test('a value of null is present: add null works', () => {
    assertExact(applyPatch({}, [{ op: 'add', path: '/a', value: null }]), { a: null });
  });

  test('a non-enumerable own value counts as present and is applied', () => {
    const op = hidden({ op: 'add', path: '/a' }, 'value', 7);
    assertExact(applyPatch({}, [op]), { a: 7 });
  });

  test('value is ignored on remove, also when own and undefined', () => {
    const op = { op: 'remove', path: '/a', value: undefined };
    assertExact(applyPatch({ a: 1, b: 2 }, [op]), { b: 2 });
  });

  test('value is ignored on move', () => {
    const op = { op: 'move', from: '/a', path: '/b', value: 9 };
    assertExact(applyPatch({ a: 1 }, [op]), { b: 1 });
  });

  test('value is ignored on copy', () => {
    const op = { op: 'copy', from: '/a', path: '/b', value: 9 };
    assertExact(applyPatch({ a: 1 }, [op]), { a: 1, b: 1 });
  });
});

describe('cannot remove root', () => {
  test('remove with path "" is refused', () => {
    assertFormError({ op: 'remove', path: '' }, 'cannot remove root');
  });

  test('remove of a non-root path is not refused by the form rules', () => {
    assertExact(applyPatch({ a: 1 }, [{ op: 'remove', path: '/a' }]), {});
  });
});

describe('cannot move into own child', () => {
  const refused = [
    ['from "" into "/a"', '', '/a'],
    ['from "/a" into "/a/b"', '/a', '/a/b'],
    ['from "/a" into "/a/b/c"', '/a', '/a/b/c'],
    ['from "/a/b" into "/a/b/c"', '/a/b', '/a/b/c'],
    ['from "" into "/"', '', '/'],
    ['from "/a" into "/a/"', '/a', '/a/'],
  ];
  for (const [name, from, path] of refused) {
    test(`move ${name} is refused`, () => {
      assertFormError({ op: 'move', from, path }, 'cannot move into own child');
    });
  }

  const allowed = [
    ['from "/a" to "/ab" (not a token prefix)', { a: 1 }, '/a', '/ab', { ab: 1 }],
    ['from "/a/b" to "/a"', { a: { b: 2 } }, '/a/b', '/a', { a: 2 }],
    ['from "/a" to "/a" (same path)', { a: 1 }, '/a', '/a', { a: 1 }],
    ['from "" to "" (same path)', { a: [1] }, '', '', { a: [1] }],
    ['from "/a/b" to "/a/c"', { a: { b: 1 } }, '/a/b', '/a/c', { a: { c: 1 } }],
  ];
  for (const [name, doc, from, path, expected] of allowed) {
    test(`move ${name} passes the form rules`, () => {
      const result = applyPatch(doc, [{ op: 'move', from, path }]);
      assertExact(result, expected);
      assertNoSharing(result, doc);
    });
  }

  test('copy from "/a" to "/a/b" passes the form rules (fails later while applying)', () => {
    assertPatchError({ a: 1 }, [{ op: 'copy', from: '/a', path: '/a/b' }], 'operation 0: path not found', 0);
  });

  test('copy from "/a" to "/a/b" on an object adds inside the copy source', () => {
    const result = applyPatch({ a: {} }, [{ op: 'copy', from: '/a', path: '/a/b' }]);
    assertExact(result, { a: { b: {} } });
  });
});

describe('precedence: the first rule that applies wins', () => {
  const cases = [
    ['bad op wins over missing path', { op: 'bad' }, 'bad op'],
    ['bad path wins over missing value', { op: 'add', path: 5 }, 'bad path'],
    ['bad path wins over bad from', { op: 'move', path: 5, from: 5 }, 'bad path'],
    ['bad from wins over a copy with good path', { op: 'copy', path: '/a', from: 5 }, 'bad from'],
    ['bad from on a move with a non-string from and a deeper path', { op: 'move', path: '/a/b', from: 5 }, 'bad from'],
    ['bad path wins over missing value for "/~"', { op: 'add', path: '/~' }, 'bad path'],
    ['cannot remove root wins over junk members', { op: 'remove', path: '', from: 1, value: 2, x: {} }, 'cannot remove root'],
    ['bad path wins over missing value on test', { op: 'test', path: 'x' }, 'bad path'],
    ['add at root without value gives missing value', { op: 'add', path: '' }, 'missing value'],
  ];
  for (const [name, bad, reason] of cases) {
    test(name, () => assertPatchError({ a: 1 }, [bad], `operation 0: ${reason}`, 0));
  }
});

describe('all operations are checked before any is applied', () => {
  test('a later bad op is reported instead of an earlier test failure', () => {
    const patch = [{ op: 'test', path: '/a', value: 999 }, { op: 'nope' }];
    assertPatchError({ a: 1 }, patch, 'operation 1: bad op', 1);
  });

  test('a later hole is reported instead of an earlier path failure', () => {
    // eslint-disable-next-line no-sparse-arrays
    const patch = [{ op: 'remove', path: '/missing' }, ,];
    assertPatchError({ a: 1 }, patch, 'operation 1: not an object', 1);
  });

  test('a later remove of the root is reported instead of applying the add', () => {
    const patch = [{ op: 'add', path: '/x', value: 1 }, { op: 'remove', path: '' }];
    assertPatchError({ a: 1 }, patch, 'operation 1: cannot remove root', 1);
  });

  test('the document and patch are untouched when a form error stops the patch', () => {
    const doc = { a: 1 };
    const patch = [{ op: 'add', path: '/x', value: 1 }, { op: 'nope' }];
    assertPatchError(doc, patch, 'operation 1: bad op', 1);
    assertExact(doc, { a: 1 });
    assertExact(patch[0], { op: 'add', path: '/x', value: 1 });
  });
});

describe('the first failing operation is reported', () => {
  test('two bad operations give the first one', () => {
    assertPatchError({}, [{ op: 'x' }, { op: 'y' }], 'operation 0: bad op', 0);
  });

  test('two different reasons give the earlier one', () => {
    const patch = [passingTest(), { op: 'add', path: '/a' }, { op: 'nope' }];
    assertPatchError({}, patch, 'operation 1: missing value', 1);
  });

  test('the message format is "operation <i>: <reason>" at index 10 of 11 ops', () => {
    const patch = Array.from({ length: 10 }, passingTest);
    patch.push({ op: 'copy', path: '/a' });
    assert.equal(patch.length, 11);
    assertPatchError({}, patch, 'operation 10: bad from', 10);
  });

  test('a multi-digit index appears without padding', () => {
    const patch = Array.from({ length: 100 }, passingTest);
    patch.push(null);
    assertPatchError({}, patch, 'operation 100: not an object', 100);
  });
});
