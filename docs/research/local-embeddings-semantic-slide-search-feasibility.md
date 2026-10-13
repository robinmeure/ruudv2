# Feasibility Report: Local Embeddings + Semantic Search for Duplicate/Similar Slide Detection

**Scope:** Feasibility of adding local-only embedding generation and semantic similarity/clustering to PPTX Notes Enricher, a .NET 10/C# application that parses `.pptx` files via the Open XML SDK and shells out to a locally installed, signed-in `copilot` CLI (headless mode, restricted to `web_search`/`web_fetch`) for notes research/enrichment.

**Citation discipline:** Every factual claim below is followed by an inline URL to a primary source (official Microsoft Learn / Open XML SDK docs, official Hugging Face model cards, official library docs/GitHub repos, official GitHub Copilot CLI docs, or the official Model Context Protocol spec). Anything that is this report's own synthesis/opinion is explicitly marked **Recommendation:**.

---

## 1. Extraction fidelity and limitations from PPTX via Open XML SDK (C#)

### 1.1 Document/part model and slide enumeration

A `.pptx` is opened as a `PresentationDocument` (namespace `DocumentFormat.OpenXml.Packaging`), whose `PresentationPart` exposes the `Presentation` root element and the collection of slides. Slides are enumerated via `PresentationPart.SlideParts` (an `IEnumerable<SlidePart>`), and the canonical Microsoft sample resolves the *ordered* slide list from `presentation.xml`'s `<p:sldIdLst>/<p:sldId>` elements, each carrying a relationship id (`r:id`) that is resolved to the actual `SlidePart` via `PresentationPart.GetPartById(relId)`:

