# Grievance Insights — CM Helpline complaint intelligence

**Two modes, chosen by one setting.**

| Mode | When | Data | Assistant | Summary |
|---|---|---|---|---|
| **Live** | `VITE_API_BASE_URL` is set | Loaded from your backend (`GET /complaints`) | Your backend (`POST /chat`, streamed, cites case IDs) | Your backend (`POST /summary`, scope only) |
| **Demo** | not set | Bundled synthetic Telugu records, CSV/JSON import | Offline record lookup, labelled *not AI* | In-browser aggregation, labelled *not AI* |

The backend contract is in [`docs/BACKEND_CONTRACT.md`](docs/BACKEND_CONTRACT.md). To try live mode before the real service exists:
`npm run dev:mock-api` (runs against `server/mockBackend.ts`, which says `mode: "mock"` and shows a *Mock backend · not real data* badge).

```bash
# real backend (build-time setting)
VITE_API_BASE_URL=https://helpline.example.gov/api/v1 npm run build      # PowerShell: $env:VITE_API_BASE_URL="..."; npm run build
```

Live mode in the UI: no sample/import/prototype controls; a header shows when the data was last loaded with a Refresh button; loading,
error and retry screens; the assistant is switched off (with the reason) if the server says chat is unavailable; AI reports are labelled
as AI and a report whose coverage does not match the requested scope is discarded. Auth: call `setAuthTokenProvider(() => token)`
from `src/services/api/config.ts`, or use cookies with `VITE_API_CREDENTIALS=include`.

The sections below describe the original demo build and still apply to demo mode.


A frontend prototype for exploring Telugu citizen complaints and department responses, and turning the whole collection into **one consolidated, printable summary**.

## GitHub Pages deployment

The Pages build runs summary generation and record lookup entirely in the browser. Imported records never leave the browser in this mode. GitHub Pages serves static files and does not host the localhost Node API endpoints. AI provider integration is not configured.

```bash
npm ci
npm run build:pages   # static build with relative asset paths
npm run deploy:pages  # build and push static files to the gh-pages branch
```

Repository: `Reagvis/grievance-insights`. In Settings → Pages, use **Deploy from a branch**, branch **gh-pages**, folder **/ (root)**. The site URL is `https://reagvis.github.io/grievance-insights/`. Source lives on `main`; generated assets are published on `gh-pages`. The deployment script uses your existing Git credentials and does not require API secrets or workflow permissions. Run `npm run dev` to retain the localhost API mode.

The separate AWS static build uses `npm run build:aws`. It retains the same browser-only `pages` processing mode but emits root-relative `/assets/...` URLs for CloudFront SPA routes. The guarded GitHub Actions workflow uses this build; it does not change the legacy GitHub Pages command above.

> **Prototype · Sample Data.** Every record bundled with this app is synthetic demonstration content written for the prototype. It is not CM Helpline data, and no figure in the app describes real government activity.

## What it does today

| Capability | Status |
|---|---|
| Browse complaint + response records (Telugu, mixed, English) | Working |
| Search by case ID, Telugu/English text, category, issue type, department, district (Unicode/NFC-safe, AND terms) | Working |
| Filter by category, status and response presence; reset; accurate counts | Working |
| Record detail with complaint and response kept separate, prev/next, copy | Working |
| Record translation bar: Original / English / Original + English | Bundled English translations for all sample templates; exact source-text matching also supports the expanded dataset. Imported text without a bundled translation retains its original with an availability message. Copy follows the selected view; note and ZIP exports keep the original. No translation requests leave the browser. |
| Download one note (`GRV-000128-note.txt`, UTF-8) | Working |
| Download all records as ZIP (notes + `manifest.csv` + README) | Working |
| Export only the filtered records as ZIP (separate, clearly labelled action) | Working |
| **Consolidated summary** for all records or the filtered set | Working via local HTTP API (deterministic aggregation) |
| Stale detection when filters, scope or dataset change | Working |
| Export summary: Copy, Download Markdown, Print / Save PDF (one A4 page) | Working |
| Clickable case IDs in the report open the source record | Working |
| Import UTF-8 CSV / JSON with validation, preview and confirm | Working (in-browser only) |
| 2,000-record synthetic load-test dataset | Working |
| EN / తెలుగు interface toggle | Navigation and controls; report body is English |
| Document Assistant | Working via local HTTP API: record lookup, category counts, status / missing-response queries, source case links (not AI) |

