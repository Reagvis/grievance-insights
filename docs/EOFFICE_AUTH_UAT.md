# Task 22F — provisional eOffice authenticated API and document-only UAT design

**SOURCE-ONLY, DRAFT, NOT DEPLOYED OR FUNCTIONAL OVER PUBLIC HTTPS.** Read [Issue #55](https://github.com/Reagvis/grievance-insights/issues/55) and its Brain scope clarification first. Source baseline: \`main\` \`0b00630e4cd73d2816f6d26c52fb20ff14a605bf\` (2026-11-27). The external eOffice team has not provided its separate authentication or protected-document specification. This is an **operator-managed proposed UAT protocol**, not confirmed government compatibility or permission to publish endpoints.

The four Phase 1 v2.0 request/response contracts remain \`POST /api/v1/ai/{chat,summarize,extract,draft-reply}\`. No new public JSON fields are introduced. A distinct factory, \`backend/eoffice/provisional/service.ts::createProvisionalEofficeService()\`, composes an authenticated implementation. It is **not connected to any API Gateway, Lambda handler, frontend or existing pilot server**. The original \`backend/eoffice/handler.ts\` remains default-deny; \`bedrockModel\`, its region/model configuration, and the Qwen grievance app are untouched.

## 1. Provisional officer authentication (NOT official government auth)

**Proposed request header:** \`Authorization: Bearer <short-lived RS256 JWT>\` over an independently approved HTTPS private UAT endpoint **only after separate deployment authorization**. Synthetic actor headers from Task 22E are NOT accepted as officer credentials. No \`x-api-key\`, Cookie, \`user_id\`, arbitrary URL, \`session_id\` or body property can authenticate an officer.

The verifier uses **Node.js 22's maintained OpenSSL-backed \`crypto.verify('RSA-SHA256', ...)\`** and strict JWT framing/claim validation, rather than embedding keys or implementing cryptographic primitives. It is a narrowly implemented parser/verifier and requires independent protocol/security review before real UAT. The allowlist consists of \`RS256\` **only**, 2048-bit or stronger RSA public keys supplied through explicit operator configuration; \`alg=none\`, HMAC, EC, unknown \`kid\`, header-provided \`jku\`/\`jwk\`/\`x5u\`/\`crit\`, dynamic JWKS and invalid signatures are rejected. It verifies exact configured \`iss\`, fixed UAT \`aud=eoffice-ai-officer-uat\`, \`sub=officer\`, \`dept\`, \`officer\`, unique \`jti\`, \`iat\`, \`nbf\`, \`exp\` and one or more approved task permissions. Maximum lifetime is 15 minutes (5 seconds clock skew). Identity claims come from a valid signature and are never derived from the request's \`user_id\`.

For this strict enabled UAT composition, the caller must include \`user_id\` **matching the verified officer**; chat also requires an officer-token \`session_id\` matching the request's required \`session_id\`. This is a stricter onboarding constraint than the original PDF, whose \`user_id\` was not explicitly declared mandatory; **the department must approve it**. Requests without valid signed identity/scope, with task permission mismatch, or with revoked credentials fail 403. A credential status/revocation-store outage fails **503**, not an implicit allow. UUID echo and standardized error envelopes remain governed by \`createEofficeApi\`.

No actual issuer, public/private key, government identity, identity proxy, root token or credential appears in the repository. \`SigningKey\`, \`VerificationConfig\`, \`CredentialStatus\` and \`OperatorCredentialManager\` are injected; the implementation has no environment-variable fallback or default trusted key.

### Operator credential lifecycle, no public management routes

\`issueOfficerToken\` and \`OperatorCredentialManager.issueOfficer\` sign a **new** short-lived officer token using an operator-supplied protected RSA private key and return the token once. \`issueDocumentGrant\` signs independently scoped read grants. \`revoke(kind,jti)\` requires an independently secure status store; every request checks revocation. \`rotateOfficer(oldJti, scope)\` issues a new token, revokes the former JTI and emits sanitized lifecycle audit records. A new \`kid\` and approved public-key allowlist can overlap during planned key rotation; separately revoke retiring tokens and remove retired keys. Issuance and revocation storage/approval/access controls, private key custody, HSM/KMS, rate limits, administrative MFA and lifecycle audit persistence remain **Task 22G/operator infrastructure**, not implemented here.

**A department-wide API key is insufficient to prove the individual officer**. Provisional JWT issuance must be performed by a trusted operator who separately verifies department/officer authority before minting a token; this code cannot establish government officer identity on its own.

## 2. Exact protected-document authorization and malware barrier

Each eOffice request supplies exactly \`{document_id, download_url}\` per §3.3; these values are **untrusted selectors**, never a grant. \`createSecureDocumentSource\` demands a **trusted** \`TrustedResourceRegistry\` that independently resolves a short-lived signed resource grant and per-resource delegated credential for the verified officer and document. Its RS256 grant is audience-separated (\`aud=eoffice-ai-document-grant-uat\`), maximum five minutes, and binds the exact authenticated department, officer, \`document_id\`, SHA-256 of the complete download URL (including query), and **chat session ID**. Non-chat tasks require an unbound (no-session) grant; this is an explicit onboarding policy. Every grant is subject to the same online revocation-status check. Wrong user, department, URL, document, session, signature, expiry, or revoked grant fails closed before DNS/download/model calls. The grant registry cannot be resolved directly from a request header.

After authorization, the existing \`HttpsDocuments\` enforces a trusted HTTPS host allowlist, no credentials in URLs, no redirects, public IPv4-only vetted DNS resolution with pinned TLS name, bounded size (2 MiB), short transport timeout and full-file parsing limits (24 KB text). **Operator-managed per-resource delegated Bearer credentials are mandatory**. The real government download-credential protocol and ACL source have **not** been provided; the registry and credential resolver are only interfaces and offline fakes. A host allowlist, signed provider token, or per-department shared header alone is not a substitute for government ACL enforcement.

The secure composition requires a **real malware-scanning callback before parsing**. The added \`unixClamdScanner('/operator/approved/unix.sock')\` implements ClamAV INSTREAM over a private UNIX socket without writing document bytes to disk; only the exact \`stream: OK\` result passes. An infection causes 422, an unsupported/failed/missing scanner causes safe 503. The scanner, current signature databases, daemon health, egress restrictions and operational quarantine decisions require **separate staging provisioning and verification**; an offline mock returning \`clean\` is NOT malware protection. The secure factory will not construct without a scanner. Historical \`HttpsDocuments\` call sites retain their optional scanner behavior; the still-denying production handler is unaffected.

## 3. Strict document-only chat, no global index, no stateful memory

\`createProvisionalEofficeService\` enables \`createEofficeApi({strictChat})\` for chat. After per-request authenticated, authorized document retrieval and validation, the strict path chooses **only an exact bounded source sentence/line** from an attached, authorized document when the question's significant terms sufficiently overlap the excerpt. It cannot invoke the external Bedrock/Qwen model; there is **no global private index, external knowledge connector, web search, cross-request cache or persistent conversation memory**. For **no documents**, an unrelated question, unsafe/protected source passage or unsupported request, it returns:

> I can only answer from authorized documents supplied with this request.

This is a deterministic 200 \`answer\` with \`references: []\`, not a fabricated document citation. For a supported question it outputs the **verbatim excerpt**, with source evidence and optional PDF page number checked again by the existing \`decodeModel\`/\`verifySourceEvidence\`/\`verifyNarrativeNumbers\`/\`verifyNoProtectedLinks\` path. It **never** synthesizes a causal/nonnumeric explanation from a cited snippet or treats document prompt instructions as commands. It does not trust prior context to authorize document access; the provisional service provides **no history resolver**, so \`previous_context\` is explicitly rejected. \`provider_context_token\` remains disabled. A repeated \`session_id\` alone cannot retrieve private data.

**Deliberate functionality limits:** lexical overlap can falsely refuse relevant paraphrases, fail nuanced questions or return a correct but incomplete sentence. Verbatim text may be irrelevant even when words overlap; semantic relevance, PII classification, harmful-content review, multilingual equivalence and contradictions are **not solved**. Excerpt filtering rejects obvious URL/secret/prompt-injection strings but is not a general data-loss-prevention guarantee. Human approval is mandatory for all official decisions.

## 4. Other three endpoints in provisional UAT

To preserve the four public response shapes without paid inference, the provisional composition uses **deterministicTaskModel** for \`summarize\`, \`extract\` and \`draft-reply\`, never the shared grievance Bedrock adapter.

- **Summarize:** a safe *extractive passage*, not a complete abstractive summary. When no documents are attached, the supplied \`user_input\` source-text line is treated as the source (§2.2); instruction-only text remains blocked by existing core validation.
- **Extract:** only a supported literal \`field_name: value\` from authorized source text is returned. Required fields missing literal values fail **422**; nullable optional fields remain \`null\`. Non-null booleans continue to be rejected as in Task 22B. Complex schemas, inference, arithmetic, normalized dates and noisy OCR are not supported.
- **Draft reply:** a clearly labeled proposed officer-review template, optionally quoting verified source text. It does not issue an approval, generate files, certify facts or act on government systems. Instruction-only drafts receive a generic review template and no claimed source.

These are **restricted UAT behaviors**, not parity with a production Qwen3-32B document assistant. If the eOffice team requires actual semantic summaries or detailed correspondence, negotiate an approved inference and factual-validation design separately. The existing public JSON contract has not been changed.

## 5. Sanitized mandatory audit

\`SafeAudit\` only sends these fields to a required injected, access-restricted sink: event time; action/outcome; normalized endpoint; UUID when parseable; HMAC-pseudonymous department and officer tags; nonsecret credential ID (\`jti\`); HTTP status and latency. **No request/response bodies, prompts, model answers, officer names, document IDs/URLs, Bearer tokens, file bytes, raw exceptions, credentials or secrets.** Audit HMAC requires a separate operator-managed 32-byte key. The factory checks for an available sink before authorization and emits an authenticated event before document access; sink failures fail closed. Lifecycle issue/revoke/rotate operations also send only allowlisted records. Sink implementation, regional restrictions, access controls, retention/deletion, tamper protection and rate-limit/abuse policy belong to 22G.

## 6. Security review and acceptance gates

**No deployed HTTPS base URL exists in Task 22F.** Existing eOffice production \`backend/eoffice/handler.ts\` continues to fail closed, and the live \`https://telangana-gov-pilot.reagvis.com\` grievance pilot is not an eOffice endpoint. Initial UAT must use operator-issued synthetic identities, synthetic documents, an approved independent authorization registry and real scanner only when independently deployed.

Before any staging deployment: Brain approves the exact code/diff and focused WSL evidence; owner approves a separate isolated HTTPS service, private identity/ACL management, scanner/DB provisioning, IAM/network controls, logging controls, rate limits, cost budget, Gateway/Lambda 25s-plus margins and rollback. Confirm government JWT compatibility/issuer claims, government protected file ACL protocol, departmental user mapping, delegated credentials, supported JSON Schemas, language/OCR requirements, revocation consistency and privacy policy. Review Bedrock model/region **zero-retention eligibility**, provider invocation logging/training restrictions and network egress without modifying existing Qwen settings; this task did **not** verify those external settings or invoke paid inference.

The original PDF §§2–6.3 remains authoritative; this provisional UAT profile contains documented restrictions needing departmental agreement. Stronger authentication and exact grants **do not create permission** to deploy a public service or process real government data.

## 7. Operator WSL verification after independent Brain review

In an isolated new worktree at the exact reviewed SHA:

\`\`\`bash
cd ~/src/grievance-insights
git status --short
git fetch origin
test ! -e ../grievance-insights-eoffice-22f
git worktree add ../grievance-insights-eoffice-22f origin/feature/eoffice-auth-document-only-22f
cd ../grievance-insights-eoffice-22f
git rev-parse HEAD
npm ci
npx vitest run backend/eoffice/provisional/security.test.ts --maxWorkers=2 --testTimeout=20000
npx vitest run backend/eoffice/core.test.ts backend/eoffice/contract.test.ts backend/eoffice/grounding.test.ts backend/eoffice/security-hardening.test.ts backend/eoffice/chat-harness.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000
npm run backend:typecheck
\`\`\`

**These commands have not been run by the GitHub-connector implementation session.** Record exact errors and passing evidence; do not rerun the complete repository suite, invoke live government URLs, paid Bedrock, or start a public listener. PR must remain **draft and unmerged** for Brain integration decision. Do not update PR #44.
