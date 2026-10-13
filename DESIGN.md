---
name: Notes Enricher
description: A deck-order storyboard with a notes-first review panel.
colors:
  canvas: "#f7f7f9"
  base: "#f0f0f3"
  surface: "#ffffff"
  stroke-subtle: "#ececf0"
  surface-muted: "#f0f0f4"
  border: "#dedee6"
  border-strong: "#bcbcc9"
  text: "#242424"
  muted: "#60606b"
  action: "#565ac0"
  action-hover: "#4448a0"
  action-soft: "#efedff"
  success: "#216438"
  success-soft: "#e9f4ec"
  warning: "#805800"
  warning-soft: "#fff5da"
  danger: "#b02032"
  danger-soft: "#fff0f1"
typography:
  body:
    fontFamily: "Segoe UI Variable, Segoe UI, system-ui, sans-serif"
    fontSize: "0.9375rem"
    lineHeight: 1.7
  title:
    fontSize: "1.375rem"
    fontWeight: 650
  label:
    fontSize: "0.8125rem"
    fontWeight: 600
rounded:
  control: "6px"
  dialog: "10px"
---

# Notes Enricher design system

## Approved direction: Storyboard

The presenter sees the deck in its original narrative order, opens a slide beside
the storyboard, reviews or writes its notes, and explicitly accepts what should
enter the exported copy. Storyboard replaces the former strip-bay composition.
The decision and detailed scope are recorded in
[STORYBOARD-IMPLEMENTATION-PLAN.md](STORYBOARD-IMPLEMENTATION-PLAN.md).

This is a Fluent-inspired interface built from React, native controls, and Lucide
icons, not an implementation of Fluent UI React. Neutral canvas, white reading
surfaces, restrained indigo actions, modest radii, and subtle elevation support
an operational editor rather than a metrics dashboard.

## Fluent 2 layering, wait UX, and handoffs

The approved reference is the gallery at `#/mockups/fluent2`. Distinction comes
from elevation and one clear signal per element, not from extra color or chrome.

- **Elevation ramp** (`--shadow-2/4/8/16/28/64` in index.css): the storyboard
  sits on the `base` plane; the command bar uses shadow-2; slide cards use shadow-4
  (shadow-8 on hover); the research-queue toast, export callout, and notices use
  shadow-16; the review pane floats at shadow-28; modal dialogs use shadow-64.
  Never add a border where a shadow already separates layers.
- **Navigation**: workflow filters are underline tabs with a 3px brand indicator,
  followed by a single command bar. Counts appear once, in the tabs.
- **One status per card**: a slide card shows exactly one badge (research,
  review, or notes health, in that priority) using `data-tone`. Skipped slides dim
  their preview instead of adding another label.
- **Wait UX**: running work shows a pulse dot plus an indeterminate bar; the review
  pane lists the latest real activity steps and the elapsed start time. Loading
  areas use a skeleton shimmer. Never invent durations or percentages. Ellipses in
  progress copy use a non-breaking space ("Researching&nbsp;…"). All motion respects
  reduced-motion.
- **Research queue**: a floating bottom-left toast at 1000px and above; inline above
  the storyboard on narrower viewports. It remains height-bounded.
