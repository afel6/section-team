// CLI tests: decoding, parsing, depth, success output and exit 4.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { runCli, assertCliError, assertCliOk, makeTmp, nestedArrayText, CLI } from './helpers.mjs';
import { prettyJson } from './pretty-json.mjs';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const tmp = makeTmp();
after(() => tmp.cleanup());

const run = (args, opts = {}) => runCli(args, { cwd: tmp.dir, ...opts });
const pretty = (text) => JSON.stringify(JSON.parse(text), null, 2) + '\n';
const nestedObjects = (n) => '{"a":'.repeat(n) + '1' + '}'.repeat(n);
const P = () => tmp.file('p.json', '[]'); // empty patch
const withDoc = (name, content, patch = P()) => {
  tmp.file(name, content);
  return run([patch, name]);
};

describe('invalid UTF-8', () => {
  const cases = {
    'byte 0xFF': Buffer.from([0x22, 0xff, 0x22]),
    'truncated multibyte': Buffer.from([0x22, 0xc3, 0x22]),
    'overlong C0 AF': Buffer.from([0x22, 0xc0, 0xaf, 0x22]),
    'encoded surrogate': Buffer.from([0x22, 0xed, 0xa0, 0x80, 0x22]),
    'UTF-16 BOM': Buffer.from([0xff, 0xfe, 0x5b, 0x00, 0x5d, 0x00]),
  };
  for (const [label, bytes] of Object.entries(cases)) {
    test(`doc file: ${label}`, () => {
      assertCliError(withDoc('d.bin', bytes), 3, 'Error: d.bin: invalid UTF-8');
    });
    test(`patch file: ${label}`, () => {
      tmp.file('p.bin', bytes);
      assertCliError(run(['p.bin', 'missing.json']), 3, 'Error: p.bin: invalid UTF-8');
    });
    test(`stdin doc: ${label}`, () => {
      assertCliError(run([P()], { stdin: bytes }), 3, 'Error: stdin: invalid UTF-8');
    });
  }
});

describe('invalid JSON', () => {
  const cases = {
    'empty file': '',
    'whitespace only': ' \n\t ',
    'open bracket': '[',
    'trailing comma': '[1,]',
    'single quotes': "['a']",
    NaN: 'NaN',
    'lone BOM': BOM,
    'two BOMs': Buffer.concat([BOM, BOM, Buffer.from('[]')]),
  };
  for (const [label, content] of Object.entries(cases)) {
    test(`doc: ${label}`, () => {
      assertCliError(withDoc('j.json', content), 3, 'Error: j.json: invalid JSON');
    });
    test(`patch: ${label}`, () => {
      tmp.file('jp.json', content);
      assertCliError(run(['jp.json', 'missing.json']), 3, 'Error: jp.json: invalid JSON');
    });
  }
  test('empty stdin', () => {
    assertCliError(run([P()], { stdin: '' }), 3, 'Error: stdin: invalid JSON');
  });
  test('valid non-ASCII JSON passes and is output unescaped', () => {
    assertCliOk(withDoc('n.json', '"日本"'), '"日本"\n');
  });
});

describe('byte order mark', () => {
  test('patch and doc both start with a BOM', () => {
    tmp.file('bp.json', Buffer.concat([BOM, Buffer.from('[{"op":"add","path":"/b","value":2}]')]));
    tmp.file('bd.json', Buffer.concat([BOM, Buffer.from('{"a":1}')]));
    assertCliOk(run(['bp.json', 'bd.json']), '{\n  "a": 1,\n  "b": 2\n}\n');
  });
  test('BOM on stdin doc is stripped', () => {
    assertCliOk(run([P()], { stdin: Buffer.concat([BOM, Buffer.from('[1]')]) }), '[\n  1\n]\n');
  });
  test('BOM on stdin patch is stripped', () => {
    tmp.file('sd.json', '7');
    assertCliOk(run(['-', 'sd.json'], { stdin: Buffer.concat([BOM, Buffer.from('[]')]) }), '7\n');
  });
});

