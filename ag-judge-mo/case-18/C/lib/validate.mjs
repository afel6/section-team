// Input checks for request bodies and query strings. Each parser returns the clean value or throws a
// ValidationError, which the server turns into a 400 reply.

export class ValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ValidationError'
  }
}

const GROUP_ID = /^[a-z][a-z0-9-]{0,29}$/
const MEMBER_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,29}$/
const MIN_MEMBERS = 2
const MAX_MEMBERS = 20
const MAX_GROUP_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 200
const CENTS_PER_UNIT = 100
const MAX_AMOUNT_CENTS = 1_000_000 * CENTS_PER_UNIT
// Digits with at most two decimals, as String() writes a number: "12", "12.5", "4.35".
const TWO_DECIMALS = /^[0-9]+(\.[0-9]{1,2})?$/

const AMOUNT_MESSAGE = 'amount must be a number from 0.01 to 1000000 with at most 2 decimals'
const SPLIT_MESSAGE = 'split must be a non-empty list of different members of the group'

const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max

export function parseGroupId(v) {
  if (typeof v !== 'string' || !GROUP_ID.test(v)) {
    throw new ValidationError('id must be 1 to 30 characters of a-z, 0-9 or -, starting with a letter')
  }
  return v
}

export function parseGroupName(v) {
  if (!isText(v, MAX_GROUP_NAME_LENGTH)) {
    throw new ValidationError(`name must be a non-empty string of at most ${MAX_GROUP_NAME_LENGTH} characters`)
  }
  return v
}

// A list of 2 to 20 member names, each used once. Names are case-sensitive: "Ann" and "ann" are two people.
export function parseMembers(v) {
  if (!Array.isArray(v) || v.length < MIN_MEMBERS || v.length > MAX_MEMBERS) {
    throw new ValidationError(`members must be an array of ${MIN_MEMBERS} to ${MAX_MEMBERS} names`)
  }
  if (!v.every(name => typeof name === 'string' && MEMBER_NAME.test(name))) {
    throw new ValidationError('member names must be 1 to 30 characters of A-Z, a-z, 0-9, _ or -, starting with a letter')
  }
  if (new Set(v).size !== v.length) throw new ValidationError('members must not repeat a name')
  return [...v]
}

export function parseDescription(v) {
  if (!isText(v, MAX_DESCRIPTION_LENGTH)) {
    throw new ValidationError(`description must be a non-empty string of at most ${MAX_DESCRIPTION_LENGTH} characters`)
  }
  return v
}

// Amounts arrive as numbers such as 12.5 or 4.35 and are kept as whole cents, so sums never drift.
export function parseAmount(v) {
  if (typeof v !== 'number' || !TWO_DECIMALS.test(String(v))) throw new ValidationError(AMOUNT_MESSAGE)
  // Math.round, not Math.trunc: 4.35 * 100 is 434.99999999999994 in floating point.
  const cents = Math.round(v * CENTS_PER_UNIT)
  if (cents < 1 || cents > MAX_AMOUNT_CENTS) throw new ValidationError(AMOUNT_MESSAGE)
  return cents
}

// A name that must belong to one of members; message says which field was wrong.
export function parseMember(v, members, message) {
  if (typeof v !== 'string' || !members.includes(v)) throw new ValidationError(message)
  return v
}

// Who shares an expense: a non-empty list of members without repeats. Missing means every member, in group order.
export function parseSplit(v, members) {
  if (v === undefined) return [...members]
  if (!Array.isArray(v) || v.length === 0 || new Set(v).size !== v.length) throw new ValidationError(SPLIT_MESSAGE)
  if (!v.every(name => typeof name === 'string' && members.includes(name))) throw new ValidationError(SPLIT_MESSAGE)
  return [...v]
}
