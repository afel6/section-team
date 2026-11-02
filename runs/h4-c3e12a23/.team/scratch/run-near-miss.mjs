// Swaps each .team/near-miss copy over its original, runs `npm test`, always restores.
// Usage: node .team/scratch/run-near-miss.mjs [n ...]   (no args = all copies)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const NM = path.join(ROOT, '.team', 'near-miss');
const TARGET = { 'server.mjs': 'server.mjs', 'app.js': 'public/app.js' };
// Test names that already fail on the real code (reported spec violations), one per line.
const KNOWN_FILE = path.join(ROOT, '.team', 'scratch', 'known-fail.txt');
const sha =(buf) => crypto.createHash('sha256').update(buf).digest('hex');

const wanted = new Set(process.argv.slice(2).map((n) => n.padStart(2, '0')));
const files = fs.readdirSync(NM).filter((f) => wanted.size === 0 || wanted.has(f.slice(0, 2))).sort();
const survivors = [];

for (const f of files) {
  const target = path.join(ROOT, TARGET[f.slice(3)]);
  const original = fs.readFileSync(target);
  const mutant = fs.readFileSync(path.join(NM, f));
  const bug = mutant.toString('utf8').split('\n')[0];
  let result;
  try {
    fs.writeFileSync(target, mutant);
    result = spawnSync('npm', ['test'], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  } finally {
    const now = fs.readFileSync(target);
    if (sha(now) !== sha(mutant)) process.stderr.write(`WARNING ${f}: target changed during the run\n`);
    fs.writeFileSync(target, original);
  }
  if (sha(fs.readFileSync(target)) !== sha(original)) throw new Error(`restore failed for ${target}`);
  const known = new Set(fs.existsSync(KNOWN_FILE) ? fs.readFileSync(KNOWN_FILE, 'utf8').split('\n').filter(Boolean) : []);
  const failing = [...result.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map((m) => m[1]);
  const fresh = failing.filter((name) => !known.has(name));
  const failed = `${fresh.length} [${fresh.slice(0, 3).join('; ')}]`;
  const caught = fresh.length > 0 || (result.status !== 0 && failing.length === 0);
  if (!caught) survivors.push(f);
  process.stdout.write(`${caught ? 'CAUGHT ' : 'SURVIVED'} ${f} fail=${failed} ${bug}\n`);
}
process.stdout.write(`survivors: ${survivors.length ? survivors.join(' ') : 'none'}\n`);
