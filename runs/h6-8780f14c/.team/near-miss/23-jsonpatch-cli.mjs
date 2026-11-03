// near-miss: stdin size not limited
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import { open, stat } from 'node:fs/promises';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const CHUNK_SIZE = 65536;

class InputError extends Error {
  constructor(reason, exitCode) {
    super(reason);
    this.exitCode = exitCode;
  }
}

const isJsonContainer = (v) => v !== null && typeof v === 'object';

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readPath(path) {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new InputError('no such file', 1);
    if (await isDirectory(path)) throw new InputError('is a directory', 1);
    throw new InputError('cannot read', 1);
  }
  try {
    if ((await handle.stat()).isDirectory()) throw new InputError('is a directory', 1);
    const chunks = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.alloc(CHUNK_SIZE);
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_SIZE, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_BYTES) throw new InputError('too large', 1);
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof InputError) throw err;
    if (err.code === 'EISDIR') throw new InputError('is a directory', 1);
    throw new InputError('cannot read', 1);
  } finally {
    await handle.close().catch(() => {});
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const input = process.stdin;
    input.on('data', (chunk) => {
      total += chunk.length;
      if (false) {
        input.destroy();
        reject(new InputError('too large', 1));
      } else {
        chunks.push(chunk);
      }
    });
    input.on('end', () => resolve(Buffer.concat(chunks)));
    input.on('error', () => reject(new InputError('cannot read', 1)));
  });
}

function exceedsDepth(value, max) {
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop();
    if (!isJsonContainer(current)) continue;
    if (depth + 1 > max) return true;
    for (const child of Object.values(current)) stack.push([child, depth + 1]);
  }
  return false;
}

async function load(arg) {
  const bytes = arg === '-' ? await readStdin() : await readPath(arg);
  let text;
  try {
    // The default decoder drops one leading byte order mark.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new InputError('invalid UTF-8', 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError('invalid JSON', 3);
  }
  if (exceedsDepth(value, MAX_DEPTH)) throw new InputError('too deep', 3);
  return value;
}

// Same output as JSON.stringify(value, null, 2), without recursion, for results too deep for it.
function stringifyDeep(value) {
  const out = [];
  const stack = [{ value, indent: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    const { value: current, indent } = item;
    if (!isJsonContainer(current)) {
      out.push(JSON.stringify(current));
      continue;
    }
    const keys = Array.isArray(current) ? null : Object.keys(current);
    const [openMark, closeMark] = keys ? ['{', '}'] : ['[', ']'];
    const count = keys ? keys.length : current.length;
    if (count === 0) {
      out.push(openMark + closeMark);
      continue;
    }
    const inner = `${indent}  `;
    const parts = [openMark];
    for (let i = 0; i < count; i++) {
      const label = keys ? `${JSON.stringify(keys[i])}: ` : '';
      parts.push(`${i > 0 ? ',' : ''}\n${inner}${label}`);
      parts.push({ value: current[keys ? keys[i] : i], indent: inner });
    }
    parts.push(`\n${indent}${closeMark}`);
    for (let i = parts.length - 1; i >= 0; i--) stack.push(parts[i]);
  }
  return out.join('');
}

function stringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    if (err instanceof RangeError) return stringifyDeep(value);
    throw err;
  }
}

function fail(message, exitCode) {
  process.stderr.write(`${message}\n`);
  process.exitCode = exitCode;
}

async function main(args) {
  if (args.length < 1 || args.length > 2) return fail(USAGE, 2);
  const [patchArg, docArg = '-'] = args;
  if (patchArg === '-' && docArg === '-') return fail(USAGE, 2);

  const inputs = [];
  for (const arg of [patchArg, docArg]) {
    try {
      inputs.push(await load(arg));
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      return fail(`Error: ${arg === '-' ? 'stdin' : arg}: ${err.message}`, err.exitCode);
    }
  }

  const [patch, doc] = inputs;
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (err) {
    if (!(err instanceof PatchError)) throw err;
    return fail(`Error: ${err.message}`, 4);
  }
  process.stdout.write(`${stringify(result)}\n`);
}

// A reader that closes early (EPIPE) wants no more output; any other write failure is reported.
process.stdout.on('error', (err) => {
  if (err.code !== 'EPIPE') fail('Error: cannot write output', 1);
});

try {
  await main(process.argv.slice(2));
} catch {
  fail('Error: unexpected failure', 1);
}
