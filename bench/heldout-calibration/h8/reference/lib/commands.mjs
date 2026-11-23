// The commands. Each takes the store and the parsed words and returns { store?, lines }: a new store when
// something changed (the old one is never modified) and the lines to print.
import { noPositional, onePositional } from './args.mjs'
import { formatLoan, sortLoans } from './format.mjs'
import { UserError, parseDate, parseItem, parseNumber, parsePerson } from './rules.mjs'

const given = value => value !== undefined

function indexOfLoan(store, positional) {
  const number = parseNumber(onePositional(positional))
  const index = store.loans.findIndex(loan => loan.number === number)
  if (index < 0) throw new UserError(`no loan #${number}`)
  return index
}

const withLoan = (store, index, loan) => ({ ...store, loans: store.loans.with(index, loan) })

function add(store, { positional, options }) {
  const item = parseItem(positional.join(' '))
  if (!given(options['--to'])) throw new UserError('--to is required')
  const person = parsePerson(options['--to'])
  const due = given(options['--due']) ? parseDate(options['--due']) : null
  const number = store.nextNumber
  const loan = { number, item, person, due, returned: false }
  return { store: { ...store, nextNumber: number + 1, loans: [...store.loans, loan] }, lines: [`added #${number}`] }
}

function list(store, { positional, options }) {
  noPositional(positional)
  const person = given(options['--to']) ? parsePerson(options['--to']) : null
  const before = given(options['--due-before']) ? parseDate(options['--due-before']) : null
  const shown = sortLoans(store.loans).filter(loan =>
    (options['--all'] || !loan.returned) &&
    (person === null || loan.person === person) &&
    (before === null || (loan.due !== null && loan.due < before)))
  return { lines: shown.length > 0 ? shown.map(formatLoan) : ['no loans'] }
}

function back(store, { positional }) {
  const index = indexOfLoan(store, positional)
  const loan = store.loans[index]
  if (loan.returned) throw new UserError(`loan #${loan.number} is already returned`)
  return { store: withLoan(store, index, { ...loan, returned: true }), lines: [`returned #${loan.number}`] }
}

function edit(store, { positional, options }) {
  const index = indexOfLoan(store, positional)
  const loan = store.loans[index]
  if (given(options['--due']) && options['--no-due']) throw new UserError('--due and --no-due cannot be used together')
  const changes = {
    ...(given(options['--item']) && { item: parseItem(options['--item']) }),
    ...(given(options['--to']) && { person: parsePerson(options['--to']) }),
    ...(given(options['--due']) && { due: parseDate(options['--due']) }),
    ...(options['--no-due'] && { due: null }),
  }
  if (Object.keys(changes).length === 0) throw new UserError('nothing to change')
  return { store: withLoan(store, index, { ...loan, ...changes }), lines: [`updated #${loan.number}`] }
}

function remove(store, { positional }) {
  const index = indexOfLoan(store, positional)
  const { number } = store.loans[index]
  return { store: { ...store, loans: store.loans.toSpliced(index, 1) }, lines: [`removed #${number}`] }
}

function show(store, { positional }) {
  const loan = store.loans[indexOfLoan(store, positional)]
  return {
    lines: [
      `loan #${loan.number}`,
      `item: ${loan.item}`,
      `to: ${loan.person}`,
      `due: ${loan.due ?? '-'}`,
      `returned: ${loan.returned ? 'yes' : 'no'}`,
    ],
  }
}

// Gives every loan of one person (returned ones too) to another name, for a typo or a nickname.
function rename(store, { positional, options }) {
  if (positional.length !== 1) throw new UserError('expected one person')
  const from = parsePerson(positional[0])
  if (!given(options['--to'])) throw new UserError('--to is required')
  const to = parsePerson(options['--to'])
  const count = store.loans.filter(loan => loan.person === from).length
  if (count === 0) throw new UserError(`nobody called ${from}`)
  const loans = store.loans.map(loan => (loan.person === from ? { ...loan, person: to } : loan))
  return { store: { ...store, loans }, lines: [`renamed ${count} ${count === 1 ? 'loan' : 'loans'}`] }
}

// Each person who has at least one loan not returned yet, by name.
function people(store, { positional }) {
  noPositional(positional)
  const counts = new Map()
  for (const loan of store.loans) {
    if (!loan.returned) counts.set(loan.person, (counts.get(loan.person) ?? 0) + 1)
  }
  const names = [...counts.keys()].sort()
  return { lines: names.length > 0 ? names.map(name => `${name}: ${counts.get(name)}`) : ['nobody has anything'] }
}

export const COMMANDS = new Map([
  ['add', { options: { '--to': 'value', '--due': 'value' }, run: add }],
  ['list', { options: { '--all': 'flag', '--to': 'value', '--due-before': 'value' }, run: list }],
  ['back', { options: {}, run: back }],
  ['edit', { options: { '--item': 'value', '--to': 'value', '--due': 'value', '--no-due': 'flag' }, run: edit }],
  ['remove', { options: {}, run: remove }],
  ['show', { options: {}, run: show }],
  ['rename', { options: { '--to': 'value' }, run: rename }],
  ['people', { options: {}, run: people }],
])
