// The tables of schema version 2, the contract with the other tools that use the file.
export const PARTS_V2 = `CREATE TABLE parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE
) STRICT;`

export const MOVES = `CREATE TABLE moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
  on_date TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty <> 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  note TEXT NOT NULL DEFAULT ''
) STRICT;`
