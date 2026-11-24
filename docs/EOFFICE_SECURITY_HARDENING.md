# Task 22D — eOffice security and operational hardening (draft)

**Status:** Source-only implementation on `feature/eoffice-security-hardening-22d`, pending independent review and focused WSL verification. No AWS deployment, inference, government authentication, official file access, or pilot changes.

**Baseline:** Task 22C merged at `7761ea37874930ebc8a1bc38baa89ae7b9c7f1fd`. The eOffice production handler still defaults to `authorize: async () => null` and has no protected-file credentials. This PR does not activate public routes.

## 1. Implemented defensive changes

- **Dependency deadlines:** External authorization now shares the 25-second invocation budget with document retrieval, optional authorized history, and model inference. All four external seams are guarded, including callbacks that reject or throw synchronously. The deadline yields a **best-effort 503 response**; it does **not** cancel external work or prove that upstream operations stop immediately. Real adapters must implement transport-level cancellation and timeouts.
- **Confidential errors:** Errors raised by injected authorization, document, history, or inference adapters no longer cause their caller-provided diagnostic or public message strings to be copied into the HTTP error response. Known authorization denials remain 403; document and history unavailable responses remain 422; adapter deadline/unavailability remains 503; unexpected dependency failures become generic 500, and adapter-reported invalid model responses keep 502 with a fixed safe message. Internal validation, malformed model JSON and grounding failures keep their existing status handling.
- **Mock fixture boundary:** `createMockEofficeHarness` now checks `department`, `officer`, `document_id`, and `download_url` before executing the test-only `fetchDocument` override. Overrides can simulate slow or failed authorized retrieval but cannot turn an unauthorized fixture into an allowed one.
- **Offline regression tests:** `backend/eoffice/security-hardening.test.ts` exercises stalled authorization/history, adapter-secret redaction, override isolation, exact HTTPS host rules, credential/custom-port rejection, private/mixed DNS denial, and an injected successful transport. All URL/IP and response fixtures are synthetic; no live network or Bedrock calls are needed.

## 2. Existing SSRF and retrieval boundaries

`HttpsDocuments` already enforces HTTPS, exact allowlisted host names, no URL user-info or custom port, DNS resolution to public IPv4 only (rejects mixed public/private answers), pinned IP for TLS-aware HTTPS transport, redirects not automatically followed, and bounded download bytes/deadlines. 22D adds deterministic tests but does **not** claim a comprehensive penetration test or validate real government DNS/access policies.

Do not replace DNS/address checks with a client-controlled allowlist or follow redirects to new destinations. Government credentials and host authorization policies require the separately issued official integration contract.

## 3. Explicit residual risks and onboarding gates

- **Prompt injection:** History and source documents remain untrusted prompt data. A system instruction and lexical output checks do not establish real-model resistance to malicious content, semantic hallucination, or unsupported conclusions; official replies require officer review.
- **Malware:** Source-file parsing is not a malware scanner. Government-controlled protected-file retrieval and any quarantine/scanning attestation must be agreed before enabling document processing. No ClamAV or storage service is introduced by this PR.
- **Logs and redaction:** The handler does not log chat bodies, document bytes, history or provider tokens. Cross-service observability, third-party provider retention/training and redaction policy remain onboarding questions. Tests cover HTTP error-body secrecy but do not certify downstream logs.
- **Isolation:** Stateless sessions do not authenticate the caller. Production tenant/department isolation is not established until official per-request principal verification and protected-document authorization are wired and independently tested.
- **Retention:** No eOffice conversation store, model token state, temp file or generated artifact is created here. If temporary storage is later introduced, agree a default 12-hour and maximum 24-hour retention/lifecycle per the specification. Do not apply a fictitious retention setting to an absent store.
- **Current limits:** Four documents, 2 MiB per file, total request JSON at most 64,000 bytes, 24 KB combined extracted source and 32 KB prompt limits, synchronous 25-second invocation budget, and flat scalar extraction schemas. OCR-required documents, generated draft-file URLs and provider state tokens remain unsupported and fail explicitly. A 64-KB provider context token cannot fit inside the current whole-request cap plus its JSON envelope.
- **Adapter cancellation:** A timed-out promise can continue running after the HTTP response. When authenticating government users or fetching protected documents later, configure actual abort signals, request lifetimes, concurrency caps and upstream deadlines.

No claim of departmental approval or real government eOffice service compatibility is made.

## 4. Focused operator WSL verification

First check for existing worktree paths and local changes; never overwrite them.

```bash
cd ~/src/grievance-insights
git status --short
git fetch origin
test ! -e ../grievance-insights-eoffice-22d
git worktree add ../grievance-insights-eoffice-22d origin/feature/eoffice-security-hardening-22d
cd ../grievance-insights-eoffice-22d
git rev-parse HEAD
npm ci
npx vitest run backend/eoffice/security-hardening.test.ts backend/eoffice/chat-harness.test.ts backend/eoffice/core.test.ts backend/eoffice/contract.test.ts backend/eoffice/grounding.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000
npm run backend:typecheck
```

Record the exact checked-out SHA, tests passed/failed and type-check output. No GitHub Actions dispatch, full-suite test rerun, paid Bedrock inference, government requests, Terraform, merge or deployment is authorized by this draft.
