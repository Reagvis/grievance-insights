# Task 22G — isolated serverless eOffice pilot readiness

**NOT DEPLOYED.** The target `https://api.eoffice-pilot.reagvis.com` does not exist. This root uses separate state, names, roles, tables, secrets, image and rollback boundaries; it does not reference the grievance pilot.

## Minimal runtime

A regional API Gateway HTTP API exposes exactly four throttled `POST /api/v1/ai/{chat,summarize,extract,draft-reply}` routes. Its default execute endpoint is disabled. A dedicated regional ACM certificate and alias in the existing `reagvis.com` zone provide TLS. API Gateway invokes one reserved-concurrency-one Lambda container directly; there is no VPC, public IP, NAT, VPC link, load balancer, ECS or always-on compute.

The immutable Lambda image uses the AWS Node 22 AL2023 base, installs maintained ClamAV and refreshes definitions at image build. Runtime scans stream bytes to `clamscan` stdin. Because ClamAV may create internal scratch files for stdin scans, every request gets a unique bounded `TMPDIR`; leftovers are purged before reuse and the directory must be removed before any verdict is returned. The adapter accepts only exact clean/infected exit semantics and rejects scan-limit/partial/error output. ClamAV validates the daily database's embedded publication timestamp on every warm or cold scan with `--fail-if-cvd-older-than=2`; the static main database mtime is not used. Signatures are never downloaded during a request.

The image/signature owner procedure is manual and approval-gated: rebuild at least daily, retain the `freshclam` and `clamscan --version` build evidence, scan clean/EICAR/representative 2 MiB inputs, review image vulnerabilities, and approve the immutable digest before promotion. If the digest is not promoted within 48 hours, runtime scanning fails closed.

The 29-second Lambda and 30-second gateway preserve the application’s shared 25-second budget, including secret/configuration initialization. Failed initialization returns a UUID-preserving no-store 503 and is retried on a later invocation. Memory is 4 GB and no provisioned concurrency is configured. Hosted Task 22H must measure cold and warm initialization plus clean/EICAR/representative 2 MiB scans before release. Local real-engine timing was unavailable because WSL had no ClamAV and the Docker CLI produced no usable daemon response; fake-process tests verify adapter invocation, native freshness option, output and cleanup semantics only. If hosted cold initialization cannot leave the core’s 25-second budget intact, deployment remains blocked and the smallest scanner alternative must be reviewed separately.

## Authorization, documents and audit

- A KMS-encrypted on-demand credential denylist is strongly consistent. Absence intentionally means not revoked; any malformed existing row fails closed.
- The temporary registry stores no URL or content—only exact URL hash, scoped five-minute signed grant, delegated token, host and expiry. It has TTL but no PITR, avoiding backups of temporary credentials. Expired rows are rejected even before asynchronous TTL deletion.
- A nonempty trusted-host allowlist is mandatory Terraform/runtime configuration and is checked independently of each exact registry row.
- AWS SDK DynamoDB connections use 500 ms connect, 1.5-second request and two-attempt limits. Secret reads use a two-second signed transport timeout. Mandatory audit calls remain within the shared invocation budget.
- Audit is payload-free, pseudonymous and TTL-bounded. Public keys and audit HMAC are read from separate Secrets Manager secrets during cold initialization. Private signing keys never enter Lambda.
- The bundled operator tool supports officer issue/rotation/revocation and exact synthetic document registration/renewal from JSON stdin. It requires an out-of-band private key and an MFA-controlled identity using the deliberately unattached operator policy. It cannot establish government identity or ACL authority; real records remain blocked pending external agreement.

## Resources and safe sequence

Provisioning is deliberately two-stage. The separate `infra/eoffice-pilot-bootstrap` state creates only the KMS key and immutable/scanned ECR repository. After separate approval, build and push the reviewed image and record its digest. The main `infra/eoffice-pilot` state then reads those existing resources and creates three DynamoDB tables, two empty secrets, Lambda role/function/log group, HTTP API/integration/routes/stage, an unattached operator policy and an AWS Budget with a required alert email. `enable_public_endpoint` defaults false, so ACM/custom-domain/DNS resources require a later approval after isolated Lambda scanner acceptance; no fake digest or premature public endpoint is needed.

Build with `npm run eoffice:package`. After bootstrap approval, build/scan/push the Lambda image from repository root, record its immutable digest and ClamAV engine/signature metadata, then run the main reviewed plan with the real digest. Only after review may secret values and synthetic registry rows be provisioned.

### Isolated synthetic AWS acceptance before public DNS

1. Keep `enable_public_endpoint=false` and the HTTP API default endpoint disabled. Invoke the Lambda directly with API Gateway v2-shaped events using an approved synthetic officer key and controlled HTTPS document host from `allowed_document_hosts`.
2. The controlled host must require the exact short-lived delegated Bearer token and serve only bounded synthetic clean, EICAR and 2 MiB files. Register exact URL hashes/grants with the operator tool; never use fixture headers.
3. Record cold/warm initialization and scan latency, ClamAV engine/version, daily signature publication age, scratch cleanup and audit records. Require clean success, EICAR 422, stale/error/limit 503, unauthorized 403 and no retrieval before authorization.
4. Chat can prove authenticated transport, protected download, real scanning and extractive response without Bedrock. For summarize/extract/draft-reply, exercise authorization/error paths only; successful real inference remains blocked until separately approved paid smoke and model authorization/privacy gates.
5. Only after Brain/owner acceptance may a new reviewed plan set `enable_public_endpoint=true` to create ACM validation, custom mapping and target DNS.

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
