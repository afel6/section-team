import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CalcError, evaluate } from './calc.mjs'

const fails = (source, message, position, vars) => assert.throws(() => evaluate(source, vars), e => e instanceof CalcError && e.message === message && e.position === position, source)

test('precedence, associativity and signs', () => {
  for (const [source, want] of [['1+2*3', 7], ['10-3-2', 5], ['2^3^2', 512], ['-2^2', -4], ['2^-1', 0.5], ['--2', 2], ['-7%3', -1], ['(1+2)*3', 9]]) {
    assert.equal(evaluate(source), want, source)
  }
})

test('variables, constants and functions', () => {
  assert.equal(evaluate('x*y', { x: 2, y: 3 }), 6)
  assert.equal(evaluate('pi'), Math.PI)
  assert.equal(evaluate('pi', { pi: 3 }), 3)
  assert.equal(evaluate('round(-2.5) + round(2.5)'), 0)
  assert.equal(evaluate('round(4503599627370497)'), 4503599627370497)
  assert.equal(evaluate('max(1, min(2, 3), abs(-4))'), 4)
  fails('toString', 'unknown variable toString at 0', 0, {})
  fails('x(1)', 'unknown function x at 0', 0, { x: 1 })
  fails('abs(1, 2)', 'abs expects 1 argument, got 2 at 0', 0)
  fails('min()', 'min expects at least 1 argument, got 0 at 0', 0)
})

test('syntax errors name the token and its position, and win over evaluation errors', () => {
  fails('.5', 'unexpected character "." at 0', 0)
  fails('1 + \u{1F600}', `unexpected character ${JSON.stringify('\u{1F600}')} at 4`, 4)
  fails('1 + ) #', 'unexpected character "#" at 6', 6)
  fails('2x', 'unexpected name x at 1', 1)
  fails('1 2', 'unexpected number 2 at 2', 2)
  fails('2(3)', 'unexpected "(" at 1', 1)
  fails('1 +', 'unexpected end of input', null)
  fails('1/0 + )', 'unexpected ")" at 6', 6)
  fails('1e400', 'number too large at 0', 0)
})

test('evaluation errors at the operator, left to right', () => {
  fails('1/0', 'division by zero at 1', 1)
  fails('5 % (2-2)', 'division by zero at 2', 2)
  fails('10^400', 'result is not a finite number at 2', 2)
  fails('sqrt(-1)', 'result is not a finite number at 0', 0)
  fails('x + 1/0', 'unknown variable x at 0', 0)
  fails('1/0 + x', 'division by zero at 1', 1)
})

test('-0 comes back as 0, a long sum does not overflow the stack, a non-string source is a TypeError', () => {
  assert.ok(Object.is(evaluate('-0'), 0))
  assert.ok(Object.is(evaluate('-6%3'), 0))
  assert.equal(evaluate(`${'1+'.repeat(49999)}1`), 50000)
  assert.throws(() => evaluate(new String('1')), { name: 'TypeError', message: 'source must be a string' })
  const err = (() => { try { evaluate('#') } catch (e) { return e } })()
  assert.deepEqual([err instanceof Error, err.name], [true, 'CalcError'])
})
