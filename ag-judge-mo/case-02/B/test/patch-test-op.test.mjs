import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch } from '../jsonpatch.mjs';
import { expectPatchError } from './helpers/assert-patch-error.mjs';

const PATH_NOT_FOUND = 'path not found';
const BAD_INDEX = 'bad index';

const fail = (doc, ops, reason, i = 0) =>
  expectPatchError(() => applyPatch(doc, ops), `operation ${i}: ${reason}`, i);
const failOp = (doc, op, reason) => fail(doc, [op], reason);
const applyOps = (doc, ...ops) => applyPatch(doc, ops);

describe('test', () => {
  const passes = (docValue, value) => {
    const doc = { a: docValue };
    const r = applyOps(doc, { op: 'test', path: '/a', value });
    assert.deepEqual(r, doc);
    return r;
  };
  const differs = (docValue, value) =>
    failOp({ a: docValue }, { op: 'test', path: '/a', value }, 'test failed');

  test('passing test leaves document equal and returns a copy', () => {
    const doc = { a: [1, { b: 2 }] };
    const r = applyOps(doc, { op: 'test', path: '/a', value: [1, { b: 2 }] });
    assert.deepEqual(r, doc);
    assert.notEqual(r, doc);
    assert.notEqual(r.a, doc.a);
  });

  test('numbers', () => {
    passes(JSON.parse('1'), JSON.parse('1.0'));
    passes(JSON.parse('1'), JSON.parse('1e0'));
    passes(-0, 0);
    passes(0, -0);
    differs(1, '1');
    differs(1, 2);
  });

  test('strings are compared exactly', () => {
    differs('é', 'é');
    differs('é', 'é');
    differs('a', 'a ');
    passes('abc', 'abc');
    const nfc = 'é';
    const nfd = 'é';
    assert.notEqual(nfc, nfd);
    assert.equal(nfc.normalize('NFD'), nfd);
    differs(nfc, nfd);
    differs(nfd, nfc);
    passes(nfd, nfd);
  });

  test('objects ignore key order', () => {
    passes({ a: 1, b: 2 }, { b: 2, a: 1 });
    passes({ x: { a: 1, b: 2 } }, { x: { b: 2, a: 1 } });
    differs({ a: 1 }, { a: 1, b: 2 });
    differs({ a: 1, b: 2 }, { a: 1 });
    differs({ a: 1 }, { b: 1 });
    differs({ a: 1 }, { a: 2 });
  });

  test('arrays are order-sensitive', () => {
    differs([1, 2], [2, 1]);
    differs([1], [1, 2]);
    differs([1, 2], [1]);
    passes([], []);
    passes({}, {});
  });

  test('types never cross', () => {
    differs([], {});
    differs({}, []);
    differs({ 0: 1 }, [1]);
    differs([1], { 0: 1 });
    differs(null, {});
    passes(null, null);
    differs(false, 0);
    differs(true, 1);
    differs('', null);
    differs(null, '');
    passes(true, true);
    passes(false, false);
  });

  test('nested structures', () => {
    passes([{ a: [1, { b: null }] }], [{ a: [1, { b: null }] }]);
    differs([{ a: [1, { b: null }] }], [{ a: [1, { b: 0 }] }]);
  });

  test('empty path tests the whole document', () => {
    assert.deepEqual(applyOps({ a: 1 }, { op: 'test', path: '', value: { a: 1 } }), { a: 1 });
    failOp({ a: 1 }, { op: 'test', path: '', value: { a: 2 } }, 'test failed');
  });

  test('missing path and bad index', () => {
    failOp({}, { op: 'test', path: '/x', value: 1 }, PATH_NOT_FOUND);
    failOp([1], { op: 'test', path: '/01', value: 1 }, BAD_INDEX);
  });

  test('failure reports the index of the op', () => {
    const patch = [
      { op: 'add', path: '/b', value: 1 },
      { op: 'test', path: '/b', value: 1 },
      { op: 'test', path: '/b', value: 2 },
    ];
    fail({}, patch, 'test failed', 2);
  });
});
