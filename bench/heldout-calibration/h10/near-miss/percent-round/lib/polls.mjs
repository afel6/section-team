// Poll rules: the checks on a new poll and on a vote, and how a stored poll is shown.
// A stored poll is { id, question, closed, answers: [text], votes: [{ voter, answer }] }.
import { HttpError } from './http.mjs'

const QUESTION_MAX = 200
const ANSWER_MAX = 80
const VOTER_MAX = 40
const MIN_ANSWERS = 2
const MAX_ANSWERS = 6

const bad = message => new HttpError(400, message)

function trimmedText(value, max, message) {
  if (typeof value !== 'string') throw bad(message)
  const text = value.trim()
  if (text.length < 1 || text.length > max) throw bad(message)
  return text
}

// Two names or answers are the same after trimming and lowering the letter case.
export const sameKey = text => text.trim().toLowerCase()

export function parseNewPoll(data) {
  const question = trimmedText(data.question, QUESTION_MAX, `question must be 1 to ${QUESTION_MAX} characters`)
  const list = data.answers
  if (!Array.isArray(list) || list.length < MIN_ANSWERS || list.length > MAX_ANSWERS) throw bad(`answers must be a list of ${MIN_ANSWERS} to ${MAX_ANSWERS} items`)
  const answers = list.map(item => trimmedText(item, ANSWER_MAX, `each answer must be 1 to ${ANSWER_MAX} characters`))
  if (new Set(answers.map(sameKey)).size !== answers.length) throw bad('answers must be different')
  return { question, answers }
}

// The vote in data for poll, as { voter, answer }; the field rules first, then the poll's state.
export function parseVote(data, poll) {
  const voter = trimmedText(data.voter, VOTER_MAX, `voter must be 1 to ${VOTER_MAX} characters`)
  const { answer } = data
  if (!Number.isInteger(answer) || answer < 0 || answer >= poll.answers.length) throw bad('answer must be the number of an answer, counting from 0')
  if (poll.closed) throw new HttpError(409, 'poll is closed')
  if (poll.votes.some(v => sameKey(v.voter) === sameKey(voter))) throw new HttpError(409, 'already voted')
  return { voter, answer: answer === 0 ? 0 : answer }
}

// Whole percentages that add up to 100: floors first, then one point each to the largest remainders, earlier first.
export function percentages(counts, total) {
  if (total === 0) return counts.map(() => 0)
  if (total > 0) return counts.map(count => Math.round((100 * count) / total))
  const parts = counts.map((count, index) => {
    const remainder = (100 * count) % total
    return { index, base: (100 * count - remainder) / total, remainder }
  })
  const missing = 100 - parts.reduce((sum, p) => sum + p.base, 0)
  const extra = new Set(parts.toSorted((a, b) => b.remainder - a.remainder || a.index - b.index).slice(0, missing).map(p => p.index))
  return parts.map(p => p.base + (extra.has(p.index) ? 1 : 0))
}

export function viewPoll(poll) {
  const counts = poll.answers.map((_, index) => poll.votes.filter(v => v.answer === index).length)
  const total = poll.votes.length
  const percents = percentages(counts, total)
  return {
    id: poll.id,
    question: poll.question,
    closed: poll.closed,
    total,
    answers: poll.answers.map((text, index) => ({ text, votes: counts[index], percent: percents[index] })),
  }
}
