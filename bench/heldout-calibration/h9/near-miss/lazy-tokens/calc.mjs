// calc.mjs: evaluates arithmetic expressions with + - * / % ^, signs, parentheses, variables and a few functions.
// The whole source is split into tokens, then parsed into a tree, and only then evaluated, so a syntax error always wins.
export class CalcError extends Error {
  constructor(message, position) {
    super(message)
    this.name = 'CalcError'
    this.position = position
  }
}

const fail = (message, position) => {
  throw new CalcError(position === null ? message : `${message} at ${position}`, position)
}

const WHITE_SPACE = new Set([' ', '\t', '\r', '\n'])
const SYMBOLS = new Set(['+', '-', '*', '/', '%', '^', '(', ')', ','])
// Sticky (y) patterns match only at lastIndex; without the u flag, \d is ASCII 0-9 only.
const NUMBER = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const NAME = /[A-Za-z_][A-Za-z0-9_]*/y

const FUNCTIONS = new Map([
  ['abs', { exactly: 1, apply: Math.abs }],
  ['sqrt', { exactly: 1, apply: Math.sqrt }],
  ['round', { exactly: 1, apply: x => Math.sign(x) * Math.round(Math.abs(x)) }],
  ['min', { atLeast: 1, apply: Math.min }],
  ['max', { atLeast: 1, apply: Math.max }],
])
const CONSTANTS = new Map([['pi', Math.PI], ['e', Math.E]])

const matchAt = (pattern, source, at) => {
  pattern.lastIndex = at
  return pattern.exec(source)?.[0] ?? null
}

function readToken(source, at) {
  const number = matchAt(NUMBER, source, at)
  if (number !== null) {
    const value = Number(number)
    if (!Number.isFinite(value)) fail('number too large', at)
    return { kind: 'number', text: number, value, at }
  }
  const name = matchAt(NAME, source, at)
  if (name !== null) return { kind: 'name', text: name, at }
  if (SYMBOLS.has(source[at])) return { kind: source[at], text: source[at], at }
  return fail(`unexpected character ${JSON.stringify(String.fromCodePoint(source.codePointAt(at)))}`, at)
}

function tokenize(source) {
  const tokens = []
  let at = 0
  while (at < source.length) {
    if (WHITE_SPACE.has(source[at])) {
      at += 1
    } else {
      const token = readToken(source, at)
      tokens.push(token)
      at += token.text.length
    }
  }
  return tokens
}

// Reads tokens only as far as the parser looks.
function lazyTokens(source) {
  const tokens = []
  let at = 0
  const fill = upTo => {
    while (tokens.length <= upTo && at < source.length) {
      if (WHITE_SPACE.has(source[at])) {
        at += 1
      } else {
        const token = readToken(source, at)
        tokens.push(token)
        at += token.text.length
      }
    }
  }
  return new Proxy(tokens, {
    get: (target, key) => {
      if (key === 'length') fill(Infinity)
      else if (typeof key === 'string' && /^\d+$/.test(key)) fill(Number(key))
      return target[key]
    },
  })
}

const describe = token => (token.kind === 'number' || token.kind === 'name' ? `${token.kind} ${token.text}` : `"${token.text}"`)

// Recursive descent over the token list. + - and * / % build flat chains, so a long sum needs no deep recursion.
function parse(tokens) {
  let next = 0
  const peek = () => tokens[next]
  const unexpected = token => (token ? fail(`unexpected ${describe(token)}`, token.at) : fail('unexpected end of input', null))
  const take = kind => {
    const token = tokens[next]
    if (token?.kind !== kind) unexpected(token)
    next += 1
    return token
  }
  const chain = (operators, operand) => () => {
    const first = operand()
    const rest = []
    while (operators.includes(peek()?.kind)) {
      const { kind: op, at } = tokens[next++]
      rest.push({ op, at, operand: operand() })
    }
    return rest.length ? { type: 'chain', first, rest } : first
  }
  const callArguments = () => {
    if (peek()?.kind === ')') return []
    const args = [expression()]
    while (peek()?.kind === ',') {
      next += 1
      args.push(expression())
    }
    return args
  }
  const call = name => {
    const fn = FUNCTIONS.get(name.text)
    if (!fn) fail(`unknown function ${name.text}`, name.at)
    next += 1 // the (
    const args = callArguments()
    take(')')
    if (fn.exactly !== undefined && args.length !== fn.exactly) fail(`${name.text} expects 1 argument, got ${args.length}`, name.at)
    if (fn.atLeast !== undefined && args.length < fn.atLeast) fail(`${name.text} expects at least 1 argument, got 0`, name.at)
    return { type: 'call', name: name.text, at: name.at, args }
  }
  const primary = () => {
    const token = peek()
    if (token?.kind === 'number') {
      next += 1
      return { type: 'number', value: token.value }
    }
    if (token?.kind === 'name') {
      next += 1
      return peek()?.kind === '(' ? call(token) : { type: 'variable', name: token.text, at: token.at }
    }
    if (token?.kind === '(') {
      next += 1
      const inner = expression()
      take(')')
      return inner
    }
    return unexpected(token)
  }
  const power = () => {
    const base = primary()
    if (peek()?.kind !== '^') return base
    const { at } = tokens[next++]
    return { type: 'power', at, base, exponent: unary() }
  }
  const unary = () => {
    const sign = peek()?.kind
    if (sign !== '+' && sign !== '-') return power()
    next += 1
    const operand = unary()
    return sign === '-' ? { type: 'negate', operand } : operand
  }
  const term = chain(['*', '/', '%'], unary)
  const expression = chain(['+', '-'], term)
  const tree = expression()
  if (next < tokens.length) unexpected(tokens[next])
  return tree
}

const finite = (value, at) => (Number.isFinite(value) ? value : fail('result is not a finite number', at))

function operate(op, at, left, right) {
  if ((op === '/' || op === '%') && right === 0) fail('division by zero', at)
  const value = { '+': left + right, '-': left - right, '*': left * right, '/': left / right, '%': left % right }[op]
  return finite(value, at)
}

function lookup({ name, at }, vars) {
  if (Object.hasOwn(vars, name)) return vars[name]
  if (CONSTANTS.has(name)) return CONSTANTS.get(name)
  return fail(`unknown variable ${name}`, at)
}

function valueOf(node, vars) {
  switch (node.type) {
    case 'number': return node.value
    case 'variable': return lookup(node, vars)
    case 'negate': return -valueOf(node.operand, vars)
    case 'power': {
      const base = valueOf(node.base, vars)
      return finite(base ** valueOf(node.exponent, vars), node.at)
    }
    case 'call': {
      const args = node.args.map(arg => valueOf(arg, vars))
      return finite(FUNCTIONS.get(node.name).apply(...args), node.at)
    }
    case 'chain':
      return node.rest.reduce((left, { op, at, operand }) => operate(op, at, left, valueOf(operand, vars)), valueOf(node.first, vars))
    default:
      throw new Error(`unknown node ${node.type}`)
  }
}

export function evaluate(source, vars = {}) {
  if (typeof source !== 'string') throw new TypeError('source must be a string')
  const value = valueOf(parse(lazyTokens(source)), vars)
  return value === 0 ? 0 : value
}
