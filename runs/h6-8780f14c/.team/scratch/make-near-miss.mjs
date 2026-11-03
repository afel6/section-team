// Generates near-miss copies in .team/near-miss/ from the originals via exact one-spot replacements.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../..', import.meta.url).pathname;
const outDir = join(root, '.team/near-miss');
mkdirSync(outDir, { recursive: true });

const L = 'jsonpatch.mjs';
const C = 'jsonpatch-cli.mjs';
const MUTANTS = [
  [L, '~0 decoded before ~1', "token.replace(/~[01]/g, (m) => (m === '~0' ? '~' : '/'))", "token.replace(/~0/g, '~').replace(/~1/g, '/')"],
  [L, '<= instead of < on array length', 'Number(token) < container.length', 'Number(token) <= container.length'],
  [L, 'inherited properties counted', 'Object.hasOwn(container, token)', '(token in container)'],
  [L, '-0 lost in deep copy', 'let child = src[key];', 'let child = src[key] === 0 ? 0 : src[key];'],
  [L, "missing value checked via op.value === undefined", "!Object.hasOwn(op, 'value')", 'op.value === undefined'],
  [L, 'bad from checked before bad path',
    "  const path = Object.hasOwn(op, 'path') ? tryParsePointer(op.path) : null;\n  if (path === null) return { reason: 'bad path' };\n  let from = null;\n  if (name === 'move' || name === 'copy') {\n    from = Object.hasOwn(op, 'from') ? tryParsePointer(op.from) : null;\n    if (from === null) return { reason: 'bad from' };\n  }\n",
    "  let from = null;\n  if (name === 'move' || name === 'copy') {\n    from = Object.hasOwn(op, 'from') ? tryParsePointer(op.from) : null;\n    if (from === null) return { reason: 'bad from' };\n  }\n  const path = Object.hasOwn(op, 'path') ? tryParsePointer(op.path) : null;\n  if (path === null) return { reason: 'bad path' };\n"],
  [L, 'move with from == path done as remove + add', 'if (sameTokens(from, path)) {', 'if (false && sameTokens(from, path)) {'],
  [L, 'test equality is a one-way subset check', 'if (keys.length !== Object.keys(y).length) return false;', ''],
  [L, 'copy shares the source object', "return add(doc, path, deepCopy(follow(doc, from, 'from not found')));", "return add(doc, path, follow(doc, from, 'from not found'));"],
  [L, 'add rejects index == length', 'if (index > parent.length)', 'if (index >= parent.length)'],
  [L, 'move into own child includes from == path', 'prefix.length < tokens.length', 'prefix.length <= tokens.length'],
  [L, "'-' on array is a bad index", "if (token === '-') throw new OpFailure(notFound);", ''],
  [L, 'arrays accepted as operations', ' || Array.isArray(op)) return', ') return'],
  [L, 'add on existing member moves it last', 'setMember(parent, token, value);', 'delete parent[token];\n    setMember(parent, token, value);'],
  [L, 'leading zeros accepted as index', 'const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;', 'const INDEX_RE = /^[0-9]+$/;'],
  [L, 'non-string pointer gets SyntaxError', "if (typeof pointer !== 'string') throw new TypeError('pointer must be a string');", "if (typeof pointer !== 'string' && typeof pointer !== 'object') throw new TypeError('pointer must be a string');\n  pointer = String(pointer);"],
  [L, 'non-array patch index undefined', "throw new PatchError('patch must be an array', null);", "throw new PatchError('patch must be an array');"],
  [L, 'doc not copied when patch is empty', 'let result = deepCopy(doc);', 'let result = ops.length === 0 ? doc : deepCopy(doc);'],
  [C, 'BOM not stripped', "new TextDecoder('utf-8', { fatal: true })", "new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })"],
  [C, 'depth off by one', 'if (depth + 1 > max) return true;', 'if (depth > max) return true;'],
  [C, 'fstat size used for too large (reads then stop silently at the limit)',
    "if ((await handle.stat()).isDirectory()) throw new InputError('is a directory', 1);\n    const chunks = [];\n    let total = 0;\n    for (;;) {\n      const buffer = Buffer.alloc(CHUNK_SIZE);\n      const { bytesRead } = await handle.read(buffer, 0, CHUNK_SIZE, null);\n      if (bytesRead === 0) break;\n      total += bytesRead;\n      if (total > MAX_BYTES) throw new InputError('too large', 1);",
    "const st = await handle.stat();\n    if (st.isDirectory()) throw new InputError('is a directory', 1);\n    if (st.size > MAX_BYTES) throw new InputError('too large', 1);\n    const chunks = [];\n    let total = 0;\n    for (;;) {\n      const buffer = Buffer.alloc(CHUNK_SIZE);\n      const { bytesRead } = await handle.read(buffer, 0, CHUNK_SIZE, null);\n      if (bytesRead === 0) break;\n      total += bytesRead;\n      if (total > MAX_BYTES) break;"],
  [C, 'too large uses >= instead of >', 'if (total > MAX_BYTES) throw', 'if (total >= MAX_BYTES) throw'],
  [C, 'stdin size not limited', 'if (total > MAX_BYTES) {', 'if (false) {'],
  [C, 'stdin reported as -', "arg === '-' ? 'stdin' : arg", 'arg'],
  [C, 'both inputs read before patch is decoded',
    "  const bytes = arg === '-' ? await readStdin() : await readPath(arg);\n",
    "  const bytes = arg;\n"],
  [C, 'ENOTDIR reported as cannot read', "err.code === 'ENOENT' || err.code === 'ENOTDIR'", "err.code === 'ENOENT'"],
  [C, 'usage allows both stdin', "if (patchArg === '-' && docArg === '-') return fail(USAGE, 2);", ''],
  [C, 'stringifyDeep drops the comma between entries', "parts.push(`${i > 0 ? ',' : ''}\\n${inner}${label}`);", 'parts.push(`\\n${inner}${label}`);'],
  [C, 'stringifyDeep closes at the inner indent', 'parts.push(`\\n${indent}${closeMark}`);', 'parts.push(`\\n${inner}${closeMark}`);'],
  [C, 'stringifyDeep writes member names unescaped', '`${JSON.stringify(keys[i])}: `', '`"${keys[i]}": `'],
  [C, 'EPIPE reported as a write error', "if (err.code !== 'EPIPE') fail('Error: cannot write output', 1);", "fail('Error: cannot write output', 1);"],
  [C, 'no stdout error handler (EPIPE crashes with a stack trace)', "process.stdout.on('error',", "process.stdout.on('unused-event',"],
  [C, 'output without trailing newline', 'process.stdout.write(`${stringify(result)}\\n`);', 'process.stdout.write(stringify(result));'],
];