```csharp
PresentationPart? presentationPart = presentationDocument.PresentationPart;
slidesCount = presentationPart.SlideParts.Count();
OpenXmlElementList slideIds = part?.Presentation?.SlideIdList?.ChildElements ?? default;
string? relId = ((SlideId)slideIds[index]).RelationshipId;
SlidePart slide = (SlidePart)part.GetPartById(relId);
```
— [How to: Get all the text in all slides in a presentation](https://learn.microsoft.com/office/open-xml/presentation/how-to-get-all-the-text-in-all-slides-in-a-presentation); class references: [`PresentationPart.SlideParts`](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.presentationpart.slideparts), [`PresentationDocument`](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.presentationdocument), [`SlidePart`](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.slidepart).

The relationship model (slide-id-list → relationship-id → part, resolved via the package's `.rels` XML) is described structurally in [Structure of a PresentationML document](https://learn.microsoft.com/office/open-xml/presentation/structure-of-a-presentationml-document), and the broader object model is introduced in [Working with presentations](https://learn.microsoft.com/office/open-xml/presentation/working-with-presentations) and [Working with presentation slides](https://learn.microsoft.com/office/open-xml/presentation/working-with-presentation-slides).

### 1.2 Shape text extraction (DrawingML txBody/paragraphs/runs)

Each slide's root element is `Slide` (`<sld/>`), which — per the official how-to table — "is the root element of SlidePart" ([how-to-get-all-the-text-in-all-slides-in-a-presentation](https://learn.microsoft.com/office/open-xml/presentation/how-to-get-all-the-text-in-all-slides-in-a-presentation)). The simplest and officially demonstrated way to pull plain text out of a slide is a `Descendants<A.Text>()` scan over the whole shape tree, where `A` = `DocumentFormat.OpenXml.Drawing`:

```csharp
IEnumerable<A.Text> texts = slide.Slide.Descendants<A.Text>();
foreach (A.Text text in texts) { paragraphText.Append(text.Text); }
```
— same how-to page above.

Structurally, a shape (`P.Shape`, namespace `DocumentFormat.OpenXml.Presentation`) is composed of `NonVisualShapeProperties`, `ShapeProperties`, and a DrawingML `TextBody`, whose children are `Paragraph` (`a:p`) and `Run` (`a:r`), both in `DocumentFormat.OpenXml.Drawing`: "The `TextBody` contains the [Paragraph], that has a [Run], which contains the text" — [Working with notes slides](https://learn.microsoft.com/office/open-xml/presentation/working-with-notes-slides#open-xml-sdk-code-example) (the same shape pattern is used for ordinary slides, per [Working with presentation slides](https://learn.microsoft.com/office/open-xml/presentation/working-with-presentation-slides#open-xml-sdk-code-example)).

### 1.3 Tables (`a:tbl`)

`a:tbl` maps to `DocumentFormat.OpenXml.Drawing.Table`, whose declared child element is `TableRow`:
```csharp
[ChildElementInfo(typeof(DocumentFormat.OpenXml.Drawing.TableRow))]
[SchemaAttr(10, "tbl")]
public class Table : DocumentFormat.OpenXml.OpenXmlCompositeElement
```
— [`Table` class reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.drawing.table). `TableCell` is documented separately, also in `DocumentFormat.OpenXml.Drawing` — [`TableCell` class reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.drawing.tablecell). Table text is reachable with the same `Descendants<A.Text>()` pattern since cells ultimately contain `txBody`/paragraph/run structures.

### 1.4 Charts — text lives outside the slide shape tree

A chart on a slide is hosted inside a `GraphicFrame` (`DocumentFormat.OpenXml.Presentation`) — [`GraphicFrame` class reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.presentation.graphicframe) — whose graphic data references a **separate** `ChartPart` via a relationship. `ChartPart`'s own class signature documents relationships to an `EmbeddedPackagePart` (the embedded Excel workbook with the chart's underlying data) and an `ImagePart` (fallback image):
```csharp
public class ChartPart : OpenXmlPart,
    IFixedContentTypePart,
    ISupportedRelationship<EmbeddedPackagePart>,
    ISupportedRelationship<ImagePart>
```
— [`ChartPart` class reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.chartpart?view=openxml-3.0.1). The chart's DOM root, `ChartSpace` (`c:chartSpace`, namespace `DocumentFormat.OpenXml.Drawing.Charts`), exposes a back-reference `ChartSpace.ChartPart` ("Gets the ChartPart associated with this element") and a `ChartSpace.Save(ChartPart)` method that persists the chart DOM tree into that part — [`ChartSpace.ChartPart`](https://learn.microsoft.com/dotnet/api/documentformat.openxml.drawing.charts.chartspace.chartpart?view=openxml-3.0.1), [`ChartSpace.Save`](https://learn.microsoft.com/dotnet/api/documentformat.openxml.drawing.charts.chartspace.save?view=openxml-3.0.1). **Practical implication (verified from API shape, not a single prose statement):** chart categories, series names, and data values live in the chart's own `c:chart` XML (and/or the embedded workbook package), not inline as DrawingML shape text on the slide — so a naive `Descendants<A.Text>()` slide scan will **miss** chart content entirely; it must be extracted separately by walking each slide's `GraphicFrame` → chart relationship → `ChartPart`.

*Gap:* no single Microsoft Learn conceptual ("how-to"/"working with") page specifically titled for presentation-hosted charts was located; the closest official how-to covers spreadsheet-hosted charts ([Insert a chart into a spreadsheet](https://learn.microsoft.com/office/open-xml/spreadsheet/how-to-insert-a-chart-into-a-spreadsheet)), which targets `WorksheetPart` rather than `SlidePart`.

### 1.5 SmartArt / diagrams — text lives in a separate data-model part

A SmartArt diagram is likewise hosted in a `GraphicFrame`, with its real content living in a distinct `DiagramDataPart`:
```csharp
public class DiagramDataPart : OpenXmlPart, IFixedContentTypePart
```
— [`DiagramDataPart` class reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.diagramdatapart), which also supports a relationship to an `ImagePart` (layout preview), reinforcing that it is a distinct XML part from the slide's shape tree, namespace `DocumentFormat.OpenXml.Packaging`. **Practical implication (inferred from part/class structure, not a quoted prose statement — flagged as a gap):** SmartArt text/node data lives in the diagram data model XML (`dgm:` namespace), not inline inside the `graphicFrame` on the slide, by the same "separate referenced part" pattern confirmed explicitly for charts above. No dedicated conceptual Microsoft Learn page on SmartArt/diagrams in PresentationML was found to directly quote this in prose.

### 1.6 Images — no OCR capability

`ImagePart` (`DocumentFormat.OpenXml.Packaging`) exposes only binary stream accessors inherited from the base part type — `GetStream()`, `GetStream(FileMode, FileAccess)`, `GetStream(FileMode)` — and no text-recognition member anywhere on the class: [`ImagePart` class reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.imagepart). **Verified absence, not a quoted "no OCR" statement:** the SDK's own member list confirms it provides only raw binary image retrieval; any text-in-images extraction requires a separate OCR step/library outside the Open XML SDK's scope.

### 1.7 Speaker notes

`SlidePart.NotesSlidePart` ("Gets the NotesSlidePart of the SlidePart" — [property reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.slidepart.notesslidepart?view=openxml-3.0.1)) returns the associated `NotesSlidePart` ([class reference](https://learn.microsoft.com/dotnet/api/documentformat.openxml.packaging.notesslidepart)), whose root `NotesSlide` element follows the identical `CommonSlideData → ShapeTree → Shape → TextBody → Paragraph/Run` structure as an ordinary slide: "The `<notes/>` element is the root element of the PresentationML Notes Slide part... The `TextBody` contains the [Paragraph], that has a [Run], which contains the text of the note" — [Working with notes slides](https://learn.microsoft.com/office/open-xml/presentation/working-with-notes-slides#open-xml-sdk-code-example). Notes text extraction therefore uses the same `Descendants<A.Text>()` pattern as slide body text, just rooted at the `NotesSlidePart`'s `Slide`-equivalent document.

### 1.8 Summary table

| Content type | Where the text actually lives | SDK class(es) | Fidelity risk |
|---|---|---|---|
| Shape text | Inline, `a:txBody`→`a:p`→`a:r`→`a:t` | `Shape`, `TextBody`, `Paragraph`, `Run`, `Text` | Low |
| Table cells | Inline, inside `a:tbl`→`a:tr`→`a:tc`→`a:txBody` | `Table`, `TableRow`, `TableCell` | Low |
| Charts | Separate `ChartPart` XML (+ embedded workbook) | `GraphicFrame`, `ChartPart`, `ChartSpace` | **High** — missed by naive shape-text scan |
| SmartArt | Separate `DiagramDataPart` XML | `GraphicFrame`, `DiagramDataPart` | **High** — missed by naive shape-text scan |
| Images | Binary only, no text | `ImagePart` | **High** — requires external OCR |
| Speaker notes | Inline in `NotesSlidePart`, same txBody pattern | `NotesSlidePart`, `NotesSlide` | Low (separate traversal root) |

---

## 2. Recommended data model

**Recommendation (this entire section is this report's own synthesis, not sourced from any API/spec):**

A two-level schema — slide-level aggregate for coarse similarity/dedup, and shape/chunk-level records for provenance and finer-grained matching — is proposed:

```text
Deck
 ├─ DeckId, FilePath, FileHash, ExtractedAtUtc
 └─ Slides[]
     ├─ SlideId            // stable index or a:cSld-derived id
     ├─ SlideIndex          // 0-based order per sldIdLst
     ├─ ContentHash         // hash of concatenated normalized text, for incremental re-embedding (see §7)
     ├─ TitleText
     ├─ BodyText            // concatenated shape-text (txBody) only
     ├─ NotesText           // from NotesSlidePart
     ├─ TableText[]         // one entry per a:tbl, row-major flattened
     ├─ ChartText[]         // category/series names pulled from ChartPart; flagged "chart" source
     ├─ SmartArtText[]      // node text pulled from DiagramDataPart; flagged "smartart" source
     ├─ ImageAltText[]      // only if alt-text/description present on the shape; no OCR by default
     ├─ SlideEmbedding      // single vector over a composed "representative text" (e.g. title + body + notes)
     └─ Chunks[]
         ├─ ChunkId
         ├─ SourceType      // enum: ShapeText | TableCell | ChartSeries | SmartArtNode | Notes
         ├─ SourceRef       // e.g. shape id / relationship id / table row-col / chart series index — for traceability back into the OOXML part
         ├─ Text
         └─ ChunkEmbedding
```

**Recommendation:** Keep both a slide-level embedding (for fast deck-wide "similar slides" queries) and chunk-level embeddings (for explaining *why* two slides matched, and for chart/SmartArt/table content that may be semantically distinct from the slide's narrative text). `SourceType`/`SourceRef` tags make it possible to show the user "these two slides are similar because of matching chart data" vs. "matching body text," and to re-extract/re-embed only the changed sub-part when the deck is edited (see §7).

---

## 3. Local embedding models and hardware/privacy tradeoffs

All model facts below are sourced from each model's official Hugging Face model card / config files, cross-checked via the HF API metadata endpoint for license/tag ground truth.

| Model | Dim | Max tokens | License | Size (params) | Dutch+English multilingual? | ONNX/CPU |
|---|---|---|---|---|---|---|
| `sentence-transformers/all-MiniLM-L6-v2` | 384 | 256 (truncation default; arch max 512) | Apache-2.0 | ~22.7M | **No** — English only | ONNX variants shipped in repo |
| `BAAI/bge-small-en-v1.5` | 384 | 512 | MIT | ~33.4M | **No** — English only (card points to `bge-m3` for multilingual) | `onnx`/`safetensors` tags present |
| `BAAI/bge-base-en-v1.5` | 768 | 512 | MIT | ~109.5M | **No** — English only | same |
| `intfloat/multilingual-e5-small` | 384 | 512 | MIT | ~117.7M | **Yes** — "supports 100 languages from xlm-roberta," HF language tags include both `nl` and `en` | `onnx`, `openvino` tags present |
| `intfloat/multilingual-e5-base` | 768 | 512 | MIT | ~278M | **Yes** — same quote, `nl`+`en` tags | same |
| `nomic-ai/nomic-embed-text-v1.5` | 768 (Matryoshka down to 512/256/128/64) | 8192 | Apache-2.0 | ~136.7M | Not stated as multilingual (English tag only) | `onnx` tag present; Transformers.js (ONNX Runtime Web) samples on card |
| `microsoft/bitnet-embedding-0.6b` | 1,024 | 32,768 | MIT | ~0.6B | **Yes** — card: "a family of multilingual text embedding models," tags include `nl`+`en` | **GGUF only** — no ONNX/safetensors shipped |
| `microsoft/bitnet-embedding-270m` | 640 | 32,768 | MIT | ~270M | **Yes** — same | GGUF only |

Citations: all-MiniLM-L6-v2 [model card](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) ("maps sentences & paragraphs to a 384 dimensional dense vector space... By default, input text longer than 256 word pieces is truncated"), [license/safetensors metadata](https://huggingface.co/api/models/sentence-transformers/all-MiniLM-L6-v2?expand[]=safetensors); bge-small/base [small card](https://huggingface.co/BAAI/bge-small-en-v1.5), [base card](https://huggingface.co/BAAI/bge-base-en-v1.5), [small config](https://huggingface.co/BAAI/bge-small-en-v1.5/raw/main/config.json), [base config](https://huggingface.co/BAAI/bge-base-en-v1.5/raw/main/config.json); multilingual-e5 [small card](https://huggingface.co/intfloat/multilingual-e5-small) ("This model has 12 layers and the embedding size is 384... It supports 100 languages from xlm-roberta"), [base card](https://huggingface.co/intfloat/multilingual-e5-base), language tags via [small API](https://huggingface.co/api/models/intfloat/multilingual-e5-small), [base API](https://huggingface.co/api/models/intfloat/multilingual-e5-base); nomic-embed [model card](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5), [config.json](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/raw/main/config.json); BitNet embeddings [0.6b card](https://huggingface.co/microsoft/bitnet-embedding-0.6b), [270m API](https://huggingface.co/api/models/microsoft/bitnet-embedding-270m) (context length 32,768 confirmed via gguf metadata).

**Key finding for this app's Dutch/English requirement:** among the models checked, only `intfloat/multilingual-e5-small`/`-base` and `microsoft/bitnet-embedding-0.6b`/`-270m` are officially confirmed multilingual with explicit `nl` language tags; `all-MiniLM-L6-v2` and both English-tagged BGE models are explicitly English-only per their own cards.

### CPU-only feasibility

- sentence-transformers officially documents a `device` constructor parameter supporting `"cpu"` explicitly: *"device (str, optional) – Device (like 'cuda', 'cpu', 'mps', 'npu')... Defaults to None [auto-detect]"* — [`SentenceTransformer` class reference](https://www.sbert.net/docs/package_reference/sentence_transformer/model.html).
- ONNX Runtime's execution-provider framework documents the CPU execution provider as the universal default/fallback: *"The ONNX Runtime package can be built with any combination of the EPs along with the default CPU execution provider"* — [ONNX Runtime Execution Providers overview](https://onnxruntime.ai/docs/execution-providers/) (the specific `CPU-ExecutionProvider.html` sub-page 404'd during this research and could not be independently re-verified).
- sentence-transformers has first-party ONNX export/inference support, not just a community add-on: `backend="onnx"` is a documented constructor option, with helpers `export_optimized_onnx_model(..., optimization_config="O1".."O4")` and `export_dynamic_quantized_onnx_model(..., quantization_config="avx512_vnni")` — [Speeding up Inference](https://www.sbert.net/docs/sentence_transformer/usage/efficiency.html).

### .NET-native integration paths (no Python required)

- **Microsoft.ML.OnnxRuntime** is the official NuGet package providing the ONNX Runtime C#/.NET API; ML.NET's `OnnxTransformer` docs state explicitly: *"Models are scored on CPU by default. If GPU execution is needed (optional), use the NuGet package available at Microsoft.ML.OnnxRuntime.Gpu"* — [`OnnxTransformer` class docs](https://learn.microsoft.com/dotnet/api/microsoft.ml.transforms.onnx.onnxtransformer).
- **Microsoft.Extensions.AI** defines a generic `IEmbeddingGenerator<TInput, TEmbedding>` abstraction with a `GenerateAsync` method and an `Embedding<float>` type exposing `ReadOnlyMemory<float> Vector` — [Use the IEmbeddingGenerator interface](https://learn.microsoft.com/dotnet/ai/iembeddinggenerator); [`IEmbeddingGenerator<TInput,TEmbedding>` reference](https://learn.microsoft.com/dotnet/api/microsoft.extensions.ai.iembeddinggenerator-2).
- **Semantic Kernel's ONNX connector** (`Microsoft.SemanticKernel.Connectors.Onnx`, install via `dotnet add package Microsoft.SemanticKernel.Connectors.Onnx --prerelease`) exposes `AddBertOnnxTextEmbeddingGeneration(builder, onnxModelPath, vocabPath, options, serviceId)` for BERT-architecture ONNX embedding models — directly applicable to MiniLM/BGE/E5 (all BERT or XLM-R based) — [Text Embedding generation in Semantic Kernel](https://learn.microsoft.com/semantic-kernel/concepts/ai-services/embedding-generation/); [`AddBertOnnxTextEmbeddingGeneration` method reference](https://learn.microsoft.com/dotnet/api/microsoft.semantickernel.onnxkernelbuilderextensions.addbertonnxtextembeddinggeneration?view=semantic-kernel-dotnet). The connector is explicitly marked experimental (`#pragma warning disable SKEXP0070` required) at time of research.
- Note: Windows ML's "ONNX Runtime GenAI" and `Microsoft.ML.OnnxRuntimeGenAI` packages are documented for **generative** (LLM-style) models, not embeddings, and explicitly "doesn't support function calling" — [ONNX (Agent Framework model providers)](https://learn.microsoft.com/agent-framework/integrations/by-component/model-providers/onnx); this path is **not** the right fit for pure embedding generation — use `Microsoft.ML.OnnxRuntime` + Semantic Kernel's Bert-ONNX connector (or a raw `InferenceSession`) instead.

**Recommendation:** Given the product's Dutch+English requirement, `intfloat/multilingual-e5-small` (384-dim, MIT, ~118M params) is the most attractive default local model: officially multilingual including Dutch, small enough for fast CPU inference, MIT-licensed (no attribution/field-of-use restrictions), and BERT-architecture (compatible with Semantic Kernel's `AddBertOnnxTextEmbeddingGeneration` once exported to ONNX via sentence-transformers' `backend="onnx"` export). `multilingual-e5-base` is a reasonable "better quality, still CPU-feasible" upgrade path if 384 dimensions prove too coarse.

---

## 4. Vector stores

| Tool | What it is | Language bindings | .NET/C# client? | Persistence | ANN vs brute-force guidance |
|---|---|---|---|---|---|
| **sqlite-vec** | "An extremely small, 'fast enough' vector search SQLite extension... successor to sqlite-vss," pure C, no deps — [repo](https://github.com/asg017/sqlite-vec), [docs site](https://alexgarcia.xyz/sqlite-vec/) | C core; loadable as a SQLite extension from any language with SQLite bindings | **Not found** — README's bindings list (`sqlite-ecosystem`, `sqlite-rembed`, `sqlite-lembed`) names no .NET/C# binding | A `vec0` **virtual table** inside an ordinary SQLite file — file-based persistence identical to SQLite itself | Query syntax (`WHERE col MATCH '[...]' ORDER BY distance LIMIT k`) is a KNN scan; README gives no ANN index structure, consistent with its "fast enough" (brute-force-ish) framing |
| **Faiss** | "A library for efficient similarity search and clustering of dense vectors," C++ with Python wrappers, by Meta FAIR — [repo](https://github.com/facebookresearch/faiss) | C++, Python only | **No** | Indexes held in RAM; serialization via `write_index`/`read_index` (not independently re-confirmed this session due to wiki fetch issues) | [Guidelines to choose an index](https://github.com/facebookresearch/faiss/wiki/Guidelines-to-choose-an-index): *"If you plan to perform only a few searches (say 1000-10000)... direct computation is the most efficient option. This is done via a 'Flat' index."* / *"The only index that can guarantee exact results is IndexFlatL2 or IndexFlatIP."* / dataset-size thresholds for IVF cluster count scale from `<1M` up to `100M–1B` vectors |
| **hnswlib** | "Header-only C++ HNSW implementation with python bindings" — [repo](https://github.com/nmslib/hnswlib) | C++, Python; "external support for Java and R" | **No** .NET port mentioned | `saveIndex`/`loadIndex` over C++ streams; Python index is "picklable"; note `ef` parameter isn't persisted and must be reset after load | Purpose-built **approximate** NN library; also ships an exact brute-force `BFIndex` class alongside HNSW as the exact-search baseline |
| **Qdrant** | Vector database/search engine — [docs](https://qdrant.tech/documentation/) | REST/gRPC API-driven; official clients incl. Python/JS/Rust/Java/Go | **Yes, confirmed** — quickstart shows a C# snippet using `Qdrant.Client`/`Qdrant.Client.Grpc` over gRPC | Runs as a local server (e.g. Docker) persisting to disk: *"Under the default configuration all data will be stored in the ./qdrant_storage directory"*; vectors memory-mapped on disk with `cached` (RAM-preloaded, default) vs `cold` (page-cache only) tiers | N/A (full vector DB, always indexed) |

Citations: sqlite-vec [GitHub](https://github.com/asg017/sqlite-vec), [docs](https://alexgarcia.xyz/sqlite-vec/); Faiss [GitHub](https://github.com/facebookresearch/faiss), [index guidelines](https://github.com/facebookresearch/faiss/wiki/Guidelines-to-choose-an-index); hnswlib [GitHub](https://github.com/nmslib/hnswlib); Qdrant [quickstart](https://qdrant.tech/documentation/quickstart/), [storage/segments docs](https://qdrant.tech/documentation/manage-data/storage/), [interfaces/client list](https://qdrant.tech/documentation/interfaces/).

**When brute-force is adequate (official guidance, not just arithmetic):**
- Faiss: *"If you plan to perform only a few searches (say 1000–10000), the index building time will not be amortized by the search time. Then direct computation is the most efficient option"* ([Guidelines to choose an index](https://github.com/facebookresearch/faiss/wiki/Guidelines-to-choose-an-index)).
- sentence-transformers: *"For small corpora (up to about 1 million entries), we can perform semantic search with a manual implementation"* (brute-force cosine similarity + top-k, no ANN index) — [Semantic Search](https://sbert.net/examples/sentence_transformer/applications/semantic-search/README.html).

**Recommendation:** For a single deck of tens to a few hundred slides, brute-force in-memory cosine similarity is **orders of magnitude** below both of the above official thresholds (1,000–10,000 Faiss queries, ~1M sbert corpus entries) — no vector database or ANN index is justified at this scale. sqlite-vec is the most natural "upgrade path" if/when the tool needs to persist embeddings across runs or search across many decks, since it piggybacks on SQLite (which a .NET app can already use via `Microsoft.Data.Sqlite`/EF Core) without introducing a separate server process or an unproven .NET binding gap (Faiss/hnswlib have none).

---

## 5. Similarity/near-duplicate methodology

sentence-transformers' own official examples define the standard approach this report follows:

- **Semantic search**: embed the corpus (e.g. with `SentenceTransformer.encode_document`) and the query (`encode_query`), then rank by **cosine similarity** via `SentenceTransformer.similarity` or `util.semantic_search` ("cosine similarity + topk") — [Semantic Search](https://sbert.net/examples/sentence_transformer/applications/semantic-search/README.html). The same page distinguishes *symmetric* search (query and corpus entries of similar length/kind — i.e., slide-vs-slide comparison) from *asymmetric* search (short query vs. long passage) — directly relevant to deciding whether to compare whole-slide embeddings against each other (symmetric) or a query against chunk embeddings (asymmetric).
- **Paraphrase/near-duplicate mining**: the official `paraphrase_mining` function defaults to cosine similarity (`score_function`, *"By default, cosine similarity. Defaults to cos_sim"*) and documents explicit chunking parameters for memory/time control: `query_chunk_size` (default 5000), `corpus_chunk_size` (default 100000), `top_k` per sentence (default 100), and `max_pairs` (default 500000) — [Paraphrase Mining](https://sbert.net/examples/sentence_transformer/applications/paraphrase-mining/README.html). This function is purpose-built for exactly the "find near-duplicate/very-similar pairs within one corpus" use case this report targets for slide-level dedup.

**Recommendation (chunk vs. slide aggregation):** Use slide-level embeddings (over a composed "title + body + notes" string) as the primary signal for "these two slides are near-duplicates" since it's cheapest and matches the paraphrase-mining pattern directly; fall back to chunk-level cosine similarity (per `SourceType`) only when the user wants to know *why* two slides matched (e.g., "chart data matches but narrative text differs"). No explicit official cosine-similarity *threshold* number (e.g. "0.85 = duplicate") was found in sbert.net docs — threshold selection is inherently corpus-dependent and must be calibrated empirically against the target deck(s); do not present a hard cutoff from this research as an officially sanctioned number.

---

## 6. Categorization approaches

| Option | Key facts | Citation |
|---|---|---|
| **scikit-learn KMeans** | Requires `n_clusters` specified up front (no default auto-detection); default seeding `init='k-means++'`; minimizes within-cluster sum-of-squares ("inertia"); *"It scales well to large numbers of samples"* | [KMeans reference](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html), [clustering user guide](https://scikit-learn.org/stable/modules/clustering.html) |
| **scikit-learn HDBSCAN** | Does **not** require specifying cluster count; `min_cluster_size` (default 5) — *"groupings smaller than this size will be left as noise"*; produces an explicit noise label for unclustered points (unlike KMeans, which assigns every point to a cluster); `cluster_selection_epsilon` for merge-distance thresholding | [HDBSCAN reference](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html) |
| **Threshold-based graph / connected components** | `scipy.sparse.csgraph.connected_components(csgraph, directed=True, connection='weak', return_labels=True)` — build a sparse adjacency graph by connecting slide pairs above a cosine-similarity threshold, then compute connected components as "clusters" | [SciPy connected_components reference](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.csgraph.connected_components.html) |

All three run entirely locally/offline with no cloud dependency. **Recommendation:** for a single deck's worth of slides (tens to low hundreds), connected-components over a cosine-similarity-threshold graph is the simplest, most explainable option and avoids KMeans' requirement to guess `n_clusters` up front; HDBSCAN is a good middle ground once enough slides exist to make density-based clustering meaningful and "no natural cluster" slides should be left unclustered rather than force-assigned.

---

## 7. Incremental indexing

**Recommendation (design guidance; no official library doc addresses this exact scenario):**

- Compute a `ContentHash` per slide (e.g. SHA-256 over the normalized concatenation of title/body/notes/table/chart/SmartArt text extracted in §1) at extraction time, stored alongside the slide record (see §2 schema).
- On re-processing a deck, re-extract text, recompute the hash, and only call the embedding model for slides whose hash changed — this is the same precondition-hashing pattern used by build systems/caches generally; no sentence-transformers/ONNX-specific "incremental embedding" API exists to cite, since embedding generation is stateless per input string.
- Store `ContentHash` per chunk as well if chunk-level re-embedding granularity is desired, so e.g. only a changed chart's `ChartText` chunk is re-embedded, not the whole slide.

---

## 8. GitHub Copilot CLI's current role, limitations, and extensibility

### 8.1 Purpose

GitHub's own docs describe Copilot CLI as a terminal-native **agentic coding assistant**, not a general ML/embeddings tool:

> "The command-line interface (CLI) for GitHub Copilot allows you to use Copilot directly from your terminal... GitHub Copilot CLI gives you quick access to a powerful AI agent, without having to leave your terminal. It can help you complete tasks more quickly by working on your behalf..."
— [About GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/copilot-surfaces/copilot-cli)

> "GitHub Copilot CLI is a powerful terminal-native AI coding assistant that brings agentic capabilities directly to your command line... while maintaining full user control."
— [Copilot CLI quickstart](https://docs.github.com/en/copilot/get-started/cli-quickstart)

> "Powered by the same agentic harness as GitHub's Copilot coding agent... Agentic capabilities: Build, edit, debug, and refactor code with an AI collaborator that can plan and execute complex tasks."
— [github/copilot-cli README](https://github.com/github/copilot-cli)

### 8.2 Built-in tools and tool-policy mechanism

The [Configure Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli) docs page is the authoritative source for tool control and confirms this app's existing design choice of restricting Copilot CLI to web tools:

- `--allow-tool` / `--deny-tool` flags, `shell(COMMAND)` syntax for allowing/denying specific shell commands, a `'write'` category for file-modifying tools, `--available-tools` to restrict the agent to an explicit tool set, and `'MCP_SERVER_NAME(tool_name)'` syntax to allow/deny a specific tool from a registered MCP server.
- `web_fetch` is explicitly named as a built-in tool: *"URL permissions apply to the `web_fetch` tool and a curated list of shell commands that access the network (such as `curl`, `wget`, and `fetch`)."*
- **`web_search` was not found explicitly named** as a distinct built-in tool anywhere in the docs pages checked (overview, CLI concepts page, configure-copilot-cli, quickstart, enterprise-admin page). Only `web_fetch` is confirmed by name in official docs. *Gap flagged explicitly: if this app's tool-policy config references `web_search` as a named tool, re-verify against current `copilot help`/CLI output, since this was not independently confirmed in official written docs during this research.*
- Additional controls: `--allow-all-paths`, `--disallow-temp-dir`, `--allow-all-urls`, `--allow-url=DOMAIN`, `--deny-url=DOMAIN`, and a combined `--allow-all`/`--yolo` flag.

### 8.3 Does Copilot CLI expose any embedding-generation capability? — Explicitly checked, not found

Pages directly fetched and checked for any mention of "embedding," "vector," or "embedding model" as a Copilot CLI feature:
- [About GitHub Copilot CLI](https://docs.github.com/en/copilot/concepts/copilot-surfaces/copilot-cli)
- [Use Copilot CLI overview](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview)
- [Configure Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli)
- [Copilot CLI config dir reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [Copilot CLI quickstart](https://docs.github.com/en/copilot/get-started/cli-quickstart)
- [Administer Copilot CLI for your enterprise](https://docs.github.com/en/copilot/how-tos/copilot-cli/administer-copilot-cli-for-your-enterprise)

None mention embeddings or vector generation as a user-facing or agentic feature. **Conclusion: GitHub Copilot CLI does not expose embedding-vector generation as a feature, as of this research.** This is an explicit, verified negative finding, not an assumption — Copilot CLI (like the chat-completion/agentic LLM surfaces it's built on) is designed for text generation and tool orchestration, not for emitting numeric embedding vectors as an output type.

### 8.4 Does GitHub's broader platform offer an embeddings API?

GitHub Models — the one GitHub-hosted model catalog/inference API that historically might have offered embedding models — has been **retired**:

> "GitHub Models has been retired. As of July 30, 2026, GitHub Models has been fully retired. The playground, model catalog, inference API, and bring your own key (BYOK) are no longer available to any customer. GitHub Models was a separate service from GitHub Copilot and is unrelated to GitHub Copilot services."
— [GitHub Models docs](https://docs.github.com/en/github-models)

`github.com/marketplace/models` returned HTTP 404 on direct fetch during this research. **Conclusion:** there is currently no GitHub-hosted embeddings API available via GitHub's own platform, and in any case GitHub Models was explicitly documented as "a separate service from GitHub Copilot," so it would never have been part of Copilot CLI's own capability surface even when it existed.

### 8.5 MCP extensibility — the correct integration point for a local embedding tool

Copilot CLI has first-party, documented MCP (Model Context Protocol) support:

> "The GitHub MCP server is built into Copilot CLI and is already available without any additional configuration... You can add MCP servers in the following ways: Using the `/mcp add` command / Using the `copilot mcp add` subcommand / Editing the configuration file / Adding per-repository MCP servers / Searching and installing from the registry (experimental)."
— [Add MCP servers to Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)

For a local, process-based embedding tool specifically:

> "You can add MCP servers from the terminal using the `copilot mcp add` subcommand... For local (stdio) servers, provide the command after `--`: `copilot mcp add SERVER-NAME -- COMMAND [ARGS...]`"
> "Details of your configured MCP servers are stored in the `mcp-config.json` file, which is located, by default, in the `~/.copilot` directory."
— same page; config options include `--env KEY=VALUE`, `--header`, `--transport (stdio|http|sse)`, `--tools TOOLS`, `--timeout MS`.

> "MCP works across all major Copilot surfaces—whether you're working in an IDE, using GitHub Copilot CLI... Copilot CLI: GitHub Copilot CLI supports both local and remote MCP servers."
— [MCP concepts](https://docs.github.com/en/copilot/concepts/context/mcp)

The official Model Context Protocol specification confirms the general architecture that makes this work:

> "MCP defines three core primitives that servers can expose: Tools: Executable functions that AI applications can invoke to perform actions (e.g., file operations, API calls, database queries). Resources... Prompts..."
> "MCP server: A program that provides context to MCP clients"
> "Local MCP servers that use the STDIO transport typically serve a single MCP client... This is commonly referred to as a 'local' MCP server."
— [MCP architecture docs](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)

### 8.6 Explicit conclusion on MCP as an orchestration layer

Combining §8.5's two official sources: an MCP server is simply a program exposing arbitrary "executable functions" as tools over local STDIO transport, and Copilot CLI's documented `copilot mcp add SERVER-NAME -- COMMAND [ARGS...]` mechanism (persisted to `~/.copilot/mcp-config.json`, governed by the same `--allow-tool='MCP_SERVER_NAME(tool_name)'` policy used for built-in tools) launches exactly such an arbitrary local process and exposes its declared tools to the agent. **This confirms, from official sources, that it is architecturally sound to:**
1. Write a local MCP server (any language/runtime — e.g. a small .NET console app, or a Python process) that internally loads the embedding model and exposes a tool such as `find_similar_slides(deckPath, slideIndex) -> similarSlides[]`.
2. Register it with Copilot CLI via `copilot mcp add slide-embeddings -- dotnet SlideEmbeddingMcpServer.dll` (or the interactive `/mcp add` form, or direct `mcp-config.json` edit).
3. Let Copilot CLI's agent call that tool like any other MCP tool — with the embedding math running entirely inside the separate MCP server process, never inside the CLI binary or the underlying LLM.

This is consistent with and reinforces this report's core architectural conclusion (§9): **embeddings do not need an LLM or Copilot CLI at all** for the core duplicate/similar-slide feature; MCP is only relevant as an *optional* future layer if the user wants to ask Copilot CLI natural-language questions like "which slides in this deck are redundant?" and have it orchestrate a call into the embedding tool as one agentic step.

---

## 9. Practical architecture

**Recommendation (this entire section is this report's own synthesis):**

Two viable paths for this specific .NET 10 app:

### Path A — Pure .NET via Microsoft.ML.OnnxRuntime (recommended primary path)

- Export the chosen embedding model (e.g. `intfloat/multilingual-e5-small`) to ONNX using sentence-transformers' documented `backend="onnx"` export path (§3), ship the `.onnx` + tokenizer/vocab files alongside the app.
- Load it in-process via `Microsoft.ML.OnnxRuntime`'s `InferenceSession` (CPU execution provider by default, per the official ML.NET docs cited in §3), or via Semantic Kernel's `Microsoft.SemanticKernel.Connectors.Onnx` `AddBertOnnxTextEmbeddingGeneration` helper for a higher-level `IEmbeddingGenerator<string, Embedding<float>>` abstraction (§3).
- **Pros:** no Python runtime/dependency to install or distribute; single-process deployment consistent with a Windows desktop app and with .NET Aspire orchestration (no extra sidecar resource to wire up in the AppHost); embeddings stay fully in-process and in-memory, simplest security story.
- **Cons:** the Semantic Kernel ONNX connector is explicitly experimental (requires `#pragma warning disable SKEXP0070`) at time of research; tokenization (WordPiece/SentencePiece matching the model's own tokenizer) must be handled correctly in .NET — this is typically the trickiest part of a from-scratch ONNX embedding pipeline and is not fully solved "out of the box" by `Microsoft.ML.OnnxRuntime` alone (it handles tensor I/O, not tokenization).

### Path B — Python sidecar process (sentence-transformers + sqlite-vec/Faiss)

- Run a small Python process (via `System.Diagnostics.Process` or a local HTTP/stdio sidecar) that loads the model with `sentence_transformers.SentenceTransformer(..., device="cpu")` and does the embedding + (optionally) vector-store work, communicating with the .NET app over stdin/stdout JSON or a local loopback HTTP endpoint.
- **Pros:** sentence-transformers' Python API is the most mature/battle-tested interface for these models, tokenization is handled correctly "for free," and the official `paraphrase_mining` function (§5) is directly usable without reimplementation.
- **Cons:** requires bundling or requiring a Python runtime on the user's Windows machine, adds a cross-process IPC boundary and packaging complexity (especially for a desktop app that should "just work" after install), and is a heavier footprint for an .NET-first Aspire-orchestrated codebase.

### Where Copilot CLI/MCP fits

Per §8, embedding generation and similarity search are pure linear-algebra/inference operations that need **no LLM at all** — Copilot CLI's text-generation/tool-orchestration model is simply the wrong tool for computing a vector. **Recommendation:** treat MCP wrapping (§8.6) as an **optional, later-stage** enhancement (see Stage 6 in §12) purely for a conversational "ask Copilot CLI about duplicate slides" UX on top of an already-working embedding pipeline — not a dependency for the core feature, and not a reason to delay shipping Path A or B.

**Recommendation:** start with Path A (pure .NET/ONNX) given the app is already a .NET 10/C# codebase with no existing Python dependency; fall back to Path B only if tokenization/ONNX-export friction for the multilingual-e5 model proves too high in practice.

---

## 10. Security/privacy

**Verified facts:**
- ONNX Runtime inference is purely local computation on the host — the official docs describe it as "a high-performance inference engine for deploying ONNX models to production... works on Linux, Windows, and macOS" with no network call inherent to the inference operation itself ([ONNX and Azure Machine Learning](https://learn.microsoft.com/azure/machine-learning/concept-onnx?view=azureml-api-2#onnx-runtime)); there is no network transmission step in the `InferenceSession.Run` API surface documented for standard embedding inference.
- sentence-transformers' `device="cpu"` parameter (§3) confirms the library runs without any GPU/cloud dependency; once a model's weights are downloaded, generating embeddings is a local tensor computation with no further network calls required by the library itself.
- Copilot CLI's own `web_fetch` tool is explicitly scoped and permissioned via `--allow-url`/`--deny-url` ([Configure Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/configure-copilot-cli)), consistent with this app's existing design of only letting Copilot CLI touch the public web for research, never slide content for embedding.

**Recommendation (synthesis, not independently sourced beyond the above):** Running embedding generation entirely via ONNX Runtime/sentence-transformers locally means slide text/notes never leave the user's machine for the similarity-detection feature — a materially stronger privacy posture than any approach that would call a cloud embedding API (e.g. OpenAI/Azure OpenAI embeddings), and it composes cleanly with the existing design principle that only public-web content touches Copilot CLI's `web_fetch`/`web_search` tools, never the deck's proprietary content.

---

## 11. Rough performance/storage estimates

**These are rough assumptions/estimates only — no official benchmark was found for this exact model+hardware+workload combination; treat as back-of-envelope planning numbers, not verified facts.**

Using `intfloat/multilingual-e5-small` (384-dim, ~118M params, confirmed dimension from §3 citation) as the reference model, for a 75-slide deck:

- **Storage per embedding:** 384 dimensions × 4 bytes (float32) = **1,536 bytes/vector**. For 75 slide-level embeddings: 75 × 1,536 ≈ **115 KB**. Even with chunk-level embeddings added (assume ~5 chunks/slide average → 375 chunk vectors): 375 × 1,536 ≈ **576 KB**. Total embedding storage for the whole deck is well under 1 MB — storage is a non-issue at this scale regardless of model choice among those surveyed in §3 (even the 1,024-dim BitNet model would only be ~4× larger, still sub-MB).
- **Embedding generation time (rough assumption, not benchmarked here):** CPU-only BERT-small-class models (~100M params) typically process a short text (one slide's worth, roughly 50–150 tokens) in the **tens to low hundreds of milliseconds** range per inference call on a modern laptop/desktop CPU, based on general knowledge of similarly-sized BERT-family model latencies — **Recommendation: this number should be measured directly against the target model/ONNX export/hardware combination before being used in any user-facing estimate; it is not derived from an official benchmark page for this specific model.** Under that rough assumption, embedding 75 slides sequentially would take on the order of **a few seconds to roughly 10–15 seconds** total on CPU (75 × ~100–200ms), which is practically negligible compared to the deck-level research/enrichment work this app already does via Copilot CLI's web calls.
- **Brute-force similarity compute:** for 75 slides, an all-pairs cosine similarity matrix is 75×75 = 5,625 dot products of length-384 vectors — on the order of **2.16M floating-point multiply-adds total**, which completes in well under a millisecond of pure CPU compute time; this is far below both the Faiss (§4) and sentence-transformers (§5) thresholds for needing anything beyond brute force.

---

## 12. Staged proof-of-concept plan

**Recommendation (staged plan; this entire section is this report's own synthesis):**

1. **Stage 1 — Extraction only.** Build the Open XML SDK extraction pipeline (§1/§2): slide text, table text, speaker notes, plus explicit "gap" logging for any slide containing a chart (`GraphicFrame`→`ChartPart`) or SmartArt (`GraphicFrame`→`DiagramDataPart`), so fidelity limitations are visible from day one rather than silently dropped. No embedding yet — validate the extracted text model against a few real decks (including the sample `RMOT2026052905281309_Azure_20261001074636-short.pptx` already in this repo) before investing in embeddings.
2. **Stage 2 — Single local CPU embedding model.** Wire up one model end-to-end (recommend starting with `intfloat/multilingual-e5-small` for the Dutch+English requirement) via Path A (ONNX/.NET) or Path B (Python sidecar) from §9 — whichever proves faster to get working correctly, including tokenization. Validate embedding output shape/dimension matches §3's cited 384.
3. **Stage 3 — Brute-force cosine similarity, no vector DB.** For a single ~75-slide deck, compute the full in-memory pairwise cosine similarity matrix (§11 shows this is sub-millisecond) and surface top-N most-similar slide pairs. No sqlite-vec/Faiss/Qdrant needed yet, consistent with the official size-threshold guidance in §4.
4. **Stage 4 — Clustering/categorization.** Add connected-components-over-threshold or HDBSCAN (§6) on top of the similarity matrix to group slides into candidate "duplicate/similar" clusters for user review.
5. **Stage 5 — Evaluate need for scale-up.** Once real usage data exists (multi-deck corpora, hundreds+ of slides), revisit whether a persistent vector store (sqlite-vec first, given its SQLite-native fit with .NET) is warranted, and whether OCR (for images) or explicit chart/SmartArt text extraction (flagged as fidelity gaps in §1) should be built out, based on how often real decks actually contain those content types.
6. **Stage 6 — Optional MCP tool wrapping.** Only after Stages 1–5 produce a working, validated local similarity pipeline, consider wrapping it as a local MCP server (§8.5/§8.6) and registering it with `copilot mcp add`, so Copilot CLI can be asked conversationally ("which slides in this deck look redundant?") and orchestrate a call into the local tool — purely as an optional UX layer on top of an already-functioning, LLM-independent core feature.