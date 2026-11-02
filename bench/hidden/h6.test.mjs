// Hidden tests for held-out task h6 (jsonpatch.mjs and jsonpatch-cli.mjs). Library calls run in a child process with a time
// limit, so an endless loop or a polluted prototype fails one test, not the whole file. Every applyPatch call also checks that
// doc and patch are unchanged afterwards (also after a throw), that the result shares no object with them, and that no property
// was added to Object.prototype, Array.prototype or Function.prototype. CLI cases compare exit code, stdout and stderr exactly.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, openSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const DIR = process.env.TARGET_DIR
if (!DIR) throw new Error('TARGET_DIR is not set')
const [LIB, CLI] = [pathToFileURL(join(DIR, 'jsonpatch.mjs')).href, join(DIR, 'jsonpatch-cli.mjs')]
const [USAGE, MARK, NEG0, LIMIT, BRIEF] = ['Usage: node jsonpatch-cli.mjs <patch> [<doc>]', '@@h6-result@@', '@@h6-negative-zero@@', 1048576, 2000]
const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'))
let root
before(() => { root = mkdtempSync(join(tmpdir(), 'h6-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 }) })

// A text form of a value that shows member order, -0, holes, non-enumerable members (~) and exotic prototypes.
// It runs in this process and, as source text, in the child.
function show (v, seen = new Set()) {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v)
  if (typeof v === 'string') return JSON.stringify(v)
  if (v === null || !['object', 'function', 'symbol', 'bigint'].includes(typeof v)) return String(v)
  if (typeof v !== 'object') return typeof v === 'bigint' ? `${v}n` : `<${typeof v}>`
  if (seen.has(v)) return '<cycle>'
  seen.add(v)
  const proto = Object.getPrototypeOf(v)
  const tag = Array.isArray(v) || proto === Object.prototype || proto === null ? '' : `<${proto?.constructor?.name ?? 'object'}>`
  const member = k => `${Object.prototype.propertyIsEnumerable.call(v, k) ? '' : '~'}${JSON.stringify(k)}:${show(v[k], seen)}`
  const s = Array.isArray(v)
    ? `[${Array.from({ length: v.length }, (_, i) => (i in v ? show(v[i], seen) : '<hole>')).join(',')}]`
    : `${tag}{${Object.getOwnPropertyNames(v).map(member).join(',')}}`
  seen.delete(v)
  return s
}
// Runs in the child (serialized with String()): imports jsonpatch.mjs, makes each call, prints JSON after the mark.
async function child () {
  const { url, calls, mark, showSrc } = JSON.parse(require('node:fs').readFileSync(0, 'utf8'))
  const show = (0, eval)(`(${showSrc})`)
  let m
  const protos = () => [Object.prototype, Array.prototype, Function.prototype].map(p => Reflect.ownKeys(p).length).join()
  const reach = (...stack) => {
    const seen = new Set()
    while (stack.length) {
      const v = stack.pop()
      if (v === null || !['object', 'function'].includes(typeof v) || seen.has(v)) continue
      seen.add(v)
      for (const k of Object.getOwnPropertyNames(v)) stack.push(v[k])
    }
    return seen
  }
  const apply = (doc, patch) => {
    const [docBefore, patchBefore, protosBefore, inputs] = [show(doc), show(patch), protos(), reach(doc, patch)]
    let out
    try {
      const r = m.applyPatch(doc, patch)
      out = { result: show(r), shared: [...reach(r)].some(o => inputs.has(o)) }
    } catch (e) {
      out = { error: { patchError: e instanceof m.PatchError, isError: e instanceof Error, name: e?.name, message: String(e?.message ?? e), index: show(e?.index) } }
    }
    return { ...out, docChanged: show(doc) !== docBefore, patchChanged: show(patch) !== patchBefore, polluted: protos() !== protosBefore }
  }
  const pointer = p => {
    try {
      const a = m.parsePointer(p)
      return { result: show(a), fresh: Array.isArray(a) && a !== m.parsePointer(p) }
    } catch (e) { return { error: ['TypeError', 'SyntaxError'].find(k => e instanceof globalThis[k]) ?? String(e?.name), message: String(e?.message ?? e) } }
  }
  const h = { apply, pointer, ops: (...ops) => apply({ a: 1 }, ops) }
  const one = ([type, arg, arg2]) => {
    try {
      if (type === 'apply') return apply(JSON.parse(arg), JSON.parse(arg2))
      return type === 'pointer' ? pointer(JSON.parse(arg)) : (0, eval)(`(${arg})`)(h)
    } catch (e) { return { harness: String(e?.stack ?? e) } }
  }
  let out
  try {
    m = await import(url)
    const ok = ['applyPatch', 'parsePointer', 'PatchError'].every(k => typeof m[k] === 'function')
    out = ok ? calls.map(one) : { fatal: 'jsonpatch.mjs does not export the functions applyPatch, parsePointer and PatchError' }
  } catch (e) { out = { fatal: `cannot import jsonpatch.mjs: ${e?.message ?? e}` } }
  process.stdout.write(`\n${mark}${JSON.stringify(out)}\n`, () => process.exit(0))
}
function run (calls) {
  const input = JSON.stringify({ url: LIB, mark: MARK, showSrc: String(show), calls: calls.map(c => c.call) })
  const r = spawnSync(process.execPath, ['-e', `(${child})()`], { input, env, encoding: 'utf8', timeout: 10_000, maxBuffer: 64 << 20, windowsHide: true })
  if (r.error?.code === 'ETIMEDOUT') assert.fail('jsonpatch.mjs gave no answer within 10 s (endless loop?)')
  const at = (r.stdout ?? '').lastIndexOf(MARK)
  if (at < 0) assert.fail(`jsonpatch.mjs run ended without a result (exit ${r.status}): ${(r.stderr ?? '').trim().slice(0, 300)}`)
  const out = JSON.parse(r.stdout.slice(at + MARK.length).split('\n')[0])
  if (out.fatal) assert.fail(out.fatal)
  return out.map((o, i) => (o.harness ? assert.fail(`harness error in ${calls[i].label}: ${o.harness}`) : { label: calls[i].label, ...o }))
}
// JSON text that keeps -0; the child rebuilds values with JSON.parse, so "__proto__" keys become own members.
const J = v => JSON.stringify(v, (k, x) => (Object.is(x, -0) ? NEG0 : x)).replaceAll(`"${NEG0}"`, '-0')
const cut = s => (s.length > 240 ? `${s.slice(0, 240)}...` : s)
const toCall = c => (typeof c[0] === 'function' ? { call: ['js', String(c[0])], label: cut(String(c[0])) }
  : { call: ['apply', J(c[0]), J(c[1])], label: cut(`applyPatch(${J(c[0])}, ${J(c[1])})`) })
class Fail { constructor (message, index) { Object.assign(this, { message, index }) } }
const fail = (reason, i = 0) => new Fail(`operation ${i}: ${reason}`, i)
const [NOT_ARRAY, PNF, BAD_INDEX, FNF] = [new Fail('patch must be an array', null), fail('path not found'), fail('bad index'), fail('from not found')]
const SETTLED = { docChanged: false, patchChanged: false, polluted: false }
const outcome = want => (want instanceof Fail
  ? { error: { patchError: true, isError: true, name: 'PatchError', message: want.message, index: show(want.index) }, ...SETTLED }
  : { result: show(want), shared: false, ...SETTLED })
// Each case is [doc, patch, want] or [h => h.apply(doc, patch) or h.ops(...ops on {a: 1}), want]; want is the result or a Fail.
function check (...cases) {
  run(cases.map(toCall)).forEach((o, i) => assert.deepEqual(o, { label: o.label, ...outcome(cases[i].at(-1)) }))
}
const tokens = want => (Array.isArray(want) ? { result: show(want), fresh: true }
  : want === 'type' ? { error: 'TypeError', message: 'pointer must be a string' } : { error: 'SyntaxError', message: 'invalid pointer' })
// Each case is [pointer, tokens | 'type' | 'syntax'], or [h => h.pointer(...), 'type'].
function checkPointers (...cases) {
  const calls = cases.map(([p]) => (typeof p === 'function' ? toCall([p]) : { call: ['pointer', JSON.stringify(p)], label: `parsePointer(${JSON.stringify(p)})` }))
  run(calls).forEach((o, i) => assert.deepEqual(o, { label: o.label, ...tokens(cases[i][1]) }))
}
const [add, rep, tst] = ['add', 'replace', 'test'].map(op => (path, value) => ({ op, path, value }))
const [mv, cp, rm] = [(from, path) => ({ op: 'move', from, path }), (from, path) => ({ op: 'copy', from, path }), path => ({ op: 'remove', path })]
const nest = (n, inner = []) => { let v = inner; for (let i = 1; i < n; i++) v = [v]; return v }

// Pointers and following them
test('parsePointer returns a new array of tokens, decoding ~1 to / and ~0 to ~', () => checkPointers(
  ['', []], ['/', ['']], ['/a//b/', ['a', '', 'b', '']], ['//', ['', '']], ['/~01', ['~1']], ['/~10', ['/0']], ['/a~1b/c~0d', ['a/b', 'c~d']], ['/~0~1~00', ['~/~0']],
  ['/ /%25/\u00E9/\u{1F600}/\\', [' ', '%25', '\u00E9', '\u{1F600}', '\\']], ['/-/01/__proto__/constructor', ['-', '01', '__proto__', 'constructor']]))
test('a ~ not followed by 0 or 1, or a non-empty pointer not starting with /, is a SyntaxError: invalid pointer', () => checkPointers(
  ...['a', 'a/b', ' /a', '#/a', '#', '~1', '\\/a', '/~', '/~2', '/a~', '/~a', '/~~0', '/a/~/b', '/~1~', '/~0~2'].map(p => [p, 'syntax'])))
test('a pointer that is not a primitive string, a String object included, is a TypeError: pointer must be a string', () => checkPointers(
  [null, 'type'], [0, 'type'], [true, 'type'], [[], 'type'], [['/a'], 'type'], [{}, 'type'], [h => h.pointer(undefined), 'type'], [h => h.pointer(new String('/a')), 'type'],
  [h => h.pointer(new String('a')), 'type'], [h => h.pointer(Symbol('/a')), 'type'], [h => h.pointer(1n), 'type'], [h => h.pointer(() => '/a'), 'type']))
test('on an object a token names an own member only; __proto__, constructor and toString are ordinary names', () => check(
  [{ ['__proto__']: { x: 1 }, constructor: 2, toString: 3 }, [tst('/__proto__/x', 1), rep('/constructor', 20), rm('/toString'), add('/hasOwnProperty', 4), add('/__proto__/y', 2)],
    { ['__proto__']: { x: 1, y: 2 }, constructor: 20, hasOwnProperty: 4 }],
  ...[tst('/constructor', 1), rm('/toString'), rep('/__proto__', 1), add('/__proto__/polluted', 1)].map(op => [{}, [op], PNF]), [{ a: 1 }, [cp('/__proto__', '/b')], FNF],
  [{ a: {} }, [tst('/a/hasOwnProperty', 1)], PNF], [{ a: {} }, [add('/a/constructor/prototype/polluted', 1)], PNF], [{}, [add('/__proto__', 5)], { ['__proto__']: 5 }],
  [{}, [add('/__proto__', { polluted: 1 })], { ['__proto__']: { polluted: 1 } }], [{ a: 1 }, [mv('/constructor', '/b')], FNF]))
test('on an array 0 or a digit 1-9 and digits name an element below the length; - names none; other tokens are a bad index', () => check(
  [{ a: [10, 20, 30] }, [tst('/a/0', 10), tst('/a/2', 30)], { a: [10, 20, 30] }], [{ a: [1] }, [rm('/a/-')], PNF], [{ a: [1] }, [rep('/a/1', 2)], PNF],
  ...['01', '00', '+1', '1.0', '1e0', ' 1', '1 ', 'length', '', '-1', '0x1', '\u0661', '\uFF11'].map(t => [{ a: [10, 20, 30] }, [tst(`/a/${t}`, 10)], BAD_INDEX]),
  ...['3', '-', '99999999999999999999', '4294967295', '9007199254740993'].map(t => [{ a: [10, 20, 30] }, [tst(`/a/${t}`, 10)], PNF]),
  [{ a: [1] }, [rm('/a/01')], BAD_INDEX], [{ a: [1] }, [tst('/b/01', 1)], PNF], [{ a: [[1]] }, [tst('/a/01/x', 1)], BAD_INDEX], [{ a: [1] }, [tst('/a/5/01', 1)], PNF]))
test('a string, number, boolean or null has no members, not even 0 or length', () => check(
  ...[tst('/s/0', 'a'), tst('/s/length', 3), rm('/n/x'), rep('/t/0', 1), tst('/z/0', null), add('/s/0', 'x'), add('/s/-', 'x'), add('/z/a', 1), add('/n/toFixed', 1)]
    .map(op => [{ s: 'abc', n: 5, t: true, z: null }, [op], PNF]),
  [{ s: 'abc' }, [mv('/s/0', '/b')], FNF], ['abc', [tst('/0', 'a')], PNF], [5, [add('/a', 1)], PNF], [null, [add('/a', 1)], PNF], [null, [add('', 1)], 1]))
// Patches
test('applyPatch never changes doc or patch, also when it throws after earlier operations succeeded', () => check(
  [{ a: 1, b: [1, 2] }, [add('/c', 3), rm('/a'), rep('/b/0', 9), mv('/b/1', '/d'), tst('/nope', 1)], fail('path not found', 4)],
  [{ a: 1 }, [add('/x', { k: [1] }), add('/x/k2', 2), add('/x/k/-', 3)], { a: 1, x: { k: [1, 3], k2: 2 } }],
  [{ a: { b: 1 } }, [cp('/a', '/c'), add('/c/d', 2), add('/a/e', 3)], { a: { b: 1, e: 3 }, c: { b: 1, d: 2 } }],
  [{ a: [] }, [add('/a/-', { k: 1 }), rep('/a/0/k', 2)], { a: [{ k: 2 }] }], [{ a: 1 }, [add('/b', [1]), add('/b/-', 2), tst('/c', 1)], fail('path not found', 2)]))
test('the result shares no object or array with doc or patch; a patch of [] returns a deep copy', () => check(
  [{ a: { b: [1, { c: null }] } }, [], { a: { b: [1, { c: null }] } }], [[], [], []], [5, [], 5], ['s', [], 's'], [null, [], null], [true, [], true],
  [{ a: 1 }, [add('', { x: [1] })], { x: [1] }], [{ a: { b: 1 } }, [mv('/a', '/c')], { c: { b: 1 } }], [{ a: 1 }, [rep('/a', { y: [] })], { a: { y: [] } }]))
test('numbers are kept exactly, -0 included, and copies keep member order', () => {
  const nums = { a: 0.1, b: 1e308, c: 5e-324, d: 123.456, e: 1e21 }
  check([{ a: -0 }, [], { a: -0 }], [-0, [], -0], [[-0], [], [-0]], [{ ...nums }, [cp('', '/f')], { ...nums, f: nums }],
    [{ a: -0 }, [cp('/a', '/b'), add('/c', -0), add('/d', [-0, { e: -0 }]), rep('/a', -0)], { a: -0, b: -0, c: -0, d: [-0, { e: -0 }] }],
    [{ z: 1, y: { q: 1, p: 2, 1: 3 }, 2: 4 }, [cp('/y', '/x')], { 2: 4, z: 1, y: { 1: 3, q: 1, p: 2 }, x: { 1: 3, q: 1, p: 2 } }])
})
test('member order: array-index names first in ascending order, then other names in the order they were added', () => check(
  [{ b: 0 }, [add('/1', 5)], { 1: 5, b: 0 }], [{ b: 0, 2: 1 }, [add('/10', 'x'), add('/01', 'y'), add('/4294967295', 'z'), add('/4294967294', 'w'), add('/a', 'v')],
    { 2: 1, 10: 'x', 4294967294: 'w', b: 0, '01': 'y', 4294967295: 'z', a: 'v' }],
  [{ a: 1, b: 2 }, [add('/a', 3)], { a: 3, b: 2 }], [{ a: 1, b: 2, c: 3 }, [rep('/a', 9)], { a: 9, b: 2, c: 3 }], [{ a: 1, b: 2, c: 3 }, [rm('/a'), add('/a', 1)], { b: 2, c: 3, a: 1 }],
  [{ a: 1, b: 2 }, [mv('/a', '/c')], { b: 2, c: 1 }], [{ a: 1, b: 2, c: 3 }, [mv('/c', '/a')], { a: 3, b: 2 }], [{ a: 1, b: 2 }, [mv('/a', '/a')], { a: 1, b: 2 }]))
test('a patch that is not an array (Array.isArray) throws PatchError: patch must be an array, index null', () => check(
  [{}, {}, NOT_ARRAY], [{}, null, NOT_ARRAY], [{}, '[]', NOT_ARRAY], [{}, 5, NOT_ARRAY], [{}, { 0: tst('', {}), length: 1 }, NOT_ARRAY],
  [h => h.apply({}, undefined), NOT_ARRAY], [h => h.apply({}, new Uint8Array(0)), NOT_ARRAY]))
test('a hole in the patch counts as undefined: not an object', () => check(
  [h => h.apply({ a: 1 }, new Array(1)), fail('not an object')], [h => h.apply({ a: 1 }, Object.assign(new Array(2), { 0: { op: 'test', path: '/a', value: 1 } })), fail('not an object', 1)],
  [h => h.apply({ a: 1 }, new Array(3)), fail('not an object')], [h => h.ops({ op: 'test', path: '/a', value: 1 }, undefined), fail('not an object', 1)]))
test('every operation is checked before any is applied; then they run in order and the first failure stops', () => check(
  [{ a: 1 }, [rm('/nope'), { op: 'nope' }], fail('bad op', 1)], [{ a: 1 }, [tst('/a', 2), mv('/a', '/a/b')], fail('cannot move into own child', 1)],
  [{ a: 1 }, [add('/b', 1), tst('/b', 2), 5], fail('not an object', 2)], [{ a: 1 }, [add('/b', 2), cp('/b', '/c'), tst('/c', 2), rm('/a')], { b: 2, c: 2 }],
  [{ a: 1 }, [tst('/a', 1), rm('/a'), tst('/a', 1)], fail('path not found', 2)], [{ a: 1 }, [tst('/a', 2), rm('/nope')], fail('test failed')],
  [{ a: 1 }, [...Array.from({ length: 11 }, () => tst('/a', 1)), tst('/a', 2)], fail('test failed', 11)]))
test('members are own properties, enumerable or not; inherited ones never count; members an op does not use are ignored', () => check(
  [h => h.ops(Object.defineProperties({}, { op: { value: 'replace' }, path: { value: '/a' }, value: { value: 2 } })), { a: 2 }],
  [h => h.ops(Object.defineProperty({ op: 'move', path: '/b' }, 'from', { value: '/a' })), { b: 1 }], [h => h.ops(Object.assign(Object.create({ op: 'remove' }), { path: '/a' })), fail('bad op')],
  [h => h.ops(Object.assign(Object.create({ path: '/a' }), { op: 'remove' })), fail('bad path')], [h => h.ops(Object.assign(Object.create({ from: '/a' }), { op: 'copy', path: '/b' })), fail('bad from')],
  [h => h.ops(Object.assign(Object.create({ value: 1 }), { op: 'add', path: '/b' })), fail('missing value')],
  [h => h.ops(Object.assign(Object.create(null), { op: 'add', path: '/b', value: 2 })), { a: 1, b: 2 }], [h => h.ops({ op: 'remove', path: '/a', value: undefined, from: Symbol('x') }), {}],
  [{ a: 1 }, [{ ...add('/b', 1), from: 5 }, { ...tst('/b', 1), from: 'bad' }, { ...rm('/a'), value: {} }, { ...rep('/b', 2), from: null, extra: [1] }], { b: 2 }],
  [{ a: 1 }, [{ ...cp('/a', '/b'), value: 9 }, { ...mv('/b', '/c'), value: null }], { a: 1, c: 1 }]))
// Form rules
test('not an object: null, an array, or a typeof other than object; any other object goes on to the next rule', () => check(
  ...[null, [rm('/a')], 'add', 5, true].map(op => [{ a: 1 }, [op], fail('not an object')]), [h => h.ops(Object.assign(() => {}, { op: 'remove', path: '/a' })), fail('not an object')],
  [h => h.ops(Symbol('add')), fail('not an object')], [h => h.ops(1n), fail('not an object')], [h => h.ops(new String('add')), fail('bad op')], [h => h.ops(new Date(0)), fail('bad op')],
  [h => h.ops(/add/), fail('bad op')], [h => h.ops(new Map([['op', 'add']])), fail('bad op')], [h => h.ops(Object.assign(new String('x'), { op: 'remove', path: '/a' })), {}],
  [h => h.ops(Object.assign(new Date(0), { op: 'test', path: '/a', value: 1 })), { a: 1 }]))
test('bad op: op missing, or not === one of the six strings', () => check(
  ...[undefined, 'ADD', 'add ', ' add', 'Add', 'get', '', 5, null, true, ['add'], {}].map(op => [{ a: 1 }, [{ op, path: '/a', value: 1 }], fail('bad op')]),
  [h => h.ops({ op: new String('add'), path: '/b', value: 1 }), fail('bad op')], [h => h.ops({ op: undefined, path: '/b', value: 1 }), fail('bad op')],
  [h => h.ops({ op: { toString () { return 'add' } }, path: '/b', value: 1 }), fail('bad op')], [h => h.ops({ op: Symbol('add'), path: '/b', value: 1 }), fail('bad op')],
  [h => h.ops({ op: 1n, path: '/b', value: 1 }), fail('bad op')]))
test('bad path: path missing, not a string, or not a valid pointer', () => check(
  ...[{ op: 'remove' }, { op: 'add', value: 1 }, { op: 'add', path: 5, value: 1 }, { op: 'replace', path: null, value: 1 }, { op: 'test', path: ['/a'], value: 1 },
    { op: 'remove', path: 'a' }, { op: 'remove', path: '/~2' }, { op: 'remove', path: '~1' }, { op: 'move', from: '/a' }, { op: 'copy', from: '/a', path: '#/b' }].map(op => [{ a: 1 }, [op], fail('bad path')]),
  [h => h.ops({ op: 'remove', path: new String('/a') }), fail('bad path')], [h => h.ops({ op: 'remove', path: undefined }), fail('bad path')],
  [h => h.ops({ op: 'remove', path: Symbol('/a') }), fail('bad path')], [h => h.ops({ op: 'add', path: 1n, value: 1 }), fail('bad path')]))
test('bad from: for move and copy, from missing, not a string, or not a valid pointer', () => check(
  ...[{ op: 'move', path: '/b' }, { op: 'copy', path: '/b' }, { op: 'move', path: '/b', from: 5 }, { op: 'copy', path: '/b', from: null },
    { op: 'move', path: '/b', from: 'a' }, { op: 'copy', path: '/b', from: '/~' }, { op: 'move', path: '/b', from: ['/a'] }].map(op => [{ a: 1 }, [op], fail('bad from')]),
  [h => h.ops({ op: 'copy', path: '/b', from: new String('/a') }), fail('bad from')], [h => h.ops({ op: 'move', path: '/b', from: Symbol('/a') }), fail('bad from')],
  [h => h.ops({ op: 'copy', path: '/b', from: 1n }), fail('bad from')]))
test('missing value: add, replace and test need an own value member; a value of null is present', () => check(
  ...[{ op: 'add', path: '/b' }, { op: 'replace', path: '/a' }, { op: 'test', path: '/a' }].map(op => [{ a: 1 }, [op], fail('missing value')]),
  [{ a: 1 }, [add('/b', null), rep('/a', null), tst('/b', null)], { a: null, b: null }]))
test('cannot remove root: a remove whose path is ""; the path / is the member named ""', () => check(
  [{ a: 1 }, [rm('')], fail('cannot remove root')], [5, [rm('')], fail('cannot remove root')], [{ '': 1, a: 2 }, [rm('/')], { a: 2 }], [{ a: 1 }, [rm('/')], PNF]))
test('cannot move into own child: from tokens are a proper prefix of path tokens', () => check(
  ...[mv('/a', '/a/c'), mv('', '/a'), mv('', '/'), mv('/x', '/x/y'), mv('/a/', '/a//x/y')].map(op => [{ a: { b: 1 } }, [op], fail('cannot move into own child')]),
  [{ a: 1 }, [mv('/a', '/ab')], { ab: 1 }], [{ 'a/b': 1, a: { b: {} } }, [mv('/a~1b', '/a/b/c')], { a: { b: { c: 1 } } }], [{ a: { b: 1 } }, [mv('/a/b', '/a')], { a: 1 }], [{ a: 1 }, [mv('', '')], { a: 1 }]))
test('the reason is the first form rule that applies', () => check(
  [{}, [{}], fail('bad op')], [{}, [{ op: 'move' }], fail('bad path')], [{}, [{ op: 'copy', path: '/b' }], fail('bad from')], [{}, [mv('/x', '')], FNF],
  [{}, [{ op: 'move', path: 'x', from: 'y' }], fail('bad path')], [{}, [{ op: 'add', path: 'x' }], fail('bad path')], [{}, [mv('/~', '/a/b')], fail('bad from')],
  [{}, [{ op: 'replace', path: '/b', from: 5 }], fail('missing value')], [{}, [{ op: 'remove', path: '', from: 'x' }], fail('cannot remove root')], [{}, [{ op: 'test', path: '/~', value: 1 }], fail('bad path')]))
// Operations
test('add: "" replaces the document; an object gets or keeps the member; on an array - appends and an index up to the length inserts', () => check(
  [{ a: 1 }, [add('', [1, 2])], [1, 2]], [5, [add('', { x: 1 })], { x: 1 }], [{ a: 1 }, [add('/b', 2)], { a: 1, b: 2 }], [{ a: { b: {} } }, [add('/a/b/c', 1)], { a: { b: { c: 1 } } }],
  [{ a: {} }, [add('/a/', 1), add('/a/-', 2)], { a: { '': 1, '-': 2 } }], [{}, [add('/', 1)], { '': 1 }], [[], [add('/0', 1)], [1]], [{ a: [] }, [add('/a/-', [1])], { a: [[1]] }],
  [[1, 2, 3], [add('/-', 4), add('/0', 0), add('/2', 'x'), add('/6', 'end')], [0, 1, 'x', 2, 3, 4, 'end']]))
test('add follows only the parent: an index past the length is path not found, a token that is neither - nor an index is a bad index', () => check(
  [[1, 2], [add('/3', 'x')], PNF], [[], [add('/1', 'x')], PNF], [[1], [add('/99999999999999999999', 'x')], PNF], ...['01', '-1', '', 'length', '1.0', '+0'].map(t => [[1], [add(`/${t}`, 'x')], BAD_INDEX]),
  [{ a: 1 }, [add('/b/c', 1)], PNF], [{ a: [{}] }, [add('/a/-/x', 1)], PNF], [{ a: [] }, [add('/a/0/x', 1)], PNF], [{ a: [[]] }, [add('/a/01/x', 1)], BAD_INDEX]))
test('remove: the named value goes, and later array elements move down', () => check(
  [{ a: 1, b: 2, c: 3 }, [rm('/b')], { a: 1, c: 3 }], [[1, 2, 3], [rm('/0')], [2, 3]], [[1, 2, 3], [rm('/2')], [1, 2]], [[1, 2, 3], [rm('/1'), rm('/1')], [1]],
  [{ a: { b: { c: 1, d: 2 } } }, [rm('/a/b/c')], { a: { b: { d: 2 } } }], [{ a: [1, 2, 3] }, [rm('/a/3')], PNF], [{ a: [1, 2, 3] }, [rm('/a/-')], PNF], [{ a: 1 }, [rm('/b')], PNF], [{ a: 1 }, [rm('/a/b')], PNF]))
test('replace: "" replaces the document, otherwise the path must name a value, which keeps its place', () => check(
  [{ a: 1 }, [rep('', [1])], [1]], [null, [rep('', 1)], 1], [{ a: 1, b: 2 }, [rep('/a', { x: 1 })], { a: { x: 1 }, b: 2 }], [[1, 2, 3], [rep('/1', 'x')], [1, 'x', 3]],
  [{ a: 1 }, [rep('/b', 1)], PNF], [[1], [rep('/1', 2)], PNF], [[1], [rep('/-', 2)], PNF], [[1], [rep('/01', 2)], BAD_INDEX], [{ a: {} }, [rep('/a/b/c', 1)], PNF]))
test('move: remove at from, then add at path, so an array index in path counts after the removal', () => check(
  [{ a: { x: 1 }, b: [] }, [mv('/a/x', '/b/-')], { a: {}, b: [1] }], [{ a: [1, 2, 3, 4] }, [mv('/a/0', '/a/3')], { a: [2, 3, 4, 1] }], [{ a: 1 }, [mv('/x', '/x')], FNF],
  [{ a: [1, 2, 3, 4] }, [mv('/a/3', '/a/0')], { a: [4, 1, 2, 3] }], [{ a: [1, 2, 3, 4] }, [mv('/a/0', '/a/4')], PNF], [{ a: 1 }, [mv('/x', '/y/z')], FNF],
  [{ a: [1, { y: 2 }] }, [mv('/a/0', '/a/1/z')], PNF], [{ a: [1] }, [mv('/a/0', '/a/01')], BAD_INDEX], [{ a: { b: 1 } }, [mv('/a', '')], { b: 1 }], [{ a: [1] }, [mv('/a/-', '/b')], FNF],
  [{ a: [1, 2, 3] }, [mv('/a/1', '/a/1')], { a: [1, 2, 3] }], [{ a: [1] }, [mv('/a/01', '/b')], BAD_INDEX], [{ a: 1 }, [mv('/a', '/b/c')], PNF]))
test('copy: a deep copy of from, taken before anything changes, is added at path, which may lie inside from', () => check(
  [{ a: { b: 1 } }, [cp('/a', '/a/c')], { a: { b: 1, c: { b: 1 } } }], [{ a: 1 }, [cp('', '/x')], { a: 1, x: { a: 1 } }],
  [[1, 2], [cp('/0', '/-'), cp('/1', '/0')], [2, 1, 2, 1]], [[1, 2], [cp('/0', '/2')], [1, 2, 1]], [[1, 2], [cp('/0', '/3')], PNF],
  [{ a: 1 }, [cp('/a', '/a')], { a: 1 }], [[1, 2], [cp('/0', '/0')], [1, 1, 2]], [{ a: 1 }, [cp('', '')], { a: 1 }], [{ a: 1 }, [cp('/b', '/c')], FNF],
  [{ a: [1] }, [cp('/a/-', '/b')], FNF], [{ a: [1] }, [cp('/a/1.0', '/b')], BAD_INDEX], [{ a: 1 }, [cp('/x', '/y/z')], FNF], [{ a: 1 }, [cp('/a', '/b/c')], PNF]))
test('test: equal JSON values pass (0 equals -0, members in any order) and the document is unchanged', () => {
  const a = [{ x: 1, y: [1, { p: null }] }, [1, 's', true, false, null, {}], { hasOwnProperty: 1, constructor: 2 }, { ['__proto__']: { x: 1 } }, '\u00E9']
  check([{ a: -0 }, [tst('/a', 0)], { a: -0 }], [{ a: 0 }, [tst('/a', -0)], { a: 0 }], [{ a: a[0] }, [tst('/a', { y: [1, { p: null }], x: 1 })], { a: a[0] }],
    [{ a: a[1] }, [tst('', { a: a[1] })], { a: a[1] }], [{ a: a[2] }, [tst('/a', { constructor: 2, hasOwnProperty: 1 })], { a: a[2] }],
    [{ a: a[3] }, [tst('/a', { ['__proto__']: { x: 1 } })], { a: a[3] }], [{ a: a[4] }, [tst('/a', '\u00E9')], { a: a[4] }])
})
test('test failed: different types, lengths, members or characters (no Unicode normalization)', () => check(
  ...[[[1, 2], [2, 1]], [[1, 2], [1, 2, 3]], [[1, 2, 3], [1, 2]], [{}, []], [[], {}], [null, {}], [{}, null], [null, false], [0, false], ['1', 1], [1, '1'], ['', null],
    [true, 1], [{ a: 1 }, { a: 1, b: 2 }], [{ a: 1, b: 2 }, { a: 1 }], [{ a: null }, { b: null }], [{ a: [] }, { a: {} }], ['\u00E9', 'e\u0301'], ['abc', 'ABC'],
    [[[]], [{}]], [[1], { 0: 1 }], [{ 0: 1 }, [1]], [{ y: {} }, { ['__proto__']: {} }], [{ ['__proto__']: {} }, { y: {} }], [1, 2], ['a', 'a ']]
    .map(([have, value]) => [{ a: have }, [tst('/a', value)], fail('test failed')]),
  [{ a: 1 }, [tst('/a', 1), tst('/a', 2)], fail('test failed', 1)], [{ a: 1 }, [tst('/b', null)], PNF], [{ a: [1] }, [tst('/a/-', 1)], PNF]))
test('documents and values 1000 levels deep are copied, followed and compared', () => {
  const deep = '/0'.repeat(999)
  check([nest(1000), [], nest(1000)], [nest(1000), [add(`${deep}/-`, 1), tst(`${deep}/0`, 1)], nest(1000, [1])],
    [{}, [add('', nest(1000))], nest(1000)], [nest(1000), [cp('/0', '/-'), tst('/1', nest(999))], [nest(999), nest(999)]])
})

// Command line
const setup = (files = {}) => {
  const dir = mkdtempSync(join(root, 'c-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  return dir
}
const cli = (cwd, args, input, stdin = 'pipe') => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, input, env, stdio: [stdin, 'pipe', 'pipe'], timeout: 15000, maxBuffer: 64 << 20, windowsHide: true })
  if (r.error) assert.fail(`jsonpatch-cli.mjs ${args.join(' ')} did not finish: ${r.error.message}`)
  return briefed({ args: args.join(' '), code: r.status, out: r.stdout.toString('utf8'), err: r.stderr.toString('utf8') })
}
// An output over BRIEF characters is compared as its length, SHA-256 and ends, so a failing case prints a few lines, not megabytes.
const brief = s => (s.length <= BRIEF ? s : `<${s.length} chars, sha256 ${createHash('sha256').update(s).digest('hex').slice(0, 16)}, from ${JSON.stringify(s.slice(0, 80))} to ${JSON.stringify(s.slice(-80))}>`)
const briefed = r => ({ ...r, out: brief(r.out), err: brief(r.err) })
// Exit 0: exactly `text` on stdout and nothing on stderr. Otherwise: nothing on stdout and the line `text` on stderr.
const want = (args, code, text) => briefed({ args: args.join(' '), code, out: code === 0 ? text : '', err: code === 0 ? '' : `${text}\n` })
// Each case is [args, standard input, exit code, text], run with dir as the working directory.
function expectCli (dir, ...cases) {
  for (const [args, input, code, text] of cases) assert.deepEqual(cli(dir, args, input), want(args, code, text))
}
const pretty = v => JSON.stringify(v, null, 2) + '\n'
const [P, D, R] = [JSON.stringify([add('/1', 5), add('/c', [true, null])]), '{"b":0}', '{\n  "1": 5,\n  "b": 0,\n  "c": [\n    true,\n    null\n  ]\n}\n']
const quoted = (bytes, bom = false) => Buffer.concat([bom ? BOM : Buffer.alloc(0), Buffer.from(`"${'a'.repeat(bytes - 2 - (bom ? 3 : 0))}"`)])
const both = (args, input, code, text) => args.flatMap(a => [[[a], input, code, text(a)], [['p.json', a], '', code, text(a)]])

test('prints JSON.stringify(result, null, 2) and a newline, with nothing on stderr, and exits 0', () => {
  const dir = setup({ 'p.json': P, 'd.json': D, 'e.json': '[]', 'n.json': '5', 'u.json': '{"\u00E9":"\u65E5\u672C\u{1F600}","z":-0}',
    'proto.json': '[{"op":"add","path":"/__proto__","value":{"x":1}}]', 'eq.json': '[{"op":"test","path":"/a","value":1.0},{"op":"test","path":"/a","value":1e0},{"op":"test","path":"/b","value":-0}]' })
  expectCli(dir, [['p.json', 'd.json'], '', 0, R], [['e.json', 'n.json'], '', 0, '5\n'], [['e.json', 'u.json'], '', 0, '{\n  "\u00E9": "\u65E5\u672C\u{1F600}",\n  "z": 0\n}\n'],
    [['proto.json'], '{}', 0, '{\n  "__proto__": {\n    "x": 1\n  }\n}\n'], [['eq.json'], ' {"a":1,"b":0}\r\n', 0, '{\n  "a": 1,\n  "b": 0\n}\n'])
})
test('a missing <doc>, or an argument that is exactly -, means standard input', () => {
  const dir = setup({ 'p.json': P, 'd.json': D })
  expectCli(dir, [['p.json'], D, 0, R], [['p.json', '-'], D, 0, R], [['-', 'd.json'], P, 0, R], [[join(dir, 'p.json'), join(dir, 'd.json')], '', 0, R])
})
test('a byte order mark at the very start is ignored, on files and stdin; a second one, or one later, is not', () => {
  const dir = setup({ 'p.json': Buffer.concat([BOM, Buffer.from(P)]), 'd.json': Buffer.concat([BOM, Buffer.from(D)]), 'two.json': '\uFEFF\uFEFF{}',
    'end.json': '{}\uFEFF', 'only.json': BOM, 'in.json': '"a\uFEFFb"', 'e.json': '[]' })
  expectCli(dir, [['p.json', 'd.json'], '', 0, R], [['-', 'd.json'], Buffer.concat([BOM, Buffer.from(P)]), 0, R], [['e.json', 'in.json'], '', 0, '"a\uFEFFb"\n'],
    ...['two.json', 'end.json', 'only.json'].map(n => [['e.json', n], '', 3, `Error: ${n}: invalid JSON`]))
})
test('not 1 or 2 arguments, or both inputs standard input, prints the usage line and exits 2', () => expectCli(setup({ 'p.json': '[]', 'd.json': '{}' }),
  ...[[], ['p.json', 'd.json', 'd.json'], ['nope', 'nope', 'nope', 'nope'], ['-'], ['-', '-']].map(args => [args, '[]', 2, USAGE])))
test('no such file: nothing exists at the path (ENOENT or ENOTDIR), with the argument as given, exit 1', () => {
  const dir = setup({ 'p.json': '[]', 'd.json': '{}' })
  expectCli(dir, ...both(['nope.json', 'no-dir/x.json', 'p.json/x', '--help', '--', join(dir, 'gone.json')], '{}', 1, a => `Error: ${a}: no such file`))
})
test('is a directory: the path names a directory, exit 1', () => {
  const dir = setup({ 'p.json': '[]' })
  mkdirSync(join(dir, 'sub'))
  expectCli(dir, ...both(['sub', 'sub/', '.', join(dir, 'sub')], '{}', 1, a => `Error: ${a}: is a directory`))
})
test('too large: more than 1048576 bytes read, a byte order mark included, from a file or stdin; checked before decoding', () => {
  const dir = setup({ 'e.json': '[]', 'max.json': quoted(LIMIT), 'over.json': quoted(LIMIT + 1), 'bommax.json': quoted(LIMIT, true),
    'bomover.json': quoted(LIMIT + 1, true), 'ff.json': Buffer.alloc(LIMIT + 1, 0xff), 'pover.json': `[${' '.repeat(LIMIT - 1)}]`, 'big.json': quoted(5 * LIMIT) })
  expectCli(dir, [['e.json', 'max.json'], '', 0, `"${'a'.repeat(LIMIT - 2)}"\n`], [['e.json', 'bommax.json'], '', 0, `"${'a'.repeat(LIMIT - 5)}"\n`],
    ...['over.json', 'bomover.json', 'ff.json', 'big.json'].map(n => [['e.json', n], '', 1, `Error: ${n}: too large`]), [['pover.json', 'nope.json'], '', 1, 'Error: pover.json: too large'],
    [['e.json'], quoted(LIMIT + 1), 1, 'Error: stdin: too large'], [['-', 'e.json'], `[${' '.repeat(LIMIT - 2)}]`, 0, '[]\n'],
    [['-', 'e.json'], `[${' '.repeat(LIMIT - 1)}]`, 1, 'Error: stdin: too large'])
})
test('cannot read: standard input that fails to read (here a write-only handle), exit 1', () => {
  const dir = setup({ 'p.json': '[]', 'd.json': '{}', 'w.txt': '[]' })
  const fd = openSync(join(dir, 'w.txt'), 'w')
  try {
    for (const args of [['p.json'], ['-', 'd.json']]) assert.deepEqual(cli(dir, args, undefined, fd), want(args, 1, 'Error: stdin: cannot read'))
  } finally { closeSync(fd) }
})
test('invalid UTF-8: bytes that are not valid UTF-8, even inside a JSON string, exit 3', () => {
  const str = (...bytes) => Buffer.concat([Buffer.from('[{"op":"add","path":"/a","value":"x'), Buffer.from(bytes), Buffer.from('"}]')])
  const bad = { 'ff.json': str(0xff), 'cont.json': str(0xc3, 0x28), 'overlong.json': str(0xc0, 0xaf), 'surrogate.json': str(0xed, 0xa0, 0x80),
    'cut.json': str(0xe2, 0x82), 'big.json': str(0xf4, 0x90, 0x80, 0x80), 'lone.json': str(0x80), 'halfbom.json': Buffer.from([0xef, 0xbb, 0x5b, 0x5d]),
    'utf16.json': Buffer.from([0xff, 0xfe, 0x5b, 0x00, 0x5d, 0x00]), 'notjson.json': Buffer.from([0xff, 0x7b]), 'max.json': Buffer.alloc(LIMIT, 0xff) }
  const dir = setup({ ...bad, 'p.json': str(0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80), 'd.json': '{}' })
  expectCli(dir, ...both(Object.keys(bad), '{}', 3, a => `Error: ${a}: invalid UTF-8`), [['-', 'd.json'], bad['ff.json'], 3, 'Error: stdin: invalid UTF-8'],
    [['p.json', 'd.json'], '', 0, '{\n  "a": "x\u20AC\u{1F600}"\n}\n'])
})
test('invalid JSON: text JSON.parse rejects, an empty input included, exit 3', () => {
  const bad = ['', ' \n\t', '[1,]', "{'a':1}", 'NaN', '[] []', '// c\n[]', 'undefined', '01', '"\t"', '{"a":1', '[{"op":"add","path":"","value":1}]]']
  const dir = setup({ 'p.json': '[]', ...Object.fromEntries(bad.map((t, i) => [`b${i}.json`, t])) })
  expectCli(dir, ...both(bad.map((t, i) => `b${i}.json`), '{}', 3, a => `Error: ${a}: invalid JSON`), [['p.json'], '', 3, 'Error: stdin: invalid JSON'],
    [['p.json', '-'], ' \r\n "s" \n', 0, '"s"\n'])
})
test('too deep: more than 1000 levels, where [] and {} have depth 1 and a string never adds depth, exit 3', () => {
  const [arrays, objects] = [n => '['.repeat(n) + ']'.repeat(n), n => '{"a":'.repeat(n) + '1' + '}'.repeat(n)]
  const [mixed, patchWith] = [n => `[0,{"a":[${arrays(n - 3)}]},[]]`, d => `[{"op":"add","path":"","value":${arrays(d)}}]`]
  const dir = setup({ 'e.json': '[]', 'a1000.json': arrays(1000), 'a1001.json': arrays(1001), 'o1000.json': objects(1000), 'o1001.json': objects(1001),
    'm1000.json': mixed(1000), 'm1001.json': mixed(1001), 'huge.json': arrays(100000), 'p1000.json': patchWith(998), 'p1001.json': patchWith(999),
    'str.json': `[{"op":"add","path":"","value":"${'['.repeat(2000)}"}]`, 'open.json': '['.repeat(2000) })
  expectCli(dir, [['e.json', 'a1000.json'], '', 0, pretty(nest(1000))], [['e.json', 'o1000.json'], '', 0, pretty(JSON.parse(objects(1000)))],
    [['e.json', 'm1000.json'], '', 0, pretty(JSON.parse(mixed(1000)))], [['p1000.json'], '{}', 0, pretty(nest(998))], [['str.json'], '{}', 0, `"${'['.repeat(2000)}"\n`],
    ...['a1001.json', 'o1001.json', 'm1001.json', 'huge.json'].map(n => [['e.json', n], '', 3, `Error: ${n}: too deep`]), [['p1001.json'], '{}', 3, 'Error: p1001.json: too deep'],
    [['e.json'], arrays(1001), 3, 'Error: stdin: too deep'], [['e.json', 'open.json'], '', 3, 'Error: open.json: invalid JSON'])
})
test('a PatchError from applyPatch prints Error: <message> and exits 4', () => {
  const cases = { '{}': 'patch must be an array', '"[]"': 'patch must be an array', '[{"op":"get","path":""}]': 'operation 0: bad op', '[null]': 'operation 0: not an object',
    '[{"op":"remove","path":"/x"}]': 'operation 0: path not found', '[{"op":"test","path":"/a","value":1},{"op":"test","path":"/a","value":2}]': 'operation 1: test failed' }
  expectCli(setup({ 'd.json': '{"a":1}' }), ...Object.entries(cases).map(([patch, message]) => [['-', 'd.json'], patch, 4, `Error: ${message}`]))
})
test('steps run in order: arguments, then the patch input (read, decode, parse, depth), then the doc input, then applying', () => {
  const dir = setup({ 'p.json': '[]', 'badjson.json': '[', 'deep.json': '['.repeat(1001) + ']'.repeat(1001), 'ff.json': Buffer.from([0xff]),
    'large.json': quoted(LIMIT + 1), 'notarray.json': '{}', 'badop.json': '[{"op":"x"}]', 'd.json': '{}' })
  mkdirSync(join(dir, 'sub'))
  expectCli(dir, [['nope-patch.json', 'nope-doc.json'], '', 1, 'Error: nope-patch.json: no such file'], [['badjson.json', 'nope-doc.json'], '', 3, 'Error: badjson.json: invalid JSON'],
    [['deep.json', 'sub'], '', 3, 'Error: deep.json: too deep'], [['ff.json', 'large.json'], '', 3, 'Error: ff.json: invalid UTF-8'],
    [['-', 'nope-doc.json'], '[', 3, 'Error: stdin: invalid JSON'], [['-', 'nope-doc.json'], '[]', 1, 'Error: nope-doc.json: no such file'],
    [['p.json', 'nope-doc.json'], '', 1, 'Error: nope-doc.json: no such file'], [['badop.json', 'badjson.json'], '', 3, 'Error: badjson.json: invalid JSON'],
    [['notarray.json', 'deep.json'], '', 3, 'Error: deep.json: too deep'], [['badop.json', 'd.json'], '', 4, 'Error: operation 0: bad op'])
})
test('the doc input is not read when the patch input fails: standard input left open does not block', async () => {
  const child = spawn(process.execPath, [CLI, 'p.json'], { cwd: setup({ 'p.json': '[1,' }), env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const got = { args: 'p.json', code: undefined, out: '', err: '' }
  child.stdin.on('error', () => {})
  for (const [stream, key] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.setEncoding('utf8').on('data', d => { got[key] += d })
  got.code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); resolve('still running after 10 s (waiting for stdin?)') }, 10_000)
    child.once('error', e => { clearTimeout(timer); reject(e) })
    child.once('close', c => { clearTimeout(timer); resolve(c) })
  })
  child.stdin.destroy()
  assert.deepEqual(briefed(got), want(['p.json'], 3, 'Error: p.json: invalid JSON'))
})

// Deliverables
test('the solution has a package.json (type module, a test script) and a README', () => {
  const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim() !== '', 'no test script')
  const readme = readdirSync(DIR).find(f => /^readme(\.[a-z]+)?$/i.test(f))
  assert.ok(readme, 'no README file')
  assert.match(readFileSync(join(DIR, readme), 'utf8'), /jsonpatch/)
})
test('the solution has tests written with node:test', () => {
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return ['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))
    return /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []
  })
  assert.ok(sources(DIR).some(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8'))), 'no source file imports node:test')
})
