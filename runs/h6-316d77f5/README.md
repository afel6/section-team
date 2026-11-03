# jsonpatch

A dependency-free JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)) and
JSON Patch ([RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)) library and command-line tool
for Node.js.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~0c'); // ['a/b', '~c']

const doc = { b: 0 };
const result = applyPatch(doc, [
  { op: 'add', path: '/1', value: 5 },
  { op: 'test', path: '/b', value: 0 },
]);
// result: { '1': 5, b: 0 } — doc itself is unchanged

try {
  applyPatch(doc, [{ op: 'remove', path: '/nope' }]);
} catch (err) {
  err instanceof PatchError; // true
  err.message; // 'operation 0: path not found'
  err.index; // 0
}
```

- `parsePointer(pointer)` returns the decoded reference tokens. It throws a `TypeError`
  (`pointer must be a string`) for a non-string and a `SyntaxError` (`invalid pointer`) for
  an invalid pointer.
- `applyPatch(doc, patch)` returns a new document; it never changes `doc` or `patch`, and the
  result shares no object or array with them. Every operation is checked first, then applied in
  order. All failures are `PatchError`s with an `index` (the failing operation, or `null` when
  `patch` is not an array).

Error reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`, `path not found`, `from not found`,
`bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>`. A missing `<doc>`, or `-`, means
standard input (only one of the two may be standard input). The result is printed as JSON with
two-space indentation.

```sh
echo '{"b":0}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json > out.json
```

Inputs are UTF-8 (a leading BOM is ignored), at most 1 MiB and at most 1000 levels deep.

| Exit | Meaning |
| ---- | ------- |
| 0 | success |
| 1 | read error: `no such file`, `is a directory`, `too large`, `cannot read` |
| 2 | usage error |
| 3 | `invalid UTF-8`, `invalid JSON`, `too deep` |
| 4 | the patch failed (`Error: operation <i>: <reason>`) |

Errors are written to stderr as a single line, for example `Error: doc.json: invalid JSON`.

## Tests

```sh
npm test
```
