# Product

<!-- impeccable:product-schema 1 -->

> Facts marked _(inferred)_ were derived from the original request and build plan because the user was not available to confirm them. Correct them when convenient.

## Platform

web

## Users

- _(inferred)_ Primary: a presenter (e.g. a Microsoft seller or solution engineer) preparing a large customer or partner deck (75+ slides) before delivering it, often a deck they did not write themselves.
- _(inferred)_ They work alone at a desktop, in one focused session, moving slide by slide and deciding which notes to trust.

## Product Purpose

PPTX Notes Enricher reads a PowerPoint deck and assesses every slide's content and speaker notes, flagging notes that are missing, thin, placeholder-only, without sources, or containing time-sensitive claims. For flagged or chosen slides, it researches the slide's topic on the web through the user's own GitHub Copilot CLI and proposes presenter-ready speaker notes with key facts, sources, and warnings. The user reviews, edits, and accepts or rejects each proposal, then exports a copy of the deck with the accepted notes. The original file is never modified.

_(inferred)_ Success: every slide the presenter cares about has notes they trust, with sources, and the enriched copy is exported in one go.

## Positioning

The research runs as the current user through their locally installed, already signed-in GitHub Copilot CLI (`web_search` / `web_fetch`), so no extra API keys or services are involved. A strict tool policy allows only public web reads; no shell, file writes, or private network access.

## Operating Context

- Runs locally: an Aspire AppHost starts the Copilot CLI in headless mode, the .NET 10 API, and the Vite React app.
- Input is a `.pptx` file uploaded from disk. Output is a new `<name>-enriched.pptx` download.
- Enriching one slide takes about 2–3 minutes and costs Copilot premium requests. Progress (searches, page reads) streams live over server-sent events.
- Decks are presented to Dutch and English audiences. Enriched notes always contain an English version and a Dutch version, with release statuses and technical terms kept in English, so the presenter can switch language without a second research run.

## Capabilities and Constraints

- Per-slide assessment: slide kind (title/section/content/structural), notes status (Missing, PlaceholderOnly, Thin, Ok), flags (has sources, time-sensitive), and reasons; structural slides suggest skipping.
- Enrichment per slide or as a batch (flagged slides, or a manual multi-selection), with cancel per job or per deck.
- Review: an editable proposal with a diff against the current notes, plus key facts, sources, warnings, confidence, model, and an activity log. Actions: accept (with edits), reject, undo, re-enrich, or write notes manually.
- Model selection comes from the user's Copilot model list. Billing multipliers are not reported by the CLI, so they are not shown.
- Export writes accepted notes only, into a copy.

## Evidence on Hand

- A real 75-slide sample deck sits in the repository root. Most of its slides already have ~120-word notes with links, so the UI must make "everything is fine" states calm and the few problem slides obvious.
- No testimonials, customers, or metrics exist; none may be invented.

## Product Principles

1. The presenter stays in control: nothing is written into the deck without explicit acceptance.
2. Show provenance: every enriched claim should trace back to a visible source.
3. Be honest about cost and time: enrichment is slow and uses premium requests, so make it deliberate and its progress visible.
4. Quiet when healthy, loud when not: surface the slides that need attention without crying wolf on the rest.

## Accessibility & Inclusion

_(inferred)_ Keyboard-operable review flow (move between slides, accept/reject) and WCAG AA contrast; no product-specific requirement beyond that was established.
