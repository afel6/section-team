# jsonpatch

A dependency-free JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) library and command-line tool for Node.js.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~01'); // ['a/b', '~1']

const doc = { a: [1, 2] };
const result = applyPatch(doc, [
  { op: 'add', path: '/a/-', value: 3 },
  { op: 'test', path: '/a/2', value: 3 },
]);
// result: { a: [1, 2, 3] } — `doc` is left unchanged

try {
  applyPatch(doc, [{ op: 'remove', path: '/x' }]);
} catch (err) {
  err instanceof PatchError; // true
  err.message; // 'operation 0: path not found'
  err.index; // 0
}
```

- `parsePointer(pointer)` returns the decoded tokens. Throws `TypeError('pointer must be a string')` for non-strings and `SyntaxError('invalid pointer')` for invalid pointers.
- `applyPatch(doc, patch)` returns a new document; neither `doc` nor `patch` is modified and the result shares no objects with them. All operations are validated before any is applied. On failure it throws a `PatchError` with message `operation <i>: <reason>` and `index` `<i>` (or `patch must be an array` with `index` null).

Reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`, `cannot remove root`, `cannot move into own child`, `path not found`, `from not found`, `bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>` (standard input when `<doc>` is omitted or either argument is `-`), and prints the patched document as JSON indented by 2 spaces.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json
```

Exit codes:

| Code | Meaning |
| ---- | ------- |
| 0 | success |
| 2 | usage error (wrong argument count, or both inputs on stdin) |
| 1 | read error: `no such file`, `is a directory`, `too large` (over 1 MiB), `cannot read` |
| 3 | `invalid UTF-8`, `invalid JSON`, `too deep` (nesting over 1000 levels) |
| 4 | the patch failed to apply (`Error: operation <i>: <reason>`) |

Errors are printed as a single line on stderr, e.g. `Error: doc.json: invalid JSON`.

## Tests

```sh
npm test
```
