# Grievance Insights — Living Brain Handover

**Last updated:** 2026-11-23 (Asia/Kolkata)  
**Canonical location:** `main`, file `docs/BRAIN_HANDOVER.md`, repository `Reagvis/grievance-insights`. Initial documentation branch `docs/brain-handover` was fast-forwarded into `main`.  
**Purpose:** durable context for a replacement project-brain ChatGPT conversation and coordination record for the current brain. This is a historical evidence ledger, not automatically synced to activity outside the conversation.

## READ FIRST — recovery instructions

You are taking over the independent technical lead / reviewer role for the Grievance Insights AWS pilot and its eOffice Phase 1 API integration. Read this file, inspect current GitHub state via the connector, and obtain the authoritative eOffice Phase 1 v2.0 PDF from the Project/conversation files (ask for the document if unavailable). Never treat remembered or written commit statuses as current without checking. Continue from the open engineering decisions, not a fresh design exercise.

**Hard instructions:** The developer explicitly forbids running or triggering GitHub Actions due to billing; do not initiate, rerun, or deliberately trigger CI. Do not claim tests pass without real output. Do not invent eOffice authentication/protected-file-access protocol, and do not expose fail-closed handlers. Do not merge, deploy, or perform destructive changes to AWS/Terraform without an explicit task and reviewed safety checks. Preserve current dashboard, user data, Cognito/auth, existing Bedrock pipeline and Terraform remote state.

**Current top priority:** Make the existing Grievance Insights AWS pilot provide the government eOffice Phase 1 v2.0 synchronous AI API. The seven-format / capacity pilot release is a parallel priority. This is one adapted existing product, not a replacement eOffice app or separate unrelated architecture.

## 1. Developer and operating model

- Primary developer: Fellow-DevJk (this user). **They use Codex**, not Claude Code. Their colleague used Claude Code. User's Codex usage limits were exhausted.
- Separate ChatGPT implementation chats have connected GitHub write capabilities, create commits and maintain draft PRs. This brain chat independently reviews actual diffs/commits, comments on PRs, and gives precise local WSL test/deployment commands.
- User's machine: WSL shell previously displayed as vatjksre@excalibur; repository path ~/src/grievance-insights. Never assume clean working tree. Always check git status, branch and HEAD before switching or pulling.
- GitHub Actions: User insists **local-only testing**. Repo CI workflow .github/workflows/ci.yml has pull_request:main and push:main automatic triggers. **User explicitly confirms that they disabled the CI workflow** (referred to as the npm ci workflow); the connector has not independently read the workflow state. Last checked before that report, no workflows were running. Do not start/rerun Actions. Documentation-only main updates should use `[skip ci]` commit messages as an additional safeguard. Deployment workflows use workflow_dispatch, not automatic triggers.
- Maintain this living document *during subsequent turns* after meaningful milestones by updating this same file via GitHub connector, then verify the remote commit. This is not an asynchronous service, scheduled job or cross-chat automatic sync. Do not give the developer downloadable copies in place of repository updates. Keep facts, hypotheses, pending work and verified/tested states separate.

## 2. Repository and production architecture

- GitHub: https://github.com/Reagvis/grievance-insights
- Pilot URL: https://telangana-gov-pilot.reagvis.com/
- AWS region: ap-south-1, account ID in deployment workflow 134857759074.
- Bedrock model: qwen.qwen3-32b-v1:0 (Qwen3-32B).
- Stack: TypeScript AWS Lambda/API Gateway, S3, DynamoDB, SQS, Bedrock, Terraform; React/Vite dashboard, private frontend S3 behind CloudFront.
- Main source areas: backend/analysis (Bedrock/inference/job orchestration), backend/datasets (private datasets/API), backend/ingest (multiformat text/PDF/DOCX/OCR), backend/auth, src (dashboard), infra (AWS).
- Remote Terraform state: S3 bucket grievance-insights-pilot-134857759074-tfstate; state key grievance-insights/pilot/terraform.tfstate; region ap-south-1. NEVER run an uninitialized/new local Terraform state against production.
- Frontend bucket: grievance-insights-pilot-134857759074-frontend. CloudFront distribution: E3B0B5R1HAYD1J.
- Existing deployment recipes: .github/workflows/deploy-infra.yml and .github/workflows/deploy-frontend.yml. Can be translated to local Terraform/AWS CLI workflow after confirming AWS identity and real plan. No need to fix GitHub Actions billing to deploy locally.
- User urgently wants current 2,000-record and seven-format features LIVE on the existing AWS pilot, no new staging account. However **actual live AWS deployment of those features remains unverified** in this brain chat. Main-branch merge is not deployment confirmation. Never apply an unreviewed plan, replace/destroy existing resources, or incur high-volume Bedrock charges.
- Main incorporated the documentation-only handover by fast-forward from `900402f2c37008df790a6da9bee75237779eefd8` to `e9625eab058c23c5d3e42ce539855ae6aa802b96` on 2026-11-23; subsequent documentation edits also advance main. Always recheck HEAD rather than treating this historical SHA as current.

