# Backend contract (v1)

The frontend talks to **one base URL** (`VITE_API_BASE_URL`, e.g. `https://helpline.example.gov/api/v1`).
All bodies are UTF-8 JSON (Telugu is sent as normal Unicode text, never escaped or transliterated).
Authentication is a bearer token supplied by the host app (`setAuthTokenProvider` in `src/services/api/config.ts`)
or a session cookie (`VITE_API_CREDENTIALS=include`). Nothing secret is bundled into the frontend.

Errors: any non-2xx response should be JSON `{ "error": "message safe to show an operator", "code": "optional_machine_code" }`.
The UI maps 401 / 403 / 404 / 408 / 413 / 429 / 5xx to plain-language messages and never shows raw stack traces.

A development mock that implements this contract lives in `server/mockBackend.ts` (`npm run dev:mock-api`).
Use it as an executable example. `src/tests/live-api.test.ts` is the contract test the real service should also satisfy.

---

## `GET /health`

```json
{
  "status": "ok",
  "version": "1.4.2",
  "mode": "live",
  "dataset": { "name": "CM Helpline complaints", "updatedAt": "2026-11-10T08:00:00Z", "isSynthetic": false },
  "capabilities": { "chat": true, "summary": "ai" }
}
```

| field | meaning |
|---|---|
| `mode` | `"live"` in production. `"mock"` makes the UI show a *Mock backend · not real data* badge. |
| `capabilities.chat` | `false` → the assistant is shown as "not switched on", no fake answers. |
| `capabilities.summary` | `"ai"` (report written by a model), `"deterministic"` (server counts/aggregation, labelled *not AI*), or `"unavailable"`. |

## `GET /complaints?limit=500&cursor=<opaque>`

Returns the whole collection, page by page. The UI follows `nextCursor` until it is `null` and then searches, filters and aggregates
in memory (instant for tens of thousands of notes). IDs must be unique and stable.

```json
{
  "total": 1842,
  "nextCursor": "opaque-string-or-null",
  "items": [
    {
      "id": "CMH-2026-000123",
      "complaintText": "మా గ్రామంలోని ప్రాథమిక ఆరోగ్య కేంద్రంలో వైద్యులు అందుబాటులో లేరు.",
      "responseText": "సంబంధిత అధికారికి ఫిర్యాదు పంపించబడింది.",
      "category": "Healthcare",
      "issueType": "Doctor availability",
      "department": "Health Department",
      "district": "Guntur",
      "submittedAt": "2026-10-01",
      "respondedAt": "2026-10-04",
      "status": "pending",
      "language": "te",
      "sourceFileId": "note-123.pdf"
    }
  ]
}
```

* Required: `id`, `complaintText`. Rows missing either are **skipped and counted** (the UI says how many).
* `responseText`: `null`/absent/blank = **no response**. A response is **never** treated as "resolved".
* `status`: `resolved | pending | in_progress | unknown`. Anything else (or absent) is shown as *not recorded*. Do not guess a status from text.
* Dates: ISO `YYYY-MM-DD` or full ISO timestamp. Invalid dates are shown as *not recorded*.
* `language`: `te | en | mixed`; detected from the script when absent.
* If the collection grows beyond roughly 20–50k notes, add server-side `q`, `category`, `dateFrom`, `dateTo`, `page` parameters
  and change `src/services/api/backend.ts`; the UI components do not need to change.

## `POST /summary`

The request carries **only the scope**; the server owns the data (the UI never posts thousands of notes).

```json
{ "scope": { "kind": "all" }, "language": "en" }
{ "scope": { "kind": "filtered", "recordIds": ["CMH-2026-000123", "…"] }, "language": "en" }
```

Response: a `ConsolidatedSummary` (see `src/domain/summary.ts`) including `totalRecords`, `includedRecordIds`, `categories`,
`themes[].caseIds`, `reportedActions[].caseIds`, `limitations`, and `processingMode` = `"server-ai"` or `"server-local"`.

The frontend **discards** the report (and shows an error) if `totalRecords` or `includedRecordIds` do not match the requested scope.
Every conclusion should carry the `caseIds` it came from so the UI can link them. Long generations are allowed up to 3 minutes.

## `POST /chat`

```json
{
  "messages": [{ "role": "user", "content": "Which complaints about water have no response?" }],
  "scope": { "kind": "all" },
  "language": "auto"
}
```

`scope` is `{ "kind": "all" }` or `{ "kind": "records", "recordIds": ["…"] }` (a single note, or the user's current filtered list).
`messages` is the recent conversation (the UI sends at most the last 12 turns), ending with the new user message.

Preferred response: **server-sent events** (`Content-Type: text/event-stream`), one JSON object per `data:` line:

```
data: {"type":"delta","text":"Three water-supply complaints "}
data: {"type":"delta","text":"have no response: …"}
data: {"type":"done","citations":[{"caseId":"CMH-2026-000123","quote":"optional short excerpt"}]}
```

or, on failure mid-stream, `data: {"type":"error","message":"Safe message"}`.
A plain JSON body `{ "answer": "…", "citations": [{ "caseId": "…" }] }` is also accepted.

Rules the UI relies on:
* Cite the **case IDs** the answer is based on. The UI only renders a citation as a link if that ID exists in the loaded data;
  otherwise it shows "ID · not found" so an invented citation is visible as such.
* Answer in the user's language (Telugu in, Telugu out) unless asked otherwise.
* Never state a complaint was resolved unless its `status` is `resolved`.
* Conversations are held in the browser tab only (memory) and are not persisted by the frontend.

---

## Configuration

| variable | purpose |
|---|---|
| `VITE_API_BASE_URL` | Backend base URL. **Set → live mode.** Unset → offline demo mode with bundled synthetic data. |
| `VITE_API_CREDENTIALS` | `include` to send cookies cross-origin (session auth). |
| `npm run dev:mock-api` | Live mode against the bundled development mock (`/api/v1`). |

CORS: if the API is on a different origin, allow the frontend origin, `Authorization` and `Content-Type` headers, and `GET, POST, OPTIONS`.
