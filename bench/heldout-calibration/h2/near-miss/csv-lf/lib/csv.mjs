// CSV for GET /items/export.csv. Every line, the header and the last line included, ends in CRLF.
const HEADER = ['sku', 'name', 'qty', 'reserved']
const NEEDS_QUOTES = /[",\r\n]/

// A field holding a comma, a double quote, a CR or an LF is wrapped in double quotes,
// with each double quote inside it doubled.
function csvField(value) {
  const text = String(value)
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

// NEAR-MISS: lines end in LF, not CRLF.
const csvLine = fields => fields.map(csvField).join(',') + '\n'

export function toCsv(items) {
  return [HEADER, ...items.map(i => [i.sku, i.name, i.qty, i.reserved])].map(csvLine).join('')
}
