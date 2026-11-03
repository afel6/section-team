import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  CLI, run, tempDir, writeFile, assertFailure, assertSuccess, padded, BOM, LIMIT,
} from './cli-helpers.mjs';

const dir = tempDir();
const toJson = (v) => JSON.stringify(v);

describe('success inputs', () => {
  it('patch file + doc file', () => {
    const p = writeFile(dir, 'p1.json', toJson([{ op: 'add', path: '/b', value: 2 }]));
    const d = writeFile(dir, 'd1.json', toJson({ a: 1 }));
    assertSuccess(run([p, d]), { a: 1, b: 2 });
  });

  it('patch file + doc from stdin (1 arg)', () => {
    const p = writeFile(dir, 'p2.json', toJson([{ op: 'add', path: '/b', value: 2 }]));
    assertSuccess(run([p], { input: toJson({ a: 1 }) }), { a: 1, b: 2 });
  });

  it('patch file + "-" doc from stdin', () => {
    const p = writeFile(dir, 'p3.json', toJson([{ op: 'remove', path: '/a' }]));
    assertSuccess(run([p, '-'], { input: toJson({ a: 1, c: 3 }) }), { c: 3 });
  });

  it('"-" patch from stdin + doc file', () => {
    const d = writeFile(dir, 'd4.json', toJson([1, 2]));
    const patch = [{ op: 'add', path: '/-', value: 3 }];
    assertSuccess(run(['-', d], { input: toJson(patch) }), [1, 2, 3]);
  });

  it('an empty patch on a scalar document prints the document', () => {
    const p = writeFile(dir, 'op1.json', '[]');
    const d = writeFile(dir, 'od1.json', '3');
    assertSuccess(run([p, d]), 3);
  });

  it('relative paths resolve against cwd', () => {
    writeFile(dir, 'rp.json', '[]');
    writeFile(dir, 'rd.json', '{"k":true}');
    assertSuccess(run(['rp.json', 'rd.json'], { cwd: dir }), { k: true });
  });
});

