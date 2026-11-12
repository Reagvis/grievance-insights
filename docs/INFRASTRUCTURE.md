# Infrastructure and security design

This document describes the pilot architecture and Terraform foundation in `infra/`. The frontend hosting foundation, remote state, and GitHub OIDC roles are deployed; application publication remains disabled pending authentication.

## AWS resource boundaries

| Boundary | Ownership and status |
|---|---|
| Frontend hosting | Deployed: private, encrypted, versioned S3 asset bucket; CloudFront with Origin Access Control; a `us-east-1` ACM certificate; and Route 53 aliases for `telangana-gov-pilot.reagvis.com`. The bucket remains empty. |
| Authentication and API | Implemented but not deployed: administrator-only Cognito, a Node.js 22 Lambda, HTTP API, and DynamoDB hashed sessions. Dataset and job APIs remain future work. |
| Datasets and results | Future private S3 storage will separate raw uploads from derived processing results. Browsers will receive only short-lived, authorized access. Not implemented. |
| Metadata and jobs | Future DynamoDB tables will hold dataset metadata, session hashes with TTL, idempotency records, and job state; SQS and a dead-letter queue will control asynchronous work. Not implemented. |
| AI execution | Future worker Lambdas will invoke Bedrock in the approved region/model configuration. The browser and synchronous API will not call Bedrock directly. Not implemented. |
| Reporting | Structured, reusable results will be stored server-side and projected through authenticated APIs. The frontend remains responsible for display and export. Not implemented. |

The hosting bucket is not a public website endpoint. CloudFront alone can read objects through OAC. Browser-navigation paths are rewritten to `/index.html` by a viewer-request function that excludes `/api`, `/api/*`, non-GET/HEAD requests, well-known paths, and file-like paths. There are no distribution-wide custom error responses, so future API `401`, `403`, and `404` responses cannot be rewritten into successful HTML responses. Future API origins must add explicit behaviors for both `/api` and `/api/*` without the SPA function.

## State and bootstrap

The main configuration declares an encrypted S3 backend with native S3 locking (`use_lockfile = true`) and the isolated key `grievance-insights/pilot/terraform.tfstate`. Bootstrap uses the same dedicated bucket but a separate key, `grievance-insights/pilot/bootstrap/terraform.tfstate`, with its own lockfile. State must be treated as sensitive even when outputs are not marked sensitive.

Read-only discovery found an existing encrypted, versioned, non-public bucket used by the HimParivar project, but it is an unrelated artifacts bucket and lacks a bucket policy. Its ownership and reuse have not been approved, so this project does not use it. `infra/bootstrap/` instead defines a dedicated state bucket with versioning, default encryption, public-access blocking, enforced bucket ownership, TLS-only access, and deletion protection.

Bootstrap is deliberately separate because a remote-state configuration cannot create its own bucket or access identity. The bootstrap state was migrated from the checksum-verified local authority to its dedicated remote key without changing any resource address; the old versioned `bootstrap/terraform.tfstate` backup object remains unchanged.

The pre-migration authority had lineage `5481d700-9cb8-ba8b-0faf-3a4ab13721e2`, serial `25`, and 27 Terraform addresses. Terraform's supported backend migration established remote lineage `f1f56c57-9f39-515d-3cf6-222890b704b1` at serial `1`; all 27 addresses matched exactly and the first remote-backed plan reported zero changes.

Routine bootstrap operations now run through `.github/workflows/deploy-bootstrap.yml` and the `pilot-bootstrap` environment. The workflow supplies every deployed non-secret variable, initializes the remote backend, creates a same-run plan, rejects deletion/replacement, and requires both a disabled-by-default guard and explicit confirmation before apply. State and plans are never uploaded as artifacts.

The one-time `infra/access-seed/` root owns only the bootstrap role and its matching permissions boundary. Its local state and separate `access-seed/terraform.tfstate` backup are retained because the bootstrap role must not be able to change its own trust, permissions, or boundary. Access-seed changes are exceptional operator actions, not routine deployment work.

The state role can list only the exact default-workspace state-key prefix. It can read and write the state and lockfile objects, but `s3:DeleteObject` applies only to the `.tflock` object; the backend cannot delete state. Terraform workspaces are intentionally unsupported because each environment must use a separately reviewed state key and role. Native S3 lockfiles replace a DynamoDB lock table. Bucket versioning provides recovery from accidental state replacement; recovery remains an audited operator action.

## GitHub OIDC and deployment separation

The AWS account already has the account-wide `token.actions.githubusercontent.com` OIDC provider. It is an initial prerequisite and must not be duplicated. `infra/bootstrap/` defines repository-specific trust for `Reagvis/grievance-insights` and separates:

