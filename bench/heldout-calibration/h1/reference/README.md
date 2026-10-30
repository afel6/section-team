# ini2json

Convert an INI file to JSON. No dependencies, Node.js 20 or later.

## Usage

```sh
node ini2json.mjs <file>
```

Example: for `app.ini`

```ini
name = demo
[server]
port = 8080
debug = false
```

`node ini2json.mjs app.ini` prints

```json
{
  "name": "demo",
  "server": {
    "port": 8080,
    "debug": false
  }
}
```

## Output

On success the tool writes `JSON.stringify(result, null, 2)` plus a newline to stdout, writes nothing to
stderr and exits 0. Keys before the first `[section]` are top-level keys; each section becomes an object.
Keys and sections keep their file order, and an empty file gives `{}`.

## Input rules

- The file is read as UTF-8; a leading byte order mark is ignored and invalid bytes become U+FFFD.
- Lines end in `\n` or `\r\n`. Spaces and tabs around a line are ignored; blank lines and lines starting
  with `;` or `#` are skipped. There are no inline comments: `;` and `#` inside a value are kept.
- `[name]` starts a section; a section seen again is merged into the first one.
- Any other line is `key = value`. Names are 1 to 64 characters from `A-Z a-z 0-9 _ - .` and start with a
  letter or `_` (`__proto__` and `constructor` are ordinary keys).
- `true` / `false` become booleans and safe integers (`0`, `-12`, `42`, no leading zeros) become numbers.
  A `"quoted"` value is always a string, with `\"` and `\\` as its only escapes. Anything else is a string.

## Errors and exit codes

Every error is one line on stderr, with nothing on stdout.

| Exit | Message | When |
| ---- | ------- | ---- |
| 0 | (none) | the file was converted |
| 2 | `Usage: node ini2json.mjs <file>` | not exactly one argument |
| 1 | `Error: <file>: no such file` | the file does not exist |
| 1 | `Error: <file>: is a directory` | the path is a directory |
| 1 | `Error: <file>: cannot read` | any other read error |
| 3 | `Error: line <n>: <reason>` | the first invalid line (line numbers start at 1) |

`<reason>` is one of `bad section name`, `missing =`, `bad key`, `bad quoted value`,
`duplicate key <key>` or `conflict <name>` (a section named like an existing top-level key).

## Tests

```sh
npm test
```

runs the `node:test` suite in `ini2json.test.mjs`.
