# JSON Patch library + CLI — full spec (verbatim from the user, final)

Build a JSON Patch library `jsonpatch.mjs` (an ES module with the named exports `parsePointer`, `applyPatch` and `PatchError`; no default export is needed) and a command-line tool `jsonpatch-cli.mjs` (an ES module, run as `node jsonpatch-cli.mjs <patch> [<doc>]`) that applies a patch to a JSON document. Put both files at the project root, next to `package.json`. The rules follow JSON Pointer (RFC 6901) and JSON Patch (RFC 6902); where this text is more exact, this text wins. Throughout, a "string" is a primitive string, a value whose `typeof` is `'string'`; a String object such as `new String('/a')` is not a string.

Use only Node.js built-ins (no npm install).

## Pointers
- A valid pointer is the empty string, or `/` followed by reference tokens separated by `/`: "" has no tokens, "/" has one token (the empty string), and "/a//b/" has the tokens "a", "", "b" and "".
- In a token, `~1` stands for `/` and `~0` for `~`, so "/~01" has the token "~1" and "/~10" has the token "/0". A `~` that is not followed by `0` or `1`, or a non-empty string that does not start with `/`, makes the pointer invalid.
- `parsePointer(pointer)` returns a new array of the decoded tokens. A pointer that is not a string (a String object included): throw a `TypeError` with the message `pointer must be a string`. An invalid pointer: throw a `SyntaxError` with the message `invalid pointer`.
- A pointer is followed token by token, starting at the whole document:
  - On an object, a token names the object's own member of exactly that name, if it has one. `__proto__`, `constructor`, `toString` and every other name are ordinary member names: inherited properties never count.
  - On an array, a token that is `0`, or a digit 1-9 followed by any digits, is an index: it names the element at that index when the index is less than the array's length. `-` names no element. Any other token (for example `01`, `+1`, `1.0`, `1e0`, ` 1`, `length` or "") is a bad index.
  - On a string, number, boolean or null, no token names anything.

## Patches
- `applyPatch(doc, patch)` returns the document that results from applying `patch` to `doc`. `doc` is a JSON value as `JSON.parse` returns it. `patch`, each element of it and each member of an operation may be any JavaScript value, except that the `value` member of an `add`, `replace` or `test`, when present, is a JSON value as `JSON.parse` returns it (never undefined). No getter, setter or Proxy appears anywhere in `doc` or `patch`, so any property may be read any number of times. The tests never pass a `doc` or a `value` more than 1000 levels deep (depth as defined under Command line).
- `applyPatch` never changes `doc` or `patch`, also when it throws, and the value it returns shares no object or array with them (a patch of `[]` returns a deep copy of `doc`). Every copy, including each `value` that `add`, `replace` or `copy` puts into the result, keeps every number exactly as it is, -0 included (a patch of `[]` on `{"a":-0}` returns `{a: -0}`), and keeps member order.
- Member order is JavaScript's own property order, as `Object.keys` gives it: names that are array indices ("0" to "4294967294", written without leading zeros) come first in ascending numeric order, then the other names in the order they were added. So a new name goes last among the names of its kind: adding `/1` with value 5 to `{"b":0}` gives `{"1":5,"b":0}`, and the command line prints it in that order.
- `patch` must be an array, as `Array.isArray` decides. Every index from 0 to `patch.length - 1` holds an operation; a hole counts as the value undefined. First every operation is checked, in order, against the form rules below; the first one that breaks them stops `applyPatch` before anything is applied. Then the operations are applied in order, each to the result of the one before; the first one that fails stops `applyPatch`.
- An operation has a member `name` when `Object.hasOwn(op, name)` is true, whether or not the property is enumerable; inherited properties never count. Members that its `op` does not use are ignored, whatever their value (for example `from` on an `add`, or `value` on a `remove`).

## Form rules (the reason is the first of these that applies to the operation)
- `not an object`: the operation is null, an array, or a value whose `typeof` is not `'object'`. So a function or a hole is `not an object`, while a String object, a Date or any other object goes on to the next rule.
- `bad op`: `op` is missing, or is not exactly (`===`) one of the strings `add`, `remove`, `replace`, `move`, `copy` and `test`.
- `bad path`: `path` is missing, is not a string, or is not a valid pointer.
- `bad from`: for `move` and `copy`, `from` is missing, is not a string, or is not a valid pointer.
- `missing value`: for `add`, `replace` and `test`, there is no `value` member (a `value` of null is present).
- `cannot remove root`: a `remove` whose `path` is "".
- `cannot move into own child`: a `move` whose `from` tokens are a proper prefix of its `path` tokens. A `from` of "" is a proper prefix of every other path; `/a` is not a prefix of `/ab`.