describe('output format', () => {
  it('prints exact text with integer-like keys first', () => {
    const p = writeFile(dir, 'p5.json', toJson([{ op: 'add', path: '/1', value: 5 }]));
    const d = writeFile(dir, 'd5.json', '{"b":0}');
    const r = run([p, d]);
    assert.equal(r.stdout, '{\n  "1": 5,\n  "b": 0\n}\n');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  it('prints a scalar result', () => {
    const p = writeFile(dir, 'p6.json', toJson([{ op: 'replace', path: '', value: 'x' }]));
    const d = writeFile(dir, 'd6.json', '{}');
    const r = run([p, d]);
    assert.equal(r.stdout, '"x"\n');
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
  });

  it('prints -0 in the document as 0', () => {
    const p = writeFile(dir, 'p7.json', '[]');
    const d = writeFile(dir, 'd7.json', '{"a":-0}');
    const r = run([p, d]);
    assert.equal(r.stdout, '{\n  "a": 0\n}\n');
    assert.equal(r.status, 0);
  });

  it('prints empty containers compactly', () => {
    const p = writeFile(dir, 'p8.json', '[]');
    const d = writeFile(dir, 'd8.json', '{"a":[],"b":{}}');
    assert.equal(run([p, d]).stdout, '{\n  "a": [],\n  "b": {}\n}\n');
  });

  it('round trips non-ASCII strings', () => {
    const value = ['é', '日本', ' ', ' ', '😀'];
    const p = writeFile(dir, 'p9.json', '[]');
    const d = writeFile(dir, 'd9.json', toJson(value));
    assertSuccess(run([p, d]), value);
  });

  it('allows leading and trailing JSON whitespace', () => {
    const p = writeFile(dir, 'p10.json', ' \t\r\n[ ]\n\n ');
    const d = writeFile(dir, 'd10.json', '\n  {"a" : 1}\r\n');
    assertSuccess(run([p, d]), { a: 1 });
  });

  it('prints a result deeper than 1000 levels', () => {
    // Patch depth is 2 + 998 = 1000 and the doc is 1000 deep; the result is 1001 deep.
    const doc = JSON.parse('['.repeat(1000) + ']'.repeat(1000));
    const value = JSON.parse('['.repeat(998) + ']'.repeat(998));
    const p = writeFile(dir, 'p11.json', toJson([{ op: 'add', path: '/-', value }]));
    const d = writeFile(dir, 'd11.json', toJson(doc));
    const r = run([p, d]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    assert.equal(r.stdout.endsWith('\n'), true);
    const expectedDoc = JSON.parse(toJson(doc));
    expectedDoc.push(value);
    assert.equal(r.stdout, JSON.stringify(expectedDoc, null, 2) + '\n');
  });

  it('prints the same text as JSON.stringify for mixed nesting and escapes', () => {
    const doc = {
      '2': [1, -1.5e-7, 'q"\\\n\u0001', [], {}, [[{}]], null, true],
      '': { 'k"ey': { ' ': false }, z: [] },
      b: [{ a: [{ b: {} }] }],
    };
    const p = writeFile(dir, 'p11b.json', '[]');
    const d = writeFile(dir, 'd11b.json', toJson(doc));
    assertSuccess(run([p, d]), doc);
  });

  it('prints a result too deep for JSON.stringify, made by repeated copy', async () => {
    // Each copy of the whole document into its deepest object doubles the depth: 875 * 8 = 7000,
    // past where the built-in JSON.stringify overflows the call stack (about 6000).
    const depth = 875;
    const doc = JSON.parse('{"a":'.repeat(depth - 1) + '{}' + '}'.repeat(depth - 1));
    const patch = [];
    let deepest = '/a'.repeat(depth - 1);
    for (let i = 0; i < 3; i++) {
      const target = `${deepest}/x`;
      patch.push({ op: 'copy', from: '', path: target });
      deepest = target + deepest;
    }
    const p = writeFile(dir, 'p11c.json', toJson(patch));
    const d = writeFile(dir, 'd11c.json', toJson(doc));
    // The output is about 100 MB of indentation, so stream it and keep only counts.
    const child = spawn(process.execPath, [CLI, p, d], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let closers = 0;
    let tail = '';
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.stdout.setEncoding('utf8').on('data', (c) => {
      for (const ch of c) if (ch === '}') closers++;
      tail = (tail + c).slice(-2);
    });
    const status = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(stderr, '');
    assert.equal(status, 0);
    assert.equal(tail, '}\n');
    // Every copy doubles the number of objects: 875 * 8 objects, each closed once.
    assert.equal(closers, depth * 8);
  });
});

describe('closed stdout', () => {
  it('exits without a stack trace when the reader closes the pipe early', async () => {
    const p = writeFile(dir, 'p11d.json', '[]');
    const d = writeFile(dir, 'd11d.json', toJson(Array.from({ length: 100000 }, (_, i) => i)));
    const child = spawn(process.execPath, [CLI, p, d], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (c) => { stderr += c; });
    child.stdout.once('data', () => child.stdout.destroy());
    const status = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(stderr, '');
    assert.equal(status, 1);
  });
});

describe('byte order mark', () => {
  const patchBytes = Buffer.from('[{"op":"add","path":"/x","value":1}]');
  const docBytes = Buffer.from('{"a":0}');
  const expected = { a: 0, x: 1 };

  it('is ignored at the start of the patch and the doc files', () => {
    const p = writeFile(dir, 'bp.json', Buffer.concat([BOM, patchBytes]));
    const d = writeFile(dir, 'bd.json', Buffer.concat([BOM, docBytes]));
    assertSuccess(run([p, d]), expected);
  });

  it('is ignored on stdin as doc', () => {
    const p = writeFile(dir, 'bp2.json', patchBytes);
    assertSuccess(run([p], { input: Buffer.concat([BOM, docBytes]) }), expected);
  });

  it('is ignored on stdin as patch', () => {
    const d = writeFile(dir, 'bd3.json', docBytes);
    assertSuccess(run(['-', d], { input: Buffer.concat([BOM, patchBytes]) }), expected);
  });

  it('two BOMs are invalid JSON', () => {
    const p = writeFile(dir, 'bp4.json', Buffer.concat([BOM, BOM, patchBytes]));
    assertFailure(run([p, p]), 3, `Error: ${p}: invalid JSON`);
  });

  it('a BOM after leading whitespace is invalid JSON', () => {
    const p = writeFile(dir, 'bp5.json', Buffer.concat([Buffer.from(' '), BOM, Buffer.from('[]')]));
    assertFailure(run([p, p]), 3, `Error: ${p}: invalid JSON`);
  });

  it('a BOM-only input is invalid JSON', () => {
    const p = writeFile(dir, 'bp6.json', BOM);
    assertFailure(run([p, p]), 3, `Error: ${p}: invalid JSON`);
  });

  it('two BOMs on stdin are invalid JSON', () => {
    const p = writeFile(dir, 'bp7.json', '[]');
    assertFailure(run([p], { input: Buffer.concat([BOM, BOM, Buffer.from('{}')]) }),
      3, 'Error: stdin: invalid JSON');
  });
});

describe('size boundary with successful reads', () => {
  it('accepts exactly 1048576 bytes from a file', () => {
    const p = writeFile(dir, 'sp.json', '[]');
    const d = writeFile(dir, 'sd.json', padded(LIMIT));
    assertSuccess(run([p, d]), []);
  });

  it('accepts BOM + content totalling exactly 1048576 bytes', () => {
    const p = writeFile(dir, 'sp2.json', '[]');
    const d = writeFile(dir, 'sd2.json', padded(LIMIT, BOM));
    assertSuccess(run([p, d]), []);
  });

  it('accepts exactly 1048576 bytes via stdin', () => {
    const p = writeFile(dir, 'sp3.json', '[]');
    const f = writeFile(dir, 'sd3.json', padded(LIMIT));
    const fd = fs.openSync(f, 'r');
    try {
      assertSuccess(run([p], { stdinFd: fd }), []);
    } finally {
      fs.closeSync(fd);
    }
  });

  it('accepts a patch of exactly 1048576 bytes via stdin', () => {
    const d = writeFile(dir, 'sd4.json', '{"a":1}');
    assertSuccess(run(['-', d], { input: padded(LIMIT) }), { a: 1 });
  });
});
