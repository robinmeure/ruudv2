# Storyboard implementation plan

## Decision and outcome

**Selected direction:** Storyboard, as approved from the interactive mockup at
`#/mockups/storyboard`.

**Visitor mode:** Operate.

Replace the production deck's strip rack with a deck-order storyboard and an
adjacent review panel. The presenter should be able to understand the deck's
narrative, find notes that need work, follow research, review and edit proposals,
and export only explicitly accepted notes.

Use the mockup as the composition and visual reference, not as production
behavior or a source of product facts.

## Scope

- Implement the deck storyboard, review panel, and associated shell styling.
- Preserve upload, deck management, Copilot connectivity, model selection,
  routing, live updates, research policy, review persistence, and export behavior.
- Preserve the original PPTX; export remains an enriched copy.
- Keep the concept gallery available as a reference during implementation.
- Do not redesign the home page's information architecture in this change.
  Update shared controls and tokens consistently wherever the new shell uses them.

### Explicit non-goals

- Rendering pixel-accurate PowerPoint thumbnails in the initial implementation.
- Adding a chat interface or instruction-driven AI revision endpoint.
- Inventing claim-level citations, verified-source labels, or retrieval dates
  that the backend does not provide.
- Changing assessment rules, enrichment prompts, billing behavior, or the
  public-web-only tool policy.

## Production contract

### Storyboard

- Show all slides in original deck order by default, grouped by existing section
  metadata where available. Do not sort by research state.
- Each tile identifies slide number, title, section, notes health, workflow state,
  and hidden/structural-slide indicators.
- Use a clearly identified **content preview**, derived from extracted title and
  paragraph data. It is not an image of the actual slide.
- Provide sensible text and accessible-name fallbacks for untitled, image-only,
  chart-only, and text-heavy slides. Do not imply missing text means an empty slide.
- Separate the active slide from batch-selected slides visually and semantically.
  Use a tile link for navigation and a separate checkbox for batch selection,
  without nesting interactive elements.
- Provide title/section/number search and the existing workflow filters:
  All, Needs notes, In research, To review, and Accepted.
- Retain batch selection, select-visible/deselect-visible, clear selection,
  research selected/flagged, and stop-all actions.
- Derive counts from actual deck state. Notes health and workflow state remain
  distinct dimensions; do not treat their counts as an exclusive partition.
- Preserve unseen-proposal tracking with a quiet "New proposal" indicator rather
  than the strip's physical cocking animation.

### Review panel

- On wide screens, keep a readable right-hand panel beside the storyboard, with
  independent scrolling and a visible decision area that does not obscure content.
- Show title, slide number, section, assessment reasons, and current workflow state.
- Offer Draft and Changes views, plus easy access to original notes. Reuse the
  existing word diff instead of the mockup's first-sentence highlighting.
- Retain editable proposed notes, manual notes, word-count guidance, accepted-note
  editing, reject, undo acceptance, undo rejection, and re-research.
- Do not turn the existing 250-word guidance into a new hard limit.
- Surface key facts, actual source URLs, warnings, confidence, model, proposal
  creation time, and proposal language when supplied.
- Do not label model-reported confidence as calibrated certainty. A source link
  establishes provenance, not that a claim has independently been verified.
- Put warnings near the draft and its acceptance controls; never hide them behind
  an optional details view.
- Show queued/running status, latest activity, an expandable activity log, retry
  after failure, and the appropriate research cancellation action.
- Replace the mockup's "Request revision" with supported actions: edit the draft
  or research again. An instruction-based revision flow would be a separate feature.
- Never display acceptance success until the API confirms the decision.
- Protect unsaved edits when switching slides or closing review: offer discard or
  stay, and offer save-and-switch only when the draft is valid and saving succeeds.
  Unrelated SSE updates must not reset an active editor.

### Fluent-inspired visual system

- Use the selected neutral canvas, white reading surfaces, restrained indigo
  action color, subtle elevation, modest corner radii, and Segoe UI typography.
- Use compact metadata, readable notes, and a clear title hierarchy rather than
  oversized dashboard metrics.
