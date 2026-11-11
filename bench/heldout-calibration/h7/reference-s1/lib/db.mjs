// The database: the file's schema, its transactions, and how a lock shows up.
import { DatabaseSync } from 'node:sqlite'

const WAIT_FOR_LOCK_MS = 3000
const VERSION = 1
const SCHEMA = `
CREATE TABLE parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
) STRICT;
CREATE TABLE moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  on_date TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  note TEXT NOT NULL DEFAULT ''
) STRICT;
PRAGMA user_version = ${VERSION};
`
const SQLITE_BUSY = 5
const SQLITE_LOCKED = 6
const PRIMARY_CODE = 256

export const isBusy = err => [SQLITE_BUSY, SQLITE_LOCKED].includes((err?.errcode ?? 0) % PRIMARY_CODE)

// Runs work inside one write transaction: everything it did stays, or none of it.
export function inTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw err
  }
}

function prepareSchema(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version
  const { tables } = db.prepare('SELECT count(*) AS tables FROM sqlite_master').get()
  if (version === 0 && tables === 0) return inTransaction(db, () => db.exec(SCHEMA))
  if (version !== VERSION) throw new Error(`database version ${version}`)
}

// The open database, its schema in place. Anything it cannot use throws, with the file unchanged.
export function openDatabase(file) {
  const db = new DatabaseSync(file, { timeout: WAIT_FOR_LOCK_MS })
  try {
    prepareSchema(db)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}
