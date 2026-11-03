import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../jsonpatch-cli.mjs', import.meta.url));
const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const LIMIT = 1048576;
const BOM = String.fromCodePoint(0xfeff);

let dir;
let counter = 0;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonpatch-cli-'));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(name, content) {
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  return full;
}

function tmpName(ext = 'json') {
  counter += 1;
  return `f${counter}.${ext}`;
}

function run(args, { input, cwd } = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    input: typeof input === 'string' ? Buffer.from(input, 'utf8') : input,
    cwd,
    encoding: 'buffer',
    timeout: 10000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout ? r.stdout.toString('utf8') : '',
    stderr: r.stderr ? r.stderr.toString('utf8') : '',
  };
}

function expectError(r, line, code) {
  assert.strictEqual(r.status, code);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.stderr, `${line}\n`);
}

function expectOk(r, stdout) {
  assert.strictEqual(r.status, 0);
  assert.strictEqual(r.stderr, '');
  assert.strictEqual(r.stdout, stdout);
}

function pretty(v) {
  return `${JSON.stringify(v, null, 2)}\n`;
}

// Content of exactly `bytes` bytes: prefix + '[' + spaces + ']'.
function sizedPatch(bytes, withBom) {
  const head = withBom ? Buffer.from(BOM) : Buffer.alloc(0);
  const spaces = bytes - head.length - 2;
  return Buffer.concat([head, Buffer.from(`[${' '.repeat(spaces)}]`)]);
}

// JSON string doc whose UTF-8 length is `bytes` (needs bytes to be even).
function multibyteDoc(bytes) {
  return `"${'é'.repeat((bytes - 2) / 2)}"`;
}

const nestedObjects = (n) => '{"a":'.repeat(n) + '{}' + '}'.repeat(n);

describe('success', () => {
  it('applies patch file to doc file', () => {
    const p = write(tmpName(), '[{"op":"add","path":"/b","value":[1,{"c":null}]}]');
    const d = write(tmpName(), '{"a":1}');
    expectOk(run([p, d]), pretty({ a: 1, b: [1, { c: null }] }));
  });

  it('reads doc from stdin when doc arg missing', () => {
    const p = write(tmpName(), '[]');
    expectOk(run([p], { input: '{"a":1}' }), pretty({ a: 1 }));
  });

  it("reads doc from stdin with '-'", () => {
    const p = write(tmpName(), '[]');
    expectOk(run([p, '-'], { input: '{"a":1}' }), pretty({ a: 1 }));
  });

  it('reads patch from stdin', () => {
    const d = write(tmpName(), '{"a":1}');
    const input = '[{"op":"add","path":"/z","value":true}]';
    expectOk(run(['-', d], { input }), pretty({ a: 1, z: true }));
  });

  it('orders integer-like members first', () => {
    const p = write(tmpName(), '[{"op":"add","path":"/1","value":5}]');
    const d = write(tmpName(), '{"b":0}');
    expectOk(run([p, d]), '{\n  "1": 5,\n  "b": 0\n}\n');
  });

  it('prints -0 as 0', () => {
    const p = write(tmpName(), '[]');
    const d = write(tmpName(), '{"a":-0}');
    expectOk(run([p, d]), '{\n  "a": 0\n}\n');
  });

  it('handles primitive docs', () => {
    const p = write(tmpName(), '[]');
    expectOk(run([p, write(tmpName(), '"x"')]), '"x"\n');
    expectOk(run([p, write(tmpName(), 'null')]), 'null\n');
  });
});

