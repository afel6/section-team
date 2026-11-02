// Rewrites invisible / unicode-whitespace characters in the given files as \uXXXX escapes.
import fs from 'node:fs';

const RE = /[  -‏　﻿�]/g;
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(RE, (c) => `\\u${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  fs.writeFileSync(file, out);
  process.stdout.write(`${file}: ${(src.match(RE) || []).length} escaped\n`);
}
