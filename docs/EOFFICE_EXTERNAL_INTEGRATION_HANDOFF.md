# eOffice restricted pilot — external integration handoff

**Live 2026-11-27. Restricted synthetic UAT only.** This service does not process real government documents, perform malware screening or call paid AI inference.

## HTTPS endpoints

All methods are `POST` with `Content-Type: application/json`:

- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/chat`
- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/summarize`
- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/extract`
- `https://api.eoffice-pilot.reagvis.com/api/v1/ai/draft-reply`

TLS uses an Amazon-issued certificate for `api.eoffice-pilot.reagvis.com`; hostname/chain verification passed. API Gateway's default execute endpoint is disabled. Rate controls are one request/second with burst two.

## Authentication

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

## Current verified behavior

- Missing bearer token: `403` authorization denied.
- Authenticated chat without documents: `200` scoped refusal with empty references.
- Authenticated synthetic text summary: `200` deterministic summary.
- Authenticated synthetic draft: `200` deterministic officer-review draft.
- Unregistered document extraction: `422` before DNS/download/parser/model processing.

## Document onboarding still required

Before any document-backed UAT, the parties must agree an HTTPS host and delegated Bearer-token protocol. Reagvis must independently verify the exact department/officer/session/document/URL/host scope and pin the immutable synthetic fixture SHA-256 in a five-minute registry grant. The host must use public IPv4, valid TLS, no redirects, bounded content and exact immutable bytes. Caller assertions cannot bypass these controls.

Real government documents remain prohibited. Provider-side malware screening is deferred only for preapproved immutable synthetic fixtures. Bedrock/model inference, government identity compatibility, document-host compatibility and retention eligibility are not accepted capabilities of this deployment.
