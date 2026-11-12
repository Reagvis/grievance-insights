# Bootstrap configuration

This isolated configuration defines prerequisites that cannot be created by the main infrastructure root: the dedicated encrypted/versioned state bucket, deployment OIDC roles, split infrastructure policies, and runtime permissions boundary. Its authoritative state now uses the existing project state bucket with key `grievance-insights/pilot/bootstrap/terraform.tfstate` and native S3 lockfiles.

The AWS account already has the GitHub Actions OIDC provider; do not create a duplicate. Routine plan/apply operations use `.github/workflows/deploy-bootstrap.yml`, the protected `pilot-bootstrap` environment, and the separate `grievance-insights-pilot-bootstrap` role. The workflow supplies all deployed non-secret variables, including `frontend_distribution_id`, and is disabled unless `BOOTSTRAP_DEPLOY_ENABLED=true`.

`infra/access-seed/` owns only that bootstrap access role and its permissions boundary. It is intentionally separate so the bootstrap role cannot change its own trust, permissions, or boundary. Access-seed changes remain exceptional operator actions with separately protected local state and an encrypted, versioned backup.

After the hosting foundation is provisioned, supply `frontend_distribution_id` and rerun this bootstrap configuration to create the separate frontend publishing role. This second phase avoids granting cache invalidation across every distribution.

The protected GitHub environments `pilot-infrastructure`, `pilot-frontend`, and `pilot-bootstrap` are restricted to `main`. Their deployment guards are disabled by default.

The infrastructure role also has split managed policies for the planned project-scoped backend. It may provision the approved Cognito, Lambda, HTTP API, DynamoDB, SQS, private S3, CloudWatch Logs, and Bedrock control-plane resources. It can create only the two named Lambda execution roles, and those roles must use the managed runtime permissions boundary. `iam:PassRole` is limited to those roles and the Lambda service.

The runtime boundary permits non-streaming invocation of Qwen3 32B (`qwen.qwen3-32b-v1:0`) in `ap-south-1` for initial synthetic-data evaluation. Invocation remains limited to ARNs in `approved_bedrock_inference_arns` and regions in `approved_bedrock_regions`; streaming requires the explicit `enable_bedrock_response_streaming` opt-in and remains disabled. The Terraform deployer can author the bounded worker policy but does not itself receive either model-invocation action.
