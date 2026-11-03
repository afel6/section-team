// Runs the test suite once per near-miss copy (testing section tool).
// Works on a scratch copy of the project in the OS temp folder, so the real originals are never
// touched (another section may edit them meanwhile). Inside the scratch copy each near-miss is
// swapped into place, the suite runs, and the original is restored, also when the run fails.
// Usage: node .team/tools/near-miss-run.mjs [<n> ...]   -> prints one line per near-miss.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const NEAR = path.join(ROOT, '.team/near-miss');
const TARGETS = { 'server.mjs': 'server.mjs', 'app.js': 'public/app.js', 'index.html': 'public/index.html' };

function targetOf(file) {
  const base = file.replace(/^\d+-/, '');
  if (!Object.hasOwn(TARGETS, base)) throw new Error(`unknown near-miss target: ${file}`);
  return TARGETS[base];
}

function runSuite(dir) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', 'test/**/*.test.mjs'], {
    cwd: dir, env, encoding: 'utf8', timeout: 240000, maxBuffer: 64 * 1024 * 1024,
  });
  const failed = [...r.stdout.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  return { code: r.status, failed };
}

const scratch = mkdtempSync(path.join(os.tmpdir(), 'near-miss-'));
try {
  for (const part of ['server.mjs', 'package.json', 'public', 'test']) {
    cpSync(path.join(ROOT, part), path.join(scratch, part), { recursive: true });
  }
  const only = new Set(process.argv.slice(2));
  const files = readdirSync(NEAR)
    .filter((f) => only.size === 0 || only.has(f.split('-')[0]))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  for (const file of files) {
    const target = path.join(scratch, targetOf(file));
    const original = readFileSync(target);
    const bug = readFileSync(path.join(NEAR, file), 'utf8').split('\n', 1)[0];
    writeFileSync(target, readFileSync(path.join(NEAR, file)));
    let result;
    try {
      result = runSuite(scratch);
    } finally {
      writeFileSync(target, original);
    }
    const verdict = result.code === 0 ? 'SURVIVED' : 'killed';
    process.stdout.write(`${verdict} ${file} ${bug} | ${result.failed.slice(0, 4).join(' ; ')}\n`);
  }
  const clean = runSuite(scratch);
  process.stdout.write(`originals in scratch: exit ${clean.code}\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
