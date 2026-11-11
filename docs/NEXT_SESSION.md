# Next session handoff

## Start here

Grievance Insights is a single-organization pilot for analyzing Telugu citizen grievances and department responses. Read [ARCHITECTURE.md](ARCHITECTURE.md), [INFRASTRUCTURE.md](INFRASTRUCTURE.md), [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), [DECISIONS.md](DECISIONS.md), and [AGENTS.md](../AGENTS.md) before changing code.

The repository is `Reagvis/grievance-insights`. PRs #1–#6 are merged. Always fetch latest remote `main`, preserve unrelated changes, and use a focused feature branch.

## Implemented and deployed

- The React/TypeScript/Vite prototype supports complaint browsing, import/export, deterministic summaries, and browser-local static processing. Local development and preview also expose prototype-only Vite middleware APIs.
- AWS account `134857759074` hosts the deployed frontend foundation. Primary resources are in `ap-south-1`; the CloudFront certificate is in `us-east-1`.
- Application hostname: `telangana-gov-pilot.reagvis.com`.
- Terraform state bucket: `grievance-insights-pilot-134857759074-tfstate`; key: `grievance-insights/pilot/terraform.tfstate`; native S3 lockfiles are enabled.
- Frontend bucket: `grievance-insights-pilot-134857759074-frontend`. It is private and intentionally empty until publication is authorized.
- CloudFront distribution: `E3B0B5R1HAYD1J` (`d2wxdkjsz0mx9d.cloudfront.net`); Origin Access Control: `E2ENVJAQ7E6UDU`.
- ACM certificate: `arn:aws:acm:us-east-1:134857759074:certificate/a4f5df92-a43a-4dde-a384-611865391489`.
- Infrastructure role: `arn:aws:iam::134857759074:role/grievance-insights-pilot-terraform`.
- Frontend publishing role: `arn:aws:iam::134857759074:role/grievance-insights-pilot-frontend`.
- Bootstrap Terraform state remains outside Git with an operator-held local copy and a checksum-verified backup at `bootstrap/terraform.tfstate` in the versioned, encrypted project state bucket. Coordinate with the operator before changing `infra/bootstrap/`; never apply it from empty state or use the main hosting root as its state.

## CI and deployment workflows

- `ci.yml` runs application, credential-free Terraform, and GitHub Actions workflow syntax validation for pull requests and pushes to `main`.
- `deploy-frontend.yml` is manual, main-only, and uses the `pilot-frontend` GitHub environment plus OIDC. `PILOT_DEPLOY_ENABLED=false`; do not enable it until authentication and publication are approved.
- `deploy-infra.yml` is manual, main-only, and uses the `pilot-infrastructure` environment plus OIDC. Plan is read-only. Apply additionally requires `INFRA_DEPLOY_ENABLED=true` and the exact confirmation `APPLY`. It applies only the plan generated in that run and rejects every delete or replacement. Binary plans remain on the ephemeral runner and are not uploaded.
- Both deployment workflows serialize runs. Never add permanent AWS credentials or generic command inputs.

To operate through GitHub, verify `gh auth status`, fetch the latest `main`, create a focused branch, run local checks, push, and open a PR. After merge, select the required manual workflow on `main`. Run infrastructure `plan` first and review its log. Enable an apply guard only for an explicitly approved deployment, invoke `apply` with its confirmation, then return the guard to `false`. Do not dispatch frontend publication before authentication is complete.

## IAM boundary and future work

The infrastructure OIDC role supports the existing state/hosting resources and now has project-scoped provisioning policies for Cognito, Lambda, API Gateway HTTP APIs, DynamoDB, SQS, private datasets/results/artifact buckets, CloudWatch Logs, two named Lambda execution roles, and Bedrock control-plane resources (PR #5). Its IAM runtime permissions boundary is mandatory for those execution roles. `iam:PassRole` is limited to the two named roles and Lambda. The Terraform deployer cannot invoke models. The frontend role still only publishes assets and invalidates distribution `E3B0B5R1HAYD1J`.

Bedrock worker invocation is authorized only for Qwen3 32B (`qwen.qwen3-32b-v1:0`) in `ap-south-1` for initial synthetic-data evaluation; streaming remains disabled. The model was verified active through the read-only Bedrock API. Pricing, quotas, and broader evaluation suitability still require review. IAM simulation confirms selected allow/deny cases but does not guarantee that all future Terraform provider API calls will succeed. When backend resources are defined, refine any action-level gaps based on their actual plans and access-denied diagnostics without broadening permissions indiscriminately.

## Not implemented and recommended next task

Authentication, production APIs, durable sessions, application DynamoDB tables, dataset/result storage, queues, Bedrock workers, and backend Lambda packaging/deployment automation are not implemented. Next implement administrator-provisioned Cognito authentication, backend-managed secure sessions, frontend login/logout, and backend CI/build and Lambda packaging within the existing Terraform deployment workflow. Keep both deployment guards disabled while work is reviewed.
