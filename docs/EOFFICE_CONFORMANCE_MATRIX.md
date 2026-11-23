# eOffice Phase 1 v2.0 — conformance matrix (Task 22A)

**Status:** Code audit completed against `main` at `e5a5207b6d89aac57fb6a7ba9acc87e74dbae026`, plus this branch's focused corrections. **Provisional specification mapping:** The authoritative eight-page PDF was referenced in the task but its original bytes were **not available** through this implementation chat's files surface or repository. The requirement descriptions below come from the living handover (`docs/BRAIN_HANDOVER.md`) and `docs/EOFFICE_PHASE1.md`, not from a fresh inspection of the PDF. Consequently, the PDF section mapping is a **topic locator, not a verified page/section citation**. An independent reviewer **must compare the PDF directly** before declaring complete specification conformance. The handover explicitly identifies summary input as PDF §2.2; all other PDF section identifiers need direct confirmation.

Classification: **M** mandatory; **O** optional; **D** departmental onboarding or separately issued specification. Status: **Pass** implemented and source-inspected (not freshly executed); **Partial** bounded implementation or pending acceptance; **Blocked** official integration unavailable; **N/A** optional behavior not enabled.

| Requirement / PDF section locator (verification status) | Class | Implementation | Status | Gap or limitation |
| --- | --- | --- | --- | --- |
| Four synchronous HTTPS POST JSON paths: chat, summarize, extract, draft-reply (API/task sections; number unverified) | M | `core.ts:createEofficeApi` dispatches exact paths, POST/JSON enforcement, HTTP 200 success; 25-second budget | Partial | No deployed HTTPS routes by design; real synchronous timing requires onboarding |
| Consistent request and response UUID `request_id` (common envelope; number unverified) | M | `core.ts:requestId`, `request`, `encode`: UUID syntax required, successful and safely parsed errors echo same value | Pass | Only syntactically well-formed UUIDs are echoed; oversized/malformed bodies cannot safely yield ID |
| Common standardized `system_error_message` and `user_error_message`, suitable HTTP 4xx/5xx (errors; number unverified) | M | `core.ts` catch; `schema.ts:EofficeError` | Pass | Public messages generic by design; no official auth error mapping yet |
| `user_id` is not a credential; prevent cross-user and cross-department access (security; number unverified) | M | Injected trusted `Principal`, permission checks and officer mismatch rejection, principal passed to document/history adapters | Partial | Separately supplied government principal mapping absent; `handler.ts` always denies |
| `/chat`: `session_id`, nonempty `user_input`, Markdown `answer` and `references` array (chat section; number unverified) | M | `core.ts:request`, `decodeModel`, chat response branch | Pass | Markdown is instructed, not semantically verified |
| `/chat`: documents and previous context (chat section; number unverified) | O / D | Optional `context.documents`; previous context via injected `history` resolver | Partial | History resolver not configured in production; unconfigured history fails explicitly with 422 |
| `/chat`: `provider_context_token` / conversation mode (chat section; number unverified) | O / D | Input recognized but explicitly rejected with 422 when supplied | N/A | Stateless mode needs onboarding agreement; no token issuance |
| `/summarize`: real source text in `user_input` or accessible documents (PDF §2.2 per handover; direct PDF unverified) | M | `core.ts:hasSummarySource` rejects common instruction-only text; documents passed to model | Partial | Source/instruction detection heuristic cannot prove semantic source content |
| `/summarize`: Markdown `summary`, optional references (summarize section; number unverified) | M / O | Returns `{request_id,summary}`; internal attributed IDs validated | Pass | Optional `references` intentionally not included, even when documents were used |
| `/extract`: `context.documents` and `extraction_schema` required (extract section; number unverified) | M | `request` requires ≥1 document; `parseSchema` validates schema | Pass | Only supported schema subset accepted |
| `/extract`: complete structured `extracted_data` and `references` (extract section; number unverified) | M | `validateExtraction` enumerates every declared property; response includes references | Pass | Evidence attribution IDs validated but semantic factual extraction unproven |
| `/extract`: required missing/unreadable values must error, no fabricated values (extract section; number unverified) | M | Missing/null/blank required strings produce 422; malformed types/JSON produce 502 | Pass | Model evidence checking still required |
| `/extract`: nullable optional values must appear as `null` (extract section; number unverified) | M for declared nullable optional fields | `schema.ts:validateExtraction` fills absent keys with null; Task 22A also normalizes blank optional strings to null | Pass | Date formats, nested objects, arrays and enums unsupported |
| `/extract`: schema capabilities (extract/onboarding sections; numbers unverified) | D | Flat typed scalar fields; ≤32 properties; optional fields must allow null | Partial | Nested structures, constraints, formats, enums, arrays not supported; must agree schema subset at onboarding |
| `/draft-reply`: nonempty `user_input`, `draft_text`, `references` (draft section; number unverified) | M | `core.ts` validates input and response; explicitly frames draft as proposed for officer review | Pass | Officer review remains an external workflow |
| `/draft-reply`: optional generated PDF/DOCX `generated_file_url` (draft section; number unverified) | O | Field deliberately omitted | N/A | No protected generated artifacts are created |
| `context.documents` items contain `document_id` and `download_url` (documents section; number unverified) | M when documents supplied | Exactly two required keys, unique IDs, bounded reference count | Pass | Actual credential acquisition deferred |
| Secure protected file retrieval and anti-SSRF (security/onboarding; numbers unverified) | M / D | `documents.ts` HTTPS allowlist, DNS/IP vetting, pinned IP, redirects disabled, read/size limits | Partial | Official government protected download credentials, malware scanning and deployment egress policy absent |
| Sources are truthful; no invented URLs, document IDs or references (references section; number unverified) | M | `decodeModel` rejects unknown/duplicate/invalid attributed IDs; metadata from fetched materials; URL leak check | Partial | Model attribution is not independently verified against actual claims; Task 22B |
| Synchronous bounded processing, explicit errors instead of silent truncation (execution; number unverified) | M / D | Body, docs, prompt and model output byte limits; 25s handler/18s inference deadline; 422/503 on limits | Partial | Size and timeout limits require departmental sign-off; no real document latency testing |
| Supported PDF/DOCX/TXT/MD, scanned PDFs and other formats (format/onboarding; numbers unverified) | D | `documents.ts`: UTF-8 text/Markdown, DOCX, searchable PDF | Partial | Scanned PDF synchronous OCR unsupported (422); formats/sizes require onboarding |
| Security of prompt content, confidential handling and no unauthorized reuse (security; number unverified) | M | System prompt marks document/history untrusted; no persistence in module; response no-store | Partial | Prompt-injection evaluation, malware scanning, complete log/retention review pending |
| Temporary content retention default 12h, maximum 24h if state/artifacts created (retention; number unverified) | M when temporary data retained | No eOffice chat state, files or cache persisted | N/A | If state/artifact storage is added, expiry controls mandatory |
| Government authentication / protected document identity protocol (separate government specification) | D, integration gate | `handler.ts` authorizer returns null, protected credential resolver throws | Blocked | Not supplied. **Do not enable unauthenticated routes** |
| Deployable isolated routes, onboarding endpoints/hosts, end-to-end acceptance (onboarding; number unverified) | D | No new AWS or API Gateway configuration in this branch | Blocked | Explicit review/owner authorization required; existing pilot unchanged |

