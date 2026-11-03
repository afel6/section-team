#!/usr/bin/env node
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
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
      throw new CliError(`Error: ${name}: no such file`, 1);
    }
    let isDir = false;
    try {
      isDir = fs.statSync(path).isDirectory();
    } catch {
      // fall through to "cannot read"
    }
    if (isDir) throw new CliError(`Error: ${name}: is a directory`, 1);
    throw new CliError(`Error: ${name}: cannot read`, 1);
  }
  try {
    let isDir = false;
    try {
      isDir = fs.fstatSync(fd).isDirectory();
    } catch {
      // let the read below decide
    }
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
        if (e.code === 'EAGAIN') continue;
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
    } catch {
      // ignore
    }
  }
}

function readStdin(name) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const stdin = process.stdin;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      stdin.removeAllListeners('data');
      stdin.removeAllListeners('end');
      stdin.on('error', () => {});
      if (err) {
        stdin.destroy();
        reject(err);
      } else {
        resolve(value);
      }
    };
    stdin.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES) {
        finish(new CliError(`Error: ${name}: too large`, 1));
        return;
      }
      chunks.push(chunk);
    });
    stdin.on('end', () => finish(null, Buffer.concat(chunks, total)));
    stdin.on('error', () => finish(new CliError(`Error: ${name}: cannot read`, 1)));
  });
}

function maxDepthExceeds(value, limit) {
  const stack = [[value, 0]];
  while (stack.length > 0) {
    const [v, d] = stack.pop();
    if (typeof v !== 'object' || v === null) continue;
    const depth = d + 1;
    if (depth > limit) return true;
    const children = Array.isArray(v) ? v : Object.values(v);
    for (const c of children) {
      if (typeof c === 'object' && c !== null) stack.push([c, depth]);
    }
  }
  return false;
}

async function loadInput(arg) {
  const isStdin = arg === '-';
  const name = isStdin ? 'stdin' : arg;
  const bytes = isStdin ? await readStdin(name) : readFile(arg, name);
  let text;
  try {
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
  if (maxDepthExceeds(value, MAX_DEPTH)) throw new CliError(`Error: ${name}: too deep`, 3);
  return value;
}

function exit(stream, text, code) {
  stream.write(text, () => process.exit(code));
}

async function main(args) {
  if (args.length < 1 || args.length > 2) throw new CliError(USAGE, 2);
  const patchArg = args[0];
  const docArg = args.length === 2 ? args[1] : '-';
  if (patchArg === '-' && docArg === '-') throw new CliError(USAGE, 2);
  const patch = await loadInput(patchArg);
  const doc = await loadInput(docArg);
  let result;
  try {
    result = applyPatch(doc, patch);
  } catch (e) {
    if (e instanceof PatchError) throw new CliError(`Error: ${e.message}`, 4);
    throw e;
  }
  return JSON.stringify(result, null, 2) + '\n';
}

main(process.argv.slice(2)).then(
  (out) => exit(process.stdout, out, 0),
  (e) => {
    if (e instanceof CliError) exit(process.stderr, e.message + '\n', e.code);
    else exit(process.stderr, `Error: ${e && e.message ? e.message : String(e)}\n`, 1);
  },
);
