// Runs the suite once per near-miss copy inside a mirror directory, so the originals are never touched.
// Usage: node .team/scratch/run-near-miss.mjs [filter]
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const nmDir = join(root, '.team/near-miss');
const filter = process.argv[2];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const before = ['jsonpatch.mjs', 'jsonpatch-cli.mjs'].map((f) => sha(join(root, f)));

const copies = readdirSync(nmDir)
  .filter((n) => !filter || n.includes(filter))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
const lines = [];
for (const name of copies) {
  const target = name.slice(name.indexOf('-') + 1);
  const mirror = join(root, '.team/scratch/mirror');
  rmSync(mirror, { recursive: true, force: true });
  mkdirSync(mirror, { recursive: true });
  for (const f of ['jsonpatch.mjs', 'jsonpatch-cli.mjs', 'package.json', 'test']) {
    cpSync(join(root, f), join(mirror, f), { recursive: true });
  }
  writeFileSync(join(mirror, target), readFileSync(join(nmDir, name)));
  const tests = readdirSync(join(mirror, 'test')).filter((n) => n.endsWith('.test.mjs')).map((n) => join('test', n));
  const res = spawnSync(process.execPath, ['--test', '--test-timeout=60000', ...tests], {
    cwd: mirror, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 900000,
  });
  const fail = Number((res.stdout.match(/^# fail (\d+)/m) ?? [])[1] ?? -1);
  const failed = [...res.stdout.matchAll(/^\s*not ok \d+ - (.*)$/gm)].map((m) => m[1]).slice(0, 4);
  lines.push(`${fail > 0 ? 'KILLED  ' : 'SURVIVED'} ${name} fail=${fail} ${fail > 0 ? '' : res.stdout.slice(-300)} :: ${failed.join(' | ')}`);
  process.stdout.write(`${lines.at(-1)}\n`);
}
rmSync(join(root, '.team/scratch/mirror'), { recursive: true, force: true });
const after = ['jsonpatch.mjs', 'jsonpatch-cli.mjs'].map((f) => sha(join(root, f)));
process.stdout.write(`originals unchanged: ${before.join() === after.join()} ${after.join(' ')}\n`);
