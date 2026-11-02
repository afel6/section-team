// jsonpatch-cli.mjs: apply a JSON Patch to a JSON document.
// Usage: node jsonpatch-cli.mjs <patch> [<doc>]   (a missing <doc>, or "-", means standard input)
import { closeSync, fstatSync, openSync, readSync, statSync } from 'node:fs';
import { applyPatch, PatchError } from './jsonpatch.mjs';

const USAGE = 'Usage: node jsonpatch-cli.mjs <patch> [<doc>]';
const STDIN = '-';
const MAX_BYTES = 1048576;
const MAX_DEPTH = 1000;
const CHUNK_BYTES = 65536;

class InputError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Open failures: a missing entry is "no such file"; a directory we may not open is still "is a directory".
function openReason(err, path) {
  if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') return 'no such file';
  if (err?.code === 'EISDIR' || isDirectory(path)) return 'is a directory';
  return 'cannot read';
}

// Reads until end of file or until more than MAX_BYTES were read; never trusts the reported size.
function readOpenFile(fd) {
  if (fstatSync(fd).isDirectory()) return { reason: 'is a directory' };
  const chunks = [];
  let total = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    const count = readSync(fd, chunk, 0, CHUNK_BYTES, null);
    if (count === 0) return { bytes: Buffer.concat(chunks, total) };
    total += count;
    if (total > MAX_BYTES) return { reason: 'too large' };
    chunks.push(chunk.subarray(0, count));
  }
}

function readFile(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
  } catch (err) {
    return { reason: openReason(err, path) };
  }
  try {
    return readOpenFile(fd);
  } catch (err) {
    return { reason: err?.code === 'EISDIR' ? 'is a directory' : 'cannot read' };
  } finally {
    try { closeSync(fd); } catch { /* the bytes are already read; a close failure changes nothing */ }
  }
}

async function readStdin() {
  const chunks = [];
  let total = 0;
  try {
    for await (const chunk of process.stdin) {
      total += chunk.length;
      if (total > MAX_BYTES) return { reason: 'too large' }; // leaving the loop destroys the stream
      chunks.push(chunk);
    }
  } catch {
    return { reason: 'cannot read' };
  }
  return { bytes: Buffer.concat(chunks, total) };
}

// Depth as the task defines it: a primitive is 0, a container is one more than its deepest child.
function tooDeep(root) {
  const stack = [[root, 0]];
  while (stack.length > 0) {
    const [value, outer] = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (outer + 1 >= MAX_DEPTH) return true;
    for (const child of Object.values(value)) stack.push([child, outer + 1]);
  }
  return false;
}

// Read, decode, parse, check depth: the first failing step is the error.
async function loadInput(arg) {
  const name = arg === STDIN ? 'stdin' : arg;
  const read = arg === STDIN ? await readStdin() : readFile(arg);
  if (read.reason !== undefined) throw new InputError(`Error: ${name}: ${read.reason}`, 1);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(read.bytes); // drops one leading BOM
  } catch {
    throw new InputError(`Error: ${name}: invalid UTF-8`, 3);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new InputError(`Error: ${name}: invalid JSON`, 3);
  }
  if (tooDeep(value)) throw new InputError(`Error: ${name}: too deep`, 3);
  return value;
}

async function run(args) {
  const [patchArg, docArg = STDIN] = args;
  if (args.length < 1 || args.length > 2 || (patchArg === STDIN && docArg === STDIN)) {
    throw new InputError(USAGE, 2);
  }
  const patch = await loadInput(patchArg);
  const doc = await loadInput(docArg);
  try {
    return applyPatch(doc, patch);
  } catch (err) {
    if (err instanceof PatchError) throw new InputError(`Error: ${err.message}`, 4);
    throw err;
  }
}

async function main(args) {
  try {
    const result = await run(args);
    // A reader that closed the pipe early (`| head`) is not an error; any other write failure is one plain line.
    process.stdout.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        process.stderr.write('Error: cannot write output\n');
        process.exitCode = 1;
      }
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = 0;
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    process.stderr.write(`${err.message}\n`);
    process.exitCode = err.exitCode;
  }
}

await main(process.argv.slice(2));
