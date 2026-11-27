# Task 22I — eOffice integration readiness

This is a code and deployment plan. It has not been applied. The live Task 22H service remains restricted synthetic UAT until an owner approves an exact plan, image digest and deployment window.

## Authentication and authorization

The eOffice stack creates a dedicated `grievance-insights-eoffice-pilot-m2m` Cognito user pool in `ap-south-1`. It is not the grievance pilot pool. Its resource server is `eoffice-api`, with `chat`, `summarize`, `extract`, and `draft-reply` scopes. The initial confidential client permits only the OAuth 2.0 Client Credentials grant and receives 15-minute access tokens. API Gateway requires the route-specific scope and verifies the dedicated pool issuer and an explicit Terraform-reviewed audience list before invoking Lambda. The initial client is always included; after a client is created in the Console, its ID must be added to `cognito_additional_client_ids` in a reviewed Terraform update before it can call the API.

Cognito authentication is only the first gate. Each invocation also makes a strongly consistent read of the dedicated client-authorization table. The row key is `client#<client-id>` and must contain:

```json
{
  "id": "client#<client-id>",
  "clientId": "<client-id>",
  "department": "<approved-department>",
  "officer": "<approved-officer>",
  "sessionId": "<approved-chat-session>",
  "permissions": ["chat", "summarize", "extract", "draft-reply"],
  "enabled": true,
  "tokensValidAfter": 1795700000
}
```

Lambda checks token issuer, `token_use=access`, client ID, `iat`, `exp`, route scope, registry permission, officer and chat session. Document access still requires a separate exact registry row, signed document grant, URL hash, department/officer/session binding, expiry, host allowlist and pinned synthetic content digest. Cognito never grants document access by itself.

This registry mapping deliberately represents one fixed synthetic UAT principal and one fixed chat session per client. It is not institution-wide onboarding and must not be used to trust caller-selected `user_id` or `session_id`. A real institutional rollout remains blocked until eOffice and Reagvis agree a trusted per-request officer/session identity, upstream ACL and document-authorization protocol; the existing exact document-grant checks remain mandatory.

Onboarding and credential operations use only the AWS Console. An owner creates or rotates a confidential app client in the dedicated pool, assigns minimum scopes, securely transfers its ID/secret once, and creates the application row in DynamoDB. No client secret is placed in Terraform output, source, logs, email, tickets or chat. The Terraform-created initial secret is sensitive state data protected by the approved encrypted/locked remote backend; it is never output.

To suspend immediately, set the registry `enabled` to `false`, then disable/delete or rotate the Cognito client in the Console. To revoke all already-issued access tokens while retaining the client, set `tokensValidAfter` to the current Unix time and rotate the secret. API Gateway JWT validation alone does not consult revocation state; the mandatory per-request registry check invalidates earlier tokens.

## Request and inference controls

- JSON request: at most 256 KiB, UTF-8, not base64 encoded.
- Documents: zero or one reference; extraction requires one.
- Downloaded document: at most 10 MiB.
- Extracted source context: at most 128 KiB; complete prompt at most 256 KiB.
- No cross-request document, model or chat cache. Strict chat remains local current-document extraction. The deployment defaults to explicit `deterministic` offline processing. `bedrock` selects the existing Qwen3 32B Converse adapter only after separate retention and paid-synthetic acceptance approval; there is no automatic fallback.

Real government documents remain prohibited. Restricted credentials are for synthetic testers only: no real text, filenames, instructions or documents may be submitted. Restricted mode accepts only operator-registered synthetic bytes with independently pinned SHA-256; it does not use a content classifier as a security boundary. Real-document rollout additionally requires fail-closed malware screening and an agreed trusted upstream access protocol.

## Bedrock data controls

The 2026-11-27 read-only check found Qwen3 32B active for on-demand inference in Mumbai. `GetModelInvocationLoggingConfiguration` returned no logging configuration, consistent with invocation content logging being disabled. AWS states Bedrock inputs/outputs are not used to train AWS or third-party models, but retention is model/account-mode dependent and some traffic can be retained for abuse detection. Synthetic paid acceptance therefore requires owner confirmation of the effective Qwen/account retention mode in the Bedrock Console; real documents stay blocked. Do not enable model invocation content logging for this service.

## Deployment plan (approval required)

1. Build/test the lightweight image locally; record source SHA and local digest. After approval, push, scan and pin its immutable ECR digest.
2. Initialize `infra/eoffice-pilot` against its existing remote-state key and lockfile. Plan with the image digest, current synthetic host allowlist, restricted acceptance mode and the existing public endpoint setting.
3. Inspect the plan. It may add only the dedicated Cognito pool/resource server/domain/client, client-authorization table, JWT authorizer, route scopes, Lambda environment/IAM changes and image digest. It must not alter grievance-pilot resources.
4. Apply the saved checksum-verified plan under remote-state locking.
5. In the Console, retrieve/rotate the client secret, enter its application row and deliver credentials through the approved secret channel. Add any Console-created client ID to the reviewed Terraform audience list before use. Do not use a repository CLI or custom portal.
6. Obtain a 15-minute token from `/oauth2/token`. Run synthetic acceptance for missing/invalid token, wrong scope, suspended client, pre-`tokensValidAfter` token, officer/session mismatch, unregistered document, all four contracts, size boundaries and isolation.
7. Make only separately approved paid synthetic Bedrock calls. Confirm HTTPS/TLS and unchanged domain. Roll back the image and auth configuration if acceptance fails; never weaken auth.

## Cost and owner inputs

The AWS Price List API publication dated 2026-11-19 reports Mumbai M2M token requests at USD 0.00225 each for the first 250,000/month, USD 0.00150 from 250,000 to 5,000,000, and USD 0.001125 thereafter. App clients are USD 0; there is no M2M free tier. Thus 1,000 token requests/month cost USD 2.25 and 10,000 cost USD 22.50. Fifteen-minute token reuse avoids a token per API call. Incremental DynamoDB, Lambda/API Gateway and logs should remain cents to low single-digit USD at restricted UAT traffic. Bedrock inference is additional and usage-dependent.

Minimum owner inputs: approval of the exact image digest and Terraform plan; final globally unique Cognito domain prefix; client-to-department/officer/session/permission mappings; credential recipient and secure-delivery channel; synthetic acceptance window/call ceiling; and confirmation of effective Qwen retention mode. The deploying principal also needs scoped Cognito user-pool/resource-server/client/domain CRUD, API Gateway authorizer/route updates, DynamoDB table/IAM-policy/Lambda updates, existing KMS/ECR data reads, remote-state access, and the already-added runtime-role `iam:PassRole`; no grievance resource permissions are required.

The 10 MiB download and 128 KiB extracted-context values are enforced ceilings, not proof of representative parsing or latency. Document-backed success, supported real-world format behavior and hosted performance remain unverified. This plan is restricted synthetic readiness, not production readiness.
