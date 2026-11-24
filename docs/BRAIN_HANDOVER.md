# Grievance Insights — Living Brain Handover

**Last updated:** 2026-11-24 (Asia/Kolkata)

## REVIEW CHECKPOINT — 2026-11-24: PR #40 revised, two blockers resolved in source; WSL pending

- **Second Task 22B independent review** of [draft PR #40](https://github.com/Reagvis/grievance-insights/pull/40), current head `68e0e2fbbfea0909a37e14a6a1498f318c850306`. GitHub shows open, draft, unmerged, `mergeable:true`, `mergeable_state:clean` (check again before any eventual merge). Branch is one documentation-only handover commit behind `main`, with no overlapping PR file paths. Eight overall changed files under `backend/eoffice/*` and `docs/*`; no pilot/infra/frontend/auth-handler changes.
- **Finding 1 closed at source level:** `verifyNarrativeNumbers` now uses verified evidence rather than untrusted question numbers for chat/document-based summaries. Regression: source 1.2 million + officer asks 9.7 million + model asserts 9.7 -> 502; supported 1.2 -> 200. Explicitly supplied draft instructions and document-free summary source text may still contribute numbers, but officer review is needed and this is lexical not semantic validation.
- **Finding 2 closed at source level:** `verifyExtractedFacts` rejects **all non-null booleans** (provider error 502), including `approved: true` attested only by `Approved: not true` as well as contradictory/positive cases. Nullable missing boolean still resolves `null`. **Capability warning:** required boolean fields cannot succeed until a reliably validated field-specific strategy is implemented/agreed at onboarding. Do not claim boolean extraction fully supported.
- **Evidence output-budget assessment:** New offline mocked complete JSON envelopes with 2/3/4 docs: narrative 584/759/934 bytes and extraction 483/697/911 ASCII bytes respectively. These are **not measured Qwen tokenizer counts, latency or inference results**. 16 evidence quotes × 512 UTF-8 bytes could exceed 1600 narrative / 1400 extraction max output tokens. Existing limits are unchanged; failure is explicit, no silent truncation. Representative fixtures are promising but cannot establish all-case usability.
- **GitHub review:** Source-level closure and pending WSL gate recorded as [review 6033424966](https://github.com/Reagvis/grievance-insights/pull/40#pullrequestreview-6033424966), action COMMENT because connected account is PR author. Verified `backend/eoffice/handler.ts` on this head still has `authorize: async () => null` and protected document credentials are unconfigured.
- **Testing and release gate:** No WSL runtime tests, backend typecheck, paid Bedrock inference, GitHub Actions, merge or deployment performed by Brain. Developer should verify exact head then run only `npx vitest run backend/eoffice/grounding.test.ts backend/eoffice/core.test.ts backend/eoffice/contract.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000` and `npm run backend:typecheck`. Await reported output, independent final decision and explicit user merge approval; leave PR draft meanwhile. Existing live pilot and Qwen chatbot continue unchanged.

---
## REVIEW CHECKPOINT — 2026-11-23: Task 22B PR #40 corrections required (unmerged)

- **Implementation chat report independently inspected:** [PR #40](https://github.com/Reagvis/grievance-insights/pull/40), head `635d53b01d479a65110d5e252d59cde84fdfcb7d`, `feature/eoffice-source-grounding-22b` → `main`; open/draft/unmerged, GitHub initially reported mergeable. Exactly **8 changed files**: `backend/eoffice/{core.ts,documents.ts,grounding.ts,grounding.test.ts,core.test.ts,contract.test.ts}`, `docs/{EOFFICE_GROUNDING.md,EOFFICE_CONFORMANCE_MATRIX.md}`. No frontend, Cognito, grievance processing, IAM, Terraform, Gateway, deployment, or default-deny auth handler changes. Independent branch read confirmed `handler.ts` remains default-deny and protected document access unavailable.
- **Implemented in draft only:** short model-supplied source quote evidence matched against extracted document text, validation of PDF per-page locations, nonassertive sanitized HTTP Content-Disposition filename labels, optional PDF `page_number` only when evidence maps to a single verified page, numeric/extracted-scalar checks, and protected URL/link guards. No external or paid model tests. User states WSL verification not run.
- **Independent Brain review identifies TWO BLOCKING correctness issues** in `backend/eoffice/grounding.ts`: (1) `verifyNarrativeNumbers` trusts numbers in untrusted `user_input` as supporting evidence; a 9.7-million amount repeated from an officer question can be asserted despite verified documentary evidence of 1.2 million, passing the new guard. Distinguish question repetition from source-grounded factual claims; add regression. (2) `verifyExtractedFacts` accepts boolean `true` based solely on the literal token in a negated quote such as `Approved: not true`, incorrectly validating the contradictory extraction. Reject unsupported/negated boolean evidence or implement conservatively verifiable semantics; add regression.
- **Additional concern to verify:** The internal model JSON now allows up to 16 excerpts × 512 UTF-8 bytes but Bedrock output remains 1,400–1,600 tokens; assess positive 2–4 document cases and output-size failures before declaring practical pilot usability. Grounding cannot prove semantic entailment of arbitrary prose; must not be represented as a guarantee of factual correctness.
- **GitHub review:** Blocking feedback posted via [PR #40 review](https://github.com/Reagvis/grievance-insights/pull/40#pullrequestreview-6022246820), review ID `6022246820`, action **COMMENT**, because GitHub prohibits requesting changes on one's own PR under the connected account. This is **not approval**. Do not merge/deploy before fixes, new source review, owner-reported focused WSL verification and explicit owner approval.
- **Next action:** Send the findings to Task 22B implementation chat, ask for minimal focused corrections and updated draft PR head. Reinspect diff before WSL tests; no whole-suite reruns, no GitHub Actions, no paid Bedrock or real eOffice credentials. Existing live signed-in Grievance Insights pilot and working Qwen chatbot remain unaffected.

---
## MILESTONE — 2026-11-23: Task 22A PR #39 merged (code only, not deployed)

- **Explicit user approval:** The owner replied “yes i approve” to the Brain chat's proposal to merge PR #39 **without deploying anything** and then proceed to Task 22B.
- **GitHub merge confirmed:** PR [#39](https://github.com/Reagvis/grievance-insights/pull/39) is `closed`, `merged:true` using a normal merge method; merge commit `60ad4305cade5170c2af2a68b9eb41f5f6888921` on `main`. Exact reviewed PR head `ece27b6609749e4e66fe5d19c5d9f26ace729bcd`. Merge commit title contains `[skip ci]`. No GitHub Actions dispatched or tests repeated by Brain; no AWS deployment or paid Bedrock inference.
- **Post-merge verification:** GitHub `main` HEAD was independently observed at `60ad4305...`. Comparison with pre-merge `main` `5e4067860bf22b10648858f380a38d95f486783b` shows only four paths: `backend/eoffice/contract.test.ts`, `backend/eoffice/core.ts`, `backend/eoffice/schema.ts` and `docs/EOFFICE_CONFORMANCE_MATRIX.md`. The merged `backend/eoffice/handler.ts` still has `authorize: async () => null` and a protected document credential resolver that throws. Therefore production eOffice API remains **unexposed/fail-closed**, and no legacy Grievance Insights pilot source or infrastructure was changed by this merge.
- **Prior user-reported WSL verification (same reviewed head):** targeted eOffice Vitest 44/44 across 3 test files; backend TypeScript typecheck passed. This does **not** establish full government eOffice compatibility or deployed behavior.
- **Next implementation assignment — Task 22B:** Improve eOffice document and source-evidence reliability before tackling government authentication: (a) trustworthy source titles/page provenance from the existing exact two-field `document_id`/`download_url` input without fabrication, (b) grounded model output and reference validation to mitigate model self-attribution limitations, (c) robust bounded document parsing/format handling with explicit 422 for unsupported/oversized/unreadable material, (d) focused mocked adversarial/regression tests including protected URL confidentiality. Reassess security implications and avoid oversized prompts, hidden truncation or unnecessary persistent storage. Keep this as a separate, focused draft PR; no real government credentials, auth bypass, AWS/IAM/Terraform changes, production routes, full-suite test repeats, paid model inference or deploy. Coordinate any decisions about schema, chat-state, malware controls, OCR/timeout onboarding with later workstreams.
- **Release invariant:** Live signed-in pilot Qwen chatbot and all existing Cognito, owner isolation, uploads, S3 data, ingestion/OCR, analysis, reporting and frontend must remain operational. Merge of the eOffice contract does not authorize deployment. The official government authentication and protected-file specification is still scheduled last.

---
## CHECKPOINT — 2026-11-23: Task 22A PR #39 WSL verification PASSED; code-only merge eligible

- **Reviewed PR:** [#39](https://github.com/Reagvis/grievance-insights/pull/39), exact head `ece27b6609749e4e66fe5d19c5d9f26ace729bcd`, four focused changed files: `backend/eoffice/contract.test.ts`, `backend/eoffice/core.ts`, `backend/eoffice/schema.ts`, `docs/EOFFICE_CONFORMANCE_MATRIX.md`. PR remained open/draft/unmerged at last check. Default-deny `backend/eoffice/handler.ts`, existing pilot code, AWS and CI settings are untouched.
- **Developer-supplied WSL execution evidence (2026-11-23):** clean worktree created at `ece27b6`; `npm ci` succeeded, adding 107 packages and reporting 0 audit vulnerabilities. Focused `npx vitest run backend/eoffice/contract.test.ts backend/eoffice/core.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000` **passed 3/3 test files, 44/44 tests** (23 core, 12 contract, 9 schema). `npm run backend:typecheck` ran `tsc -p backend/tsconfig.json` and exited without errors. This is **operator-provided local terminal output**, not independently executed by Brain; no complete rerun of full test/build suites.
- **Nonblocking warnings:** Existing Rolldown `INVALID_ANNOTATION` at `src/data/demoGrievances.ts` and Vite native config import-extension warnings appear in log but did not fail tests/typecheck; unrelated to eOffice PR #39.
- **GitHub source/integration review:** Brain independently inspected PR's complete four-file patch and original eight-page PDF. No blocking issue was found in changed code; existing known open onboarding/security/grounding work is separately tracked. After a briefly inconsistent mergeable result, GitHub REST returned `mergeable:true`, `mergeable_state:clean`. At that point `main` had advanced by one documentation-only `docs/BRAIN_HANDOVER.md` commit, not overlapping PR paths. The integration team should recheck mergeability at time of actual merge.
- **GitHub review follow-up:** Brain submitted verification **COMMENT** on PR #39, review ID `6021725226`, noting WSL pass and recommendation **eligible for owner-authorized code-only merge**. Previous review ID `6021520665` covered the source audit. Do not interpret comment as an automatically executed merge or deployment.
- **Current decision:** Do **not** repeat tests or deploy. Await explicit owner authorization before marking draft ready or merging PR #39. Existing live pilot and Qwen chatbot remain protected; eOffice handler still default-deny/unexposed. Task 22B should tackle document grounding/source-reference reliability and security issues separately, continuing government auth last.

---
## CHECKPOINT — 2026-11-23: Task 22A PR #39 independently source-reviewed; WSL verification pending

- **Implementation PR:** [#39](https://github.com/Reagvis/grievance-insights/pull/39), head `ece27b6609749e4e66fe5d19c5d9f26ace729bcd`, base `main`, **draft/open/mergeable and unmerged** when checked. Four files only: `backend/eoffice/contract.test.ts` (new), `backend/eoffice/core.ts`, `backend/eoffice/schema.ts`, `docs/EOFFICE_CONFORMANCE_MATRIX.md` (new). No application pilot frontend/legacy API, auth handler, AWS, IAM, infra or workflow file changes.
- **Actual source-level changes:** `validateExtraction` now normalizes missing/empty/whitespace-only optional nullable string fields to `null`; required fields continue returning 422 when unavailable, malformed values return provider error. `createEofficeApi` rejects non-positive, fractional or nonfinite `page_number` metadata before producing references. New mocked tests cover API envelopes, error and provenance shapes, fail-closed handler and four adapted specification examples. Mock PDF examples omit unavailable optional chat-history mechanisms intentionally.
- **Independent Brain review:** Source diff and conformance matrix checked against the user-supplied original eight-page Phase 1 v2.0 PDF. No blocking defect found *in these four changed files*. Review **COMMENT** submitted on GitHub PR #39 (review ID `6021520665`); not an approval of integration or release. Source/mock coverage does not demonstrate Qwen factual grounding, true source titles or page provenance, live protected access, malware defenses, official auth, or AWS behavior.
- **Verification state:** Implementation chat did **not run tests**. Focused WSL tests and backend typecheck are **pending**: `npx vitest run backend/eoffice/contract.test.ts backend/eoffice/core.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000`; `npm run backend:typecheck`, at exact PR head after safe `git fetch`/worktree checkout and `npm ci` if necessary. No GitHub Actions or paid Bedrock. Do not merge, expose or deploy before actual results and explicit approval.
- **Ongoing work order:** Complete non-government-auth API contract and hardening first; defer actual official government auth/document credential integration to final gated stage. Existing signed-in Qwen chatbot and grievance dashboard are live and must be preserved.
- **Next immediate action:** Owner runs above focused checks in WSL and supplies terminal results; Brain then decides if PR #39 can be merged safely or needs correction, and scopes Task 22B. Existing eOffice production handler remains fail-closed and unexposed.

---
## WORKING PLAN — 2026-11-23: eOffice implementation delegated; official auth last

**Owner's operating decision (new):** Continue implementing **all feasible non-authentication eOffice Phase 1 v2.0 requirements first**; request and implement the separately issued government authentication/protected-document access specification **at the final integration stage**. This is a sequencing decision, **not permission to disable or improvise authentication**. Keep `backend/eoffice/handler.ts` authorization default-deny and its protected-file credential resolver unconfigured until official government specifications arrive.

**Work allocation:** Separate ChatGPT implementation chats, using the connected GitHub connector, may author focused feature branches and draft PRs. Brain chat is the independent technical lead/reviewer; it reads actual GitHub diffs and review comments, sets scoped assignments, coordinates acceptance and maintains this living file after significant milestones. User has limited Codex allowance; reserve Codex for work where it materially helps. **User's local WSL environment is the planned setting for new targeted tests, builds, final Terraform plan review and eventually approved deployment**, not GitHub Actions. Do not repeat completed tests or releases. Do not dispatch, re-enable, or trigger GitHub Actions; verify workflow-disabled status before work that could trigger automatic CI if necessary. Never infer passing test results from source code.

**Sequenced Task 22 workstreams:**
- **22A (immediate):** Existing `backend/eoffice/*` PDF-to-code contract gap audit plus minimum corrections and *new targeted* mocked/fixture tests. Produce a contract compliance matrix with exact spec sections, supported/unimplemented optional fields and onboarding limitations. No auth implementation, networking to real eOffice, new production routes, Terraform, IAM or legacy chatbot changes. Draft PR, not merge.
- **22B:** Stronger grounded source/reference behavior, bounded document extraction and realistic PDF/DOCX/text compatibility, extraction schema completeness within an explicitly supported onboarding subset; refine error behavior and refusal semantics. Keep each PR focused, mocks only; avoid silent truncation or fabricated references.
- **22C:** Decide/implement one safe, spec-permitted chat strategy (likely stateless with optional authorized history resolver) and document precisely what optional provider state tokens are not supported; no persistent state by default. Isolated mock integration harness for all four endpoints; no PDF/DOCX generated artifact URLs unless implemented with protected, expiring resources.
- **22D:** Security/operational hardening independent of the unknown government protocol: review SSRF and redirected-URL rules, bounded parsing, prompt-injection defenses, malware scanning approach, confidential logging, tenant/session separation and 12h default/24h max retention only if temporary state/artifacts exist. Document onboarding choices for formats, sizes, schema features and synchronous timeout.
- **Final integration gate (deferred):** Obtain official government authentication and protected document access specification, wire verified production adapters and separately authorized isolated infrastructure, perform focused WSL tests, reviewed zero-unintended-delete/replace plan, explicit owner-approved deployment and eOffice end-to-end acceptance. No pilot disruption.

**Operational invariant:** Existing Grievance Insights pilot (live Qwen document assistant, Cognito, owner isolation, S3 data, OCR, dashboard/analysis, endpoints, jobs and CloudFront) remains operational. Never merge or deploy eOffice by default merely because core API tests pass.

**Evidence:** Owner confirmed workflow priorities in this conversation. No feature code, tests, deployment or AWS changes made by this documentation-only decision.

---

## CURRENT DECISION — 2026-11-23: eOffice Phase 1 API work resumed (supersedes prior hold)

**User direction:** The next task is now to deliver an eOffice-integrable **pilot API that satisfies the attached `eOffice_AI_Phase1_Specification_v2(2).pdf` (Phase 1 v2.0)**. This supersedes the earlier instruction that eOffice work is on hold. **The existing live Grievance Insights website and operator-confirmed Qwen chatbot must remain unchanged.** This is a renewed development priority, **not** authorization to merge, expose endpoints, deploy AWS changes, trigger GitHub Actions, run paid Bedrock inference or bypass government authentication.

**Spec reviewed directly, eight pages, 2026-11-23:** Four HTTPS POST synchronous endpoints at `/api/v1/ai/{chat,summarize,extract,draft-reply}`, exact contract fields and standardized request_id/error behavior. Chat, extract, and draft-reply require `references` arrays; summary references optional. Extract must return full declared structure, nullable optional values and an error for missing required values; never fabricate. Draft text always required; generated file URL optional if a protected temporary file is actually created. Chat state may be stateful or stateless as agreed at onboarding. Auth is **explicitly in a separately issued government specification not yet provided**; `user_id` alone is not authentication. Department/user/session isolation, secure document retrieval, SSRF/prompt-injection/malware defenses, confidentiality, human approval, and 12-hour default/24-hour maximum retention are contractual safeguards. Onboarding must agree supported schema subset, formats, sizes, endpoints, sync timeout, chat mode and authentication.

**Actual code baseline on current `main`:** PR #37 merged a testable but **unexposed and fail-closed** foundation in `backend/eoffice/*`. All four core handlers and basic contract checks exist; `handler.ts` still `authorize: async () => null`, protected document access resolver throws, and there are no eOffice API Gateway routes. The JSON Schema implementation accepts only flat scalar properties; chat does not accept context tokens and previous_context requires an injected resolver; output references rely on model-attributed IDs and are not semantically verified. Document adapter supports text/plain, Markdown, DOCX, searchable PDF, with 2 MiB/file, four-document and extracted-text/prompt limits; scans requiring OCR fail 422 on the synchronous eOffice path. No dedicated malware scanning, real eOffice auth, or deployed integration has been demonstrated. Optional PDF/DOCX generated draft artifact URLs are not implemented. These limitations require **documented onboarding agreements, validated implementations, or explicit safe errors**, not silent assertions of full compatibility.

**Task 22 acceptance gates (proposed):**
1. Contract-by-contract gap matrix and offline fixture/mocked tests for examples, method/media/IDs/errors, evidence-linked references, complete extraction and drafting. Do **not** repeat previous whole-repo tests or deployment merely to rediscover known results; run narrowly targeted verification only when the owner authorizes new implementation validation.
2. Obtain and implement the official external authentication/authorization and protected file-access specification (government protocol must not be guessed). Until then, retain fail-closed production behavior; a local mock harness can exercise API contracts safely but is not eOffice-ready authentication.
3. Set and document onboarding decisions on schema features, document formats/size, OCR strategy, synchronous timeout, permitted hosts/egress, chat context mode and enabled endpoints; ensure realistic bounded behavior without leaking/truncating content.
4. Resolve security and quality gaps: protected file credentials, tenancy/session separation, safe download/malware controls, prompt-injection resistance, truthful source references, response/schema validation, safe error/log handling, retention and officer review. No long-term eOffice content storage or unauthorized training.
5. Propose isolated eOffice-only API Gateway/Lambda/IAM changes with a verified no-unintended-delete/replace Terraform plan and a rollback path. Preserve all existing Cognito, dataset, ingestion, analysis, CloudFront, S3 and pilot routes. Require explicit authorization for any merge/deploy and focused live inference.
6. Demonstrate an end-to-end departmental eOffice-compatible request/response sequence for every enabled endpoint using official auth and protected sample documents before calling the integration complete.

**Evidence classification:** User-provided PDF directly reviewed; existing code and prior merge state reviewed through GitHub connector. No code changed or tests, deployment, paid model call or live eOffice integration executed for this decision. The live chatbot remains operator-confirmed working from prior handover.

---
  
**Canonical location:** `main`, file `docs/BRAIN_HANDOVER.md`, repository `Reagvis/grievance-insights`. Initial documentation branch `docs/brain-handover` was fast-forwarded into `main`.  
**Purpose:** durable context for a replacement project-brain ChatGPT conversation and coordination record for the current brain. This is a historical evidence ledger, not automatically synced to activity outside the conversation.

## CURRENT STATE — 2026-11-23: Qwen document chatbot live on pilot (operator-confirmed)

**Latest authoritative milestone:** The project owner confirmed in this conversation, after the AWS backend and frontend releases, that **“chatbot is working.”** This is a **manual operator confirmation of the live signed-in pilot**, not an independently captured browser transcript, load test, or a complete regression assessment. Do not describe the chatbot as pending deployment. The current live pilot is https://telangana-gov-pilot.reagvis.com/ .

- **Current objective:** Maintain the working Qwen3-32B chatbot and existing pilot website; handle defects or enhancements as specifically requested next. **Government eOffice Phase 1 API work is ON HOLD.** Its merged but fail-closed code must remain inactive; no new government integration or auth bypass.
- **Code integration:** PR [#38](https://github.com/Reagvis/grievance-insights/pull/38) was merged to `main` on 2026-11-23, merge commit `f7e871c255dc0e80f59006a468ff1c816806daff`. The feature includes `backend/analysis/chat.ts`, routing through `backend/analysis/api-handler.ts`, frontend `DocumentChatService`, and the existing Assistant → Ask interface with uploaded-file and complaint scopes.
- **Backend deployment:** The owner provided Terraform output: `Apply complete! Resources: 1 added, 1 changed, 0 destroyed.` The **targeted** plan created `aws_apigatewayv2_route.analyses["POST /api/datasets/{id}/chat"]` and updated only `aws_lambda_function.analysis_api`. Four unrelated Lambda ZIP updates from an earlier **untargeted** plan were excluded. Existing authentication, dataset, worker, and OCR Lambda resources were not changed by this apply.
- **Frontend publication:** The owner ran the signed-in AWS frontend publishing sequence (build, S3 upload, then CloudFront invalidation). Invalidation ID `I3BUSLP9SHDXMGHOKEMN1QC20R` on distribution `E3B0B5R1HAYD1J` was accepted at `2026-11-23T08:32:07.331Z` with initial status `InProgress`. A separate `Completed` response was **not supplied**, but the operator subsequently confirmed the live chatbot works, establishing practical availability. Do not claim an independently verified invalidation lifecycle status.
- **Manual acceptance signal:** “chatbot is working” (operator report). The user did not supply the precise prompts/answers, screenshots, bilingual sample, latency, citations, or evidence of all legacy flows. Therefore do **not** claim comprehensive functional certification, document-quality benchmarks, or any performance target.
- **Tests:** User earlier reported `196/197` backend tests passed in one run, with one pre-existing 5-second DOCX decompression-bomb timeout. The user separately reran the DOCX suite with `--maxWorkers=1 --testTimeout=20000` and confirmed it **passed**. Additional build/publish steps later completed to CloudFront invalidation, but a complete post-last-frontend-change test log was not provided. **The owner explicitly requested “no tests to be run again”; do not request repetitive automated test runs without renewed authorization.** No manual GitHub Actions runs were started by this assistant.
- **MVP scope and limitations:** Qwen3-32B on Bedrock `ap-south-1` handles questions, multi-turn follow-ups, summaries, emails, official file notings, draft letters, key points, solutions, and translations, grounding in authenticated S3 source records. Original uploads remain unchanged. Whole-file requests are bounded to at most 40 records/24 KB source JSON; larger files require selecting a specific complaint. Source/context limits fail explicitly without truncation. Output is proposed text for human review, not an approved government decision; correctness/citations require operator verification. The current implementation is synchronous and non-streaming. A working response does not imply arbitrary-size documents or all-grievance global analysis are supported.
- **Preserve safety:** No destructive Terraform changes; retain Cognito sessions, owner isolation, S3 source integrity, existing analysis worker, uploads/OCR, reports and summary. No eOffice route activation. No unnecessary Bedrock inference, GitHub Actions dispatch, IAM expansion, or speculative feature work.
- **Next-chat instructions:** Read this handover and current repo state; regard the Qwen chatbot as **released and operator-confirmed working**. Prior sections headed “deployment pending,” “frontend not yet published,” or “pending smoke test” are **historical snapshots superseded by this section**. Do not rebuild/redeploy or run tests merely to repeat the completed rollout. Ask what website improvement or issue the owner wants next; verify specifics before making changes. Significant future work: small branch/PR, source review, minimal blast radius, user-approved release, and update this living handover.

## 2026-11-23 priority shift — PILOT WEBSITE DOCUMENT CHAT (historical: prior to release)

- The project owner **paused government eOffice API integration**. Do not resume eOffice work or enable its endpoints unless separately requested.
- New urgent pilot requirement: the currently deterministic signed-in **Assistant → Ask** must use Qwen3-32B to answer arbitrary operator questions about an uploaded document and generate requested summaries, emails, official file notings, draft letters, key points and suggested solutions. Preserve original documents, authentication, uploads, OCR, existing AI analysis, consolidated summary and live pilot behavior.
- Merged feature: PR [#38](https://github.com/Reagvis/grievance-insights/pull/38), merged into `main` as `f7e871c255dc0e80f59006a468ff1c816806daff` with `[skip ci]`. No deployment has yet been verified. New `backend/analysis/chat.ts` adds authenticated, owner-checked, same-origin synchronous Qwen request at `POST /api/datasets/{id}/chat`, using the existing analysis Lambda and IAM boundary; frontend uses `DocumentChatService`, document/complaint scopes, and the current Ask tab. Two mocked test files and `docs/PILOT_DOCUMENT_CHAT.md` are on the branch.
- **Latest checkpoint:** The owner reports 196/197 backend tests passed, with the sole 5-second DOCX decompression-bomb test timeout subsequently passing in isolation. At the owner's explicit instruction, **do not rerun the test suite** merely to repeat this verification. The late frontend file-picker change lacks separate reported test output. On the WSL review worktree, owner reports a read-only remote-state-backed targeted Terraform plan with exactly two changes: create `aws_apigatewayv2_route.analyses["POST /api/datasets/{id}/chat"]` and update `aws_lambda_function.analysis_api`; zero deletions. Four unrelated Lambda ZIP updates in the initial untargeted plan were excluded. Saved plan: `/tmp/grievance-chat-targeted.tfplan` (machine-local, not committed). Code merged, but **no AWS apply, frontend publication, paid Bedrock call, or website smoke test has been confirmed**. No GitHub Actions workflow was manually run.
- Required next step: validate the saved targeted plan's Lambda ZIP hash against the on-disk package and confirm AWS account identity; then apply **only** that targeted plan from the existing WSL review worktree, after ensuring the intended code/artifact are current. Publish the exact merged AWS frontend build using the guarded frontend publishing role, without rerunning the test suite. Verify live pilot functionality and a single controlled Qwen request. No claim of deployment until actual AWS CLI/Terraform outputs and smoke tests are supplied. **Do not treat GitHub Actions as enabled without checking; never manually trigger CI.**
- MVP limitation: whole-file questions require a bounded context (40 records / 24 KB source JSON); larger datasets require opening a specific complaint. The code returns explicit errors rather than silently truncating documents. The frontend Ask selector now supports switching across ready uploaded files. The Qwen output is a human-review draft, not an official decision.

## Pilot Qwen backend rollout checkpoint — 2026-11-23

- The developer reports a successful apply of the previously reviewed **targeted** AWS Terraform plan from the WSL review worktree: `Apply complete! Resources: 1 added, 1 changed, 0 destroyed.` The plan contained exactly `aws_apigatewayv2_route.analyses["POST /api/datasets/{id}/chat"]` (create) and `aws_lambda_function.analysis_api` (update). No other Lambda update was applied in this targeted operation.
- Terraform output reports the same application URL, API ID, distribution, frontend bucket and Cognito resources as the existing pilot. This is **user-reported deploy output**; no independent AWS operational validation or authenticated Qwen inference was performed in this chat.
- **Frontend has not yet been published** for the new Qwen Assistant. Next: build the reviewed frontend from the merged feature commit in the WSL review worktree using `npm run build:aws` (build only, no test reruns), upload hashed assets first, static files without `--delete`, index last, and create a single CloudFront invalidation for `E3B0B5R1HAYD1J`. Verify the AWS account and the reviewed source revision. The frontend GitHub OIDC role is trust-restricted to a GitHub environment and may not be directly assumable from local AWS CLI; use an already authorized AWS credential/profile with narrow S3 publish and CloudFront invalidate permissions.
- After frontend upload, verify the existing pilot login, browse/uploads, existing AI analysis, and a single small Qwen document question/draft; note the Bedrock inference cost. Leave eOffice inactive. Developer explicitly requested **no more automated test runs**.

## Frontend publication checkpoint — 2026-11-23

- Developer reports the frontend publication script reached a successful CloudFront invalidation creation after uploading the AWS-mode build and S3 assets. Invalidation ID `I3BUSLP9SHDXMGHOKEMN1QC20R` for distribution `E3B0B5R1HAYD1J`, created `2026-11-23T08:32:07.331Z`, initial state `InProgress`. That state **does not prove invalidation completion**.
- Backend targeted Terraform apply was earlier reported successful: one API Gateway route created and only the analysis API Lambda updated. PR #38 code is merged into `main`.
- Pending checkpoint: confirm invalidation `Completed`, sign in to live pilot and send a small document-grounded Qwen prompt, verify answer and follow-up as well as intact legacy functionality. Do not claim end-to-end success from invalidation creation alone.
- Developer does not want any more automated test reruns; do not request them again. Manual live smoke verification is appropriate; one Qwen inference incurs a small Bedrock charge. eOffice remains paused.

## READ FIRST — recovery instructions

You are taking over the independent technical lead / reviewer role for the **existing Grievance Insights AWS pilot website**. Read the **CURRENT STATE** section at the top and independently inspect current GitHub state. Qwen chatbot has been operator-confirmed working; eOffice Phase 1 integration is paused, so do not chase the government specification unless the owner resumes that work. Never treat historical commit/deployment snapshots as current without checking; continue from actual decisions, not a fresh redesign.

**Hard instructions:** The developer explicitly forbids running or triggering GitHub Actions due to billing; do not initiate, rerun, or deliberately trigger CI. Do not claim tests pass without real output. Do not invent eOffice authentication/protected-file-access protocol, and do not expose fail-closed handlers. Do not merge, deploy, or perform destructive changes to AWS/Terraform without an explicit task and reviewed safety checks. Preserve current dashboard, user data, Cognito/auth, existing Bedrock pipeline and Terraform remote state.

**Current top priority:** Maintain and improve the **working live Qwen-powered pilot website chatbot** as the owner directs. The chatbot rollout is complete according to the operator's manual confirmation. Government eOffice API integration remains paused. This is one existing adapted product, not a replacement app or unrelated architecture.

## Non-negotiable release invariant — existing pilot must continue unchanged

**Confirmed directly by project owner on 2026-11-23:** *Whatever we do, the existing pilot should continue to work as is.* This is a **release-blocking acceptance criterion**, not merely a preferred design principle.

- Any eOffice code must be strictly additive and isolated. The currently deployed Grievance Insights dashboard, its existing API paths, dataset imports, Cognito/admin authentication, Bedrock grievance analysis, S3 data, DynamoDB/SQS processing, downloads, live URL and existing user workflows must retain their current behavior and availability.
- **No breaking changes** to existing API routes, response shapes, permission models, environment settings or IAM policy. Do not repurpose, remove or overwrite existing AWS resources. Keep the eOffice provider authentication separately fail-closed until the actual government protocol is obtained.
- **Merging feature code is not authorization to deploy.** Preserve the current deployed application and infrastructure. Review the exact diff for shared-module changes (notably `backend/analysis/aws-http.ts`), check existing automated regression tests locally, and verify all dashboard flows against the current pilot before any change to its deployment.
- If AWS integration is later authorized, require a reviewed Terraform plan with **zero unintended deletes/replacements**, independent eOffice isolation/authorizers/IAM, rollback path, and a pre-/post-deployment smoke test checklist on the **existing production pilot**. A deployment must be postponed if preserving existing functionality cannot be demonstrated.
- Do not use new eOffice functionality to interfere with currently deployed capacity, OCR, dashboard, analysis or authentication. Do not enable paid Bedrock calls for testing without explicit authorization.
- When PR #37's merge conflict or GitHub `mergeable:false` is addressed, review the exact resolution and the impact on all existing behaviors. No force pushes or speculative shortcuts.
- Continue to honor the developer's restriction: **no GitHub Actions runs**; the developer reports CI disabled. Use local test and build output instead.

This criterion overrides any prior assistant suggestion to merge or deploy simply because eOffice contract unit tests pass. Maintain it in all future plans, code reviews, handovers and release decisions.

## Latest milestone — eOffice API foundation merged without deployment (2026-11-23)

- **User explicitly approved** integrating the locally verified eOffice Phase 1 API foundation into `main`, with the non-negotiable condition that the **existing live Grievance Insights pilot continue operating exactly as before**.
- PR [#37](https://github.com/Reagvis/grievance-insights/pull/37), reviewed head `7e738913d1f07601a795463b65bb32e26d3cfaac`, was marked ready for review and **merged successfully** as `ad5aa3bea4918139d359ee9c455edcf63513357c`. GitHub confirmed `merged:true`; normal merge method, no force pushes. At the time of merge, GitHub reported the branch `mergeable:true` and `mergeable_state:clean`; diverged history was documentation-only and did not present actual conflicts.
- Independent verification of the final integration diff: **exactly 10 files** changed: seven new `backend/eoffice/*` files, a new `docs/EOFFICE_PHASE1.md`, one change to `backend/tsconfig.json` to typecheck eOffice, and the optional `timeoutMs` parameter in `backend/analysis/aws-http.ts` (existing service defaults unchanged). No changes to `src/`, `infra/`, API Gateway routes, Lambda packaging/deployment config, dashboard, existing authentication setup or deployed AWS resources.
- Checked `backend/eoffice/handler.ts` on merged `main`: `authorize: async () => null` remains. Protected document credential adapter also fails closed. **No eOffice endpoints are exposed; no deployment was performed**, and no live Bedrock inference was requested.
- User reported that all supplied local WSL tests passed on the final PR head. No independently captured test log was supplied for that final run. Tests were **not rerun after this code-only merge**. An eOffice-compatible production integration remains blocked by the separate official government authentication/protected-file-access specification.
- GitHub Actions: user confirmed CI disabled; merge commit title included `[skip ci]`. This brain chat did **not** manually start or rerun workflows.
- Next: keep existing pilot untouched. Obtain official eOffice authentication/document-access details, decide tenant authorization and controlled document egress, assess semantic citations and realistic synchronous latency. Only then plan isolated infrastructure/API Gateway wiring and carefully review a no-unintended-delete/replace Terraform plan and existing-pilot pre/post smoke tests. Any future deployment requires separate explicit user authorization.

## Previous checkpoint — user-reported local verification (2026-11-23)

- Developer confirms: **"all tests ran successfully"** after running the verification steps supplied for eOffice PR #37 at head `7e738913d1f07601a795463b65bb32e26d3cfaac`. Treat this as a **user-reported local WSL pass**, not an independently observed terminal transcript; exact per-command counts/logs were not pasted. Previous failure at `0d93255...` was corrected and now reported resolved in the local run.
- Independent reviewer inspected the corrected `validateExtraction` branch and tests including required whitespace strings on the final PR head. No GitHub Actions run was requested or performed by this brain chat.
- Historical status before integration: PR #37 was open/draft/undeployed. **Superseded by the merged milestone above**; no eOffice deployment or authentication enablement has followed.
- Historical integration check: `main` and PR #37 previously had diverged histories. GitHub later resolved mergeability to `clean`, and normal merge succeeded; see latest milestone above.
- CI: user confirms CI workflow disabled. Do not launch/reenable/retrigger GitHub Actions; continue with local test workflow.

## 1. Developer and operating model

- Primary developer: Fellow-DevJk (this user). **They use Codex**, not Claude Code. Their colleague used Claude Code. User's Codex usage limits were exhausted.
- Separate ChatGPT implementation chats have connected GitHub write capabilities, create commits and maintain draft PRs. This brain chat independently reviews actual diffs/commits, comments on PRs, and gives precise local WSL test/deployment commands.
- User's machine: WSL shell previously displayed as vatjksre@excalibur; repository path ~/src/grievance-insights. Never assume clean working tree. Always check git status, branch and HEAD before switching or pulling.
- GitHub Actions: User insists **local-only testing**. Repo CI workflow .github/workflows/ci.yml has pull_request:main and push:main automatic triggers. **User explicitly confirms that they disabled the CI workflow** (referred to as the npm ci workflow); the connector has not independently read the workflow state. Last checked before that report, no workflows were running. Do not start/rerun Actions. Documentation-only main updates should use `[skip ci]` commit messages as an additional safeguard. Deployment workflows use workflow_dispatch, not automatic triggers.
- Maintain this living document *during subsequent turns* after meaningful milestones by updating this same file via GitHub connector, then verify the remote commit. This is not an asynchronous service, scheduled job or cross-chat automatic sync. Do not give the developer downloadable copies in place of repository updates. Keep facts, hypotheses, pending work and verified/tested states separate.

## 2. Repository and production architecture

- GitHub: https://github.com/Reagvis/grievance-insights
- Pilot URL: https://telangana-gov-pilot.reagvis.com/
- AWS region: ap-south-1, account ID in deployment workflow 134857759074.
- Bedrock model: qwen.qwen3-32b-v1:0 (Qwen3-32B).
- Stack: TypeScript AWS Lambda/API Gateway, S3, DynamoDB, SQS, Bedrock, Terraform; React/Vite dashboard, private frontend S3 behind CloudFront.
- Main source areas: backend/analysis (Bedrock/inference/job orchestration), backend/datasets (private datasets/API), backend/ingest (multiformat text/PDF/DOCX/OCR), backend/auth, src (dashboard), infra (AWS).
- Remote Terraform state: S3 bucket grievance-insights-pilot-134857759074-tfstate; state key grievance-insights/pilot/terraform.tfstate; region ap-south-1. NEVER run an uninitialized/new local Terraform state against production.
- Frontend bucket: grievance-insights-pilot-134857759074-frontend. CloudFront distribution: E3B0B5R1HAYD1J.
- Existing deployment recipes: .github/workflows/deploy-infra.yml and .github/workflows/deploy-frontend.yml. Can be translated to local Terraform/AWS CLI workflow after confirming AWS identity and real plan. No need to fix GitHub Actions billing to deploy locally.
- User urgently wants current 2,000-record and seven-format features LIVE on the existing AWS pilot, no new staging account. However **actual live AWS deployment of those features remains unverified** in this brain chat. Main-branch merge is not deployment confirmation. Never apply an unreviewed plan, replace/destroy existing resources, or incur high-volume Bedrock charges.
- Main incorporated the documentation-only handover by fast-forward from `900402f2c37008df790a6da9bee75237779eefd8` to `e9625eab058c23c5d3e42ce539855ae6aa802b96` on 2026-11-23; subsequent documentation edits also advance main. Always recheck HEAD rather than treating this historical SHA as current.

### Task 19 — capacity (merged PR #27)

- 2,000 records / approximately 20 MiB accepted CSV/JSON/JSONL.
- Immutable 50-record S3 index chunks, bounded AI prompts/record results and retrieval pagination, checkpointed inference/retry and JSON export.
- Large 19.49 MiB stress test measures indexing, S3 I/O and process RSS in mocked Vitest environment. Do not equate Vitest RSS to measured AWS Lambda peak memory.

### Task 21 — seven formats (merged PR #28)

- TXT, MD, DOCX, CSV, JSON, JSONL and PDF; Telugu+English Tesseract OCR for scanned PDF.
- Existing scanned PDF extraction uses SQS async Lambda worker, not allowed for synchronous eOffice Phase 1 endpoints.
- PR #27 and #28 had merged into main when checked on 2026-11-23. Existing Grievance Insights dashboard and Bedrock analysis must remain unaffected by eOffice changes.

## 3. Government eOffice Phase 1 v2.0 specification

Authoritative document: eOffice_AI_Phase1_Specification_v2.pdf, 8 pages. The originating chat received the PDF; a successor chat must access the PDF directly via Project files or an upload. Do not substitute this handover for exact spec text.

Goal: implement an eOffice compatibility API in this *existing* pilot. Four task-specific POST JSON HTTPS endpoints at /api/v1/ai:

1. /chat: mandatory UUID request_id, session_id, nonempty user_input; user_id for audit/context; optional documents and prior chat context; response answer (Markdown) and references array, optional provider_context_token.
2. /summarize: supply actual material via context.documents or source text in user_input. Instructions alone with no documents are invalid. Response summary (Markdown); references optional when only supplied content used.
3. /extract: required context.documents and extraction_schema; output complete schema-conforming extracted_data with nullable optional fields. Never fabricate required values; unavailable required values return standardized error. References array.
4. /draft-reply: nonempty user_input, optional documents, always draft_text and references; optional generated_file_url only when actual protected temporary PDF/DOCX is created. Drafts need officer approval.

Global contract: synchronous only (no async jobs/polling/callbacks); HTTP 200 on success; echo request_id in errors when available; correct 4xx/5xx standardized body with system_error_message and user_error_message; source references identify material actually used; no protected download_url or credential disclosure; context.documents items contain exactly document_id and download_url.

Auth and protected-file access **specified separately in a government document we have NOT received**. user_id cannot establish identity. Providers isolate department/user/session data. Temporary processing data default retention 12h and max 24h; no long-term eOffice content storage/training. Prompt injection, safe file download/SSRF, source grounding, human review, response validation required. Supported file sizes, formats, schemas, synchronous timeout, chat mode and enabled tasks to be agreed during onboarding.

## 4. eOffice PR #37 (merged foundation; not deployed)

- PR: https://github.com/Reagvis/grievance-insights/pull/37
- Historical feature branch: `feature/eoffice-phase1-api`; PR #37 merged into `main` on 2026-11-23. Do not deploy or enable authentication merely because this foundation is merged.
- Initial commit: 84d09064f20d9dd2716519855af50e3954107b4d.
- First correction reviewed head: 0d93255d6d896f40a8be8e176f4b2f1167538665.
- **Current latest verified PR head at 2026-11-23:** `7e738913d1f07601a795463b65bb32e26d3cfaac` (two newer commits after 0d93255). The independent reviewer inspected the corrected validator and regression test source.
- Latest commit message: "test(eoffice): use real whitespace escape sequences [skip ci]". Two newer commits modify backend/eoffice/schema.ts and backend/eoffice/core.test.ts. GitHub code shows required whitespace-only string now maps to 422. **Do NOT call this fix locally verified until developer runs tests on new head.**
- Original review comment: https://github.com/Reagvis/grievance-insights/pull/37#issuecomment-7091205548
- Second review comment: https://github.com/Reagvis/grievance-insights/pull/37#issuecomment-7091846170
- eOffice files: backend/eoffice/core.ts, schema.ts, documents.ts, aws.ts, handler.ts, core.test.ts, schema.test.ts; docs/EOFFICE_PHASE1.md; initial change to shared backend/analysis/aws-http.ts and backend/tsconfig.json.

Implemented: all four handlers with task-specific prompts, injected Model/Authorize/DocumentSource, POST + JSON validation, UUID echo, bounded source/prompt/deadline, optional history interface, limited flat-scalar extraction JSON Schema, internally validated used_document_ids attribution, protected HTTPS document fetching with allowlist, DNS vetting, IP pinning and caller-scoped access resolver. Reuses existing Bedrock transport and searchable PDF/DOCX parser. Rejects scanned PDF OCR in synchronous eOffice path.

**Critical safety:** production backend/eoffice/handler.ts authorize callback returns null (fail-closed). No API Gateway eOffice routes or Lambda/Terraform resources have been added or deployed. Do not weaken this condition or invent government auth. Both official authorization and protected-document retrieval credentials remain pending.

Limitations: model-attributed IDs are not semantic/factual evidence; /summarize source-vs-instruction check is conservative heuristic; only flat scalar JSON Schema subset; provider context tokens not supported; protected previous_context adapter not operational; no PDF/DOCX draft artifact URLs; exact timeouts/formats/department hosts depend on onboarding; real document/network performance and malware/egress controls must be validated. Do not expand scope into async APIs, OCR accuracy improvements or a redesign.

### Review findings and verification history

Five original issues from first review: HTTP method/media enforcement; valid request-ID echo incl errors; reject obvious instruction-only summary; avoid citing all attached documents without attribution; pass authenticated principal to document retrieval. These were addressed in 0d93255... along with budget/error/URL safeguards.

At 0d93255..., actual GitHub Actions run 45113451408 executed and FAILED: Terraform job passed, overall validate failed because 1 Vitest case expected 422 but got 502. 351/352 tests passed on CI. Developer subsequently explicitly prohibited future GitHub Actions runs; do not rerun.

Root defect: backend/eoffice/schema.ts::validateExtraction treated required empty string as provider malformed output (502) instead of missing/unreadable required value (422). Requirement: null, missing, empty or whitespace-only required string -> 422; wrong type, bad JSON, unexpected fields -> 502. New 7e738... code contains the correction and an added whitespace test, **but no new passing local test result has been provided**.

## 5. Local WSL verification evidence (user-supplied)

- User's earlier runtime: Node.js v24.17.0, while former repo CI used Node 22. Whether Node 22 is now active must be confirmed with node -v if material.
- Initial default-concurrency local npm test: 342/352 passed, 10 failures. Eight were 5-second timeouts; one was capacity RSS threshold; one was eOffice 422/502.
- Attempted --minWorkers flag rejected by installed Vitest. **Never recommend --minWorkers again** without checking version.
- Working retry: npm test -- --maxWorkers=2 --testTimeout=20000. Result **350/352 passed** (31/33 files, 31.57 sec). Eight timing failures disappeared. Two remaining failures: Task19 capacity-stress incremental RSS 558,964,736 bytes above 512 MiB (536,870,912 bytes), and the same eOffice 422/502 defect at older commit.
- Isolated stress test command recommended: npx vitest run backend/analysis/capacity-stress.test.ts --maxWorkers=1 --testTimeout=30000. User reported **1/1 passed**, duration 11.64 sec. This is a genuine isolated local pass, not a full-suite or deployed Lambda benchmark.
- Frontend npm run build completed successfully in initial user logs; Vite native-loader and Rolldown @__PURE__ messages were warnings.
- **Update 2026-11-23:** User reports all requested local tests ran successfully on the corrected PR head `7e738913...`; see checkpoint above. No detailed terminal logs were supplied to this chat. No GitHub Actions are required.

## 6. Exact next steps and WSL commands

1. Developer now confirms GitHub Actions CI was disabled; optionally verify `gh workflow view ci.yml --repo Reagvis/grievance-insights --json state` when convenient. Do not manually dispatch, rerun or initiate runs.
2. **Completed:** independently reviewed PR #37 through `7e738...`, confirmed extraction regression correction, preservation of default-deny authentication and no existing-pilot route or infra changes. Merge commit `ad5aa3...` is now part of `main`.
3. Locally verify new head, avoiding dirty local branch changes. Suggested sequence:

    cd ~/src/grievance-insights
    git status --short
    git branch --show-current
    git fetch origin
    git worktree add --detach ../grievance-insights-eoffice-review origin/feature/eoffice-phase1-api
    cd ../grievance-insights-eoffice-review
    git rev-parse HEAD
    node -v
    npm ci
    npx vitest run backend/eoffice/core.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000
    npm run backend:typecheck
    npm run backend:test
    npm run lint
    npm test -- --maxWorkers=2 --testTimeout=20000
    npm run build
    npm run build:aws
    npm run backend:package

   If the review worktree exists already, reuse/update it safely; do not blindly recreate. If a full test run has the known process-level RSS flake while isolated stress passes, capture RSS benchmark output and distinguish environmental test pressure from code regression. Do not simply raise assertion threshold.

4. **Completed:** user-reported local validation; PR #37 normal merge to main after independent integration review and explicit approval. **Next:** official government authentication/protected document access onboarding; prepare but do not deploy public eOffice endpoints until separately authorized and all pilot-preservation checks pass.
5. Parallel: Verify whether Task19/21 merge is actually deployed in AWS pilot before claiming it live. Local deployment is possible after confirming AWS identity, real Terraform plan (no unintended delete/replace), and essential smoke tests; no separate staging required. This is not authorization to deploy eOffice.

## 7. Handover upkeep rules

After each material event in this conversation (PR new head, reviewed code issue, local test suite result, CI disable confirmation, auth specification arrival, safe merge, infrastructure plan/deployment), update this SAME file on `main` via GitHub connector, with the new commit SHA. Use `[skip ci]` in documentation-only commit messages. Keep historical evidence distinct from current operational state. Do not overwrite other team changes: fetch the current blob SHA and use an optimistic content update.

A successor brain chat should open:
https://github.com/Reagvis/grievance-insights/blob/main/docs/BRAIN_HANDOVER.md

Use current GitHub state, the official specification and latest local logs as authority when they differ from this snapshot. Handover was merged into `main` by fast-forward update, and no PR was created. User confirms CI was disabled; never manually start or rerun workflows.

**This handover records work and decisions; it is not a background process or a substitute for the government eOffice specification.**
