# Next session handoff

## Start here

Grievance Insights is a single-organization pilot for analyzing Telugu citizen grievances and department responses. Read [ARCHITECTURE.md](ARCHITECTURE.md), [INFRASTRUCTURE.md](INFRASTRUCTURE.md), [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), [DECISIONS.md](DECISIONS.md), and [AGENTS.md](../AGENTS.md) before changing code.

The repository is `Reagvis/grievance-insights`. PRs #1–#10 are merged. The backend and AWS-mode frontend authentication are implemented in code but not deployed. Always fetch latest remote `main`, preserve unrelated changes, and use a focused feature branch.

## Implemented and deployed

- The React/TypeScript/Vite prototype supports complaint browsing, import/export, deterministic summaries, and browser-local static processing. Local development and preview also expose prototype-only Vite middleware APIs.
- AWS account `134857759074` hosts the deployed frontend foundation. Primary resources are in `ap-south-1`; the CloudFront certificate is in `us-east-1`.
- Application hostname: `telangana-gov-pilot.reagvis.com`.
- Terraform state bucket: `grievance-insights-pilot-134857759074-tfstate`. Main key: `grievance-insights/pilot/terraform.tfstate`. Bootstrap key: `grievance-insights/pilot/bootstrap/terraform.tfstate`. Both use native S3 lockfiles.
- Frontend bucket: `grievance-insights-pilot-134857759074-frontend`. It is private and intentionally empty until publication is authorized.
- CloudFront distribution: `E3B0B5R1HAYD1J` (`d2wxdkjsz0mx9d.cloudfront.net`); Origin Access Control: `E2ENVJAQ7E6UDU`.
- ACM certificate: `arn:aws:acm:us-east-1:134857759074:certificate/a4f5df92-a43a-4dde-a384-611865391489`.
- Infrastructure role: `arn:aws:iam::134857759074:role/grievance-insights-pilot-terraform`.
- Frontend publishing role: `arn:aws:iam::134857759074:role/grievance-insights-pilot-frontend`.
- Bootstrap role: `arn:aws:iam::134857759074:role/grievance-insights-pilot-bootstrap`. It is bounded to the existing bootstrap-managed roles, policies, state-bucket configuration, and bootstrap state objects; it cannot administer itself.
- The original bootstrap state remains preserved at the versioned `bootstrap/terraform.tfstate` backup object and in a protected pre-migration local copy. The separate access-seed state is also outside Git and backed up at `access-seed/terraform.tfstate`. Never initialize either stack from an empty state.
- Authentication backend code now implements login, session lookup, logout, and health endpoints. Terraform defines Cognito, DynamoDB sessions, Lambda/API Gateway, bounded runtime IAM, logs, and uncached CloudFront API routing. None of these new resources is deployed yet.

## CI and deployment workflows

- `ci.yml` runs application, credential-free Terraform, and GitHub Actions workflow syntax validation for pull requests and pushes to `main`.
- `deploy-frontend.yml` is manual, main-only, and uses the `pilot-frontend` GitHub environment plus OIDC. `PILOT_DEPLOY_ENABLED=false`; do not enable it until authentication and publication are approved.
- `deploy-infra.yml` is manual, main-only, and uses the `pilot-infrastructure` environment plus OIDC. Plan is read-only. Apply additionally requires `INFRA_DEPLOY_ENABLED=true` and the exact confirmation `APPLY`. It applies only the plan generated in that run and rejects every delete or replacement. Binary plans remain on the ephemeral runner and are not uploaded.
- `deploy-bootstrap.yml` is manual, main-only, and uses the `pilot-bootstrap` environment plus the dedicated bootstrap OIDC role. Apply requires `BOOTSTRAP_DEPLOY_ENABLED=true` and `APPLY BOOTSTRAP`; deletes and replacements are rejected.
- All deployment workflows serialize runs. Never add permanent AWS credentials or generic command inputs.
- The infrastructure workflow runs backend type-checks/tests and creates the deterministic Lambda zip before planning, so deployment never depends on a WSL-built artifact.

