# jsonpatch

A JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) library and command-line tool for Node.js. It has no dependencies.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~01'); // ['a/b', '~1']

const doc = { b: 0, list: [1, 2] };
const result = applyPatch(doc, [
  { op: 'add', path: '/1', value: 5 },
  { op: 'move', from: '/list/0', path: '/list/-' },
  { op: 'test', path: '/list', value: [2, 1] },
]);
// result: { '1': 5, b: 0, list: [2, 1] }. doc is unchanged.

try {
  applyPatch(doc, [{ op: 'remove', path: '/missing' }]);
} catch (err) {
  err instanceof PatchError; // true
  err.message;               // 'operation 0: path not found'
  err.index;                 // 0
}
```

- `parsePointer(pointer)` returns the decoded tokens. It throws a `TypeError` (`pointer must be a string`) when the pointer is not a string, and a `SyntaxError` (`invalid pointer`) when the pointer is invalid.
- `applyPatch(doc, patch)` returns a new document. It never changes `doc` or `patch`, and the result shares no objects or arrays with them. All operations are checked before any of them is applied. The result keeps `-0` and member order.
- `PatchError` has an `index` property. It is `null` when the patch is not an array (message `patch must be an array`). Otherwise it is the position of the failing operation, and the message is `operation <i>: <reason>`.

The reasons are: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`, `cannot remove root`, `cannot move into own child`, `path not found`, `from not found`, `bad index` and `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

The tool reads the patch from the file `<patch>` and the document from `<doc>`. If `<doc>` is missing, or if an argument is `-`, that input comes from standard input. On success it prints the result as 2-space-indented JSON and exits with 0.

```sh
echo '{"a":1}' | node jsonpatch-cli.mjs patch.json
node jsonpatch-cli.mjs patch.json doc.json > out.json
```

Each input must be UTF-8 (a leading byte order mark is ignored), at most 1 MiB, and nested at most 1000 levels deep. On an error the tool prints one line to stderr and exits with one of these codes:

| Exit | Cause | Example message |
| --- | --- | --- |
| 2 | wrong arguments, or both inputs on stdin | `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` |
| 1 | read error | `Error: doc.json: no such file` / `is a directory` / `too large` / `cannot read` |
| 3 | bad content | `Error: doc.json: invalid UTF-8` / `invalid JSON` / `too deep` |
| 4 | the patch failed | `Error: operation 0: bad op` |

## Tests

```sh
npm test
```
