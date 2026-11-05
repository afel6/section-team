// Fake model server for p1's hidden tests. Binds 127.0.0.1 on port 0; pass `url` to the server under test as MODEL_URL.
// script(req) -> { status = 200, body = '', delayMs = 0 }; req = { method, url, headers, body, json }.
// A non-string body is sent as JSON. `json` is the parsed body, or undefined when it does not parse.
import { createServer } from 'node:http';

export async function startModel({ script }) {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let json;
      try { json = JSON.parse(body); } catch { /* not JSON: json stays undefined */ }
      const call = { method: req.method, url: req.url, headers: req.headers, body, json };
      calls.push(call);
      const { status = 200, body: out = '', delayMs = 0 } = script(call) ?? {};
      const payload = typeof out === 'string' ? out : JSON.stringify(out);
      const timer = setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(payload);
      }, delayMs);
      res.on('close', () => clearTimeout(timer));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    calls,
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
