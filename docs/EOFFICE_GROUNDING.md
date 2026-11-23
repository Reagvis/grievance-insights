# Task 22B — eOffice source grounding, title provenance and PDF citations

**Status:** implementation on `feature/eoffice-source-grounding-22b`; focused verification **pending WSL execution**. Applies only to the unexposed `backend/eoffice` integration. Source: original eight-page *eOffice AI Service Integration Specification, Phase 1 v2.0*, especially §§2.1–2.4, 3.3–3.4, 5 and 6.1–6.3. No new public request or response fields, routes, AWS resources or authentication protocol are introduced.

## 1. Title provenance — no invented official title

An incoming eOffice `context.documents` entry contains **exactly** `document_id` and `download_url` (§3.3). Neither field is an authoritative title, and `document_id` must not be passed off as one.

- For a protected download, `HttpsDocuments` now retains the **`Content-Disposition` filename from the HTTPS response**, if that response is successful and accessible through the principal-scoped, allowlisted downloader. The filename is sanitized, capped at 200 UTF-8 bytes, and rejects traversal, control characters, URLs and path separators. RFC 5987 UTF-8 `filename*` is supported for safe names.
- The resulting filename is used **only as a display label** in `references[].title`. It remains server-declared metadata, not independently certified document-register metadata or an official document title.
- When absent or unsafe, the explicit non-assertive fallback is `Untitled eOffice document`. The required `document_id` still identifies the cited source. This fallback must not be described as a verified title.
- Onboarding must establish whether the protected government file endpoint reliably supplies a suitable filename, or whether an **authorized metadata resolver** can return verified titles. Do not add a third field to `context.documents` or guess a government metadata endpoint.

## 2. Source excerpts and page-level provenance

Prior internal inference envelopes only declared `used_document_ids`. That checked membership, not evidence. Task 22B adds **one internal-only** inference field `evidence`; the public eOffice response remains unchanged:

```json
{
  "text": "The departmental budget cap is 1.2 million.",
  "used_document_ids": ["doc_policy_2026"],
  "evidence": [{
    "document_id": "doc_policy_2026",
    "quote": "The departmental budget cap is 1.2 million.",
    "page_number": 3
  }]
}
```

For `/extract`, the internal `text` field above is replaced with `extracted_data`. Evidence is required for **each** cited document and must be a source excerpt (12 or more characters, at most 512 UTF-8 bytes); at most 16 entries total are accepted. The backend validates that each quote appears in the **identified document's extracted text** (Unicode NFC and whitespace/case normalization) and rejects excerpts that appear in another attached document because the attribution would be ambiguous. It rejects unknown/missing IDs, excessive entries, fabricated quotes and unsupported page claims as HTTP 502.

Searchable PDFs retain their complete extracted text **and** validated per-page text boundaries from the existing PDF parser. The verifier only emits `references[].page_number` when all cited excerpts for that document can be located unambiguously on the **same actual page**. It rejects a claimed page if that page does not contain the excerpt; when relevant evidence spans multiple pages or is page-ambiguous, the optional `page_number` is omitted. No page numbers are inferred for text/DOCX. These excerpts and per-page material are ephemeral for the invocation only.

**Important:** The quote evidence is **not** returned to eOffice as a new field; the v2.0 public `references` array still has the documented `document_id`, `title`, and optional `page_number` shape (§3.4). The quote and `page_number` supplied by a model are never trusted without matching parsed source text.

## 3. Bounded factual checks and confidentiality

- For document-grounded narrative output (chat, summary and proposed drafts), every explicit numeric token in the generated text must be present in verified source quotes or the officer's supplied `user_input`. New dates, amounts or file numbers without this literal support fail HTTP 502.
- Each non-null extracted scalar must appear **literally in a verified quote from a cited document**. This is intentionally stricter than finding the text elsewhere in an attached file. The full declared extraction object and null optional fields remain governed by the existing `validateExtraction` check; absent/unreadable mandatory values still return 422 (§2.3).
- Generated content must not include a protected `download_url`, the protected host, a recognizable protected path or a long query-token value, including percent-encoded representations. Newly generated external HTTPS URLs not present in the officer's instruction are rejected because this eOffice module has **no onboarded authorized external knowledge repository**. Confidentiality failures use generic public 502 responses, never quote sensitive text.
- Source requests remain exact two-field document objects. Per-file 2 MiB and 24 KB extracted-text limits, four-document cap, aggregate source 24 KB and prompt 32 KB, PDF page parser limits, UTF-8 validation, DOCX ZIP defenses, and 25-second handler limit are preserved. Files that require OCR, are unsupported, corrupt, too large, or cannot be handled within sync limits fail explicitly: **no truncation, partial page omission or asynchronous fallback**.

## 4. Deliberate limitations and departmental onboarding

These measures are **not semantic fact verification**: a model can quote real but irrelevant text, misinterpret it, omit a document it relied upon or construct false nonnumeric conclusions. Numeric-token presence does not prove that the associated calculation or claim is correct. Quoted text can still contain misleading statements. Human checking of official responses and extracted forms remains mandatory (§§2.3, 2.4, 6.1–6.2).

**Conservative rejection tradeoff:** Exact-string validation of extracted scalars does not presently support inferred booleans, normalized dates, reformatted currencies, arithmetic, paraphrased extracted values or OCR text recovery. The model must provide exact supporting excerpts; unsupported transformations return a standard error rather than fabricate values. A metadata filename is not a verified title. Detailed security controls, malware scanning, prompt-injection and provider-side logging/retention reviews remain separate obligations (Tasks 22C/22D and integration gate).

**Onboarding decisions required** (§6.3): trusted title/metadata source, allowed hosts and protected access credentials, format/size limits, PDF/OCR policy, sync budget, exact vs transformed extraction conventions and supported JSON Schema subset, enabled tasks and stateless chat behavior, safe external knowledge repositories (if any), content safety/malware scanning, log policy and temporary retention (default 12 hours, max 24 hours if storage is introduced). Official government authentication and protected-file access are **deferred**. `backend/eoffice/handler.ts` stays default-deny.

## 5. Focused WSL verification, no Actions or Bedrock

From the developer's existing WSL repository (inspect `git status` first; choose a different path if the suggested worktree already exists):

```bash
cd ~/src/grievance-insights
git status --short
git fetch origin
git worktree add ../grievance-insights-eoffice-22b origin/feature/eoffice-source-grounding-22b
cd ../grievance-insights-eoffice-22b
node -v
npm ci
npx vitest run backend/eoffice/grounding.test.ts backend/eoffice/core.test.ts backend/eoffice/contract.test.ts backend/eoffice/schema.test.ts --maxWorkers=2 --testTimeout=20000
npm run backend:typecheck
```

No full-suite reruns, CI dispatch, paid Bedrock inference, government document access or production deployment. Captured WSL passing logs are required before independent Brain review can mark the PR tested.

## 6. Files and release isolation

Task 22B modifies only `backend/eoffice/` source/tests and docs under `docs/`. All legacy pilot paths, frontend, Cognito, IAM, API Gateway, Terraform and `backend/eoffice/handler.ts` remain unchanged. Do **not** merge or deploy the draft PR without Brain review and owner approval.
