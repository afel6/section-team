import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  BOM,
  USAGE_LINE,
  expectError,
  expectOk,
  makeTmpDir,
  paddedJson,
  removeTmpDir,
  run,
  writeIn,
} from './helpers/cli-runner.mjs';

let dir;
let tmpPath;

before(() => {
  dir = makeTmpDir();
  tmpPath = (name) => path.join(dir, name);
});

after(() => {
  removeTmpDir(dir);
});

const ADD_B = '[{"op":"add","path":"/b","value":[1,{"c":null}]}]';
const ADD_B_OUT = '{\n  "a": 1,\n  "b": [\n    1,\n    {\n      "c": null\n    }\n  ]\n}\n';
const deepArr = (n) => '['.repeat(n) + ']'.repeat(n);
const deepObj = (n) => '{"a":'.repeat(n) + '1' + '}'.repeat(n);

describe('usage', () => {
  test('0 args', () => {
    expectError(run([]), USAGE_LINE, 2);
  });
  test('3 args', () => {
    expectError(run(['a', 'b', 'c']), USAGE_LINE, 2);
  });
  test('3 args with nonexistent files is usage, not no such file', () => {
    expectError(run([tmpPath('x1.json'), tmpPath('x2.json'), tmpPath('x3.json')]), USAGE_LINE, 2);
  });
  test('single "-" (both stdin)', () => {
    expectError(run(['-'], { input: '[]' }), USAGE_LINE, 2);
  });
  test('"-" "-"', () => {
    expectError(run(['-', '-'], { input: '[]' }), USAGE_LINE, 2);
  });
});

describe('success', () => {
  test('patch file + doc file', () => {
    const patchFile = writeIn(dir, 'p1.json', ADD_B);
    const docFile = writeIn(dir, 'd1.json', '{"a":1}');
    expectOk(run([patchFile, docFile]), ADD_B_OUT);
  });
  test('patch file + doc via stdin (one arg)', () => {
    const patchFile = writeIn(dir, 'p2.json', ADD_B);
    expectOk(run([patchFile], { input: '{"a":1}' }), ADD_B_OUT);
  });
  test('patch file + "-" doc via stdin', () => {
    const patchFile = writeIn(dir, 'p3.json', ADD_B);
    expectOk(run([patchFile, '-'], { input: '{"a":1}' }), ADD_B_OUT);
  });
  test('patch "-" via stdin + doc file', () => {
    const docFile = writeIn(dir, 'd4.json', '{"a":1}');
    expectOk(run(['-', docFile], { input: ADD_B }), ADD_B_OUT);
  });
  test('scalar result', () => {
    const patchFile = writeIn(dir, 'p5.json', '[{"op":"replace","path":"","value":"x"}]');
    const docFile = writeIn(dir, 'd5.json', '{"a":1}');
    expectOk(run([patchFile, docFile]), '"x"\n');
  });
  test('scalar doc with empty patch', () => {
    const patchFile = writeIn(dir, 'p6.json', '[]');
    const docFile = writeIn(dir, 'd6.json', '5');
    expectOk(run([patchFile, docFile]), '5\n');
  });
  test('empty array doc with empty patch', () => {
    const patchFile = writeIn(dir, 'p7.json', '[]');
    const docFile = writeIn(dir, 'd7.json', '[]');
    expectOk(run([patchFile, docFile]), '[]\n');
  });
  test('non-ASCII value round-trips as raw UTF-8', () => {
    const patchFile = writeIn(dir, 'p8.json', '[{"op":"add","path":"/s","value":"é€😀"}]');
    const docFile = writeIn(dir, 'd8.json', '{}');
    expectOk(run([patchFile, docFile]), '{\n  "s": "é€😀"\n}\n');
  });
  test('non-ASCII value in doc round-trips', () => {
    const patchFile = writeIn(dir, 'p9.json', '[]');
    const docFile = writeIn(dir, 'd9.json', '["é€😀"]');
    expectOk(run([patchFile, docFile]), '[\n  "é€😀"\n]\n');
  });
  test('negative zero prints as 0', () => {
    const patchFile = writeIn(dir, 'p-nz.json', '[]');
    const docFile = writeIn(dir, 'd-nz.json', '{"a":-0}');
    expectOk(run([patchFile, docFile]), '{\n  "a": 0\n}\n');
  });
});

