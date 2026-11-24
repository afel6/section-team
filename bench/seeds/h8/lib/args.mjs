// Splits the words after the command into positional words and options.
import { UserError } from './rules.mjs'

// spec maps each option a command takes to 'flag' (no value) or 'value' (takes the next word).
// Options may come anywhere among the positional words; a repeated option keeps its last value.
export function parseOptions(words, spec) {
  const positional = []
  const options = {}
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]
    if (!word.startsWith('--')) {
      positional.push(word)
    } else if (!Object.hasOwn(spec, word)) {
      throw new UserError(`unknown option ${word}`)
    } else if (spec[word] === 'flag') {
      options[word] = true
    } else if (i + 1 >= words.length) {
      throw new UserError(`${word} needs a value`)
    } else {
      i += 1
      options[word] = words[i]
    }
  }
  return { positional, options }
}

// The single loan number a command such as back, edit or remove takes.
export function onePositional(positional) {
  if (positional.length !== 1) throw new UserError('expected one loan number')
  return positional[0]
}

export function noPositional(positional) {
  if (positional.length > 0) throw new UserError(`unexpected argument ${positional[0]}`)
}
