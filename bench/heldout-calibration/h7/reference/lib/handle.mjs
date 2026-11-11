// Handles: a short name for links, made from a part's name.
const MAX_BASE = 40
const FIRST_SUFFIX = 2

// The handle a name asks for, before any other part is considered.
export function baseHandle(name) {
  const plain = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const dashed = plain.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return dashed.slice(0, MAX_BASE).replace(/-+$/, '') || 'part'
}

// The smallest free handle for a name; isTaken says whether a handle is in use.
export function freeHandle(name, isTaken) {
  const base = baseHandle(name)
  if (!isTaken(base)) return base
  let suffix = FIRST_SUFFIX
  while (isTaken(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
