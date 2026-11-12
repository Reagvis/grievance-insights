# Implementation status

Last updated: 2026-11-11

## Current state

The React/TypeScript/Vite prototype is functional. Development and preview retain the in-memory Vite-local API; static builds process records in the browser. AWS hosting and deployment foundations are operational. A tested Cognito/Lambda/DynamoDB authentication backend and its Terraform definitions now exist, but no backend resources are deployed. All deployment guards remain disabled, frontend authentication is implemented for AWS builds but not live-tested, and no frontend assets have been published.

## Completed

- Established a locked Node.js build with lint, Vitest, and production build commands.
- Added GitHub Actions CI for pull requests and pushes to `main`, using Node.js 22, `npm ci`, dependency caching, minimal permissions, concurrency cancellation, and a three-day frontend build artifact.
- Documented operational guidance, current/proposed architecture, and initial architectural decisions.
- Validated the baseline and project-foundation changes without changing application behavior.
- Added pinned Terraform 1.14/AWS provider configuration for a private versioned S3 frontend origin, CloudFront OAC and secure SPA routing, a `us-east-1` ACM certificate, and Route 53 aliases.
- Added and applied bootstrap configuration for a dedicated encrypted/versioned S3 state backend, native lockfile access, and separate repository/environment-scoped GitHub OIDC roles.
- Documented authentication, data lifecycle, asynchronous Bedrock processing, deployment separation, costs, and unresolved governance decisions in `docs/INFRASTRUCTURE.md`.
- Validated formatting, backend-disabled initialization, both Terraform roots, and a read-only hosting plan against a temporary empty local state. No state or binary plan was retained.
- Corrected backend lockfile permissions, restricted shared-zone DNS writes by normalized name/type/action, narrowed CloudFront/ACM lifecycle permissions, and added credential-free Terraform CI validation for both roots.
- Deployed the dedicated Terraform state bucket, infrastructure role, private frontend S3 origin, CloudFront distribution, ACM certificate, and pilot Route 53 aliases.
- Added the distribution-scoped frontend publishing role and a manual, OIDC-based deployment workflow guarded by `PILOT_DEPLOY_ENABLED=false`.
- Added and applied split, project-scoped backend provisioning policies plus a mandatory runtime-role permissions boundary; the deployer cannot invoke Bedrock models and streaming remains opt-in for future approved runtime resources.
- Migrated bootstrap Terraform to its own remote S3 state key, added a non-self-administering bootstrap OIDC role, and added guarded GitHub Actions bootstrap plan/apply automation.
- Added the administrator-only Cognito authentication Lambda with hashed opaque sessions, strict same-origin login/logout, session validation/revocation, deterministic GitHub packaging, and Terraform for HTTP API, DynamoDB, bounded runtime IAM, and uncached CloudFront API routing.

Task 1 merged as PR #1 at `9fe0e6d`; Task 2 merged as PR #2 at `7a4b271`.

## Outstanding

- Review and deploy the implemented authentication infrastructure through the guarded infrastructure workflow; create administrator users separately only after deployment approval.
- Validate AWS frontend authentication against the deployed backend after separately approved infrastructure deployment.
- Design and implement DynamoDB application metadata, private S3 datasets/results, SQS/DLQ, worker Lambda, and Bedrock access.
- Define dataset schemas, retention rules, upload limits, job lifecycle, Bedrock model/prompt/evaluation strategy, and human-review controls.
- Replace the local service implementation with authenticated production APIs while preserving the existing frontend contract and behavior.

## Limitations and blockers

- All bundled data is synthetic; imported data is not persisted.
- Current summaries and assistant answers are deterministic, not AI-generated. Telugu report generation, OCR, RAG, RBAC, audit logs, and production observability are absent.
- The Vite build and tests emit a forward-compatibility warning for extensionless imports under Vite's future native config loader. It does not currently fail validation.
- Qwen3 32B is active in `ap-south-1` and approved only for initial synthetic-data evaluation; Bedrock quotas, broader model suitability, data classification, retention policy, and production access controls remain undecided.
- Authentication infrastructure is not deployed and frontend authentication is implemented in code but not deployed, so publication remains disabled and the hosting bucket remains empty.

## Recommended next task

