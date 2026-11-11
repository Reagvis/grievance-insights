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
