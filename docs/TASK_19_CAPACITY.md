# Task 19 — 2,000-record capacity upgrade

Implementation branch: `feature/task-19-2000-record-capacity`. Release gate: **draft PR only; no deployment**.

## Implemented

- Persisted CSV/JSON files: 1–20 MiB, **up to 2,000** unique records. Every newly accepted record is limited to **12 KiB UTF-8 of model prompt** (including record ID and both source texts) and **24 KiB serialized record JSON**; violations yield 422 with a row number, and nothing is silently truncated. The existing private presigned S3 write path, exact UTF-8 parsing, strict source validation, session ownership, origin checks and immutable upload semantics remain in place.
- On finalization, the service writes **40 or fewer immutable private S3 index chunks of at most 50 validated records each**, under the existing `raw/{datasetId}/index-v1/` prefix using the existing restricted IAM/S3 resources. Ready state is published only after chunk creation. Partial failures attempt cleanup; failed datasets remain deletable. The original uploaded file remains private and unchanged.
- Bedrock analysis: all 2,000 records, with three records per SQS invocation, DynamoDB atomic cursor checkpointing after every persisted result, immutable S3 outcomes and report generation only when the validated aggregate is complete. Each worker now reads just the indexed range needed for the next three records, with a 40-chunk final source pass for aggregation rather than 667 reparses of the whole 20 MiB upload.
- Independent SQS FIFO groups: each dataset/job is its own message group. Parallelism is possible across datasets; messages for an individual dataset remain ordered.
- Retry: `resume` continues interrupted queue/redrive failures from their persisted cursor/outcomes; `fresh` is an explicit administrator choice for `all_records_failed` and interrupted jobs. A DynamoDB compare-and-set increments message `attempt` and, for fresh runs, an independent `generation`, resets counters, and uses new immutable `analyses/{id}/generations/{n}/` result keys. All worker cursor/start/failure/completion updates are attempt-fenced, preventing stale in-flight messages or DLQ deliveries from corrupting a newer run. Attempts 0 continue using the existing S3 result paths and old messages without `attempt` are treated as 0 for rolling compatibility. Terminal source-integrity/deleted-dataset failures remain non-retryable.
- API read paths: authenticated dataset responses return at most 50 bounded records (up to ~1.2 MiB plus framing) from one private chunk per page; AI reports return at most 100 outcomes **and 2 MiB of JSON** per page. The frontend reads all pages and verifies job/dataset/generation identity, pagination and total count before displaying/exporting the combined results. Historical ready pilot datasets retain verbatim source retrieval even if a record exceeds the new inference budget; those records are explicitly rejected for AI analysis with HTTP 422.
- Logs: structured per-invocation progress/completion, request failure types, restart activity, and Bedrock input/output token counts, **keyed by private job UUID, message attempt, result generation and record ordinal**. Never log complaint text, response text, evidence, prompts, model output or provider error bodies. Existing Lambda log retention applies.
- Worker reserved concurrency: Terraform variable `analysis_worker_concurrency`, default **1** (no production increase), validated range **1–4**. For values 2–4, event source mapping maximum concurrency is set to match. A deployment request must first verify regional Lambda reserved-concurrency availability, remaining unreserved concurrency, model inference quotas, and cost limits. The existing AWS resources are not replaced.

## Testing

CI performs `npm ci`, lint, the full Vitest suite, real Chromium dashboard interactions, backend type-check, Lambda package generation, default/AWS/Pages frontend builds, and Terraform format/init/validate in all three roots.

