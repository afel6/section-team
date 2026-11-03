import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { CLI_PATH, expectOk, makeTmpDir, removeTmpDir, run, writeIn } from './helpers/cli-runner.mjs';

describe('CLI output formatting', () => {
  let dir;
  before(() => { dir = makeTmpDir(); });
  after(() => removeTmpDir(dir));

  test('output matches JSON.stringify(result, null, 2) for mixed values', () => {
    const doc = {
      s: 'a"\\\n é', n: [-0, 1.5, 1e21, -3], e: [], o: {}, z: null, t: true, f: false,
      '__proto__': { 'k"y': [[], [{}], [1, [2, { a: 'b' }]]] }, 10: 'ten', 2: 'two',
    };
    const p = writeIn(dir, 'mixed-p.json', '[]');
    const d = writeIn(dir, 'mixed-d.json', JSON.stringify(doc));
    const expected = JSON.stringify(JSON.parse(JSON.stringify(doc)), null, 2);
    expectOk(run([p, d]), `${expected}\n`);
  });

  test('scalar documents print like JSON.stringify', () => {
    const p = writeIn(dir, 'scalar-p.json', '[]');
    for (const text of ['"x"', '-0', '0.1', 'null', 'false', '[]', '{}']) {
      expectOk(run([p, '-'], { input: text }), `${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    }
  });

  test('a reader that closes stdout early gets one error line, not a stack trace', async () => {
    const p = writeIn(dir, 'pipe-p.json', '[]');
    const d = writeIn(dir, 'pipe-d.json', JSON.stringify(Array.from({ length: 100000 }, (_, i) => i)));
    const child = spawn(process.execPath, [CLI_PATH, p, d]);
    child.stdout.once('data', () => child.stdout.destroy());
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code] = await once(child, 'close');
    assert.equal(stderr, 'Error: stdout: cannot write\n');
    assert.equal(code, 1);
  });

  // Native JSON.stringify overflows its stack at roughly 5000 levels.
  test('a valid patch that builds a result about 7000 levels deep still prints', () => {
    const level = 998; // a value this deep inside patch -> op keeps the patch at 1000
    const chain = (n) => `${'{"a":'.repeat(n - 1)}{"x":0}${'}'.repeat(n - 1)}`;
    const leafPath = `${'/a'.repeat(level - 1)}/x`;
    const patch = [];
    let path = leafPath;
    for (let i = 0; i < 6; i++) {
      patch.push({ op: 'replace', path, value: JSON.parse(chain(level)) });
      path += leafPath;
    }
    const p = writeIn(dir, 'deep-p.json', JSON.stringify(patch));
    const d = writeIn(dir, 'deep-d.json', chain(level));
    const res = run([p, d]);
    assert.equal(res.stderr, '');
    assert.equal(res.status, 0);
    // 7 * level objects: one opening line each, the "x" line, one closing line each.
    const objects = 7 * level;
    const lines = res.stdout.split('\n');
    assert.equal(lines.length, 2 * objects + 2);
    assert.equal(lines[objects], `${'  '.repeat(objects)}"x": 0`);
    assert.equal(lines.at(-2), '}');
    assert.equal(lines.at(-1), '');
  });
});
