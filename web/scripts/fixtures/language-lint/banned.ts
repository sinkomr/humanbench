/**
 * Language-lint fixture (ROADMAP M1.20, A13): every string below is copy that must be flagged.
 * Comments are not copy, so the autism and ADHD named in this comment are not.
 */
export const plain = 'Results may point to autism.'
export const template = (n: number): string => `An ADHD screener in ${n} minutes`
export const tail = (n: number): string => `Score ${n}: a clear deficit`
export const caps = 'NOT A DIAGNOSIS'
export const hyphen = 'A non-diagnostic IQ estimate'
export const multi = `line one
neurodivergent on line two`
export const identifiersAreNotCopy = { symptomCount: 0 }
