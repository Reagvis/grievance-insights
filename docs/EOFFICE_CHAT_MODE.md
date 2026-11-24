# eOffice Phase 1 — proposed stateless chat policy and offline integration harness (Task 22C)

**Status:** Task 22C PR #41 was **merged code-only** into `main` at `7761ea37874930ebc8a1bc38baa89ae7b9c7f1fd`. The eOffice endpoints remain **not enabled or deployed**. Stateless operation is a proposed departmental mode, **not yet approved through onboarding**. Basis: original *eOffice AI Service Integration Specification, Phase 1, Version 2.0*, particularly §§2.1, 3.1–3.4, 4, 5, 6.1–6.3. Government authentication and protected-file access are specified separately and **not implemented here**. Existing Grievance Insights pilot routes, datasets, Cognito, UI, AWS resources and the working Qwen document chatbot are unchanged.

## 1. Stateless conversation boundary

- Every `POST /api/v1/ai/chat` requires a syntactically nonempty `session_id` and `user_input` (§§2.1, 3.2). The `session_id` is an eOffice conversation *correlation identifier*, **not** proof of authorization, an authentication token, a lookup key for a hidden provider cache, or consent to disclose another officer's data.
- Each invocation independently calls its injected `authorize(event)` and obtains a trusted `Principal` with `department`, `officer` and permitted task names. Without a valid principal and task permission the handler returns 403 **before** document download, history lookup or inference. `user_id` in the JSON body is informative and, if supplied, must match the trusted officer; it cannot authorize a request.
- The eOffice core has **no cross-invocation session table**, database, in-memory chat history cache, saved provider token, document index, generated artifact or background replay. A repeated `session_id` is processed afresh. An attached document is fetched only for the current request through the injected principal-aware adapter; a subsequent turn never reuses it automatically.
- If a chat turn contains no `previous_context`, no provider token and no document, the service can process the text as a **context-free turn**, not automatically reconstruct earlier messages. Section 4 permits stateless reconstruction from supplied history/token, but it does not guarantee multi-turn memory when neither mechanism is available. The precise expected behavior must be agreed at onboarding.
- In a multi-department deployment, independent per-request authorization and proper scoping of every trusted resolver are required. Mock tests cover duplicate session strings across different officers/departments and concurrent calls, but **do not establish production tenant isolation** without the later official authentication and protected-resource integration.

## 2. Optional history reference

`context.previous_context` is a protected **eOffice-issued reference**, not inline trusted context and never a general-purpose fetch instruction. The production `backend/eoffice/handler.ts` has **no history resolver**: a supplied valid chat reference yields an explicit standardized **422** without loading documents or calling the model. `previous_context` on a non-chat endpoint is invalid (**400**) because the field applies only to `/chat` (§3.2).

For offline testing only, `createEofficeApi()` exposes an optional `ResolveHistory` seam:

```ts
type ResolveHistory = (lookup: {
  readonly reference: string;
  readonly sessionId: string;
  readonly principal: Principal;
  readonly deadline: number;
}) => Promise<string>;
```

The core provides the **validated request session ID**, **trusted per-request principal**, untrusted reference string and shared deadline. It **does not dereference the reference**. Any future authorized adapter must validate the reference's actual owner, department, user, session, expiry and access controls under the separately issued government protocol, **before** returning history. When no authorized matching record is available, it must reject rather than return another session's messages. The `backend/eoffice/testing/mock-harness.ts` resolver uses in-memory **test fixture records only**, matched by all four keys. That temporary fixture table is not production state.

Retrieved history is bounded and inserted under `PRIOR_CHAT (untrusted)` with a system instruction to treat it as data rather than instructions. This is a prompt boundary, **not a demonstrated defense against every real-model prompt injection**. The model and output still require review. Failed resolver lookups return a standardized error (mock: 422); no synthetic history, token or missing prior turn is invented.

## 3. Provider context tokens

`context.provider_context_token` is **disabled**. A syntactically valid supplied token yields HTTP **422** on any endpoint (including non-chat endpoints, where it is not a defined field), before document retrieval, history lookup or inference. It is not included in the prompt, response, references, logs, model call or any persisted store. The service does **not** generate `provider_context_token` in successful chat responses.

The original PDF (§§3.2, 4) permits optional tokens up to **64 KB**. The core's existing **64,000-byte limit for the entire JSON request body** is too small for a full-size token plus the mandatory fields and serialization overhead. This is a documented **incompatibility only if token mode is enabled later**, not grounds to accept or expand the limit now. Token issuance, expiry, replay protections, session binding and handling alongside `previous_context` require departmental onboarding, an approved design and new tests. The feature remains rejected until then.

