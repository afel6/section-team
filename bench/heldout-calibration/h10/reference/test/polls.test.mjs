import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HttpError } from '../lib/http.mjs'
import { parseNewPoll, parseVote, percentages, viewPoll } from '../lib/polls.mjs'

const refused = (fn, status, message) => assert.throws(fn, e => e instanceof HttpError && e.status === status && e.message === message)

test('percentages add up to 100, the largest remainders first, ties to the earlier answer', () => {
  assert.deepEqual(percentages([0, 0], 0), [0, 0])
  assert.deepEqual(percentages([1, 1, 1], 3), [34, 33, 33])
  assert.deepEqual(percentages([2, 1], 3), [67, 33])
  assert.deepEqual(percentages([2, 2, 3], 7), [29, 28, 43])
  assert.deepEqual(percentages([1, 1, 1, 1, 1, 1], 6), [17, 17, 17, 17, 16, 16])
})

test('a new poll is trimmed and checked in order', () => {
  assert.deepEqual(parseNewPoll({ question: ' Lunch? ', answers: [' Pizza', 'Sushi '] }), { question: 'Lunch?', answers: ['Pizza', 'Sushi'] })
  refused(() => parseNewPoll({ question: ' ', answers: [] }), 400, 'question must be 1 to 200 characters')
  refused(() => parseNewPoll({ question: 'Q', answers: ['a'] }), 400, 'answers must be a list of 2 to 6 items')
  refused(() => parseNewPoll({ question: 'Q', answers: ['a', 'a', 5] }), 400, 'each answer must be 1 to 80 characters')
  refused(() => parseNewPoll({ question: 'Q', answers: ['Pizza', ' pizza'] }), 400, 'answers must be different')
})

test('a vote: the fields first, then closed, then already voted (names without letter case)', () => {
  const poll = { id: 1, question: 'Q', closed: false, answers: ['a', 'b'], votes: [{ voter: 'Ann', answer: 0 }] }
  assert.deepEqual(parseVote({ voter: ' Ben ', answer: 1 }, poll), { voter: 'Ben', answer: 1 })
  refused(() => parseVote({ voter: 'ann', answer: 1 }, poll), 409, 'already voted')
  refused(() => parseVote({ voter: 'Ben', answer: 2 }, poll), 400, 'answer must be the number of an answer, counting from 0')
  refused(() => parseVote({ voter: 'ann', answer: 0 }, { ...poll, closed: true }), 409, 'poll is closed')
  assert.deepEqual(viewPoll(poll), { id: 1, question: 'Q', closed: false, total: 1, answers: [{ text: 'a', votes: 1, percent: 100 }, { text: 'b', votes: 0, percent: 0 }] })
})