Review PR infrastructure plans, then deploy the authentication backend through the guarded infrastructure workflow when explicitly authorized. Next validate frontend login/logout/session restoration after backend deployment. Keep `PILOT_DEPLOY_ENABLED=false` until both layers are reviewed.

## Frontend authentication (PR #11)

AWS builds now use a separate Vite `aws` mode and require the same-origin Cognito-backed session API before rendering the existing workspace. Login, logout, restoration, 401 expiry handling, periodic and visibility revalidation, accessible errors and focused client/UI tests are implemented. GitHub Pages and local development retain unauthenticated synthetic demos. UI gating is not data authorization; all future grievance endpoints require independent backend authorization. No backend or frontend deployment performed.


## Task 15 — persistent datasets (PR #16; code only, not deployed)

Implemented private dataset upload coordination with five authenticated API routes, short-lived single-key S3 presigned PUTs (signed Content-Type and If-None-Match), DynamoDB metadata, server-side strict UTF-8 and schema validation using the existing importer, per-user ownership checks, dataset retrieval, and deletion. AWS-mode UI supports upload, status, list, open, refresh restoration, and confirmed deletion. Local and Pages modes retain browser-only import. Backend is packaged deterministically with CI; Terraform resources are defined but have not been applied.

Pilot limits: 1 MiB per file, 200 rows, 300-second upload URL expiry; only CSV/JSON, unique nonblank case IDs, nonblank complaintText. Files failing validation are retained privately in failed status until deleted. The initial synchronous validator executes within the API Lambda and may need a queue for larger production datasets. Metadata is preserved if object deletion fails; retry delete. If S3 delete succeeds but DynamoDB delete fails, retry delete (S3 DELETE is idempotent). This task does not deploy or invoke Bedrock.


## Task 16 — Bedrock analysis implementation (stacked PR #18; not deployed)

The `feature/task-16-bedrock-processing` branch is stacked onto Task 15 PR #16 and adds a TypeScript Qwen3-32B Converse processing pipeline. Authenticated administrator-only job routes verify hashed server-side sessions and dataset ownership independently. A FIFO SQS queue, redrive DLQ, DynamoDB job state, one-concurrency checkpointed Lambda worker (one global FIFO message group), and private encrypted S3 result objects provide asynchronous processing. The browser can start a persisted dataset analysis, resume job status across refresh, inspect validated Telugu per-record and category outputs, compare source complaints and department responses, and export private results as JSON. Existing browser-deterministic summaries and GitHub Pages demo remain unchanged.

Pilot ceilings: at most 30 imported records per AI job (Task 15 supports 200 per dataset); three records per worker invocation; Lambda concurrency one; maximum 1,800 model output tokens per inference, two local attempts, SQS maxReceiveCount three; one analysis job per dataset, with no rerun after terminal failure in this version. The model is fixed to `qwen.qwen3-32b-v1:0` in `ap-south-1`, prompt `te-grievance-response-v1`. Evidence is rejected unless it is an exact source substring; statuses never assert independently verified resolution. Category counts and response-status counts are deterministic aggregations of *validated model outputs*, not source-ground-truth statistics. Category narratives assemble AI-written per-record summaries, not a separate model pass. Per-record sanitized failures are included.

Private AI results expire after 90 days; DynamoDB job metadata has a TTL at day 89 (TTL removal is asynchronous). Dataset deletion makes job/results API reads inaccessible and prevents further worker work when deletion is observed, but already-written S3 results persist until expiration. The job ID is a server-generated dataset UUID; duplicate submissions return the same job. Unexpected worker failures retry via SQS and then mark the job failed via the DLQ consumer. Model calls, infrastructure deployment, and production acceptance tests were **not** performed. No real complaint data was used.

**IAM review:** To avoid inheriting dataset S3 permissions in the authentication Lambda, the dataset API role is changed from the existing api-execution role to the preapproved worker-execution role. The AI worker uses that new bounded worker role. Dataset and AI APIs consequently share its Bedrock permission until a third runtime role is separately approved; do not broaden bootstrap IAM as part of this PR. The existing inline dataset policy on api-execution is updated in place to an explicit dataset-access deny; a new inline dataset policy is created on worker-execution, avoiding a policy-role replacement. Review actual Terraform plan for any access-denied or destructive changes; this PR performs no apply.
