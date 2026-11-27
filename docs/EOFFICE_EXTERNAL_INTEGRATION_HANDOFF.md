# eOffice restricted pilot — external integration handoff

**Live 2026-11-27. Restricted synthetic UAT only.** This service does not process real government documents, perform malware screening or call paid AI inference.

## HTTPS endpoints

All methods are `POST` with `Content-Type: application/json`:

- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/chat`
- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/summarize`
- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/extract`
- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/draft-reply`

TLS uses an Amazon-issued certificate for `api.eoffice-pilot.reagvis.com`; hostname/chain verification passed. API Gateway's default execute endpoint is disabled. Rate controls are one request/second with burst two.

## Authentication (Task 22I planned; not deployed)

The next approved deployment replaces the provisional officer JWT with a dedicated Amazon Cognito OAuth 2.0 Client Credentials flow. Until applied, live authentication remains Task 22H behavior below.

After deployment, each integration receives a confidential client ID/secret through the approved secure channel and requests a 15-minute access token from the dedicated Mumbai Cognito token endpoint using HTTP Basic client authentication, `grant_type=client_credentials`, and only required `eoffice-api/<operation>` scopes. Send it as `Authorization: Bearer <access-token>`. Reagvis separately registers one fixed synthetic UAT department, officer, permission set and chat session per client; this is not an institution-wide identity protocol, and Cognito alone never authorizes a document. Client onboarding, rotation and suspension use the AWS Console only; each client ID must also be in the reviewed Terraform authorizer audience list.

See [EOFFICE_INTEGRATION_READINESS.md](EOFFICE_INTEGRATION_READINESS.md) for the planned revocation procedure and deployment gate.

### Current Task 22H authentication

Every request requires `Authorization: Bearer <officer-jwt>`. Tokens are RS256 JWTs issued out of band by the Reagvis operator, expire in at most 15 minutes, and bind the exact issuer, officer, department, permissions and optional session. The JSON `user_id` must equal the signed officer. Chat credentials are bound to the exact `session_id`. There is no public login, key-discovery, credential-issuance or management endpoint.

Request a token through the approved secure credential channel immediately before a UAT window. Never send tokens in email, issue trackers or Git. Reagvis operators generate a fresh token with the local `artifacts/eoffice/operator.mjs issue-officer` tool; the RSA private key remains outside the repository and AWS runtime. Revocation uses the credential ID, not the token text.

## Minimal requests

Chat:

```json
{
  "request_id": "11111111-2222-4333-8444-000000000001",
  "session_id": "agreed-session-id",
  "user_id": "issued-officer-id",
  "user_input": "What can you answer from the supplied material?"
}
```

Summarize:

```json
{
  "request_id": "11111111-2222-4333-8444-000000000002",
  "user_id": "issued-officer-id",
  "user_input": "Synthetic note: procurement review is pending."
}
```

Draft reply:

```json
{
  "request_id": "11111111-2222-4333-8444-000000000003",
  "user_id": "issued-officer-id",
  "user_input": "Draft a short acknowledgement for this synthetic note."
}
```

Extraction requires `context.documents` and `extraction_schema` as defined in [EOFFICE_PROVIDER_HANDOFF.md](EOFFICE_PROVIDER_HANDOFF.md). It is currently unavailable because no protected document host or grant is configured.

Successful responses echo `request_id`. Chat returns `answer` and `references`; summarize returns `summary`; extraction returns `extracted_data` and `references`; draft reply returns `draft_text` and `references`. Responses are JSON UTF-8 with `cache-control: no-store`. Errors use `system_error_message` and `user_error_message` and echo a valid request UUID when available.

API Gateway can reject a request before Lambda runs: missing/invalid tokens can produce gateway `401`, insufficient scopes `403`, and throttling `429`. Those gateway-origin responses do not use the application error envelope and cannot echo the body `request_id`. UUID echo applies only to requests that reach Lambda.

## Current verified behavior

- Current Task 22H missing bearer token: `403` authorization denied. After the Cognito plan is deployed, the gateway normally returns `401` before Lambda.
- Authenticated chat without documents: `200` scoped refusal with empty references.
- Authenticated synthetic text summary: `200` deterministic summary.
- Authenticated synthetic draft: `200` deterministic officer-review draft.
- Unregistered document extraction: `422` before DNS/download/parser/model processing.

## Document onboarding still required

Before any document-backed UAT, the parties must agree an HTTPS host and delegated Bearer-token protocol. Reagvis must independently verify the exact department/officer/session/document/URL/host scope and pin the immutable synthetic fixture SHA-256 in a five-minute registry grant. The host must use public IPv4, valid TLS, no redirects, bounded content and exact immutable bytes. Caller assertions cannot bypass these controls.

Real government documents remain prohibited. Restricted credentials permit synthetic test content only, including instructions and filenames; no content classifier is an authorization boundary. Provider-side malware screening is deferred only for preapproved immutable synthetic fixtures. Bedrock defaults off/deterministic and requires separate approval. Government identity compatibility, document-host compatibility and retention eligibility are not accepted capabilities of this deployment. The 10 MiB/128 KiB values are ceilings, not verified format, parsing or latency capability.
