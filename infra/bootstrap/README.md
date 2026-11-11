# Bootstrap configuration

This isolated configuration defines prerequisites that cannot be created by the main remote-state configuration: a dedicated encrypted/versioned state bucket and GitHub OIDC roles. It intentionally uses local state during the first bootstrap. Do not run it from CI, and do not apply it until bucket naming, IAM boundaries, GitHub environments, and resource ownership are approved.

The AWS account already has the GitHub Actions OIDC provider. Supply its ARN; do not attempt to create a duplicate account-wide provider. Copy `terraform.tfvars.example` to an ignored `terraform.tfvars`, initialize this directory, inspect a saved plan, and apply only during an explicitly authorized bootstrap task. Protect the resulting local bootstrap state as an administrative artifact or migrate it into an approved administrative backend.

After the hosting foundation is provisioned, supply `frontend_distribution_id` and rerun this bootstrap configuration to create the separate frontend publishing role. This second phase avoids granting cache invalidation across every distribution.

The protected GitHub environments `pilot-infrastructure` and `pilot-frontend` must be created separately in GitHub, restricted to `main`, and configured with required reviewers before either role is used. No workflow is created here.

The infrastructure role also has split managed policies for the planned project-scoped backend. It may provision the approved Cognito, Lambda, HTTP API, DynamoDB, SQS, private S3, CloudWatch Logs, and Bedrock control-plane resources. It can create only the two named Lambda execution roles, and those roles must use the managed runtime permissions boundary. `iam:PassRole` is limited to those roles and the Lambda service.

The runtime boundary grants no Bedrock inference by default. Populate `approved_bedrock_inference_arns` only after models or inference profiles have been approved; invocation remains limited to those ARNs and `approved_bedrock_regions`. Streaming also requires the explicit `enable_bedrock_response_streaming` opt-in. The Terraform deployer can author the bounded worker policy but does not itself receive either model-invocation action.
