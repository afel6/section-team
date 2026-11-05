import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startModel } from './model-server.mjs';

const post = (url, body) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('answers a scripted reply', async () => {
  const m = await startModel({ script: () => ({ status: 201, body: { text: 'hi' } }) });
  try {
    const r = await post(m.url, '{}');
    assert.equal(r.status, 201);
    assert.deepEqual(await r.json(), { text: 'hi' });
  } finally { await m.close(); }
});

test('sends a string body as is, and defaults to 200 and an empty body', async () => {
  const m = await startModel({ script: (req) => (req.body === 'raw' ? { body: 'not json' } : {}) });
  try {
    assert.equal(await (await post(m.url, 'raw')).text(), 'not json');
    const r = await post(m.url, 'x');
    assert.equal(r.status, 200);
    assert.equal(await r.text(), '');
  } finally { await m.close(); }
});

test('records every call with method, headers, body and parsed json', async () => {
  const m = await startModel({ script: () => ({ body: { text: 'ok' } }) });
  try {
    await post(m.url, JSON.stringify({ messages: [1] }));
    await post(m.url, 'nope');
    assert.equal(m.calls.length, 2);
    assert.equal(m.calls[0].method, 'POST');
    assert.equal(m.calls[0].headers['content-type'], 'application/json');
    assert.equal(m.calls[0].body, '{"messages":[1]}');
    assert.deepEqual(m.calls[0].json, { messages: [1] });
    assert.equal(m.calls[1].json, undefined);
  } finally { await m.close(); }
});

test('a delayMs above the client limit lets the client time out', async () => {
  const m = await startModel({ script: () => ({ body: { text: 'late' }, delayMs: 400 }) });
  try {
    await assert.rejects(
      fetch(m.url, { method: 'POST', body: '{}', signal: AbortSignal.timeout(100) }),
      (e) => e.name === 'TimeoutError' || e.name === 'AbortError',
    );
    assert.equal(m.calls.length, 1);
  } finally { await m.close(); }
});

test('close does not hang on a pending delayed reply', async () => {
  const m = await startModel({ script: () => ({ delayMs: 5000 }) });
  fetch(m.url, { method: 'POST', body: '{}' }).catch(() => {});
  while (m.calls.length === 0) await new Promise((r) => setTimeout(r, 5));
  const t = Date.now();
  await m.close();
  assert.ok(Date.now() - t < 2000);
});

test('binds 127.0.0.1 and two servers run at once on different ports', async () => {
  const a = await startModel({ script: () => ({ body: { text: 'a' } }) });
  const b = await startModel({ script: () => ({ body: { text: 'b' } }) });
  try {
    const ua = new URL(a.url), ub = new URL(b.url);
    assert.equal(ua.hostname, '127.0.0.1');
    assert.notEqual(ua.port, ub.port);
    assert.deepEqual(await (await post(a.url, '{}')).json(), { text: 'a' });
    assert.deepEqual(await (await post(b.url, '{}')).json(), { text: 'b' });
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 1);
  } finally { await a.close(); await b.close(); }
});