describe('BOM handling', () => {
  it('accepts one leading BOM in files', () => {
    const p = write(tmpName(), `${BOM}[]`);
    const d = write(tmpName(), `${BOM}{"a":1}`);
    expectOk(run([p, d]), pretty({ a: 1 }));
  });

  it('accepts one leading BOM on stdin', () => {
    const p = write(tmpName(), '[]');
    expectOk(run([p], { input: `${BOM}{"a":1}` }), pretty({ a: 1 }));
    const d = write(tmpName(), '{"a":1}');
    expectOk(run(['-', d], { input: `${BOM}[]` }), pretty({ a: 1 }));
  });

  it('rejects two BOMs', () => {
    const p = write(tmpName(), `${BOM}${BOM}[]`);
    expectError(run([p], { input: '{}' }), `Error: ${p}: invalid JSON`, 3);
  });

  it('rejects a BOM that is not at the start', () => {
    const p = write(tmpName(), `[${BOM}]`);
    expectError(run([p], { input: '{}' }), `Error: ${p}: invalid JSON`, 3);
  });

  it('rejects a BOM-only file', () => {
    const p = write(tmpName(), BOM);
    expectError(run([p], { input: '{}' }), `Error: ${p}: invalid JSON`, 3);
  });

  it('counts the BOM toward the size limit (exactly at limit)', () => {
    const buf = sizedPatch(LIMIT, true);
    assert.strictEqual(buf.length, LIMIT);
    const p = write(tmpName(), buf);
    expectOk(run([p], { input: '{"a":1}' }), pretty({ a: 1 }));
  });

  it('counts the BOM toward the size limit (one over)', () => {
    const buf = sizedPatch(LIMIT + 1, true);
    assert.strictEqual(buf.length, LIMIT + 1);
    const p = write(tmpName(), buf);
    expectError(run([p], { input: '{}' }), `Error: ${p}: too large`, 1);
  });
});

describe('size limits', () => {
  it('accepts a file of exactly 1048576 bytes without BOM', () => {
    const p = write(tmpName(), sizedPatch(LIMIT, false));
    expectOk(run([p], { input: '{"a":1}' }), pretty({ a: 1 }));
  });

  it('rejects a file of 1048577 bytes', () => {
    const p = write(tmpName(), sizedPatch(LIMIT + 1, false));
    expectError(run([p], { input: '{}' }), `Error: ${p}: too large`, 1);
  });

  it('accepts a doc on stdin of exactly 1048576 bytes', () => {
    const p = write(tmpName(), '[]');
    const input = sizedPatch(LIMIT, false).toString('utf8').replace('[', '"').replace(/]$/, '"');
    assert.strictEqual(Buffer.byteLength(input), LIMIT);
    expectOk(run([p], { input }), pretty(JSON.parse(input)));
  });

  it('rejects a doc on stdin of 1048577 bytes', () => {
    const p = write(tmpName(), '[]');
    const input = `"${'a'.repeat(LIMIT - 1)}"`;
    assert.strictEqual(Buffer.byteLength(input), LIMIT + 1);
    expectError(run([p], { input }), 'Error: stdin: too large', 1);
  });

  it('counts bytes, not chars, for files', () => {
    const text = multibyteDoc(LIMIT + 2);
    assert.ok(text.length < LIMIT);
    assert.strictEqual(Buffer.byteLength(text), LIMIT + 2);
    const d = write(tmpName(), text);
    const p = write(tmpName(), '[]');
    expectError(run([p, d]), `Error: ${d}: too large`, 1);
  });

  it('counts bytes, not chars, for stdin', () => {
    const text = multibyteDoc(LIMIT + 2);
    const p = write(tmpName(), '[]');
    expectError(run([p], { input: text }), 'Error: stdin: too large', 1);
  });
});

describe('usage', () => {
  const files = () => [write(tmpName(), '[]'), write(tmpName(), '{}'), write(tmpName(), '{}')];

  it('no args', () => expectError(run([]), USAGE, 2));
  it('three args', () => expectError(run(files()), USAGE, 2));
  it('three args that do not exist', () => {
    expectError(run(['nx1', 'nx2', 'nx3'], { cwd: dir }), USAGE, 2);
  });
  it("'-' alone", () => expectError(run(['-'], { input: '[]' }), USAGE, 2));
  it("'-' '-'", () => expectError(run(['-', '-'], { input: '[]' }), USAGE, 2));
});

