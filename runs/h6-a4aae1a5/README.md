# jsonpatch

A dependency-free JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) library and
command-line tool for Node.js.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~0c/0'); // ['a/b', '~c', '0']

const doc = { a: [1, 2] };
const result = applyPatch(doc, [
  { op: 'add', path: '/a/1', value: 9 },
  { op: 'test', path: '/a', value: [1, 9, 2] },
]);
// result: { a: [1, 9, 2] }; doc is unchanged

try {
  applyPatch(doc, [{ op: 'remove', path: '/nope' }]);
} catch (e) {
  e instanceof PatchError; // true
  e.message; // 'operation 0: path not found'
  e.index; // 0
}
```

- `parsePointer(pointer)` returns the decoded tokens. It throws a `TypeError`
  (`pointer must be a string`) for non-strings and a `SyntaxError`
  (`invalid pointer`) for malformed pointers.
- `applyPatch(doc, patch)` returns a new document; neither `doc` nor `patch` is
  modified and the result shares no objects with them. All operations are
  validated before any is applied. Failures throw a `PatchError` whose `message`
  is `operation <i>: <reason>` and whose `index` is `<i>` (or
  `patch must be an array` with `index` null).

Reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`, `path not found`,
`from not found`, `bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from the file `<patch>` and the document from `<doc>`. A missing
`<doc>`, or `-`, means standard input (only one input may come from stdin). On
success the patched document is printed as JSON indented by two spaces.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json
```

Exit codes:

| Code | Meaning |
| ---- | ------- |
| 0 | success |
| 2 | usage error |
| 1 | read error (`no such file`, `is a directory`, `too large` (> 1 MiB), `cannot read`) |
| 3 | `invalid UTF-8`, `invalid JSON`, `too deep` (> 1000 levels) |
| 4 | the patch could not be applied |

Errors are printed as a single line on stderr, e.g. `Error: doc.json: invalid JSON`
or `Error: operation 2: test failed`.

## Tests

```sh
npm test
```