### Not connected yet (by design)

- AI summarisation of free text (the current summary is **not AI**; it is labelled "Demo · Local aggregation").
- Telugu-language report templates (the report-language selector shows Telugu as planned, disabled).
- Telugu OCR / PDF extraction, CM Helpline system integration, authentication, RBAC, audit logs, persistence.
- AI document Q&A / RAG. The local assistant supports deterministic record lookup only.

## Run it

Requires Node 20.19+ or 22.12+ (Vite 8).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (Vitest)
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

The frontend and local API run together at **http://localhost:5173**. No API key or external service is required. Fonts are bundled. Summary and assistant requests send the loaded records to this localhost server for in-memory processing; records are not persisted or sent to third parties. Use `npm run dev` or `npm run preview` to serve both the UI and APIs; serving `dist/` from a static file server alone will not run the API.

### Local API endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Server status and processing mode (`server-local`, `aiConfigured: false`) |
| `GET /api/records` | Sample dataset; add `?dataset=expanded` for 2,000 records |
| `POST /api/summary` | `{ "records": [...], "options": { "scope": "all", "scopeDescription": "no filters", "reportLanguage": "en", "datasetName": "My records" } }` |
| `POST /api/assistant` | `{ "records": [...], "question": "Which water supply complaints have no response?" }` |

POST requests use `Content-Type: application/json`. Invalid requests return JSON errors. The API supports up to 10,000 records and 32 MB per request, accepts same-origin browser requests, and binds to loopback by default. The summary and assistant are deterministic, not AI; connecting an external AI provider still requires a backend integration and provider credentials.

## Two-minute demo script

1. Point out the Telugu complaint list on the left and the **Prototype · Sample Data** badge.
2. Search `తాగునీటి` (drinking water) and open a record: original complaint and department response, side by side with metadata that is never guessed.
3. **Download this note**.
4. Reset filters and press **Generate consolidated summary**: categories with shares, outcome coverage (response ≠ resolution), themes, verbatim response excerpts, priority observations, and data limitations, all with case-ID links.
5. **Print / Save PDF** (one A4 page) or **Download Markdown**, then **Download all records** as a ZIP.
6. Switch the dataset to the 2,000-record load test to show it scales; explain that a server AI service can later replace the local processor without UI changes.

## Data rules the code enforces

- Complaint and response text is shown and exported **verbatim**; nothing is paraphrased or translated.
- A recorded response is **not** a resolution. Only an explicit `resolved` status counts as resolved.
- Missing or unrecognised status becomes `unknown` ("Status not recorded"), never `resolved`.
- Missing values display and export as **Not recorded**; invalid dates are blanked, never shown as "Invalid Date".
- Percentages are computed from the records included in that report's scope.
- Ties are reported as ties (the summary never names one category "the most" when several are equal).
- Imported data stays in memory. Summaries and assistant requests send records to the local API; complaint data is not logged or persisted. `localStorage` holds only the interface-language preference.

## Import format

**TXT / PDF notes (any number of files, or a whole folder).** One record per file.

- **TXT**: UTF-8, or UTF-16 with a byte-order mark. A note exported by this app imports back as it was (ID, category, dates, status, complaint and response).
  Other files are split into complaint and response only when they contain explicit headings such as `Complaint:` / `Response:` (or `ఫిర్యాదు:` / `స్పందన:`),
  optionally preceded by `Case ID:`, `Category:`, `Department:`, `District:`, `Status:` lines. A file without headings is imported whole as the complaint, with no response;
  the import summary says how many files were handled that way. The case ID is the file name when the file does not state one.
- **PDF**: text is read from the PDF's text layer in the browser (pdf.js, loaded only when a PDF is chosen). Scanned PDFs have no text and are rejected (no OCR yet).
  pdf.js cannot decode some Telugu conjunct letters (it returns blanks for those glyphs, e.g. PDFs printed from Chrome with Nirmala UI), so any PDF where more than 2% of
  the letters cannot be decoded is **rejected** rather than imported with silently missing letters, and smaller losses are reported as a warning. For Telugu,
  prefer TXT until a server-side extractor / OCR is connected.