## 4. Reusable offline API-level harness

`backend/eoffice/testing/mock-harness.ts` provides `createMockEofficeHarness()` and a JSON API Gateway v2 event builder that invoke `createEofficeApi()` exactly as an isolated Lambda request would. It uses a test-owned `WeakMap` binding trusted `Principal` values to specific event objects; it **does not trust headers or user JSON for authentication**. Synthetic `ScopedDocument` fixtures require matching `department`, `officer`, `document_id` **and** protected `download_url`. The optional `ScopedHistory` fixtures additionally require the exact history reference and `sessionId`. The model, document and history adapters are mocked functions with call assertions.

`backend/eoffice/chat-harness.test.ts` covers:

- Four HTTP 200 routes with exact public fields, UUID echo, citations tied to source excerpts and parsed PDF page numbers, complete extraction data including nullable `letter_date` and `approved`, and required `draft_text`; no generated file URL, provider token or protected URL
- Missing/forged authorization, permission failure, user-ID mismatch, cross-officer and cross-department document access; unauthorized requests do not call document retrieval or inference
- Concurrent and repeated identical `session_id` values for different principals, document evidence isolation, no implicit history on subsequent turns
- No authorized history resolver: 422; enabled mock resolver receives the trusted principal, session, reference and deadline; wrong-session/officer history: 422; history treated as untrusted prompt data, not authenticated instructions
- Rejection of `provider_context_token` without forwarding, echoing or executing dependent operations
- Invalid/missing request fields, methods, media types and standard error envelopes; malformed model JSON, fabricated citations, unsupported amounts, conservative non-null boolean rejection and protected URL disclosure
- Synchronous budget exhaustion for delayed model or document operation via Vitest fake timers; HTTP 503, no successful partial response

All records and URLs are **synthetic**; no `fetch`, HTTP client, database, AWS credentials, Bedrock inference, government endpoint, persistent storage or generated artifact is used by the harness.

## 5. Preserved boundaries and limitations

Task 22B's controls remain unchanged: verified per-document verbatim evidence, page-level PDF provenance, source title/URL safety, numeric question non-laundering, exact scalar extraction, **non-null boolean extraction always rejected (502)**, null optional values, protected URL/token redaction guards and explicit size/format/OCR failures. Public eOffice response schemas and four endpoint paths remain unchanged.

The model still performs **lexical grounding**, not semantic proof. A real provider may fail on unsupported schemas, lost OCR text, model truncation, malformed outputs, expired download URLs, unsafe instructions or hard synchronous deadlines. Malware scanning, output-content safety, complete logging/retention guarantees, real role/department verification, official protected-file protocol and any approved chat history state strategy are separate security/integration gates. Do not claim this mock harness establishes government production readiness.

Onboarding must confirm the **stateless/context-free default**, whether/how authorized `previous_context` is to be supported, token mode (currently disabled), session isolation, 64 KB-token body-size compatibility if ever enabled, provider file/title constraints, supported JSON Schema subset, configured synchronous timeout, and retention policy (§6.3). A stateless implementation creates no persistent chat state, but downstream provider logging and training restrictions must still be independently verified (§6.1).

## 6. Historical Task 22C focused verification instructions

The following commands are the **original Task 22C review recipe**, retained for traceability rather than an instruction to rerun already completed checks. PR #41 is merged code-only. For the current unmerged Task 22D correction, use the focused commands in [EOFFICE_SECURITY_HARDENING.md](EOFFICE_SECURITY_HARDENING.md).

From the developer's existing repository (inspect status and choose a different worktree path if it already exists):

```bash
cd ~/src/grievance-insights
git status --short
git fetch origin
git worktree add ../grievance-insights-eoffice-22c origin/feature/eoffice-chat-harness-22c
cd ../grievance-insights-eoffice-22c
git rev-parse HEAD
npm ci
npx vitest run backend/eoffice/chat-harness.test.ts backend/eoffice/core.test.ts backend/eoffice/contract.test.ts backend/eoffice/grounding.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000
npm run backend:typecheck
```

**Historical verification record:** The original Task 22C implementation chat did not run tests. The Brain-maintained handover reports operator verification of **77/77 focused tests** for PR #41 and an earlier backend type-check, before its code-only merge; those runs have **not** been independently rerun in Task 22D. This is not evidence of production integration or an authorization to deploy. The Task 22D draft PR remains subject to separate Brain review and focused WSL verification. No GitHub Actions, paid Bedrock or government requests are required.
