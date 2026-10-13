# PPTX Speaker Notes Enricher — web

React 19 + TypeScript + Vite front end. See the [root README](../../README.md) for the full picture, prerequisites and how to run everything through Aspire.

## Scripts

```powershell
npm install
npm run dev      # Vite dev server (PORT, default 5173)
npm run build    # tsc -b && vite build
npm run lint     # eslint .
npm test         # focused Vitest state/component tests
npx playwright install chromium  # if the browser is not installed yet
npm run test:browser              # isolated, network-stubbed Playwright workflows
```

## API proxy

The dev server proxies `/api` to the backend. The target is the first of `services__api__https__0`, `services__api__http__0` (set by Aspire), `API_HTTPS`, `API_HTTP`, falling back to `http://localhost:5137` (the API's launch profile).

## Design

The selected Storyboard visual system is documented in [DESIGN.md](../../DESIGN.md).
Semantic tokens live in [src/index.css](src/index.css); production components use
[src/styles/app.css](src/styles/app.css). The deck route opens an ordered,
section-aware content-preview grid and an adjacent review panel. Below 1000px,
the slide route switches to full-width review.

`DeckConsole` retains query, mutation, selection, model, and SSE ownership.
`Storyboard` and `SlideTile` render real state; `Workspace` and `NotesDesk`
preserve editing, diff, provenance, and review decisions. Unsaved-draft guards
cover tile navigation, closing, J/K, and browser history. Export validates the
HTTP response before downloading the enriched copy.

Three interactive Fluent-inspired AI workflow concepts are available at `#/mockups` while the Vite app is running:

- **Focus lanes** — triage, compare, and decide in parallel work areas.
- **Storyboard** — review speaker notes in the context of the deck narrative.
- **Evidence lens** — inspect claims, provenance, and AI disclosure before accepting prose.

The gallery is self-contained and does not call the API or change uploaded decks.

## Tests

- Vitest covers search/filter composition, selection, counts, preview fallbacks,
  editor stability, failed/pending decisions, unsaved navigation, and word guidance.
- Playwright uses deterministic 78-slide fixtures, intercepts API requests, and
  supplies an in-page EventSource double. It covers review, batch research,
  cancellation, live updates, export, history, and desktop/tablet/390px layouts.
- No routine UI test invokes the real Copilot CLI. The backend tests verify real
  PPTX package behavior, including accepted-only export and original preservation.
- Playwright starts a temporary Vite server on `127.0.0.1:5187`. The port must be
  free; existing user servers are never reused or stopped.
- On Windows, run `npm test` from the project directory using the filesystem's
  actual drive/path casing (here `D:\repos\ruudv2\src\web`). This Vitest/Vite
  combination can load duplicate runner modules when invoked through a
  differently cased absolute `npm --prefix` path.
