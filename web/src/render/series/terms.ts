/** Display text of a series term (ROADMAP M1.13): negatives with a true minus sign (U+2212), letters as is. */
export function displayTerm(term: number | string): string {
  if (typeof term === 'string') return term
  return term < 0 ? `−${String(-term)}` : String(term)
}
