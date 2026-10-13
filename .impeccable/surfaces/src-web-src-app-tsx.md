---
version: 1
slug: "src-web-src-app-tsx"
primary_target: "src/web/src/App.tsx"
related_targets: []
---

# Notes Enricher storyboard

Visitor mode: **Operate**.

Scope: the production deck storyboard, adjacent notes review, and shared shell
controls in `src/web`. Upload and deck management retain their existing information
architecture. The user selected Storyboard from `#/mockups/storyboard`; it replaces
the unconfirmed strip-bay direction.

## Direction contract

THESIS: Keep the deck's narrative visible while the presenter decides which notes
to trust and export.

OWN-WORLD: Neutral canvas, white reading surfaces, restrained indigo actions,
Segoe UI, modest radii, and clear, text-labeled workflow signals. Fluent-inspired,
using existing React/native/Lucide primitives.

STORY: Scan the deck in original order; search or filter; research an intentional
selection; review the original, editable draft, real diff and provenance; accept;
export an enriched copy without changing the original.

FIRST VIEWPORT: Deck identity, actual Copilot status/model, and accepted-note export
above the storyboard. Ordered section groups and content-preview tiles take the
main area; a readable right panel provides review. Below 1000px the hash route
switches between full-width storyboard and review.

FORM: The selected Storyboard composition, as specified in
[the implementation plan](../../STORYBOARD-IMPLEMENTATION-PLAN.md).

## Behavioral contract

- Active tile and batch selection are separate controls and visual states.
- Search composes with workflow filters; counts identify their scope.
- Preview text is not a rendered slide; no unsupported thumbnail fidelity claim.
- Dirty edits survive incidental live updates. Navigation and closing offer
  stay/discard, with explicit save or acceptance before continuing when valid.
- Warnings stay near the draft and decisions; actual source URLs and
  model-reported confidence never become invented verification.
- Changes reuse the real word diff. Manual notes, acceptance, rejection, undo,
  retries, cancellation, model selection and export remain wired to the API.
- Export validates the response before downloading; failed decisions do not
  erase edits or announce success.
- Reconnect, failure, missing data, and empty results have explicit states.
- A bounded, collapsible queue is available from storyboard and review, including
  mobile. Separate running/queued lists show per-slide Stop/Remove, pending and
  stopping states, and recoverable errors. Removing/stopping never cancels a
  sibling slide. Stop all remains deck-wide. Queue links protect dirty edits;
  the concurrency limit is server-supplied and shared across all decks. Short
  viewports default to the expandable queue summary, preserving review decisions.
- The gallery remains a separate reference, not production behavior.

## Verification

Focused component/state tests, network-stubbed browser workflows, a 78-slide
bilingual responsive fixture, and native API/PPTX export regressions cover the
migration. No premium Copilot requests are used in routine validation.
