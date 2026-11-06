import { SCHEMA, inTransaction, openDatabase } from './db.mjs'
import { hashPassword } from './passwords.mjs'

const DEFAULT_PORT = 3000
const MAX_PORT = 65535
const DEFAULT_DB = 'helpdesk.db'
const PASSWORD_MIN = 12
const PASSWORD_MAX = 200

export class StartupError extends Error {}

export function portOf(env) {
  const text = env.PORT ?? ''
  if (text === '') return DEFAULT_PORT
  if (!/^[0-9]+$/.test(text) || Number(text) > MAX_PORT) throw new StartupError('PORT must be a whole number from 0 to 65535')
  return Number(text)
}

// Opens the database and, when no user exists yet, creates the admin (and the schema of a new database) in one transaction.
export function prepareDatabase(env) {
  const name = env.DB_FILE ? env.DB_FILE : DEFAULT_DB
  const refused = new StartupError(`cannot open database ${name}`)
  let opened
  try {
    opened = openDatabase(name)
  } catch {
    throw refused
  }
  const { db, fresh, hasUsers } = opened
  if (hasUsers) return db
  const password = env.ADMIN_PASSWORD
  if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    db.close()
    throw new StartupError('ADMIN_PASSWORD must be 12 to 200 characters')
  }
  try {
    inTransaction(db, () => {
      if (fresh) db.exec(SCHEMA)
      db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', ?, 'admin')").run(hashPassword(password))
    })
  } catch {
    db.close()
    throw refused
  }
  return db
}