describe('depth', () => {
  test('doc of 1000 nested arrays is accepted', () => {
    const text = nestedArrayText(1000);
    assertCliOk(withDoc('a1000.json', text), pretty(text));
  });
  test('doc of 1001 nested arrays is too deep', () => {
    assertCliError(withDoc('a1001.json', nestedArrayText(1001)), 3, 'Error: a1001.json: too deep');
  });
  test('1000 nested objects accepted', () => {
    const text = nestedObjects(1000);
    assertCliOk(withDoc('o1000.json', text), pretty(text));
  });
  test('1001 nested objects too deep', () => {
    assertCliError(withDoc('o1001.json', nestedObjects(1001)), 3, 'Error: o1001.json: too deep');
  });
  test('1001 mixed arrays and objects too deep', () => {
    const text = '[{"a":'.repeat(500) + '[]' + '}]'.repeat(500);
    assertCliError(withDoc('m1001.json', text), 3, 'Error: m1001.json: too deep');
  });
  test('1000 mixed arrays and objects accepted', () => {
    const text = '[{"a":'.repeat(500) + '1' + '}]'.repeat(500);
    assertCliOk(withDoc('m1000.json', text), pretty(text));
  });
  test('depth is taken from the deepest branch (1002)', () => {
    assertCliError(withDoc('b1002.json', '[[],' + nestedArrayText(1001) + ']'), 3, 'Error: b1002.json: too deep');
  });
  test('deepest branch first, total depth 1000, is accepted', () => {
    const text = '[' + nestedArrayText(999) + ',[]]';
    assertCliOk(withDoc('b1000.json', text), pretty(text));
  });
  test('scalar at the bottom has depth 0', () => {
    const text = '['.repeat(1000) + '1' + ']'.repeat(1000);
    assertCliOk(withDoc('s1000.json', text), pretty(text));
  });
  test('scalar below 1001 containers is too deep', () => {
    assertCliError(withDoc('s1001.json', '['.repeat(1001) + '1' + ']'.repeat(1001)), 3, 'Error: s1001.json: too deep');
  });
  test('patch of depth 1001 is too deep', () => {
    tmp.file('pd.json', '[' + nestedArrayText(1000) + ']');
    assertCliError(run(['pd.json', 'missing.json']), 3, 'Error: pd.json: too deep');
  });
  test('patch of depth exactly 1000 is accepted', () => {
    const value = nestedArrayText(998);
    tmp.file('pv.json', `[{"op":"add","path":"","value":${value}}]`);
    tmp.file('pdoc.json', '0');
    assertCliOk(run(['pv.json', 'pdoc.json']), pretty(value));
  });
  test('stdin doc too deep', () => {
    assertCliError(run([P()], { stdin: nestedArrayText(1001) }), 3, 'Error: stdin: too deep');
  });
  test('stdin patch too deep', () => {
    tmp.file('any.json', '1');
    assertCliError(run(['-', 'any.json'], { stdin: nestedArrayText(1001) }), 3, 'Error: stdin: too deep');
  });
});

describe('patch errors (exit 4)', () => {
  const failing = (patch, doc, line) => {
    tmp.file('fp.json', patch);
    tmp.file('fd.json', doc);
    assertCliError(run(['fp.json', 'fd.json']), 4, line);
  };
  test('patch is not an array', () => failing('{}', '1', 'Error: patch must be an array'));
  test('bad op', () => failing('[{"op":"bogus"}]', '1', 'Error: operation 0: bad op'));
  test('test failure at index 1', () => {
    failing('[{"op":"test","path":"","value":1},{"op":"test","path":"","value":2}]', '1', 'Error: operation 1: test failed');
  });
  test('path not found', () => {
    failing('[{"op":"remove","path":"/x"}]', '{}', 'Error: operation 0: path not found');
  });
  test('operation is not an object', () => failing('[1]', '1', 'Error: operation 0: not an object'));
});

describe('success output', () => {
  test('add keeps JavaScript member order', () => {
    tmp.file('ap.json', '[{"op":"add","path":"/1","value":5}]');
    tmp.file('ad.json', '{"b":0}');
    assertCliOk(run(['ap.json', 'ad.json']), '{\n  "1": 5,\n  "b": 0\n}\n');
  });
  test('patch via stdin with doc file', () => {
    tmp.file('pd2.json', '{"x":1}');
    const res = run(['-', 'pd2.json'], { stdin: '[{"op":"replace","path":"/x","value":2}]' });
    assertCliOk(res, '{\n  "x": 2\n}\n');
  });
  test('doc via stdin when omitted', () => {
    const res = run([tmp.file('rp.json', '[{"op":"add","path":"/-","value":2}]')], { stdin: '[1]' });
    assertCliOk(res, '[\n  1,\n  2\n]\n');
  });
  test('doc via - argument', () => {
    const res = run([tmp.file('rp2.json', '[{"op":"add","path":"/-","value":2}]'), '-'], { stdin: '[1]' });
    assertCliOk(res, '[\n  1,\n  2\n]\n');
  });
  const scalars = [
    ['number', '5', '5\n'],
    ['null', 'null', 'null\n'],
    ['string with escape', '"a\\u0000"', '"a\\u0000"\n'],
    ['negative zero', '-0', '0\n'],
    ['non-ASCII string', '"é"', '"é"\n'],
    ['empty array', '[]', '[]\n'],
    ['empty object', '{}', '{}\n'],
    ['exponent number', '1e2', '100\n'],
  ];
  for (const [label, doc, out] of scalars) {
    test(`doc ${label}`, () => assertCliOk(withDoc('sc.json', doc), out));
  }
  test('non-ASCII output is UTF-8 bytes', () => {
    const res = run([P(), tmp.file('sc2.json', '"é日"')]);
    assert.equal(Buffer.from(res.stdout, 'utf8').toString('hex'), Buffer.from('"é日"\n').toString('hex'));
  });
  test('result deeper than 1000 levels is printed', () => {
    const doc = nestedArrayText(1000);
    tmp.file('cp.json', '[{"op":"copy","from":"","path":"/0"}]');
    tmp.file('cd.json', doc);
    // Inserting a copy of the doc at index 0 leaves the old sole element after it.
    const expected = JSON.parse(`[${doc},${nestedArrayText(999)}]`);
    assertCliOk(run(['cp.json', 'cd.json']), JSON.stringify(expected, null, 2) + '\n');
  });
});