## Operations
- `add`: a `path` of "" makes `value` the whole document. Otherwise the tokens of `path` but the last are followed to the parent. On an object, the last token is the member name: a name the object does not have becomes a new own member of it (placed as the member order rule says), and an existing member gets `value` and keeps its place. On an array, `-` appends `value`, and an index up to and including the array's length inserts `value` at that index, moving the later elements up.
- `remove`: `path` must name a value, which is removed (from an array, the later elements move down).
- `replace`: a `path` of "" makes `value` the whole document. Otherwise `path` must name a value, which becomes `value`; a member keeps its place.
- `move`: `from` must name a value. It is removed as `remove` does, then added at `path` as `add` does, so an array index in `path` counts after the removal. A `move` whose `from` equals its `path` leaves the document as it is (once `from` is found).
- `copy`: `from` must name a value. A deep copy of it, taken before anything changes, is added at `path` as `add` does; `path` may lie inside `from`.
- `test`: `path` must name a value ("" names the whole document), and that value must equal `value`: both are the same JSON type, and numbers have the same value (1, 1.0 and 1e0 are equal, and so are 0 and -0); strings have exactly the same characters (no Unicode normalization); arrays have the same length and equal elements in the same order; objects have the same member names, in any order, with equal values; true, false and null equal only themselves.

## Failures while applying
- The first token of a pointer that names nothing stops the operation: with `bad index` if it is a bad index on an array, otherwise with `from not found` while following `from` and `path not found` while following `path`. `move` and `copy` follow `from` first.
- `add` follows only the parent; its last token then fails with `path not found` when the parent is neither an object nor an array, or is an array and the token is an index greater than the array's length, and with `bad index` when the parent is an array and the token is neither `-` nor an index.
- `test failed`: the value at `path` does not equal `value`.

## Errors
- `PatchError` is a subclass of `Error` whose `name` is `PatchError`, and each one `applyPatch` throws has an `index` property. `applyPatch` throws nothing else. The tests never construct a `PatchError` themselves; they check only `instanceof PatchError`, `instanceof Error`, `name`, `message` and `index` on the errors `applyPatch` throws.
- When `patch` is not an array, the message is `patch must be an array` and `index` is null. Otherwise the message is `operation <i>: <reason>` and `index` is the number `<i>`, the 0-based position of the failing operation in `patch` (for example `operation 2: test failed`).

## Command line
- `node jsonpatch-cli.mjs <patch> [<doc>]` reads the patch from the file `<patch>` and the document from the file `<doc>`. A missing `<doc>`, or an argument that is exactly `-`, means standard input. Every other argument is a file path.
- On success, write `JSON.stringify(result, null, 2)` followed by "\n" to stdout, write nothing to stderr, and exit 0.
- Each input is read as UTF-8; a byte order mark (U+FEFF) at its very start is ignored. The text is then parsed as `JSON.parse` does.
- The steps run in this order, and the first one that fails is reported: the arguments; the patch input (read, then decoded, then parsed, then checked for depth); the document input (the same four steps); applying the patch. So the document input is not read until the patch input has passed every check.

## CLI errors (exactly one line to stderr, ending in "\n"; nothing to stdout). `<name>` is the argument as given, or `stdin` for standard input.
- Not 1 or 2 arguments, or both inputs are standard input: `Usage: node jsonpatch-cli.mjs <patch> [<doc>]`, exit 2.
- Read errors exit 1, and the reason is the first of these that applies. `Error: <name>: no such file`: no file system entry exists at the path, so opening it fails with ENOENT or ENOTDIR (for example `nope.json`, or `patch.json/x` where `patch.json` is a regular file; the tests never put a trailing `/` after a regular file's name). `Error: <name>: is a directory`: the path names a directory, whatever its permissions. `Error: <name>: too large`: more than 1048576 bytes (a byte order mark included) were read from the input; this counts the bytes actually read, not the size the file system reports, so a file that cannot be opened is `cannot read` whatever its size. `Error: <name>: cannot read`: any other read error. For standard input only `too large` and `cannot read` apply.
- Bytes that are not valid UTF-8: `Error: <name>: invalid UTF-8`. Text that `JSON.parse` rejects, an empty input included: `Error: <name>: invalid JSON`. A JSON value nested more than 1000 levels deep: `Error: <name>: too deep`, where a string, number, boolean or null has depth 0 and an array or object has depth one more than the deepest value in it (so `[]` and `{}` have depth 1). Each exits 3.
- `applyPatch` throws a `PatchError`: `Error: <message>` (for example `Error: operation 0: bad op`), exit 4.

Also: tests with node:test, a `package.json` ("type": "module" and a "test" script), and a README with usage.
