# jsonpatch

A dependency-free JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)) and
JSON Patch ([RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)) library and command-line tool
for Node.js (ES modules, built-ins only).

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a/~01/~10'); // ['a', '~1', '/0']

const doc = { a: 1, list: [1, 2] };
const result = applyPatch(doc, [
  { op: 'replace', path: '/a', value: 2 },
  { op: 'add', path: '/list/-', value: 3 },
  { op: 'test', path: '/list/2', value: 3 },
]);
// result: { a: 2, list: [1, 2, 3] }; doc is unchanged
```

- `parsePointer(pointer)` returns the decoded reference tokens. It throws a `TypeError`
  (`pointer must be a string`) for a non-string, and a `SyntaxError` (`invalid pointer`) for a
  malformed pointer.
- `applyPatch(doc, patch)` returns a new document. It never changes `doc` or `patch`, and the
  result shares no object or array with them. Numbers (including `-0`) and member order are kept.
- All operations are checked for form before any of them is applied. Failures throw a
  `PatchError` whose `message` is `operation <i>: <reason>` and whose `index` is `<i>`.
  A non-array patch throws `patch must be an array` with `index` `null`.

Reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`, `path not found`, `from not found`,
`bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from the file `<patch>` and the document from `<doc>`. A missing `<doc>`, or an
argument of `-`, means standard input (only one of the two may be standard input). On success it
prints the result as `JSON.stringify(result, null, 2)` and exits 0.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json > result.json
```

Inputs are UTF-8 (a leading byte order mark is ignored), at most 1 MiB, and at most 1000 levels
deep. Errors print one line to stderr:

| Exit | Message |
| ---- | ------- |
| 2 | `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` |
| 1 | `Error: <name>: no such file` / `is a directory` / `too large` / `cannot read` |
| 3 | `Error: <name>: invalid UTF-8` / `invalid JSON` / `too deep` |
| 4 | `Error: operation <i>: <reason>` (or `Error: patch must be an array`) |

`<name>` is the argument as given, or `stdin`.

## Tests

```sh
npm test
```
