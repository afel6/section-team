# jsonpatch

A JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) library and command-line tool.
Node.js built-ins only, no dependencies.

## Library

```js
import { parsePointer, applyPatch, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~01'); // ['a/b', '~1']

const result = applyPatch({ b: 0 }, [{ op: 'add', path: '/1', value: 5 }]);
// { '1': 5, b: 0 }

try {
  applyPatch({}, [{ op: 'test', path: '/x', value: 1 }]);
} catch (err) {
  if (err instanceof PatchError) console.log(err.message, err.index);
  // "operation 0: path not found" 0
}
```

- `parsePointer(pointer)` returns the decoded tokens. It throws `TypeError('pointer must be a string')`
  for a non-string and `SyntaxError('invalid pointer')` for an invalid pointer.
- `applyPatch(doc, patch)` returns a new document; `doc` and `patch` are never changed and the
  result shares no objects with them. Numbers (including `-0`) and member order are preserved.
- Every operation is checked for form first; then they are applied in order. Errors are
  `PatchError`s with `message` `operation <i>: <reason>` and `index` `<i>`, or
  `patch must be an array` with `index` `null`.

Form reasons: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`.
Apply reasons: `path not found`, `from not found`, `bad index`, `test failed`.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>`; a missing `<doc>` or an argument
of `-` means standard input (only one input may be stdin). Prints the result as
`JSON.stringify(result, null, 2)` plus a newline.

```sh
echo '{"b":0}' | node jsonpatch-cli.mjs patch.json
```

Inputs are UTF-8 (a leading byte order mark is ignored), at most 1048576 bytes and at most
1000 levels deep.

| Exit | Meaning | stderr |
| ---- | ------- | ------ |
| 0 | success | (nothing) |
| 1 | read error | `Error: <name>: no such file` / `is a directory` / `too large` / `cannot read` |
| 2 | bad arguments | `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` |
| 3 | bad input | `Error: <name>: invalid UTF-8` / `invalid JSON` / `too deep` |
| 4 | patch failed | `Error: <PatchError message>` |

`<name>` is the argument as given, or `stdin`.

## Tests

```sh
npm test
```
