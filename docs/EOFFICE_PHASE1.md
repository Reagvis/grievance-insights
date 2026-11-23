# eOffice Phase 1 v2.0 – implementation and onboarding

PR #37 adds a **testable but non-deployable** modular API handler for chat, summarize, extract and draft-reply at `/api/v1/ai/*`. The separate government authentication/protected-file specification is unavailable; **the production Lambda handler denies all callers and the protected document credential boundary denies access**. No API Gateway routes, AWS resources, grievance dashboard or existing analysis workflow are changed or deployed.

## Implemented contract behavior

- All task paths accept **POST + UTF-8 `application/json`** only. Other methods return 405 (`Allow: POST`), media types return 415, and base64-encoded bodies are rejected with 400. Successful calls use HTTP 200 and the prescribed field names. Common failures use `system_error_message` and `user_error_message`, with only a syntactically valid UUID `request_id` echoed when safely available (including authorization errors). JSON bodies are bounded before parsing.
- User identity is taken from an injected authorized `Principal` (department and officer), **never** from untrusted `user_id`. The latter is checked for consistency. Each document fetch is passed that exact principal and the common deadline.
- `context.documents` are fetched by a principal-scoped access callback that independently supplies an authorized host set and protected headers for each request. It must be implemented from the future official authentication specification; no static process-global credentials are used or guessed. The HTTP adapter performs HTTPS and explicit host validation, rejects private/reserved DNS answers, pins the vetted public IPv4 destination while checking TLS host identity, rejects redirects, and limits download size/time. Network egress and malware scanning remain onboarding obligations.
- Existing DOCX and searchable-PDF extraction functions are reused; no binary original documents or images reach the model. Scanned/damaged PDFs return 422 instead of starting OCR jobs.
- All task prompts use a bounded, task-specific JSON envelope for internal source attribution. For narrative tasks the model must return `{"text":"...","used_document_ids":["doc1"]}`; extraction uses `{"extracted_data":{...},"used_document_ids":["doc1"]}`. These are **internal model response formats**, not new public API fields. Returned `references` are constructed only from submitted document IDs explicitly declared as used (never copied from untrusted model source URLs, never protected download URLs); unused sources are omitted and none-used means `[]`. This validates attribution IDs, **not semantic correctness of model claims**; independent grounding/evidence evaluation is still required before production use.
- `/summarize` without documents requires actual source text. The contract does not provide a separate source-text field, so obvious instruction-only requests (e.g., `Summarize the attached document`) return 400. Plain source passages remain accepted; mixed instruction + source may use `user_input` with `Source text:\n...` as a delimiter (no new mandatory API field). This is an intentionally conservative heuristic, not a full semantic source classifier.
- `/extract` validates the documented flat-object scalar JSON Schema subset (1–32 fields, nullable optional fields, required non-null fields). Missing required fields get 422; malformed model JSON, type mismatches, undeclared fields or fabricated source IDs get provider-side 502. Nested structures, enums, arrays, patterns, formats etc. are not supported.
- Chat is stateless; `session_id` is required and officer/department scope comes from the authorization boundary. An optional previous-history URL needs an authorized injectable history resolver; opaque provider context tokens are explicitly rejected until agreed at onboarding. No permanent storage, chat history, temporary indexes, or generated files.
- Proposed replies are `draft_text` requiring officer review. Optional generated PDF/DOCX artifacts and `generated_file_url` are intentionally not implemented.

## Synchronous bounds

The request body is capped at 64,000 UTF-8 bytes; user input and aggregate document text each at 24,000 bytes; each fetched document at 2 MiB and 24,000 extracted bytes; 4 documents maximum; **combined model system + input + documents + history + extraction schema capped at 32,000 UTF-8 bytes**; raw model output capped at 24,000 bytes; Bedrock output tokens at 1,400–1,600. A single 25-second handler budget is passed to document/history adapters and limits each operation; the Bedrock Converse adapter receives at most 18 seconds and never outlives the remaining request budget. Legacy grievance transport retains its existing 75-second default. No asynchronous job contracts or callbacks are created.

No eOffice temporary content is persisted, so storage expiration is currently not applicable. Onboarding must agree on the specification's default 12-hour and maximum 24-hour retention if chat state or artifacts are later implemented.

## Outstanding requirements

1. Obtain the separately issued official government authentication, authorization, tenant mapping and protected file access protocol; replace the default-deny adapter **only after** review. Do not assume Cognito dashboard credentials are eOffice credentials.
2. Confirm per-department hosts/credentials, file malware scanning, controlled egress and appropriate TLS/SSRF policy. No live protected eOffice URL is configured.
3. Confirm synchronous timeout, model budget, accepted file types/sizes, supported JSON Schema features, chat state/previous-context mode and task enablement during departmental onboarding. Test realistic PDFs and network termination/redirect behavior.
4. Assess semantic source attribution against source evidence; the model-reported ID mechanism cannot guarantee every narrative claim is grounded.
5. Independently test and approve the integration before configuring Lambda/API Gateway routes. No authentication, deployment, Terraform or IAM changes are included in this correction.

## WSL verification (no Bedrock calls)

```sh
cd ~/src/grievance-insights
git fetch origin
git switch feature/eoffice-phase1-api
git pull --ff-only origin feature/eoffice-phase1-api
npm ci
npm run backend:typecheck
npm run backend:test
npm run lint
npm test
npm run build
```

Run the above in WSL; GitHub Actions may be billing-blocked. These tests mock all Bedrock calls and protected HTTPS access. Do not treat contract tests alone as government authentication or deployment approval.