To operate through GitHub, verify `gh auth status`, fetch the latest `main`, create a focused branch, run local checks, push, and open a PR. After merge, select the appropriate manual workflow on `main`. Run `plan` first and review its log. Enable an apply guard only for an explicitly approved deployment, invoke `apply` with its confirmation, then return the guard to `false`. Routine hosting and bootstrap deployments no longer require local AWS credentials. Do not dispatch frontend publication before authentication is complete.

## IAM boundary and future work

The infrastructure OIDC role supports the existing state/hosting resources and now has project-scoped provisioning policies for Cognito, Lambda, API Gateway HTTP APIs, DynamoDB, SQS, private datasets/results/artifact buckets, CloudWatch Logs, two named Lambda execution roles, and Bedrock control-plane resources (PR #5). Its IAM runtime permissions boundary is mandatory for those execution roles. `iam:PassRole` is limited to the two named roles and Lambda. The Terraform deployer cannot invoke models. The frontend role still only publishes assets and invalidates distribution `E3B0B5R1HAYD1J`.

Bedrock worker invocation is authorized only for Qwen3 32B (`qwen.qwen3-32b-v1:0`) in `ap-south-1` for initial synthetic-data evaluation; streaming remains disabled. The model was verified active through the read-only Bedrock API. Pricing, quotas, and broader evaluation suitability still require review. IAM simulation confirms selected allow/deny cases but does not guarantee that all future Terraform provider API calls will succeed. When backend resources are defined, refine any action-level gaps based on their actual plans and access-denied diagnostics without broadening permissions indiscriminately.

`infra/access-seed/` is the only remaining exceptional local AWS administration path. It owns the bootstrap role and boundary so that role cannot self-administer. Do not fold the access seed into `infra/bootstrap/` or the main infrastructure role.

## Not implemented and recommended next task

Authentication API code, durable hashed sessions, Terraform, tests, and Lambda packaging are implemented but not deployed. Frontend AWS-mode login/logout and session restoration are implemented in code; dataset/result storage, queues, Bedrock workers, and application APIs are not implemented. After separately authorized authentication infrastructure deployment, verify the AWS-mode login/logout/session flow before any publication. Keep all deployment guards disabled. Do not place real grievance data in the frontend bucket; future data endpoints must independently authorize access. Keep all deployment guards disabled while work is reviewed.


## Task 15 branch / PR handoff

PR #16 (`feature/task-15-persistent-datasets`) implements private persistent AWS datasets without deployment. It adds the authenticated datasets Lambda, five HTTP API routes, DynamoDB dataset metadata, private datasets S3, browser presigned upload, strict CSV/JSON validation, AWS-mode dataset UI, and CI packaging/tests. Limits: 1 MiB, 200 rows, 5-minute upload authorization. Test CI before merging and review any runtime IAM boundary gaps only from actual deployment plans; do not edit bootstrap/access-seed or deploy as part of this PR. The current deployment permissions repair is independent. Bedrock work remains subsequent.


## Task 16 stacked analysis PR

PR #18, branch `feature/task-16-bedrock-processing`, is stacked against PR #16 `feature/task-15-persistent-datasets` at `2a27287fe4de8fa8b427046b9ee816670daca16c`. It implements an authenticated job API, FIFO SQS + DLQ, DynamoDB jobs, a bounded-role Qwen3 Converse worker with record checkpoints, strict evidence verification, private S3 report persistence, and AWS-mode frontend results/exports. Only synthetic test records; no Bedrock calls, deployment or Terraform apply. After PR #16 merges, retarget PR #18 to main and recheck its diff/CI before merge. Review the role-policy transition and scoped worker permissions in a separate, approved infrastructure plan; never edit bootstrap or access-seed during this feature.
