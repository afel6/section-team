#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import { fstatSync } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const STDIN = '-';

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function readError(name, reason) {
  return new CliError(`Error: ${name}: ${reason}`, 1);
}

function dataError(name, reason) {
  return new CliError(`Error: ${name}: ${reason}`, 3);
}

// Collects chunks from an async iterable, stopping once the byte limit is passed.
async function collect(chunks, name) {
  const parts = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.length;
    if (total > MAX_BYTES) throw readError(name, 'too large');
    parts.push(chunk);
  }
  return Buffer.concat(parts, total);
}

async function* fileChunks(handle) {
  const buffer = Buffer.alloc(65536);
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    if (bytesRead === 0) return;
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
}

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readFile(path) {
  let handle;
  try {
    handle = await open(path, 'r');
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw readError(path, 'no such file');
    if (err.code === 'EISDIR' || (await isDirectory(path))) throw readError(path, 'is a directory');
    throw readError(path, 'cannot read');
  }
  try {
    if ((await handle.stat()).isDirectory()) throw readError(path, 'is a directory');
    return await collect(fileChunks(handle), path);
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw readError(path, err.code === 'EISDIR' ? 'is a directory' : 'cannot read');
  } finally {
    // The data is already read; a failed close of a read-only handle changes nothing.
    await handle.close().catch(() => {});
  }
}

async function readStdin() {
  try {
    // A directory stream ends without data or error, so reject it up front.
    if (fstatSync(0).isDirectory()) throw readError('stdin', 'cannot read');
    return await collect(process.stdin, 'stdin');
  } catch (err) {
    if (err instanceof CliError) throw err;
    throw readError('stdin', 'cannot read');
  } finally {
    process.stdin.destroy();
  }
}

function depthExceeds(value, limit) {
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [current, depth] = stack.pop();
    if (current === null || typeof current !== 'object') continue;
    if (depth + 1 > limit) return true;
    for (const item of Object.values(current)) stack.push([item, depth + 1]);
  }
  return false;
}

async function loadJson(arg) {
  const name = arg === STDIN ? 'stdin' : arg;
  const bytes = arg === STDIN ? await readStdin() : await readFile(arg);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw dataError(name, 'invalid UTF-8');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw dataError(name, 'invalid JSON');
  }
  if (depthExceeds(value, MAX_DEPTH)) throw dataError(name, 'too deep');
  return value;
}

// Same text as JSON.stringify(value, null, 2) for JSON values, built without recursion so
// that results made deep by a patch (repeated `copy`) cannot overflow the call stack.
function stringify(value) {
  const parts = [];
  const stack = [{ value, indent: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === 'string') {
      parts.push(item);
      continue;
    }
    const { value: current, indent } = item;
    const keys = current !== null && typeof current === 'object' ? Object.keys(current) : null;
    if (keys === null) {
      parts.push(JSON.stringify(current));
      continue;
    }
    const isArray = Array.isArray(current);
    if (keys.length === 0) {
      parts.push(isArray ? '[]' : '{}');
      continue;
    }
    const inner = `${indent}  `;
    parts.push(isArray ? '[' : '{');
    stack.push(`\n${indent}${isArray ? ']' : '}'}`);
    for (let i = keys.length - 1; i >= 0; i--) {
      stack.push({ value: current[keys[i]], indent: inner });
      const label = isArray ? '' : `${JSON.stringify(keys[i])}: `;
      stack.push(`${i === 0 ? '' : ','}\n${inner}${label}`);
    }
  }
  return parts.join('');
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const [patchArg, docArg = STDIN] = args;
  if (patchArg === STDIN && docArg === STDIN) throw new CliError(USAGE, 2);
  const patch = await loadJson(patchArg);
  const doc = await loadJson(docArg);
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof PatchError) throw new CliError(`Error: ${err.message}`, 4);
    throw err;
  }
  process.stdout.write(`${stringify(result)}\n`);
}

// A reader that closes the pipe early (EPIPE) ends the run quietly; other write errors get one line.
process.stdout.on('error', (err) => {
  if (err.code !== 'EPIPE') process.stderr.write('Error: cannot write output\n');
  process.exit(1);
});

main(process.argv.slice(2)).catch((err) => {
  process.stderr.write(err instanceof CliError ? `${err.message}\n` : 'Error: unexpected failure\n');
  process.exitCode = err instanceof CliError ? err.exitCode : 1;
});
