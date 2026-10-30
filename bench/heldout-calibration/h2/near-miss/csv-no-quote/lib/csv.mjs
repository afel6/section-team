// CSV for GET /items/export.csv. Every line, the header and the last line included, ends in CRLF.
const HEADER = ['sku', 'name', 'qty', 'reserved']

// NEAR-MISS: no quoting, so a name holding a comma or a double quote breaks the line.
const csvField = value => String(value)

const csvLine = fields => fields.map(csvField).join(',') + '\r\n'

export function toCsv(items) {
  return [HEADER, ...items.map(i => [i.sku, i.name, i.qty, i.reserved])].map(csvLine).join('')
}
