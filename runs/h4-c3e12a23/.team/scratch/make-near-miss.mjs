// Generates .team/near-miss/<n>-server.mjs and <n>-app.js from the current originals.
// Each entry: [file, bug description, from, to]. `from` must occur exactly once.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, '.team', 'near-miss');
const S = 'server.mjs';
const A = 'public/app.js';

const PATCHES = [
  [S, 'overlap uses <= so touching bookings clash',
    'b.start < candidate.end && candidate.start < b.end', 'b.start <= candidate.end && candidate.start <= b.end'],
  [S, 'February has 29 days every year',
    "if (month === 2) return year % 4 === 0 ? 29 : 28;", 'if (month === 2) return 29;'],
  [S, 'February never has 29 days',
    "if (month === 2) return year % 4 === 0 ? 29 : 28;", 'if (month === 2) return 28;'],
  [S, 'year 2100 accepted (range off by one)', 'year > 2099', 'year > 2100'],
  [S, 'year 2000 rejected (range off by one)', 'year < 2000', 'year < 2001'],
  [S, 'title trimmed with trimStart instead of trim', 'rawTitle.trim()', 'rawTitle.trimStart()'],
  [S, 'title length counted in code points', 'title.length < 1 || title.length > MAX_TITLE_LENGTH',
    '[...title].length < 1 || [...title].length > MAX_TITLE_LENGTH'],
  [S, 'content-type compared case-sensitively', ".replace(/^[ \\t]+|[ \\t]+$/g, '').toLowerCase();",
    ".replace(/^[ \\t]+|[ \\t]+$/g, '');"],
  [S, 'content-type padding removed with trim() (strips all unicode whitespace)',
    ".replace(/^[ \\t]+|[ \\t]+$/g, '').toLowerCase();", '.trim().toLowerCase();'],
  [S, '413 checked before 415',
    "    if (mediaType(req.headers['content-type']) !== 'application/json') {\n      throw new HttpError(415, MSG.contentType);\n    }\n    if (body.size > MAX_BODY_BYTES) throw new HttpError(413, MSG.tooLarge);",
    "    if (body.size > MAX_BODY_BYTES) throw new HttpError(413, MSG.tooLarge);\n    if (mediaType(req.headers['content-type']) !== 'application/json') {\n      throw new HttpError(415, MSG.contentType);\n    }"],
  [S, 'body of exactly 10000 bytes rejected (>= instead of >)', 'if (body.size > MAX_BODY_BYTES) throw',
    'if (body.size >= MAX_BODY_BYTES) throw'],
  [S, 'body size counted in characters instead of bytes',
    'size += chunk.length;', "size += chunk.toString('utf8').length;"],
  [S, 'leading-zero DELETE id accepted', '/^[1-9][0-9]*$/.test(idText)', '/^[0-9]+$/.test(idText)'],
  [S, 'DELETE id parsed with parseInt (accepts 1abc, 1.0)',
    "const id = /^[1-9][0-9]*$/.test(idText) ? Number(idText) : NaN;", 'const id = Number.parseInt(idText, 10);'],
  [S, 'last date parameter used when repeated', "const date = params.get('date');",
    "const date = params.getAll('date').at(-1);"],
  [S, '?date without = is ignored (truthiness check)', "if (params.has('date')) {", "if (params.get('date')) {"],
  [S, 'query not percent-decoded (regex on raw query)', "const date = params.get('date');",
    "const date = (/(?:^|&)date=?([^&]*)/.exec(query) || [])[1] ?? '';"],
  [S, 'sort missing room tiebreak', 'return ROOMS.indexOf(a.room) - ROOMS.indexOf(b.room);', 'return 0;'],
  [S, '409 names the first-inserted overlapping booking, not the earliest-starting',
    '(first === null || b.start < first.start ? b : first)', '(first === null ? b : first)'],
  [S, 'nextId advanced before the save (no rollback on failure)',
    'const booking = { id: state.nextId, ...fields };\n      await commit({ nextId: state.nextId + 1,',
    'const booking = { id: state.nextId, ...fields };\n      state = freezeState({ nextId: state.nextId + 1, bookings: state.bookings });\n      await commit({ nextId: state.nextId,'],
  [S, 'booking removed from memory before the save (no rollback on failed DELETE)',
    'await commit({ nextId: state.nextId, bookings: state.bookings.filter((b) => b.id !== id) });',
    'state = freezeState({ nextId: state.nextId, bookings: state.bookings.filter((b) => b.id !== id) });\n      await commit(state);'],
  [S, 'save not awaited: 201 sent before the save finishes',
    '      await commit({ nextId: state.nextId + 1, bookings: [...state.bookings, booking] });',
    '      commit({ nextId: state.nextId + 1, bookings: [...state.bookings, booking] }).catch(() => {});'],
  [S, 'PORT validated with Number() (accepts +1, 1e3, spaces)', "if (!/^[0-9]+$/.test(raw)) return null;",
    'if (!Number.isInteger(Number(raw)) || Number(raw) < 0) return null;'],
  [S, 'PORT 65535 rejected (< instead of <=)', 'return port <= MAX_PORT ? port : null;', 'return port < MAX_PORT ? port : null;'],
  [S, 'data file read before PORT is checked',
    "  const port = parsePort(process.env.PORT);\n  if (port === null) return failStartup(`invalid PORT: ${JSON.stringify(process.env.PORT)}`);\n  const dataName = process.env.DATA_FILE || DEFAULT_DATA_FILE;\n  const dataPath = path.resolve(process.cwd(), dataName);\n  const state = loadState(dataPath);\n  if (state === null) return failStartup(`cannot read data file ${dataName}`);",
    "  const dataName = process.env.DATA_FILE || DEFAULT_DATA_FILE;\n  const dataPath = path.resolve(process.cwd(), dataName);\n  const state = loadState(dataPath);\n  if (state === null) return failStartup(`cannot read data file ${dataName}`);\n  const port = parsePort(process.env.PORT);\n  if (port === null) return failStartup(`invalid PORT: ${JSON.stringify(process.env.PORT)}`);"],
  [S, 'relative DATA_FILE resolved against the folder of server.mjs',
    'const dataPath = path.resolve(process.cwd(), dataName);', 'const dataPath = path.resolve(PUBLIC_DIR, \'..\', dataName);'],
  [S, 'loader accepts duplicate ids',
    '  if (new Set(data.bookings.map((b) => b.id)).size !== data.bookings.length) return null;\n', ''],
  [S, 'loader accepts a booking id >= nextId', 'b.id >= nextId', 'b.id > nextId'],
  [S, 'every read error treated as ENOENT', "if (err.code === 'ENOENT') return", 'if (err.code) return'],
  [S, '/api/bookings/ (empty id) routed to DELETE', "if (id === '' || id.includes('/')) return null;",
    "if (id.includes('/')) return null;"],
  [S, 'HEAD allowed on GET routes', "if (!Object.hasOwn(handlers, req.method)) return",
    "if (req.method === 'HEAD' && handlers.GET) return handlers.GET();\n    if (!Object.hasOwn(handlers, req.method)) return"],
  [S, 'route paths compared case-insensitively', 'const handlers = route(pathName, query',
    'const handlers = route(pathName.toLowerCase(), query'],
  [A, 'filter value URL-encoded', '`/api/bookings?date=${filter}`', '`/api/bookings?date=${encodeURIComponent(filter)}`'],
  [A, 'Book re-enabled after the list refetch starts',
    "    bookButton.disabled = false;\n    if (result === null || !result.ok) {\n      showOutcomeError(result);\n      return;\n    }\n    titleInput.value = '';\n    showError('');\n    loadList();",
    "    if (result === null || !result.ok) {\n      bookButton.disabled = false;\n      showOutcomeError(result);\n      return;\n    }\n    titleInput.value = '';\n    showError('');\n    loadList();\n    bookButton.disabled = false;"],
  [A, 'no generation check on list fetches', '    if (generation !== listGeneration) {\n      return;\n    }\n', ''],
  [A, 'generation check only on success (earlier errors still shown)',
    "    if (generation !== listGeneration) {\n      return;\n    }\n    if (result === null || !result.ok) {\n      showOutcomeError(result);\n      return;\n    }",
    "    if (result === null || !result.ok) {\n      showOutcomeError(result);\n      return;\n    }\n    if (generation !== listGeneration) {\n      return;\n    }"],
  [A, 'all form fields cleared on 201', "    titleInput.value = '';\n    showError('');",
    "    titleInput.value = '';\n    dateInput.value = '';\n    startInput.value = '';\n    endInput.value = '';\n    showError('');"],
  [A, 'list refetched after DELETE with no reply', '    if (result === null) {\n      showError(NO_REPLY);\n      return;\n    }',
    '    if (result === null) {\n      showError(NO_REPLY);\n      loadList();\n      return;\n    }'],
  [A, 'title trimmed before sending', 'title: titleInput.value,', 'title: titleInput.value.trim(),'],
  [A, 'any 2xx status treated as success', 'ok: reply.status === SUCCESS_STATUS[method]', 'ok: reply.status >= 200 && reply.status < 300'],
  [A, 'json() read on 204 replies too', 'reply.status === 204 ? undefined : await reply.json()', 'await reply.json()'],
  [A, 'submit while disabled does not call preventDefault',
    '    event.preventDefault();\n    if (bookButton.disabled) {\n      return;\n    }',
    '    if (bookButton.disabled) {\n      return;\n    }\n    event.preventDefault();'],
  [A, 'Cancel button not re-enabled when the request gets no reply',
    "    button.disabled = false;\n    if (result === null) {\n      showError(NO_REPLY);\n      return;\n    }",
    "    if (result === null) {\n      showError(NO_REPLY);\n      return;\n    }\n    button.disabled = false;"],
  [A, 'Show all does not clear the filter', "    filterDate.value = '';\n    loadList();", '    loadList();'],
  [A, 'list error body without string error shows raw status text',
    "return isPlainObject(body) && typeof body.error === 'string' ? body.error : FALLBACK_ERROR;",
    "return isPlainObject(body) && body.error !== undefined ? String(body.error) : FALLBACK_ERROR;"],
];

fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.rmSync(path.join(OUT, f));
const counts = { [S]: 0, [A]: 0 };
PATCHES.forEach(([file, bug, from, to], i) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const parts = src.split(from);
  if (parts.length !== 2) throw new Error(`patch ${i + 1} (${bug}): found ${parts.length - 1} matches`);
  counts[file] += 1;
  const n = String(i + 1).padStart(2, '0');
  fs.writeFileSync(path.join(OUT, `${n}-${path.basename(file)}`), `// near-miss: ${bug}\n${parts.join(to)}`);
});
process.stdout.write(`server: ${counts[S]}, app: ${counts[A]}\n`);
