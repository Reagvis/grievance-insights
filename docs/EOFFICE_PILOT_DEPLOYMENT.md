# Task 22G — isolated serverless eOffice pilot readiness

**NOT DEPLOYED.** The target `https://api.eoffice-pilot.reagvis.com` does not exist. This root uses separate state, names, roles, tables, secrets, image and rollback boundaries; it does not reference the grievance pilot.

## Minimal runtime

A regional API Gateway HTTP API exposes exactly four throttled `POST /api/v1/ai/{chat,summarize,extract,draft-reply}` routes. Its default execute endpoint is disabled. A dedicated regional ACM certificate and alias in the existing `reagvis.com` zone provide TLS. API Gateway invokes one reserved-concurrency-one Lambda container directly; there is no VPC, public IP, NAT, VPC link, load balancer, ECS or always-on compute.

The immutable Lambda image uses the AWS Node 22 AL2023 base, installs maintained ClamAV and refreshes definitions at image build. Runtime scans stream bytes to `clamscan` stdin, never writes documents to `/tmp`, accepts only exact clean/infected exit semantics, and fails closed for missing/older-than-48-hour signatures, process errors and deadline exhaustion. Signatures are never downloaded during a request. A scheduled externally reviewed rebuild is required at least daily; the digest changes only through a separately approved release.

The 29-second Lambda and 30-second gateway preserve the application’s shared 25-second budget. Memory is 4 GB and no provisioned concurrency is configured. Hosted Task 22H must measure cold and warm initialization plus clean/EICAR/representative 2 MiB scans before release. Local real-engine timing was unavailable because WSL had no ClamAV and the Docker CLI produced no usable daemon response; fake-process tests verify adapter framing/failure semantics only. If hosted cold initialization cannot leave the core’s 25-second budget intact, deployment remains blocked and the smallest scanner alternative must be reviewed separately.

## Authorization, documents and audit

- A KMS-encrypted on-demand credential denylist is strongly consistent. Absence intentionally means not revoked; any malformed existing row fails closed.
- The temporary registry stores no URL or content—only exact URL hash, scoped five-minute signed grant, delegated token, host and expiry. It has TTL but no PITR, avoiding backups of temporary credentials. Expired rows are rejected even before asynchronous TTL deletion.
- A nonempty trusted-host allowlist is mandatory Terraform/runtime configuration and is checked independently of each exact registry row.
- AWS SDK DynamoDB connections use 500 ms connect, 1.5-second request and two-attempt limits. Secret reads use a two-second signed transport timeout. Mandatory audit calls remain within the shared invocation budget.
- Audit is payload-free, pseudonymous and TTL-bounded. Public keys and audit HMAC are read from separate Secrets Manager secrets during cold initialization. Private signing keys never enter Lambda.
- The bundled operator tool supports officer issue/rotation/revocation and exact synthetic document registration/renewal from JSON stdin. It requires an out-of-band private key and an MFA-controlled identity using the deliberately unattached operator policy. It cannot establish government identity or ACL authority; real records remain blocked pending external agreement.

## Resources and safe sequence

The separate Terraform root creates one KMS key, three DynamoDB tables, two empty secrets, one immutable/scanned ECR repository, Lambda role/function/log group, HTTP API/integration/routes/stage, ACM validation/custom domain/DNS records, an unattached operator policy and an AWS Budget with a required alert email.

Build with `npm run eoffice:package`, build/scan the Lambda image from repository root, record its immutable digest and ClamAV engine/signature metadata, then run backend-disabled Terraform validation and a separately approved plan. Only after review may infrastructure, secret values and synthetic registry rows be provisioned. Task 22H then verifies scanner age, cold/warm timing, EICAR rejection, four HTTPS contracts and a separately approved minimal paid inference smoke.

## Credential lifecycle

Officer JWTs last at most 15 minutes; exact grants last at most five. Rotation issues a replacement before revocation. Registration requires operator-verified department/officer authority, upstream ACL, exact URL, allowed host and delegated token. Renewal repeats verification and replaces only an expired row. Caller `user_id`, URL or JWT is never enough. TTL deletion lag cannot extend authorization because expiry is checked synchronously.

## Cost

There is no steady compute/load-balancer charge. At low pilot volume:

- API Gateway HTTP requests: typically under $1/month.
- Lambda 4-GB execution: approximately $0.000067 per compute-second plus request charges; 1,000 five-second requests are about $0.34, while 1,000 full 29-second requests are about $1.95.
- KMS key about $1/month; two Secrets Manager secrets about $0.80/month.
- DynamoDB, ECR storage, CloudWatch logs, DNS queries and certificate: normally $1–5/month at synthetic pilot volume.

Expected idle recurring cost is roughly **$2–5/month** and light acceptance usage roughly **$3–10/month**, excluding Bedrock, image-build transfer and abnormal logs. The required budget subscriber receives a forecast alert at 80%.

## Rollback and blockers

Rollback disables the API mapping or sets Lambda reserved concurrency to zero, revokes all JTIs/delegated credentials, and preserves audit evidence. Code rollback selects the prior approved immutable image digest. Destruction is not first-line; tables, KMS and secrets retain deletion protection/recovery safeguards.

Current blockers: no DNS/certificate/resources or image digest; no approved host/budget email/secret values/operator key; no local real ClamAV measurements or hosted cold-start evidence; current Bedrock availability reports `NOT_AUTHORIZED`; account retention is `inherit`; government identity/ACL/delegated-download compatibility and model retention eligibility remain unverified. No AWS write, inference or real document processing occurred.
