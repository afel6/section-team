# jsonpatch

A dependency-free JSON Pointer ([RFC 6901](https://www.rfc-editor.org/rfc/rfc6901)) and
JSON Patch ([RFC 6902](https://www.rfc-editor.org/rfc/rfc6902)) library and command-line tool
for Node.js (ES modules, Node 18+).

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~0c/0'); // ['a/b', '~c', '0']

const doc = { name: 'x', tags: ['a'] };
const result = applyPatch(doc, [
  { op: 'add', path: '/tags/-', value: 'b' },
  { op: 'replace', path: '/name', value: 'y' },
  { op: 'test', path: '/tags/0', value: 'a' },
]);
// result: { name: 'y', tags: ['a', 'b'] }; doc is unchanged
```

- `parsePointer(pointer)` returns the decoded reference tokens. It throws a `TypeError`
  (`pointer must be a string`) for a non-string and a `SyntaxError` (`invalid pointer`) for an
  invalid pointer.
- `applyPatch(doc, patch)` returns a new document. It never changes `doc` or `patch`, and the
  result shares no objects or arrays with them. Every operation is checked for form before any is
  applied; the first failure throws a `PatchError`.
- `PatchError` has `name` `'PatchError'`, a `message` such as `operation 2: test failed`, and an
  `index` (the 0-based position of the failing operation, or `null` when `patch` is not an array).

Failure reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`, `path not found`, `from not found`,
`bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from the file `<patch>` and the document from `<doc>`. A missing `<doc>`, or an
argument of `-`, means standard input (only one input may be standard input). On success the
result is printed as 2-space indented JSON.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json
```

Inputs are UTF-8 (a leading byte order mark is ignored), at most 1 MiB, and at most 1000 levels
deep. Errors print one line to stderr:

| Exit | Cause |
| ---- | ----- |
| 2 | wrong arguments: `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` |
| 1 | `Error: <name>: no such file` / `is a directory` / `too large` / `cannot read` |
| 3 | `Error: <name>: invalid UTF-8` / `invalid JSON` / `too deep` |
| 4 | `Error: operation <i>: <reason>` or `Error: patch must be an array` |

`<name>` is the argument as given, or `stdin`.

## Tests

```sh
npm test
```