// Mutant 25 needs both reads up front; patch main() too.
const EXTRA = {
  'both inputs read before patch is decoded': [
    '  const inputs = [];\n  for (const arg of [patchArg, docArg]) {',
    "  const raw = [];\n  for (const arg of [patchArg, docArg]) {\n    try {\n      raw.push(arg === '-' ? await readStdin() : await readPath(arg));\n    } catch (err) {\n      return fail(`Error: ${arg === '-' ? 'stdin' : arg}: ${err.message}`, err.exitCode);\n    }\n  }\n  const inputs = [];\n  for (const [i, arg] of [patchArg, docArg].entries()) {",
  ],
};

function replaceOnce(src, from, to, label) {
  const at = src.indexOf(from);
  if (at < 0 || src.indexOf(from, at + 1) >= 0) throw new Error(`target not unique: ${label}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

MUTANTS.forEach(([file, bug, from, to], i) => {
  let src = readFileSync(join(root, file), 'utf8');
  src = replaceOnce(src, from, to, bug);
  if (EXTRA[bug]) {
    src = replaceOnce(src, EXTRA[bug][0], EXTRA[bug][1], bug);
    src = replaceOnce(src, 'inputs.push(await load(arg));', 'inputs.push(await load(arg, raw[i]));', bug);
    src = replaceOnce(src, 'async function load(arg) {', 'async function load(name, arg) {', bug);
  }
  // The CLI's shebang line is replaced by the comment (a shebang is only legal on line 1).
  const body = file === C ? src.slice(src.indexOf('\n') + 1) : src;
  writeFileSync(join(outDir, `${i + 1}-${file}`), `// near-miss: ${bug}\n${body}`);
});
