# Pilot website — Qwen document chat MVP

Status: **feature branch only; not locally tested, merged, or deployed** (2026-11-23).

## Operator-facing scope

The signed-in AWS pilot's **Assistant → Ask** tab uses Qwen3-32B via Amazon Bedrock. The operator can ask about an opened complaint or choose its originating uploaded file, and request free-form summaries, key points, emails, government file notings, draft letters, translations and suggested actions. Follow-up messages are sent in the same request as bounded in-memory history. Source files are never modified. The separate **AI analysis** tab retains its existing fixed-schema background job.

- Document context comes from the authenticated private S3 dataset index. The browser sends an uploaded-file UUID, an optional original case ID and index, plus the operator's messages; it never supplies untrusted source text to authorize.
- Server independently checks the existing hashed session, same-origin POST, ready dataset and ownership before reading sources or invoking Qwen.
- API: `POST /api/datasets/{id}/chat` wired to the existing analysis API Lambda. Qwen model and region match existing analysis (`qwen.qwen3-32b-v1:0`, `ap-south-1`). The existing Lambda role already has bounded dataset GetObject and Bedrock InvokeModel permissions. One explicit new HTTP API route is required; no eOffice route is enabled.
- Response: `{answer, citations, model}`. A citation is emitted only when one original record was supplied; for multi-record files the MVP deliberately does not assert that all supplied records were actually used. The browser resolves original case IDs to the merged All Complaints IDs before making them clickable.
- Current MVP bounds: 16 KiB request body, 12 chat messages, 4,000 characters/message, 24 KB source JSON, 32 KB combined system/source/history prompt, 40 full-file records, 1,500 output tokens and an 18-second Bedrock deadline. Oversized material is **rejected, not silently truncated**. A specific complaint can still be selected from a 2,000-record file with an authenticated record index.
- Model-generated notings, decisions, suggested remedies and draft correspondence require operator review. The model must not claim a department response means verified resolution.
- No chat history persisted in S3/DynamoDB or browser storage. The chat resets upon moving to a different opened complaint or file or closing the panel. Standard Lambda/service logs must not contain source text or prompts.

## Before release

1. Install locked dependencies locally (Node 22) and run `npm run backend:typecheck`, `npx vitest run backend/analysis/chat.test.ts src/tests/document-chat.test.ts --maxWorkers=2 --testTimeout=20000`, `npm run backend:test`, `npm run lint`, `npm test -- --maxWorkers=2 --testTimeout=20000`, `npm run build:aws` and `npm run backend:package`.
2. Exercise the AWS frontend against a mocked authenticated API with a single-record DOCX/PDF, a multi-record CSV, an empty/missing response, duplicate IDs across files, Telugu requests, and multi-turn drafting. Confirm zero existing dashboard/analysis regressions.
3. Run a **read-only, remote-state-backed Terraform plan** using existing state and AWS identity. Accept only the intended new API Gateway route plus analysis Lambda code-package update and any necessary in-place changes; reject resource destruction or replacement. Verify remote state, apply permissions, and rollback before any deployment.
4. Only after review and explicit release approval, deploy infrastructure/backend and then frontend using the established guarded mechanism. Both frontend and infra workflows are manual/main-only and have environment enablement guards. Do not assume GitHub Actions is enabled. Never use eOffice's fail-closed routes.
5. Smoke-test the **currently deployed pilot** before/after deployment: Cognito sign-in/out, upload/finalize all seven formats, OCR, All Complaints, exports, existing analysis jobs/results, summary filters, and newly authenticated Qwen chat. Verify citation IDs and deny across users. Monitor CloudWatch for sanitized failures and Bedrock cost/latency.
6. If chat latency at the bounded synchronous endpoint is unacceptable, separately design an asynchronous/streaming solution. Do not bypass request authentication or raise model/AI quotas automatically.

Deployment is **not** inferred from a GitHub merge. No paid Bedrock inference should be performed without explicit approval.
