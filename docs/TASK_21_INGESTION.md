# Task 21 — seven-format grievance ingestion

Status: implemented on `feature/task-21-seven-format-ingestion` (draft PR). **Not deployed. Not verified on real AWS.**

## Formats and the one-record-per-document convention

| Format | Result | How it is read |
|---|---|---|
| `.txt` | 1 grievance | UTF-8 (BOM allowed) or UTF-16 with BOM; binary content refused |
| `.md` | 1 grievance | as TXT; markdown decoration removed from **label/heading lines only** (`## Complaint`, `**Case ID:** X`); the complaint text itself stays verbatim |
| `.docx` | 1 grievance | body text only (paragraphs, line breaks, tabs, tables). Two-column tables with a known label (`Case ID`, `Complaint`, …) become fields; other tables become `a \| b` lines. Headers, footers, comments, images and deleted tracked text are not read |
| `.pdf` | 1 grievance | text layer per page; pages with no/damaged text layer go to OCR (below). All pages are processed or the document is rejected |
| `.csv` / `.json` | 1–2,000 grievances | existing behaviour and field aliases, unchanged |
| `.jsonl` | 1–2,000 grievances | one JSON object per line, blank lines ignored, same aliases; the bad line is named in the error |

Document formats (TXT/MD/DOCX/PDF) are split into complaint and response **only** on explicit headings (`Complaint:`/`Response:`, `ఫిర్యాదు:`/`స్పందన:`, or the app's own exported note layout). Otherwise the whole text is the complaint and **no response is recorded**. Status is never inferred: an unrecognised or absent status is `unknown`, never `resolved`.
IDs: explicit `Case ID:` header → file-name stem → `DOC-<first 12 hex of the file's SHA-256>`.
One document is one dataset (one upload = one dataset). Multi-file batches are a possible follow-up.

## One dataset store for every format (Task 19)

Every format ends in the same place: Task 19's immutable 50-record index chunks (`raw/<id>/index-v1/<n>.json`), written by one function (`backend/datasets/commit.ts`) used by both the synchronous path and the extraction worker. Beside them: the untouched original (`raw/<id>/source.<ext>`) and `raw/<id>/provenance.json` (source SHA-256, per-record extraction method, per-page `text-layer`/`ocr` with OCR confidence). Limits come from Task 19: 2,000 records, 20 MiB (CSV/JSON/JSONL), and its **byte** bounds (12 KiB AI prompt / 24 KiB record) applied to every record of every format. Over-long text is rejected, never truncated.

| Format | Max upload | Notes |
|---|---|---|
| TXT, MD | 1 MiB | |
| DOCX | 5 MiB | ≤ 200 archive entries; only `word/document.xml` is inflated (≤ 8 MiB, ratio ≤ 150:1, streamed and aborted on overrun); DOCTYPE/ENTITY rejected |
| PDF | 10 MiB | ≤ 50 pages (rejected above, never truncated); ≤ 20 OCR pages; scan ≤ 40 megapixels per page |
| CSV, JSON, JSONL | 20 MiB | ≤ 2,000 records |

## PDF and OCR architecture

```
browser ──PUT──▶ private S3 (presigned)            POST /finalize (PDF)
                                                     │ pending_upload → extracting (durable, with a deadline)
                                                     ▼
                                           SQS FIFO  ──(maxReceive 3)──▶ DLQ
                                                     │                      │
                                                     ▼                      ▼
                         extractor Lambda (3008 MB, 300 s, concurrency 1)   same Lambda: marks dataset failed
                           1. per page: text layer ok / empty / damaged
                           2. empty+damaged pages → Tesseract (tel+eng) on the page's embedded image
                           3. all pages present → same parse/normalise/bounds as every format
                           4. commitDataset(): index chunks + provenance, then extracting → ready (compare-and-set)
```

* **Text-only AI.** Qwen3-32B is text-only. No image, PDF or page is ever sent to Bedrock; only the validated, bounded canonical text. OCR and AI analysis share no code path, failure handling or cost accounting.
* **Damaged text layers are not trusted.** Telugu conjuncts often have no Unicode mapping (NUL/private-use glyphs). Chrome and pdfkit output both lost letters (`సమస్యను` → `సమసను`). Any unmappable glyph sends that page to OCR; a share threshold would let single lost letters through.
* **No native code.** A scanned page is almost always one full-page image; it is taken from the PDF (pdf.js decodes JPEG/JPX/CCITT/Flate), converted to PNG and given to Tesseract (WASM). Pages that are not exactly one large image (several images, masks, vector art) are **refused explicitly**, not approximated.
* **All-or-nothing.** If any required page fails (unsupported layout, confidence < 50, empty OCR output, deadline), the document is `failed` with the page numbers; nothing partial is imported and no text is invented.
* **Engine choice.** Tesseract with `tessdata_fast` `tel`+`eng` (Apache-2.0, bundled, no runtime download). English is needed: Telugu-only garbled `Case ID` (24.9 % vs 0.0 % error on the clean fixture). `tessdata_best` crashes in the tesseract.js 7 WASM core. Textract was not used (it does not list Telugu among supported languages; not verified live). OCR quality beyond the synthetic fixtures was deliberately **not** benchmarked.
* **Reference (KYC repo).** Borrowed: bounded page count, explicit errors instead of blank fallbacks, token/usage-style per-page observability (OCR confidence in provenance). Not reproduced: first-page-only processing, blank-image fallback, swallowed model errors, VLM architecture.

### State machine

`pending_upload → validating → ready|failed` (TXT/MD/DOCX/CSV/JSON/JSONL, synchronous, within the 20 s API timeout)
`pending_upload → extracting → ready|failed` (PDF)

* Retries/idempotency: the worker acts only on `extracting` datasets, so duplicate or late deliveries are no-ops; leftovers of an interrupted attempt are cleared first (index objects are immutable); transient errors are re-thrown for SQS redelivery; terminal errors (corrupt, encrypted, over-limit, OCR could not read) fail immediately without retry.
* Recovery: DLQ message → `failed`; a lazy deadline (1 h) on read → `failed`; a failed upload is recovered by delete + re-upload. A dataset cannot be deleted while `extracting`.
* Enqueue failure returns the upload to `pending_upload`, so `finalize` can be retried.
* Logs contain only dataset ID and error type, never file names or text.

## Infrastructure changes (`infra/extraction.tf`) — additive, not applied

New: FIFO queue + DLQ (+ redrive-allow), log group, one inline policy on the **existing** worker-execution role (SQS consume/send on the two new queues, logs for the new log group), the extractor Lambda, two event-source mappings, variable `extraction_worker_concurrency` (default 1).
Changed in place: one new environment variable, `EXTRACTION_QUEUE_URL`, on the datasets API Lambda.
**Not touched:** Cognito, API Gateway, buckets/bucket policies, DynamoDB tables, existing queues, analysis resources, IAM roles/boundaries (no role is created; no existing policy is replaced).
Expected plan: 8 to add (2 queues, redrive-allow policy, log group, inline policy, Lambda, 2 event-source mappings), 1 to change (datasets API environment), 0 to destroy. **This is from reading the configuration, not from a `terraform plan` run** (the Terraform registry was unreachable from the development machine); the real plan must be produced and reviewed before any apply.

## Estimated cost (estimates, not measurements)

Idle cost ≈ $0 (queues and Lambda are pay-per-use). Per scanned PDF, assuming ~3 s/page on Lambda and 3 GB memory: ≈ $0.00005 per second ⇒ a 5-page scan ≈ $0.001, a 20-page scan ≈ $0.003; SQS and logs are negligible at pilot volume. No Textract, no Bedrock and no new storage beyond a few KB of index/provenance per dataset. Bedrock analysis cost is unchanged from today (per record) and outside this feature.

## Rollback

Everything is additive. To roll back: revert the PR and apply (removes only the new queues, worker and policy; datasets already `ready` are unaffected). Fast disable without Terraform: remove `EXTRACTION_QUEUE_URL` from the datasets API (PDF finalize then returns 503 "not available" and no dataset changes state), or disable the two event-source mappings (datasets stay `extracting` until the lazy deadline marks them failed). TXT/MD/DOCX/CSV/JSON/JSONL never touch the queue.

## Verified locally vs. requires real AWS

Locally / CI: unit and integration tests for every format through the real handler with in-memory S3/DynamoDB/SQS fakes; real Tesseract OCR on a synthetic scanned Telugu PDF through the worker; packaging with an in-package OCR self-check; Chromium tests of the upload UI (sync formats, async PDF, failure) and the dashboard; analysis pipeline with a mocked model.
**Requires real AWS (not done):** deployment plan review, SQS event-source delivery and the DLQ path on the real queue, Lambda memory/timeout/cold-start behaviour for OCR, CloudWatch observations, real S3/DynamoDB conditional writes, a limited number of real Bedrock analyses of extracted records (≤ 12 calls), JSON export from the deployed UI, and OCR on representative real scans.

## Known limitations

One document per dataset; DOCX headers/footers/comments/images are ignored; text-layer PDFs from some producers can have imperfect word spacing that cannot be detected (provenance records the method); scans must be single full-page images; OCR accuracy was verified only on synthetic printed Telugu (0–1.3 % character error with skew/blur/low-resolution) — real government scans, stamps and handwriting are untested.
