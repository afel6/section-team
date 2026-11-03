// Lists running `node .../server.mjs` processes with their cwd and age (testing section tool).
import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';

const rows = [];
for (const pid of readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').trim();
    if (!/^node .*server\.mjs$/.test(cmd) && !/\/node .*server\.mjs$/.test(cmd)) continue;
    const env = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter((l) => /^(PORT|DATA_FILE)=/.test(l));
    const ageS = Math.round((Date.now() - statSync(`/proc/${pid}`).mtimeMs) / 1000);
    rows.push({ pid, cmd, cwd: readlinkSync(`/proc/${pid}/cwd`), env, ageS });
  } catch {
    // process vanished or is not ours to read
  }
}
process.stdout.write(`${JSON.stringify(rows, null, 1)}\n`);
