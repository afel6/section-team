import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  run, runAsync, tempDir, writeFile, assertFailure, assertSuccess, padded, BOM, LIMIT, USAGE,
} from './cli-helpers.mjs';

const dir = tempDir();
const isRoot = process.getuid?.() === 0;
const nest = (n, open = '[', close = ']', leaf = '') => open.repeat(n) + leaf + close.repeat(n);
const okPatch = () => writeFile(dir, 'ok-patch.json', '[]');
const okDoc = () => writeFile(dir, 'ok-doc.json', '{}');

describe('usage (exit 2)', () => {
  it('0 args', () => assertFailure(run([]), 2, USAGE));

  it('3 args even when all files exist', () => {
    const a = okPatch();
    const b = okDoc();
    assertFailure(run([a, b, b]), 2, USAGE);
  });

  it('3 nonexistent paths', () => {
    assertFailure(run(['n1.json', 'n2.json', 'n3.json'], { cwd: dir }), 2, USAGE);
  });

  it('"-" alone', () => assertFailure(run(['-'], { input: '[]' }), 2, USAGE));
  it('"-" "-"', () => assertFailure(run(['-', '-'], { input: '[]' }), 2, USAGE));

  describe('only exactly "-" means stdin', () => {
    const docName = 'stdin-doc.json';
    const withDoc = () => {
      okPatch();
      writeFile(dir, docName, '{}');
    };

    it('"--" as patch is a file name', () => {
      withDoc();
      assertFailure(run(['--', docName], { cwd: dir }), 1, 'Error: --: no such file');
    });

    it('"./-" as patch is a file name', () => {
      withDoc();
      assertFailure(run(['./-', docName], { cwd: dir }), 1, 'Error: ./-: no such file');
    });

    it('"--" as doc is a file name', () => {
      withDoc();
      assertFailure(run(['ok-patch.json', '--'], { cwd: dir }), 1, 'Error: --: no such file');
    });

    it('empty string as patch is a file name', () => {
      withDoc();
      assertFailure(run(['', docName], { cwd: dir }), 1, 'Error: : no such file');
    });

    it('a real file named "-x" works as patch', () => {
      withDoc();
      writeFile(dir, '-x', '[]');
      assertSuccess(run(['-x', docName], { cwd: dir }), {});
    });
  });
});

describe('read errors (exit 1)', () => {
  it('missing file', () => {
    const p = path.join(dir, 'missing.json');
    assertFailure(run([p, okDoc()]), 1, `Error: ${p}: no such file`);
  });

  it('missing file given as a relative path', () => {
    writeFile(dir, 'p.json', '[]');
    assertFailure(run(['p.json', 'missing.json'], { cwd: dir }), 1, 'Error: missing.json: no such file');
  });

  it('regular file used as a directory (ENOTDIR)', () => {
    const f = okPatch();
    const p = `${f}/x`;
    assertFailure(run([p, okDoc()]), 1, `Error: ${p}: no such file`);
  });

  it('directory', () => {
    const d = path.join(dir, 'adir');
    fs.mkdirSync(d);
    assertFailure(run([d, okDoc()]), 1, `Error: ${d}: is a directory`);
  });

  it('doc that is a directory', () => {
    const d = path.join(dir, 'adir2');
    fs.mkdirSync(d);
    assertFailure(run([okPatch(), d]), 1, `Error: ${d}: is a directory`);
  });

  it('directory with mode 000', (t) => {
    const d = path.join(dir, 'locked');
    fs.mkdirSync(d);
    try {
      fs.chmodSync(d, 0o000);
    } catch (err) {
      t.skip(`chmod failed: ${err.code}`);
      return;
    }
    try {
      assertFailure(run([d, okDoc()]), 1, `Error: ${d}: is a directory`);
    } finally {
      fs.chmodSync(d, 0o755);
    }
  });

  it('regular file with mode 000 cannot be read', (t) => {
    if (isRoot) { t.skip('running as root'); return; }
    const f = writeFile(dir, 'noperm.json', '[]');
    fs.chmodSync(f, 0o000);
    try {
      assertFailure(run([f, okDoc()]), 1, `Error: ${f}: cannot read`);
    } finally {
      fs.chmodSync(f, 0o644);
    }
  });

  it('symlink loop cannot be read', () => {
    const link = path.join(dir, 'loop');
    fs.symlinkSync(link, link);
    assertFailure(run([link, okDoc()]), 1, `Error: ${link}: cannot read`);
  });

  it('stdin that is a directory fd', () => {
    const d = path.join(dir, 'stdindir');
    fs.mkdirSync(d);
    const fd = fs.openSync(d, 'r');
    try {
      assertFailure(run([okPatch()], { stdinFd: fd }), 1, 'Error: stdin: cannot read');
    } finally {
      fs.closeSync(fd);
    }
  });
});

