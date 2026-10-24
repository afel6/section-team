Build a small URL-shortener web app in this repository. Use only Node.js 26 built-ins: node:http for the server and node:sqlite (DatabaseSync) for storage. No npm packages.

Server
- Entry point `server.mjs`. Running `node server.mjs` listens on the environment variable PORT (default 3000), stores data in the SQLite file at env DB_FILE (default `./data.db`), and creates its tables on start. Once it is ready to accept requests it prints `listening on <port>` to stdout.
- All JSON responses use Content-Type `application/json`.

API
- POST /api/links with a JSON body {"url": string, "code"?: string}
  - The request Content-Type must be application/json, otherwise 415 {"error": "..."}. A body larger than 10 KB → 413. Invalid JSON → 400.
  - url must be an absolute http:// or https:// URL of at most 2048 characters, otherwise 400 {"error": "..."}.
  - code (optional) must match ^[A-Za-z0-9_-]{3,32}$, otherwise 400; if it is already taken → 409 {"error": "..."}.
  - Without a code, generate a random 7-character code from [A-Za-z0-9] that is not taken.
  - Success → 201 {"code", "url", "short"} where short is `http://localhost:<PORT>/<code>`.
  - Rate limit: at most 20 POST /api/links requests per client IP in any rolling 60 seconds (every POST counts, including rejected ones); the 21st → 429 {"error": "..."}.
- GET /api/links/<code> → 200 {"code", "url", "clicks", "createdAt"} where clicks is a number and createdAt an ISO-8601 string; unknown code → 404 {"error": "..."}.
- DELETE /api/links/<code> requires the header `X-Admin-Token` equal to env ADMIN_TOKEN (if ADMIN_TOKEN is unset, every DELETE is 401). A wrong or missing token → 401; unknown code → 404; success → 204 with no body.
- GET /<code> (a single path segment matching the code pattern) → 302 with Location set to the stored url, and clicks increases by 1; unknown → 404.

Frontend
- GET / serves `public/index.html` (Content-Type text/html): a page with a form to shorten a URL (an input with name="url") and a form to look up a code's stats. Its JavaScript calls the API with fetch and shows the result. Any user-provided or API-provided text shown on the page must be inserted with textContent, never with innerHTML.
- Other files under public/ are served at their paths (for example /app.js) with sensible content types.

Quality
- Tests with node:test (`npm test`) covering the API and the frontend's fetch logic, a `package.json` ("type": "module" and a "test" script), and a README explaining how to run, configure and test it.
