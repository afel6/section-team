// Field rules shared by routes: each tells whether a value is fine.
const inRange = (v, min, max) => typeof v === 'string' && v.length >= min && v.length <= max
const trimmedIn = (v, min, max) => typeof v === 'string' && inRange(v.trim(), min, max)

export const MESSAGES = {
  username: 'username must be 3 to 32 lowercase letters, digits or underscores',
  password: 'password must be 12 to 200 characters',
  role: 'role must be admin or member',
  title: 'title must be 1 to 120 characters',
  description: 'description must be 1 to 5000 characters',
  priority: 'priority must be low, normal or high',
  status: 'status must be open, pending or closed',
  text: 'text must be 1 to 2000 characters',
}

export const usernameOk = v => typeof v === 'string' && /^[a-z0-9_]{3,32}$/.test(v)
export const passwordOk = v => inRange(v, 12, 200)
export const roleOk = v => v === 'admin' || v === 'member'
export const titleOk = v => trimmedIn(v, 1, 120)
export const descriptionOk = v => trimmedIn(v, 1, 5000)
export const priorityOk = v => v === 'low' || v === 'normal' || v === 'high'
export const statusOk = v => v === 'open' || v === 'pending' || v === 'closed'
export const textOk = v => trimmedIn(v, 1, 2000)

export const has = (body, key) => Object.hasOwn(body, key)
export const MAX_ID = 2n ** 63n - 1n
// A number written in ASCII digits without a leading zero, as a BigInt; null for anything else.
export const positive = text => (typeof text === 'string' && /^[1-9][0-9]*$/.test(text) ? BigInt(text) : null)
