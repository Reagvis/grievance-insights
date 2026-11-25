# Pilot workbook upload and chat — Task 23B (#48)

Status: draft code, not deployed; local WSL verification required.

## Supported subset and limits

Only ordinary visible, unencrypted .xlsx tables; first physical row is the header, remaining physical rows are data (including gaps). No .xls/.xlsm, formulas (including cached formula values), macros, external relationships, connections, hidden sheets/rows/columns, merged cells, named ranges, filters, tables/drawings/charts, embedded objects, unsupported archive parts or XML declarations. Save a plain visible values-only workbook if refused. No formulas are calculated, no network access or remote content resolution. The restrictive OOXML subset intentionally refuses advanced Excel features; no compatibility claim for all Excel producers.

| Limit | Bound |
|---|---|
| Compressed bytes | 2 MiB |
| Archive entries | 100 |
| Actual inflated bytes | 8 MiB, max ratio 150:1 per entry |
| Worksheets | 8 |
| Data rows | 1,000 per sheet; 2,000 total |
| Columns | 32 |
| Cells | 16,000 including physical blanks and headers |
| Text cell | 4,000 UTF-8 bytes |
| Worksheet JSON | 1 MiB |
| Numeric lexeme | 32 mantissa digits, exponent ±100, 64 characters |

ZIP directory and local headers, contiguous entry boundaries, CRC, output cap and filename allowlist are checked. Native Node zlib (no new third-party runtime dependency), bounded XML scanner, no DTD/entity expansion. XML comments and some legitimate extensions are intentionally unsupported. Exact numeric lexemes (including exponent notation) remain strings, not IEEE-754 conversions; formats, date epoch and date serials are preserved, not Excel display-rendered. Built-in and common custom date/currency/percent styles are distinguished; unknown formats retain their code and are excluded from totals. Original date serials are authoritative; canonical grievance dates are mapped only for valid integral dates (not fictitious 1900-02-29). No claims about precision Excel already lost before saving.

## Storage and routing

Use existing owner-scoped upload/presign/finalize/list/get/delete. XLSX finalization writes private immutable raw/<id>/workbook-v1/<sheetIndex>.json objects plus source SHA-256 and physical grievance provenance, and canonical index chunks only for explicitly mapped grievance sheets. The metadata holds sheet names, row numbers, kind and dimensions. Pending/validating/failed workbooks are not selectable for chat; no public worksheet URLs. Failed writes roll back; deletion uses durable sheet manifest and removes worksheet objects, source, provenance, canonical index. Validation has a lazy timeout for recovery after interrupted Lambda. Existing IAM raw/* permissions cover these keys (source inspection only); no infrastructure edits. General tables have recordCount=0 and never enter grievance counts or summary filters; grievance IDs must be unique across the workbook, no fabricated IDs, duplicate or missing required grievance rows reject the upload. Store case IDs as text to preserve leading zeros and formatted identifiers. Numeric grievance IDs are accepted only as plain non-negative integers of at most 15 digits with General or simple integer formatting; ambiguous numeric or other non-text IDs are rejected rather than silently converted. General worksheet cells are unaffected.

GET /api/datasets/{id}?sheet=N returns one bounded typed worksheet after authentication, owner check, ready status and post-read session/owner recheck. No new endpoint. POST /api/datasets/{id}/chat adds sheetIndex and optional physical row (2..1001); both are validated, mutually exclusive with record selectors. Whole-workbook chat is refused. The UI uses sheet/row identity in its conversation key; scope changes discard history and late callbacks. Grievance record selection retains its source sheet/row in the prompt. Worksheet chat sends no client-supplied cells.

For small sheets the model receives all rows plus deterministic column summaries. Larger sheets receive complete row/type counts and exact BigInt decimal sums grouped by column and format; no partial sample is presented as complete data. Dates, unknown formats and unlike formats are not summed; numeric identifiers and percentages may not be meaningful measures. Row selection includes only that row and headers. Existing 24 KB source and 32 KB prompt limits are unchanged; oversized context receives 422 rather than silent truncation. Summary-only questions requiring detail need row selection or smaller files. The model can still misinterpret or invent numbers; deterministic arithmetic is the authoritative foundation for Task 23C, not a guarantee of model output accuracy. No chart rendering in this task.

## Verification and rollout

Focused tests use synthetic XML/ZIP fixtures, in-memory S3/metadata and injected model. Node 22 required. No paid inference. No new packages or package-lock changes. Source review confirms existing Lambda path permissions; actual packaging, cold-start and near-limit finalize latency/memory still require local/staging measurement before deployment (dataset API 512 MB/20 s, analysis API 256 MB/25 s). No deployment or full browser suites as part of this draft. Run the focused workbook, document-chat and dataset tests, backend typecheck and AWS build. Real Excel producer compatibility and authenticated browser acceptance are separate operator gates.