describe('read errors', () => {
  it('missing patch file', () => {
    expectError(run(['nope.json'], { cwd: dir }), 'Error: nope.json: no such file', 1);
  });

  it('ENOTDIR path', () => {
    write('patch.json', '[]');
    expectError(run(['patch.json/x'], { cwd: dir }), 'Error: patch.json/x: no such file', 1);
  });

  it('directory', () => {
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    expectError(run(['sub'], { cwd: dir }), 'Error: sub: is a directory', 1);
  });

  it('directory with mode 000', () => {
    const sub = path.join(dir, 'sub000');
    fs.mkdirSync(sub, { recursive: true });
    fs.chmodSync(sub, 0o000);
    try {
      expectError(run(['sub000'], { cwd: dir }), 'Error: sub000: is a directory', 1);
    } finally {
      fs.chmodSync(sub, 0o755);
    }
  });

  it('current directory', () => {
    expectError(run(['.'], { cwd: dir }), 'Error: .: is a directory', 1);
  });

  it('/dev/zero is too large', (t) => {
    if (!fs.existsSync('/dev/zero')) return t.skip('no /dev/zero');
    expectError(run(['/dev/zero']), 'Error: /dev/zero: too large', 1);
  });

  it('unreadable file', (t) => {
    if (process.getuid?.() === 0) return t.skip('root can read anything');
    const name = tmpName();
    const full = write(name, '[]');
    fs.chmodSync(full, 0o000);
    try {
      expectError(run([name], { cwd: dir }), `Error: ${name}: cannot read`, 1);
    } finally {
      fs.chmodSync(full, 0o644);
    }
  });

  it('missing doc file', () => {
    const p = write(tmpName(), '[]');
    expectError(run([p, 'nope.json'], { cwd: dir }), 'Error: nope.json: no such file', 1);
  });

  it('doc is a directory', () => {
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
    const p = write(tmpName(), '[]');
    expectError(run([p, 'sub'], { cwd: dir }), 'Error: sub: is a directory', 1);
  });
});

describe('decode errors', () => {
  const bad = {
    'invalid byte 0xFF': [0x5b, 0xff, 0x5d],
    'overlong 0xC0 0xAF': [0x5b, 0xc0, 0xaf, 0x5d],
    'lone surrogate': [0x5b, 0xed, 0xa0, 0x80, 0x5d],
    'truncated sequence at end': [0x5b, 0x5d, 0xe2, 0x82],
  };
  for (const [label, bytes] of Object.entries(bad)) {
    it(`file: ${label}`, () => {
      const p = write(tmpName(), Buffer.from(bytes));
      expectError(run([p], { input: '{}' }), `Error: ${p}: invalid UTF-8`, 3);
    });
    it(`stdin: ${label}`, () => {
      const p = write(tmpName(), '[]');
      expectError(run([p], { input: Buffer.from(bytes) }), 'Error: stdin: invalid UTF-8', 3);
    });
  }
});

describe('parse errors', () => {
  const cases = {
    'empty file': '',
    'whitespace only': ' \n\t ',
    'open bracket': '[',
    'single quotes': "{'a':1}",
    undefined: 'undefined',
    'trailing comma': '[1,]',
  };
  for (const [label, text] of Object.entries(cases)) {
    it(`invalid JSON: ${label}`, () => {
      const p = write(tmpName(), text);
      expectError(run([p], { input: '{}' }), `Error: ${p}: invalid JSON`, 3);
    });
  }

  it('invalid JSON: empty stdin', () => {
    const p = write(tmpName(), '[]');
    expectError(run([p], { input: '' }), 'Error: stdin: invalid JSON', 3);
  });
});

