#!/usr/bin/env node
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]
import fs from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;

class CliError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function readFile(path, name) {
  let fd;
  try {
    fd = fs.openSync(path, 'r');
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw new CliError(`Error: ${name}: no such file`, 1);
    let isDir = false;
    try {
      isDir = fs.statSync(path).isDirectory();
    } catch {}
    if (isDir) throw new CliError(`Error: ${name}: is a directory`, 1);
    throw new CliError(`Error: ${name}: cannot read`, 1);
  }
  try {
    let isDir = false;
    try {
      isDir = fs.fstatSync(fd).isDirectory();
    } catch {}
    if (isDir) throw new CliError(`Error: ${name}: is a directory`, 1);
    const chunks = [];
    let total = 0;
    const buf = Buffer.alloc(65536);
    for (;;) {
      let n;
      try {
        n = fs.readSync(fd, buf, 0, buf.length, null);
      } catch (e) {
        if (e.code === 'EISDIR') throw new CliError(`Error: ${name}: is a directory`, 1);
        throw new CliError(`Error: ${name}: cannot read`, 1);
      }
      if (n === 0) break;
      total += n;
      if (total > MAX_BYTES) throw new CliError(`Error: ${name}: too large`, 1);
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks, total);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}

async function readStdin(name) {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of process.stdin) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        process.stdin.destroy();
        throw new CliError(`Error: ${name}: too large`, 1);
      }
      chunks.push(chunk);
    }
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError(`Error: ${name}: cannot read`, 1);
  }
  return Buffer.concat(chunks, total);
}

function depthOf(value) {
  let max = 0;
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [v, d] = stack.pop();
    if (typeof v !== 'object' || v === null) continue;
    const depth = d + 1;
    if (depth > max) max = depth;
    if (max > MAX_DEPTH) return max;
    for (const child of Array.isArray(v) ? v : Object.values(v)) {
      if (typeof child === 'object' && child !== null) stack.push([child, depth]);
    }
  }
  return max;
}

async function load(arg) {
  const name = arg === '-' ? 'stdin' : arg;
  const bytes = arg === '-' ? await readStdin(name) : readFile(arg, name);
  let text;
  try {
    // The decoder drops a byte order mark at the very start.
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new CliError(`Error: ${name}: invalid UTF-8`, 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CliError(`Error: ${name}: invalid JSON`, 3);
  }
  if (depthOf(value) > MAX_DEPTH) throw new CliError(`Error: ${name}: too deep`, 3);
  return value;
}

// Same output as JSON.stringify(value, null, 2), without recursion.
function stringify(value) {
  const out = [];
  const stack = [{ v: value, indent: '' }];
  while (stack.length > 0) {
    const item = stack.pop();
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    const { v, indent } = item;
    if (typeof v !== 'object' || v === null) {
      out.push(JSON.stringify(v));
      continue;
    }
    const inner = indent + '  ';
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push('[]');
        continue;
      }
      stack.push('\n' + indent + ']');
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({ v: v[i], indent: inner });
        stack.push((i === 0 ? '[\n' : ',\n') + inner);
      }
    } else {
      const keys = Object.keys(v);
      if (keys.length === 0) {
        out.push('{}');
        continue;
      }
      stack.push('\n' + indent + '}');
      for (let i = keys.length - 1; i >= 0; i--) {
        stack.push({ v: v[keys[i]], indent: inner });
        stack.push((i === 0 ? '{\n' : ',\n') + inner + JSON.stringify(keys[i]) + ': ');
      }
    }
  }
  return out.join('');
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const patchArg = args[0];
  const docArg = args.length === 2 ? args[1] : '-';
  if (patchArg === '-' && docArg === '-') throw new CliError(USAGE, 2);
  const patch = await load(patchArg);
  const doc = await load(docArg);
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (e) {
    if (e instanceof PatchError) throw new CliError(`Error: ${e.message}`, 4);
    throw e;
  }
  return stringify(result) + '\n';
}

try {
  const output = await main(process.argv.slice(2));
  process.stdout.write(output);
  process.exitCode = 0;
} catch (e) {
  if (!(e instanceof CliError)) throw e;
  process.stderr.write(e.message + '\n');
  process.exitCode = e.code;
}
