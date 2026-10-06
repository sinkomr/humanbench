/**
 * Copy editor (rev-copy): reads every user-facing word in context. A tour of every product route (page text and
 * accessibility tree per route), the results with every disclosure open (one session, and two sessions for the
 * retest and practice-adjusted wording), and a `?fast=1` session photographed at each new screen, so the intros,
 * interstitials and the break read as a person meets them.
 *
 *   UX_PORT=4618 UX_RUN=copy npx playwright test -c ux-review/playwright.ux.config.ts ux-review/personas/copy.ux.ts --project=chromium --grep 'copy: tour start'
 */

import { expect, test } from "@playwright/test";
import { openDetails, toResults } from "../../e2e/flow";
import { openRoute, ROUTES } from "../../e2e/routes";
import { PRODUCT_ROUTES, playJourney, Shots, tour, trackConsole } from "../lib";

const RUN = process.env.UX_RUN ?? "copy";

for (const group of [
  "start",
  "session",
  "results",
  "notes",
  "selftest",
] as const) {
  test(`copy: tour ${group}`, async ({ context }) => {
    const routes = PRODUCT_ROUTES.filter((r) => r.group === group).map(
      (r) => r.id,
    );
    const entries = await tour(context, {
      runId: RUN,
      routes,
      widths: [1280],
      schemes: ["light"],
      metrics: false,
    });
    expect(entries.length).toBe(routes.length);
  });
}

test("copy: results with every disclosure open", async ({ page }) => {
  test.setTimeout(120_000);
  const log = trackConsole(page);
  const shots = new Shots(page, RUN, "results-open");
  await toResults(page);
  await shots.all("results-closed");
  await openDetails(page);
  await page.waitForTimeout(300);
  await shots.all("results-all-open");
  shots.json("console", log);
});

test("copy: results of two sessions, every disclosure open", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const shots = new Shots(page, RUN, "results-two");
  await toResults(page, 2);
  await openDetails(page);
  await page.waitForTimeout(300);
  await shots.all("results-two-sessions-open");
});

/** Close-ups of the strings the findings quote, each in its own context (one fresh page per route). */
test("copy: evidence close-ups", async ({ context }) => {
  test.setTimeout(300_000);
  const shots: Array<[string, string, string]> = [
    // [route id, locator, evidence name]
    ["interstitial", "main", "interstitial-reaction-time-casing"],
    ["interstitial", "nav.checklist", "checklist-up-next-metacognition"],
    ["results-open", "table >> nth=0", "results-table-sd-interval"],
    [
      "results-open",
      'section:has(h2:text-is("Your most distinctive peaks"))',
      "peaks-colour-note",
    ],
    ["results-drilldown", "table >> nth=1", "drilldown-facet-names"],
    [
      "results-saved",
      'section:has(h2:text-is("Coming back for more"))',
      "retest-sharpen",
    ],
    [
      "results-saved",
      'section:has(h2:text-is("Three worked examples"))',
      "worked-intro",
    ],
    ["break-offer", "main", "break-offer-stay-sharp"],
    ["finished-nothing", "main", "finished-nothing-save-results"],
    ["privacy", "main", "privacy-todo"],
    ["reading-questions", "main", "reading-not-answered"],
    ["quant-item", "main", "quant-integer-hint"],
    ["item-matrix-series", "main", "series-whole-number-hint"],
    ["item-spatial-no-webgl", "main", "spatial-no-webgl-repeated"],
    ["practice-feedback", "main", "practice-back"],
    [
      "notes-checker",
      'section:has(h2:text-is("Check notes"))',
      "notes-checker-line-list",
    ],
    ["notes-fit", "main", "notes-fit-quotes"],
    [
      "notes",
      'section:has-text("Free plans have allowed")',
      "notes-paid-plans",
    ],
  ];
  for (const [routeId, selector, name] of shots) {
    const route = ROUTES.find((r) => r.id === routeId);
    if (route === undefined) continue;
    // Empty the app's storage first (as the tour does), from a document of the origin that runs none of the app.
    const blank = await context.newPage();
    await blank.goto("./favicon.svg").catch(() => undefined);
    await blank
      .evaluate("localStorage.clear(); sessionStorage.clear()")
      .catch(() => undefined);
    await blank.close();
    const page = await context.newPage();
    try {
      if (route.prepare) await route.prepare(page);
      await openRoute(page, route);
      await openDetails(page);
      await page.waitForTimeout(200);
      const s = new Shots(page, RUN, `evidence/${name}`);
      const target = page.locator(selector).first();
      if ((await target.count()) > 0) await s.shot(name, { locator: target });
      else await s.shot(name, { fullPage: true });
      await s.text(name);
    } catch (error) {
      console.log(
        `[copy evidence] ${routeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await page.close();
    }
  }
});

test("copy: journey", async ({ page }) => {
  test.setTimeout(420_000);
  const shots = new Shots(page, RUN, "journey");
  const journey = await playJourney(page, {
    runId: RUN,
    touch: false,
    practice: true,
    shots,
    limitMs: 360_000,
  });
  shots.json("journey-summary", {
    completed: journey.completed,
    error: journey.error,
    segments: journey.segments,
  });
  expect(journey.steps.length).toBeGreaterThan(0);
});
