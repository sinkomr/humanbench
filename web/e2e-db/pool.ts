/** What `server.ts` serves and the specs expect (ROADMAP M3.11): the ports, the made-up text pool and the made-up passages. */

/** The first of the database ports: "plain" here, "text" on the next, "passage" at {@link PASSAGE_PORT_OFFSET}. */
export const DB_PORT = Number(process.env.E2E_DB_PORT ?? 4188)
/** The text skills the "text" database has questions for; the other two are asked for and not there. */
export const TEXT_PRESENT = ['LR', 'VOC', 'KST'] as const
/** Made-up questions per skill: the six a part runs to (`plan-table.ts` PART_MINIMUMS), and no more, so the part ends when they run out. */
export const TEXT_PER_AXIS = 6
/** Made-up passages in the "passage" database (phase 2): 3 and 4 questions in turn, every other one with a source line. */
export const PASSAGES = 6
/** The source line of made-up passage `p` (0-based), or none. */
export const passageCredit = (p: number): string | undefined => (p % 2 === 0 ? `Made-up source line ${p + 1}: adapted from a text that does not exist (placeholder), CC BY 4.0.` : undefined)
/**
 * Where the "passage" database listens, counted from {@link DB_PORT}: three, not two, because with the default
 * 4188 the next free port is 4190, which browsers refuse to fetch from (it is on the list of ports reserved
 * for other protocols; WebKit left the session at "Getting your session ready").
 */
export const PASSAGE_PORT_OFFSET = 3

/**
 * The remaining families (2026-10-13), in two databases so that each first session has its turn of the rotation
 * (`plan-table.ts` ROTATION): "games" at this offset from {@link DB_PORT}, with made-up logic games, and "estimates" at
 * the next, with made-up Fermi estimates, emotion vignettes, situational judgments and word-links puzzles
 * (`scripts/db/families-fixture.ts`). 4192 and 4193 with the default port: neither is on the browsers' list of
 * reserved ports.
 */
export const GAMES_PORT_OFFSET = 4
export const ESTIMATES_PORT_OFFSET = 5
/** Made-up logic games in "games": 3 and 4 questions in turn. */
export const GAMES = 3
/** Made-up items per family in "estimates": more than a part's six. */
export const FAMILY_ITEMS = 9