- Reserve AI iconography and emphasis for generated material, research state,
  and explanatory disclosure.
- Use distinct, text-labeled success, warning, failure, and working states.
- Keep one clear primary action per local task. Export becomes available only
  when accepted notes exist, with the real accepted count.
- Prefer existing React and Lucide primitives with shared semantic tokens for
  this bounded migration. This is Fluent-inspired, not a claim of using Fluent UI
  React. Adopting the full component library is a separate dependency decision.

## Implementation sequence

### 1. Establish the storyboard foundation

**Targets:** `src/web/src/components/DeckConsole.tsx`,
`src/web/src/components/ConsoleBar.tsx`, `src/web/src/index.css`,
`src/web/src/styles/app.css`, `DESIGN.md`, and the deck surface brief.

- Document Storyboard as the chosen production direction, replacing the
  strip-bay-specific design rules when the implementation lands.
- Define shared semantic tokens and the two-pane layout from the approved mockup.
  Avoid shipping production components with `fm-*` mockup classes.
- Keep `DeckConsole` as the owner of queries, mutations, selected slides, active
  slide, model selection, and SSE subscription.
- Retain current deck and slide hash URLs; the concept switcher does not become
  production navigation.
- Preserve working home/deck shell controls while updating their shared styling.

**Exit:** a styled production shell renders real deck data without changing API behavior.

### 2. Replace the rack with the storyboard

**Targets:** new `Storyboard.tsx` and `SlideTile.tsx`, existing `Rack.tsx`,
`lib/strip.ts`, `hooks/useRoute.ts`, and `hooks/useSeenProposals.ts`.

- Move applicable filter, selection, confirmation, and batch action behavior from
  `Rack` into the storyboard; reuse existing state helpers.
- Rename or extract presentation-neutral helpers only where needed. Do not
  rewrite assessment or workflow classification.
- Render content previews and section groups from `SlideState`.
- Apply search and workflow filters together. Counts must state whether they
  describe the entire deck or the current results.
- Define select-visible to select the currently searched/filtered results.
  Preserve selected slide numbers when changing filters and show the total.
- Keep the active review open if its tile becomes filtered out; make that condition
  clear and provide a way to reveal the slide.
- Retain J/K navigation through visible results, skipping keyboard shortcuts when
  typing or using modified key combinations.

**Exit:** real slides can be scanned, searched, filtered, navigated, and researched in batches.

### 3. Adapt review to the right-hand panel

**Targets:** `Workspace.tsx`, `NotesDesk.tsx`, `DeckConsole.tsx`,
`api/client.ts`, and `api/types.ts`.

- Recompose existing review behavior into a compact panel; extract existing
  provenance and activity sections only when necessary for reuse.
- Preserve original-versus-draft comparison without forcing two narrow text
  columns into the panel.
- Preserve editor identity across incidental state updates and handle navigation
  away from dirty drafts explicitly.
- Wire all decisions to existing mutations and show pending, success, and failure.
  Keep drafts intact after failed requests and enable an explicit retry.
- Bind source links directly to `SourceRef.url`; never use the mockup's shared
  placeholder destination.
- Use `createdAt` as proposal creation time, not source retrieval time.
- Remove mockup-only numbers, example claims, simulated connectivity, and
  unsupported revision controls from the production experience.

**Exit:** editing, diffing, acceptance, rejection, undo, re-research, and manual notes
work against persisted slide state, and export reflects those decisions.

### 4. Complete responsive behavior and operational states

**Targets:** storyboard/review styles, shared notices, and affected shell controls.

- Desktop: adaptive preview grid and adjacent review panel, with bounded reading
  measures and stable controls.
- Tablet: reduce grid columns and metadata density before compromising readability.
- Narrow screens: show the storyboard or full-width review, driven by the existing
  slide route; provide an explicit return action and restore storyboard position.
- Cover deck loading/error/404, no slides, no search results, no flagged slides,
  no proposal, no sources, queued/running, failed/cancelled, rejected/accepted,
  unavailable Copilot, and disconnected/reconnecting SSE.
