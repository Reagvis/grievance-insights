# Task 23 — Pilot release readiness and rollback runbook

Status: **Gate A packaging and frontend build provisionally passed under WSL Node 24; release on HOLD pending Node 22 repeat, full ZIP digest audit, remote-state plan review and separate explicit deployment approval**. Updated 2026-11-25. Scope: live Grievance Insights pilot `https://telangana-gov-pilot.reagvis.com`; not eOffice. The currently operating Qwen pilot is not to be interrupted.

## Reviewed baseline and actual software delta

- Reviewed GitHub `main` at `c91749f23138c1880d71d6e719f294e865056e22` (post-merge Brain handover). Task 23A PR #47, 23B PR #50, 23D PR #51 and 23C PR #53 all merged, **code-only**, after operator-focused testing. There has been **no Task 23 production deployment**.
- Previous live document-chat rollout was operator-reported on 2026-11-23 (merged PR #38 at `f7e871c255dc0e80f59006a468ff1c816806daff`), with successful frontend publication and observed working chat. This deployed commit is **historical operator evidence**, not live AWS revision verification; actual Lambda code SHA and S3 versions must be read before release.
- GitHub compare of the historical PR #38 merge against current main includes **no changes to `infra/**/*.tf`, `.github/workflows/*`, `package.json` or `package-lock.json`**. It does include unrelated eOffice source code: eOffice must not be deployed or routed; its production handler remains fail-closed. No new infrastructure resources or API routes are required by Task 23 *in source*, but only a remote-state-backed Terraform plan can establish actual AWS resource drift.
- **Backend code change:** `backend/datasets/core.ts` imports the XLSX parser and private per-worksheet writer/read path; `backend/analysis/chat.ts` imports per-sheet context. Their Lambda bundles must be rebuilt and deployed alongside the frontend. The shared `backend/ingest/index.ts` now imports XLSX and is referenced by the PDF/OCR extractor, so **do not assume the extractor package digest remains unchanged**. The analysis worker and auth ZIP should also be compared by digest rather than updated blindly.
- **Frontend change:** authenticated `.xlsx` upload, sheet/physical-row selection, deterministic bar/line/pie charts and exact accessible tabular values, neutral Assistant UI, and per-response client-side PDF/DOCX generation. Task 23D PDF selection geometry remains approximate; charts are **not** included in exported documents, with a visible warning.
- Existing Lambda resource configuration is unchanged in Terraform source: datasets API Node.js 22, **512 MiB / 20 s**, reserved concurrency 5; analyses API Node.js 22, **256 MiB / 25 s**, concurrency 3; analysis worker 512 MiB / 600 s; extractor 3,008 MiB / 300 s. S3 `raw/*` and existing session/owner checks remain in use. API routes already cover `GET /api/datasets/{id}` (with `?sheet=N`) and `POST /api/datasets/{id}/chat`; no new unauthenticated route is introduced.

## Gate A — operator's local artifact verification (offline, no AWS, no Bedrock)

Use a **new worktree**, not a hard reset of the live developer workspace. Install Node.js 22 and the locked dependencies. The source SHA should be the latest documentation-only descendant of the reviewed Task 23 merge; always record the actual checked-out SHA and confirm no new runtime code changes since `7503a1a74bf1f9c211c1322de2d6e53528f3746b`.

```bash
cd ~/src/grievance-insights
git fetch origin main
git worktree add --detach ../grievance-insights-task23-release origin/main
cd ../grievance-insights-task23-release
git rev-parse HEAD
node --version
npm ci --include=dev
npm run backend:package
npm run build:aws
```

`backend:package` creates deterministic archives `artifacts/{auth,datasets,analysis-api,analysis-worker,extractor}-lambda.zip`. The extractor packaging process performs a **real offline Telugu/English OCR self-check** using bundled test fixtures; it does not invoke AWS or paid Bedrock. Do not disable the packaging self-check to obtain a pass.

Report per-archive compressed and expanded sizes and SHA-256 fingerprints:

```bash
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile
from hashlib import sha256
root = Path('artifacts')
names = ('auth', 'datasets', 'analysis-api', 'analysis-worker', 'extractor')
MiB = 1024 * 1024
for name in names:
    p = root / f'{name}-lambda.zip'
    with ZipFile(p) as z:
        uncompressed = sum(i.file_size for i in z.infolist())
        bad = z.testzip()
        if bad:
            raise RuntimeError(f'Corrupt ZIP entry: {p} / {bad}')
    compressed = p.stat().st_size
    print(f'{p.name}: {compressed/MiB:.2f} MiB zipped; {uncompressed/MiB:.2f} MiB expanded; SHA-256 {sha256(p.read_bytes()).hexdigest()}')
    if compressed >= 45*MiB or uncompressed >= 200*MiB:
        raise SystemExit(f'RELEASE HOLD: {p.name} exceeds conservative direct-upload/package limits')
PY
```

These **conservative local budgets** (45 MiB compressed, 200 MiB expanded) retain headroom below Lambda's 50 MiB direct upload and 250 MiB aggregate unzipped limits. They are not a performance or cold-start guarantee. If package or OCR verification fails, stop. No need for another full regression/browser test run when the existing reviewed Task 23 source is unchanged. If a code defect is found, fix in a separate focused reviewed PR before release.

## Gate A actual operator result (2026-11-25)

The owner fetched `main` and checked out commit `74eaf5c6843091964b56701acd98d87804aebf9b` in the detached `grievance-insights-task23-release` WSL worktree. Installed 107 locked packages (0 reported vulnerabilities). Under **Node.js v24.17.0**, `npm run backend:package` generated all five Lambda ZIPs and the packaged offline OCR fixture self-check **passed at 94% confidence**. Compressed sizes from `ls -lh`: auth ~275 KiB, datasets ~1,016 KiB, analysis API ~256 KiB, analysis worker ~250 KiB, extractor ~23 MiB. The extractor packager measured exactly **22.3 MiB zipped and 59.0 MiB expanded**, SHA-256 hex prefix `e55e0e4c0f05d991`. `npm run build:aws` passed TypeScript/Vite 8.3.5 and transformed 2,117 modules; the Rolldown `@__PURE__` and Vite native-loader messages are existing nonfatal warnings.

**Compatibility qualification:** The project deploys Node.js 22 Lambdas, but the local packaging health/OCR smoke ran under **Node 24**, so this evidence does **not** yet close the required Node 22 runtime test. Next, switch this existing WSL worktree to Node.js 22 and rerun `npm run backend:package` and `npm run build:aws` (no reinstall or global test rerun), then run the five-ZIP decompressed size/CRC/SHA-256 script above. AWS Lambda `CodeSha256` uses base64 SHA-256; record that encoding or convert hex to base64 before comparing with the live inventory. **No AWS code revision, remote Terraform plan, S3 VersionId, cold-start, near-limit XLSX latency/memory or backup has been verified yet.** Gate A remains provisional and deployment remains **HOLD**.

## Gate A verified five-package audit (2026-11-25)

| Lambda | ZIP MiB | Expanded MiB | SHA-256 hex | AWS `CodeSha256` base64 |
|---|---:|---:|---|---|
| auth | 0.27 | 1.55 | `a6651ec199ffdf74517cf36092449d122d7e90b453bfec7f5faafcc64fdf27c9` | `pmUewZn/33RRfPNgkkSdEi1+kLRTv+x/X6r8xk/fJ8k=` |
| datasets | 0.99 | 5.05 | `dc1db015efe0952140c20d8420c1e9a62a506c7559c10096627ebb17accdb8d5` | `3B2wFe/glSFAwg2EIMHppipQbHVZwQCWYn67F6zNuNU=` |
| analysis-api | 0.25 | 1.35 | `47df2358e7cf029e144436c867231e79844cc614198fe0477705dbe18f422953` | `R98jWOfPAp4URDbIZyMeeYRMxhQZj+BHdwXb4Y9CKVM=` |
| analysis-worker | 0.24 | 1.33 | `7d7f6b4c025f224aab55f9325396a3ea4552dc2a52ea97b7c22c134c7ae61488` | `fX9rTAJfIkqrVfkyU5aj6kVS3CpS6pe3wiwTTHrmFIg=` |
| extractor | 22.32 | 58.95 | `e55e0e4c0f05d99117994f85813a5fb28ba98f6d357077a4a7a86abdb73a894e` | `5V4OTA8F2ZEXmU+FgTpfsoupj201cHekp6hqvbc6iU4=` |

**Operator audit passed:** Python `zipfile.testzip()` completed for all five archives without errors; all compressed and expanded sizes remain below conservative 45/200 MiB thresholds. All supplied SHA-256 hexadecimal values match the supplied AWS Base64 versions (independently verified conversion); extractor digest matches the initial self-check's SHA prefix. **Node.js 22 rerun is not evidenced by the pasted hashes** (the previously observed runtime was Node 24). Before closing runtime compatibility, record `node --version` and success of `npm run backend:package` and `npm run build:aws` under Node 22, without repeating full tests.

## Gate B — live environment inventory and remote Terraform plan (read-only with respect to infrastructure)

**Not executed by Brain.** Requires the operator's existing permitted AWS identity and remote Terraform state access. Verify the account and region first; do not copy credentials, tokens, remote state, plan JSON or private user data into chat. The Terraform plan can acquire and release a short-lived backend state lock; it must not be applied under this gate.

```bash
aws sts get-caller-identity --query '{Account:Account,Arn:Arn}'
aws --region ap-south-1 lambda list-functions \
  --query "Functions[?contains(FunctionName, 'grievance-insights-pilot')].[FunctionName,CodeSha256,MemorySize,Timeout,LastModified]" \
  --output table

terraform -chdir=infra init -input=false \
  -backend-config="bucket=grievance-insights-pilot-134857759074-tfstate"
terraform -chdir=infra validate
terraform -chdir=infra plan -input=false -out="$PWD/task23-release.tfplan"
terraform -chdir=infra show -json "$PWD/task23-release.tfplan" |
  jq -r '.resource_changes[]? | select(.change.actions != ["no-op"]) | "\(.address)\t\(.change.actions | join(","))"'
```

NOTE: `-chdir=infra` changes Terraform's working directory, not the shell's; the output path above is an absolute path in the worktree. Treat `task23-release.tfplan` as **sensitive**, keep it outside committed files and delete securely when finished. Never paste full plan contents.

**Acceptable proposed changes, subject to actual evidence:** non-destructive, in-place Lambda **code** changes limited to `aws_lambda_function.datasets_api` and `aws_lambda_function.analysis_api`; **only if the rebuilt package digest really differs**, the extractor and analysis worker may also require in-place code updates. The auth Lambda should not need a change unless an independently explained package delta exists. Reject any create/delete/replace; new API routes, new IAM permissions, bucket/table changes, Cognito, production eOffice and unexpected Lambda configuration/role/runtime/timeout changes require separate review and authorization. If the plan is empty, verify deployed CodeSha256 against newly packaged ZIPs rather than assuming the frontend alone is sufficient.

A `terraform plan` is **not** a deployment approval; save a sanitized resource/action summary for independent review. Do not run GitHub Actions or `terraform apply`.

## Gate C — rollback materials to prepare **before** an authorized deployment

- Record exact deployment identity: selected `main` SHA, five artifact SHA-256 values, current AWS Lambda `CodeSha256`, function version/LastModified and current S3 `index.html` `VersionId`. The frontend bucket has versioning enabled and noncurrent versions are retained under the currently configured lifecycle (nominally 30 days).
- Prior to applying a release, arrange a private verified backup of the **currently deployed** Lambda ZIPs via `aws lambda get-function` code-location downloads or tested published versions (requires approved AWS read privileges). Previous GitHub source ZIPs are **not** proof of the actual running Lambda binaries. Keep backups private and access-restricted.
- Retain the old versioned `index.html` and immutable hashed frontend assets; do not delete existing `assets/*`. Existing frontend publication order is hashed assets first, other static assets second, `index.html` **last**, followed by CloudFront invalidation. A rollback must restore old Lambda codes first, restore the prior version of `index.html` (and any overwritten non-hashed files), then invalidate CloudFront. Verify version IDs, backup ZIP integrity, auth, and existing CSV/PDF chat after rollback.
- Prefer rollback through a reviewed Terraform artifact change so state remains consistent. Direct Lambda code updates bypass Terraform and cause drift; only use as emergency recovery with explicit approval and a reconciliation plan. Do not automatically delete newly uploaded private datasets; discuss compatibility if restoring a backend that does not understand `.xlsx` metadata.

## Gate D — separately authorized release sequence and focused acceptance

**HOLD; nothing below has been executed or authorized by the present readiness review.** Only after Gates A–C are accepted and the owner explicitly approves deployment:

1. Confirm before-release health/status, authenticate with a dedicated synthetic pilot account, and record currently working CSV/PDF upload and document chat behavior without unnecessary paid inference.
2. Deploy reviewed Lambda packages **before** enabling a frontend UI that requires XLSX APIs. Use only an approved exact Terraform plan, no unreviewed infrastructure or IAM changes; leave eOffice disabled.
3. Publish the built frontend using the established asset-first, `index.html`-last process and CloudFront invalidation; retain S3 versions for rollback.
4. With a synthetic non-government two-sheet `.xlsx`: verify upload, sheet selection, row selection, typed Telugu/currency/date values, negative and sparse data; test that owner B cannot access owner A's dataset; unrelated chat history does not carry over between scopes. Respect conservative XLSX ZIP restrictions (some Excel features will deliberately reject).
5. Exercise a **single approved, cost-bounded** Qwen Assistant interaction if paid inference is separately authorized; otherwise restrict pre-release checks to mocked/previously tested Qwen behavior and explicitly record that live chat + chart generation remains unverified. Confirm chart values against the exact accessible table and verify PDF/DOCX with Telugu and English; inspect multipage and landscape visually. Chart images are expected to be omitted from exports with warning.
6. Verify legacy PDF/OCR queue processing, analysis job routes, dashboard, sign-out, 401/404 owner denial, CloudWatch sanitized error metrics and latency. Halt and rollback on auth exposure, unexpected plan changes, persistent 5xx, missing document chat, incorrect financial totals, or corrupt PDF/Word outputs. Do not run paid large-scale inference.

## Evidence/status matrix

| Item | Status |
| --- | --- |
| Tasks 23A/B/C/D code-only merged | **Verified on GitHub** |
| Prior operator Task 23 focused tests | **Reported passed** (32/32 23C combined; separate 23B/23D gates) |
| Task 23 AWS frontend build | **Operator reported passed** after targeted corrections |
| Infra code, deploy workflows, dependencies unchanged since historical pilot chat rollout | **GitHub comparison verified** |
| Runtime-sized Lambda ZIPs, offline OCR packaging self-check | **PASS**: five ZIP sizes/integrity and SHA-256 values audited; packaged OCR 94% on prior Node 24 run. Node22 compatibility **PENDING confirmation** |
| Realistic XLSX near-limit finalize latency/memory; browser Telugu fidelity | **PENDING** |
| Actual AWS code hashes, read-only remote Terraform plan, absence of infrastructure drift | **PENDING Gate B** |
| Live rollback binaries and S3 VersionId backups | **PENDING Gate C** |
| Real-model Qwen chart UX and authentication smoke in pilot | **PENDING separately approved release** |
| Any actual AWS deployment | **NOT AUTHORIZED / NOT EXECUTED** |

Release decision: **HOLD pending evidence**. The minimum next action is local packaging and size reporting, then review a sanitized Terraform resource/action plan and rollback inventory. No paid calls, production uploads, Terraform apply, CloudFront invalidation, GitHub Actions or eOffice changes under this document.
