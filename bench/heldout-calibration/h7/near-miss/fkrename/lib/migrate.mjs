// The migration from schema version 1 to 2: `parts` is rebuilt, because SQLite cannot add a NOT NULL UNIQUE column.
import { firstDip } from './balance.mjs'
import { freeHandle } from './handle.mjs'
import { PARTS_V2 } from './schema.mjs'

const PARTS_NEW = PARTS_V2.replace('CREATE TABLE parts', 'CREATE TABLE parts_new')

function checkMoves(db) {
  if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('a move points to no part')
  const moves = db.prepare('SELECT part_id, on_date, qty FROM moves ORDER BY part_id, on_date, id').all()
  const byPart = Map.groupBy(moves, move => move.part_id)
  for (const partMoves of byPart.values()) {
    if (firstDip(partMoves) !== null) throw new Error('a running balance goes below zero')
  }
}

// Dropping parts takes its indexes and triggers along, other tools' ones included: they are made again from their own SQL.
const objectsOnParts = db => db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'parts' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all().map(row => row.sql)

// One transaction: copied parts get their handles in id order, and the id sequence survives the rebuild.
function rebuildParts(db) {
  checkMoves(db)
  const objects = objectsOnParts(db)
  const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'parts'").get()
  db.exec('ALTER TABLE parts RENAME TO parts_old')
  db.exec(PARTS_V2)
  const taken = new Set()
  const insert = db.prepare('INSERT INTO parts (id, sku, name, handle) VALUES (?, ?, ?, ?)')
  for (const part of db.prepare('SELECT * FROM parts_old ORDER BY id').all()) {
    const handle = freeHandle(part.name, candidate => taken.has(candidate))
    taken.add(handle)
    insert.run(part.id, part.sku, part.name, handle)
  }
  db.exec('DROP TABLE parts_old')
  for (const sql of objects) db.exec(sql)
  if (sequence) {
    db.prepare("DELETE FROM sqlite_sequence WHERE name = 'parts'").run()
    db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('parts', ?)").run(sequence.seq)
  }
  db.exec('PRAGMA user_version = 2')
}

// foreign_keys only changes outside a transaction. With it on, DROP TABLE parts would cascade into every move.
// legacy_alter_table lets the rename go ahead while another tool's view names the table that was just dropped.
export function migrateToV2(db, inTransaction) {
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    inTransaction(db, () => rebuildParts(db))
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}
