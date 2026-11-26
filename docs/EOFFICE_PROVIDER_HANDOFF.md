# eOffice AI Provider — Phase 1 v2.0 technical integration handoff

**Prepared:** 2026-11-27. **Source:** user-supplied eight-page *eOffice AI Service Integration Specification, Phase 1, Version 2.0*, dated October 2026. **Status: CONTRACT IMPLEMENTED IN SOURCE; REMOTE HTTPS SERVICE NOT YET DEPLOYED OR AVAILABLE. DO NOT REGISTER ANY OF THESE PATHS AS AN ACTIVE eOffice INTEGRATION.**

This note is for technical coordination with the departmental eOffice team. It distinguishes requirements in the specification from current implementation and unresolved onboarding choices. The four endpoint paths below are actual contract paths, **not live public URLs**.

## 1. Provider base URL and task endpoints (specification §§1–2, 3.1, 6.3)

**Provider HTTPS base URL:** **TO BE ISSUED after secure deployment, authentication integration and acceptance**.

The following relative paths will be appended to the approved provider host:

| Task | Method / relative endpoint | Required result on success | Enabled remotely now? |
| --- | --- | --- | --- |
| Officer chat / knowledge Q&A | `POST /api/v1/ai/chat` | `request_id`, Markdown `answer`, `references: []` or source entries | **No** |
| Document/text summary | `POST /api/v1/ai/summarize` | `request_id`, Markdown `summary`; optional `references` | **No** |
| Schema-driven extraction | `POST /api/v1/ai/extract` | `request_id`, complete `extracted_data`, `references` | **No** |
| Proposed official reply | `POST /api/v1/ai/draft-reply` | `request_id`, `draft_text`, `references`; optional `generated_file_url` only if a real file is generated | **No** |

Each function is independently optional and enabled manually by eOffice during onboarding. **All methods POST**, UTF-8 JSON requests/responses, `Content-Type: application/json`, `200 OK` success. eOffice generates a unique UUID `request_id`; the provider echoes it on success and on errors when recoverable. `user_id` describes the requesting officer; it is **never** a credential. Phase 1 is **synchronous** only; no asynchronous jobs, polling or callbacks.

**Never use either of these as a government provider base URL:**
- `http://127.0.0.1:8765` — a synthetic **developer-local** test harness, inaccessible to eOffice and not authenticated.
- `https://telangana-gov-pilot.reagvis.com` — the separate operational Grievance Insights/Qwen pilot, **not** an eOffice service.

## 2. Common request/response contract (specification §§2–3)

| Field | Task(s) | Rule |
| --- | --- | --- |
| `request_id` | All | eOffice-issued UUID; echo in response and errors when available |
| `user_id` | All | eOffice officer identifier for context/audit; identity must be verified via the **separate auth protocol** |
| `session_id` | Chat | Required; tied to the **authorized** officer and session |
| `user_input` | Chat, summarize, draft reply | Nonempty for chat and draft reply; summary may use supplied documents or source text in `user_input` |
| `context.documents` | All | Required for extraction; otherwise optional; each item has **exactly** `document_id` and `download_url` |
| `context.previous_context` | Chat | Optional **protected eOffice history URL**; access only within authorized principal/session |
| `context.provider_context_token` | Chat | Optional opaque provider-generated state, maximum 64 KB in spec; **NOT ENABLED in current implementation** |
| `extraction_schema` | Extract | Required JSON Schema; missing optional fields must be returned `null`, required unextractable fields cause an error |

Example of **illustrative, not active** chat request:

```json
{
  "request_id": "b6d8f4a2-7c39-4d1a-8e2b-5f9c6d3e8f1a",
  "session_id": "chat_session_4512",
  "user_id": "officer_4512",
  "user_input": "What is the budget cap under the attached policy?",
  "context": {
    "documents": [{
      "document_id": "doc_policy_2026",
      "download_url": "https://eoffice.example.gov/api/files/temp/abc123"
    }]
  }
}
```

The example hostname is taken from the specification and is illustrative, **not a configured document server**. A successful chat response contains `answer` and `references`; source entries for eOffice documents include actual `document_id`, a safe `title`, optionally verified `page_number`. For non-eOffice knowledge sources, the specification permits `title`, appropriately authorized `source_url`, optionally `page_number`; **never expose `context.documents[].download_url`** as a reference or in AI output.

For extraction, eOffice supplies **at least one** document plus `extraction_schema`; output must preserve **every declared field** in `extracted_data`, and missing optional values are `null`. A required field that cannot safely be extracted is an error, not an invented value. eOffice validates extracted data before populating official forms. Draft replies are **proposals**, not decisions or approvals; `draft_text` is mandatory even if an optional protected, expiring `generated_file_url` is offered.

## 3. Error and lifecycle behavior (specification §§5–6)

All failed requests use the **same JSON error envelope**:

```json
{
  "request_id": "b6d8f4a2-7c39-4d1a-8e2b-5f9c6d3e8f1a",
  "system_error_message": "Safe integration diagnostic.",
  "user_error_message": "The request could not be completed."
}
```

Include `request_id` **when available**. The specification illustrates `400` malformed/missing required request field; `422` unavailable protected document, schema, or unextractable required value; `500` unexpected provider processing failure; and `503` temporary unavailability. The implementation also uses `403` authorization denied, `404` unknown route, `405` wrong method, `415` wrong content type, `502` invalid model output. Never put credentials, file paths, sensitive document text, stack traces or protected URLs in errors.

