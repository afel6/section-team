// Helpers shared by the page test files (page.test.mjs, page-booking.test.mjs).
import assert from 'node:assert/strict';
import { loadPage, reply, flush, okScript, ROOMS } from './fake-dom.mjs';

export const NO_REPLY = 'Could not reach the server.';
export const FAILED = 'Request failed.';
const URL_RE = /^\/api\/(rooms|bookings(\?date=.*|\/\d+)?)$/;
const ALLOWED_OPTION_KEYS = new Set(['method', 'headers', 'body']);

// Rooms answer at once, every other request stays pending until the test settles it.
export const roomsOnly = (call) => (call.url === '/api/rooms' ? reply(200, { rooms: ROOMS }) : undefined);

// Rooms and the first list answer at once; later requests stay pending.
export const firstListOnly = (bookings) => (call) => (call.index < 2 ? okScript(bookings)(call) : undefined);

export async function boot(script = okScript()) {
  const page = loadPage(script);
  page.run();
  await flush();
  return page;
}

// Every test ends here: no API outside the allow-list was touched, only path-only URLs used.
export function done(page) {
  assert.deepEqual(page.violations, []);
  for (const url of page.urls()) assert.match(url, URL_RE);
}

export const rowTexts = (page) => page.els['booking-list'].children.map(
  (item) => item.children.map((child) => (child.nodeType === 3 ? child.data : child.tagName)),
);
export const listText = (page) => page.els['booking-list'].children.map((item) => item.children[0].data);
export const method = (call) => (call.options ? call.options.method : 'GET');
export const lastCall = (page) => page.calls[page.calls.length - 1];

export function fill(page, over = {}) {
  const values = { room: 'Borealis', title: 'Retro', date: '2026-11-03', start: '09:00', end: '10:00', ...over };
  for (const [id, value] of Object.entries(values)) page.els[id].value = value;
  return values;
}

export const submit = (page) => page.dispatch(page.els['booking-form'], 'submit');

// The options object of a fetch call has only the keys method, headers and body, and the expected method.
// A GET may also be sent without options at all.
export function assertFetchOptions(call, expectedMethod) {
  if (call.options === undefined && expectedMethod === 'GET') return;
  assert.ok(call.options !== undefined && call.options !== null, `${call.url} has options`);
  for (const key of Object.keys(call.options)) {
    assert.ok(ALLOWED_OPTION_KEYS.has(key), `unexpected fetch option ${key}`);
  }
  assert.equal(call.options.method, expectedMethod);
}
