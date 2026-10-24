Create `src/text.mjs` (an ES module) that exports two functions.

1. `slugify(input)`
   - Lowercase the text.
   - Remove accents: normalize with NFKD and drop combining marks (U+0300–U+036F). Example: "Crème Brûlée" → "creme-brulee".
   - Replace every run of characters that are not a–z or 0–9 with a single "-".
   - Remove leading and trailing "-".
   - A non-string input throws a TypeError.
   - Examples: slugify("  Hello, World!  ") === "hello-world"; slugify("a--b__c") === "a-b-c"; slugify("!!!") === "".

2. `truncate(input, max)`
   - If input.length <= max, return input unchanged.
   - Otherwise return the first (max - 1) characters with trailing whitespace removed, followed by "…" (U+2026).
   - max must be an integer >= 1, otherwise throw a RangeError. A non-string input throws a TypeError.
   - Examples: truncate("hello world", 20) === "hello world"; truncate("hello world", 6) === "hello…"; truncate("hello world", 7) === "hello…".

Also add tests with node:test in `test/text.test.mjs`, and a `package.json` with "type": "module" and a "test" script that runs them.
