# jsonpatch

A dependency-free JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)) and
JSON Patch ([RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)) library and command-line tool.
Requires Node.js 21 or later.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a/~01/');   // ['a', '~1', '']

const doc = { a: [1, 2] };
const result = applyPatch(doc, [
  { op: 'add', path: '/a/-', value: 3 },
  { op: 'test', path: '/a/2', value: 3 },
]);
// result: { a: [1, 2, 3] }; doc is unchanged

try {
  applyPatch(doc, [{ op: 'remove', path: '/missing' }]);
} catch (err) {
  err instanceof PatchError; // true
  err.message;               // 'operation 0: path not found'
  err.index;                 // 0
}
```

- `parsePointer(pointer)` returns the decoded reference tokens. It throws a `TypeError`
  (`pointer must be a string`) for a non-string and a `SyntaxError` (`invalid pointer`) for a
  malformed pointer.
- `applyPatch(doc, patch)` returns a new document. It never changes `doc` or `patch`, and the
  result shares no objects or arrays with them. Every operation is checked before any is
  applied; the patch is all-or-nothing.
- Errors are `PatchError`s with `message` `operation <i>: <reason>` and `index` `<i>`, or
  `patch must be an array` with `index` `null`.

Reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`, `path not found`, `from not found`,
`bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>`. A missing `<doc>`, or an
argument of `-`, means standard input (only one input may be standard input). On success the
patched document is printed as JSON indented by two spaces.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json > out.json
```

Inputs are UTF-8 (a leading byte order mark is ignored), at most 1 MiB, and at most 1000
levels deep. Errors print one line to stderr:

| Exit | Meaning | Example |
| ---- | ------- | ------- |
| 0 | success | |
| 1 | input cannot be read | `Error: doc.json: no such file`, `is a directory`, `too large`, `cannot read` |
| 2 | wrong arguments | `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` |
| 3 | bad input content | `Error: stdin: invalid UTF-8`, `invalid JSON`, `too deep` |
| 4 | patch failed | `Error: operation 2: test failed` |

## Tests

```sh
npm test
```
