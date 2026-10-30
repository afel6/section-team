// Tests for ini2json.mjs: run the CLI on temp files and check stdout, stderr and the exit code.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./ini2json.mjs', import.meta.url));
const BOM = String.fromCharCode(0xfeff);
const REPLACEMENT = String.fromCharCode(0xfffd);
const dir = mkdtempSync(join(tmpdir(), 'ini2json-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));

function run(args) {
  // maxBuffer: the default 1 MB would kill the child on the 10M-character case.
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

let fileCount = 0;
function runOn(content) {
  fileCount += 1;
  const file = join(dir, `case-${fileCount}.ini`);
  writeFileSync(file, content);
  return run([file]);
}

const ok = stdout => ({ stdout, stderr: '', status: 0 });
const okJson = result => ok(`${JSON.stringify(result, null, 2)}\n`);
const failed = (stderr, status) => ({ stdout: '', stderr, status });

test('converts top-level keys and sections with typed values', () => {
  assert.deepEqual(runOn('a = 1\n[s]\nk = true\n'), ok('{\n  "a": 1,\n  "s": {\n    "k": true\n  }\n}\n'));
});

test('an empty file gives {}', () => {
  assert.deepEqual(runOn(''), ok('{}\n'));
});

test('quoted values, inline ; and #, unsafe and leading-zero numbers stay strings', () => {
  const input = 'q = " a \\"b\\" \\\\ "\nc = x ; y # z\nbig = 9007199254740992\nz = 007\nneg = -12\nf = false\n';
  const expected = { q: ' a "b" \\ ', c: 'x ; y # z', big: '9007199254740992', z: '007', neg: -12, f: false };
  assert.deepEqual(runOn(input), ok(`${JSON.stringify(expected, null, 2)}\n`));
});

test('number and boolean boundaries: safe-integer limits, -0, True, quoted and empty values', () => {
  const input = 'max = 9007199254740991\nmin = -9007199254740991\nunder = -9007199254740992\nnz = -0\n'
    + 't = True\nqt = "true"\nq5 = "5"\ne =\n';
  const expected = {
    max: 9007199254740991, min: -9007199254740991, under: '-9007199254740992', nz: '-0',
    t: 'True', qt: 'true', q5: '5', e: '',
  };
  assert.deepEqual(runOn(input), okJson(expected));
});

test('CRLF line ends are stripped, a lone CR stays in the value, a BOM is ignored', () => {
  assert.deepEqual(runOn(BOM + 'a = 1\r\nb = x\ry\r\n'), ok('{\n  "a": 1,\n  "b": "x\\ry"\n}\n'));
});

test('tabs around the brackets, the name, the = and the value are ignored', () => {
  assert.deepEqual(runOn('\t[\ts\t]\t\nk\t=\tv\t\n'), okJson({ s: { k: 'v' } }));
});

test('a CR before CRLF stays in the value', () => {
  assert.deepEqual(runOn('a = x\r\r\n'), okJson({ a: 'x\r' }));
});

test('a BOM inside a value is kept, at its start or in its middle', () => {
  assert.deepEqual(runOn(`a = x${BOM}y\nb = ${BOM}z\n`), okJson({ a: `x${BOM}y`, b: `${BOM}z` }));
});

test('invalid UTF-8 bytes become U+FFFD and are not an error', () => {
  assert.deepEqual(runOn(Buffer.from([0x61, 0x3d, 0xff])), okJson({ a: REPLACEMENT }));
});

test('names of 64 characters are accepted for keys and sections', () => {
  const key = 'k'.repeat(64);
  const section = 'S'.repeat(64);
  assert.deepEqual(runOn(`${key} = 1\n[${section}]\n${key} = 2\n`), okJson({ [key]: 1, [section]: { [key]: 2 } }));
});

test('names may use . - _ and digits, a dot does not nest, and case matters', () => {
  const input = 'a-b.c_D9 = 1\n_x = 0\nKey = 1\nkey = 2\n[a.b]\nx.y = 2\n[S]\n[s]\n';
  const expected = { 'a-b.c_D9': 1, _x: 0, Key: 1, key: 2, 'a.b': { 'x.y': 2 }, S: {}, s: {} };
  assert.deepEqual(runOn(input), okJson(expected));
});

test('__proto__ and constructor are ordinary keys', () => {
  assert.deepEqual(runOn('__proto__ = 1\n[constructor]\nk = v\n'),
    ok('{\n  "__proto__": 1,\n  "constructor": {\n    "k": "v"\n  }\n}\n'));
});

test('a repeated section merges into the first one and keeps its place', () => {
  const expected = { s: { a: 1, b: 2 }, t: {} };
  assert.deepEqual(runOn('[s]\na = 1\n[t]\n[s]\nb = 2\n'), ok(`${JSON.stringify(expected, null, 2)}\n`));
});

test('the key is the text before the first =, the rest is the value', () => {
  assert.deepEqual(runOn('a = b = c\n'), okJson({ a: 'b = c' }));
});

test('a section key may share its name with a top-level key or a section', () => {
  const input = 'k = 1\n[t]\n[s]\nk = 2\ns = 3\nt = 4\n';
  assert.deepEqual(runOn(input), okJson({ k: 1, t: {}, s: { k: 2, s: 3, t: 4 } }));
});

const lineErrors = [
  ['oops\n', 'line 1: missing ='],
  ['; comment\n\n  # note\nnope\n', 'line 4: missing ='],
  ['[bad name]\n', 'line 1: bad section name'],
  ['1x = v\n', 'line 1: bad key'],
  ['q = "open\n', 'line 1: bad quoted value'],
  ['q = "\n', 'line 1: bad quoted value'],
  ['q = "a\\n"\n', 'line 1: bad quoted value'],
  ['a = 1\na = 2\n', 'line 2: duplicate key a'],
  ['[s]\nk = 1\n[t]\n[s]\nk = 2\n', 'line 5: duplicate key k'],
  ['a = 1\n[a]\n', 'line 2: conflict a'],
  ['q = "a" b\n', 'line 1: bad quoted value'],
  ['q = "a"b"\n', 'line 1: bad quoted value'],
  ['[s] x\n', 'line 1: bad section name'],
  [`${'k'.repeat(65)} = 1\n`, 'line 1: bad key'],
  [`[${'S'.repeat(65)}]\n`, 'line 1: bad section name'],
  // A line that breaks two rules reports the first reason in the spec's order.
  ['1x = "open\n', 'line 1: bad key'],
  ['a = 1\na = "open\n', 'line 2: bad quoted value'],
  // Line numbers count CRLF lines, blank and comment lines included.
  ['a = 1\r\n\r\n; c\r\nb\r\n', 'line 4: missing ='],
];

for (const [input, message] of lineErrors) {
  test(`reports "${message}" with exit 3`, () => {
    assert.deepEqual(runOn(input), failed(`Error: ${message}\n`, 3));
  });
}

// A 10M run of plain characters overflowed the old backtracking regex (escaped runs did not).
test('a quoted value of 10M characters parses (no regex stack overflow)', () => {
  const plain = 'x'.repeat(10_000_000);
  const r = runOn(`q = "${plain}\\"\\\\"\n`);
  assert.equal(r.stderr, '');
  assert.equal(r.status, 0);
  // assert.ok, not deepEqual: a failing diff of two 10M-character strings is unreadable.
  assert.ok(r.stdout === okJson({ q: `${plain}"\\` }).stdout, 'stdout differs from the expected JSON');
});

test('no argument or two arguments print the usage line with exit 2', () => {
  const usage = failed('Usage: node ini2json.mjs <file>\n', 2);
  assert.deepEqual(run([]), usage);
  assert.deepEqual(run(['a.ini', 'b.ini']), usage);
});

test('a missing file and a directory exit 1 naming the argument as given', () => {
  const missing = join(dir, 'missing.ini');
  assert.deepEqual(run([missing]), failed(`Error: ${missing}: no such file\n`, 1));
  assert.deepEqual(run([dir]), failed(`Error: ${dir}: is a directory\n`, 1));
});

test('a path through a regular file is no such file', () => {
  const plain = join(dir, 'plain.ini');
  writeFileSync(plain, 'a = 1\n');
  const through = join(plain, 'x');
  assert.deepEqual(run([through]), failed(`Error: ${through}: no such file\n`, 1));
});
