// CLI tests: arguments, read errors and step order.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { runCli, assertCliError, assertCliOk, makeTmp, nestedArrayText } from './helpers.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const LIMIT = 1048576;
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const isRoot = process.getuid?.() === 0;
const quoted = (n) => '"' + 'a'.repeat(n - 2) + '"'; // JSON string of exactly n bytes

const tmp = makeTmp();
after(() => tmp.cleanup());

const emptyPatch = () => tmp.file('empty-patch.json', '[]');
const okDoc = () => tmp.file('ok-doc.json', '{"a":1}');
const run = (args, opts = {}) => runCli(args, { cwd: tmp.dir, ...opts });

describe('usage', () => {
  before(() => {
    emptyPatch();
    okDoc();
  });
  test('no arguments', () => assertCliError(run([]), 2, USAGE));
  test('three arguments, valid files', () => {
    assertCliError(run(['empty-patch.json', 'ok-doc.json', 'ok-doc.json']), 2, USAGE);
  });
  test('three arguments with nonexistent files: usage first', () => {
    assertCliError(run(['x1', 'x2', 'x3']), 2, USAGE);
  });
  test('patch - alone means both inputs are stdin', () => {
    assertCliError(run(['-'], { stdin: '[]' }), 2, USAGE);
  });
  test('- and - means both inputs are stdin', () => {
    assertCliError(run(['-', '-'], { stdin: '[]' }), 2, USAGE);
  });
  test('./- is a file path, not stdin', () => {
    const dir = fs.mkdtempSync(join(tmp.dir, 'dash-'));
    fs.writeFileSync(join(dir, '-'), '[]');
    fs.writeFileSync(join(dir, 'd.json'), '{"k":1}');
    assertCliOk(runCli(['./-', 'd.json'], { cwd: dir }), '{\n  "k": 1\n}\n');
  });
});

describe('no such file', () => {
  before(() => {
    emptyPatch();
    okDoc();
  });
  test('missing patch, relative name as given', () => {
    assertCliError(run(['nope.json', 'ok-doc.json']), 1, 'Error: nope.json: no such file');
  });
  test('missing patch, absolute path as given', () => {
    const p = join(tmp.dir, 'absent.json');
    assertCliError(run([p, 'ok-doc.json']), 1, `Error: ${p}: no such file`);
  });
  test('ENOTDIR counts as no such file', () => {
    assertCliError(run(['empty-patch.json/x', 'ok-doc.json']), 1, 'Error: empty-patch.json/x: no such file');
  });
  test('missing doc file', () => {
    assertCliError(run(['empty-patch.json', 'gone.json']), 1, 'Error: gone.json: no such file');
  });
  test('missing doc with ENOTDIR', () => {
    assertCliError(run(['empty-patch.json', 'ok-doc.json/y']), 1, 'Error: ok-doc.json/y: no such file');
  });
  test('names with spaces and non-ASCII are used as given', () => {
    tmp.file('my patch é.json', '[]');
    assertCliOk(run(['my patch é.json', 'ok-doc.json']), '{\n  "a": 1\n}\n');
    assertCliError(run(['my patch ü.json', 'ok-doc.json']), 1, 'Error: my patch ü.json: no such file');
  });
  test('missing doc name with spaces and non-ASCII', () => {
    assertCliError(run(['empty-patch.json', 'dök ument.json']), 1, 'Error: dök ument.json: no such file');
  });
});

describe('is a directory', () => {
  before(() => {
    emptyPatch();
    okDoc();
    fs.mkdirSync(join(tmp.dir, 'sub'), { recursive: true });
  });
  test('tmp dir itself as patch', () => {
    assertCliError(run([tmp.dir, 'ok-doc.json']), 1, `Error: ${tmp.dir}: is a directory`);
  });
  test('directory as doc', () => {
    assertCliError(run(['empty-patch.json', 'sub']), 1, 'Error: sub: is a directory');
  });
  test('directory with trailing slash', () => {
    assertCliError(run(['sub/', 'ok-doc.json']), 1, 'Error: sub/: is a directory');
  });
  test('directory with mode 000 is still a directory', () => {
    const d = join(tmp.dir, 'locked');
    fs.mkdirSync(d, { recursive: true });
    fs.chmodSync(d, 0o000);
    try {
      assertCliError(run(['empty-patch.json', 'locked']), 1, 'Error: locked: is a directory');
    } finally {
      fs.chmodSync(d, 0o755);
    }
  });
});