describe('size limit (exit 1)', () => {
  it('file of 1048577 bytes', () => {
    const p = writeFile(dir, 'big1.json', padded(LIMIT + 1));
    assertFailure(run([p, okDoc()]), 1, `Error: ${p}: too large`);
  });

  it('doc file of 1048577 bytes', () => {
    const d = writeFile(dir, 'big2.json', padded(LIMIT + 1));
    assertFailure(run([okPatch(), d]), 1, `Error: ${d}: too large`);
  });

  it('BOM counts toward the limit', () => {
    const p = writeFile(dir, 'big3.json', padded(LIMIT + 1, BOM));
    assertFailure(run([p, okDoc()]), 1, `Error: ${p}: too large`);
  });

  it('stdin of 1048577 bytes', () => {
    const f = writeFile(dir, 'big4.json', padded(LIMIT + 1));
    const fd = fs.openSync(f, 'r');
    try {
      assertFailure(run([okPatch()], { stdinFd: fd }), 1, 'Error: stdin: too large');
    } finally {
      fs.closeSync(fd);
    }
  });

  it('stdin patch of 1048577 bytes', () => {
    assertFailure(run(['-', okDoc()], { input: padded(LIMIT + 1) }), 1, 'Error: stdin: too large');
  });

  // /dev/zero reports size 0 but never ends: only counting the bytes read stops it.
  it('counts bytes read, not the reported size (/dev/zero)', (t) => {
    if (!fs.existsSync('/dev/zero')) { t.skip('no /dev/zero'); return; }
    assertFailure(run(['/dev/zero', okDoc()], { timeout: 20000 }), 1, 'Error: /dev/zero: too large');
  });

  it('too large beats invalid UTF-8', () => {
    const p = writeFile(dir, 'big5.json', Buffer.alloc(LIMIT + 1, 0xff));
    assertFailure(run([p, okDoc()]), 1, `Error: ${p}: too large`);
  });
});

describe('decode errors (exit 3)', () => {
  const cases = {
    '0xFF': [0xff],
    'overlong C0 80': [0xc0, 0x80],
    'lone surrogate ED A0 80': [0xed, 0xa0, 0x80],
    'truncated E2 82': [0xe2, 0x82],
  };
  for (const [label, bytes] of Object.entries(cases)) {
    const content = () => Buffer.concat([Buffer.from('["a'), Buffer.from(bytes), Buffer.from('b"]')]);

    it(`patch with ${label}`, () => {
      const p = writeFile(dir, `u-${bytes.join('-')}.json`, content());
      assertFailure(run([p, okDoc()]), 3, `Error: ${p}: invalid UTF-8`);
    });

    it(`doc with ${label}`, () => {
      const d = writeFile(dir, `ud-${bytes.join('-')}.json`, content());
      assertFailure(run([okPatch(), d]), 3, `Error: ${d}: invalid UTF-8`);
    });

    it(`stdin with ${label}`, () => {
      assertFailure(run([okPatch()], { input: content() }), 3, 'Error: stdin: invalid UTF-8');
    });
  }
});

describe('parse errors (exit 3)', () => {
  it('empty file', () => {
    const p = writeFile(dir, 'empty.json', '');
    assertFailure(run([p, okDoc()]), 3, `Error: ${p}: invalid JSON`);
  });

  it('whitespace-only file', () => {
    const p = writeFile(dir, 'ws.json', ' \n\t ');
    assertFailure(run([p, okDoc()]), 3, `Error: ${p}: invalid JSON`);
  });

  it('empty stdin', () => {
    assertFailure(run([okPatch()], { input: '' }), 3, 'Error: stdin: invalid JSON');
  });

  it('empty stdin as patch', () => {
    assertFailure(run(['-', okDoc()], { input: '' }), 3, 'Error: stdin: invalid JSON');
  });

  for (const [i, text] of ['undefined', '{a:1}', '[1,]', 'NaN', '[] []', "['a']"].entries()) {
    it(`rejects ${text}`, () => {
      const d = writeFile(dir, `bad-${i}.json`, text);
      assertFailure(run([okPatch(), d]), 3, `Error: ${d}: invalid JSON`);
    });
  }
});

describe('depth (exit 3)', () => {
  const tooDeep = (file) => `Error: ${file}: too deep`;
  const shapes = {
    arrays: (n) => nest(n),
    objects: (n) => '{"a":'.repeat(n - 1) + '{}' + '}'.repeat(n - 1),
    'arrays around a scalar': (n) => nest(n, '[', ']', '1'),
  };
  for (const [label, make] of Object.entries(shapes)) {
    const slug = label.replace(/\W+/g, '-');
    it(`${label}: depth 1000 is accepted as doc`, () => {
      const d = writeFile(dir, `deep-ok-${slug}-1000.json`, make(1000));
      assertSuccess(run([okPatch(), d]), JSON.parse(make(1000)));
    });

    it(`${label}: depth 1001 is too deep as doc`, () => {
      const d = writeFile(dir, `deep-bad-${slug}-1001.json`, make(1001));
      assertFailure(run([okPatch(), d]), 3, tooDeep(d));
    });

    it(`${label}: depth 1001 is too deep on stdin`, () => {
      assertFailure(run([okPatch()], { input: make(1001) }), 3, 'Error: stdin: too deep');
    });
  }

  it('a patch 1001 deep is too deep for the patch', () => {
    const p = writeFile(dir, 'patch-deep.json', nest(1001));
    assertFailure(run([p, okDoc()]), 3, tooDeep(p));
  });

  it('[{}] has depth 2 and is fine', () => {
    const d = writeFile(dir, 'shallow.json', '[{}]');
    assertSuccess(run([okPatch(), d]), [{}]);
  });

  it('huge depth is reported as one friendly line', () => {
    const d = writeFile(dir, 'huge.json', nest(500000));
    assertFailure(run([okPatch(), d]), 3, tooDeep(d));
  });

  it('huge depth patch on stdin', () => {
    assertFailure(run(['-', okDoc()], { input: nest(500000) }), 3, 'Error: stdin: too deep');
  });
});