### Task 19 — capacity (merged PR #27)

- 2,000 records / approximately 20 MiB accepted CSV/JSON/JSONL.
- Immutable 50-record S3 index chunks, bounded AI prompts/record results and retrieval pagination, checkpointed inference/retry and JSON export.
- Large 19.49 MiB stress test measures indexing, S3 I/O and process RSS in mocked Vitest environment. Do not equate Vitest RSS to measured AWS Lambda peak memory.

### Task 21 — seven formats (merged PR #28)

- TXT, MD, DOCX, CSV, JSON, JSONL and PDF; Telugu+English Tesseract OCR for scanned PDF.
- Existing scanned PDF extraction uses SQS async Lambda worker, not allowed for synchronous eOffice Phase 1 endpoints.
- PR #27 and #28 had merged into main when checked on 2026-11-23. Existing Grievance Insights dashboard and Bedrock analysis must remain unaffected by eOffice changes.

## 3. Government eOffice Phase 1 v2.0 specification

Authoritative document: eOffice_AI_Phase1_Specification_v2.pdf, 8 pages. The originating chat received the PDF; a successor chat must access the PDF directly via Project files or an upload. Do not substitute this handover for exact spec text.

Goal: implement an eOffice compatibility API in this *existing* pilot. Four task-specific POST JSON HTTPS endpoints at /api/v1/ai:

1. /chat: mandatory UUID request_id, session_id, nonempty user_input; user_id for audit/context; optional documents and prior chat context; response answer (Markdown) and references array, optional provider_context_token.
2. /summarize: supply actual material via context.documents or source text in user_input. Instructions alone with no documents are invalid. Response summary (Markdown); references optional when only supplied content used.
3. /extract: required context.documents and extraction_schema; output complete schema-conforming extracted_data with nullable optional fields. Never fabricate required values; unavailable required values return standardized error. References array.
4. /draft-reply: nonempty user_input, optional documents, always draft_text and references; optional generated_file_url only when actual protected temporary PDF/DOCX is created. Drafts need officer approval.

Global contract: synchronous only (no async jobs/polling/callbacks); HTTP 200 on success; echo request_id in errors when available; correct 4xx/5xx standardized body with system_error_message and user_error_message; source references identify material actually used; no protected download_url or credential disclosure; context.documents items contain exactly document_id and download_url.

Auth and protected-file access **specified separately in a government document we have NOT received**. user_id cannot establish identity. Providers isolate department/user/session data. Temporary processing data default retention 12h and max 24h; no long-term eOffice content storage/training. Prompt injection, safe file download/SSRF, source grounding, human review, response validation required. Supported file sizes, formats, schemas, synchronous timeout, chat mode and enabled tasks to be agreed during onboarding.

## 4. eOffice PR #37 (open draft)

- PR: https://github.com/Reagvis/grievance-insights/pull/37
- Branch: feature/eoffice-phase1-api; base main. Keep the draft eOffice feature branch isolated from the handover changes on `main`.
- Initial commit: 84d09064f20d9dd2716519855af50e3954107b4d.
- First correction reviewed head: 0d93255d6d896f40a8be8e176f4b2f1167538665.
- **Current latest verified PR head at 2026-11-23:** `7e738913d1f07601a795463b65bb32e26d3cfaac` (two newer commits after 0d93255). The independent reviewer inspected the corrected validator and regression test source.
- Latest commit message: "test(eoffice): use real whitespace escape sequences [skip ci]". Two newer commits modify backend/eoffice/schema.ts and backend/eoffice/core.test.ts. GitHub code shows required whitespace-only string now maps to 422. **Do NOT call this fix locally verified until developer runs tests on new head.**
- Original review comment: https://github.com/Reagvis/grievance-insights/pull/37#issuecomment-7091205548
- Second review comment: https://github.com/Reagvis/grievance-insights/pull/37#issuecomment-7091846170
- eOffice files: backend/eoffice/core.ts, schema.ts, documents.ts, aws.ts, handler.ts, core.test.ts, schema.test.ts; docs/EOFFICE_PHASE1.md; initial change to shared backend/analysis/aws-http.ts and backend/tsconfig.json.

Implemented: all four handlers with task-specific prompts, injected Model/Authorize/DocumentSource, POST + JSON validation, UUID echo, bounded source/prompt/deadline, optional history interface, limited flat-scalar extraction JSON Schema, internally validated used_document_ids attribution, protected HTTPS document fetching with allowlist, DNS vetting, IP pinning and caller-scoped access resolver. Reuses existing Bedrock transport and searchable PDF/DOCX parser. Rejects scanned PDF OCR in synchronous eOffice path.

**Critical safety:** production backend/eoffice/handler.ts authorize callback returns null (fail-closed). No API Gateway eOffice routes or Lambda/Terraform resources have been added or deployed. Do not weaken this condition or invent government auth. Both official authorization and protected-document retrieval credentials remain pending.