- **Handoffs**: Export opens a callout that previews which accepted slides change
  and the copy's file name before creating it. Export errors stay inline in that
  callout. Generated notes open with a third-person bookend ("Copilot drafted these
  notes from N public sources…"), and completion notices state what changed and
  that the original deck was not modified.
- The review pane opens with a breadcrumb (Storyboard › Slide N) and a sticky
  underline view toggle: the editor tab (Proposed, Accepted, or Your notes) /
  Changes / Original notes, with the save state at the end of the tab row.
  Proposal warnings and the Copilot bookend belong to the editor tab only.
- Bilingual notes ("English Version / Dutch Version") are edited one language at a
  time through an English/Dutch toggle; the other section is preserved, both are
  saved and exported, and both must contain text before acceptance.

## Implementation

- Semantic color and typography tokens: [index.css](src/web/src/index.css).
- Production layout and shared controls: [app.css](src/web/src/styles/app.css).
- State-owning shell: [DeckConsole.tsx](src/web/src/components/DeckConsole.tsx).
- Ordered, section-aware tiles: [Storyboard.tsx](src/web/src/components/Storyboard.tsx)
  and [SlideTile.tsx](src/web/src/components/SlideTile.tsx).
- Review and editing: [Workspace.tsx](src/web/src/components/Workspace.tsx)
  and [NotesDesk.tsx](src/web/src/components/NotesDesk.tsx).

## Composition and hierarchy

- The shell keeps deck identity, actual Copilot connectivity/model selection, and
  accepted-note export accessible. Counts are compact and describe real state.
- The storyboard groups consecutive section runs without reordering slides.
  Title/section/number search composes with existing workflow filters.
- A tile link opens review; its separate checkbox selects it for a batch. An
  indigo outline marks the active tile; checked selection and a tinted label
  mark batch membership. Never nest these controls.
- The visible slide content is explicitly an **extracted content preview**, not
  a rendered PowerPoint thumbnail. Images, charts, tables, hidden slides, and
  missing text receive honest fallbacks.
- Uploaded notes health and research/review workflow are separate dimensions.
  Accepting notes does not retroactively change the original assessment.
- The right-hand panel has a scrolling notes/evidence body and a separate,
  unobscured decision area. Draft, Changes, and Original notes share the reading
  measure instead of squeezing two text columns into a narrow panel.

## Trust and interaction

- Notes and export are persisted only after successful API responses. Failed
  requests leave drafts intact and expose retryable errors. Export fetches and
  validates the response before starting a download.
- Notes editors are identified by slide, not by incidental SSE object identity.
  Navigation, closing, and browser history protect dirty drafts.
- Save-and-continue for an unaccepted draft is explicitly **Accept and continue**:
  it saves for export, not to a private draft store. Destructive research and
  discard actions offer stay/discard, not an accept-then-overwrite shortcut.
- Warnings remain beside the draft and are called out at acceptance. Sources
  link to the actual returned URLs. Confidence is model-reported, not calibrated;
  proposal creation time is not a source retrieval date.
- AI emphasis belongs to generated material and research, not ordinary navigation.
  Word-count guidance is advisory. No instruction-driven revision action is shown.
- Research state and review counts are announced, but individual activity-log
  lines are not streamed into a live region.
- A collapsible, height-bounded research queue floats above both storyboard and
  review. Running and queued slides have separate lists, in server submission
  order, unaffected by search or filters. Links use the normal dirty-draft guard.
  Each waiting slide has Remove; each running slide has Stop. Stopping remains
  visible and disabled until the backend confirms completion. Stop all is
  explicitly deck-wide; the review-panel stop is slide-only.
- Queue loading and failures are explicit and retryable. The displayed parallel
  limit comes from the server and is labelled as shared across all decks.
  At viewport heights of 600px or less, the queue defaults to its summary and
  can still be expanded. Review decisions never scroll inside a clipped footer;
  exceptionally constrained review panes scroll as a whole when necessary.

## Responsive and accessible behavior

- At 1000px and above, an adaptive preview grid sits beside the review panel.
- Below 1000px, the existing slide hash route chooses full-width review or the
  storyboard. Returning retains the storyboard scroll position and focuses the
  previously opened tile. The all-decks link and model picker remain accessible.
- J/K navigate visible search/filter results, not the entire hidden deck.
  Typing, modified shortcuts, and an open confirmation dialog take precedence.
- Native controls, visible focus, semantic headings, labeled states, and reduced
  motion are required. Text/signal token pairs meet WCAG AA text contrast.

## Reference and boundaries

The galleries at `#/mockups/storyboard` and `#/mockups/fluent2` remain isolated reference material with
fixture data and their own styles. The production storyboard does not use their
state or components. Pixel-accurate thumbnails, calibrated confidence, claim verification,
and chat-based revision are not shipped capabilities.
