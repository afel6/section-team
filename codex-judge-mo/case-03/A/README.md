# jsonpatch

A dependency-free JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) library and
command-line tool for Node.js.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a/~01/0'); // ['a', '~1', '0']

const doc = { b: 0 };
const result = applyPatch(doc, [
  { op: 'add', path: '/1', value: 5 },
  { op: 'test', path: '/b', value: 0 },
]);
// result: { '1': 5, b: 0 }; doc is unchanged

try {
  applyPatch(doc, [{ op: 'remove', path: '/nope' }]);
} catch (e) {
  if (e instanceof PatchError) console.log(e.message, e.index); // "operation 0: path not found" 0
}
```

- `parsePointer(pointer)` returns the decoded reference tokens. It throws a
  `TypeError` (`pointer must be a string`) for non-strings and a `SyntaxError`
  (`invalid pointer`) for malformed pointers.
- `applyPatch(doc, patch)` returns a new document. It never changes `doc` or
  `patch`, and the result shares no objects or arrays with them. Every operation
  is checked for form before any is applied. Failures throw a `PatchError` with a
  message of the form `operation <i>: <reason>` and an `index` property (or
  `patch must be an array` with `index` null).

Form reasons: `not an object`, `bad op`, `bad path`, `bad from`,
`missing value`, `cannot remove root`, `cannot move into own child`.
Reasons while applying: `path not found`, `from not found`, `bad index`,
`test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>` (standard input if
`<doc>` is omitted; either argument may be `-` for standard input, but not both).
Prints the result as `JSON.stringify(result, null, 2)`.

```sh
echo '{"b":0}' | node jsonpatch-cli.mjs patch.json
```

Exit codes:

| Code | Meaning |
| ---- | ------- |
| 0 | success |
| 2 | usage error |
| 1 | read error (`no such file`, `is a directory`, `too large` (> 1 MiB), `cannot read`) |
| 3 | `invalid UTF-8`, `invalid JSON`, `too deep` (> 1000 levels) |
| 4 | the patch failed (`Error: operation <i>: <reason>`) |

Errors are written to stderr as a single line, e.g. `Error: doc.json: no such file`.

## Tests

```sh
npm test
```
