# Tasks 22G–22H — isolated restricted-synthetic eOffice pilot

**DEPLOYED 2026-11-27.** The restricted pilot is live at `https://api.eoffice-pilot.reagvis.com`. It uses separate state, names, roles, tables, secrets, image and rollback boundaries and does not reference the grievance pilot. See [EOFFICE_EXTERNAL_INTEGRATION_HANDOFF.md](EOFFICE_EXTERNAL_INTEGRATION_HANDOFF.md).

## Task 22H deployment evidence

- Bootstrap apply: `3 added, 0 changed, 0 destroyed`. KMS key ARN `arn:aws:kms:ap-south-1:134857759074:key/f37c717c-c09e-4cfc-b9e7-49a479c52ee0`; ECR `134857759074.dkr.ecr.ap-south-1.amazonaws.com/grievance-insights-eoffice-pilot`.
- Deployed image: `sha256:82d750e4078e9747de72226c8ef0d01dab8e6ae41e87deaab4d61162b09393bf`. Final ECR basic scan completed with no findings after removing unused vulnerable package parsers from the Lambda runtime image.
- Main state contains only isolated eOffice resources. An initial apply stopped on exact-role `iam:PassRole`; after the owner added the narrow Lambda-service condition, the saved resume plan applied `7 added, 0 changed, 0 destroyed`.
- Public plan applied `6 added, 0 changed, 0 destroyed`: regional ACM certificate `5261e230-e345-4996-9e8c-31deb455d3bc`, validation record, regional API custom domain/mapping and Route 53 alias. Certificate status `ISSUED`, TLS 1.2 policy, renewal eligible.
- Live synthetic acceptance passed authentication and route connectivity. Hosted document processing was deliberately deferred: no document host or registry entry exists, and the configured inert hostname `documents-disabled.eoffice-pilot.reagvis.com` is not provisioned.

## Minimal runtime

A regional API Gateway HTTP API exposes exactly four throttled `POST /api/v1/ai/{chat,summarize,extract,draft-reply}` routes. Its default execute endpoint is disabled. A dedicated regional ACM certificate and alias in the existing `reagvis.com` zone provide TLS. API Gateway invokes one reserved-concurrency-one Lambda container directly; there is no VPC, public IP, NAT, VPC link, load balancer, ECS or always-on compute.

The immutable Lambda image contains only the packaged Node 22 handler; it contains no ClamAV engine or signatures. The owner explicitly approved deferring provider-side malware screening **only for restricted synthetic UAT**. This is not a malware-scan claim, a compliance claim, or authorization for government documents, arbitrary external documents, or user uploads.

`document_acceptance_mode` defaults to `disabled`; the Lambda then fails initialization closed. An operator must explicitly select `restricted-synthetic-pinned-v1` in reviewed Terraform. That composition downloads only after the existing exact department/officer/session/document grant, URL hash, host allowlist, delegated credential, DNS and SSRF checks. The independently operated registry must additionally contain a lowercase SHA-256 digest of the exact immutable synthetic fixture bytes. The full downloaded byte stream is hashed and must match before any text/PDF/DOCX parser or model can see it. A missing, malformed, unregistered or mismatched digest is rejected. There is no request header/body bypass and no automatic fallback.

The 29-second Lambda and 30-second gateway preserve the application’s shared 25-second budget, including secret/configuration initialization. Failed initialization returns a UUID-preserving no-store 503 and is retried on a later invocation. Memory is 1 GB, reserved concurrency is one and no provisioned concurrency is configured. The restricted composition uses deterministic document-grounded processing for all four routes and cannot invoke paid Bedrock inference. Hosted acceptance should measure only cold/warm endpoint latency and exact fixture/tamper/auth behavior; scanner performance experiments are out of scope.

The normal provisional service composition still requires an actual malware scanner and fails construction if it is absent. It does not fall back to synthetic digest acceptance. Government-document use remains blocked until an approved scanner is restored, or a trusted upstream scanning service supplies verifiable attestation cryptographically bound to the exact downloaded bytes; caller assertion is never sufficient.

## Authorization, documents and audit

