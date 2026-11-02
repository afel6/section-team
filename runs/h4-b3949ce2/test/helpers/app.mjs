// Shared setup for the app.js tests on the fake page.
import { flush, loadApp } from './fake-dom.mjs';

export const NO_REPLY = 'Could not reach the server.';
export const FAILED = 'Request failed.';
export const ROOM_NAMES = Object.freeze(['Aurora', 'Borealis', 'Cosmos']);

export const roomsCall = (page) => page.fetches.find((f) => f.url === '/api/rooms');
export const errorText = (page) => page.el('error').textContent;
export const listItems = (page) => page.el('booking-list').childNodes;

/** Loads the app, answers the rooms fetch and the first list fetch, and lets them settle. */
export async function boot({ rooms = ROOM_NAMES, bookings = [] } = {}) {
  const page = loadApp();
  roomsCall(page).reply(200, { rooms });
  page.listFetches()[0].reply(200, { bookings });
  await flush();
  return page;
}