UTF-8 CSV (with or without BOM) or JSON. Templates can be downloaded from the Import dialog.

```csv
id,complaintText,responseText,language,category,issueType,department,district,submittedAt,respondedAt,status
GRV-000001,మా ప్రాంతంలో మూడు రోజులుగా తాగునీటి సరఫరా సరిగా లేదు.,సంబంధిత నీటి సరఫరా విభాగానికి సమస్యను పంపించాము.,te,Water supply,Irregular supply,Rural Water Supply,District A,2026-07-07,2026-07-08,in_progress
```

JSON may be an array of records or `{ "records": [...] }`. Common aliases are accepted (`case_id`, `complaint`, `response`, `submitted_at`, …).

- **Required:** `id`, `complaintText`. Rows missing either are rejected and listed.
- **status:** `resolved`, `pending`, `in_progress`, `unknown`. Anything else becomes `unknown` with a warning.
- **language:** `te`, `en`, `mixed`, `unknown`; if missing, it is detected from the Unicode script used.
- **Duplicates:** the first occurrence of an ID is kept; later rows are set aside and listed (not silently dropped).
- Non-UTF-8 files, malformed CSV/JSON and files over 25 MB are rejected with a specific message.
- Scanned images are not supported (no OCR).

## Architecture

```
src/
  app/App.tsx                  state: dataset, filters, scope, summary, dialogs
  app/useDialog.ts             focus trap, Escape, focus return
  components/                  AppHeader, RecordExplorer, RecordListItem, RecordDetail,
                               DatasetOverview, SummaryWorkspace, SummaryReport,
                               ImportDialog, AssistantDrawer, StatusBadge, Toasts
  data/demoGrievances.ts       30 curated Telugu records + deterministic 2,000 expansion
  domain/grievance.ts          GrievanceRecord, status normalisation, shared stats
  domain/summary.ts            ConsolidatedSummary, SummaryService interface
  services/localDemoSummaryService.ts   shared deterministic summarizer
  services/localApiService.ts           frontend summary / assistant HTTP client (current)
  services/remoteAISummaryService.ts    documented contract stub (throws; not wired)
  utils/                       search, CSV parser, importer, downloads/ZIP, Markdown export
  i18n/strings.ts              EN / Telugu interface dictionary
  styles/                      tokens.css, app.css, print.css (A4 one-page report)
  tests/                       Vitest suites
```

`server/api.ts` provides local API middleware for the Vite development and preview servers. `src/tests/api.test.ts` exercises the actual HTTP endpoints alongside the original domain tests.

## Connecting a real summarisation backend

The UI depends only on the `SummaryService` interface:

```ts
interface SummaryService {
  readonly mode: 'demo-local' | 'server-ai';
  readonly supportedLanguages: readonly ('en' | 'te')[];
  generate(records: GrievanceRecord[], options: SummaryOptions): Promise<ConsolidatedSummary>;
}
```

To connect a server:

1. Implement `RemoteAISummaryService.generate` (see `src/services/remoteAISummaryService.ts`) to call the approved endpoint and validate the returned `ConsolidatedSummary`, with `processingMode: 'server-ai'` and `caseIds` on every theme and action.
2. Pass it in: `<App summaryService={new RemoteAISummaryService(/* config */)} />`.
3. Add `'te'` to `supportedLanguages` once Telugu report generation is real; the report-language selector can then be enabled.

Intended backend pipeline (not built here): ingest → Telugu text extraction / OCR where needed → normalisation → per-record structured extraction (issue, requested action, response action, explicit outcome) → aggregation → one-page report → link every conclusion to case IDs → human review.

## Tests

`npm test` runs 29 focused tests covering: sample counts, response ≠ resolution, unknown-status handling, blank responses, `Uncategorized` grouping, percentages from the included scope, filtered-scope reports, tie handling and grammar, empty-scope refusal, unsupported report language, Telugu substring and NFD/NFC search, case-ID search, combined filters, UTF-8 round trips for notes, ZIP contents and naming, Markdown export, grapheme-safe truncation, CSV parsing (quotes, newlines, BOM), import validation (duplicates, rejected rows, unknown statuses, bad dates), and non-UTF-8 rejection.