- A KMS-encrypted on-demand credential denylist is strongly consistent. Absence intentionally means not revoked; any malformed existing row fails closed.
- The temporary registry stores no URL or content—only exact URL hash, independently operator-pinned synthetic content SHA-256, scoped five-minute signed grant, delegated token, host and expiry. It has TTL but no PITR, avoiding backups of temporary credentials. Expired rows are rejected even before asynchronous TTL deletion.
- A nonempty trusted-host allowlist is mandatory Terraform/runtime configuration and is checked independently of each exact registry row.
- AWS SDK DynamoDB connections use 500 ms connect, 1.5-second request and two-attempt limits. Secret reads use a two-second signed transport timeout. Mandatory audit calls remain within the shared invocation budget.
- Audit is payload-free, pseudonymous and TTL-bounded. Public keys and audit HMAC are read from separate Secrets Manager secrets during cold initialization. Private signing keys never enter Lambda.
- The bundled operator tool supports officer issue/rotation/revocation and exact synthetic document registration/renewal from JSON stdin. Registration requires `syntheticContentSha256`, calculated and reviewed independently from the immutable curated fixture. It requires an out-of-band private key and the narrow operator policy attached to the approved current IAM identity. It cannot establish government identity or ACL authority; real records remain blocked pending external agreement.

## Resources and safe sequence

Provisioning is deliberately two-stage. The separate `infra/eoffice-pilot-bootstrap` state owns only the KMS key and immutable/scanned ECR repository. The main `infra/eoffice-pilot` state reads those resources and owns three DynamoDB tables, two secrets, Lambda role/function/log group, HTTP API/integration/routes/stage, an operator policy, ACM/custom-domain/DNS resources. No AWS Budget or notification resource is configured. `enable_public_endpoint` still defaults false for future rebuilds.

Build with `npm run eoffice:package`. After bootstrap approval, build, vulnerability-review and push the Lambda image from repository root, record its immutable digest, then run the main reviewed plan with the real digest and `document_acceptance_mode=restricted-synthetic-pinned-v1`. Only after review may secret values and synthetic registry rows be provisioned. Additional formats are denied operationally until each fixture's exact bytes, content type, URL and SHA-256 are separately curated and pinned.

### Isolated synthetic AWS acceptance before public DNS

1. Keep `enable_public_endpoint=false` and the HTTP API default endpoint disabled. Invoke the Lambda directly with API Gateway v2-shaped events using an approved synthetic officer key and controlled HTTPS document host from `allowed_document_hosts`.
2. The controlled host must require the exact short-lived delegated Bearer token and serve only small curated immutable UTF-8 synthetic fixtures. Register the exact URL hash/grant and independently computed content SHA-256 with the operator tool; never use fixture headers.
3. Record cold/warm initialization latency and payload-free audit records. Require exact fixture success; tampered bytes, unauthorized scope and unregistered documents must fail before parsing/model use. Confirm no response or audit entry claims malware screening occurred.
4. Exercise all four contracts with deterministic processing only. Paid inference remains blocked until separately approved model authorization/privacy/retention gates.
5. Only after Brain/owner acceptance may a new reviewed plan set `enable_public_endpoint=true` to create ACM validation, custom mapping and target DNS.

## Credential lifecycle

Officer JWTs last at most 15 minutes; exact grants last at most five. Rotation issues a replacement before revocation. Registration requires operator-verified department/officer authority, upstream ACL, exact URL, allowed host and delegated token. Renewal repeats verification and replaces only an expired row. Caller `user_id`, URL or JWT is never enough. TTL deletion lag cannot extend authorization because expiry is checked synchronously.

## Cost

There is no steady compute/load-balancer charge. At low pilot volume:

- API Gateway HTTP requests: typically under $1/month.
- Lambda 1-GB execution: approximately $0.000017 per compute-second plus request charges; 1,000 five-second requests are about $0.08, while 1,000 full 29-second requests are about $0.49.
- KMS key about $1/month; two Secrets Manager secrets about $0.80/month.
- DynamoDB, ECR storage, CloudWatch logs, DNS queries and certificate: normally $1–5/month at synthetic pilot volume.

Expected idle recurring cost is roughly **$2–5/month** and light acceptance usage roughly **$3–10/month**, excluding Bedrock, image-build transfer and abnormal logs. No AWS Budget or notification was provisioned.

## Rollback and blockers

Rollback disables the API mapping or sets Lambda reserved concurrency to zero, revokes all JTIs/delegated credentials, and preserves audit evidence. Code rollback selects the prior approved immutable image digest. Destruction is not first-line; tables, KMS and secrets retain deletion protection/recovery safeguards.

The deployed authentication prerequisites are satisfied: JWT issuer, RSA public key secret, owner-held private key/kid and 32-byte audit HMAC. Document-backed requests still require an approved controlled HTTPS document host, delegated-token behavior, curated immutable synthetic bytes with independent SHA-256, and approved department/officer/session/document/URL/host scope before an operator may create a five-minute registry grant.

Current blockers affect functionality, not HTTPS reachability: no approved document host or registry row, no malware screening for government documents, no government identity/ACL/delegated-download agreement, and no approved Bedrock inference/retention posture. No real document processing or paid inference occurred.
