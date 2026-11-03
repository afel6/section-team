// Builds the near-miss copies in .team/near-miss/ from the current originals (testing section tool).
// Each copy = original with one plausible bug; its first line is a comment `near-miss: <bug>`.
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const OUT = path.join(ROOT, '.team/near-miss');

const S = 'server.mjs';
const A = 'public/app.js';
const H = 'public/index.html';

// [target, bug, from, to]
const MUTANTS = [
  [S, 'overlap uses <= so touching bookings conflict',
    'a.start < b.end && b.start < a.end', 'a.start <= b.end && b.start <= a.end'],
  [S, 'date is trimmed before validation',
    'if (!isValidDate(body.date))', "if (!isValidDate(typeof body.date === 'string' ? body.date.trim() : body.date))"],
  [S, 'Feb 29 by the Gregorian 100-year rule (2000 not leap)',
    'year % 4 === 0 ? 29 : 28', 'year % 4 === 0 && year % 100 !== 0 ? 29 : 28'],
  [S, '413 checked before 415',
    "  if (!mediaTypeIsJson(req.headers['content-type'])) throw new HttpError(415, MSG.contentType);\n  if (body.size > MAX_BODY_BYTES) throw new HttpError(413, MSG.tooLarge);",
    "  if (body.size > MAX_BODY_BYTES) throw new HttpError(413, MSG.tooLarge);\n  if (!mediaTypeIsJson(req.headers['content-type'])) throw new HttpError(415, MSG.contentType);"],
  [S, 'path is percent-decoded before routing',
    'const { pathname, query } = splitTarget(req.url);',
    'const { pathname: rawPath, query } = splitTarget(req.url);\n  const pathname = decodeURIComponent(rawPath);'],
  [S, 'next id advances even when the save fails',
    '      const next = freezeStore(change(store));\n      await writeFile',
    '      const next = freezeStore(change(store));\n      store = freezeStore({ nextId: next.nextId, bookings: store.bookings });\n      await writeFile'],
  [S, 'title limit uses < 80 instead of <= 80', 'value.length <= 80', 'value.length < 80'],
  [S, 'content type trimmed with String.trim (removes NBSP too)',
    ".replace(/^[ \\t]+|[ \\t]+$/g, '')", '.trim()'],
  [S, 'body of exactly 10000 bytes rejected (>= instead of >)',
    'body.size > MAX_BODY_BYTES', 'body.size >= MAX_BODY_BYTES'],
  [S, '409 reports the first overlapping booking by id, not the earliest start',
    'return bookings\n    .filter((b) => overlaps(b, candidate))\n    .reduce((earliest, b) => (earliest === null || b.start < earliest.start ? b : earliest), null);',
    'return bookings.find((b) => overlaps(b, candidate)) ?? null;'],
  [S, 'delete id compared as a number, leading zeros accepted',
    ["if (!/^[1-9][0-9]*$/.test(idText)) throw bookingNotFound();", 'String(b.id) !== idText'],
    ["if (!/^[0-9]+$/.test(idText)) throw bookingNotFound();", 'b.id !== Number(idText)']],
  [S, 'empty ?date= treated as no filter', "if (!params.has('date'))", "if (!params.get('date'))"],
  [S, 'stdout prints the requested port, not the bound one',
    '${HOST}:${server.address().port}', '${HOST}:${port}'],
  [S, 'startup error names the resolved path, not DATA_FILE as given',
    'fail(`cannot read data file ${dataName}`)', 'fail(`cannot read data file ${dataPath}`)'],
  [S, 'relative DATA_FILE resolved against the folder of server.mjs',
    'path.resolve(process.cwd(), dataName)', 'path.resolve(path.dirname(new URL(import.meta.url).pathname), dataName)'],
  [S, 'data file rewritten at startup',
    'const repo = createRepository(dataPath, store);',
    "const repo = createRepository(dataPath, store);\n  writeFile(dataPath, JSON.stringify(store)).catch(() => undefined);"],
  [S, 'HEAD treated like GET',
    'if (!route.methods.includes(req.method))', "if (!route.methods.includes(req.method === 'HEAD' ? 'GET' : req.method))"],
  [S, 'list ties broken by id instead of room order',
    'return byRoom !== 0 ? byRoom : a.id - b.id;', 'return byRoom === byRoom ? a.id - b.id : byRoom;'],
  [S, 'JSON replies lack the charset parameter',
    "const JSON_TYPE = 'application/json; charset=utf-8';", "const JSON_TYPE = 'application/json';"],
  [S, 'overlap checked outside the write queue (race)',
    '  const next = await repo.mutate((store) => {\n    const clash = findEarliestOverlap(store.bookings, fields);',
    '  const early = findEarliestOverlap(repo.current().bookings, fields);\n  const next = await repo.mutate((store) => {\n    const clash = early;'],
  [S, 'PORT 65535 rejected (< instead of <=)', 'port <= 65535 ? port : null', 'port < 65535 ? port : null'],
  [A, 'list fetch race not guarded', 'if (requestNumber !== latestListRequest) {', 'if (requestNumber !== requestNumber) {'],
  [A, 'Book re-enabled after the outcome is handled',
    "const reply = await send('/api/bookings', options, function () {\n      bookButton.disabled = false;\n    });",
    "const reply = await send('/api/bookings', options);\n    Promise.resolve().then(function () { bookButton.disabled = false; });"],
  [A, 'list text built with createTextNode',
    'item.append(bookingText(booking), cancelButton);',
    'item.append(document.createTextNode(bookingText(booking)), cancelButton);'],
  [A, 'list text set with innerHTML',
    'item.append(bookingText(booking), cancelButton);',
    'item.innerHTML = bookingText(booking);\n    item.append(cancelButton);'],
  [A, 'Show all fetches the list twice',
    "filterDate.value = '';\n    loadList();", "filterDate.value = '';\n    loadList();\n    loadList();"],
  [A, 'title trimmed before sending', 'title: titleInput.value,', 'title: titleInput.value.trim(),'],
  [A, 'POST header extended with a charset',
    "headers: { 'Content-Type': 'application/json' }", "headers: { 'Content-Type': 'application/json; charset=utf-8' }"],
  [H, 'script element has defer', '<script src="/app.js"></script>', '<script src="/app.js" defer></script>'],
  [H, 'Title label wraps its input',
    '<label for="title">Title</label>\n  <input type="text" id="title" name="title">',
    '<label for="title">Title<input type="text" id="title" name="title"></label>'],
  [A, 'cancel with no reply still refetches the list',
    "showError(NO_REPLY);\n      return;\n    }\n    showError(reply.status === 204",
    "showError(NO_REPLY);\n      loadList();\n      return;\n    }\n    showError(reply.status === 204"],
  [A, 'filter value percent-encoded in the list URL',
    "'/api/bookings?date=' + date", "'/api/bookings?date=' + encodeURIComponent(date)"],
  [A, 'input event on the filter also fetches the list',
    "filterDate.addEventListener('change', function () {\n    loadList();\n  });",
    "filterDate.addEventListener('change', function () {\n    loadList();\n  });\n  filterDate.addEventListener('input', function () {\n    loadList();\n  });"],
  [A, 'successful list fetch clears #error',
    'bookingList.replaceChildren(...items);', "bookingList.replaceChildren(...items);\n    showError('');"],
  [A, 'empty list renders no "No bookings." item', '? [createEmptyItem()]', '? []'],
  [S, 'stored title not trimmed', 'return { room: body.room, title, date', 'return { room: body.room, title: body.title, date'],
  [S, 'year 2100 accepted', 'year > 2099', 'year > 2100'],
  [S, 'time 24:00 accepted', '|2[0-3]):[0-5][0-9]$/', '|2[0-3]|24):[0-5][0-9]$/'],
  [S, 'missing data folder created on save',
    ["import { readFile, writeFile } from 'node:fs/promises';", '      await writeFile(filePath'],
    ["import { mkdir, readFile, writeFile } from 'node:fs/promises';",
      '      await mkdir(path.dirname(filePath), { recursive: true });\n      await writeFile(filePath']],
  [S, 'data file layout validated loosely',
    'return isValidStore(data) ? freezeStore(data) : null;',
    'return isPlainObject(data) && Array.isArray(data.bookings) ? freezeStore({ nextId: data.nextId ?? 1, bookings: data.bookings }) : null;'],
  [S, '/api/bookings/ routed like /api/bookings',
    "if (pathname === '/api/bookings') return", "if (pathname === '/api/bookings' || pathname === '/api/bookings/') return"],
  [S, 'a request rejected inside the queue (409, delete 404) still uses up an id',
    '      const next = freezeStore(change(store));\n',
    '      let next;\n      try { next = freezeStore(change(store)); } catch (err) {\n'
      + '        store = freezeStore({ ...store, nextId: store.nextId + 1 });\n        throw err;\n      }\n'],
];

function header(target, bug) {
  return target.endsWith('.html') ? `<!-- near-miss: ${bug} -->\n` : `// near-miss: ${bug}\n`;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const missing = [];
/** Applies each from->to pair once; returns the new text, or null when a pattern is not unique. */
function mutate(text, froms, tos) {
  let out = text;
  for (const [k, from] of froms.entries()) {
    if (out.split(from).length - 1 !== 1) return null;
    out = out.replace(from, () => tos[k]);
  }
  return out;
}

MUTANTS.forEach(([target, bug, from, to], i) => {
  const original = readFileSync(path.join(ROOT, target), 'utf8');
  const mutated = mutate(original, [from].flat(), [to].flat());
  if (mutated === null) {
    missing.push(`${i + 1} (${bug}): a pattern is missing or not unique`);
    return;
  }
  const name = `${i + 1}-${path.basename(target)}`;
  writeFileSync(path.join(OUT, name), header(target, bug) + mutated);
});
process.stdout.write(`made ${readdirSync(OUT).length} copies\n`);
if (missing.length > 0) {
  process.stderr.write(`${missing.join('\n')}\n`);
  process.exitCode = 1;
}
