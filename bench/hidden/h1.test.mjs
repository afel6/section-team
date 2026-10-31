// Hidden tests for held-out task h1 (ini2json.mjs). Each case writes its input to a file in a fresh
// temp folder, runs `node ini2json.mjs <file>` and compares exit code, stdout and stderr exactly
// (no CRLF clean-up): success means the exact JSON on stdout and nothing on stderr; an error means
// one exact line on stderr and nothing on stdout.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const DIR = process.env.TARGET_DIR
if (!DIR) throw new Error('TARGET_DIR is not set')
const CLI = join(DIR, 'ini2json.mjs')
const USAGE = 'Usage: node ini2json.mjs <file>\n'
let root

before(() => { root = mkdtempSync(join(tmpdir(), 'h1-')) })
after(() => { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 5 }) })

const freshDir = () => mkdtempSync(join(root, 'c-'))
const write = content => {
  const file = join(freshDir(), 'in.ini')
  writeFileSync(file, content)
  return file
}
const run = (args, cwd = root) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 15000, windowsHide: true })
  if (r.error) assert.fail(`ini2json.mjs did not finish: ${r.error.message}`)
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const lines = (...l) => l.join('\n')
const json = value => JSON.stringify(value, null, 2) + '\n'
// `input` sits on both sides so a failing diff shows which case broke.
const expectOut = (content, out) => {
  const input = String(content)
  assert.deepEqual({ input, ...run([write(content)]) }, { input, code: 0, out, err: '' })
}
const expectErr = (content, n, reason) => {
  const input = String(content)
  assert.deepEqual({ input, ...run([write(content)]) }, { input, code: 3, out: '', err: `Error: line ${n}: ${reason}\n` })
}
const name64 = 'k' + 'x'.repeat(63)

// Output and structure

test('an empty file, or one with only blank and comment lines, gives {}', () => {
  expectOut('', '{}\n')
  expectOut(lines('', '  \t ', '; comment', '# comment', '\t; indented', '   # indented', ''), '{}\n')
})

test('top-level keys first, then each section as an object, in file order, as 2-space JSON plus a newline', () => {
  expectOut(lines('name = demo', 'count = 3', '[zeta]', 'b = x', 'a = 2', '[alpha]', '[mid]', 'k = true'),
    '{\n  "name": "demo",\n  "count": 3,\n  "zeta": {\n    "b": "x",\n    "a": 2\n  },\n  "alpha": {},\n  "mid": {\n    "k": true\n  }\n}\n')
})

test('a repeated section merges its keys into the first one and keeps its place', () => {
  expectOut(lines('[s]', 'a = 1', '[t]', 'b = 2', '[ s ]', 'c = 3', '[e]', '[e]'),
    json({ s: { a: 1, c: 3 }, t: { b: 2 }, e: {} }))
})

test('a section key may share a name with a top-level key or with a section', () => {
  expectOut(lines('a = 1', 'b = 2', '[s]', 'a = 3', 's = 4', 't = 5', '[t]', 's = 6', 'b = 7', '[A]'),
    json({ a: 1, b: 2, s: { a: 3, s: 4, t: 5 }, t: { s: 6, b: 7 }, A: {} }))
})

// Lines

test('spaces and tabs around lines, keys, values and bracketed names are ignored', () => {
  expectOut(lines('  \t  a\t =\t 1 \t', '\t[ \t sec \t ]\t', '   ; indented comment', '\t# indented comment', '  b   =   two  words  ', 'c=3'),
    json({ a: 1, sec: { b: 'two  words', c: 3 } }))
})

test('the key is the text before the first =, the value is everything after it', () => {
  expectOut(lines('a = b = c', 'url=http://x.test/?q=1&r=2', 'eq==', 'sp = = x'),
    json({ a: 'b = c', url: 'http://x.test/?q=1&r=2', eq: '=', sp: '= x' }))
})

test('an empty value is the empty string', () => {
  expectOut(lines('a =', 'b=', 'c =  \t  ', '[s]', 'd ='), json({ a: '', b: '', c: '', s: { d: '' } }))
})

test('; and # inside a value are part of it (no inline comments)', () => {
  expectOut(lines('a = 1 ; not a comment', 'b = x # y', 'c = ;', 'd = #', 'e = 5;6', 'f = true # yes'),
    json({ a: '1 ; not a comment', b: 'x # y', c: ';', d: '#', e: '5;6', f: 'true # yes' }))
})

// Encoding and line endings

