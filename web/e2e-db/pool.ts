/** What `server.ts` serves and the spec expects (ROADMAP M3.11 phase 1): the ports and the made-up text pool. */

/** The first of the two database ports: "plain" here, "text" on the next. */
export const DB_PORT = Number(process.env.E2E_DB_PORT ?? 4188)
/** The text skills the "text" database has questions for; the other two are asked for and not there. */
export const TEXT_PRESENT = ['LR', 'VOC', 'KST'] as const
/** Made-up questions per skill: more than the five a part needs, few enough that the part ends when they run out. */
export const TEXT_PER_AXIS = 6
