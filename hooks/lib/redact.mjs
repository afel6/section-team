// Secrets replaced with [redacted] before text is written to a file: a saved long prompt, a stopped process's command line.
// Every pattern is bounded or anchored, so a long run of text with no match costs one pass.

const MARK = '[redacted]'
// A PEM block, or one cut off before its END line, which runs to the end of the text.
const PEM = /-----BEGIN [A-Z0-9 ]{1,64}-----[\s\S]*?(?:-----END [A-Z0-9 ]{1,64}-----|$)/g
const BEARER = /\b(bearer)\s+[\w.~+/=-]+/gi
// Anthropic and OpenAI keys (sk-...) and GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_).
const TOKEN = /\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})/g
// NAME=value: the name starts where no name character comes before it, so each run of name characters is tried once.
const ASSIGNMENT = /(?<![\w.-])([\w.-]{1,128})=("[^"]*"|'[^']*'|\S+)/g
const SECRET_NAME = /key|token|secret|password/i

export function redact(text) {
  return String(text ?? '')
    .replace(PEM, MARK)
    .replace(BEARER, `$1 ${MARK}`)
    .replace(TOKEN, MARK)
    .replace(ASSIGNMENT, (whole, name) => (SECRET_NAME.test(name) ? `${name}=${MARK}` : whole))
}
