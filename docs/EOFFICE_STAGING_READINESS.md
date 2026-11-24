# eOffice Phase 1 — isolated AWS staging readiness PLAN ONLY (Task 22E)

**NO DEPLOYMENT AUTHORIZED OR PERFORMED.** This is a decision and security checklist for a future, separately approved task, not Terraform/CloudFormation/CDK code, a runnable deployment procedure, or permission to use paid Bedrock inference. Source: [Issue #43](https://github.com/Reagvis/grievance-insights/issues/43); eOffice Phase 1 v2.0 §§3–6.3; current Brain handover.

## 1. Preconditions and decision gates

1. **Code-only gate:** Independent Brain review of the Task 22E draft PR, confirmed exact HEAD, passing dedicated real-HTTP WSL smoke tests, six Task 22D eOffice regressions, backend type-check, manual curl/Postman cases, and evidence that the production Grievance Insights pilot/Qwen chatbot was not changed.
2. **Owner approval gate:** A **new, explicit written approval** for staging design and resource creation. Task 22E implementation, its code-only merge and WSL smoke completion do **not** authorize staging. Specify owner, cost cap, account, region, allowed dates, allowed users and abort criteria.
3. **Security gate:** Approved isolated test identity mechanism, no anonymous public routes, explicit scope per request, synthetic data only, documented egress/retention/logging rules, approved deployment and rollback plan. The localhost fixture header \`x-eoffice-smoke-actor\` must **never** be reused as staging authentication.
4. **Government integration gate:** Government auth, protected-file access, history/retention and departmental API contract require separately supplied official specifications and approvals. Do not invent government identity mappings, download credentials or protected hostnames. Their absence prevents declaring production/government integration readiness.

## 2. Proposed isolated staging layout (not created)

- Prefer a **dedicated nonproduction AWS test account** and separately named eOffice resource stack, with strict account boundary from the working \`telangana-gov-pilot.reagvis.com\` pilot, its CloudFront routes, Lambda integrations, Cognito, data stores and alarms. If an account cannot be isolated, stop and obtain a documented alternative with network/IAM blast-radius review; do **not** extend the existing pilot API Gateway or deploy to its aliases.
- Use an **access-restricted** API Gateway stage or private endpoint, backed by an **eOffice-only** Lambda with its own minimal IAM execution role. Do not expose an unauthenticated HTTP route. Require approved staging operator identity/authorization (e.g. an independently reviewed private access/IAM test-control policy) and verify that only nominated testers can invoke it. This staging control is **not** official government authentication.
- Package only the reviewed eOffice core with **staging-only synthetic adapters** or independently approved fixtures. Never package the Task 22E loopback listener, Postman fixture selection headers, \`scripts/eoffice-http-smoke.mjs\`, or unsecured identity selection into any Lambda or public container. Production \`backend/eoffice/handler.ts\` must continue to deny authorization until government integration is implemented and independently verified.
- Restrict egress by default. Block public government endpoints and paid model endpoints until explicitly approved; prohibit genuine government document URLs, historical chats, tokens, PII, protected files or real officer identities. Use deterministic synthetic sources and an in-memory model stub for initial staging connectivity.
- Keep names, tags, secrets, alarms, identities, access logs and network controls separate from the pilot. At least label owner, purpose, environment, expiry time, cost center and deletion contact. No configuration changes are proposed to existing pilot routes, frontend, Cognito or Terraform in Task 22E.

## 3. Operational design decisions to approve before IaC

| Area | Required future acceptance |
| --- | --- |
| Network and identity | Document private operator-only ingress and explicit authorization at every layer; deny unauthenticated requests and unapproved source IPs, review gateway resource policy/WAF/private connectivity |
| API Gateway/Lambda limits | Confirm gateway integration timeout, payload-size limits and Lambda remaining time are **greater** than the core's 25-second synchronous budget with enough margin to return its HTTP 503; never allow gateway to turn bounded core failures into generic 504 before response |
| Adapter deadlines and cancellation | Implement transport-level AbortSignal/deadlines, concurrency caps and per-document pre-start checks. Task 22D currently cannot cancel already-running external work; synchronously blocking first document may exhaust time before later document starts |
| Error/body semantics | Replay the four §2 endpoint envelopes and standardized §5 errors via real staging HTTPS with UUID echo, no CORS exposure and no protected URL or secret disclosure |
| Observability | Restrict CloudWatch logs/metrics and retention, do **not** log request bodies, model prompts, document URLs/tokens or full response text; review API Gateway access-log fields and error sanitization; alert on repeated 403/422/5xx and cost |
| Confidentiality and lifecycle | No real data. If temporary state/files are later introduced, default 12-hour retention, never more than 24 hours per the specification, and enforce deletion/expiry at the storage layer |
| Cost | Owner-approved AWS Budget alert/limit for account and stack, low API/Lambda quotas, small maximum concurrency, no paid inference by default, documented estimate and stop-threshold before applying anything |
| Availability | Bound memory/CPU/concurrency, protect against oversized requests and traffic spikes, verify rate limits, request-body limits and safe failures under load |
| File and AI safeguards | Confirm malware scanning/attestation policy, actual PDF/DOCX size and OCR limits, provider logging/training restrictions, prompt-injection tests, reference-title authority and human review of official drafts |
| Public contract | Confirm departmental onboarding agreements for enabled tasks, optional stateless history and provider context token policy, supported extraction schemas and Boolean fields, maximum document count/size, output tokens and timeout |

## 4. Future rehearsal and rollback (owner-approved task only)

1. Independently review a **separate IaC PR** with a plan showing no changes to the pilot's tracked state; verify staging role permissions, encrypted resources and isolation. Confirm the current pilot's route/infrastructure state before any operation.
2. Obtain new owner approval and apply only the isolated test stack, behind private/restricted staging access. Inference must remain mocked; do not point to Bedrock, production documents or public government APIs.
3. Run the same tests over staging HTTPS using authorized staging identity, with **separate** test environments/fixtures. Verify 200 and safe 4xx/5xx responses, no public anonymous access, no persistent data, no outbound calls and accepted Gateway/Lambda timing behavior. Never import localhost test fixture headers as security.
4. Confirm pilot availability independently without modifying it; collect only sanitized test identifiers, latency and status counts, not request content.
5. **Backout:** Disable/remove staging routes or stage, revoke test identities, drain invocations, destroy the isolated stack using its dedicated state, delete temporary synthetic objects and logs under the agreed policy, and confirm the existing pilot and Qwen chatbot remain unaffected. If any pilot resource would change, stop rather than proceed.
6. Treat any proposal for government auth, protected-file access or paid Bedrock as **a new work item and approval**, not the next automatic step after staging.

## 5. Current status and unavoidable limitations

**Everything in this file is proposed.** No AWS account, stage, Lambda, IAM role, VPC, route, budget, secret, log group or model endpoint was created or modified by Task 22E. The standalone localhost harness tests only an in-process synthetic adapter and real local HTTP translation; it is not a deployment compatibility test and cannot prove government file access, official authentication, PDF processing of real uploads, model factuality, network SSRF posture under real DNS, provider confidentiality or operational capacity. Brain review and WSL socket/Postman results remain explicit prerequisites, not completed evidence.
