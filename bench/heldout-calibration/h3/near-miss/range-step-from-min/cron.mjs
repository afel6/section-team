// Reference solution for held-out task h3: a 5-field UTC cron library (parse, next).
// Built-ins only. parse() turns each field into a sorted list; next() walks minute by minute,
// skipping whole months, days and hours that cannot match, bounded at 5 years per search.

const MINUTE_MS = 60_000;
const SEARCH_YEARS = 5;
const MAX_RESULTS = 1000;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

// starMax is the upper end for `*` and `n/s`; max is the largest value a number or range end may take.
const FIELDS = [
  { key: 'minute', min: 0, max: 59, starMax: 59 },
  { key: 'hour', min: 0, max: 23, starMax: 23 },
  { key: 'dayOfMonth', min: 1, max: 31, starMax: 31 },
  { key: 'month', min: 1, max: 12, starMax: 12, names: new Map(MONTHS.map((n, i) => [n, i + 1])) },
  { key: 'dayOfWeek', min: 0, max: 7, starMax: 6, names: new Map(DAYS.map((n, i) => [n, i])) },
];

const ITEM_RE = /^(?:(\*)|([a-z0-9]+)(?:-([a-z0-9]+))?)(?:\/(\d+))?$/i;

function invalid(reason) {
  return new SyntaxError(`Invalid cron expression: ${reason}`);
}

function toValue(token, field) {
  const value = /^\d+$/.test(token) ? Number(token) : field.names?.get(token.toUpperCase());
  if (value === undefined || value < field.min || value > field.max) {
    throw invalid(`"${token}" is not a valid ${field.key} value`);
  }
  return value;
}

function itemBounds(star, first, last, stepped, field) {
  if (star) return [field.min, field.starMax];
  const start = toValue(first, field);
  if (last !== undefined) return [start, toValue(last, field)];
  return stepped ? [start, field.starMax] : [start, start];
}

function expandItem(item, field) {
  const match = ITEM_RE.exec(item);
  if (!match) throw invalid(`"${item}" is not a valid ${field.key} item`);
  const [, star, first, last, stepText] = match;
  const step = stepText === undefined ? 1 : Number(stepText);
  if (step < 1) throw invalid(`step in "${item}" must be at least 1`);
  const [low, high] = itemBounds(star, first, last, stepText !== undefined, field);
  if (low > high) throw invalid(`"${item}" is an empty ${field.key} range`);
  const values = [];
  const origin = last !== undefined ? field.min : low; // NEAR-MISS: a-b/s steps from the field minimum
  for (let v = origin; v <= high; v += step) if (v >= low) values.push(v);
  return values;
}

function parseField(text, field) {
  const values = text.split(',').flatMap((item) => expandItem(item, field));
  const normalized = field.key === 'dayOfWeek' ? values.map((v) => (v === 7 ? 0 : v)) : values;
  return [...new Set(normalized)].sort((a, b) => a - b);
}

function compile(expr) {
  const texts = expr.replace(/^ +| +$/g, '').split(/ +/);
  if (texts.length !== FIELDS.length) {
    throw invalid(`expected ${FIELDS.length} fields, got ${texts[0] === '' ? 0 : texts.length}`);
  }
  const lists = Object.fromEntries(FIELDS.map((field, i) => [field.key, parseField(texts[i], field)]));
  const sets = Object.fromEntries(Object.entries(lists).map(([key, list]) => [key, new Set(list)]));
  return { lists, sets, domRestricted: texts[2] !== '*', dowRestricted: texts[4] !== '*' };
}

export function parse(expr) {
  if (typeof expr !== 'string') throw new TypeError('expr must be a string');
  return compile(expr).lists;
}

function dayMatches(compiled, date) {
  const dom = compiled.sets.dayOfMonth.has(date.getUTCDate());
  const dow = compiled.sets.dayOfWeek.has(date.getUTCDay());
  if (compiled.domRestricted && compiled.dowRestricted) return dom || dow;
  if (compiled.domRestricted) return dom;
  if (compiled.dowRestricted) return dow;
  return true;
}

// setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999. Only fresh Dates are set.
function utcMs(year, month, day = 1, hour = 0) {
  const d = new Date(0);
  d.setUTCFullYear(year, month, day);
  return d.setUTCHours(hour, 0, 0, 0);
}

function addYears(ms, years) {
  const d = new Date(ms);
  return d.setUTCFullYear(d.getUTCFullYear() + years);
}

// First matching minute strictly after `after` (ms), within SEARCH_YEARS of it.
function findMatch(compiled, after) {
  const limit = addYears(after, SEARCH_YEARS);
  let t = Math.floor(after / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  while (t <= limit) {
    const d = new Date(t);
    const [y, mo, day, h] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()];
    if (!compiled.sets.month.has(mo + 1)) t = utcMs(y, mo + 1);
    else if (!dayMatches(compiled, d)) t = utcMs(y, mo, day + 1);
    else if (!compiled.sets.hour.has(h)) t = utcMs(y, mo, day, h + 1);
    else if (!compiled.sets.minute.has(d.getUTCMinutes())) t += MINUTE_MS;
    else return t;
  }
  throw new RangeError(`No match in the ${SEARCH_YEARS} years after ${new Date(after).toISOString()}`);
}

function checkArgs(expr, from, n) {
  if (typeof expr !== 'string') throw new TypeError('expr must be a string');
  if (!(from instanceof Date) || Number.isNaN(from.getTime())) {
    throw new TypeError('from must be a valid Date');
  }
  if (!Number.isInteger(n) || n < 1 || n > MAX_RESULTS) {
    throw new TypeError(`n must be an integer from 1 to ${MAX_RESULTS}`);
  }
}

export function next(expr, from, n = 1) {
  checkArgs(expr, from, n);
  const compiled = compile(expr);
  const results = [];
  let after = from.getTime();
  while (results.length < n) {
    after = findMatch(compiled, after);
    results.push(new Date(after));
  }
  return results;
}
