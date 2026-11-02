# Frontend page (owner: frontend) — 2026-11-02

Files: `public/index.html`, `public/app.js` (classic script wrapped in an IIFE, `'use strict'`, no globals leaked).

## Element ids
`booking-form` (novalidate), `room` (select, empty in HTML), `title`, `date`, `start`, `end`, `book` (submit),
`filter-date`, `show-all`, `booking-list` (ul), `error` (p, role=alert, empty). One `<h1>`; one `<script src="/app.js">`
as the last element in body. A `<style>` block exists in `<head>` (no inline script, no on* attributes).

## Behaviour (as in spec Page section)
- At setup, in this order, synchronously: `fetch('/api/rooms', {method:'GET'})` then `fetch('/api/bookings', {method:'GET'})`.
  So the first two fetch calls happen during `vm.runInContext`.
- GET requests pass `{ method: 'GET' }` as options. POST passes `{ method, headers: {'Content-Type':'application/json'}, body }`;
  DELETE passes `{ method: 'DELETE' }`.
- One `request()` helper: 204 -> body never read (json() not called); any other status -> `await res.json()`;
  fetch rejection or json() rejection -> "no reply".
- Error message: body is non-null non-array object with string `error` -> that, else `Request failed.`
- A 200 list/rooms reply whose `bookings`/`rooms` is not an array shows `Request failed.` (not specified; defensive).
- List: sequence counter; outcome of any non-latest fetch is ignored entirely. Success leaves `#error` alone.
- Rows: `li.append(text, button)` — text is `<date> <start>-<end> <room>: <title>`; empty -> one li with `No bookings.`.
  Uses `list.replaceChildren(...items)`.
- Book: preventDefault first; if `book.disabled` return; disable; POST; `disabled=false` right after the reply+json settle.
- Cancel: guard `if (button.disabled) return;` (a disabled button gets no click in a browser anyway).
  204 -> `#error` emptied; other status -> message; both refetch list. No reply -> message, no refetch.
- Show all: `filter.value = ''` then one list fetch; `change` on filter -> fetch; `input` -> nothing.

## Testing tips (node:vm fake DOM)
- Objects created inside the vm context (e.g. the `headers` object) have the context's Object prototype, so
  `assert.deepStrictEqual(opts.headers, {...})` fails across realms. Compare with `JSON.stringify` or key by key.
- Text nodes are appended as plain strings: a fake `append` should store strings as text nodes.
- Wait a few macrotasks (`setTimeout`) after resolving a fake fetch; json() adds extra microtask hops.
