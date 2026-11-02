# jsonpatch

A JSON Pointer (RFC 6901) and JSON Patch (RFC 6902) library with a command-line tool. No dependencies,
Node.js 20 or later.

## Command line

```sh
node jsonpatch-cli.mjs <patch> [<doc>]
```

Reads the patch from `<patch>` and the document from `<doc>`. A missing `<doc>`, or an argument that is
exactly `-`, means standard input (only one of the two can be). For `patch.json`

```json
[{ "op": "add", "path": "/tags/-", "value": "new" }, { "op": "remove", "path": "/draft" }]
```

`echo '{"tags":["a"],"draft":true}' | node jsonpatch-cli.mjs patch.json` prints

```json
{
  "tags": [
    "a",
    "new"
  ]
}
```

On success the tool writes `JSON.stringify(result, null, 2)` plus a newline to stdout and exits 0. Each
input is read as UTF-8 (a leading byte order mark is ignored) and parsed with `JSON.parse`. The patch input is
fully read and checked before the document is read.

| Exit | Message on stderr | When |
| ---- | ----------------- | ---- |
| 2 | `Usage: node jsonpatch-cli.mjs <patch> [<doc>]` | not 1 or 2 arguments, or both inputs are stdin |
| 1 | `Error: <name>: no such file` | nothing exists at the path |
| 1 | `Error: <name>: is a directory` | the path is a directory |
| 1 | `Error: <name>: too large` | more than 1048576 bytes were read |
| 1 | `Error: <name>: cannot read` | any other read error |
| 3 | `Error: <name>: invalid UTF-8` | the bytes are not valid UTF-8 |
| 3 | `Error: <name>: invalid JSON` | `JSON.parse` rejects the text (an empty input too) |
| 3 | `Error: <name>: too deep` | arrays and objects nested more than 1000 levels |
| 4 | `Error: <message>` | the patch failed (see below) |

`<name>` is the argument as given, or `stdin`.

## Library

```js
import { applyPatch, parsePointer, PatchError } from './jsonpatch.mjs';

parsePointer('/a~1b/~0c'); // ['a/b', '~c']
applyPatch({ a: 1 }, [{ op: 'replace', path: '/a', value: 2 }]); // { a: 2 }
```

- `parsePointer(pointer)` returns the decoded tokens. A non-string throws `TypeError('pointer must be a
  string')`; an invalid pointer throws `SyntaxError('invalid pointer')`.
- `applyPatch(doc, patch)` returns a new document and never changes `doc` or `patch`. Numbers (`-0`
  included) and member order are kept. Object tokens name own members only, so `__proto__` and
  `toString` are ordinary names; array tokens must be `0` or a number without leading zeros.
- Every operation is checked first; then they are applied in order. A failure throws a `PatchError` with
  `message` `operation <i>: <reason>` and `index` `<i>`, or `patch must be an array` with `index` null.

Reasons, from the form check: `not an object`, `bad op`, `bad path`, `bad from`, `missing value`,
`cannot remove root`, `cannot move into own child`. While applying: `path not found`, `from not found`,
`bad index`, `test failed`.

## Tests

```sh
npm test
```

runs the `node:test` suites in `jsonpatch.test.mjs` and `jsonpatch-cli.test.mjs`.
