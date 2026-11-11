# Implementation status

Last updated: 2026-11-11

## Current state

The existing React/TypeScript/Vite prototype is functional. It provides grievance browsing, filtering, in-memory import, deterministic summaries and assistant queries, bundled sample translations, and exports. Development and preview mode use an in-memory Vite-local API; the static Pages build processes records in the browser. An initial Terraform foundation now defines frontend hosting and separate state/OIDC bootstrap resources, but none has been applied. There is no deployed production backend, authentication, persistence, Bedrock integration, or AWS deployment workflow.

## Completed

- Established a locked Node.js build with lint, Vitest, and production build commands.
- Added GitHub Actions CI for pull requests and pushes to `main`, using Node.js 22, `npm ci`, dependency caching, minimal permissions, concurrency cancellation, and a three-day frontend build artifact.
- Documented operational guidance, current/proposed architecture, and initial architectural decisions.
- Validated the baseline and project-foundation changes without changing application behavior.
- Added pinned Terraform 1.14/AWS provider configuration for a private versioned S3 frontend origin, CloudFront OAC and secure SPA routing, a `us-east-1` ACM certificate, and Route 53 aliases.
- Added an unapplied bootstrap configuration for a dedicated encrypted/versioned S3 state backend, native lockfile access, and separate repository/environment-scoped GitHub OIDC roles.
- Documented authentication, data lifecycle, asynchronous Bedrock processing, deployment separation, costs, and unresolved governance decisions in `docs/INFRASTRUCTURE.md`.
- Validated formatting, backend-disabled initialization, both Terraform roots, and a read-only hosting plan against a temporary empty local state. No state or binary plan was retained.

Task 1 merged as PR #1 at `9fe0e6d`. Task 2 branched from that commit; add its PR reference after merge if useful for investigation.

## Outstanding

- Obtain approval for the dedicated state bucket name, IAM permissions boundary, protected GitHub environments, bootstrap operator/state custody, and Terraform IAM policy before applying bootstrap resources.
- Bootstrap remote state and the infrastructure OIDC role, review the hosting plan against remote state, and provision hosting only in a separately authorized deployment task.
- After the distribution exists, complete the second bootstrap phase for the distribution-scoped frontend role and add reviewed deployment automation restricted to `main`.
- Design and implement API Gateway, Lambda, Cognito/session storage, DynamoDB metadata, private S3 datasets/results, SQS/DLQ, worker Lambda, and Bedrock access.
- Implement administrator-provisioned authentication and secure server-side sessions.
- Define dataset schemas, retention rules, upload limits, job lifecycle, Bedrock model/prompt/evaluation strategy, and human-review controls.
- Replace the local service implementation with authenticated production APIs while preserving the existing frontend contract and behavior.

## Limitations and blockers

- All bundled data is synthetic; imported data is not persisted.
- Current summaries and assistant answers are deterministic, not AI-generated. Telugu report generation, OCR, RAG, RBAC, audit logs, and production observability are absent.
- The Vite build and tests emit a forward-compatibility warning for extensionless imports under Vite's future native config loader. It does not currently fail validation.
- AWS account conventions, Terraform state/backend details, Bedrock model availability/quotas, data classification, retention policy, and production access controls must be confirmed before infrastructure is applied.
- The account-wide GitHub OIDC provider and `reagvis.com` hosted zone exist. No dedicated project state bucket, approved IAM boundary decision, protected deployment environments, or project roles have been established.
- The existing HimParivar state/artifacts bucket is technically encrypted/versioned/non-public but is not approved for this project's state and lacks a bucket policy; the design does not reuse it.

## Recommended next task

Review and approve the bootstrap design, IAM permissions, state custody, protected GitHub environments, and globally unique dedicated state bucket name. The next authorized implementation task should bootstrap state and the infrastructure role, then produce a remote-state hosting plan for approval; it should not combine bootstrap, hosting apply, and frontend deployment automation into one unreviewed change.
