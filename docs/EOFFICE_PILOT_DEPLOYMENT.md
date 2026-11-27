# Task 22G — isolated eOffice pilot deployment readiness

**PLAN/BUILD READY ONLY — NOT DEPLOYED.** Target URL `https://api.eoffice-pilot.reagvis.com` does not exist yet. This design has a separate Terraform state key, names, VPC, API, roles, tables, secrets, images and rollback boundary. It does not reference or modify the live grievance pilot.

## Runtime and security boundary

The four `POST /api/v1/ai/{chat,summarize,extract,draft-reply}` routes use a regional API Gateway HTTP API with its default endpoint disabled, TLS 1.2 custom domain, one-request/second and burst-two stage throttles, a VPC link and internal ALB. A single low-concurrency Fargate task runs the bundled Node 22 service with a pinned ClamAV sidecar. The containers share only an ephemeral UNIX-socket volume; document bytes are streamed to `clamd` before parsing and are never persisted by this stack. The service container has a read-only root filesystem and no inbound public security-group rule.

The application composes `createProvisionalBedrockEofficeService` explicitly. Chat remains deterministic/current-document extractive. Summarize, extract and draft-reply use the dedicated eOffice Bedrock adapter only after authorization, exact trusted grant lookup, delegated download, scanning and bounded parsing. Runtime IAM grants only exact DynamoDB tables, the exact Qwen foundation model and the isolated KMS key.

Three KMS-encrypted, on-demand DynamoDB tables provide strongly consistent credential revocation, exact resource permits and payload-free audit. Registry rows bind department, officer, document, optional chat session, complete URL hash, allowed host, signed five-minute grant, delegated token and TTL. They may be written only by a separately approved operator after upstream identity and ACL verification. The API task cannot issue credentials and has no public management route. JWT public keys and a 32-byte audit HMAC key are injected from two isolated Secrets Manager secrets; private signing keys are never in Terraform or the API task.

Audit records contain only the Task 22F allowlist and expire after 30 days by default. Application code does not log request bodies, headers, prompts, answers, URLs, file bytes or errors. Container operational logs are retained for 30 days. API Gateway access logging is deliberately absent until a reviewed redaction-only format is approved.

## Planned resources

- Separate S3 backend key `grievance-insights/eoffice-pilot/terraform.tfstate`.
- KMS key/alias; credential, registry and audit DynamoDB tables; two empty Secrets Manager secret containers.
- Dedicated immutable/scanned ECR repository and digest-pinned service image; independently reviewed digest-pinned ClamAV image.
- Dedicated two-subnet VPC, internet gateway, security groups, ECS cluster/task/service and internal ALB/target/listener.
- API Gateway VPC link, HTTP API, exactly four routes, throttled stage, regional ACM certificate, custom domain and Route 53 records.
- Least-privilege task/execution roles, an unattached operator lifecycle policy, and a tagged monthly AWS Budget.

## Credential and protected-resource lifecycle

Use the existing `OperatorCredentialManager` only from an MFA-protected operator environment with a KMS/HSM-backed or otherwise approved RSA private key. Officer JWT lifetime is at most 15 minutes; exact document grants at most five minutes. Rotation issues the replacement before revoking the prior JTI. Revocations are strongly consistent. Public-key overlap supports planned key rotation; remove a retiring key only after its maximum token lifetime and revocation checks. Tokens are returned once and never logged.

Before adding a registry row, the operator must verify the officer identity, department, upstream ACL, exact URL and delegated credential outside the request path. Renewal repeats that verification; caller-provided `user_id`, URL or JWT alone is never sufficient. Initial hosted acceptance is limited to synthetic identities and a controlled protected synthetic document source. Government registry records remain prohibited until the identity/ACL/delegation protocol is agreed.

## Build, validation and safe provisioning sequence

1. Build `npm run eoffice:package`, then build the Dockerfile from repository root. Scan it and push to the dedicated ECR repository; record its immutable digest. Resolve, inspect and approve a current ClamAV image/signature-update configuration and pin its digest.
2. Initialize `infra/eoffice-pilot` with its own approved backend configuration. Run format, validate and a saved plan with explicit image digests. Review that no existing pilot ARN/name/state appears.
3. Separately approve creation. Apply infrastructure before adding secret versions or registry rows. Populate only public verification keys and a random audit HMAC key. Keep signing private keys out of the service.
4. Confirm ClamAV health/signature age, empty audit logs, route throttles, task count one and no API execute endpoint. Issue synthetic credentials/grants and perform Task 22H HTTPS acceptance with synthetic files. A separately approved minimal paid inference smoke is required for the three model-backed routes.
5. Do not admit real government data until written Bedrock no-training/retention confirmation and government identity/ACL/delegated-download compatibility are approved.

## Cost assumptions

At one continuously running 2-vCPU/4-GB Fargate task, one internal ALB, one API Gateway VPC link and low request volume, expect roughly **USD 85–130/month** in `ap-south-1` before Bedrock inference and internet transfer. DynamoDB, KMS, Secrets Manager, Route 53 and low-volume API requests should be single-digit dollars. Bedrock is usage-based and currently unusable because the account reports zero Qwen 32B on-demand request/token quota. The Terraform budget is USD 100/month by default; an alert subscriber must be added through a separately approved operational address.

## Rollback

First set the ECS desired count to zero and remove/disable the API mapping or Route 53 alias, then revoke all pilot JTIs and delegated credentials. Preserve audit/registry tables and logs for the approved retention window. Roll back application code by registering the previously approved immutable image digest and task definition. Terraform destroy is not the first-line rollback and is impeded deliberately by ALB/table deletion protection, KMS/secret recovery windows and `prevent_destroy`. DNS, certificate and state removal require separate reviewed cleanup after evidence retention.

## Outstanding blockers from read-only preflight (2026-11-27)

- Route 53 zone exists, but the target record does not. No matching ACM certificate exists in `ap-south-1`.
- `qwen.qwen3-32b-v1:0` is catalogued ACTIVE/text-capable in `ap-south-1`, but account quotas report **0 requests/minute and 0 tokens/minute** for Qwen3 32B on-demand inference.
- Bedrock model invocation logging has no configured destination. AWS APIs do not expose a definitive per-account no-training/zero-retention attestation; obtain written confirmation before government content.
- Government issuer/claims, officer mapping, protected-file ACL/delegated credential protocol, allowed hosts and test endpoint remain unconfirmed.
- Approved service and ClamAV digests, scanner signature freshness monitor, budget alert recipient, secret values, operator key custody and deployment approval are absent.

No Terraform apply, AWS write, DNS change, image push, secret population, paid inference or real-document processing occurred in Task 22G implementation.
