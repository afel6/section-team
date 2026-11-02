// Generates .team/near-miss/<n>-<file> copies, each with exactly one plausible bug.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');
const S = 'server.mjs';
const A = 'public/app.js';

const MISSES = [
  [S, 'overlap uses <= so touching bookings clash', [['b.start < end && start < b.end', 'b.start <= end && start <= b.end']]],
  [S, 'leap years use the century rule (2000-02-29 rejected)', [['year % 4 === 0 ? 29', 'year % 4 === 0 && year % 100 !== 0 ? 29']]],
  [S, 'Content-Type media type compared without case-folding', [["media.toLowerCase() === 'application/json'", "media === 'application/json'"]]],
  [S, '413 checked before 415', [[
    "  if (!isJsonContentType(headers['content-type'])) throw new RuleError(415, MSG.contentType);\n  if (body.size > MAX_BODY_BYTES) throw new RuleError(413, MSG.tooLarge);\n",
    "  if (body.size > MAX_BODY_BYTES) throw new RuleError(413, MSG.tooLarge);\n  if (!isJsonContentType(headers['content-type'])) throw new RuleError(415, MSG.contentType);\n"]]],
  [S, 'date trimmed before validation', [['if (!isValidDate(date)) throw', "if (!isValidDate(typeof date === 'string' ? date.trim() : date)) throw"]]],
  [S, 'path percent-decoded before routing', [['  if (mark === -1) return { path: target, query: \'\' };\n  return { path: target.slice(0, mark),', '  if (mark === -1) return { path: decodeURIComponent(target), query: \'\' };\n  return { path: decodeURIComponent(target.slice(0, mark)),']]],
  [A, 'list fetch without stale guard', [['if (sequence !== listSequence) {', 'if (sequence !== listSequence && false) {']]],
  [A, 'title trimmed in POST body', [['title: titleInput.value,', 'title: titleInput.value.trim(),']]],
  [A, 'Book re-enabled after the list refetch on 201', [
    ['    bookButton.disabled = false;\n    if (reply === null) {\n      showError(UNREACHABLE);', '    if (reply === null) {\n      bookButton.disabled = false;\n      showError(UNREACHABLE);'],
    ["    if (reply.status !== 201) {\n      showError", "    if (reply.status !== 201) {\n      bookButton.disabled = false;\n      showError"],
    ["    showError('');\n    loadList();\n  }\n\n  async function cancelBooking", "    showError('');\n    loadList();\n    bookButton.disabled = false;\n  }\n\n  async function cancelBooking"]]],
  [S, 'title length counted in code points', [['value.length >= 1 && value.length <= MAX_TITLE_LENGTH', '[...value].length >= 1 && [...value].length <= MAX_TITLE_LENGTH']]],
  [S, 'DELETE id parsed with Number()', [["/^[1-9][0-9]*$/.test(idText)\n      ? state.bookings.find((b) => String(b.id) === idText)", "idText !== ''\n      ? state.bookings.find((b) => b.id === Number(idText))"]]],
  [S, 'body size measured as decoded string length', [['if (body.size > MAX_BODY_BYTES)', "if (body.buffer.toString('utf8').length > MAX_BODY_BYTES)"]]],
  [S, 'data file rewritten at startup', [['  if (initial === null) return fail(`cannot read data file ${dataName}`);\n', '  if (initial === null) return fail(`cannot read data file ${dataName}`);\n  saveState(dataPath, initial).catch(() => undefined);\n']]],
  [S, 'memory updated before the save succeeds', [['      await saveState(path, next);\n      state = next;', '      state = next;\n      await saveState(path, next);']]],
  [S, '409 reports the first-created overlap, not the earliest-starting', [['\n    .reduce((earliest, b) => (earliest === undefined || b.start < earliest.start ? b : earliest), undefined);', '[0];']]],
  [A, 'filter value percent-encoded in the list URL', [["'/api/bookings?date=' + filter", "'/api/bookings?date=' + encodeURIComponent(filter)"]]],
  [A, 'cancel with no reply still refetches the list', [['      showError(UNREACHABLE);\n      return;\n    }\n    showError(reply.status === 204', '      showError(UNREACHABLE);\n      loadList();\n      return;\n    }\n    showError(reply.status === 204']]],
  [S, 'bookings sorted without the room key', [['const key = (b) => [b.date, b.start, ROOMS.indexOf(b.room)];', 'const key = (b) => [b.date, b.start];']]],
  [S, 'PORT parsed with Number() instead of digits only', [['if (!/^[0-9]+$/.test(raw)) return null;', 'if (!Number.isInteger(Number(raw)) || Number(raw) < 0) return null;']]],
  [S, 'repeated ?date uses the last value', [["const date = params.get('date');", "const date = params.getAll('date').at(-1);"]]],
  [A, 'list success clears #error', [['    renderList(bookings);\n  }', "    showError('');\n    renderList(bookings);\n  }"]]],
  [S, 'end == start accepted', [['if (end <= start) throw', 'if (end < start) throw']]],
];

function applyOnce(text, [from, to], label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: pattern matched ${count} times: ${from}`);
  return text.replace(from, () => to);
}

mkdirSync(new URL('.team/near-miss/', root), { recursive: true });
MISSES.forEach(([file, bug, edits], index) => {
  const label = `${index + 1}`;
  const body = edits.reduce((text, edit) => applyOnce(text, edit, label), read(file));
  const name = `${index + 1}-${file.split('/').pop()}`;
  writeFileSync(new URL(`.team/near-miss/${name}`, root), `// near-miss: ${bug}\n${body}`);
  process.stdout.write(`${name}\t${file}\n`);
});
