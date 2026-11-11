# Implementation status

Last updated: 2026-11-11

## Current state

The React/TypeScript/Vite prototype is functional. Development and preview use an in-memory Vite-local API; static builds process records in the browser. AWS hosting, dedicated remote state, and separate infrastructure/frontend GitHub OIDC roles are deployed. A manual frontend deployment workflow exists but is disabled with `PILOT_DEPLOY_ENABLED=false`. There is no deployed production backend, authentication, persistence, or Bedrock integration, and no frontend assets have been published.

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

Task 1 merged as PR #1 at `9fe0e6d`; Task 2 merged as PR #2 at `7a4b271`.

## Outstanding

- Design and implement API Gateway, Lambda, Cognito/session storage, DynamoDB metadata, private S3 datasets/results, SQS/DLQ, worker Lambda, and Bedrock access.
- Implement administrator-provisioned authentication and secure server-side sessions.
- Define dataset schemas, retention rules, upload limits, job lifecycle, Bedrock model/prompt/evaluation strategy, and human-review controls.
- Replace the local service implementation with authenticated production APIs while preserving the existing frontend contract and behavior.

## Limitations and blockers

- All bundled data is synthetic; imported data is not persisted.
- Current summaries and assistant answers are deterministic, not AI-generated. Telugu report generation, OCR, RAG, RBAC, audit logs, and production observability are absent.
- The Vite build and tests emit a forward-compatibility warning for extensionless imports under Vite's future native config loader. It does not currently fail validation.
- Bedrock model availability/quotas, data classification, retention policy, and production access controls remain undecided.
- Authentication is not implemented, so frontend publication remains intentionally disabled and the hosting bucket remains empty.

## Recommended next task

Implement administrator-provisioned Cognito authentication and backend-managed sessions. Keep `PILOT_DEPLOY_ENABLED=false` until that work is reviewed and publication is explicitly authorized.
