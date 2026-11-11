import { randomBytes } from 'node:crypto'
import { audit, inTransaction } from './db.mjs'
import { fail, sha256 } from './http.mjs'
import { hashPassword, verifyPassword } from './passwords.mjs'
import { MESSAGES, has, passwordOk, roleOk, usernameOk } from './rules.mjs'

const SESSION_MS = 8 * 60 * 60 * 1000
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5
const COOKIE_BASE = 'Path=/; HttpOnly; SameSite=Strict'

const publicUser = ({ id, username, role }) => ({ id, username, role })
const findUser = (db, id) => db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id)

function login({ db, now, body }) {
  const { username, password } = body
  if (typeof username !== 'string' || typeof password !== 'string') throw fail(400, 'username and password must be strings')
  const recent = db.prepare('SELECT count(*) AS n FROM login_failures WHERE username = ? AND at > ?').get(username, now - WINDOW_MS).n
  if (recent >= MAX_FAILURES) throw fail(429, 'too many login attempts')
  const user = db.prepare('SELECT id, username, role, password_hash FROM users WHERE username = ?').get(username)
  if (!user || !verifyPassword(password, user.password_hash)) {
    db.prepare('INSERT INTO login_failures (username, at) VALUES (?, ?)').run(username, now)
    throw fail(401, 'wrong username or password')
  }
  const token = randomBytes(32).toString('hex')
  inTransaction(db, () => {
    db.prepare('DELETE FROM login_failures WHERE username = ?').run(username)
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), user.id, now + SESSION_MS)
    audit(db, now, user.id, 'login', `user:${user.id}`)
  })
  return { status: 200, body: { user: publicUser(user) }, headers: { 'Set-Cookie': `sid=${token}; ${COOKIE_BASE}; Max-Age=28800` } }
}

function logout({ db, now, user, session }) {
  inTransaction(db, () => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash)
    audit(db, now, user.id, 'logout', `user:${user.id}`)
  })
  return { status: 204, headers: { 'Set-Cookie': `sid=; ${COOKIE_BASE}; Max-Age=0` } }
}

function createUser({ db, now, user, body }) {
  if (!usernameOk(body.username)) throw fail(400, MESSAGES.username)
  if (!passwordOk(body.password)) throw fail(400, MESSAGES.password)
  if (!roleOk(body.role)) throw fail(400, MESSAGES.role)
  const made = inTransaction(db, () => {
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(body.username)) throw fail(409, 'username already exists')
    const row = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING id, username, role')
      .get(body.username, hashPassword(body.password), body.role)
    audit(db, now, user.id, 'user.create', `user:${row.id}`)
    return row
  })
  return { status: 201, body: publicUser(made) }
}

function updateUser({ db, now, user, body, target }) {
  if (!has(body, 'password') && !has(body, 'role')) throw fail(400, 'nothing to change')
  if (has(body, 'password') && !passwordOk(body.password)) throw fail(400, MESSAGES.password)
  if (has(body, 'role') && !roleOk(body.role)) throw fail(400, MESSAGES.role)
  const changed = inTransaction(db, () => {
    if (has(body, 'password')) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), target.id)
    if (has(body, 'role')) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role, target.id)
    if (db.prepare("SELECT count(*) AS n FROM users WHERE role = 'admin'").get().n === 0) throw fail(409, 'cannot remove the last admin')
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
    audit(db, now, user.id, 'user.update', `user:${target.id}`)
    return findUser(db, target.id)
  })
  return { status: 200, body: publicUser(changed) }
}

const userTarget = { find: (db, id) => findUser(db, id), missing: 'user not found' }

export const accountRoutes = [
  { method: 'POST', path: /^\/api\/session$/, session: false, handler: login },
  { method: 'GET', path: /^\/api\/session$/, handler: ({ user }) => ({ status: 200, body: { user } }) },
  { method: 'DELETE', path: /^\/api\/session$/, handler: logout },
  {
    method: 'GET',
    path: /^\/api\/users$/,
    handler: ({ db }) => ({ status: 200, body: { users: db.prepare('SELECT id, username, role FROM users ORDER BY id').all().map(publicUser) } }),
  },
  { method: 'POST', path: /^\/api\/users$/, admin: true, handler: createUser },
  { method: 'PATCH', path: /^\/api\/users\/([^/]+)$/, admin: true, target: userTarget, handler: updateUser },
]
