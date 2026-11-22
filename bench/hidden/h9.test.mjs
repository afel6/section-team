// Hidden tests for held-out task h9 (calc.mjs and calc-cli.mjs). Library cases run in one child process per test, with a
// time limit, so an endless loop fails that test instead of stalling the file. A result shows -0, NaN and the infinities
// as text, and every case also checks that vars is unchanged. CLI cases compare exit code, stdout and stderr exactly.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const DIR = process.env.TARGET_DIR
if (!DIR) throw new Error('TARGET_DIR is not set')
const [LIB, CLI] = [pathToFileURL(join(DIR, 'calc.mjs')).href, join(DIR, 'calc-cli.mjs')]
const USAGE = 'Usage: node calc-cli.mjs <expression> [<name>=<value>]...'
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'))
let root
before(() => { root = mkdtempSync(join(tmpdir(), 'h9-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 }) })

// Runs in the child: imports calc.mjs, evaluates each case, prints one JSON line. vars is JSON text, or a kind:
// 'nullproto' (no prototype), 'inherit' (the values sit on the prototype only). code is a JS expression for the source.
const CHILD = `
const { readFileSync } = await import('node:fs')
const { url, cases } = JSON.parse(readFileSync(0, 'utf8'))
const m = await import(url)
const shown = v => typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0) ? v : '<' + (Object.is(v, -0) ? '-0' : typeof v === 'number' ? String(v) : typeof v) + '>'
const varsOf = ({ vars, kind }) => {
  if (vars === undefined) return undefined
  const own = JSON.parse(vars)
  if (kind === 'nullproto') return Object.assign(Object.create(null), own)
  if (kind === 'inherit') return Object.create(own)
  return own
}
const one = c => {
  const vars = varsOf(c), before = vars === undefined ? '' : JSON.stringify(Object.entries(vars))
  const src = c.code === undefined ? c.src : (0, eval)('(' + c.code + ')')
  let out
  try { out = { value: shown(c.vars === undefined ? m.evaluate(src) : m.evaluate(src, vars)) } } catch (e) {
    out = { error: { calc: typeof m.CalcError === 'function' && e instanceof m.CalcError, isError: e instanceof Error, type: e?.constructor?.name, name: e?.name,
      message: String(e?.message ?? e), position: e?.position === undefined ? '<undefined>' : e.position } }
  }
  return { ...out, varsChanged: vars !== undefined && JSON.stringify(Object.entries(vars)) !== before }
}
process.stdout.write('@@h9@@' + JSON.stringify(cases.map(c => { try { return one(c) } catch (e) { return { harness: String(e?.stack ?? e) } } })))
`
function runLib(cases) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { cwd: root, env, input: JSON.stringify({ url: LIB, cases }), encoding: 'utf8', timeout: 60_000, windowsHide: true, maxBuffer: 1 << 26 })
  const at = (r.stdout ?? '').indexOf('@@h9@@')
  assert.ok(at >= 0, `calc.mjs did not run to the end (${r.error?.code ?? `exit ${r.status}`}): ${(r.stderr ?? '').slice(0, 800)}`)
  return JSON.parse(r.stdout.slice(at + 6))
}
// A case: [source, want] or [source, want, vars], where want is a number, '-0'-free; vars is an object (sent as JSON) or
// { kind, own }. ERR(message, position) is a CalcError; END is unexpected end of input.
const ERR = (message, position) => ({ error: { calc: true, isError: true, name: 'CalcError', message, position } })
const END = ERR('unexpected end of input', null)
const CH = (c, i) => ERR(`unexpected character ${JSON.stringify(c)} at ${i}`, i)
const UN = (token, i) => ERR(`unexpected ${token} at ${i}`, i)
const toCase = ([src, , vars]) => (vars === undefined ? { src } : vars.kind ? { src, vars: JSON.stringify(vars.own), kind: vars.kind } : { src, vars: JSON.stringify(vars) })
const label = ([src, , vars]) => `${JSON.stringify(src.length > 80 ? `${src.slice(0, 80)}...` : src)}${vars === undefined ? '' : ` with ${JSON.stringify(vars)}`}`
const strip = got => (got.error ? { error: { calc: got.error.calc, isError: got.error.isError, name: got.error.name, message: got.error.message, position: got.error.position } } : got)
function expectAll(rows) {
  const results = runLib(rows.map(toCase))
  for (const [i, row] of rows.entries()) {
    const want = typeof row[1] === 'number' ? { value: row[1] } : row[1]
    const got = results[i]
    assert.deepEqual({ case: label(row), ...strip(got), varsChanged: undefined }, { case: label(row), ...want, varsChanged: undefined })
    assert.equal(got.varsChanged, false, `${label(row)}: vars was changed`)
  }
}

// --- Tokens ---
test('numbers: digits, an optional fraction and exponent, leading zeros; the value is Number() of the text', () => expectAll([
  ['7', 7], ['007', 7], ['0.5', 0.5], ['12.75e-3', 0.01275], ['1E6', 1e6], ['1e+2', 100], ['2.50', 2.5], ['0', 0], ['00.000', 0],
  ['123456789012345678901234567890', 123456789012345678901234567890], ['4.9e-324', 5e-324], ['1.7976931348623157e308', Number.MAX_VALUE], ['1e-400', 0],
]))
test('number edges: 5. and .5 meet an unexpected ".", while 1e3x, 1e and 0x1F are a number followed by a name', () => expectAll([
  ['.5', CH('.', 0)], ['5.', CH('.', 1)], ['1.e3', CH('.', 1)], ['1..2', CH('.', 1)], ['1.5.2', CH('.', 3)],
  ['1e3x', UN('name x', 3)], ['1e', UN('name e', 1)], ['1e+', UN('name e', 1)], ['2E-', UN('name E', 1)], ['0x1F', UN('name x1F', 1)], ['1e+5', 100000],
]))
test('number too large: a number whose value is not finite fails while the source is split, left to right', () => expectAll([
  ['1e400', ERR('number too large at 0', 0)], ['2 * 1e309', ERR('number too large at 4', 4)], ['1e400 #', ERR('number too large at 0', 0)],
  ['# 1e400', CH('#', 0)], ['1e400 +', ERR('number too large at 0', 0)], [`1${'0'.repeat(309)}`, ERR('number too large at 0', 0)], [`1${'0'.repeat(308)}`, 1e308],
]))
test('white space: space, tab, CR and LF separate tokens and count one position each; other white space is an unexpected character', () => expectAll([
  [' 1 +\t2\r\n* 3 ', 7], ['\n\n-\t4', -4], ['\t\t1/0', ERR('division by zero at 3', 3)], ['1\r\n/0', ERR('division by zero at 3', 3)],
  ['1 + 2', CH(' ', 1)], ['1 +  2', CH(' ', 3)], ['1\v+2', CH('\v', 1)], ['1\f+2', CH('\f', 1)], ['﻿1', CH('﻿', 0)],
  ['12 34', UN('number 34', 3)], ['a b', UN('name b', 2), { a: 1, b: 2 }],
]))
test('unexpected character: JSON.stringify of the whole character (a surrogate pair included) at its UTF-16 position', () => expectAll([
  ['1 # 2', CH('#', 2)], ['2 $', CH('$', 2)], ['[1]', CH('[', 0)], ['"1"', CH('"', 0)], ['1 \\ 2', CH('\\', 2)], ['x = 1', CH('=', 2)], ['1 ; 2', CH(';', 2)],
  ['2!', CH('!', 1)], ['x.y', CH('.', 1)], ['\u0000', CH('\u0000', 0)], ['é', CH('é', 0)], ['1 + \u{1F600}', CH('\u{1F600}', 4)], ['\u{1F600}\u{1F600}', CH('\u{1F600}', 0)],
  ['a\u{1F600}', CH('\u{1F600}', 1)], ['1+\ud83d', CH('\ud83d', 2)], ['\ude00', CH('\ude00', 0)],
]))
test('the whole source is split into tokens first: a bad character wins over an earlier syntax error', () => expectAll([
  ['1 + ) #', CH('#', 6)], [') ) $', CH('$', 4)], ['(((( 1 . 2', CH('.', 7)], ['foo( #', CH('#', 5)], ['1 2 ?', CH('?', 4)], ['abs(1, 2) @', CH('@', 10)],
]))

// --- Grammar ---
test('precedence: *, / and % bind tighter than + and -, and each level works from left to right', () => expectAll([
  ['1+2*3', 7], ['10-3-2', 5], ['100/10/5', 2], ['2*3+4*5', 26], ['7-2*3', 1], ['20%6%4', 2], ['2+3%2', 3], ['18/3*2', 12], ['1-2+3', 2], ['2*3%4', 2], ['1+2-3*4/2', -3], ['(1+2)*3', 9],
]))
test('^ works from right to left and binds tighter than *, / and %', () => expectAll([
  ['2^3^2', 512], ['2^3*2', 16], ['2*3^2', 18], ['(2^3)^2', 64], ['4^0.5', 2], ['2^10', 1024], ['2^2^-1', 2 ** (2 ** -1)], ['10^-2', 10 ** -2], ['8/2^2', 2], ['2^3%3', 2],
]))
test('signs: a sign binds looser than a ^ after it and tighter than everything else; signs repeat; ^ takes a signed right operand', () => expectAll([
  ['-2^2', -4], ['(-2)^2', 4], ['2^-1', 0.5], ['--2', 2], ['-+-2', 2], ['+3', 3], ['2*-3', -6], ['2--3', 5], ['-2*-2', 4], ['-(1+2)', -3],
  ['- 2 ^ - 2', -0.25], ['-2^-2^2', -(2 ** -4)], ['2^--2', 4], ['3-+-2', 5], ['1 - -1', 2], ['-x^2', -9, { x: 3 }], ['-2^2*3', -12],
]))
test('%: the remainder has the sign of the left operand', () => expectAll([
  ['-7%3', -1], ['7%-3', 1], ['5.5%2', 1.5], ['-7%-3', -1], ['7%3', 1], ['0%5', 0], ['-6%3', 0], ['10%2.5', 0],
]))
test('unexpected tokens: number <text> and name <text> as written, any other token in double quotes', () => expectAll([
  ['1 2', UN('number 2', 2)], ['2x', UN('name x', 1)], ['x y', UN('name y', 2)], ['3 007', UN('number 007', 2)], ['1 1e3', UN('number 1e3', 2)],
  ['2 ^ 3 4.50', UN('number 4.50', 6)], ['min(1 2)', UN('number 2', 6)], ['pi e', UN('name e', 3)], ['1 2E+1', UN('number 2E+1', 2)],
]))
test('unexpected tokens: operators, parentheses and commas where the grammar has no room for them; no implicit multiplication', () => expectAll([
  ['2(3)', UN('"("', 1)], ['(1)(2)', UN('"("', 3)], ['1)', UN('")"', 1)], ['()', UN('")"', 1)], ['1,2', UN('","', 1)], ['*2', UN('"*"', 0)], ['2**3', UN('"*"', 2)],
  ['^2', UN('"^"', 0)], ['2^^3', UN('"^"', 2)], ['1 + * 2', UN('"*"', 4)], ['(1 + 2))', UN('")"', 7)], ['min(,1)', UN('","', 4)], ['min(1,)', UN('")"', 6)],
  ['(,)', UN('","', 1)], ['1 % % 2', UN('"%"', 4)], ['2 ^ * 3', UN('"*"', 4)], ['(x)(2)', UN('"("', 3), { x: 1 }], ['abs(1)(2)', UN('"("', 6)], ['/', UN('"/"', 0)],
]))
test('unexpected end of input: wherever the source ends too early, an empty or blank source included; its position is null', () => expectAll([
  ['', END], ['   ', END], ['\n\t', END], ['1 +', END], ['(1', END], ['-', END], ['2^', END], ['min(', END], ['min(1,', END], ['((', END], ['abs(1', END],
  ['1 * (2 + ', END], ['- -', END], ['1 + (2 * 3', END], ['x +', END],
]))
test('the whole source is parsed before anything is evaluated: a syntax error wins over any error of evaluation', () => expectAll([
  ['1/0 + )', UN('")"', 6)], ['y * 2 3', UN('number 3', 6)], ['10^400 (', UN('"("', 7)], ['1/0 + abs(1, 2)', ERR('abs expects 1 argument, got 2 at 6', 6)],
  ['nope + foo(1)', ERR('unknown function foo at 7', 7)], ['sqrt(-1) + 1 2', UN('number 2', 13)], ['1/0 +', END], ['x/0 + min()', ERR('min expects at least 1 argument, got 0 at 6', 6)],
]))

// --- Functions ---
test('functions: abs, sqrt, min and max are Math\'s; white space may stand between a name and its (', () => expectAll([
  ['abs(-3)', 3], ['abs(2-5)', 3], ['sqrt(16)', 4], ['sqrt(2)', Math.SQRT2], ['min(3, 1, 2)', 1], ['max(3,1,2)', 3], ['min(5)', 5], ['max(-1)', -1],
  ['max(1, min(2, 3), abs(-4))', 4], ['min( 1 , 2 )', 1], ['sqrt (9)', 3], ['abs(-0)', 0], [`max(${Array.from({ length: 200 }, (_, i) => i).join(',')})`, 199],
]))
test('a call is a primary: ^ binds to it, and a sign before it applies after the ^', () => expectAll([
  ['2*max(1,2)^2', 8], ['-abs(-2)', -2], ['-abs(-2)^2', -4], ['abs(-2)^abs(-3)', 8], ['min(2,3)^max(1,2)^2', 16], ['2^abs(-1)', 2],
]))
test('round: to the nearest whole number, a halfway value away from zero, exact on large values', () => expectAll([
  ['round(2.5)', 3], ['round(-2.5)', -3], ['round(0.5)', 1], ['round(-0.5)', -1], ['round(1.4)', 1], ['round(-1.6)', -2], ['round(-1.5)', -2], ['round(3)', 3],
  ['round(0.49999999999999994)', 0], ['round(-0.49999999999999994)', 0], ['round(2.4999)', 2], ['round(4503599627370497)', 4503599627370497], ['round(-0.4)', 0], ['round(1e20)', 1e20],
]))
test('unknown function: at its name, as soon as the name and ( are read; a variable or constant is not a function', () => expectAll([
  ['foo(1)', ERR('unknown function foo at 0', 0)], ['1 + bar()', ERR('unknown function bar at 4', 4)], ['foo(1 +', ERR('unknown function foo at 0', 0)],
  ['foo(', ERR('unknown function foo at 0', 0)], ['x(2)', ERR('unknown function x at 0', 0), { x: 1 }], ['pi(1)', ERR('unknown function pi at 0', 0)],
  ['Abs(1)', ERR('unknown function Abs at 0', 0)], ['abs(1,2 + foo(1)', ERR('unknown function foo at 10', 10)], ['ROUND (1)', ERR('unknown function ROUND at 0', 0)],
]))
test('argument counts: abs, sqrt and round take exactly 1, min and max at least 1; checked as soon as the call\'s ) is read', () => expectAll([
  ['abs()', ERR('abs expects 1 argument, got 0 at 0', 0)], ['abs(1, 2)', ERR('abs expects 1 argument, got 2 at 0', 0)], ['2 * sqrt(1,2,3)', ERR('sqrt expects 1 argument, got 3 at 4', 4)],
  ['round(1,2)', ERR('round expects 1 argument, got 2 at 0', 0)], ['min()', ERR('min expects at least 1 argument, got 0 at 0', 0)], ['1+max( )', ERR('max expects at least 1 argument, got 0 at 2', 2)],
  ['abs(1, 2', END], ['abs(1, 2) )', ERR('abs expects 1 argument, got 2 at 0', 0)], ['abs(abs(1, 2), 3)', ERR('abs expects 1 argument, got 2 at 4', 4)],
  ['sqrt(1, 2) + abs()', ERR('sqrt expects 1 argument, got 2 at 0', 0)],
]))

// --- Values ---
test('variables: only own properties of vars count; inherited names such as toString or constructor are unknown', () => expectAll([
  ['x', 2, { x: 2 }], ['x*y', 6, { x: 2, y: 3 }], ['_a1 + B_', 3, { _a1: 1, B_: 2 }], ['x + 1', ERR('unknown variable x at 0', 0), {}], ['x', ERR('unknown variable x at 0', 0)],
  ['a + b', ERR('unknown variable b at 4', 4), { a: 1 }], ...['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'].map(n => [n, ERR(`unknown variable ${n} at 0`, 0), {}]),
  ['y', ERR('unknown variable y at 0', 0), { kind: 'inherit', own: { y: 5 } }], ['x', 4, { kind: 'nullproto', own: { x: 4 } }], ['constructor + 1', 3, { constructor: 2 }],
  ['__proto__ * 2', 14, JSON.parse('{"__proto__": 7}')], ['toString', 1, { toString: 1 }],
]))
test('names: an ASCII letter or _, then letters, digits and _; letter case matters', () => expectAll([
  ['X', 1, { X: 1 }], ['x', ERR('unknown variable x at 0', 0), { X: 1 }], ['a_1 * _', 10, { a_1: 2, _: 5 }], ['__', 3, { __: 3 }], ['x1y2 - Z9', 1, { x1y2: 10, Z9: 9 }],
  ['1x', UN('name x', 1), { x: 1 }], ['x-1', 1, { x: 2 }], ['x_', ERR('unknown variable x_ at 0', 0), { x: 1 }], [`${'v'.repeat(300)}`, 4, { ['v'.repeat(300)]: 4 }],
]))
test('pi and e are Math.PI and Math.E unless vars defines them; function names are variables only when vars defines them', () => expectAll([
  ['pi', Math.PI], ['e', Math.E], ['2*pi', 2 * Math.PI], ['e^2', Math.E ** 2], ['pi', 3, { pi: 3 }], ['e^2', 4, { e: 2 }], ['pi + e', Math.PI + 1, { e: 1 }],
  ['E', ERR('unknown variable E at 0', 0)], ['PI', ERR('unknown variable PI at 0', 0)], ['abs', ERR('unknown variable abs at 0', 0)], ['abs', 5, { abs: 5 }], ['abs(-1) + abs', 6, { abs: 5 }],
  ['sqrt(min)', 3, { min: 9 }],
]))
test('division by zero: / or % with a right operand of 0 (or -0) fails at the operator', () => expectAll([
  ['1/0', ERR('division by zero at 1', 1)], ['0/0', ERR('division by zero at 1', 1)], ['5 % (2-2)', ERR('division by zero at 2', 2)], ['1 / (x - 1)', ERR('division by zero at 2', 2), { x: 1 }],
  ['1/-0', ERR('division by zero at 1', 1)], ['1 + 2 / (3 * 0)', ERR('division by zero at 6', 6)], ['0 % 0', ERR('division by zero at 2', 2)], ['1/0.0', ERR('division by zero at 1', 1)],
  ['1 / 1e-400', ERR('division by zero at 2', 2)], ['7 % (0*-1)', ERR('division by zero at 2', 2)], ['1/2/0', ERR('division by zero at 3', 3)],
]))
test('a result that is not a finite number fails at its operator or at its function\'s name', () => expectAll([
  ['10^400', ERR('result is not a finite number at 2', 2)], ['0^-1', ERR('result is not a finite number at 1', 1)], ['sqrt(-1)', ERR('result is not a finite number at 0', 0)],
  ['(-8)^(1/3)', ERR('result is not a finite number at 4', 4)], ['1e308*10', ERR('result is not a finite number at 5', 5)], ['1e308 + 1e308', ERR('result is not a finite number at 6', 6)],
  ['-1e308 - 1e308', ERR('result is not a finite number at 7', 7)], ['2 * sqrt(0 - 4)', ERR('result is not a finite number at 4', 4)], ['1/1e-310', ERR('result is not a finite number at 1', 1)],
  ['(-1)^0.5', ERR('result is not a finite number at 4', 4)], ['max(1, 10^400)', ERR('result is not a finite number at 9', 9)], ['1e-300 / 1e300', 0], ['2^1023*2', ERR('result is not a finite number at 6', 6)],
]))
test('evaluation goes left to right: left operand, right operand, then the operator; arguments in order, then the call', () => expectAll([
  ['x + 1/0', ERR('unknown variable x at 0', 0)], ['1/0 + x', ERR('division by zero at 1', 1)], ['(1/0) * y', ERR('division by zero at 2', 2)], ['y * (1/0)', ERR('unknown variable y at 0', 0)],
  ['min(1/0, y)', ERR('division by zero at 5', 5)], ['min(y, 1/0)', ERR('unknown variable y at 4', 4)], ['10^400 + 1/0', ERR('result is not a finite number at 2', 2)],
  ['1/0 ^ x', ERR('unknown variable x at 6', 6)], ['a/0 * b', ERR('division by zero at 1', 1), { a: 1 }], ['2^x^y', ERR('unknown variable y at 4', 4), { x: 2 }],
  ['abs(x) + sqrt(-1)', ERR('unknown variable x at 4', 4)], ['sqrt(-1) + x', ERR('result is not a finite number at 0', 0)], ['sqrt(1/0)', ERR('division by zero at 6', 6)],
]))
test('evaluate returns 0 instead of -0', () => expectAll([
  ['-0', 0], ['0*-1', 0], ['-(0)', 0], ['round(-0.4)', 0], ['-6%3', 0], ['abs(-0)*-1', 0], ['-x', 0, { x: 0 }], ['min(0, -0)', 0], ['x*-1', 0, { x: 0 }], ['-0/5', 0],
]))
test('CalcError: an Error subclass named CalcError with the message and a position (null at the end of input)', () => {
  const [div, end, ch] = runLib([{ src: '2 / 0' }, { src: '(' }, { src: '#' }])
  assert.deepEqual([div, end, ch].map(r => ({ ...r.error, type: undefined })), [
    { calc: true, isError: true, type: undefined, name: 'CalcError', message: 'division by zero at 2', position: 2 },
    { calc: true, isError: true, type: undefined, name: 'CalcError', message: 'unexpected end of input', position: null },
    { calc: true, isError: true, type: undefined, name: 'CalcError', message: 'unexpected character "#" at 0', position: 0 }])
})
test('a source that is not a string, a String object included, is a TypeError "source must be a string"', () => {
  const codes = ['1', 'null', 'undefined', 'new String("1")', '["1"]', '({ toString() { return "1" } })', '1n', 'Symbol("1")']
  const results = runLib(codes.map(code => ({ code })))
  for (const [i, code] of codes.entries()) {
    const e = results[i].error
    assert.deepEqual({ code, calc: e?.calc, isError: e?.isError, type: e?.type, message: e?.message }, { code, calc: false, isError: true, type: 'TypeError', message: 'source must be a string' })
  }
})
test('long and deep sources: 50000 terms, 500 levels of parentheses, of signs and of ^', () => expectAll([
  [`${'1+'.repeat(49999)}1`, 50000], [`${'('.repeat(500)}1${')'.repeat(500)}`, 1], [`${'-'.repeat(500)}1`, 1], [`${'-'.repeat(499)}1`, -1], [`${'1^'.repeat(499)}1`, 1],
  [`${'('.repeat(500)}1`, END], [`${'x*'.repeat(5000)}x`, 1, { x: 1 }], [`${'2-'.repeat(20000)}2`, -39998],
]))

// --- Command line ---
function setupCli() { return mkdtempSync(join(root, 'cli-')) }
const runCli = (cwd, args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env, encoding: 'utf8', timeout: 20_000, windowsHide: true })
  return { args, code: r.status ?? `no exit (${r.error?.code ?? r.signal})`, out: r.stdout, err: r.stderr }
}
// rows: [args, code, text]: text is stdout for exit 0, else the one stderr line (without "\n").
function expectCli(rows) {
  const cwd = setupCli()
  for (const [args, code, text] of rows) {
    assert.deepEqual(runCli(cwd, args), { args, code, out: code === 0 ? `${text}\n` : '', err: code === 0 ? '' : `${text}\n` })
  }
}
test('command line: prints the value and "\\n", exit 0, nothing on stderr; the first argument is the expression even when it starts with -', () => expectCli([
  [['1+2'], 0, '3'], [['-2*3'], 0, '-6'], [['--2'], 0, '2'], [['-x', 'x=4'], 0, '-4'], [[' 2 ^ 10 '], 0, '1024'], [['round(-2.5)'], 0, '-3'],
  [['--help'], 1, 'Error: unknown variable help at 2'], [['-h'], 1, 'Error: unknown variable h at 1'],
]))
test('command line: the value is written with at most 12 significant digits', () => expectCli([
  [['0.1+0.2'], 0, '0.3'], [['1/3'], 0, '0.333333333333'], [['2/3'], 0, '0.666666666667'], [['-1/3'], 0, '-0.333333333333'], [['10^21'], 0, '1e+21'],
  [['123456789012345'], 0, '123456789012000'], [['1e-7'], 0, '1e-7'], [['0.000001234567890123'], 0, '0.00000123456789012'], [['-0'], 0, '0'], [['pi'], 0, '3.14159265359'],
  [['100'], 0, '100'], [['2^0.5'], 0, '1.41421356237'], [['999999999999.5'], 0, '1000000000000'], [['1.5e300*1e5'], 0, '1.5e+305'],
]))
test('command line: <name>=<value> defines a variable, with an optional - and a number as the tokens define it; pi and e may be redefined', () => expectCli([
  [['x*y', 'x=2', 'y=-3.5'], 0, '-7'], [['pi', 'pi=3'], 0, '3'], [['e', 'e=1e3'], 0, '1000'], [['a+b', 'a=007', 'b=0.5'], 0, '7.5'], [['_x', '_x=1E2'], 0, '100'],
  [['x', 'x=-0'], 0, '0'], [['x', 'x=12.75e-3'], 0, '0.01275'], [['abs', 'abs=2'], 0, '2'], [['1+1'], 0, '2'],
]))
test('command line: __proto__, toString and constructor are ordinary variable names', () => expectCli([
  [['__proto__ + toString * constructor', '__proto__=1', 'toString=2', 'constructor=3'], 0, '7'], [['__proto__', '__proto__=-4'], 0, '-4'],
  [['__proto__'], 1, 'Error: unknown variable __proto__ at 0'], [['hasOwnProperty', 'x=1'], 1, 'Error: unknown variable hasOwnProperty at 0'],
]))
test('command line: the expression may hold tabs, CR and LF; a blank expression is unexpected end of input', () => expectCli([
  [['1 +\n2'], 0, '3'], [['\t2\r\n*\t3'], 0, '6'], [['   '], 1, 'Error: unexpected end of input'], [['1 + 1'], 1, `Error: unexpected character ${JSON.stringify(' ')} at 1`],
]))
test('command line: an argument after the expression that is not <name>=<value> is "Error: bad variable <argument>", exit 2', () => {
  const bad = ['x', '=1', 'x=', '1x=2', 'x=abc', 'x=--1', 'x=+1', 'x= 1', 'x=1 ', ' x=1', 'x=1e400', 'x=.5', 'x=5.', 'x=0x10', 'x==1', 'x=1=2', 'é=1', 'x-y=1', 'x=-', 'x=1e', 'x=pi', '']
  expectCli(bad.map(arg => [['1', arg], 2, `Error: bad variable ${arg}`]))
})
test('command line: a name given twice is "Error: variable <name> given twice", exit 2; variables are checked left to right, before the expression', () => expectCli([
  [['x', 'x=1', 'x=2'], 2, 'Error: variable x given twice'], [['1/0', 'x=1', 'bad'], 2, 'Error: bad variable bad'], [['1', 'x=1', 'y', 'x=2'], 2, 'Error: bad variable y'],
  [['1', 'x=1', 'x=2', 'y'], 2, 'Error: variable x given twice'], [['1', 'pi=1', 'pi=2'], 2, 'Error: variable pi given twice'], [['(', 'x=1', 'x=1'], 2, 'Error: variable x given twice'],
]))
test('command line: no arguments at all prints the usage line, exit 2', () => expectCli([[[], 2, USAGE]]))
test('command line: a CalcError prints "Error: <message>", exit 1, nothing on stdout', () => expectCli([
  [['1/0'], 1, 'Error: division by zero at 1'], [[''], 1, 'Error: unexpected end of input'], [['x'], 1, 'Error: unknown variable x at 0'], [['2 # 3'], 1, 'Error: unexpected character "#" at 2'],
  [['1e400'], 1, 'Error: number too large at 0'], [['abs(1,2)'], 1, 'Error: abs expects 1 argument, got 2 at 0'], [['10^400'], 1, 'Error: result is not a finite number at 2'],
  [['y', 'x=1'], 1, 'Error: unknown variable y at 0'], [['toString'], 1, 'Error: unknown variable toString at 0'], [['2(3)'], 1, 'Error: unexpected "(" at 1'],
]))

// --- Deliverables ---
test('the solution has a package.json (type module, a test script) and a README that names calc-cli', () => {
  const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.ok(typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim() !== '', 'no test script')
  const readme = readdirSync(DIR).find(f => /^readme(\.[a-z]+)?$/i.test(f))
  assert.ok(readme, 'no README file')
  assert.match(readFileSync(join(DIR, readme), 'utf8'), /calc-cli/)
})
test('the solution has tests written with node:test', () => {
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return ['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))
    return /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []
  })
  assert.ok(sources(DIR).some(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8'))), 'no source file imports node:test')
})
