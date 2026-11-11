# Architecture

## Implemented today

Grievance Insights is currently a React 19 and TypeScript single-page application built with Vite. The browser supports grievance browsing, Unicode-safe search and filtering, UTF-8 CSV/JSON import, deterministic summaries, deterministic record lookup, bundled sample translations, and text/Markdown/ZIP/print exports. Imported data remains in browser memory.

During `npm run dev` and `npm run preview`, a Vite middleware in `server/api.ts` exposes same-origin `/api/health`, `/api/records`, `/api/summary`, and `/api/assistant` endpoints. Processing is deterministic and in memory; it does not use AI or persistence. The separate Pages build performs deterministic processing entirely in the browser. GitHub Pages deployment remains a manual repository script, not CI/CD.

The frontend depends on service interfaces rather than an AWS implementation. `SummaryService` is the main summary boundary, `LocalApiSummaryService` is the current non-static client, and `RemoteAISummaryService` is an unconnected contract stub. No production backend, authentication, Bedrock integration, or deployment automation is implemented.

The repository now contains an unapplied Terraform hosting foundation under `infra/`. It defines the intended private S3, CloudFront OAC, ACM, and Route 53 resources plus a separate state/OIDC bootstrap configuration. Infrastructure code is implemented and validated, but no AWS resource has been provisioned. See `docs/INFRASTRUCTURE.md` for resource boundaries and security design.

## Proposed AWS pilot

The planned production topology is:

1. CloudFront serves frontend assets from a private S3 bucket and routes authenticated API requests to API Gateway.
2. API Gateway invokes Lambda APIs for session management, upload coordination, metadata, and result access.
3. Cognito authenticates administrator-provisioned pilot users; public self-registration remains disabled.
4. DynamoDB stores metadata, opaque sessions with TTL, and job state. S3 stores uploaded datasets and processing results.
5. APIs enqueue long-running analysis through SQS. Worker Lambdas invoke Amazon Bedrock and persist structured, source-grounded results for later retrieval.
6. Terraform defines infrastructure. GitHub Actions assumes narrowly scoped AWS roles through GitHub OIDC for future deployment; no static AWS credentials are stored in GitHub.

Only the frontend hosting layer currently has Terraform definitions. No resources should be considered available until the bootstrap and hosting plans are approved and applied in later tasks. API, authentication, data, queue, and AI components remain proposed only.

## Integration and ownership boundaries

- The browser should call only the authenticated project API. It must not receive AWS credentials or invoke Bedrock directly.
- The backend will validate uploads and requests, authorize access, create asynchronous jobs, and expose status/results. AI output must retain links to source case IDs and must not turn a department response into an inferred resolution.
- The reference repository `hardiksharma6555/telugu-complaint-summarizer-bedrock` is read-only. Its Bedrock techniques may inform the backend design, but production code and infrastructure belong in this repository and must be independently reviewed.
- Authentication is planned to follow the read-only HimParivar pilot pattern: an admin-only Cognito user pool, backend-mediated username/password authentication, and an opaque `HttpOnly; Secure; SameSite=Strict` session cookie backed by TTL state. The exact design must be threat-modeled before implementation.

## Domain and DNS

The planned application origin is `https://telangana-gov-pilot.reagvis.com`. DNS is hosted in the existing `reagvis.com` Route 53 zone. Workloads are planned for `ap-south-1`; the Terraform AWS provider alias creates the CloudFront ACM certificate in `us-east-1`. Route 53, CloudFront, certificates, and all other AWS resources remain unmodified and unprovisioned at this stage.
