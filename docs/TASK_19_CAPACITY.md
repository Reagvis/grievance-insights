# Task 19 — 2,000-record capacity upgrade

Implementation branch: `feature/task-19-2000-record-capacity`. Release gate: **draft PR only; no deployment**.

## Implemented

- Persisted CSV/JSON files: 1–20 MiB, **up to 2,000** unique records. The existing private presigned S3 write path, exact UTF-8 parsing, strict source validation, session ownership, origin checks and immutable upload semantics remain in place.
- Bedrock analysis: all 2,000 records, with three records per SQS invocation, DynamoDB atomic cursor checkpointing after every persisted result, immutable S3 outcomes and report generation only when the validated aggregate is complete.
- Independent SQS FIFO groups: each dataset/job is its own message group. Parallelism is possible across datasets; messages for an individual dataset remain ordered.
- Retry: an administrator may retry a failed job only for recoverable queue-delivery or exhausted SQS redrive failures. A DynamoDB compare-and-set transition clears the error and increments an attempt counter; stale SQS/DLQ messages are fenced. Existing queued messages without an attempt are treated as attempt 0 for rolling compatibility. Retries continue from the durable cursor; previously written record outputs are reused, not regenerated.
- API read paths: authenticated dataset responses return at most 50 records per page; AI reports return at most 100 outcomes per page. The frontend reads all pages and verifies job/dataset identity, pagination and total count before displaying/exporting the combined results.
- Logs: per-invocation structured progress/completion and Bedrock input/output token usage counters. Never log complaint text, response text, evidence, or prompts. Existing Lambda log retention applies.
- Worker reserved concurrency: Terraform variable `analysis_worker_concurrency`, default **1** (no production increase), validated range **1–4**. For values 2–4, event source mapping maximum concurrency is set to match. A deployment request must first verify regional Lambda reserved-concurrency availability, remaining unreserved concurrency, model inference quotas, and cost limits. The existing AWS resources are not replaced.

## Testing

CI performs `npm ci`, lint, the full Vitest suite, real Chromium dashboard interactions, backend type-check, Lambda package generation, default/AWS/Pages frontend builds, and Terraform format/init/validate in all three roots.

`backend/analysis/capacity.test.ts` generates 2,000 synthetic Telugu source records and performs all 2,000 model calls through a mocked inference adapter, with persisted record outcomes, all checkpoints, complete aggregation and exact evidence validation. Additional cases exercise interrupted SQS handoff, safe attempt fencing, separate simultaneous jobs, input bounds, and repeated delivery. Frontend tests exercise reconstruction of full 2,000-record source datasets and multi-page AI reports.

## Review and deployment limitations

- This is a **simulation**. It measures software correctness and simulated throughput, not Bedrock inference capacity, regional quota, actual model quality, end-to-end AWS throughput or cost.
- The retry control intentionally does not silently re-infer all records after terminal `all_records_failed`, `dataset_unavailable` or other integrity failures. Such cases require investigation; immutable results cannot be replaced by a partial blind retry.
- The 20-MiB upload ceiling is not a guarantee that any arbitrary 20-MiB/2,000-row file will be processed within Lambda execution limits. Extremely long text records may raise inference token limits; verify representative production shape at integration review.
- Before deployment, perform a reviewed Terraform plan to confirm **zero destroys/replacements**, verify quotas, and obtain explicit authorization for controlled AWS deployment and a modest real SQS/Bedrock regression. Do not run a 2,000-record paid live inference test without explicit authorization.
- At deployment, verify CloudWatch worker progress and token usage logs, SQS DLQ depth, stalled jobs, costs and job completion. No live AWS test was performed in Task 19 development.
