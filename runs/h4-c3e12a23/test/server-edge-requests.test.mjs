// Requests Node's HTTP server would otherwise answer (or drop) by itself: CONNECT and unknown Expect values.
// Spec: every listed path answers an unlisted method with 405, every other path 404 "whatever the method",
// and the server reads the whole body before replying with the route's own reply.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { JSON_TYPE } from './helpers/server-harness.mjs';
import { MSG, useServer } from './helpers/api-assert.mjs';

const REPLY_TIMEOUT_MS = 2000;

/** Sends raw bytes and resolves { status, contentType, json } parsed from the reply; status 0 when none came. */
function rawExchange(port, text) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    const chunks = [];
    const timer = setTimeout(() => socket.destroy(), REPLY_TIMEOUT_MS);
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('error', reject);
    socket.on('close', () => {
      clearTimeout(timer);
      resolve(parseReply(Buffer.concat(chunks).toString('utf8')));
    });
  });
}

function parseReply(text) {
  const [head = '', body = ''] = text.split('\r\n\r\n');
  const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(head)?.[1] ?? 0);
  const contentType = /\r\ncontent-type: ([^\r]*)/i.exec(head)?.[1];
  return { status, contentType, body };
}

function assertJsonReply(reply, status, message) {
  assert.equal(reply.status, status);
  assert.equal(reply.contentType, JSON_TYPE);
  assert.deepEqual(JSON.parse(reply.body), { error: message });
}

describe('requests Node would handle by itself', () => {
  const ctx = useServer();

  it('CONNECT /api/rooms gets 405 method not allowed', async () => {
    const reply = await rawExchange(ctx.port, 'CONNECT /api/rooms HTTP/1.1\r\nHost: x\r\n\r\n');
    assertJsonReply(reply, 405, MSG.method);
  });

  it('CONNECT to an authority-form target gets 404 not found', async () => {
    const reply = await rawExchange(ctx.port, 'CONNECT 127.0.0.1:80 HTTP/1.1\r\nHost: 127.0.0.1:80\r\n\r\n');
    assertJsonReply(reply, 404, MSG.notFound);
  });

  it('an unknown Expect value still gets the route reply (415 here), not an automatic 417', async () => {
    const request = 'POST /api/bookings HTTP/1.1\r\nHost: x\r\nExpect: foo\r\nContent-Type: text/plain\r\n'
      + 'Content-Length: 2\r\nConnection: close\r\n\r\nhi';
    assertJsonReply(await rawExchange(ctx.port, request), 415, MSG.type);
  });

  it('the server still answers normally afterwards', async () => {
    const reply = await rawExchange(ctx.port, 'GET /api/rooms HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
    assert.equal(reply.status, 200);
    assert.deepEqual(JSON.parse(reply.body), { rooms: ['Aurora', 'Borealis', 'Cosmos'] });
  });
});
