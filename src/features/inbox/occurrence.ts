/**
 * Statement rows are not unique on their own content: the same shop can charge
 * the same amount twice in one day. Import identity therefore needs the row's
 * position among its identical siblings, counted in file order so a re-upload
 * of the same export reproduces the same indexes.
 */
export function occurrenceCounter() {
  const seen = new Map<string, number>()
  return function nextOccurrence(key: string) {
    const index = seen.get(key) ?? 0
    seen.set(key, index + 1)
    return index
  }
}
