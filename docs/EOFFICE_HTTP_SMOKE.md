# Task 22E — eOffice local HTTP smoke testing

**STATUS: SOURCE IMPLEMENTED; HTTP EXECUTION PENDING WSL AND BRAIN REVIEW.** No local HTTP test result, Postman run, AWS observation or passing test count is claimed by this document. Implementation baseline: latest `main` at `4db56ebc859ed9967b34a96d461e560b416318cc`, after merged 22A–22D. Acceptance source: [GitHub Issue #43](https://github.com/Reagvis/grievance-insights/issues/43).

## Scope and hard safety boundary

This is a **standalone, explicitly opted-in loopback test process** exercising the real `backend/eoffice/core.ts::createEofficeApi()` public Phase 1 contract through Node HTTP. It is **not** the live pilot, production eOffice handler, government authentication or a service to expose.

- Listener is fixed to IPv4 **127.0.0.1:8765** for manual operation. Automated tests choose port 0 on the **same loopback address** to avoid clashes. Non-loopback binding requests, missing test opt-in, `NODE_ENV=production` and detected AWS Lambda environments are refused.
- Startup prints **TEST-ONLY / SYNTHETIC DATA / NO REAL AUTHENTICATION**. Headers `x-eoffice-smoke-actor: alpha|beta` and `x-eoffice-smoke-fault` select hard-coded offline fixtures; **neither is authentication or a credential**. No production route may accept these selectors.
- No `Authorization`/cookies/`user_id`/session ID is trusted as identity; the mock authorizer only recognizes an explicit local actor fixture. `user_id` must still satisfy core's trusted-principal consistency checks. Without an actor or with an unknown actor, a valid request fails closed with HTTP 403.
- Synthetic `https://synthetic.invalid/...` document URLs are **unroutable identifiers only**. Their strings are never retrieved by any network client. The title, PDF page map and source text exist as constants in memory. No government documents, real protected URLs, AWS SDK, Bedrock inference or outside HTTP/DNS operation is used.
- The runtime module `backend/eoffice/testing/local-fixtures.ts` intentionally does **not** import `vitest` or `backend/eoffice/testing/mock-harness.ts`. Each HTTP request builds a fresh core instance with synthetic adapters and no persistent conversation store.
- Streaming request bodies buffer at most **64,000 UTF-8 bytes**. An over-limit body is handled by passing a bounded oversized sentinel to the **real core** so it produces its established HTTP 400 envelope (without inventing an echoed UUID when the original body was too large to parse safely). No truncation of an accepted request. Unsupported method/content type/unknown route are classified by core itself, not a second router. No CORS headers are set.
- Request bodies, model outputs, document text, access tokens and exception diagnostics are **never logged**. Responses from the real core retain `Cache-Control: no-store` and its standardized JSON errors. The launcher creates a **temporary compiled code bundle only**, not document or conversation data; it removes it at normal shutdown.

## Prerequisites and safe manual startup (WSL)

Use Node.js 22 and a clean separate worktree, and inspect `git status` first. The Brain chat must first independently review the draft PR and confirm its HEAD. Substitute the reviewed commit SHA where noted.

```bash
cd ~/src/grievance-insights
git status --short
git fetch origin
test ! -e ../grievance-insights-eoffice-22e
git worktree add ../grievance-insights-eoffice-22e origin/feature/eoffice-http-smoke-22e
cd ../grievance-insights-eoffice-22e
git rev-parse HEAD
node -v
npm ci
```

From terminal **A**, start deliberately:

```bash
node scripts/eoffice-http-smoke.mjs --test-only
# TEST-ONLY — SYNTHETIC DATA — NO REAL AUTHENTICATION
# eOffice Phase 1 localhost smoke listener: http://127.0.0.1:8765
# Ctrl+C to shut down and remove the temporary compiled code module
```

Running without `--test-only`, attempting `--host 0.0.0.0`, using production/AWS Lambda environment variables, or binding an occupied port must **fail closed**. The launcher is not in any application startup/deployment script. No real authentication, eOffice production route, Lambda handler, infrastructure or pilot Vite server is enabled.

## Curl checks from terminal B

All commands below target **127.0.0.1 only**. The `x-eoffice-smoke-actor` header is a TEST FIXTURE SELECTOR, not an authorization credential. These examples are synthetic and must not be substituted with government URLs or document text.

**Chat** (200, `answer`, `references[].page_number: 2` verified against synthetic two-page material):

```bash
curl -i --max-time 30 http://127.0.0.1:8765/api/v1/ai/chat \
  -H 'Content-Type: application/json' \
  -H 'x-eoffice-smoke-actor: alpha' \
  --data-binary '{"request_id":"11111111-2222-4333-8444-000000000001","session_id":"synthetic-shared-session","user_id":"synthetic-officer-alpha","user_input":"What is the allocation cap?","context":{"documents":[{"document_id":"synthetic-policy","download_url":"https://synthetic.invalid/alpha-policy?ticket=private-alpha-secret"}]}}'
```

**Summarize** (200, only `request_id` and `summary`):

```bash
curl -i --max-time 30 http://127.0.0.1:8765/api/v1/ai/summarize \
  -H 'Content-Type: application/json' -H 'x-eoffice-smoke-actor: alpha' \
  --data-binary '{"request_id":"11111111-2222-4333-8444-000000000002","user_id":"synthetic-officer-alpha","user_input":"Summarize the attached memo.","context":{"documents":[{"document_id":"synthetic-policy","download_url":"https://synthetic.invalid/alpha-policy?ticket=private-alpha-secret"}]}}'
```

**Extract** (200, `extracted_data.subject: "Procurement"`, optional `letter_date: null`, `approved: null`, reference on page 2). The non-null boolean `approved` remains deliberately unsupported by Task 22B:

```bash
curl -i --max-time 30 http://127.0.0.1:8765/api/v1/ai/extract \
  -H 'Content-Type: application/json' -H 'x-eoffice-smoke-actor: alpha' \
  --data-binary '{"request_id":"11111111-2222-4333-8444-000000000003","user_id":"synthetic-officer-alpha","context":{"documents":[{"document_id":"synthetic-policy","download_url":"https://synthetic.invalid/alpha-policy?ticket=private-alpha-secret"}]},"extraction_schema":{"type":"object","properties":{"subject":{"type":"string"},"letter_date":{"type":["string","null"]},"approved":{"type":["boolean","null"]}},"required":["subject"]}}'
```

**Draft reply** (200, required `draft_text`, `references`; no generated-file URL):

```bash
curl -i --max-time 30 http://127.0.0.1:8765/api/v1/ai/draft-reply \
  -H 'Content-Type: application/json' -H 'x-eoffice-smoke-actor: alpha' \
  --data-binary '{"request_id":"11111111-2222-4333-8444-000000000004","user_id":"synthetic-officer-alpha","user_input":"Draft a request for Procurement supporting documents.","context":{"documents":[{"document_id":"synthetic-policy","download_url":"https://synthetic.invalid/alpha-policy?ticket=private-alpha-secret"}]}}'
```

**Three error demonstrations** (public error JSON has `request_id` where available and `system_error_message`, `user_error_message`; no synthetic protected URL or adapter diagnostic):

```bash
# Missing test actor -> 403. Bearer headers are ignored if supplied.
curl -i --max-time 30 http://127.0.0.1:8765/api/v1/ai/chat \
  -H 'Content-Type: application/json' \
  --data-binary '{"request_id":"11111111-2222-4333-8444-000000000005","session_id":"synthetic-shared-session","user_input":"Hello"}'

# Missing chat session -> 400
curl -i --max-time 30 http://127.0.0.1:8765/api/v1/ai/chat \
  -H 'Content-Type: application/json' -H 'x-eoffice-smoke-actor: alpha' \
  --data-binary '{"request_id":"11111111-2222-4333-8444-000000000006","user_input":"Hello"}'

# Simulated upstream unavailability -> safe 503 (no delay)
curl -i --max-time 30 http://127.0.0.1:8765/api/v1/ai/chat \
  -H 'Content-Type: application/json' -H 'x-eoffice-smoke-actor: alpha' \
  -H 'x-eoffice-smoke-fault: model-unavailable' \
  --data-binary '{"request_id":"11111111-2222-4333-8444-000000000007","session_id":"synthetic-shared-session","user_input":"Hello"}'
```

For an actual **25-second deadline** demonstration, use `x-eoffice-smoke-fault: model-timeout` and a sufficiently long client timeout (`curl --max-time 35`). This is a deliberately non-settling synthetic model promise, **not** a paid-model or network timeout.

## Postman collection

Import `postman/eoffice-phase1-local.postman_collection.json` (Collection v2.1); its collection variable `baseUrl` defaults to **`http://127.0.0.1:8765`**. Start the local listener separately. Run the four numbered success requests and then the negative cases. Requests include `pm.test` status/JSON/no-store/UUID/error checks. The collection has a pre-request-generated oversize case; it does not store a 65-KB government document. The last request, **“Optional real 25s timeout”**, intentionally takes around 25 seconds, so use appropriate Postman request timeouts. Do not change `baseUrl` to an AWS/public address.

## Automated localhost HTTP acceptance

After Brain reviews the source and verifies the exact PR SHA, the operator runs:

```bash
# New real socket tests, including one approximately 25-second deadline test.
npx vitest run backend/eoffice/http-smoke.test.ts --maxWorkers=2 --testTimeout=35000
# Six established eOffice regression files, not the entire repository suite:
npx vitest run backend/eoffice/security-hardening.test.ts \
  backend/eoffice/chat-harness.test.ts \
  backend/eoffice/core.test.ts \
  backend/eoffice/contract.test.ts \
  backend/eoffice/grounding.test.ts \
  backend/eoffice/schema.test.ts \
  --maxWorkers=2 --testTimeout=20000
npm run backend:typecheck
```

`http-smoke.test.ts` creates a separate ephemeral **127.0.0.1** listener for each test suite, issues actual Node HTTP requests and one **raw `node:net` HTTP/1.1 exchange**, then closes it. It asserts four exact success envelopes, UUID echo, real PDF page attribution, 200/400/403/404/405/415/422/500/502/503 mappings, oversized streaming body, non-loopback refusal, cross-department and reused-session isolation, explicit scoped history, absent implicit prior context, token prohibition, source URL redaction, and no synthetic outbound `fetch`/HTTPS call. Scope of this proof is the fixture implementation and test runtime; it is **not** proof of a machine-wide egress firewall or official government authentication.

## Results ledger (do not fabricate execution)

| Evidence | Current status |
| --- | --- |
| Source/test/Postman artifacts committed to draft PR | Implementation in progress; verify final PR diff |
| Brain source review of Task 22E | **Pending** |
| 22E local HTTP Vitest including real socket and 25-second timeout | **Pending developer WSL run** |
| Task 22D six existing eOffice regression suites | **Pending developer WSL rerun at 22E HEAD** |
| `npm run backend:typecheck` at 22E HEAD | **Pending developer WSL run** |
| Manual curl and Postman collection import/run | **Pending developer WSL run** |
| Real eOffice authentication, documents, government HTTPS interoperability | **Not implemented / not verified** |
| AWS staging deployment, paid inference, public route activation | **Not authorized / not performed** |

Submit the tested HEAD SHA and terminal output to the independent Brain chat. Do not claim full-source grounding, OCR, malware scanning, approved boolean extraction, provider-token state or production multi-turn memory from these synthetic tests.

## Separate future stage

See [EOFFICE_STAGING_READINESS.md](EOFFICE_STAGING_READINESS.md). That document is **planning only**; it neither provides deployable infrastructure nor authorizes AWS, Bedrock, or exposure. A code-only PR merge and an AWS staging decision are independent owner approvals.