describe('BOM and encoding', () => {
  test('BOM before patch JSON is ignored', () => {
    const patchFile = writeIn(dir, 'bp.json', Buffer.concat([BOM, Buffer.from('[]')]));
    const docFile = writeIn(dir, 'bd.json', '[1]');
    expectOk(run([patchFile, docFile]), '[\n  1\n]\n');
  });
  test('BOM before doc JSON is ignored', () => {
    const patchFile = writeIn(dir, 'bp2.json', '[]');
    const docFile = writeIn(dir, 'bd2.json', Buffer.concat([BOM, Buffer.from('[1]')]));
    expectOk(run([patchFile, docFile]), '[\n  1\n]\n');
  });
  test('BOM not at start (after whitespace) is invalid JSON', () => {
    const patchFile = writeIn(dir, 'bp3.json', Buffer.concat([Buffer.from(' '), BOM, Buffer.from('[]')]));
    expectError(run([patchFile, tmpPath('none.json')]), `Error: ${patchFile}: invalid JSON`, 3);
  });
  test('double BOM is invalid JSON', () => {
    const patchFile = writeIn(dir, 'bp4.json', Buffer.concat([BOM, BOM, Buffer.from('[]')]));
    expectError(run([patchFile, tmpPath('none.json')]), `Error: ${patchFile}: invalid JSON`, 3);
  });
  test('UTF-16LE BOM is invalid UTF-8', () => {
    const patchFile = writeIn(dir, 'bp5.json', Buffer.from([0xff, 0xfe, 0x5b, 0x00, 0x5d, 0x00]));
    expectError(run([patchFile, tmpPath('none.json')]), `Error: ${patchFile}: invalid UTF-8`, 3);
  });
});

describe('invalid UTF-8', () => {
  const cases = {
    'C3 28': Buffer.from([0xc3, 0x28]),
    'lone FF': Buffer.from([0xff]),
    'overlong C0 AF': Buffer.from([0xc0, 0xaf]),
    'encoded surrogate ED A0 80 in string': Buffer.concat([
      Buffer.from('["'),
      Buffer.from([0xed, 0xa0, 0x80]),
      Buffer.from('"]'),
    ]),
  };
  for (const [label, bytes] of Object.entries(cases)) {
    test(`patch: ${label}`, () => {
      const patchFile = writeIn(dir, 'u-p.json', bytes);
      expectError(run([patchFile, tmpPath('none.json')]), `Error: ${patchFile}: invalid UTF-8`, 3);
    });
    test(`doc: ${label}`, () => {
      const patchFile = writeIn(dir, 'u-pp.json', '[]');
      const docFile = writeIn(dir, 'u-d.json', bytes);
      expectError(run([patchFile, docFile]), `Error: ${docFile}: invalid UTF-8`, 3);
    });
  }
  test('stdin doc invalid UTF-8 names stdin', () => {
    const patchFile = writeIn(dir, 'u-ps.json', '[]');
    expectError(run([patchFile], { input: Buffer.from([0xff]) }), 'Error: stdin: invalid UTF-8', 3);
  });
});

describe('invalid JSON', () => {
  const cases = {
    empty: '',
    'whitespace only': ' \n\t ',
    'BOM only': BOM,
    '{a:1}': '{a:1}',
    'trailing comma': '[1,]',
    NaN: 'NaN',
  };
  for (const [label, content] of Object.entries(cases)) {
    test(`patch: ${label}`, () => {
      const patchFile = writeIn(dir, 'j-p.json', content);
      expectError(run([patchFile, tmpPath('none.json')]), `Error: ${patchFile}: invalid JSON`, 3);
    });
    test(`doc: ${label}`, () => {
      const patchFile = writeIn(dir, 'j-pp.json', '[]');
      const docFile = writeIn(dir, 'j-d.json', content);
      expectError(run([patchFile, docFile]), `Error: ${docFile}: invalid JSON`, 3);
    });
  }
  test('stdin patch invalid JSON names stdin', () => {
    const docFile = writeIn(dir, 'j-ds.json', '{}');
    expectError(run(['-', docFile], { input: '{a:1}' }), 'Error: stdin: invalid JSON', 3);
  });
  test('empty stdin doc names stdin', () => {
    const patchFile = writeIn(dir, 'j-ps.json', '[]');
    expectError(run([patchFile], { input: '' }), 'Error: stdin: invalid JSON', 3);
  });
});

describe('depth', () => {
  test('patch depth 1000 passes depth check (PatchError later)', () => {
    const patchFile = writeIn(dir, 'dp1000.json', deepArr(1000));
    const docFile = writeIn(dir, 'dd.json', '{}');
    expectError(run([patchFile, docFile]), 'Error: operation 0: not an object', 4);
  });
  test('patch depth 1001 is too deep', () => {
    const patchFile = writeIn(dir, 'dp1001.json', deepArr(1001));
    const docFile = writeIn(dir, 'dd2.json', '{}');
    expectError(run([patchFile, docFile]), `Error: ${patchFile}: too deep`, 3);
  });
  test('doc array depth 1000 is OK', () => {
    const patchFile = writeIn(dir, 'dp0.json', '[]');
    const docFile = writeIn(dir, 'dd1000.json', deepArr(1000));
    expectOk(run([patchFile, docFile]), `${JSON.stringify(JSON.parse(deepArr(1000)), null, 2)}\n`);
  });
  test('doc array depth 1001 is too deep', () => {
    const patchFile = writeIn(dir, 'dp0b.json', '[]');
    const docFile = writeIn(dir, 'dd1001.json', deepArr(1001));
    expectError(run([patchFile, docFile]), `Error: ${docFile}: too deep`, 3);
  });
  test('doc mixed object depth 1000 is OK', () => {
    const patchFile = writeIn(dir, 'dp0c.json', '[]');
    const docFile = writeIn(dir, 'ddo1000.json', deepObj(1000));
    expectOk(run([patchFile, docFile]), `${JSON.stringify(JSON.parse(deepObj(1000)), null, 2)}\n`);
  });
  test('doc mixed object depth 1001 is too deep', () => {
    const patchFile = writeIn(dir, 'dp0d.json', '[]');
    const docFile = writeIn(dir, 'ddo1001.json', deepObj(1001));
    expectError(run([patchFile, docFile]), `Error: ${docFile}: too deep`, 3);
  });
  test('stdin doc too deep names stdin', () => {
    const patchFile = writeIn(dir, 'dp0e.json', '[]');
    expectError(run([patchFile], { input: deepArr(1001) }), 'Error: stdin: too deep', 3);
  });
  test('stdin patch too deep names stdin', () => {
    const docFile = writeIn(dir, 'dd3.json', '{}');
    expectError(run(['-', docFile], { input: deepArr(1001) }), 'Error: stdin: too deep', 3);
  });
});

