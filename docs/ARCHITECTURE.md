# Architecture

## Implemented today

Grievance Insights is currently a React 19 and TypeScript single-page application built with Vite. The browser supports grievance browsing, Unicode-safe search and filtering, UTF-8 CSV/JSON import, deterministic summaries, deterministic record lookup, and text/Markdown/ZIP/print exports. Imported data remains in browser memory.

During `npm run dev` and `npm run preview`, a Vite middleware in `server/api.ts` exposes same-origin `/api/health`, `/api/records`, `/api/summary`, and `/api/assistant` endpoints. Processing is deterministic and in memory; it does not use AI or persistence. `npm run build:aws` uses Vite's `aws` mode with root-relative asset paths and performs deterministic processing entirely in the browser; it does not depend on the localhost middleware. AWS mode uses the same-origin authentication API and gates the existing synthetic-data workspace behind successful session validation. The existing GitHub Pages build retains relative paths for project-subdirectory hosting.

The frontend depends on service interfaces rather than an AWS implementation. `SummaryService` is the main summary boundary, `LocalApiSummaryService` is the current non-static client, and `RemoteAISummaryService` is an unconnected contract stub. A production-oriented authentication Lambda is implemented under `backend/auth/` but is not deployed; frontend AWS-mode login, logout, and session restoration are implemented. Bedrock integration is not implemented. A manual GitHub Actions frontend deployment workflow exists but is disabled through `PILOT_DEPLOY_ENABLED=false`.

The Terraform hosting foundation is deployed: private S3, CloudFront OAC, ACM, Route 53 aliases, dedicated remote state, and separate GitHub OIDC roles for infrastructure and frontend publication. Terraform now also defines, but has not deployed, the Cognito user pool/client, hashed-session DynamoDB table, authentication Lambda and bounded role, HTTP API, and uncached CloudFront API behaviors. The frontend bucket remains empty. See `docs/INFRASTRUCTURE.md` for resource boundaries and security design.

## Proposed AWS pilot

The planned production topology is:

1. CloudFront serves frontend assets from a private S3 bucket and routes authenticated API requests to API Gateway.
2. API Gateway invokes Lambda APIs for session management, upload coordination, metadata, and result access.
3. Cognito authenticates administrator-provisioned pilot users; public self-registration remains disabled.
4. DynamoDB stores metadata, opaque sessions with TTL, and job state. S3 stores uploaded datasets and processing results.
5. APIs enqueue long-running analysis through SQS. Worker Lambdas invoke Amazon Bedrock and persist structured, source-grounded results for later retrieval.
6. Terraform defines infrastructure. GitHub Actions assumes narrowly scoped AWS roles through GitHub OIDC for future deployment; no static AWS credentials are stored in GitHub.

The hosting layer is deployed. Authentication/API resources are implemented in code and Terraform but remain unapplied. Dataset, queue, reporting, and AI components remain proposed only.

## Integration and ownership boundaries

- The browser should call only the authenticated project API. It must not receive AWS credentials or invoke Bedrock directly.
- The backend will validate uploads and requests, authorize access, create asynchronous jobs, and expose status/results. AI output must retain links to source case IDs and must not turn a department response into an inferred resolution.
- The reference repository `hardiksharma6555/telugu-complaint-summarizer-bedrock` is read-only. Its Bedrock techniques may inform the backend design, but production code and infrastructure belong in this repository and must be independently reviewed.
- Authentication follows the reviewed HimParivar pattern: an admin-only Cognito user pool, backend-mediated username/password authentication, and an opaque host-only `HttpOnly; Secure; SameSite=Strict` session cookie. Only SHA-256 token hashes are stored, and server-side expiry/revocation—not DynamoDB TTL—authorizes requests. This code remains undeployed pending infrastructure review.

## Domain and DNS

The application origin is `https://telangana-gov-pilot.reagvis.com`. DNS is hosted in the existing `reagvis.com` Route 53 zone. Hosting resources are in `ap-south-1`; the CloudFront ACM certificate is in `us-east-1`. The origin currently returns the expected empty-bucket response because assets have not been published.
