import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

export const SCHEMA = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member'))
) STRICT;
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
) STRICT;
CREATE TABLE login_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'pending', 'closed')),
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  target TEXT NOT NULL
) STRICT;
PRAGMA user_version = 1;
`

export const BUSY_MS = 0

// Opens the file and says whether it is a new database (version 0, no tables) or a version 1 one. Anything else throws.
export function openDatabase(name) {
  const db = new DatabaseSync(resolve(name))
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_MS}`)
    const version = db.prepare('PRAGMA user_version').get().user_version
    if (version === 1) return { db, fresh: false, hasUsers: db.prepare('SELECT 1 FROM users LIMIT 1').get() !== undefined }
    const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get().n
    if (version !== 0 || tables > 0) throw new Error('not a help desk database')
    return { db, fresh: true, hasUsers: false }
  } catch (e) {
    db.close()
    throw e
  }
}

// Runs fn in one write transaction: all of it or none of it.
export function inTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw e
  }
}

export const isBusy = e => e?.code === 'ERR_SQLITE_ERROR' && ((e.errcode ?? 0) & 0xff) === 5

export function audit(db, now, userId, action, target) {
  db.prepare('INSERT INTO audit (at, user_id, action, target) VALUES (?, ?, ?, ?)').run(now, userId, action, target)
}