## Task 22A code delta and regression evidence

- `backend/eoffice/schema.ts`: nullable optional extraction string fields that are missing, empty or whitespace-only now normalize to `null`. Required blank fields still return 422; malformed nonblank values remain 502.
- `backend/eoffice/contract.test.ts`: mocked route fixtures for all four response shapes, UUID echo, attributed references, nullable and required extraction values, standardized errors, protected URL exclusion, and unchanged production default-deny.
- **Execution status:** tests have been authored but not executed through GitHub Actions, live Bedrock, or WSL in this chat. Do not represent source review as a passing run.
- **Safety:** no edits to existing pilot handlers, frontend, datasets, grievance analysis, Cognito, Terraform, IAM, deployment workflows, or `backend/eoffice/handler.ts`.

## Targeted WSL validation (no full-suite rerun)

From a clean, separate worktree with dependencies already installed:

```bash
cd ~/src/grievance-insights
git fetch origin
git worktree add ../grievance-insights-eoffice-22a origin/feature/eoffice-phase1-contract-22a
cd ../grievance-insights-eoffice-22a
npx vitest run backend/eoffice/contract.test.ts backend/eoffice/core.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000
npm run backend:typecheck
```

If dependencies are absent in that worktree, run `npm ci` once before Vitest (do not invoke GitHub Actions). First inspect whether the worktree path already exists; do not blindly overwrite it. No Terraform, deployment or Bedrock calls are required.

## Explicit handoff blocker

**The original eight-page PDF must be provided to or directly accessible in the independent review chat.** Verify exact PDF section/page identifiers, mandatory versus optional field declarations, examples and omitted provisions against the original. Do not treat this provisional matrix as a final signed-off specification audit.