`backend/analysis/capacity.test.ts` generates 2,000 synthetic Telugu source records and performs all 2,000 model calls through a mocked inference adapter, with persisted record outcomes, all checkpoints, complete aggregation and exact evidence validation. Additional cases exercise interrupted SQS handoff, safe attempt fencing, separate simultaneous jobs, input bounds, and repeated delivery. Frontend tests exercise reconstruction of full 2,000-record source datasets and multi-page AI reports. `backend/analysis/capacity-stress.test.ts` also runs the production finalizer, 40 authenticated source pages and 667 three-record mocked analysis batches against a near-20-MiB Telugu CSV using byte-accurate in-memory S3 storage; it records read amplification, timing and memory. Separate tests cover a >6-MiB single-record attack, old-dataset compatibility, fresh immutable reanalysis, AWS conditional expressions, output byte budgeting and job-level token telemetry.

## Measured 19.49 MiB benchmark (mocked AWS and model)

GitHub Actions CI on 12 November 2026, run [43177348357](https://github.com/Reagvis/grievance-insights/actions/runs/43177348357):

| Check | Measurement |
| --- | ---: |
| Synthetic CSV source | **19.49 MiB**, 2,000 unique Telugu records |
| Maximum accepted upload | **20 MiB**; 2,001 records or >20 MiB rejected |
| Record input validation | **12 KiB UTF-8 AI prompt**, **24 KiB JSON record**; no truncation |
| Full source S3 reads in simulated finalization + processing + 40 pages | **1** |
| Immutable chunk objects written | **40** |
| S3 chunk GET calls (all phases) | **773** |
| Sum of indexed S3 response bytes | **385.81 MiB** |
| Indexed read amplification vs source | **19.8×**, instead of ~707 full-file rereads in the previous implementation |
| Mocked inferences and durable checkpoints | **2,000/2,000**, **0 failures**, **667 processing chunks** |
| Authenticated retrieval | **40 source pages**; AI result pages independently byte-limited |
| Simulated finalization plus source pages | **3.17 s** in CI |
| Simulated worker phase | **4.55 s** in CI |
| Co-located test-runner RSS | **113.2 MiB baseline; 552.6 MiB peak (439.4 MiB delta)** |
| Checks | **142/142 Vitest**, **47 Chromium assertions**; lint, TypeScript, Lambda packaging, all frontend builds and Terraform validation passed |

The RSS figure is intentionally reported rather than discarded: this Vitest process co-locates the raw CSV string, raw S3 buffer, all 40 mock S3 chunks, both the dataset API and the worker, and test-runner overhead. **It is not an isolated Lambda RSS or an AWS quota result.** No SQS network latency or Bedrock inference delay is included. The controlled deployment review must verify per-Lambda peak memory and 20-second finalize latency on AWS using a representative limited-cost smoke case, not 2,000 paid model calls.

## Review and deployment limitations

- This is a **simulation**. It measures software correctness and simulated throughput, not Bedrock inference capacity, regional quota, actual model quality, end-to-end AWS throughput or cost.
- A fresh reanalysis is explicit, never automatic. Permanently invalid/different source data and deleted/unready datasets cannot be retried; new source files require a new upload. Each fresh generation incurs new inference and token charges when eventually deployed.
- The 20-MiB upload limit is a byte/storage ceiling, **not** an entitlement to submit arbitrarily large individual records. Each accepted record is independently bounded. The 12-KiB prompt budget limits input bytes but is not a measured tokenizer-specific guarantee; real model context behavior, 20-second dataset-finalization timeout and 512-MiB Lambda peaks still need controlled AWS verification.
- RSS measured by the stress test includes Vitest, the entire mocked in-memory S3 store, and source bytes in a single process; this is **not** an isolated datasets or worker Lambda RSS measurement. Simulated S3 reads do not reproduce network latency, SQS throttling or Bedrock inference duration. Do not infer AWS throughput or cost from synthetic timing.
- Before deployment, perform a reviewed Terraform plan to confirm **zero destroys/replacements**, verify quotas, and obtain explicit authorization for controlled AWS deployment and a modest real SQS/Bedrock regression. Do not run a 2,000-record paid live inference test without explicit authorization.
- At deployment, verify CloudWatch worker progress and token usage logs, SQS DLQ depth, stalled jobs, costs and job completion. No live AWS test was performed in Task 19 development.