test('CRLF line endings leave no \\r in names or values', () => {
  expectOut('top = 1\r\nq = "quoted"\r\nb = true\r\n\r\n; comment\r\n[sec]\r\nk = v\n e =\r\n[ t ]\r\nn = -5',
    json({ top: 1, q: 'quoted', b: true, sec: { k: 'v', e: '' }, t: { n: -5 } }))
})

test('a lone \\r is an ordinary character, not a line break', () => {
  expectOut('a = x\ry\nq = "p\rq"\n', json({ a: 'x\ry', q: 'p\rq' }))
  expectErr('a = x\rb = y\nnope\n', 2, 'missing =')
  // Only spaces and tabs are trimmed, so a "\r" at the very end of the file stays in the value.
  expectOut('a = 1\nb = x\r', json({ a: 1, b: 'x\r' }))
})

test('a byte order mark at the very start is ignored; one inside a value is kept', () => {
  expectOut('\uFEFFa = 1\nb = x\uFEFFy\n', json({ a: 1, b: 'x\uFEFFy' }))
  expectOut('\uFEFF[s]\r\nk = v\r\n', json({ s: { k: 'v' } }))
  expectOut('\uFEFF', '{}\n')
  expectErr('\uFEFF\nbad\n', 2, 'missing =')
  // Only the mark at the very start of the file is ignored: at the start of a later line it is part of the key.
  expectErr('a = 1\n\uFEFFb = 2\n', 2, 'bad key')
})

test('bytes that are not valid UTF-8 become U+FFFD and are not an error; valid UTF-8 is kept', () => {
  const bytes = Buffer.concat([
    Buffer.from('u = caf\u00e9 \u65e5\u672c \u{1F600}\na = x'), Buffer.from([0xff]),
    Buffer.from('y\nq = "'), Buffer.from([0x80]), Buffer.from('"\n; '), Buffer.from([0xfe]), Buffer.from('\nok = 1\n'),
  ])
  expectOut(bytes, json({ u: 'caf\u00e9 \u65e5\u672c \u{1F600}', a: 'x\uFFFDy', q: '\uFFFD', ok: 1 }))
})

// Names

test('names use letters, digits, _, - and ., start with a letter or _, are case-sensitive, and dots do not nest', () => {
  expectOut(lines('_ = 1', '_9 = 2', 'a-b.c_D9 = 3', 'Key = 4', 'key = 5', 'KEY = 6', 'a.b = 7', '[a.b.c]', 'x.y = 8', '[S]', 'k = 9', '[s]', 'k = 10', '[kEy]'),
    json({ _: 1, _9: 2, 'a-b.c_D9': 3, Key: 4, key: 5, KEY: 6, 'a.b': 7, 'a.b.c': { 'x.y': 8 }, S: { k: 9 }, s: { k: 10 }, kEy: {} }))
})

test('a 64-character name is accepted as a key and as a section name', () => {
  const sec = '_' + '9'.repeat(63)
  expectOut(lines(`${name64} = 1`, `[${sec}]`, `${name64} = 2`), json({ [name64]: 1, [sec]: { [name64]: 2 } }))
})

test('a 65-character name is a bad key or a bad section name', () => {
  expectErr(lines('a = 1', `${name64}y = 1`), 2, 'bad key')
  expectErr(lines('a = 1', `[${name64}y]`), 2, 'bad section name')
})

test('a key that breaks the name rules is a bad key', () => {
  for (const key of ['9a', '-a', '.a', '', 'a b', 'caf\u00e9', 'a[0]', '"a"', 'a:b', 'a$', 'a/b']) {
    expectErr(lines('; c', '', `${key} = 1`), 3, 'bad key')
  }
  expectErr(lines('a = 1', '='), 2, 'bad key')
})

test('a header that is not exactly [name] is a bad section name', () => {
  for (const h of ['[]', '[ \t ]', '[9s]', '[-s]', '[.s]', '[a b]', '[\u00e9]', '[s/t]', '[s', '[[s]]', '[s]]', '[s]x', '[s] ; c', '[s] # c', '[s=1]']) {
    expectErr(lines('a = 1', '', h), 3, 'bad section name')
  }
})

test('__proto__, constructor and other Object.prototype names are ordinary top-level keys', () => {
  expectOut(lines('__proto__ = 1', 'constructor = c', 'toString = t', 'hasOwnProperty = h', 'valueOf = 2', 'after = ok'),
    '{\n  "__proto__": 1,\n  "constructor": "c",\n  "toString": "t",\n  "hasOwnProperty": "h",\n  "valueOf": 2,\n  "after": "ok"\n}\n')
})