describe('step order', () => {
  const missing = (n) => path.join(dir, n);

  it('bad patch JSON + missing doc: patch error', () => {
    const p = writeFile(dir, 'so1.json', '[');
    assertFailure(run([p, missing('nodoc.json')]), 3, `Error: ${p}: invalid JSON`);
  });

  it('missing patch + missing doc: patch error', () => {
    const p = missing('nopatch.json');
    assertFailure(run([p, missing('nodoc.json')]), 1, `Error: ${p}: no such file`);
  });

  it('patch too deep + doc invalid UTF-8: patch error', () => {
    const p = writeFile(dir, 'so2.json', nest(1001));
    const d = writeFile(dir, 'so2d.json', Buffer.from([0xff]));
    assertFailure(run([p, d]), 3, `Error: ${p}: too deep`);
  });

  it('valid patch + missing doc: doc error', () => {
    const d = missing('nodoc2.json');
    assertFailure(run([okPatch(), d]), 1, `Error: ${d}: no such file`);
  });

  it('valid patch + invalid doc + failing patch: doc error (3, not 4)', () => {
    const p = writeFile(dir, 'so3.json', '[{"op":"nope"}]');
    const d = writeFile(dir, 'so3d.json', '{bad');
    assertFailure(run([p, d]), 3, `Error: ${d}: invalid JSON`);
  });

  it('bad patch file + bad stdin doc: patch error', () => {
    const p = writeFile(dir, 'so4.json', 'nope');
    assertFailure(run([p], { input: 'also nope' }), 3, `Error: ${p}: invalid JSON`);
  });

  it('bad patch file + oversized stdin doc: patch error', () => {
    const p = writeFile(dir, 'so5.json', 'nope');
    assertFailure(run([p, '-'], { input: padded(LIMIT + 1) }), 3, `Error: ${p}: invalid JSON`);
  });

  it('oversized stdin patch beats missing doc', () => {
    const d = missing('nodoc3.json');
    assertFailure(run(['-', d], { input: padded(LIMIT + 1) }), 1, 'Error: stdin: too large');
  });

  describe('the document is not read before the patch passes', () => {
    const patches = { 'invalid JSON': ['nope', 'invalid JSON'], 'too deep': [nest(1001), 'too deep'] };
    for (const [label, [text, message]] of Object.entries(patches)) {
      for (const extra of [[], ['-']]) {
        it(`${label} patch, doc args ${JSON.stringify(extra)}, stdin left open`, async () => {
          const p = writeFile(dir, `so-open-${label.replace(/\W+/g, '-')}-${extra.length}.json`, text);
          const r = await runAsync([p, ...extra], { stdinOpen: true, timeoutMs: 10000 });
          assert.equal(r.timedOut, false);
          assertFailure(r, 3, `Error: ${p}: ${message}`);
        });
      }
    }
  });
});

describe('apply errors (exit 4)', () => {
  const apply = (patchText, docText = '{}') => {
    const p = writeFile(dir, 'ap.json', patchText);
    const d = writeFile(dir, 'ad.json', docText);
    return run([p, d]);
  };

  it('bad op', () => {
    assertFailure(apply('[{"op":"nope","path":""}]'), 4, 'Error: operation 0: bad op');
  });

  it('test failed at operation 1', () => {
    const patch = '[{"op":"add","path":"/a","value":1},{"op":"test","path":"/a","value":2}]';
    assertFailure(apply(patch), 4, 'Error: operation 1: test failed');
  });

  it('patch is not an array', () => {
    assertFailure(apply('{}'), 4, 'Error: patch must be an array');
  });

  it('path not found', () => {
    assertFailure(apply('[{"op":"remove","path":"/zzz"}]'), 4, 'Error: operation 0: path not found');
  });

  it('form check failure reported before applying earlier operations', () => {
    const patch = '[{"op":"add","path":"/a","value":1},{"op":"add"}]';
    assertFailure(apply(patch), 4, 'Error: operation 1: bad path');
  });

  it('patch from stdin failing to apply', () => {
    const d = writeFile(dir, 'ad2.json', '[]');
    assertFailure(run(['-', d], { input: '[{"op":"remove","path":"/0"}]' }), 4,
      'Error: operation 0: path not found');
  });
});