describe('depth', () => {
  it('patch nesting of 1001 is too deep', () => {
    const p = write(tmpName(), '['.repeat(1001) + ']'.repeat(1001));
    expectError(run([p], { input: '{}' }), `Error: ${p}: too deep`, 3);
  });

  it('patch nesting of 1000 is accepted (then fails as a patch)', () => {
    const p = write(tmpName(), '['.repeat(1000) + ']'.repeat(1000));
    expectError(run([p], { input: '{}' }), 'Error: operation 0: not an object', 4);
  });

  it('doc nesting of 1000 is accepted', () => {
    // nestedObjects(n) has n+1 levels, so use 999 wrappers for depth 1000.
    const text = nestedObjects(999);
    const d = write(tmpName(), text);
    const p = write(tmpName(), '[]');
    expectOk(run([p, d]), pretty(JSON.parse(text)));
  });

  it('doc nesting of 1001 is too deep', () => {
    const d = write(tmpName(), nestedObjects(1000));
    const p = write(tmpName(), '[]');
    expectError(run([p, d]), `Error: ${d}: too deep`, 3);
  });

  it('brackets inside strings do not count', () => {
    const d = write(tmpName(), `["${'['.repeat(2000)}"]`);
    const p = write(tmpName(), '[]');
    expectOk(run([p, d]), pretty(['['.repeat(2000)]));
  });

  it('escaped quotes do not end the string', () => {
    const text = `["\\"${'['.repeat(1001)}"]`;
    const d = write(tmpName(), text);
    const p = write(tmpName(), '[]');
    expectOk(run([p, d]), pretty(JSON.parse(text)));
  });

  it('mixed object/array nesting beyond 1000 is too deep', () => {
    const text = '{"a":[' .repeat(501) + '1' + ']}'.repeat(501);
    const d = write(tmpName(), text);
    const p = write(tmpName(), '[]');
    expectError(run([p, d]), `Error: ${d}: too deep`, 3);
  });

  it('very deep (500000) nesting is too deep, not a crash', () => {
    const d = write(tmpName(), '['.repeat(500000) + ']'.repeat(500000));
    const p = write(tmpName(), '[]');
    expectError(run([p, d]), `Error: ${d}: too deep`, 3);
  });

  it('invalid JSON that is also deep reports invalid JSON', () => {
    const p = write(tmpName(), '['.repeat(1001));
    expectError(run([p], { input: '{}' }), `Error: ${p}: invalid JSON`, 3);
  });
});

function waitForExit(child, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI did not exit while stdin was still open'));
    }, ms);
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

describe('read order', () => {
  it('patch invalid JSON wins over missing doc', () => {
    const p = write(tmpName(), '[');
    expectError(run([p, 'nope.json'], { cwd: dir }), `Error: ${p}: invalid JSON`, 3);
  });

  it('patch too deep wins over missing doc', () => {
    const p = write(tmpName(), '['.repeat(1001) + ']'.repeat(1001));
    expectError(run([p, 'nope.json'], { cwd: dir }), `Error: ${p}: too deep`, 3);
  });

  it('patch invalid UTF-8 wins over directory doc', () => {
    const p = write(tmpName(), Buffer.from([0x5b, 0xff, 0x5d]));
    expectError(run([p, dir]), `Error: ${p}: invalid UTF-8`, 3);
  });

  it('missing patch wins over missing doc', () => {
    expectError(run(['nope1.json', 'nope2.json'], { cwd: dir }), 'Error: nope1.json: no such file', 1);
  });

  it('does not wait for stdin when the patch is bad', async () => {
    const p = write(tmpName(), '[');
    const child = spawn(process.execPath, [CLI, p], { stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const { code, stderr } = await waitForExit(child, 5000);
      assert.strictEqual(code, 3);
      assert.strictEqual(stderr, `Error: ${p}: invalid JSON\n`);
    } finally {
      child.stdin.destroy();
      child.kill('SIGKILL');
    }
  });

  it('valid patch with invalid doc reports the doc name', () => {
    const p = write(tmpName(), '[]');
    const d = write(tmpName(), '{oops');
    expectError(run([p, d]), `Error: ${d}: invalid JSON`, 3);
  });

  it('non-array patch is only checked after the doc is read', () => {
    const p = write(tmpName(), '{}');
    expectError(run([p, 'nope.json'], { cwd: dir }), 'Error: nope.json: no such file', 1);
  });
});

describe('apply errors', () => {
  const doc = () => write(tmpName(), '{"a":1}');

  it('patch must be an array', () => {
    const p = write(tmpName(), '{}');
    expectError(run([p, doc()]), 'Error: patch must be an array', 4);
  });

  it('test failed', () => {
    const p = write(tmpName(), '[{"op":"test","path":"/a","value":2}]');
    expectError(run([p, doc()]), 'Error: operation 0: test failed', 4);
  });

  it('cannot remove root', () => {
    const p = write(tmpName(), '[{"op":"remove","path":""}]');
    expectError(run([p, doc()]), 'Error: operation 0: cannot remove root', 4);
  });

  it('bad index', () => {
    const p = write(tmpName(), '[{"op":"remove","path":"/01"}]');
    const d = write(tmpName(), '[1,2]');
    expectError(run([p, d]), 'Error: operation 0: bad index', 4);
  });
});