test('__proto__ and constructor work as section names (merged when repeated) and as keys inside sections', () => {
  expectOut(lines('[__proto__]', '__proto__ = 1', 'constructor = 2', '[constructor]', '__proto__ = a', 'constructor = b', '[toString]', '[__proto__]', 'more = x', '[constructor]', 'more = y'),
    '{\n  "__proto__": {\n    "__proto__": 1,\n    "constructor": 2,\n    "more": "x"\n  },\n  "constructor": {\n    "__proto__": "a",\n    "constructor": "b",\n    "more": "y"\n  },\n  "toString": {}\n}\n')
})

test('__proto__ and constructor are checked for duplicates and conflicts like any other name', () => {
  expectErr(lines('__proto__ = 1', '__proto__ = 2'), 2, 'duplicate key __proto__')
  expectErr(lines('[constructor]', 'constructor = 1', 'constructor = 2'), 3, 'duplicate key constructor')
  expectErr(lines('[__proto__]', 'a = 1', '[b]', '[__proto__]', 'a = 2'), 5, 'duplicate key a')
  expectErr(lines('constructor = 1', '[constructor]'), 2, 'conflict constructor')
  expectErr(lines('__proto__ = {}', '[__proto__]'), 2, 'conflict __proto__')
})

// Values

test('only exactly true and false become booleans', () => {
  expectOut(lines('t = true', 'f = false', 'up = TRUE', 'cap = False', 'y = yes', 'o = on', 'tt = truee', 'two = true false'),
    json({ t: true, f: false, up: 'TRUE', cap: 'False', y: 'yes', o: 'on', tt: 'truee', two: 'true false' }))
})

test('0 and integers without leading zeros from -9007199254740991 to 9007199254740991 become numbers', () => {
  expectOut(lines('zero = 0', 'pos = 42', 'neg = -7', 'ten = 10', 'max = 9007199254740991', 'min = -9007199254740991'),
    json({ zero: 0, pos: 42, neg: -7, ten: 10, max: 9007199254740991, min: -9007199254740991 }))
})

test('leading zeros, decimals, a + sign, -0 and other number-like text stay strings', () => {
  const values = ['007', '00', '-01', '1.5', '.5', '5.', '+1', '-0', '-', '1e3', '0x10', '1_000', '1 2', '12abc', 'Infinity', 'NaN']
  expectOut(values.map((v, i) => `v${i} = ${v}`).join('\n'), json(Object.fromEntries(values.map((v, i) => [`v${i}`, v]))))
})

test('integers past the safe range stay strings', () => {
  expectOut(lines('a = 9007199254740992', 'b = -9007199254740992', 'c = 9007199254740993', 'd = 123456789012345678901234567890'),
    json({ a: '9007199254740992', b: '-9007199254740992', c: '9007199254740993', d: '123456789012345678901234567890' }))
})

test('a quoted value is always a string with its inner spaces kept', () => {
  expectOut(lines('pad = "  two  words  "', 'tabs = "\tx\t"', 'num = "123"', 'bool = "false"', 'zero = "007"', 'empty = ""', 'outer = \t "x" \t', 'semi = "a ; b # c"', 'eq = "k=v"'),
    json({ pad: '  two  words  ', tabs: '\tx\t', num: '123', bool: 'false', zero: '007', empty: '', outer: 'x', semi: 'a ; b # c', eq: 'k=v' }))
})

test('a value that does not start with " is plain text, quotes included', () => {
  expectOut(lines("sq = 'single'", 'mid = x"y"', 'say = say "hi"', 'tail = 5"'),
    json({ sq: "'single'", mid: 'x"y"', say: 'say "hi"', tail: '5"' }))
})

test('\\" and \\\\ are the escapes of a quoted value', () => {
  expectOut(lines('q = "say \\"hi\\""', 'dir = "C:\\\\dir\\\\"', 'mix = "a\\\\\\"b"', 'one = "\\\\"', 'two = "\\"\\""'),
    json({ q: 'say "hi"', dir: 'C:\\dir\\', mix: 'a\\"b', one: '\\', two: '""' }))
})

test('any other backslash in a quoted value is a bad quoted value', () => {
  for (const v of ['"a\\nb"', '"a\\tb"', '"\\u0041"', '"it\\\'s"', '"C:\\dir"', '"abc\\"', '"abc\\']) {
    expectErr(lines('ok = 1', `v = ${v}`), 2, 'bad quoted value')
  }
})

test('an unclosed quote, a stray quote, or text after the closing quote is a bad quoted value', () => {
  for (const v of ['"abc', '"', '"abc" x', '"abc";c', '"abc" # c', '"a"b"', '"""', '"a" "b"']) {
    expectErr(lines('ok = 1', `v = ${v}`), 2, 'bad quoted value')
  }
})

// Parse errors

