# Infrastructure and security design

This document describes the intended pilot architecture and the Terraform foundation in `infra/`. The code currently defines frontend hosting only; no Terraform has been applied and no AWS or GitHub configuration has been changed.

## AWS resource boundaries

| Boundary | Ownership and status |
|---|---|
| Frontend hosting | The current Terraform root defines a private, encrypted, versioned S3 asset bucket; CloudFront with Origin Access Control; a `us-east-1` ACM certificate; and Route 53 aliases for `telangana-gov-pilot.reagvis.com`. Not deployed. |
| Authentication and API | A future API Gateway/Lambda backend will own Cognito authentication, sessions, authorization, presigned dataset operations, and job APIs. It is intentionally absent from this foundation. |
| Datasets and results | Future private S3 storage will separate raw uploads from derived processing results. Browsers will receive only short-lived, authorized access. Not implemented. |
| Metadata and jobs | Future DynamoDB tables will hold dataset metadata, session hashes with TTL, idempotency records, and job state; SQS and a dead-letter queue will control asynchronous work. Not implemented. |
| AI execution | Future worker Lambdas will invoke Bedrock in the approved region/model configuration. The browser and synchronous API will not call Bedrock directly. Not implemented. |
| Reporting | Structured, reusable results will be stored server-side and projected through authenticated APIs. The frontend remains responsible for display and export. Not implemented. |

The hosting bucket is not a public website endpoint. CloudFront alone can read objects through OAC. Browser-navigation paths are rewritten to `/index.html` by a viewer-request function that excludes `/api`, `/api/*`, non-GET/HEAD requests, well-known paths, and file-like paths. There are no distribution-wide custom error responses, so future API `401`, `403`, and `404` responses cannot be rewritten into successful HTML responses. Future API origins must add explicit behaviors for both `/api` and `/api/*` without the SPA function.

## State and bootstrap

The main configuration declares an encrypted S3 backend with native S3 locking (`use_lockfile = true`) and the isolated key `grievance-insights/pilot/terraform.tfstate`. State must be treated as sensitive even when outputs are not marked sensitive.

Read-only discovery found an existing encrypted, versioned, non-public bucket used by the HimParivar project, but it is an unrelated artifacts bucket and lacks a bucket policy. Its ownership and reuse have not been approved, so this project does not use it. `infra/bootstrap/` instead defines a dedicated state bucket with versioning, default encryption, public-access blocking, enforced bucket ownership, TLS-only access, and deletion protection.

Bootstrap is deliberately separate because a remote-state configuration cannot create its own bucket or the role used to run it:

1. Approve the dedicated globally unique bucket name, IAM permissions boundary (if required), hosted-zone ID, GitHub environments, and bootstrap operator.
2. In `infra/bootstrap/`, copy `terraform.tfvars.example` to ignored `terraform.tfvars`. Supply the existing GitHub OIDC provider ARN and public `reagvis.com` zone ID through the operator's secure configuration.
3. Run `terraform init`, `terraform fmt -check -recursive`, `terraform validate`, and create a saved bootstrap plan. Review it independently. An authorized later task may apply that exact plan; this task did not.
4. Initialize the main root with `terraform -chdir=infra init -backend-config="bucket=<approved-dedicated-bucket>" -reconfigure`. The backend key, region, encryption, and lockfile behavior are fixed in source.
5. Plan and apply the hosting foundation only after approval. Then provide its distribution ID to the bootstrap stack and run a second reviewed bootstrap change to create the narrowly scoped frontend publishing role.
6. Protect or migrate the bootstrap's initial local state as an administrative artifact. Never commit state, plan files, `.terraform/`, or populated variable files.

The state role can list only the exact default-workspace state-key prefix. It can read and write the state and lockfile objects, but `s3:DeleteObject` applies only to the `.tflock` object; the backend cannot delete state. Terraform workspaces are intentionally unsupported because each environment must use a separately reviewed state key and role. Native S3 lockfiles replace a DynamoDB lock table. Bucket versioning provides recovery from accidental state replacement; recovery remains an audited operator action.

## GitHub OIDC and deployment separation

The AWS account already has the account-wide `token.actions.githubusercontent.com` OIDC provider. It is an initial prerequisite and must not be duplicated. `infra/bootstrap/` defines repository-specific trust for `Reagvis/grievance-insights` and separates:

- `pilot-infrastructure`: a Terraform role with state access and permissions for only the hosting foundation's S3 bucket, CloudFront resources, certificate, and `reagvis.com` hosted zone. It does not publish frontend objects.
- `pilot-frontend`: a publishing role created only after the distribution ID is known. It can list and update the one frontend bucket and invalidate the one CloudFront distribution; it cannot provision infrastructure.

Both trust policies require the GitHub OIDC audience and the exact protected environment subject. The GitHub environments are separate bootstrap objects: configure required reviewers and permit deployments only from `main`. A future deployment workflow should run only for approved commits on `main`, request `id-token: write` only in the deployment job, use pinned actions, build from the lockfile, publish immutable assets, update entry-point files last, and invalidate only the required paths. Pull requests must never deploy. No active deployment workflow or permanent AWS key exists in this repository.

The state bucket, existing account-wide OIDC provider, IAM roles, IAM permissions boundary decision, and protected GitHub environments require separate initial bootstrapping. Keeping them outside the main root avoids the circular dependency in which Terraform would need to assume a role and access state before either existed.

The infrastructure role's shared-zone write access is conditioned on Route 53 normalized record names, record types, and change actions. It can change only the pilot's exact A/AAAA aliases and `_*.telangana-gov-pilot.reagvis.com` CNAMEs used for ACM DNS validation; it cannot modify unrelated `reagvis.com` records. Hosted-zone reads remain separate.

CloudFront and ACM permissions follow each service's resource-level authorization support. Existing distributions and certificates are limited to account/region resource patterns plus the repository tag; the CloudFront Function uses its exact-name ARN. OAC and response-header policy lifecycle permissions are limited to their account/resource-type ARN patterns, but those resources are untaggable and their generated IDs are unknown before creation. CloudFront create/list operations and `acm:RequestCertificate` do not support resource ARNs, so `Resource = "*"` is unavoidable; project request tags constrain taggable CloudFront creates, while ACM requests additionally require the exact pilot domain and DNS validation. Managed CloudFront cache-policy lookup and Route 53 hosted-zone discovery are read-only wildcard exceptions.

CI runs formatting, backend-disabled initialization, and validation for both Terraform roots without AWS credentials. It never plans, accesses remote state, or uploads Terraform state/plan artifacts.

## Authentication design

Authentication will adapt the HimParivar pilot pattern after threat-model review:

- Cognito allows administrator-created usernames only; self-registration is disabled. Password policy, recovery, MFA requirements, and administrator lifecycle still require approval.
- The browser submits credentials only to the same-origin backend. Lambda authenticates with Cognito and stores only a cryptographic hash of a high-entropy opaque session identifier in DynamoDB.
- The browser receives the opaque identifier in an `HttpOnly; Secure; SameSite=Strict` cookie with a narrowly scoped path. JavaScript never receives Cognito tokens or AWS credentials. State-changing endpoints require same-origin checks and CSRF protection appropriate to the final cookie/API design.
- Sessions enforce both idle and absolute expiration, with DynamoDB TTL as cleanup rather than the sole authorization check. Exact durations require security approval; cookie expiry must not exceed the server-side session expiry.
- Every API request validates the session, user status, expiry, and required pilot role. Logout deletes/revokes the server-side session and expires the cookie. Administrative account disablement must prevent new sessions and provide a way to revoke existing sessions.

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