// Two JSON levels per unit, with scalars, an escaped key and -0 around the nested value at /y/2.
const UNIT_OPEN = '{"x":1.5,"k\\n":"é\\u2028","z":-0,"y":[null,true,';
const UNIT_CLOSE = ']}';
const richText = (units) => UNIT_OPEN.repeat(units) + '[]' + UNIT_CLOSE.repeat(units);
const richInnerPointer = (units) => '/y/2'.repeat(units); // pointer to the innermost []
const STACK_FLAG = '--stack-size=200';
const CHAIN_LEVELS = 990;

// Returns the innermost [] of a value built by richText(units).
function innermostOf(value, units) {
  let current = value;
  for (let i = 0; i < units; i++) current = current.y[2];
  return current;
}

// True when JSON.stringify(value, null, 2) throws a RangeError in a child node run with STACK_FLAG.
function stringifyFailsWithSmallStack(file) {
  const script = `try { JSON.stringify(JSON.parse(require('fs').readFileSync(${JSON.stringify(file)}, 'utf8')), null, 2); process.exit(0); }
    catch (e) { process.exit(e instanceof RangeError ? 3 : 1); }`;
  return spawnSync(process.execPath, [STACK_FLAG, '-e', script]).status === 3;
}

describe('results too deep for JSON.stringify', () => {
  test('reference serializer matches JSON.stringify on shallow values', () => {
    const samples = [0, -0, 'a"\n', null, [], {}, [1, [2, []], {}], { a: { 'b\n': [true, null] }, 1: -0 }];
    for (const v of [...samples, JSON.parse(richText(3))]) assert.equal(prettyJson(v), JSON.stringify(v, null, 2));
  });

  test('mixed objects and arrays past the stack limit print as JSON.stringify would', () => {
    // A 200 KB stack makes JSON.stringify fail well below the 1601 levels of this result.
    tmp.file('rich-doc.json', richText(400));
    const patch = [
      { op: 'add', path: `${richInnerPointer(400)}/-`, value: JSON.parse(richText(400)) },
      { op: 'add', path: '/w', value: [1, {}, 'end'] },
    ];
    tmp.file('rich-patch.json', JSON.stringify(patch));
    const expected = JSON.parse(richText(400));
    innermostOf(expected, 400).push(JSON.parse(richText(400)));
    expected.w = [1, {}, 'end'];
    const expectedText = prettyJson(expected);
    // Premise: at this stack size JSON.stringify really fails, so the CLI must use its fallback.
    assert.equal(stringifyFailsWithSmallStack(tmp.file('rich-expected.json', expectedText)), true);
    const res = run(['rich-patch.json', 'rich-doc.json'], { nodeArgs: [STACK_FLAG] });
    assertCliOk(res, expectedText + '\n');
  });

  test(`a ${CHAIN_LEVELS * 5}-level result at the default stack size uses the fallback`, () => {
    // Operation k appends a CHAIN_LEVELS-deep chain inside the current innermost [], which sits
    // CHAIN_LEVELS * (k + 1) - 1 "/0" tokens down; the result is CHAIN_LEVELS * 5 levels deep.
    const patch = [0, 1, 2, 3].map((k) => ({
      op: 'add',
      path: `${'/0'.repeat(CHAIN_LEVELS * (k + 1) - 1)}/-`,
      value: JSON.parse(nestedArrayText(CHAIN_LEVELS)),
    }));
    tmp.file('chain-patch.json', JSON.stringify(patch));
    tmp.file('chain-doc.json', nestedArrayText(CHAIN_LEVELS));
    let expected = [];
    for (let i = 1; i < CHAIN_LEVELS * 5; i++) expected = [expected];
    assert.throws(() => JSON.stringify(expected, null, 2), RangeError);
    assertCliOk(run(['chain-patch.json', 'chain-doc.json']), prettyJson(expected) + '\n');
  });
});

describe('reader closes stdout early (EPIPE)', () => {
  test('no stack trace and exit 0', { timeout: 30000 }, async () => {
    const numbers = Array.from({ length: 150000 }, (_, i) => i);
    // The output must far exceed a 64 KiB pipe buffer, or the write could finish before the close.
    assert.ok(Buffer.byteLength(JSON.stringify(numbers, null, 2)) > 16 * 65536);
    const doc = tmp.file('many.json', JSON.stringify(numbers));
    const child = spawn(process.execPath, [CLI, tmp.file('epipe-patch.json', '[]'), doc], { timeout: 25000 });
    let stderr = '';
    let chunks = 0;
    child.stderr.setEncoding('utf8').on('data', (s) => (stderr += s));
    child.stdout.on('data', () => {
      chunks += 1;
      child.stdout.destroy();
    });
    const code = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    assert.equal(chunks, 1);
    assert.equal(stderr, '');
    assert.equal(code, 0);
  });
});