describe('too large', () => {
  test('exactly 1048576 bytes is accepted', () => {
    const text = quoted(LIMIT);
    assert.equal(Buffer.byteLength(text), LIMIT);
    tmp.file('exact.json', text);
    assertCliOk(run([emptyPatch(), 'exact.json']), JSON.stringify(JSON.parse(text), null, 2) + '\n');
  });
  test('1048577 bytes is too large', () => {
    tmp.file('over.json', quoted(LIMIT + 1));
    assertCliError(run([emptyPatch(), 'over.json']), 1, 'Error: over.json: too large');
  });
  test('patch file too large', () => {
    tmp.file('bigpatch.json', quoted(LIMIT + 1));
    assertCliError(run(['bigpatch.json', okDoc()]), 1, 'Error: bigpatch.json: too large');
  });
  test('BOM + JSON totalling 1048576 bytes is accepted', () => {
    const body = quoted(LIMIT - 3);
    tmp.file('bom-exact.json', Buffer.concat([BOM, Buffer.from(body)]));
    assertCliOk(run([emptyPatch(), 'bom-exact.json']), JSON.stringify(JSON.parse(body), null, 2) + '\n');
  });
  test('BOM counts toward the limit', () => {
    tmp.file('bom-over.json', Buffer.concat([BOM, Buffer.from(quoted(LIMIT - 2))]));
    assertCliError(run([emptyPatch(), 'bom-over.json']), 1, 'Error: bom-over.json: too large');
  });
  test('stdin of 1048577 bytes is too large', () => {
    assertCliError(run([emptyPatch()], { stdin: quoted(LIMIT + 1) }), 1, 'Error: stdin: too large');
  });
  test('stdin of exactly 1048576 bytes is accepted', () => {
    const text = quoted(LIMIT);
    assertCliOk(run([emptyPatch()], { stdin: text }), JSON.stringify(JSON.parse(text), null, 2) + '\n');
  });
  test('patch on stdin too large', () => {
    assertCliError(run(['-', okDoc()], { stdin: quoted(LIMIT + 1) }), 1, 'Error: stdin: too large');
  });
  test('/dev/zero counts bytes read, not the reported size', { skip: !fs.existsSync('/dev/zero') }, () => {
    assertCliError(run([emptyPatch(), '/dev/zero']), 1, 'Error: /dev/zero: too large');
  });
  test('too large wins over invalid UTF-8', () => {
    tmp.file('ff.bin', Buffer.alloc(LIMIT + 1, 0xff));
    assertCliError(run([emptyPatch(), 'ff.bin']), 1, 'Error: ff.bin: too large');
  });
  test('too large wins over invalid JSON', () => {
    tmp.file('junk.txt', 'x'.repeat(LIMIT + 1));
    assertCliError(run([emptyPatch(), 'junk.txt']), 1, 'Error: junk.txt: too large');
  });
});

describe('cannot read', () => {
  test('symlink loop exists but cannot be opened (ELOOP)', () => {
    fs.symlinkSync('loop.json', join(tmp.dir, 'loop.json'));
    assertCliError(run(['loop.json', okDoc()]), 1, 'Error: loop.json: cannot read');
  });
  test('mode 000 file', { skip: isRoot && 'running as root' }, () => {
    const p = tmp.file('locked.json', '[]');
    fs.chmodSync(p, 0o000);
    try {
      assertCliError(run(['locked.json', okDoc()]), 1, 'Error: locked.json: cannot read');
    } finally {
      fs.chmodSync(p, 0o644);
    }
  });
  test('unreadable 2MB file is cannot read, not too large', { skip: isRoot && 'running as root' }, () => {
    const p = tmp.file('locked-big.json', quoted(2 * LIMIT));
    fs.chmodSync(p, 0o000);
    try {
      assertCliError(run([emptyPatch(), 'locked-big.json']), 1, 'Error: locked-big.json: cannot read');
    } finally {
      fs.chmodSync(p, 0o644);
    }
  });
});

describe('step order', () => {
  test('invalid JSON patch beats missing doc', () => {
    tmp.file('bad.json', '[');
    assertCliError(run(['bad.json', 'missing.json']), 3, 'Error: bad.json: invalid JSON');
  });
  test('invalid UTF-8 patch beats directory doc', () => {
    tmp.file('u.bin', Buffer.from([0x5b, 0xff, 0x5d]));
    fs.mkdirSync(join(tmp.dir, 'sub2'), { recursive: true });
    assertCliError(run(['u.bin', 'sub2']), 3, 'Error: u.bin: invalid UTF-8');
  });
  test('too deep patch beats missing doc', () => {
    tmp.file('deep.json', '[' + nestedArrayText(1000) + ']');
    assertCliError(run(['deep.json', 'missing.json']), 3, 'Error: deep.json: too deep');
  });
  test('missing patch beats missing doc', () => {
    assertCliError(run(['nopatch.json', 'nodoc.json']), 1, 'Error: nopatch.json: no such file');
  });
  test('valid patch, invalid doc', () => {
    tmp.file('baddoc.json', '{');
    assertCliError(run([emptyPatch(), 'baddoc.json']), 3, 'Error: baddoc.json: invalid JSON');
  });
  test('doc read errors come before applying the patch', () => {
    tmp.file('obj-patch.json', '{}');
    assertCliError(run(['obj-patch.json', 'missing.json']), 1, 'Error: missing.json: no such file');
  });
  test('stdin doc invalid JSON', () => {
    assertCliError(run([emptyPatch()], { stdin: '{oops' }), 3, 'Error: stdin: invalid JSON');
  });
  test('patch on stdin, bad op, doc file', () => {
    assertCliError(run(['-', okDoc()], { stdin: '[{"op":"bogus"}]' }), 4, 'Error: operation 0: bad op');
  });
  test('patch on stdin invalid beats missing doc', () => {
    assertCliError(run(['-', 'missing.json'], { stdin: '[' }), 3, 'Error: stdin: invalid JSON');
  });
  test('stdin is not read when the patch file fails', () => {
    assertCliError(run(['nopatch.json'], { stdin: 'x'.repeat(LIMIT + 10) }), 1, 'Error: nopatch.json: no such file');
    assertCliError(run(['nopatch.json'], { stdin: '{' }), 1, 'Error: nopatch.json: no such file');
  });
  test('doc on stdin passed as - works', () => {
    assertCliOk(run([emptyPatch(), '-'], { stdin: '[1]' }), '[\n  1\n]\n');
  });
});
