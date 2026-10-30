// One page of a list, plus the paging fields every list endpoint sends back.
// page is 1-based; a page past the end has no items.
export function paginate(list, page, perPage) {
  const start = (page - 1) * perPage
  return { items: list.slice(start, start + perPage), page, per_page: perPage, total: list.length }
}
