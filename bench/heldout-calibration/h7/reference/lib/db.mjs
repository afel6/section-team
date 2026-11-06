// The database: the file's schema, its transactions, and how a lock shows up.
import { DatabaseSync } from 'node:sqlite'
import { migrateToV2 } from './migrate.mjs'
import { MOVES, PARTS_V2 } from './schema.mjs'

const WAIT_FOR_LOCK_MS = 3000
const OLD_VERSION = 1
const VERSION = 2
const SCHEMA = `${PARTS_V2}\n${MOVES}\nPRAGMA user_version = ${VERSION};`
const SQLITE_BUSY = 5
const SQLITE_LOCKED = 6
const PRIMARY_CODE = 256

export const isBusy = err => [SQLITE_BUSY, SQLITE_LOCKED].includes((err?.errcode ?? 0) % PRIMARY_CODE)

// A migration that failed, as opposed to a database that could not be used at all.
export class MigrationFailed extends Error {}

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

function migrate(db) {
  try {
    migrateToV2(db, inTransaction)
  } catch (err) {
    throw new MigrationFailed(err.message, { cause: err })
  }
}

function prepareSchema(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version
  const { tables } = db.prepare('SELECT count(*) AS tables FROM sqlite_master').get()
  if (version === 0 && tables === 0) return inTransaction(db, () => db.exec(SCHEMA))
  if (version === OLD_VERSION) return migrate(db)
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
