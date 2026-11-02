---
name: probe-raw-sockets
description: Black-box HTTP probing of Node servers with raw net sockets — do not half-close, or async replies look like server bugs
metadata:
  type: feedback
---

When probing a Node http server with raw `net` sockets, send `Connection: close` and never call `socket.end()` after writing. Node's server ends the socket on client FIN, so any reply produced after an await (readFile, writeFile) is lost and looks like a server bug. Also decode the reply as utf8, not latin1, before checking JSON strings.

**Why:** on 2026-11-02 this caused about 12 false FAILs in the h4 final review, and they cost a debugging round.
**How to apply:** use it in every final-review probe script; write the probe scripts outside the repo (for example /tmp/probe-*).
