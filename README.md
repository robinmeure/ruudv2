# PPTX Notes Enricher

Reads a PowerPoint deck, assesses every slide's content and speaker notes, and enriches weak notes with web research done by **your own GitHub Copilot CLI**. Research uses `web_search` / `web_fetch` and Microsoft's Release Communications MCP server for authoritative Azure Updates. An optional browser-local multilingual embedding model finds related slides, likely duplicates and deck topics without sending slide text to an embedding service. You review each proposal against the current notes, accept, edit or reject it, and export a copy of the deck with the accepted notes. The original file is never modified.

- **Frontend:** React 19 + TypeScript + Vite (`src/web`)
- **Backend:** .NET 10 minimal API with the Open XML SDK and the GitHub Copilot SDK (`src/PptxEnricher.Api`)
- **Orchestration:** Aspire AppHost (`src/PptxEnricher.AppHost`) starts your Copilot CLI headless, the API and the web app
- **Local similarity:** Transformers.js runs the quantized `Xenova/multilingual-e5-small` embedding model in a Web Worker
- **Tests:** xUnit (`tests/PptxEnricher.Api.Tests`), Vitest components/state and Playwright workflows (`src/web`)

## Quick start

### 1. Install prerequisites (once)

- [.NET 10 SDK](https://dotnet.microsoft.com/download)
- [Node.js](https://nodejs.org) 24 LTS, or 22.13 or newer (required by the Vite and ESLint versions in `src/web`)
- [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli) on your `PATH`, signed in once with `copilot` → `/login` (or `GH_TOKEN`/`GITHUB_TOKEN` set). An active Copilot subscription is required.
- A current browser with WebAssembly, Web Workers, Cache API and IndexedDB support. Slide comparison also needs one-time access to Hugging Face to download the embedding model.

You do not need the Aspire CLI, a separate API key, an Azure credential, or custom configuration.

### 2. Start the application

Open PowerShell in the repository root. On your first run:

```powershell
Set-Location src\web
npm install
Set-Location ..\..
dotnet run --project src\PptxEnricher.AppHost
```

For subsequent starts, only run this from the repository root:

```powershell
dotnet run --project src\PptxEnricher.AppHost
```

.NET restores its packages automatically. The AppHost starts Copilot, the API, and the web app together; leave this terminal running. Press **Ctrl+C** to stop them.

### 3. Open and use the app

Open the Aspire dashboard URL printed in the terminal, then click the **web** resource's endpoint. Use that URL rather than assuming a fixed web port.

Upload a `.pptx` → optionally **Compare slides** to find duplicates and topics → **Research flagged** (or select slides to research) → review and accept notes → **Export**.

- Research uses your Copilot account and can consume premium requests.
- Slide comparison runs locally in the browser and uses no Copilot requests. The first comparison downloads about 120 MB from Hugging Face; later runs reuse the browser cache.
- The original file is never modified.

<details>
<summary>Advanced startup options and how the AppHost works</summary>

If you already use the [Aspire CLI](https://aspire.dev), you can alternatively start the application with:

```powershell
Set-Location src\PptxEnricher.AppHost
aspire run
```

The AppHost:

1. Finds your `copilot` install on `PATH` (on Windows the npm shim is started through `node` so it shuts down cleanly) and runs `copilot --headless --port 4321` with a random per-run connection token.
2. Starts the API with `Copilot__CliUrl` and `Copilot__ConnectionToken` pointing at that CLI.
3. Starts Vite, which proxies `/api` to the API.

To reuse a CLI you already run (`copilot --headless --port 4321`), set `Copilot:CliUrl` (and `Copilot:ConnectionToken` if you set `COPILOT_CONNECTION_TOKEN`) in the [AppHost configuration](#configuration); the AppHost then won't start a CLI of its own.

### Without Aspire

```powershell
copilot --headless --port 4321                         # terminal 1
dotnet run --project src\PptxEnricher.Api                # terminal 2, http://localhost:5137
cd src\web; npm run dev                                  # terminal 3, http://localhost:5173
```

Run each line in a separate terminal, starting from the repository root, after installing the frontend dependencies.

</details>

## Storyboard workflow

The normal deck view is an ordered, section-aware storyboard with an adjacent
speaker-notes review panel. Tiles show **extracted content previews**, not
pixel-accurate PowerPoint thumbnails.

- Search by title, section, or slide number and combine this with workflow filters.
  Select-visible acts only on current results; other selected slides remain selected.
- Click a tile to open review; use its separate checkbox for batch research.
  J/K navigate the visible results when you are not typing.
- The live research queue separates running and waiting slides, in submission
  order, independently of storyboard filters. It stays available during review
  and on mobile. Remove a waiting slide or stop one running slide without
  cancelling its batch siblings. **Stop all** still cancels this deck's work.
  On short screens, the queue starts collapsed to preserve review space; use
  **Show queue** to expand it.
- Review Draft, Changes, and Original notes. Edit generated or accepted notes,
  write manual notes, accept/reject, undo decisions, or research again.
- Unsaved changes survive live updates. Navigation offers stay/discard and, when
  valid, save-and-continue. **Accept and continue** saves unaccepted notes for
  export; there is no private-draft persistence endpoint.
- Source links show provenance, not independent verification. Warnings remain
  visible near review decisions; confidence is model-reported.
- On narrow screens, return to the storyboard to retain your scroll position.
  Model selection and all-decks navigation remain available.
- Export is enabled only for accepted notes. The response is checked before a
  download begins, so API errors do not become downloaded error files.

The self-contained gallery remains at `#/mockups/storyboard`. Its simulated
content and revision controls are reference material, not production features.

## How it works

### Reading and assessing the PPTX

`PptxReader` opens the deck with the Open XML SDK and walks slides in presentation order (`SlideIdList`). Per slide it collects the title, every text paragraph (shapes, groups, tables), the section (PowerPoint 2010 section list), the layout name, hidden state, pictures and their meaningful alt text, charts, and the speaker notes from the notes slide's body placeholder.

`SlideAssessor` then scores each slide:

| Check | Rule |
|---|---|
| Notes status | `Missing`, `PlaceholderOnly` (no letters, e.g. just a number, or the default "Click to add notes" text), `Thin` (< 40 words) or `Ok` |
| Coverage | Share of the slide's key terms (English and Dutch stop words removed) that appear in the notes; < 30% is flagged |
| Sources | Whether the notes contain a URL |
| Time-sensitive | Years, quarters and months, retirement/deprecation/end-of-life, GA/availability, preview, announcement/launch/release, roadmap or update language on the slide (English and Dutch) |
| Kind | Title, Section, Agenda, Legal, Closing or Content; non-content and hidden slides are suggested to skip |

A slide is **flagged** when it isn't a skip candidate and its notes are not OK, cover too little, or make time-sensitive claims without sources.

### Enriching with your Copilot CLI

`CopilotConnection` holds one `CopilotClient` (GitHub.Copilot.SDK) connected to the headless CLI. Because the CLI runs as you, it reuses your `copilot` sign-in, entitlement and model list; no separate API key is involved. The model picker in the console bar lists your available models; "CLI default" leaves the choice to the CLI.

For each slide, `SlideEnricher` creates a fresh session that:

- exposes only the `web_search` and `web_fetch` tools, plus two read-only Azure Updates tools (`get_recent_azure_updates`, `get_azure_update_by_id`) from Microsoft's [Release Communications MCP server](https://learn.microsoft.com/en-us/microsoft-365/admin/manage/mrc-mcp) (`ToolPolicy.AvailableTools`). Pages on `azure.microsoft.com`, including Azure Updates, render client-side and come back empty with `web_fetch`; the MCP server returns the same updates (release status, dates, products) as data, without authentication. Set `Copilot:ReleaseCommunicationsMcpUrl` to empty to turn it off.
- approves permission requests only for public `http(s)` fetches, GitHub's web search and the two Azure Updates tools. Shell, file reads and writes, other MCP tools, and loopback/private/link-local addresses are denied, because fetched pages are untrusted input.
- appends a system message (`PromptBuilder`): fixed guardrails plus the speaker-notes instructions in [`Enrichment/Prompts/speaker-notes-instructions.md`](src/PptxEnricher.Api/Enrichment/Prompts/speaker-notes-instructions.md), an embedded resource you can edit without touching code. The per-slide prompt adds deck context, today's date, existing notes, the links found on the slide and in its notes, the assessment and the word budget. Copilot answers with structured JSON (`SendAndWaitAsync<EnrichmentResponse>`).
- is deleted afterwards so enrichment runs don't clutter your session history (`Copilot:DeleteSessions`)

The instructions ask for release-update speaker notes that explain why an update matters to the customer, in plain language for a mixed L100–L200 audience:

- Notes are always bilingual: an `English Version` section, a blank line, then a `Dutch Version` section, each 3 to 5 sentences within its share of the word budget. Title, agenda, section and closing slides get 1 to 3 sentences and normally no research.
- Notes contain no URLs, citations or attribution. Sources go to the research file, and every key fact points to its source with `[n]` (matching the numbered source list) or `[slide]`.
- Release statuses (Public Preview, Private Preview, General Availability) and a list of technical terms stay in English in the Dutch version. The Dutch version uses "je", and "uitfaseren" for retirements.
- The instructions tell Copilot to stop after at most 8 tool calls; this is a prompt instruction, not a limit enforced in code. When a source can't be reached or doesn't confirm a claim, Copilot says so in `warnings` and lowers `confidence`.

`SpeakerNotesRules` checks the measurable rules in code: the layout, links and citations, attribution, bullets, avoided words (English and Dutch), translated technical terms, "u"/"uw", length and sentence count. When a hard rule is broken, `SlideEnricher` asks Copilot once to repair its answer in the same session (`Copilot:RepairAttempts`). Anything still wrong appears as a `Format check:` warning in the research file.

`EnrichmentJobQueue` uses one FIFO queue and **four concurrent workers by default**,
shared across every deck and batch. Each slide has its own Copilot session; a
freed worker immediately takes the next waiting slide rather than waiting for
the entire batch. Batch claims are persisted in one deck snapshot, not once per
slide. Higher parallelism increases simultaneous requests and may encounter
provider limits; it does not guarantee a fourfold speedup.

Progress and queue changes stream over server-sent events. The UI also refreshes
an active queue every five seconds and reconciles on reconnect/heartbeat. Removing
a queued item prevents it from invoking Copilot. Stopping a running slide is
cooperative: it remains **Stopping** and occupies its worker until its session
exits. Premium requests already used cannot be undone. Cancellation/failure keeps
the previous proposal and accepted notes; a successful new proposal replaces them
and requires review again. Job identity prevents a stale stop request or callback
from affecting a newer run. Shutdown cancels queued and running work; interrupted
work is recovered as cancelled on restart.

### Finding similar slides

The whole deck is compared at once. Comparison is opt-in: the model is not downloaded until you choose **Compare slides** at the top of the storyboard or **Find similar slides** in the review workspace. Both reuse the slide text the API already returns, so no extra endpoint is involved. The browser:

- removes template lines that repeat across most of the deck (footers, labels);
- embeds each slide's visible text and its notes (accepted notes when present) with [`multilingual-e5-small`](https://huggingface.co/Xenova/multilingual-e5-small) through [Transformers.js](https://huggingface.co/docs/transformers.js) in a Web Worker (WASM, 8-bit quantized);
- caches the vectors in IndexedDB (`slide-embeddings`), keyed by model and text. Only changed text is embedded again, and a deck you have compared before reopens with its results.

The first run downloads the 8-bit quantized model (about 120 MB) from Hugging Face into the browser's Cache API (`transformers-cache`). Inference uses WebAssembly in a background worker, so it does not use a server-side GPU or Python runtime. Later runs load the model from the cache and report "Loading the model from this browser". Slide text stays in the browser and no Copilot requests are used. Both caches are per browser profile and per origin (scheme, host and port), which is why the AppHost pins the web app's port.

The embedding model is currently fixed in `src/web/src/lib/similarity.ts`; it is separate from the Copilot model selected for research. Changing it in source creates a new vector-cache namespace because the model id is part of every IndexedDB key.

Matches are labelled as follows:

- **Identical text**: the same normalized visible text.
- **Likely duplicate**: at least 80% shared words, or cosine ≥ 0.95 with at least 60% shared words.
- **Related**: cosine at least two standard deviations above the deck's mean slide-to-slide similarity, and never below 0.88.

Slides with fewer than four meaningful words are only checked for identical text.

When the comparison is ready:

- The storyboard shows how many likely-duplicate sets and topics the deck has.
- **Group by** switches between **Sections**, **Topics** and **Duplicates**. <kbd>J</kbd>/<kbd>K</kbd> follow the grouped order.
- Each slide card shows a warning badge when it is a likely duplicate of other slides, and a topic chip. The chip is hidden when the storyboard is already grouped by topic.
- The card's single workflow status is unchanged.

Duplicate sets join identical and likely-duplicate pairs transitively.

Topics come from average-linkage clustering of the visible-text vectors, at 1.5 standard deviations above the deck mean (never below 0.88). Each topic is named after the title words that at least two of its slides share and that the rest of the deck mostly lacks.

The rules live in `src/web/src/lib/similarity.ts`. The thresholds are provisional and should be calibrated against labelled slide pairs. Text inside images, charts beyond their titles, and SmartArt are not compared.

### Writing the export

`PptxNotesWriter` copies the original and replaces the notes body text of each accepted slide, creating the notes slide and its body placeholder when the slide had none. It writes only accepted notes.

## Configuration

No configuration is required for the default setup. Override values only when you need to.

### How to set values

- **Edit the file:** `src\PptxEnricher.Api\appsettings.json` (API) or `src\PptxEnricher.AppHost\appsettings.json` (AppHost). Changes take effect on the next start.
- **Environment variables:** use `__` for nesting, for example `Copilot__Model` or `Storage__Root`. In PowerShell:
  ```powershell
  $env:Copilot__Model = "<model-id>"
  dotnet run --project src\PptxEnricher.AppHost
  ```
- **Secrets (AppHost):** keep a connection token out of source control with user secrets:
  ```powershell
  dotnet user-secrets set "Copilot:ConnectionToken" "<token>" --project src\PptxEnricher.AppHost
  ```

Environment variables override `appsettings.json`. When you run the API without Aspire, it reads its own `appsettings.json`, so the AppHost settings do not apply.

### Settings

API (`src/PptxEnricher.Api/appsettings.json`, or environment variables such as `Copilot__Model`):

| Key | Default | Purpose |
|---|---|---|
| `Copilot:CliUrl` | `localhost:4321` | Headless CLI address (`host:port`, `tcp://` or `http://`) |
| `Copilot:ConnectionToken` | empty | Must match the CLI's `COPILOT_CONNECTION_TOKEN` when set |
| `Copilot:Model` | empty | Default model id; empty uses the CLI default |
| `Copilot:MaxConcurrency` | `4` | Global parallel slide limit, clamped to 1–8; restart the API after changing it |
| `Copilot:SlideTimeout` | `00:05:00` | Timeout for each Copilot response. A slide that needs a retry or repair turn can take longer in total |
| `Copilot:DeleteSessions` | `true` | Delete each CLI session after use |
| `Copilot:MaxWords` | `250` | Word budget for proposed notes, split over the English and Dutch versions (at least 40 words each) |
| `Copilot:RepairAttempts` | `1` | Follow-up turns asking Copilot to fix notes that break a checked writing rule; each turn costs a premium request, `0` turns repair off |
| `Copilot:ReleaseCommunicationsMcpUrl` | `https://www.microsoft.com/releasecommunications/mcp` | Release Communications MCP server used to look up Azure Updates; must be `https`, empty disables it |
| `Storage:Root` | `%LOCALAPPDATA%\PptxEnricher\decks` | Uploaded decks and review state (`state.json` per deck) |

AppHost (`src/PptxEnricher.AppHost`): `Copilot:CliUrl` and `Copilot:ConnectionToken` (use an existing CLI), `Copilot:Port` (default `4321`), `Copilot:CliPath` (explicit path to the CLI executable), and `Web:Port` (browser port of the web app, default `5173`; keep it fixed so the cached embedding model is reused).

Uploads are limited to 256 MB.

## Validation

```powershell
dotnet test .\tests\PptxEnricher.Api.Tests\PptxEnricher.Api.Tests.csproj
Set-Location .\src\web
npm test
npx playwright install chromium   # once, if the test browser is missing
npm run test:browser
npm run build
npm run lint
```

Frontend tests stub the API and SSE; they do not start Copilot or consume premium
requests. Playwright owns an isolated Vite server on port 5187 and stops it after
the suite. See the [frontend README](src/web/README.md) for Windows runner notes.
Queue tests use controllable fake sessions to verify overlapping workers, the
global cap, immediate refill, removal, isolated stopping, stale or throwing
callbacks, stale requests, requeue order, shutdown, persistence, and API contracts. If a running
Debug API locks its executable on Windows, run `dotnet test -c Release` rather
than interrupting that process.

## API

| Method | Route | |
|---|---|---|
| GET | `/api/copilot/status` | CLI connection, version, signed-in user and models |
| GET / POST | `/api/decks` | List decks / upload a `.pptx` (multipart `file`) |
| GET / DELETE | `/api/decks/{id}` | Deck state / delete |
| GET | `/api/decks/{id}/events` | Server-sent events for the deck |
| GET | `/api/decks/{id}/queue` | `{ maxConcurrency, items: [{ slideNumber, jobId, status, cancellationRequested }] }`; current deck items in submission order, global worker limit |
| POST | `/api/decks/{id}/enrich` | Enrich the flagged slides, or `{ "slides": [..] }`; optional `model` |
| POST | `/api/decks/{id}/cancel` | Cancel all work on the deck |
| POST | `/api/decks/{id}/slides/{n}/enrich` | Enrich one slide |
| POST | `/api/decks/{id}/slides/{n}/cancel` | `{ "jobId": "current-job-id" }`; remove/stop only this slide, returning updated slide state; 409 if that run is no longer active |
| PUT | `/api/decks/{id}/slides/{n}/review` | `{ "status": "accepted" \| "rejected" \| "pending", "notes": ".." }` |
| GET | `/api/decks/{id}/export` | Download `<name>-enriched.pptx` |
| POST | `/api/jobs/{jobId}/cancel` | Cancel one job |

## Development

```powershell
dotnet test                                # backend tests
cd src\web; npm run lint; npm run build    # frontend checks
```

## Things to know

- **Cost and time:** each slide enrichment sends one initial Copilot request on your account, billed as premium requests according to the model you pick. An unusable answer triggers one automatic retry, and writing-rule violations trigger up to `Copilot:RepairAttempts` further requests, each of which can also be billed. A slide typically takes 40 seconds to 3 minutes, but this varies by model and sources.
- **Research activity:** while a slide is researched, the panel shows the latest eight steps live: the model's stated plan, a short summary of its reasoning (when the model provides one), each search or page it opens, and what every tool returned (with its size). Failures and blocked actions are highlighted. The full log (up to 120 lines) is under "Research activity" and is kept in memory only.
- **Azure Updates need internet access to `www.microsoft.com`:** if that host is unreachable (for example behind a proxy or DNS filter), the Azure Updates tools fail and the slide falls back to `web_search`/`web_fetch`, usually with lower confidence.
- **Embedding download needs internet access to Hugging Face:** after the first successful download the model is reused from the browser's Cache API. Changing browser profile, scheme, host or `Web:Port`, using private browsing, or clearing site data causes another download. Cached slide vectors are likewise removed when site data is cleared.
- **Copilot and embedding models are independent:** the model picker changes the generative model used for research. Slide comparison always uses the browser-local `multilingual-e5-small` model and never consumes Copilot premium requests.
- **Experimental SDK APIs:** the API suppresses `GHCP001` because the SDK marks `PermissionDecision` and typed `SendAndWaitAsync<T>` as experimental.
- **Review is required:** nothing reaches the deck without an explicit accept, and the export is always a new file.
- **Design system:** see [DESIGN.md](DESIGN.md) and [PRODUCT.md](PRODUCT.md).
