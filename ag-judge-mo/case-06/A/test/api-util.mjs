// Test-only fixture for the API test files: one server per describe block.
import assert from 'node:assert/strict';
import path from 'node:path';
import { startServer, makeTempDir, removeDir, request, postJson, JSON_CT } from './helpers.mjs';

export const NOT_FOUND = { error: 'not found' };
export const NOT_ALLOWED = { error: 'method not allowed' };
export const BAD_DATE = { error: 'date must be a valid YYYY-MM-DD date' };

export function fixture() {
  const state = { dir: null, server: null };
  const api = {
    get port() { return state.server.port; },
    get dataFile() { return path.join(state.dir, 'data.json'); },
    async start() {
      state.dir = await makeTempDir();
      state.server = await startServer({ env: { DATA_FILE: api.dataFile } });
    },
    async restart() {
      await state.server.stop();
      state.server = await startServer({ env: { DATA_FILE: api.dataFile } });
    },
    async stop() {
      try {
        if (state.server) await state.server.stop();
      } finally {
        if (state.dir) await removeDir(state.dir);
      }
    },
  };
  return api;
}

export function assertJson(res, status, expected) {
  assert.equal(res.status, status);
  assert.equal(res.headers['content-type'], JSON_CT);
  assert.deepEqual(res.json, expected);
}

export async function create(port, overrides) {
  const res = await postJson(port, {
    room: 'Aurora', title: 'Standup', date: '2026-11-03', start: '09:00', end: '10:00', ...overrides,
  });
  assert.equal(res.status, 201, res.text);
  return res.json;
}

export async function listBookings(port, query = '') {
  const res = await request(port, { path: `/api/bookings${query}` });
  assertJson(res, 200, res.json);
  return res.json.bookings;
}
