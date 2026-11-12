# Architectural decisions

## Initial decisions

| Decision | Rationale and status |
|---|---|
| Continue in `Reagvis/grievance-insights` | Preserve the existing application, history, and organization ownership. Accepted. |
| Keep `hardiksharma6555/telugu-complaint-summarizer-bedrock` unchanged | It is a read-only AI reference, not the production codebase. Accepted. |
| Use serverless AWS infrastructure | The pilot will use CloudFront, S3, API Gateway, Lambda, DynamoDB, SQS, Cognito, and Bedrock to minimize operational overhead and scale asynchronous work. Proposed; not provisioned. |
| Use Cognito-backed, administrator-provisioned authentication | A single-organization pilot does not require public sign-up. Backend-mediated login keeps Cognito tokens out of browser JavaScript; opaque sessions are hashed at rest and authorized by server-side expiry/revocation. Implemented in code and Terraform; not deployed. |
| Process Bedrock workloads asynchronously | Dataset analysis can exceed an interactive request lifetime; APIs will create jobs and workers will process them through SQS. Proposed; not implemented. |
| Manage infrastructure with Terraform and deploy through GitHub Actions using AWS OIDC | Infrastructure changes are reviewable and reproducible, with short-lived credentials and least-privilege roles rather than stored AWS keys. Implemented; applies remain guarded and disabled by default. |
| Use `telangana-gov-pilot.reagvis.com` | Pilot origin under the existing `reagvis.com` Route 53 hosted zone. DNS, certificate, and hosting are deployed; frontend publication remains disabled. |
| Use a dedicated S3 Terraform backend with native lockfiles | State uses an isolated `grievance-insights/pilot/terraform.tfstate` key, encryption, versioning, public-access blocking, TLS-only access, and `use_lockfile = true`. The unrelated HimParivar artifacts bucket is not reused without ownership approval. Defined; not bootstrapped. |
| Keep bootstrap resources outside the main Terraform root | The state bucket, repository-scoped OIDC roles, IAM boundary decision, and protected GitHub environments must exist before remote-state Terraform can run. A separate two-phase bootstrap avoids circular dependencies and scopes the frontend role to one eventual distribution. Defined; not applied. |
| Route SPAs by request path, not global error substitution | A CloudFront Function rewrites eligible browser navigation before origin access and excludes API paths. Distribution-wide `403`/`404` to `200` rewrites are prohibited because they could hide future API authorization errors. Defined; not deployed. |
| Separate infrastructure and frontend deployment identities | The Terraform role manages only foundation resources and state; a later frontend role writes one asset bucket and invalidates one distribution. Both trust exact protected GitHub environment subjects for this repository. Defined; roles and environments are not created. |
| Retain noncurrent frontend asset versions for 30 days | Versioning supports rollback while bounded noncurrent retention controls pilot storage cost. This applies only to public build assets, not citizen datasets or processing results. Defined; not deployed. |

These decisions describe direction, not deployed capability. Amend this log when a decision changes or an implementation establishes materially more detail.

## AWS frontend authentication

The AWS static build uses dedicated Vite `aws` mode and a fail-closed session gate backed by same-origin HttpOnly cookies. GitHub Pages and local dev retain the synthetic public demo. No tokens or passwords are retained in local storage. Client UI gating is not backend authorization for real data. Implemented in code; not deployed.

## Task 19 capacity decisions (draft integration review)

- **Reject, never truncate:** New persisted sources must satisfy a 20-MiB/2,000-row cap plus a 12-KiB UTF-8 prompt and 24-KiB serialized-record ceiling. Oversized source records yield clear validation errors while the original private source remains unchanged; historical ready sources are still retrievable.
- **Immutable derived index, same infrastructure:** During successful upload finalization, write versioned 50-record index chunks with conditional S3 PUT under existing private `raw/*` permissions. The DynamoDB ready transition follows successful indexing. Use only these bounded chunks for new dataset retrieval and worker processing; continue legacy reads for old metadata.
- **Versioned reanalysis:** Preserve original analysis outcome keys for generation 0. A fresh user-authorized analysis after a recoverable or all-record-invalid failure increments an independent result generation and attempt fencing token atomically, never overwriting prior immutable results. Interrupted resume increments only the message attempt and retains durable progress. Do not automatically retry source-integrity failures.
- **Observability/privacy:** Emit job UUID/attempt/generation/record-ordinal token usage, progress and exception classes; never log source text or model response bodies. No infrastructure resource replacement, deployment or large paid live inference test is part of this correction.