test('a line that is not a header, a comment or blank and has no = is missing =', () => {
  for (const l of ['just text', 'key', '9abc', '"quoted"', 'a: 1', ']', 'TRUE']) {
    expectErr(lines('a = 1', l, 'b = 2'), 2, 'missing =')
  }
})

test('a key repeated in the same place is a duplicate key', () => {
  expectErr(lines('a = 1', 'b = 2', 'a = 3'), 3, 'duplicate key a')
  expectErr(lines('a  = 1', '\ta\t= "1"'), 2, 'duplicate key a')
  expectErr(lines('[s]', 'x.y = 1', '', 'x.y = 1'), 4, 'duplicate key x.y')
})

test('a key under a repeated header is a duplicate if an earlier header of that name set it', () => {
  expectErr(lines('[s]', 'a = 1', '[t]', 'a = 2', '[s]', 'a = 3'), 6, 'duplicate key a')
})

test('a header named like an earlier top-level key is a conflict', () => {
  expectErr(lines('a = 1', 'b = 2', '[b]'), 3, 'conflict b')
  expectErr(lines('a = 1', '[s]', 'k = 1', '', '[ a ]'), 5, 'conflict a')
})

test('the first invalid line is reported, with line numbers counting blank and comment lines', () => {
  expectErr(lines('; header', '', 'a = 1', '# c', '   ', '[s]', 'k = v', 'oops', '9bad = 1', '[bad name]'), 8, 'missing =')
  expectErr('bad', 1, 'missing =')
})

test('line numbers count CRLF lines too', () => {
  expectErr('a = 1\r\n\r\n; c\r\n# d\r\n[s]\r\nbad\r\n', 6, 'missing =')
})

test('a line that breaks two rules reports the first one in the list', () => {
  expectErr('[a] = 1', 1, 'bad section name')
  expectErr(lines('a = 1', '[a'), 2, 'bad section name')
  expectErr(lines('x = 1', '9a'), 2, 'missing =')
  expectErr(lines('x = 1', '9a = "open'), 2, 'bad key')
  expectErr(lines('a = 1', 'a = "open'), 2, 'bad quoted value')
  expectErr(lines('a = 1', 'a = "x" y'), 2, 'bad quoted value')
  expectErr(lines('a = 1', 'a = "x"'), 2, 'duplicate key a')
})

// Arguments and file errors

test('no argument prints the usage line and exits 2', () => {
  assert.deepEqual(run([]), { code: 2, out: '', err: USAGE })
})

test('two or three arguments print the usage line and exit 2', () => {
  const file = write('a = 1\n')
  assert.deepEqual(run([file, file]), { code: 2, out: '', err: USAGE })
  assert.deepEqual(run([file, 'x', 'y']), { code: 2, out: '', err: USAGE })
})

test('a missing file gives Error: <file>: no such file with the argument as given, exit 1', () => {
  const cwd = freshDir()
  for (const arg of ['./missing.ini', 'no-dir/x.ini', 'sans fichier \u00e9.ini', join(cwd, 'gone.ini')]) {
    assert.deepEqual(run([arg], cwd), { code: 1, out: '', err: `Error: ${arg}: no such file\n` })
  }
})

test('a directory gives Error: <file>: is a directory with the argument as given, exit 1', () => {
  const cwd = freshDir()
  mkdirSync(join(cwd, 'conf.ini'))
  for (const arg of ['conf.ini', './conf.ini/', '.', join(cwd, 'conf.ini')]) {
    assert.deepEqual(run([arg], cwd), { code: 1, out: '', err: `Error: ${arg}: is a directory\n` })
  }
})

// Deliverables

test('the solution has a package.json (type module, a test script) and a README', () => {
  const pkg = JSON.parse(readFileSync(join(DIR, 'package.json'), 'utf8'))
  assert.equal(pkg.type, 'module')
  assert.equal(typeof pkg.scripts?.test, 'string')
  assert.notEqual(pkg.scripts.test.trim(), '')
  const readme = readdirSync(DIR).find(f => /^readme(\.[a-z]+)?$/i.test(f))
  assert.ok(readme, 'no README file')
  assert.match(readFileSync(join(DIR, readme), 'utf8'), /ini2json/)
})

test('the solution has tests written with node:test', () => {
  const sources = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return ['node_modules', '.git'].includes(e.name) ? [] : sources(join(dir, e.name))
    return /\.[cm]?js$/.test(e.name) ? [join(dir, e.name)] : []
  })
  const withNodeTest = sources(DIR).filter(f => /['"]node:test['"]/.test(readFileSync(f, 'utf8')))
  assert.ok(withNodeTest.length > 0, 'no source file imports node:test')
})
