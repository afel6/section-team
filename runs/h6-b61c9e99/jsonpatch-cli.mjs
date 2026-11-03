#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import { once } from 'node:events';
import { fstatSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const CHUNK = 65536;
const OUTPUT_CHUNK = 1 << 20;

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

const readFailure = (name, reason) => new CliError(`Error: ${name}: ${reason}`, 1);

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readFileInput(path) {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw readFailure(path, 'no such file');
    if (err.code === 'EISDIR' || (await isDirectory(path))) throw readFailure(path, 'is a directory');
    throw readFailure(path, 'cannot read');
  }
  try {
    if ((await handle.stat()).isDirectory()) throw readFailure(path, 'is a directory');
    const chunks = [];
    let total = 0;
    for (;;) {
      const buf = Buffer.alloc(CHUNK);
      const { bytesRead } = await handle.read(buf, 0, CHUNK, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_BYTES) throw readFailure(path, 'too large');
      chunks.push(buf.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err instanceof CliError) throw err;
    if (err.code === 'EISDIR') throw readFailure(path, 'is a directory');
    throw readFailure(path, 'cannot read');
  } finally {
    await handle.close().catch(() => {});
  }
}

// A stream on a directory ends silently with no data, so fd 0 is checked first.
function stdinIsReadable() {
  try {
    return !fstatSync(0).isDirectory();
  } catch {
    return false;
  }
}

function readStdin() {
  if (!stdinIsReadable()) return Promise.reject(readFailure('stdin', 'cannot read'));
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const chunks = [];
    let total = 0;
    const finish = (err) => {
      stdin.removeAllListeners('data');
      stdin.removeAllListeners('end');
      stdin.destroy();
      if (err) reject(err);
      else resolve(Buffer.concat(chunks));
    };
    stdin.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) finish(readFailure('stdin', 'too large'));
      else chunks.push(chunk);
    });
    stdin.on('end', () => finish(null));
    stdin.on('error', () => finish(readFailure('stdin', 'cannot read')));
  });
}

function jsonDepth(value) {
  let max = 0;
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [v, depth] = stack.pop();
    if (v === null || typeof v !== 'object') {
      max = Math.max(max, depth);
      continue;
    }
    max = Math.max(max, depth + 1);
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth + 1]);
  }
  return max;
}

// Yields JSON.stringify(value, null, 2) in chunks, iteratively: a patch can
// build a result far deeper and larger than the native one handles.
function* prettyChunks(value) {
  let out = '';
  const push = (text) => {
    out += text;
  };
  const newline = (depth) => `\n${'  '.repeat(depth)}`;
  // Each frame is a container being written and the index of its next entry.
  const frames = [];
  const writeValue = (v, depth) => {
    if (v === null || typeof v !== 'object') {
      push(JSON.stringify(v));
      return;
    }
    const isArr = Array.isArray(v);
    const keys = isArr ? null : Object.keys(v);
    const count = isArr ? v.length : keys.length;
    if (count === 0) {
      push(isArr ? '[]' : '{}');
      return;
    }
    push(isArr ? '[' : '{');
    frames.push({ v, isArr, keys, count, depth, next: 0 });
  };
  writeValue(value, 0);
  while (frames.length > 0) {
    if (out.length >= OUTPUT_CHUNK) {
      yield out;
      out = '';
    }
    const frame = frames[frames.length - 1];
    const { v, isArr, keys, count, depth } = frame;
    if (frame.next === count) {
      frames.pop();
      push(`${newline(depth)}${isArr ? ']' : '}'}`);
      continue;
    }
    const i = frame.next++;
    push(`${i > 0 ? ',' : ''}${newline(depth + 1)}`);
    if (isArr) {
      writeValue(v[i], depth + 1);
    } else {
      push(`${JSON.stringify(keys[i])}: `);
      writeValue(v[keys[i]], depth + 1);
    }
  }
  yield out;
}

const inputFailure = (name, reason) => new CliError(`Error: ${name}: ${reason}`, 3);

async function loadInput(arg) {
  const name = arg === '-' ? 'stdin' : arg;
  const bytes = arg === '-' ? await readStdin() : await readFileInput(arg);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw inputFailure(name, 'invalid UTF-8');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw inputFailure(name, 'invalid JSON');
  }
  if (jsonDepth(value) > MAX_DEPTH) throw inputFailure(name, 'too deep');
  return value;
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const [patchArg, docArg = '-'] = args;
  if (patchArg === '-' && docArg === '-') throw new CliError(USAGE, 2);
  const patch = await loadInput(patchArg);
  const doc = await loadInput(docArg);
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof PatchError) throw new CliError(`Error: ${err.message}`, 4);
    throw err;
  }
  for (const chunk of prettyChunks(result)) {
    if (!process.stdout.write(chunk)) await once(process.stdout, 'drain');
  }
  process.stdout.write('\n');
}

// A closed or failing stdout (for example a reader that quits early, EPIPE)
// ends the run with one line instead of an unhandled 'error' event.
process.stdout.on('error', () => {
  process.stderr.write('Error: stdout: cannot write\n');
  process.exit(1);
});

try {
  await main(process.argv.slice(2));
} catch (err) {
  // Anything unexpected still ends as one plain line rather than a stack trace.
  const cliErr = err instanceof CliError ? err : new CliError(`Error: ${err?.message ?? err}`, 1);
  process.stderr.write(`${cliErr.message}\n`);
  process.exitCode = cliErr.code;
}
