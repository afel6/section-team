import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadPage, makeReply, flush } from './fake-dom.mjs';

/** Absolute filesystem path of the page script under test. */
export const APP = fileURLToPath(new URL('../../public/app.js', import.meta.url));

/** Room names the fake /api/rooms endpoint answers with. */
export const ROOMS = ['Aurora', 'Borealis', 'Cosmos'];

/** Build a booking record for room Aurora on 2026-11-03; `extra` overrides any field. */
export function booking(id, title, extra = {}) {
  return { id, room: 'Aurora', title, date: '2026-11-03', start: '09:00', end: '10:00', ...extra };
}

/** Load the page, answer the rooms fetch and (unless answerList is false) the list fetch. */
export async function setup({ bookings = [booking(1, 'one')], answerList = true } = {}) {
  const page = loadPage(APP);
  assert.equal(page.calls[0].url, '/api/rooms');
  page.calls[0].reply(makeReply(200, { rooms: ROOMS }));
  if (answerList) page.calls[1].reply(makeReply(200, { bookings }));
  await flush();
  return page;
}

/** Dispatch a submit event on the booking form and return the event. */
export function submit(els) {
  return els['booking-form'].dispatch('submit');
}
