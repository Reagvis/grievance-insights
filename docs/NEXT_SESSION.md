# Next session handoff

## Start here

Grievance Insights is a single-organization pilot for analyzing Telugu citizen grievances and department responses. Read [ARCHITECTURE.md](ARCHITECTURE.md), [INFRASTRUCTURE.md](INFRASTRUCTURE.md), [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), [DECISIONS.md](DECISIONS.md), and [AGENTS.md](../AGENTS.md) before changing code.

The repository is `Reagvis/grievance-insights`. At this handoff, `main` includes PR #3 at `8edf996`; the infrastructure-workflow handoff is being prepared on `chore/infra-deployment-handoff` and must be merged through its reviewed PR. Start future work from the latest remote `main`, preserve unrelated changes, and use a focused feature branch.

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
- Bootstrap Terraform state remains local, excluded from Git, and separately backed up. Coordinate with the operator before changing `infra/bootstrap/`; never recreate its resources from an empty state.

## CI and deployment workflows

- `ci.yml` runs application and credential-free Terraform validation for pull requests and pushes to `main`.
- `deploy-frontend.yml` is manual, main-only, and uses the `pilot-frontend` GitHub environment plus OIDC. `PILOT_DEPLOY_ENABLED=false`; do not enable it until authentication and publication are approved.
- `deploy-infra.yml` is manual, main-only, and uses the `pilot-infrastructure` environment plus OIDC. Plan is read-only. Apply additionally requires `INFRA_DEPLOY_ENABLED=true` and the exact confirmation `APPLY`. It applies only the plan generated in that run and rejects every delete or replacement. Binary plans remain on the ephemeral runner and are not uploaded.
- Both deployment workflows serialize runs. Never add permanent AWS credentials or generic command inputs.

To operate through GitHub, verify `gh auth status`, fetch the latest `main`, create a focused branch, run local checks, push, and open a PR. After merge, select the required manual workflow on `main`. Run infrastructure `plan` first and review its log. Enable an apply guard only for an explicitly approved deployment, invoke `apply` with its confirmation, then return the guard to `false`. Do not dispatch frontend publication before authentication is complete.

## IAM boundary and future work

The infrastructure role currently supports only the dedicated state backend and deployed S3/CloudFront/ACM/Route 53 hosting resources. The frontend role can only list and publish to the frontend bucket and invalidate distribution `E3B0B5R1HAYD1J`. Neither role currently grants Cognito, Lambda, API Gateway, DynamoDB, SQS, or Bedrock permissions.

Terraform validation does not prove that a future apply is authorized. When backend resources are actually defined, review their exact AWS API requirements and extend the infrastructure role with resource-specific permissions in a separate bootstrap plan before using the deployment workflow. Do not grant broad future-service access preemptively.

## Not implemented and recommended next task

Authentication, production APIs, durable sessions, application DynamoDB tables, dataset/result storage, queues, Bedrock workers, and backend deployment automation remain unimplemented. The next task should implement administrator-provisioned Cognito authentication, backend-managed secure sessions, frontend login/logout, and backend CI/CD. Keep both deployment guards disabled while that design and implementation are reviewed.
