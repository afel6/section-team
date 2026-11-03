# jsonpatch

A dependency-free JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)) and
JSON Patch ([RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)) library and command-line tool
for Node.js (ES modules, built-ins only).

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
  applyPatch({}, [{ op: 'remove', path: '/x' }]);
} catch (err) {
  err instanceof PatchError; // true
  err.message; // 'operation 0: path not found'
  err.index; // 0
}
```

- `parsePointer(pointer)` returns the decoded reference tokens. It throws a `TypeError`
  (`pointer must be a string`) for a non-string and a `SyntaxError` (`invalid pointer`) for a
  malformed pointer.
- `applyPatch(doc, patch)` returns a new document and never changes `doc` or `patch`. The result
  shares no object or array with either, keeps member order and keeps `-0`.
- Every failure is a `PatchError` with an `index`: `null` with the message
  `patch must be an array`, otherwise the index of the failing operation and the message
  `operation <i>: <reason>`.

Reasons found while checking the form of each operation (all operations are checked before any
is applied): `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`.

Reasons found while applying: `path not found`, `from not found`, `bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from the file `<patch>` and the document from the file `<doc>`. A missing
`<doc>`, or an argument of `-`, means standard input (only one input may be standard input).
Inputs are UTF-8 (a leading byte order mark is ignored), at most 1 MiB, and at most 1000 levels
deep. The result is printed as `JSON.stringify(result, null, 2)` followed by a newline.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json > result.json
```

| Exit | Meaning | stderr |
| ---- | ------- | ------ |
| 0 | success | nothing |
| 1 | read error | `Error: <name>: no such file` / `is a directory` / `too large` / `cannot read` |
| 2 | wrong arguments | `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` |
| 3 | bad input | `Error: <name>: invalid UTF-8` / `invalid JSON` / `too deep` |
| 4 | patch failed | `Error: <PatchError message>` |

`<name>` is the argument as given, or `stdin`. The patch input is fully read and checked before
the document input is read.

## Tests

```sh
npm test
```
