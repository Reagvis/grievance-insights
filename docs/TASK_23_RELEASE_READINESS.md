# Task 23 — Pilot release readiness and rollback runbook

Status: **Gate A PASSED** (Node 22 packaging/build operator-confirmed; five ZIP integrity/size/hash checks passed); **Gate B attribute-scope review PASSED** (0 create, 5 package-only Lambda updates, 0 destroy; redundant auth republish needs release decision); **Gate C backup acquisition and direct-entry-point consistency PASSED** (all five live Lambda ZIPs, versioned HTML and 41 static assets saved; 2 direct references verified). **Release on HOLD pending auth filename-path resolution, fresh exact plan and separate explicit deployment approval**. Updated 2026-11-25. Scope: live Grievance Insights pilot `https://telangana-gov-pilot.reagvis.com`; not eOffice. The currently operating Qwen pilot is not to be interrupted.

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

## Gate B actual live AWS inventory (2026-11-25)

**Operator AWS read-only inventory PASS, remote Terraform plan STILL PENDING.** Identity returned expected AWS account `134857759074`; all five deployed functions are `nodejs22.x` with configured memory and timeout from `infra/*.tf`. The exact current-vs-new `CodeSha256` Base64 digests were recorded in [release Issue #54](https://github.com/Reagvis/grievance-insights/issues/54#issuecomment-7156896136). Brief summary:

| Lambda | Deployed-vs-artifact hash | Runtime memory / timeout | Required decision |
|---|---|---|---|
| auth-api | **MATCH** | 256 MiB / 10 s | Leave code unchanged unless plan shows justified config drift |
| datasets-api | **DIFFERENT** | 512 MiB / 20 s | In-place code candidate for XLSX ingestion; review plan and package under Node22 |
| analyses-api | **DIFFERENT** | 256 MiB / 25 s | In-place code candidate for worksheet chat; review plan and package under Node22 |
| analyses-worker | **DIFFERENT** | 512 MiB / 600 s | Identify dependency/rebuild delta; don't update blindly |
| extractor | **DIFFERENT** | 3008 MiB / 300 s | Shared ingestion module changed; confirm package delta and rollout necessity |

**Actual live frontend rollback reference:** `s3://grievance-insights-pilot-134857759074-frontend/index.html`, **VersionId `GhD4CoA8agy8Qz89LRLNUrgqp1Yuwdo5`**, last modified **2026-11-23 08:32:05 UTC**, ETag `"a9885eddf419437e0f64df337abbd320"`. This proves the old entry point is versioned; it does not prove the full old frontend or Lambda binaries can be restored. Verify version availability and retain the exact deployed Lambda packages before any deployment.

**Remaining Gate B:** The owner should confirm final Node22 local package + frontend build success, then execute the **non-applying** Terraform plan and provide only sanitized resource address/action summary from the commands above. A plan which changes anything besides reviewed Lambda code (or requires new IAM, API routes, S3/Cognito, eOffice, replacement, create/delete) is a release blocker and must not be applied. Even an acceptable plan does not authorize deployment.

## Gate B remote Terraform plan: five in-place Lambda updates (2026-11-25)

The operator reports remote-state-backed `terraform plan` completed with **0 to add, 5 to change, 0 to destroy**, and a sanitized action list of exactly `aws_lambda_function.analysis_api`, `analysis_worker`, `auth_api`, `datasets_api`, and `extractor`, each marked `update`. The plan is a private local file `/tmp/tmp.mTUItNWACh/task23-release.tfplan`; **it has not been applied**. No other changed resource addresses were reported. This confirms a nondestructive five-resource change *at action level only*, not the safety of every update attribute.

**Hard blocker: unexpected auth update.** Current auth Lambda `CodeSha256` is identical to the intended auth ZIP (`pmUewZn/33RRfPNgkkSdEi1+kLRTv+x/X6r8xk/fJ8k=`). This plan nevertheless includes `aws_lambda_function.auth_api` as an in-place update. Before approving a plan, inspect only the changed attribute names and `source_code_hash` before/after, checking for Terraform state drift, package hash mismatches or unexpected auth configuration changes. Do not infer an auth defect from an unexplained diff; do not apply, suppress or ignore the update. The other four Lambda code digests differ between currently deployed and proposed archives, but their planned changes must be limited to explicitly reviewed code updates. If plan shows changes to environment variables, execution roles, auth settings, permissions, memory, concurrency, timeout, runtime, layers or logging, pause and obtain separate scope authorization.

**Sanitized inspection command** (no values of private environment variables or full plan JSON are printed):

```bash
PLAN="/tmp/tmp.mTUItNWACh/task23-release.tfplan"
terraform -chdir=infra show -json "$PLAN" |
  jq -r '
    .resource_changes[]?
    | select(.type == "aws_lambda_function" and .change.actions == ["update"])
    | . as $r
    | ($r.change.before // {}) as $before
    | ($r.change.after // {}) as $after
    | ((($before | keys_unsorted) + ($after | keys_unsorted)) | unique
       | map(select($before[.] != $after[.]))) as $changed
    | "\($r.address)\n  changed attributes: \($changed | join(", "))\n  source_code_hash: \($before.source_code_hash // "(unset)") -> \($after.source_code_hash // "(unset)")"
  '
```

Send only its output. The plan file itself is sensitive; retain it privately and do not commit it. Gate B action summary and the unexpected auth update were also recorded in [Issue #54](https://github.com/Reagvis/grievance-insights/issues/54#issuecomment-7156996403). **Release remains HOLD**, with actual deployed Lambda rollback ZIPs, full frontend static assets and Node.js 22 packaging/build confirmation still outstanding.

## Gate B attribute-level verdict (2026-11-25): code-package updates only

The operator inspected the saved Terraform plan, without applying it. **Exactly five Lambda resources update; zero adds/deletions/replacements**. Their changed attribute keys are:

| Lambda | Changed Terraform fields | Proposed source-code hash |
|---|---|---|
| analysis_api | filename, last_modified, source_code_hash | different; matches audited new artifact |
| analysis_worker | filename, last_modified, source_code_hash | different; matches audited new artifact |
| auth_api | **filename, last_modified only** | **unchanged**, identical to live CodeSha256 |
| datasets_api | filename, last_modified, source_code_hash | different; matches audited new artifact |
| extractor | filename, last_modified, source_code_hash | different; matches audited new artifact |

**Interpretation:** \`filename\` is a **local deployment ZIP path**, \`source_code_hash\` is the provider-tracked package fingerprint, and \`last_modified\` is a derived timestamp. The unchanged authentication code hash demonstrates **no proposed auth code change**; the metadata-only filename difference explains why Terraform plans an auth update. Its exact before/after path strings were not inspected, so do not assert exactly what caused the drift. **Terraform could still submit a redundant identical authentication ZIP**. The absence of runtime/configuration/IAM/route changes clears the **attribute-scope review**, but does not prove safety of an auth republish, eliminate deployment risk or authorize applying the current plan.

Review decision: **GO to rollback-binary preparation; HOLD release**. Confirm runtime packaging/build against Node 22 (last explicitly logged Node version 24), secure exact **currently deployed** ZIPs and old frontend versions, decide explicitly how to handle the auth filename-only update (prefer avoiding needless republish via a separately reviewed strategy; never use state surgery or blanket ignores), and only then generate/review a fresh final plan. [Issue #54](https://github.com/Reagvis/grievance-insights/issues/54#issuecomment-7157048431) has the full exact digest and changed-attribute evidence.

## Gate C — rollback materials to prepare **before** an authorized deployment

- Record exact deployment identity: selected `main` SHA, five artifact SHA-256 values, current AWS Lambda `CodeSha256`, function version/LastModified and current S3 `index.html` `VersionId`. The frontend bucket has versioning enabled and noncurrent versions are retained under the currently configured lifecycle (nominally 30 days).
- Prior to applying a release, arrange a private verified backup of the **currently deployed** Lambda ZIPs via `aws lambda get-function` code-location downloads or tested published versions (requires approved AWS read privileges). Previous GitHub source ZIPs are **not** proof of the actual running Lambda binaries. Keep backups private and access-restricted.
- Retain the old versioned `index.html` and immutable hashed frontend assets; do not delete existing `assets/*`. Existing frontend publication order is hashed assets first, other static assets second, `index.html` **last**, followed by CloudFront invalidation. A rollback must restore old Lambda codes first, restore the prior version of `index.html` (and any overwritten non-hashed files), then invalidate CloudFront. Verify version IDs, backup ZIP integrity, auth, and existing CSV/PDF chat after rollback.
- Prefer rollback through a reviewed Terraform artifact change so state remains consistent. Direct Lambda code updates bypass Terraform and cause drift; only use as emergency recovery with explicit approval and a reconciliation plan. Do not automatically delete newly uploaded private datasets; discuss compatibility if restoring a backend that does not understand `.xlsx` metadata.

### Gate C safe read-only rollback archive capture

Run from the existing WSL release checkout **only with permitted read access**. This downloads **currently deployed** Lambda bytes (not rebuilt release packages), verifies each against the AWS \`CodeSha256\` value captured above, and saves the current deployed frontend HTML version. It makes **no AWS changes and invokes no Lambda functions or Bedrock**. A Lambda \`get-function\` code-location response is a **temporary bearer download URL**; the Python code keeps it in process memory and never prints it, commits it or puts it in shell command arguments.

\`\`\`bash
cd ~/src/grievance-insights-task23-release
umask 077
BACKUP_DIR="$(mktemp -d "$HOME/task23-rollback.XXXXXXXX")"
export BACKUP_DIR
python3 - <<'PY'
import base64, hashlib, json, os, shutil, subprocess, urllib.request, zipfile
from pathlib import Path

root = Path(os.environ["BACKUP_DIR"])
expect = {
  "auth-api": "pmUewZn/33RRfPNgkkSdEi1+kLRTv+x/X6r8xk/fJ8k=",
  "datasets-api": "U390XDSXyxej1DB6QNdlox7JJ31hQjz5Ph/sgIQXY3A=",
  "analyses-api": "gf3Tvkg9GLqRO9bzR9AlgZRFVDpt1F0uYzjyl6fu3vg=",
  "analyses-worker": "1wjKz383UChxmIIVYpJy0Bwevwx1gjAq+xa4kCe0R78=",
  "extractor": "VFWH0WYk0amdcl8ksO6durd5btqz6tDnJKQ9UrG4Qcc=",
}
for suffix, old_hash in expect.items():
    result = json.loads(subprocess.check_output([
        "aws", "--region", "ap-south-1", "lambda", "get-function",
        "--function-name", "grievance-insights-pilot-" + suffix,
        "--query", "{Location:Code.Location,Hash:Configuration.CodeSha256}",
        "--output", "json",
    ], text=True))
    if result["Hash"] != old_hash:
        raise RuntimeError("Live Lambda code changed since inventory: " + suffix)
    target = root / ("live-" + suffix + ".zip")
    with urllib.request.urlopen(result["Location"], timeout=120) as resp, target.open("xb") as out:
        shutil.copyfileobj(resp, out)
    digest = base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode()
    if digest != old_hash:
        raise RuntimeError("Downloaded rollback ZIP hash mismatch: " + suffix)
    with zipfile.ZipFile(target) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Corrupt deployed rollback ZIP: " + suffix)
    print(suffix + ": current deployed ZIP archived, SHA-256 verified")
print("All 5 live Lambda ZIP backups verified locally. Keep this directory private.")
PY

aws s3api get-object \
  --region ap-south-1 \
  --bucket grievance-insights-pilot-134857759074-frontend \
  --key index.html \
  --version-id GhD4CoA8agy8Qz89LRLNUrgqp1Yuwdo5 \
  "$BACKUP_DIR/live-index.html" \
  --query '{VersionId:VersionId,ETag:ETag}' --output json

test -s "$BACKUP_DIR/live-index.html"
echo "Previous frontend entry point archived locally."
\`\`\`

If \`GetFunction\` or \`GetObjectVersion\` is denied, **stop** and report only the access-denied operation; do not modify IAM or ask for broad permissions automatically. Do **not** share rollback archives or signed URLs in chat or GitHub. Before actual release, confirm that all old hashed assets referenced by this HTML are still present in S3 (including lazily loaded chunks), keep the local backup directory secure, and document a reviewed restore procedure. An old \`index.html\` by itself is not a full static-site backup. On deployment day, regenerate a **fresh exact Terraform plan** against the chosen artifact paths and review it again rather than applying a stale saved plan.

### Gate C operator recovery verification (2026-11-25)

**Read-only backup acquisition PASSED.** The owner supplied terminal output reporting five `PASS` results for **currently deployed** `auth-api`, `datasets-api`, `analyses-api`, `analyses-worker` and `extractor` ZIPs. The local backup script independently compared each downloaded archive's SHA-256 against previously inventoried **deployed** Lambda `CodeSha256` and verified all ZIP entries. Backups were stored privately under `$HOME/task23-rollback.FdtpquVQ`; the location identifies operator-local material only, not any public artifact. The versioned old `index.html` was retrieved using S3 `VersionId` **`GhD4CoA8agy8Qz89LRLNUrgqp1Yuwdo5`** with returned ETag `"a9885eddf419437e0f64df337abbd320"`, and passed the script's non-empty file check. No AWS resources were changed. Full provenance is recorded on [Issue #54](https://github.com/Reagvis/grievance-insights/issues/54#issuecomment-7157145897).

**Still outstanding before rollback is judged complete:** verify that all old `index.html`-referenced versioned or immutable assets (including dynamic JavaScript chunks, fonts and workers) remain present in the static S3 bucket; keep full backups private; prepare a separately approved, controlled restore sequence and account for pre-release XLSX datasets if a backend downgrade becomes necessary. Confirm that packaging/frontend build actually ran under Node 22, not the previously shown Node 24. Attribute-scope review of Terraform passed, but the needless `auth_api` filename-only update should not be accepted without a release decision. **Release remains HOLD pending fresh exact plan and separate explicit owner approval.**

### Gate C operator frontend static backup results (2026-11-25)

The owner confirmed the Lambda packages and frontend AWS build **passed on Node.js 22**, in addition to the earlier Node 24 logs. This is operator-attested, not a replayed Node22 raw transcript. Gate A is now **PASS** on the agreed operator-evidence standard.

Owner ran read-only `aws s3 sync` of the current private frontend bucket to `$HOME/task23-rollback.FdtpquVQ/live-frontend/` and reported **PASS**, **41 files under `assets/`**, **6.4 MiB** local disk footprint. The saved current static snapshot includes a nonempty `index.html`; a separate version-specific `live-index.html` was already recovered. These files, together with the five hashed/CRC-verified deployed Lambda ZIP archives, complete **rollback backup acquisition** without any AWS write. **Do not confuse a successful sync with a rehearsed restoration.** Existing S3 versioning and the 30-day lifecycle limit still apply.

**Minimal local consistency check (no AWS):**

```bash
BACKUP_DIR="$HOME/task23-rollback.FdtpquVQ"
cmp -s "$BACKUP_DIR/live-index.html" "$BACKUP_DIR/live-frontend/index.html" &&
  echo "PASS: saved versioned HTML matches current S3 snapshot"
python3 - <<'PY'
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit
root = Path.home() / 'task23-rollback.FdtpquVQ' / 'live-frontend'
class Assets(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = set()
    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key in ('href', 'src') and value:
                asset = urlsplit(value).path.lstrip('/')
                if asset.startswith('assets/'):
                    self.references.add(asset)
p = Assets()
p.feed((root / 'index.html').read_text(encoding='utf-8'))
missing = [name for name in sorted(p.references) if not (root / name).is_file()]
if missing:
    raise SystemExit('FAIL: missing direct HTML assets: ' + ', '.join(missing))
print(f'PASS: {len(p.references)} direct HTML asset references exist')
PY
```

This checks the index and its **direct** asset references. It does not independently prove every possible lazy dynamic import, but the sync copied all 41 currently present hashed/static assets. If equality fails, stop rather than assume the old frontend reference is safe. Keep all binaries and downloaded website files private.

**Next decision:** The existing plan proposes a redundant auth-api filename-only update (hash unchanged). Before requesting owner deployment permission, select and record a risk-managed, non-state-surgery handling of that update, rerun and inspect a **fresh exact plan** against the release worktree and current state, and record a practical restore sequence. No apply, Lambda update, frontend publish or CloudFront invalidation is authorized at this stage.

### Gate C saved frontend consistency check (2026-11-25)

Operator read-only local WSL results on private backup directory `$HOME/task23-rollback.FdtpquVQ`:

```
PASS: Saved frontend index matches deployed version
PASS: 2 frontend entry-point asset references verified
```

The versioned old `live-index.html` and the full static S3 snapshot's `live-frontend/index.html` are byte-identical via `cmp`. Both direct `/assets/` references in that HTML were confirmed present in the downloaded static snapshot, which previously contained 41 asset files (6.4 MB). Together with SHA-256/CRC verified copies of five actually deployed Lambda ZIPs, **Gate C rollback acquisition and entry-point consistency pass**. This does not test all lazy JS/CSS imports, a real restoration, deployment smoke or post-release XLSX compatibility; keep the backups private and intact.

**Next non-deploy step:** inspect the redundant authentication Lambda `filename` old/new values in the *saved*, unapplied Terraform plan. This source uses `abspath(...)` around each ZIP path, suggesting checkout location drift, but do not claim root cause until the stored path values are observed. The auth `source_code_hash` remains identical; there is no auth code/config change in the plan. Decide whether to avoid a needless auth re-publish under a separately reviewed, safe deployment approach, or explicitly accept the minor republish risk with verified rollback. A fresh exact plan and **explicit owner deployment approval** are necessary before any apply or frontend publish. No real data or paid inference is required at this gate.

## Auth filename drift explained and exceptional four-Lambda plan gate (2026-11-25)

The operator inspected the private saved Terraform plan's *authentication Lambda filename* values:

```
before: /home/runner/work/grievance-insights/grievance-insights/artifacts/auth-lambda.zip
after:  /home/vatjksre/src/grievance-insights-task23-release/artifacts/auth-lambda.zip
```

The earlier GitHub Actions runner path is now compared with a different local WSL worktree. This **fully explains the `filename` diff**, and `last_modified` is provider-computed. Authentication code `source_code_hash` remains unchanged and matches live `CodeSha256`. This is **deployment path drift, not changed auth code or configuration**. Do not republish the working auth function merely to reconcile the absolute ZIP path. Documented on [Issue #54](https://github.com/Reagvis/grievance-insights/issues/54#issuecomment-7157417646).

The safe next *planning-only* experiment is an exceptional **targeted read-only Terraform plan** for the four actual changed-code Lambdas, with the full un-targeted 0/5/0 plan retained as drift context. Terraform recommends resource targeting only in exceptional situations because dependencies may be included and unrelated actions excluded; therefore inspect **all** planned addresses/attributes and never apply without fresh exact owner authorization. This approach does not fix the persistent path drift in full plans; a longer-term path strategy should receive a separate infrastructure review, not state surgery or blanket ignoring. No Terraform files are changed by this review.

```bash
cd ~/src/grievance-insights-task23-release
PLAN_DIR="$(mktemp -d)"
chmod 700 "$PLAN_DIR"
PLAN="$PLAN_DIR/task23-four-lambda.tfplan"
terraform -chdir=infra plan -input=false \
  -target=aws_lambda_function.datasets_api \
  -target=aws_lambda_function.analysis_api \
  -target=aws_lambda_function.analysis_worker \
  -target=aws_lambda_function.extractor \
  -out="$PLAN"
terraform -chdir=infra show -json "$PLAN" |
  jq -r '.resource_changes[]? | select(.change.actions != ["no-op"]) |
  "\(.address)  \(.change.actions | join(","))"'
```

**Do not apply this plan.** Send the action summary (not the plan file). Only if it shows the expected four non-destructive Lambda code updates, request a separate explicit release decision; preserve all deployed rollback ZIPs and current frontend snapshot. If any unexpected dependencies or unrelated resource actions appear, HOLD. User must still explicitly authorize any AWS change, paid Bedrock verification, or frontend publish.

## Four-Lambda exceptional targeted plan review (2026-11-25)

The operator produced a new **planning-only**, narrowly targeted Terraform plan from the existing release checkout, saved privately at \`/tmp/tmp.YC8FC7NAeu/task23-four-lambda.tfplan\`:

\`\`\`
Plan: 0 to add, 4 to change, 0 to destroy.
aws_lambda_function.analysis_api      update
aws_lambda_function.analysis_worker   update
aws_lambda_function.datasets_api      update
aws_lambda_function.extractor         update
\`\`\`

The authentication Lambda is **absent**. This is the requested plan scope: four Lambda package updates and no additions/deletions or unexpectedly included dependent addresses. Terraform's \`-target\` warning is appropriate; it does not represent complete configuration drift. We **already reviewed the separate full plan** showing only the same four source-hash changes and a redundant unchanged-code authentication filename path drift from a GitHub Actions runner to WSL. Keep both pieces of evidence. **Neither plan has been applied.** [Issue #54](https://github.com/Reagvis/grievance-insights/issues/54#issuecomment-7157494112) records the operator result.

Before any separately approved AWS deployment, ensure this *specific saved four-target plan* uses the exact Node22-rebuilt binaries and no changed keys other than \`filename\`, \`last_modified\`, \`source_code_hash\`. Suggested safe last inspection:

\`\`\`bash
cd ~/src/grievance-insights-task23-release
PLAN="/tmp/tmp.YC8FC7NAeu/task23-four-lambda.tfplan"
terraform -chdir=infra show -json "$PLAN" |
  jq -r '
    .resource_changes[]?
    | select(.change.actions != ["no-op"])
    | . as $r
    | ($r.change.before // {}) as $before
    | ($r.change.after // {}) as $after
    | ((($before | keys_unsorted) + ($after | keys_unsorted)) | unique
       | map(select($before[.] != $after[.]))) as $changed
    | "\($r.address)\n  actions: \($r.change.actions | join(","))\n  changed: \($changed | join(", "))\n  planned SHA: \($after.source_code_hash // "(unset)")"
  '
\`\`\`

Only the names of changed fields and new package fingerprints should be shared, not the complete plan or credentials. Compare with locally rehashed Node22 ZIPs (the earlier SHA inventory may predate the Node22 rebuild). If mismatch, re-verify the ZIP locally and replan; **never apply a stale plan to different artifacts**. Prior to any apply, confirm no intervening AWS drift and ask for **separate explicit deployment authorization** covering the specific four Lambdas and subsequent frontend publish/CloudFront invalidation. Preserve the verified old Lambda ZIPs and frontend snapshot. No paid Qwen calls, GitHub Actions, protected data, or eOffice changes are permitted under the readiness gate.

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
| Runtime-sized Lambda ZIPs, offline OCR packaging self-check | **PASS**: all five ZIP size/CRC/hash audits, offline OCR 94%; Node22 packaging and AWS frontend build success separately confirmed by owner (no fresh raw Node22 log supplied) |
| Realistic XLSX near-limit finalize latency/memory; browser Telugu fidelity | **PENDING** |
| Actual AWS code hashes, read-only remote Terraform plan, absence of infrastructure drift | **PASS scope review**: live 5 Lambda hashes, full 0/5/0 package-only plan and exceptional targeted 0/4/0 Lambda-only plan checked; final targeted artifact hash validation and pre-apply AWS drift check **PENDING** |
| Live rollback binaries and S3 VersionId backups | **PASS**: 5 live Lambda ZIPs SHA/CRC verified; versioned and current HTML byte-identical; 41 static assets captured, 2 direct HTML references verified. No rollback rehearsal or lazy-chunk browser smoke yet |
| Real-model Qwen chart UX and authentication smoke in pilot | **PENDING separately approved release** |
| Any actual AWS deployment | **NOT AUTHORIZED / NOT EXECUTED** |

Release decision: **HOLD pending separate explicit deployment approval**. Node22 operator packaging/build, five-ZIP integrity/hash audit, full Terraform attribute-scope review, exceptional four-Lambda targeted plan address scope, and private live rollback backup acquisition are complete. Before any release, verify the exact targeted plan's final ZIP hashes/changed keys and recheck live drift, then obtain explicit authorization. No paid calls, production uploads, Terraform apply, CloudFront invalidation, GitHub Actions or eOffice changes under this document.