describe('PatchError', () => {
  test('patch is not an array', () => {
    const patchFile = writeIn(dir, 'e1.json', '{}');
    const docFile = writeIn(dir, 'e1d.json', '{}');
    expectError(run([patchFile, docFile]), 'Error: patch must be an array', 4);
  });
  test('test op failure', () => {
    const patchFile = writeIn(dir, 'e2.json', '[{"op":"test","path":"/a","value":2}]');
    const docFile = writeIn(dir, 'e2d.json', '{"a":1}');
    expectError(run([patchFile, docFile]), 'Error: operation 0: test failed', 4);
  });
  test('bad op', () => {
    const patchFile = writeIn(dir, 'e3.json', '[{"op":"x"}]');
    const docFile = writeIn(dir, 'e3d.json', '{}');
    expectError(run([patchFile, docFile]), 'Error: operation 0: bad op', 4);
  });
});

describe('order of checks', () => {
  const badJson = () => writeIn(dir, 'o-bad.json', '{a:1}');
  test('invalid JSON patch + nonexistent doc -> patch error', () => {
    const patchFile = badJson();
    expectError(run([patchFile, tmpPath('missing.json')]), `Error: ${patchFile}: invalid JSON`, 3);
  });
  test('missing patch + missing doc -> patch no such file', () => {
    const patchFile = tmpPath('missing-p.json');
    expectError(run([patchFile, tmpPath('missing-d.json')]), `Error: ${patchFile}: no such file`, 1);
  });
  test('invalid UTF-8 patch + directory doc -> patch error', () => {
    const patchFile = writeIn(dir, 'o-u.json', Buffer.from([0xff]));
    expectError(run([patchFile, dir]), `Error: ${patchFile}: invalid UTF-8`, 3);
  });
  test('too-deep patch + too-large doc -> patch too deep', () => {
    const patchFile = writeIn(dir, 'o-deep.json', deepArr(1001));
    const docFile = writeIn(dir, 'o-large.json', paddedJson(1048577));
    expectError(run([patchFile, docFile]), `Error: ${patchFile}: too deep`, 3);
  });
  test('valid patch + missing doc -> doc no such file', () => {
    const patchFile = writeIn(dir, 'o-ok.json', '[]');
    const docFile = tmpPath('o-missing.json');
    expectError(run([patchFile, docFile]), `Error: ${docFile}: no such file`, 1);
  });
  test('valid patch + invalid JSON doc -> doc error', () => {
    const patchFile = writeIn(dir, 'o-ok2.json', '[]');
    const docFile = badJson();
    expectError(run([patchFile, docFile]), `Error: ${docFile}: invalid JSON`, 3);
  });
  test('PatchError patch + invalid JSON doc -> doc error (apply is last)', () => {
    const patchFile = writeIn(dir, 'o-notarr.json', '{}');
    const docFile = badJson();
    expectError(run([patchFile, docFile]), `Error: ${docFile}: invalid JSON`, 3);
  });
  test('invalid patch file + invalid stdin doc -> patch error', () => {
    const patchFile = badJson();
    expectError(run([patchFile], { input: '{a:1}' }), `Error: ${patchFile}: invalid JSON`, 3);
  });
  test('patch [] from stdin + missing doc -> doc no such file', () => {
    const docFile = tmpPath('o-missing2.json');
    expectError(run(['-', docFile], { input: '[]' }), `Error: ${docFile}: no such file`, 1);
  });
});

describe('names as given', () => {
  test('relative name resolved against cwd', () => {
    expectError(run(['nope.json'], { cwd: dir }), 'Error: nope.json: no such file', 1);
  });
  test('path with ./ segment is echoed verbatim', () => {
    const patchFile = `${dir}/./nope.json`;
    expectError(run([patchFile]), `Error: ${patchFile}: no such file`, 1);
  });
  test('non-ASCII file name is echoed verbatim', () => {
    const patchFile = path.join(dir, 'ñ.json');
    expectError(run([patchFile]), `Error: ${patchFile}: no such file`, 1);
  });
  test('relative doc name', () => {
    writeIn(dir, 'rel-p.json', '[]');
    expectError(run(['rel-p.json', 'rel-d.json'], { cwd: dir }), 'Error: rel-d.json: no such file', 1);
  });
});