- Announce meaningful research and review transitions without reading every
  streamed log line through a live region.
- Make navigation, selection, editing, and decisions keyboard operable. Preserve
  visible focus, logical heading order, reduced motion, and WCAG AA contrast.
- Exercise long Dutch and English titles/notes, browser zoom, and hidden slides.
- Measure a 75+ slide deck before adding virtualization. Optimize only if profiling
  demonstrates a problem; avoid creating a new rendering abstraction preemptively.

**Exit:** the full workflow remains usable at desktop, tablet, and mobile sizes,
including slow research and recoverable failures.

### 5. Verify, document, and make Storyboard the default

**Targets:** frontend tests, applicable existing API tests, root/frontend README,
`DESIGN.md`, and `.impeccable/surfaces/src-web-src-app-tsx.md`.

- Add focused frontend unit/component coverage for search/filter composition,
  selection, state/count presentation, preview fallbacks, and review transitions.
  The frontend currently has no unit-test script; introduce only the minimal
  testing setup needed for these behaviors.
- Add browser coverage for opening a deck, navigating tiles, batch research,
  SSE state changes, editing/accepting/rejecting/undoing, and export availability.
- Stub network responses and events in automated UI tests; do not spend premium
  Copilot requests during routine validation.
- Verify pending controls prevent duplicate submissions and server failures never
  create success-shaped UI.
- Run existing API/export regression tests. Confirm the enriched PPTX changes
  accepted notes only and leaves unaccepted notes, slide order, hidden flags, and
  the original file intact.
- Run `npm --prefix .\src\web run build` and
  `npm --prefix .\src\web run lint`.
- Perform one batched visual pass across all target sizes and principal states;
  fix discovered defects together, then perform at most one confirmation pass.
- Run the Impeccable detector on changed UI targets.
- Remove obsolete strip-only production styles/components after checking references;
  retain the gallery as a separate reference, not a dependency of production UI.
- Update design documentation to reflect the shipped system and record limitations.

**Exit:** Storyboard is the normal deck experience, builds cleanly, is covered by
workflow tests, and ships without static mockup data.

## Dependencies and delivery

Phases 2 and 3 depend on the shell and state contract from phase 1. Phase 4 depends
on both. Phase 5 validates the combined result.

No backend contract change is required for this initial scope. Actual PPTX image
previews or instruction-based AI revisions would require separate design and API
work; neither should be silently approximated as a working capability.

## Acceptance checklist

- [x] The production deck view matches the approved Storyboard composition.
- [x] Every displayed slide, count, state, source, and model comes from real state.
- [x] Slides remain in deck order; assessment and workflow state remain distinct.
- [x] Search, workflow filters, visible selection, and batch research work together.
- [x] Active slide URLs, back navigation, keyboard navigation, and mobile review work.
- [x] Original notes, editable drafts, real diffs, manual notes, and warnings are accessible.
- [x] Unsaved edits survive incidental updates and are protected during navigation.
- [x] Accept, reject, save edits, undo, retry, cancellation, and export work end to end.
- [x] No source is mislabeled as verified, and no unsupported AI revision action ships.
- [x] Loading, empty, failure, and reconnect states provide explicit recovery.
- [x] A 75+ slide bilingual deck is usable without horizontal overflow at 390px.
- [x] Build, lint, focused tests, export regressions, and visual checks pass.

## Verification results

- 14 Vitest state/component tests and 10 Playwright workflow tests pass.
- 14 targeted API/export regression tests pass, including original-file byte
  preservation, unaccepted notes, slide order, hidden flags, and the sample PPTX.
- Production build and ESLint pass; Impeccable reports no findings.
- A 78-slide bilingual fixture was exercised at 1440px, 1024px, 768px, and 390px,
  plus a 720x450 zoom-equivalent viewport. Text/signal token pairs meet 4.5:1 contrast.
- Browser research and SSE are stubbed; no premium Copilot requests were used.
- Export now checks HTTP success before downloading, rather than potentially
  downloading an API error document. Backend routes and contracts are unchanged.