eOffice configures the **synchronous timeout per provider**. Retry is a new invocation unless separately agreed. Officer review/approval remains mandatory before any draft or extraction becomes part of an official action.

Security and data handling required by the specification:
- Obtain authentication/transport and protected-file access rules from the **separately issued authentication specification**; `user_id` is not proof of identity.
- Isolate department, officer and session; treat documents, retrieved knowledge, prompts and files as untrusted; validate protected HTTPS URLs, perform appropriate malware screening and protect against prompt injection and unsupported/fabricated answers.
- Do not expose protected document download URLs, credentials or departmental content in model outputs, reference links, diagnostic errors or logs.
- Temporary chat history, downloaded documents, caches/indexes and artifacts: **default retention 12 hours; maximum configured retention 24 hours**; session inactivity is measured from last activity. No unauthorized long-term retention, model training, fine-tuning or unrelated analytics.

## 4. Provisional implementation capabilities — NOT a finished government deployment

Source: `backend/eoffice/core.ts`, `schema.ts`, `documents.ts`, `handler.ts` on `main`, [conformance matrix](EOFFICE_CONFORMANCE_MATRIX.md), and draft [Task22E PR #44](https://github.com/Reagvis/grievance-insights/pull/44).

| Capability | Current implementation state |
| --- | --- |
| Four task-specific JSON envelope/route handlers | Source implemented; offline tests historically reviewed |
| Public HTTPS base URL, DNS/TLS, gateway and official runtime | **Absent / not deployed** for eOffice |
| Officer authentication/authorization | **Blocked pending government auth spec**. Production handler deliberately returns `authorize: async () => null` |
| Protected eOffice file download credentials/allowlist | **Not configured**. Production protected-file adapter fails closed |
| Document parsing supported in source | `text/plain`, `text/markdown` (UTF-8), DOCX, and **searchable PDF**; **scanned PDFs requiring OCR are not synchronous-supported** |
| Provisional code limits (not yet agreed by eOffice) | Up to **4 document references**, **2 MiB per document**, **24,000 UTF-8 bytes extracted per document**, **64,000-byte JSON request body**, ~**25-second** core deadline with <=18s model call. Must be negotiated/tested |
| Extraction subset | Flat scalar JSON schema up to **32 fields**; no arbitrary nested/array/enum constraints. **Non-null boolean extraction not approved** in grounding safeguards |
| Chat state | Stateless calls and optional authorization-scoped history adapter in source; **no real eOffice history resolver** or provider context token |
| Output file for draft reply | `generated_file_url` **not enabled**. Text draft is supported in contract |
| Source repository/external links | Not integrated; do not fabricate reference URLs |
| Paid model / real data processing | **Not authorized / not established for eOffice** |
| Local end-to-end tests | Task22E localhost-only synthetic test harness in **draft PR #44**, pending correction and operator WSL acceptance |
| Malware scanning, provider data-use policy and government HTTPS interoperability | **Not yet verified** |

These source-specific constraints are **proposed negotiation inputs**, not limits stated by the specification.

## 5. eOffice team decisions / information required before issuing live HTTPS endpoints (§6.3)

Please request the following from the eOffice integration owner, preferably in writing:

1. **The separately issued authentication specification**, including caller identity verification, token/certificate/header format, rotation and access restrictions; protected document download authorization must be specified as well.
2. Intended **environment** (nonproduction UAT vs production), approved **HTTPS provider base URL** registration process, certificate and caller access requirements, permitted regions/accounts and source IP/network controls.
3. Which of the **four task endpoints** to enable initially, and required acceptance/test data (synthetic for UAT).
4. Permitted **document input formats and sizes**, scanned PDF/OCR requirements, and whether generated PDF/DOCX draft files must be supported on day one.
5. Configured **eOffice synchronous timeout**, request volume/concurrency/rate expectations and retry rules.
6. Agreed **chat mode** (stateless with protected `previous_context`, provider token, or stateful sessions), history endpoint and session/department authorization semantics.
7. Required **retention setting** (12-hour default, never above 24-hour configured maximum), log policy, model-provider data use/training restrictions and security review procedure.
8. Supported **extraction_schema** features (especially nested structures or boolean fields) and which fields need evidence/page references; how official form validation/human approval is performed.

**Fastest safe path:** Share this **provisional contract note** immediately, obtain auth/file-access onboarding details, separately approve an isolated **access-restricted eOffice staging service**, then wire genuine approved auth/document adapters and run live HTTPS contract/UAT tests before returning an active provider URL. Never expose the synthetic `x-eoffice-smoke-actor` header from the localhost harness on a public endpoint. Do not attach eOffice routes to the live grievance pilot.

**Maintainer / source references:** [Issue #43](https://github.com/Reagvis/grievance-insights/issues/43), [draft PR #44](https://github.com/Reagvis/grievance-insights/pull/44), [staging plan on PR branch](https://github.com/Reagvis/grievance-insights/blob/feature/eoffice-http-smoke-22e/docs/EOFFICE_STAGING_READINESS.md). The real source specification takes precedence over this abbreviated handoff.
