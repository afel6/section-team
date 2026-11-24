# calc

An arithmetic expression library (`calc.mjs`) and a command-line calculator (`calc-cli.mjs`). Node.js only, no dependencies.

## Library

```js
import { evaluate, CalcError } from './calc.mjs'

evaluate('2^3^2')                  // 512
evaluate('-2^2')                   // -4
evaluate('x * (y + 1)', { x: 2, y: 3 }) // 8
evaluate('round(-2.5)')            // -3
```

- Operators: `+ - * / % ^`, with `^` binding tightest and working right to left; signs bind looser than a `^` after them.
- Functions: `abs`, `sqrt`, `round` (halfway values away from zero), `min` and `max`.
- Variables come from the own properties of `vars`; `pi` and `e` are built in unless `vars` defines them.
- Errors are `CalcError`s with a `message` such as `division by zero at 1` and a `position` (a UTF-16 index into the source, or `null` for `unexpected end of input`). The whole source is checked for syntax before anything is evaluated.

## Command line

```
node calc-cli.mjs <expression> [<name>=<value>]...
node calc-cli.mjs "x * 2 + 1" x=20     # 41
node calc-cli.mjs "1/3"                # 0.333333333333
```

The value is printed with at most 12 significant digits. Exit codes: 0 success, 1 an error in the expression (`Error: <message>` on stderr), 2 a usage error or a bad `<name>=<value>` argument.

## Test

```
npm test
```
