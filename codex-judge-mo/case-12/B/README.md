# jsonpatch

A dependency-free JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) library and command-line tool for Node.js.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~0c'); // ['a/b', '~c']

const doc = { a: [1, 2] };
const result = applyPatch(doc, [
  { op: 'add', path: '/a/-', value: 3 },
  { op: 'test', path: '/a/2', value: 3 },
]);
// result: { a: [1, 2, 3] }; doc is unchanged
```

- `parsePointer(pointer)` returns the decoded tokens. It throws `TypeError('pointer must be a string')` for a non-string and `SyntaxError('invalid pointer')` for a malformed pointer.
- `applyPatch(doc, patch)` returns a new document. It never changes `doc` or `patch`, and the result shares no object or array with them. Numbers (including `-0`) and member order are kept.
- On failure it throws a `PatchError` with a `message` such as `operation 2: test failed` and an `index` (the 0-based operation position, or `null` when the patch is not an array).

All operations are checked for form first (`not an object`, `bad op`, `bad path`, `bad from`, `missing value`, `cannot remove root`, `cannot move into own child`), then applied in order (`path not found`, `from not found`, `bad index`, `test failed`).

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>`. A missing `<doc>`, or an argument of `-`, means standard input (only one input may be standard input). The result is printed as JSON with 2-space indentation.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json
```

Inputs are read as UTF-8 (a leading byte order mark is ignored) and may be at most 1048576 bytes and 1000 levels deep.

| Exit | Meaning | stderr |
| ---- | ------- | ------ |
| 0 | success | (nothing) |
| 1 | read error | `Error: <name>: no such file` / `is a directory` / `too large` / `cannot read` |
| 2 | wrong arguments | `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` |
| 3 | bad input | `Error: <name>: invalid UTF-8` / `invalid JSON` / `too deep` |
| 4 | patch failed | `Error: operation <i>: <reason>` |

`<name>` is the argument as given, or `stdin` for standard input.

## Tests

```sh
npm test
```
