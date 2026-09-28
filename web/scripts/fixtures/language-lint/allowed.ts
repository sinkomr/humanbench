/**
 * Language-lint fixture (ROADMAP M1.20, A13): nothing here may be flagged. It spells out the
 * R-5.6.5 sentence and the §13 disclaimer exactly (the repo lint would still require the former to
 * live only in src/copy.ts), plus near-misses. Comments may name autism, ADHD or a diagnosis.
 */
export const resource =
  "If you're curious about autism or social-communication differences, a qualified clinician is the right route; online tests can't tell you."
export const disclaimer = `For curiosity and self-reflection. Not an IQ test, a clinical assessment, or a basis for decisions about education, employment, or health.`
export const nearMisses = ['add', 'disabled', 'screen reader', 'IQR', 'diagram', 'the spectrum of colours', 'be patient']
