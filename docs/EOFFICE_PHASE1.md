# eOffice Phase 1 v2.0 – integration status and onboarding

This branch implements a contract handler for four endpoints under `/api/v1/ai` (chat, summarize, extract, draft-reply). It is **not deployable for production use yet**: the separate authentication/protected-file-access specification and network-vetted eOffice fetch transport remain unavailable. The production handler denies all calls by default. No routes or AWS resources are created, changed, or deployed in this branch.

## Architecture and constraints

- `backend/eoffice/core.ts`: injectable authorization, documents, model and optional history adapters; UTF-8 JSON contracts and safe error responses.
- `backend/eoffice/aws.ts`: Bedrock Converse with `qwen.qwen3-32b-v1:0` in `ap-south-1`, leveraging existing SigV4 code. Never transmits original files, only extracted text.
- `backend/eoffice/documents.ts`: allowlisted URL validation, DNS checks, bounded text extraction for UTF-8 plain text/Markdown, DOCX and searchable PDFs using existing ingestion libraries. OCR-dependent PDFs are rejected. The default HTTPS transport deliberately rejects requests instead of exposing an unpinned DNS/SSRF channel; onboard a network-verified DNS-pinned HTTPS transport with the agreed authentication before enabling document download.
- `backend/eoffice/schema.ts`: JSON Schema subset: flat object, 1–32 named scalar properties, string/number/integer/boolean/null types and required array only. Optional fields must include null. Nested structures, arrays, enums, patterns, formats and other schema keywords are unsupported and rejected.
- `backend/eoffice/handler.ts`: fail-closed production stub. No trust is placed in caller-supplied `user_id`.
- No PDF/DOCX drafting artifacts or URLs are generated; `draft_text` is always returned.
- Chat strategy: stateless; `session_id` required, no local conversation storage. `previous_context` needs an authorized injectable history resolver. Provider tokens are currently explicitly rejected with 422 instead of silently ignored or used across user/session boundaries; negotiate this behavior on onboarding.
- Retention: request-local data only, no permanent chat/document persistence or cache. No temporary retained data to expire. Any future artifact or state persistence must enforce default 12 h and maximum 24 h.

Limits: 64,000-byte request JSON, 24,000-byte officer input and aggregate source, 2 MiB per file, 24,000-byte extracted text per document, up to four documents, 24,000-byte model response, 1,400–1,600 max model tokens. Deployment must negotiate API Gateway/Lambda synchronous budgets, file types and limits. Existing Bedrock transport has a 75-second deadline, which must be reconciled with eOffice's configured synchronous timeout before deployment.

## Outstanding blockers / security review

1. Separate official eOffice authentication, tenant identity, authorization and file-access credential protocol. Implement a trusted principal adapter; do not wire UI sessions or `user_id` as an identity proof.
2. Approved eOffice hostname list, DNS-pinned/fixed-egress HTTPS fetch mechanism, access credentials, malware scanning, redirection policy and historical context retrieval rules. Default adapter intentionally declines downloads.
3. Synchronous SLA, resource limits, task enablement, allowed schemas, chat context mode and temporary-data retention agreement.
4. Before production: add properly isolated API Gateway routes + authorizer, scoped Lambda IAM, packaged Lambda, timeout and observability controls, after sign-off. No infrastructure changes are included here.
5. Review grounding/reference accuracy: document references currently identify every supplied document passed into the prompt, not verified model-level citations. An explicit evidence/citation validation protocol is recommended before production.
6. Hardening: connect model deadlines to a per-request budget, enforce validated source egress in deployment, and run security tests and realistic PDF latency benchmarks.

## Local verification

```sh
npm ci
npm run backend:typecheck
npm run backend:test
npm run lint
npm test
npm run build
```

Tests mock both AI inference and document loading; no paid inference is needed. Do not interpret passing contract tests as deployment readiness.
