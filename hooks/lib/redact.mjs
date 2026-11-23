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
// An Authorization: Basic value. A plain word after it ("an Authorization: Basic credentials line") is prose and stays.
const BASIC = /\b(authorization:[ \t]*basic[ \t]+)([A-Za-z0-9+/]{8,}={0,2})/gi
const WORD = /^[A-Z]?[a-z]+$/
// Anthropic and OpenAI keys (sk-...), GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_), Slack tokens (xoxa-, xoxb-, xoxp-, xoxr-),
// Google API keys (AIza...), Stripe secret keys (sk_live_, sk_test_) and AWS access key ids (AKIA...).
const TOKEN = /\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AIza[\w-]{35}|sk_(?:live|test)_[A-Za-z0-9]{16,}|AKIA[A-Z0-9]{16}\b)/g
// A whole value of $NAME, $env:NAME, ${NAME}, ${a.b}, ${{ a.b }}, %NAME% or <name> is a variable or a placeholder, not a secret: the
// patterns below that read a value leave it. Each pattern names what ends its value, so a secret that only starts with $, % or <
// ("$ecret", a bcrypt hash, "%40bc", "${X:-literal}") is still redacted. In a command the placeholder may close a sentence or a
// Markdown span first ("--token <value>.", "`--token $TOKEN`").
const PLACEHOLDER = String.raw`(?:\$(?:[Ee]nv:)?\w+|\$\{[\w.]+\}|\$\{\{[ \t]*[\w.]+[ \t]*\}\}|%\w+%|<[^<>\s]*>)`
const notAPlaceholder = end => String.raw`(?!${PLACEHOLDER}(?:${end}))`
const SHELL_END = String.raw`[.,;:!?)\x60]*(?:[\s'"]|$)`
// The password in scheme://user:password@host; the user and the host stay. Each part is bounded and stops at the first character it cannot use.
const URL_PASSWORD = new RegExp(String.raw`\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/?#@"'<>]{1,256}:)${notAPlaceholder('@')}[^\s/?#@"'<>]{1,256}@`, 'gi')
// A JSON string value whose key ends in a secret word ("password", "api_key", "accessToken"). A key that only holds one ("tokens",
// "keywords", "key") stays, and so does a value that already holds a mark. Each value character is read one way only.
const JSON_PAIR = new RegExp(String.raw`"([\w.-]{1,128})"(\s*:\s*)"${notAPlaceholder('"')}((?:[^"\\\r\n]|\\.)+)"`, 'g')
const JSON_SECRET_NAME = /(?:password|passwd|secret|token|(?:api|access|auth|client|private|secret)[_-]?key)$/i
// One command: from its name to the end of the line, the next |, ;, & or backtick (a command quoted in Markdown ends there), or a
// comma, colon or full stop before a space (prose that names the command goes on to other things). A quoted string is read whole so a
// quoted value may hold them; a quote opens one only where a shell word starts (after a space, =, -p or -u), so the apostrophes in
// "it's ... doesn't" are plain characters. It always ends where it stops, so each character is read once, and an unclosed quote is
// read as one character.
const QUOTE_START = String.raw`(?<=[\s=]|-[pu])`
const SEGMENT = String.raw`(?:[^\r\n|;&\x60'",:.]|[,:.](?!\s)|${QUOTE_START}'[^'\r\n]*'|${QUOTE_START}"[^"\r\n]*"|['"])*`
// mysql -p<password>, only in a MySQL or MariaDB client's command: elsewhere -p is mkdir -p, cp -pr or a port.
const MYSQL_COMMAND = new RegExp(String.raw`\b(?:mysql|mariadb)[\w-]*${SEGMENT}`, 'g')
const MYSQL_PASSWORD = new RegExp(String.raw`(\s-p)${notAPlaceholder(SHELL_END)}("[^"\r\n]*"|'[^'\r\n]*'|[^\s'"]+)`, 'g')
// curl -u user:password or --user user:password, only in a curl command: elsewhere -u is docker run -u 1000:1000 or git push -u.
const CURL_COMMAND = new RegExp(String.raw`\bcurl\b${SEGMENT}`, 'g')
const CURL_PASSWORD = new RegExp(String.raw`(\s(?:-u|--user(?![\w-]))(?:[ \t]{1,8}|=)?['"]?[^\s:'"]{1,256}:)${notAPlaceholder(SHELL_END)}([^\s'"]{1,256})`, 'g')
// --password <value> and --token <value>. A value that starts with - is the next flag, one that starts with [ or ( is usage text
// ("--token [value]"), and a plain word ("the --token flag", "use --token instead.") is prose: all stay.
const FLAG_VALUE = new RegExp(String.raw`(?<![\w-])(--(?:password|token)[ \t]{1,8})(?![-[(])${notAPlaceholder(SHELL_END)}("[^"\r\n]{0,256}"|'[^'\r\n]{0,256}'|[^\s'"]+)`, 'g')
const PROSE_WORD = /^[A-Za-z]+(?:-[A-Za-z]+)*[.,;:!?)]*$/
// NAME=value: the name starts where no name character comes before it, so each run of name characters is tried once.
const ASSIGNMENT = /(?<![\w.-])([\w.-]{1,128})=("[^"]*"|'[^']*'|\S+)/g
const SECRET_NAME = /key|token|secret|password/i

export function redact(text) {
  return String(text ?? '')
    .replace(PEM, MARK)
    .replace(BEARER, `$1 ${MARK}`)
    .replace(BASIC, (whole, lead, value) => (WORD.test(value) ? whole : `${lead}${MARK}`))
    .replace(TOKEN, MARK)
    .replace(URL_PASSWORD, `$1${MARK}@`)
    .replace(JSON_PAIR, (whole, name, colon, value) => (JSON_SECRET_NAME.test(name) && !value.includes(MARK) ? `"${name}"${colon}"${MARK}"` : whole))
    .replace(MYSQL_COMMAND, command => command.replace(MYSQL_PASSWORD, `$1${MARK}`))
    .replace(CURL_COMMAND, command => command.replace(CURL_PASSWORD, `$1${MARK}`))
    .replace(FLAG_VALUE, (whole, flag, value) => (PROSE_WORD.test(value) ? whole : `${flag}${MARK}`))
    .replace(ASSIGNMENT, (whole, name) => (SECRET_NAME.test(name) ? `${name}=${MARK}` : whole))
}