Limitations: model-attributed IDs are not semantic/factual evidence; /summarize source-vs-instruction check is conservative heuristic; only flat scalar JSON Schema subset; provider context tokens not supported; protected previous_context adapter not operational; no PDF/DOCX draft artifact URLs; exact timeouts/formats/department hosts depend on onboarding; real document/network performance and malware/egress controls must be validated. Do not expand scope into async APIs, OCR accuracy improvements or a redesign.

### Review findings and verification history

Five original issues from first review: HTTP method/media enforcement; valid request-ID echo incl errors; reject obvious instruction-only summary; avoid citing all attached documents without attribution; pass authenticated principal to document retrieval. These were addressed in 0d93255... along with budget/error/URL safeguards.

At 0d93255..., actual GitHub Actions run 45113451408 executed and FAILED: Terraform job passed, overall validate failed because 1 Vitest case expected 422 but got 502. 351/352 tests passed on CI. Developer subsequently explicitly prohibited future GitHub Actions runs; do not rerun.

Root defect: backend/eoffice/schema.ts::validateExtraction treated required empty string as provider malformed output (502) instead of missing/unreadable required value (422). Requirement: null, missing, empty or whitespace-only required string -> 422; wrong type, bad JSON, unexpected fields -> 502. New 7e738... code contains the correction and an added whitespace test, **but no new passing local test result has been provided**.

## 5. Local WSL verification evidence (user-supplied)

- User's earlier runtime: Node.js v24.17.0, while former repo CI used Node 22. Whether Node 22 is now active must be confirmed with node -v if material.
- Initial default-concurrency local npm test: 342/352 passed, 10 failures. Eight were 5-second timeouts; one was capacity RSS threshold; one was eOffice 422/502.
- Attempted --minWorkers flag rejected by installed Vitest. **Never recommend --minWorkers again** without checking version.
- Working retry: npm test -- --maxWorkers=2 --testTimeout=20000. Result **350/352 passed** (31/33 files, 31.57 sec). Eight timing failures disappeared. Two remaining failures: Task19 capacity-stress incremental RSS 558,964,736 bytes above 512 MiB (536,870,912 bytes), and the same eOffice 422/502 defect at older commit.
- Isolated stress test command recommended: npx vitest run backend/analysis/capacity-stress.test.ts --maxWorkers=1 --testTimeout=30000. User reported **1/1 passed**, duration 11.64 sec. This is a genuine isolated local pass, not a full-suite or deployed Lambda benchmark.
- Frontend npm run build completed successfully in initial user logs; Vite native-loader and Rolldown @__PURE__ messages were warnings.
- Fresh head 7e738... still needs focused eOffice regression tests and relevant local build/validation, with no GitHub Actions.

## 6. Exact next steps and WSL commands

1. Developer now confirms GitHub Actions CI was disabled; optionally verify `gh workflow view ci.yml --repo Reagvis/grievance-insights --json state` when convenient. Do not manually dispatch, rerun or initiate runs.
2. Review GitHub PR37 diff up to 7e738...; confirm extraction regression correction and preserve default-deny auth.
3. Locally verify new head, avoiding dirty local branch changes. Suggested sequence:

    cd ~/src/grievance-insights
    git status --short
    git branch --show-current
    git fetch origin
    git worktree add --detach ../grievance-insights-eoffice-review origin/feature/eoffice-phase1-api
    cd ../grievance-insights-eoffice-review
    git rev-parse HEAD
    node -v
    npm ci
    npx vitest run backend/eoffice/core.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000
    npm run backend:typecheck
    npm run backend:test
    npm run lint
    npm test -- --maxWorkers=2 --testTimeout=20000
    npm run build
    npm run build:aws
    npm run backend:package

   If the review worktree exists already, reuse/update it safely; do not blindly recreate. If a full test run has the known process-level RSS flake while isolated stress passes, capture RSS benchmark output and distinguish environmental test pressure from code regression. Do not simply raise assertion threshold.

4. If focused tests pass, complete independent review, resolve any remaining true defects, then plan eOffice authentication onboarding. Wait for official government authentication/protected file protocol. Do not deploy public eOffice endpoints.
5. Parallel: Verify whether Task19/21 merge is actually deployed in AWS pilot before claiming it live. Local deployment is possible after confirming AWS identity, real Terraform plan (no unintended delete/replace), and essential smoke tests; no separate staging required. This is not authorization to deploy eOffice.

## 7. Handover upkeep rules

After each material event in this conversation (PR new head, reviewed code issue, local test suite result, CI disable confirmation, auth specification arrival, safe merge, infrastructure plan/deployment), update this SAME file on `main` via GitHub connector, with the new commit SHA. Use `[skip ci]` in documentation-only commit messages. Keep historical evidence distinct from current operational state. Do not overwrite other team changes: fetch the current blob SHA and use an optimistic content update.

A successor brain chat should open:
https://github.com/Reagvis/grievance-insights/blob/main/docs/BRAIN_HANDOVER.md

Use current GitHub state, the official specification and latest local logs as authority when they differ from this snapshot. Handover was merged into `main` by fast-forward update, and no PR was created. User confirms CI was disabled; never manually start or rerun workflows.

**This handover records work and decisions; it is not a background process or a substitute for the government eOffice specification.**
