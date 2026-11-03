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
// result: { '1': 5, b: 0 }; doc is unchanged

try {
  applyPatch({}, [{ op: 'remove', path: '/x' }]);
} catch (err) {
  if (err instanceof PatchError) console.log(err.message, err.index); // "operation 0: path not found" 0
}
```

- `parsePointer(pointer)` returns the decoded tokens. It throws a `TypeError`
  (`pointer must be a string`) when the pointer is not a primitive string, and a
  `SyntaxError` (`invalid pointer`) when the pointer is not valid.
- `applyPatch(doc, patch)` returns a new document. It never changes `doc` or `patch`, and the
  result shares no object or array with them. It checks the form of every operation before it
  applies any of them.
- `PatchError` has a `message` and an `index`: `index` is `null` for
  `patch must be an array`; otherwise it is the position of the failing operation and the
  message is `operation <i>: <reason>`.

Reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`, `path not found`, `from not found`,
`bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>`. A missing `<doc>`, or an
argument of `-`, means standard input. The result is printed as JSON with 2-space indentation.

```sh
echo '{"b":0}' | node jsonpatch-cli.mjs patch.json
```

Inputs are UTF-8 (a leading byte order mark is ignored), at most 1 MiB and at most 1000
levels deep.

| Exit | Meaning |
| ---- | ------- |
| 0 | success |
| 1 | read error: `no such file`, `is a directory`, `too large`, `cannot read` |
| 2 | usage error (wrong argument count, or both inputs on standard input) |
| 3 | `invalid UTF-8`, `invalid JSON`, `too deep` |
| 4 | the patch failed: `Error: <PatchError message>` |

Errors are printed to stderr as one line, for example `Error: patch.json: no such file`.

## Tests

```sh
npm test
```
