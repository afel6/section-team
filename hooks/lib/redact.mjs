// Secrets replaced with [redacted] before text is written to a file: a saved long prompt, a stopped process's command line.
// Every pattern is bounded, or reads each character one way only and stops at the first it cannot use, so the cost stays linear in the text's length.

const MARK = '[redacted]'
// A PEM block runs from BEGIN to an END line with the same label and holds only key lines and, right after BEGIN, the header lines of an
// encrypted legacy key. Line breaks are real or written \n as in JSON, and may indent the next line. No key or header line holds a CR,
// LF or backslash, and no key line a space, so each line break is read one way. A BEGIN line with no such END line takes only the key
// lines of 16 or more characters after it, so prose that quotes a BEGIN or END line keeps the rest.
const KEY = '[A-Za-z0-9+/=]'
const BREAKS = String.raw`(?:(?:\r?\n|(?:\\r)?\\n)[ \t]*)+`
const HEADERS = String.raw`(?:${BREAKS}[\w-]{1,32}: [^\r\n\\]{1,128}){0,4}`
const PEM = new RegExp(String.raw`-----BEGIN ([A-Z0-9 ]{1,64})-----(?:${HEADERS}(?:${BREAKS}${KEY}+)*${BREAKS}-----END \1-----|(?:\s+${KEY}{16,})*)`, 'g')
// A token as long as sk- keys at least, so "a bearer token" in prose stays.
const BEARER = /\b(bearer)\s+[\w.~+/=-]{16,}/gi
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
