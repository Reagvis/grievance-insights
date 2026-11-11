# Architectural decisions

## Initial decisions

| Decision | Rationale and status |
|---|---|
| Continue in `Reagvis/grievance-insights` | Preserve the existing application, history, and organization ownership. Accepted. |
| Keep `hardiksharma6555/telugu-complaint-summarizer-bedrock` unchanged | It is a read-only AI reference, not the production codebase. Accepted. |
| Use serverless AWS infrastructure | The pilot will use CloudFront, S3, API Gateway, Lambda, DynamoDB, SQS, Cognito, and Bedrock to minimize operational overhead and scale asynchronous work. Proposed; not provisioned. |
| Use Cognito-backed, administrator-provisioned authentication | A single-organization pilot does not require public sign-up. The implementation should adapt the HimParivar pilot's backend-mediated authentication and opaque session pattern after security review. Proposed; not implemented. |
| Process Bedrock workloads asynchronously | Dataset analysis can exceed an interactive request lifetime; APIs will create jobs and workers will process them through SQS. Proposed; not implemented. |
| Manage infrastructure with Terraform and deploy through GitHub Actions using AWS OIDC | Infrastructure changes should be reviewable and reproducible, with short-lived credentials and least-privilege roles rather than stored AWS keys. Accepted direction; not implemented. |
| Use `telangana-gov-pilot.reagvis.com` | This is the planned pilot origin under the existing `reagvis.com` Route 53 hosted zone. Proposed; DNS and certificates are not configured. |

These decisions describe direction, not deployed capability. Amend this log when a decision changes or an implementation establishes materially more detail.
