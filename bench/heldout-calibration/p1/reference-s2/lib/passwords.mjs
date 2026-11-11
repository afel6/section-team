import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64
const SALT_LENGTH = 16

export function hashPassword(password) {
  const salt = randomBytes(SALT_LENGTH)
  return `scrypt$${salt.toString('hex')}$${scryptSync(Buffer.from(password, 'utf8'), salt, KEY_LENGTH).toString('hex')}`
}

export function verifyPassword(password, stored) {
  const m = /^scrypt\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(stored)
  if (!m) return false
  const key = scryptSync(Buffer.from(password, 'utf8'), Buffer.from(m[1], 'hex'), KEY_LENGTH)
  return timingSafeEqual(key, Buffer.from(m[2], 'hex'))
}