- `pilot-infrastructure`: a Terraform role with state access and permissions for the hosting foundation plus project-scoped Cognito, Lambda, HTTP API, DynamoDB, SQS/DLQ, private S3, CloudWatch Logs, runtime IAM, and Bedrock control-plane resources. It does not publish frontend objects or invoke Bedrock models.
- `pilot-frontend`: a deployed publishing role that can list and update only `grievance-insights-pilot-134857759074-frontend` and invalidate only distribution `E3B0B5R1HAYD1J`; it cannot provision infrastructure.
- `pilot-bootstrap`: a deployed bootstrap role that manages only the two project deployment roles, their exact policies, the runtime boundary, state-bucket configuration, and the dedicated bootstrap state/lock objects. Its own role and boundary are excluded.

All three trust policies require the GitHub OIDC audience and their exact protected environment subject.

GitHub repositories created after July 15, 2026 use immutable OIDC subjects containing numeric owner and repository IDs. This repository uses the prefix `repo:Reagvis@212125805/grievance-insights@1446187135`, followed by the exact `:environment:<name>` context. The Terraform and frontend roles are managed by `infra/bootstrap/`, while the bootstrap role is managed separately by `infra/access-seed/`. If existing roles still trust the pre-2026 name-only subject, their trust policies require one-time operator-applied updates before GitHub Actions can assume them. Never replace these exact claims with broad wildcard trusts. The `pilot-infrastructure`, `pilot-frontend`, and `pilot-bootstrap` GitHub environments permit deployments only from `main`; required reviewers are currently omitted because the pilot has one administrator.

Backend permissions are split across managed policies to remain below IAM policy-size limits. Runtime IAM is limited to the exact API and worker execution-role and policy names. New roles must carry the project runtime permissions boundary, and `iam:PassRole` is restricted to those roles and `lambda.amazonaws.com`. The boundary contains no IAM administration, excludes deployment artifacts from runtime data access, and denies Bedrock inference until approved model or inference-profile ARNs are configured. Streaming invocation requires a separate opt-in.

`.github/workflows/deploy-frontend.yml` is manual-only, uses Node.js 22, installs from the lockfile, assumes the frontend role through OIDC, preserves previously deployed content-hashed assets with immutable caching, uploads `index.html` last with no-cache headers, and invalidates the pilot distribution. Old hashed assets require a separately approved age/retention cleanup policy rather than deletion during release. It cannot publish while the `pilot-frontend` environment variable `PILOT_DEPLOY_ENABLED` is `false`, which is the initial setting. No permanent AWS credentials are used.

The AWS static build uses Vite's `pages` mode with `--base=/`. That mode selects deterministic browser-local services and emits root-relative asset URLs suitable for CloudFront SPA routes; it does not depend on `server/api.ts`. The GitHub Pages build remains unchanged with a relative base. Development and preview use Vite's localhost-only middleware for `/api/*`; those endpoints do not exist in the deployed static origin. Keep publication disabled until authenticated production APIs replace the prototype-only runtime where required.

The state bucket, existing account-wide OIDC provider, IAM roles, IAM permissions boundary decision, and protected GitHub environments require separate initial bootstrapping. Keeping them outside the main root avoids the circular dependency in which Terraform would need to assume a role and access state before either existed.

The infrastructure role's shared-zone write access is conditioned on Route 53 normalized record names, record types, and change actions. It can change only the pilot's exact A/AAAA aliases and `_*.telangana-gov-pilot.reagvis.com` CNAMEs used for ACM DNS validation; it cannot modify unrelated `reagvis.com` records. Hosted-zone reads remain separate.

CloudFront and ACM permissions follow each service's resource-level authorization support. Existing distributions and certificates are limited to account/region resource patterns plus the repository tag; the CloudFront Function uses its exact-name ARN. OAC and response-header policy lifecycle permissions are limited to their account/resource-type ARN patterns, but those resources are untaggable and their generated IDs are unknown before creation. CloudFront create/list operations and `acm:RequestCertificate` do not support resource ARNs, so `Resource = "*"` is unavoidable; project request tags constrain taggable CloudFront creates, while ACM requests additionally require the exact pilot domain and DNS validation. Managed CloudFront cache-policy lookup and Route 53 hosted-zone discovery are read-only wildcard exceptions.

CI runs formatting, backend-disabled initialization, and validation for all three Terraform roots without AWS credentials. It never plans, accesses remote state, or uploads Terraform state/plan artifacts.

## Authentication design

The authentication implementation adapts the HimParivar pilot pattern and remains unapplied:

- Cognito allows administrator-created usernames only; self-registration and user-managed recovery are disabled. The initial pilot configuration has a 12-character complexity policy and no MFA; administrator lifecycle and any MFA change require operational approval.
- The browser submits credentials only to the same-origin backend. Lambda authenticates with Cognito and stores only a cryptographic hash of a high-entropy opaque session identifier in DynamoDB.
- The browser receives the opaque identifier in an `HttpOnly; Secure; SameSite=Strict` cookie with a narrowly scoped path. JavaScript never receives Cognito tokens or AWS credentials. State-changing endpoints require same-origin checks and CSRF protection appropriate to the final cookie/API design.
- Sessions enforce an eight-hour configurable absolute expiration, with DynamoDB TTL as cleanup rather than authorization. Cookie expiry equals the server-side expiry. Idle expiry is not implemented.
- Session-protected requests validate the token hash and server-side expiry. Logout deletes the session and expires the cookie. Account disablement prevents new Cognito authentication; bulk revocation of existing application sessions remains future administrator tooling.

`POST /api/auth/login` and `POST /api/auth/logout` require the exact public origin. `GET /api/auth/session` and `GET /api/health` are non-mutating. CloudFront forwards `/api` and `/api/*` to the HTTP API with caching disabled and without the SPA rewrite. The Lambda does not log request bodies, passwords, cookies, or tokens. Cognito authentication challenges are rejected without exposing Cognito tokens; administrators must provision a permanent password until a reviewed challenge flow exists.

CloudFront-hosted JavaScript, CSS, fonts, and images are publicly retrievable. Complaint datasets, job status, AI results, reports, and user/session data are authenticated application data and must never be placed in the frontend bucket or a public cache behavior.

## Data lifecycle

The data design requires approval before implementation:

- Validate file name, declared type, detected format, UTF-8 structure, schema, record count, checksum, and decompressed size. Enforce limits both before issuing a presigned upload and when processing the object. The maximum file size and record count must be selected from measured pilot datasets and service limits; no value is approved yet.
- Upload directly to a private raw-data S3 prefix with short-lived, single-purpose presigned requests. Use unique server-generated keys, expected checksums, encryption, and an initial quarantined/unvalidated state. Do not trust browser metadata.
- Store immutable raw datasets separately from versioned structured results. Deny public access, require TLS and encryption, and grant workers access only to the required prefixes and keys.
- Keep dataset ownership, object keys, checksum, validation state, job state, attempt count, timestamps, result version, and expiry metadata in DynamoDB. Do not place complaint bodies in DynamoDB merely for convenience.
- Configure SQS visibility timeout above the worker timeout, bounded retries with jitter, idempotent consumers, and a DLQ with alarms. Redrive thresholds and operator procedures require load and failure testing.
- Dataset deletion must remove raw objects, derived results, metadata, reusable model output, and queued/retry references while preserving only specifically approved audit facts. Retention and backup periods have not been approved; lifecycle rules must not be added until data owners approve them.
- Application logs contain request/job identifiers, timing, counts, model/version identifiers, and sanitized error classes—not citizen names, complaint/response bodies, prompts containing those bodies, presigned URLs, cookies, or tokens. Apply log retention only after approval.
- Use service-managed encryption initially only where the threat model permits it; decide whether customer-managed KMS keys and key separation are required before dataset storage is built. IAM policies remain least-privilege and deny cross-boundary access by default.

## Bedrock processing design

The read-only standalone AI reference is an algorithmic input, not deployable production code. Its processing will be adapted into asynchronous, bounded workers:

1. An authenticated API validates a dataset and creates an idempotent job keyed by dataset checksum, processing configuration, prompt/model version, and requested language.
2. SQS messages identify records or bounded batches by object key and version; they do not carry complaint bodies.
3. Workers perform per-record structured extraction of the issue, requested action, department response action, explicit outcome, and source spans. They preserve original Telugu text and never infer resolution from the presence of a response.
4. Conditional writes make each record/batch idempotent. Transient throttling and service errors retry with bounded exponential backoff; deterministic validation failures are recorded without endless retry; exhausted work reaches the DLQ.
5. Every generated claim retains record IDs and source citations. Deterministic code validates schemas and aggregates accepted per-record results into counts, themes, and reports.
6. Versioned intermediate results are reusable across report generation and human review. A model, prompt, schema, or policy change creates a new result version rather than silently overwriting provenance.

Model selection, regional availability, guardrails, prompt evaluation, human-review thresholds, and acceptable quality metrics remain approval items.

## Cost controls

Expected cost drivers are CloudFront requests and egress, S3 storage/requests and retained versions, Route 53/ACM-related usage, API Gateway and Lambda invocations, DynamoDB reads/writes/storage, SQS requests, logs/metrics, and especially Bedrock input/output tokens and retries.

Pilot safeguards should include AWS Budgets and anomaly alerts, S3 lifecycle rules only after retention approval, bounded upload and record counts, concurrency limits, SQS backpressure, Lambda reserved concurrency where appropriate, Bedrock request/token budgets per job, caching of versioned reusable results, log sampling/redaction/retention, CloudFront cache optimization, and alarms for retry/DLQ growth. Actual budgets and service quotas require stakeholder approval; this design does not invent usage or price estimates.
