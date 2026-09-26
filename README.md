# HumanBench

HumanBench is a free, browser-based battery of short cognitive tasks that draws your
results as a "jagged blob": one spike per ability, with its uncertainty shown, instead of
a single score. It is for curiosity and self-reflection. It is not an IQ test, a clinical
assessment, or a basis for decisions about education, employment, or health.

Status: early scaffolding (milestone M0). The design spec is in
[docs/DESIGN.md](docs/DESIGN.md), and the build backlog is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Layout

- `web/`: the app (Vite, Svelte 5, TypeScript strict), deployed to GitHub Pages under `/humanbench/`
  - `web/src/engine/`: scoring, save file, timing
  - `web/src/tasks/`: task families
  - `web/src/viz/`: blob and bar views, export
- `schema/`: JSON Schemas (the save file, from M1); the build publishes each `schema/*.json` at `/humanbench/schema/`
- `.github/workflows/`: `ci.yml` (typecheck, tests, build) and `pages.yml` (deploy on push to `main`)

## Development

Requires Node 24.15 or newer in the 24 line, or Node 26 or newer; Node 25 is not supported (see `engines` in `web/package.json`). CI uses Node 24, from `web/.nvmrc`.

Install dependencies:

```zsh
cd web
npm ci
```

Run the dev server (it serves at http://localhost:5173/humanbench/):

```zsh
npm run dev
```

Typecheck, run the tests, and build:

```zsh
npm run check
npm test
npm run build
```

Preview the production build:

```zsh
npm run preview
```

Rerun the tests on every file change:

```zsh
npm run test:watch
```

Test files live next to the code in `web/src/`. A file named `*.dom.test.ts` or `*.svelte.test.ts` runs in jsdom (use it for components and runes); every other `*.test.ts` runs in Node. `npm run check` fails on Svelte accessibility warnings as well as type errors.

The build uses the base path `/humanbench/`. To build for a different path, such as a custom domain served at `/`:

```zsh
VITE_BASE=/ npm run build
```

The Pages workflow sets the base path from the repository's Pages settings, so a custom domain needs no change here. It runs `npm run check` and `npm test` before it builds and deploys.
