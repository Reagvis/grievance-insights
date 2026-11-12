locals {
  backend_name_prefix = "${local.project_name}-${local.environment}"

  application_bucket_names = toset([
    "${local.backend_name_prefix}-${data.aws_caller_identity.current.account_id}-datasets",
    "${local.backend_name_prefix}-${data.aws_caller_identity.current.account_id}-results",
    "${local.backend_name_prefix}-${data.aws_caller_identity.current.account_id}-lambda-artifacts",
  ])
  application_bucket_arns        = [for name in local.application_bucket_names : "arn:aws:s3:::${name}"]
  application_bucket_object_arns = [for arn in local.application_bucket_arns : "${arn}/*"]
  lambda_artifact_bucket_arn     = "arn:aws:s3:::${local.backend_name_prefix}-${data.aws_caller_identity.current.account_id}-lambda-artifacts"
  runtime_data_bucket_arns = [
    "arn:aws:s3:::${local.backend_name_prefix}-${data.aws_caller_identity.current.account_id}-datasets",
    "arn:aws:s3:::${local.backend_name_prefix}-${data.aws_caller_identity.current.account_id}-results",
  ]
  runtime_data_bucket_object_arns = [for arn in local.runtime_data_bucket_arns : "${arn}/*"]

  runtime_role_names = toset([
    "${local.backend_name_prefix}-api-execution",
    "${local.backend_name_prefix}-worker-execution",
  ])
  runtime_role_arns = [for name in local.runtime_role_names : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/${name}"]

  runtime_policy_names = toset([
    "${local.backend_name_prefix}-api-runtime",
    "${local.backend_name_prefix}-worker-runtime",
  ])
  runtime_policy_arns = [for name in local.runtime_policy_names : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${name}"]

  runtime_boundary_name = "${local.backend_name_prefix}-runtime-boundary"
  runtime_boundary_arn  = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:policy/${local.runtime_boundary_name}"

  lambda_function_arn = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.backend_name_prefix}-*"
  lambda_mapping_arn  = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:event-source-mapping:*"
  log_group_arn       = "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.backend_name_prefix}-*"
  dynamodb_table_arn  = "arn:aws:dynamodb:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${local.backend_name_prefix}-*"
  sqs_queue_arn       = "arn:aws:sqs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:${local.backend_name_prefix}-*"
  cognito_pool_arn    = "arn:aws:cognito-idp:${var.aws_region}:${data.aws_caller_identity.current.account_id}:userpool/*"
  apigateway_api_arn  = "arn:aws:apigateway:${var.aws_region}::/apis/*"

  bedrock_resource_arns = [
    "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:guardrail/*",
    "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:prompt/*",
    "arn:aws:bedrock:${var.aws_region}:${data.aws_caller_identity.current.account_id}:application-inference-profile/*",
  ]
}

# This boundary is mandatory on every application execution role the deployer may
# create. It is deliberately a maximum-permissions envelope, not the runtime
# role's identity policy. Each runtime role must still receive a narrower policy.
data "aws_iam_policy_document" "runtime_boundary" {
  statement {
    sid = "LambdaLogging"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${local.log_group_arn}:*"]
  }

  statement {
    sid = "ApplicationDataObjects"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = local.runtime_data_bucket_object_arns
  }

  statement {
    sid       = "ApplicationDataBucketListing"
    actions   = ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketMultipartUploads"]
    resources = local.runtime_data_bucket_arns
  }

  statement {
    sid = "ApplicationTables"
    actions = [
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:ConditionCheckItem",
      "dynamodb:DeleteItem",
      "dynamodb:DescribeTable",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:UpdateItem",
    ]
    resources = [local.dynamodb_table_arn, "${local.dynamodb_table_arn}/index/*"]
  }

  statement {
    sid = "ApplicationQueues"
    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ReceiveMessage",
      "sqs:SendMessage",
    ]
    resources = [local.sqs_queue_arn]
  }

  statement {
    sid = "ApplicationUserPool"
    actions = [
      "cognito-idp:AdminInitiateAuth",
      "cognito-idp:AdminRespondToAuthChallenge",
      "cognito-idp:AdminUserGlobalSignOut",
    ]
    resources = [local.cognito_pool_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  dynamic "statement" {
    for_each = length(var.approved_bedrock_inference_arns) == 0 ? [] : [1]

    content {
      sid = "ApprovedBedrockInference"
      actions = concat(
        ["bedrock:InvokeModel"],
        var.enable_bedrock_response_streaming ? ["bedrock:InvokeModelWithResponseStream"] : [],
      )
      resources = var.approved_bedrock_inference_arns

      condition {
        test     = "StringEquals"
        variable = "aws:RequestedRegion"
        values   = var.approved_bedrock_regions
      }
    }
  }
}

resource "aws_iam_policy" "runtime_boundary" {
  name        = local.runtime_boundary_name
  description = "Maximum permissions boundary for Grievance Insights pilot Lambda execution roles"
  policy      = data.aws_iam_policy_document.runtime_boundary.json

  tags = local.tags
}

data "aws_iam_policy_document" "backend_compute" {
  statement {
    sid = "LambdaFunctionLifecycle"
    actions = [
      "lambda:AddPermission",
      "lambda:CreateFunction",
      "lambda:DeleteFunction",
      "lambda:DeleteFunctionConcurrency",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:GetFunctionConfiguration",
      "lambda:GetPolicy",
      "lambda:ListFunctionEventInvokeConfigs",
      "lambda:ListFunctionsByCodeSigningConfig",
      "lambda:ListTags",
      "lambda:PublishVersion",
      "lambda:PutFunctionConcurrency",
      "lambda:RemovePermission",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
    ]
    resources = [local.lambda_function_arn]
  }

  statement {
    sid       = "CreateLambdaEventSourceMappings"
    actions   = ["lambda:CreateEventSourceMapping"]
    resources = ["*"]

    condition {
      test     = "ArnLike"
      variable = "lambda:FunctionArn"
      values   = [local.lambda_function_arn]
    }
  }

  statement {
    sid = "ManageLambdaEventSourceMappings"
    actions = [
      "lambda:DeleteEventSourceMapping",
      "lambda:GetEventSourceMapping",
      "lambda:ListTags",
      "lambda:TagResource",
      "lambda:UntagResource",
      "lambda:UpdateEventSourceMapping",
    ]
    resources = [local.lambda_mapping_arn]

    condition {
      test     = "ArnLike"
      variable = "lambda:FunctionArn"
      values   = [local.lambda_function_arn]
    }
  }

  statement {
    sid       = "LambdaDiscovery"
    actions   = ["lambda:ListEventSourceMappings", "lambda:ListFunctions", "lambda:ListVersionsByFunction"]
    resources = ["*"]
  }

  statement {
    sid     = "HttpApiCreation"
    actions = ["apigateway:POST"]
    resources = [
      "arn:aws:apigateway:${var.aws_region}::/apis",
      "arn:aws:apigateway:${var.aws_region}::/tags/*",
    ]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "HttpApiManagement"
    actions   = ["apigateway:DELETE", "apigateway:GET", "apigateway:PATCH", "apigateway:POST", "apigateway:PUT"]
    resources = [local.apigateway_api_arn, "arn:aws:apigateway:${var.aws_region}::/tags/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  # API Gateway v2 checks this action when a tagged $default stage is created,
  # on the stage collection ARN (before the named stage exists). This is not
  # an API invocation grant and does not authorize tagging other resources.
  statement {
    sid       = "HttpApiStageTagOnCreate"
    actions   = ["apigateway:TagResource"]
    resources = ["arn:aws:apigateway:${var.aws_region}::/apis/*/stages"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = [var.aws_region]
    }
  }

  statement {
    sid = "LogGroupLifecycle"
    actions = [
      "logs:CreateLogGroup",
      "logs:DeleteLogGroup",
      "logs:DescribeLogGroups",
      "logs:ListTagsForResource",
      "logs:PutRetentionPolicy",
      "logs:TagResource",
      "logs:UntagResource",
    ]
    resources = [local.log_group_arn]
  }

  statement {
    sid       = "LogGroupDiscovery"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "backend_compute" {
  name        = "${local.backend_name_prefix}-terraform-compute"
  description = "Project-scoped Lambda, API Gateway HTTP API, and log group provisioning"
  policy      = data.aws_iam_policy_document.backend_compute.json

  tags = local.tags
}

data "aws_iam_policy_document" "backend_data" {
  statement {
    sid = "ApplicationBucketLifecycle"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteBucketCors",
      "s3:DeleteBucketOwnershipControls",
      "s3:DeleteBucketPolicy",
      "s3:DeleteBucketTagging",
      # Covers all S3 bucket metadata reads required by future provider refreshes.
      # Object access remains limited to separately scoped object ARNs.
      "s3:Get*",
      "s3:ListBucket",
      "s3:PutBucketPolicy",
      "s3:PutBucketPublicAccessBlock",
      "s3:PutBucketTagging",
      "s3:PutBucketVersioning",
      "s3:PutBucketCors",
      "s3:PutBucketOwnershipControls",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
    ]
    resources = local.application_bucket_arns
  }

  statement {
    sid = "LambdaArtifactPublishing"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:ListMultipartUploadParts",
      "s3:PutObject",
    ]
    resources = ["${local.lambda_artifact_bucket_arn}/*"]
  }

  statement {
    sid = "DynamoDbTableLifecycle"
    actions = [
      "dynamodb:CreateTable",
      "dynamodb:DeleteTable",
      "dynamodb:DescribeContinuousBackups",
      "dynamodb:DescribeTable",
      "dynamodb:DescribeTimeToLive",
      "dynamodb:ListTagsOfResource",
      "dynamodb:TagResource",
      "dynamodb:UntagResource",
      "dynamodb:UpdateContinuousBackups",
      "dynamodb:UpdateTable",
      "dynamodb:UpdateTimeToLive",
    ]
    resources = [local.dynamodb_table_arn]
  }

  statement {
    sid       = "DynamoDbDiscovery"
    actions   = ["dynamodb:ListTables"]
    resources = ["*"]
  }

  statement {
    sid = "QueueLifecycle"
    actions = [
      "sqs:CreateQueue",
      "sqs:DeleteQueue",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ListQueueTags",
      "sqs:PurgeQueue",
      "sqs:SetQueueAttributes",
      "sqs:TagQueue",
      "sqs:UntagQueue",
    ]
    resources = [local.sqs_queue_arn]
  }

  statement {
    sid       = "QueueDiscovery"
    actions   = ["sqs:ListQueues"]
    resources = ["*"]
  }

  statement {
    sid       = "UserPoolCreation"
    actions   = ["cognito-idp:CreateUserPool"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid = "UserPoolLifecycle"
    actions = [
      "cognito-idp:CreateUserPoolClient",
      "cognito-idp:DeleteUserPool",
      "cognito-idp:DeleteUserPoolClient",
      "cognito-idp:DescribeUserPool",
      "cognito-idp:DescribeUserPoolClient",
      # Terraform reads this even when the user pool has MFA explicitly OFF.
      # No MFA setup or user self-registration action is being granted.
      "cognito-idp:GetUserPoolMfaConfig",
      "cognito-idp:ListTagsForResource",
      "cognito-idp:ListUserPoolClients",
      "cognito-idp:TagResource",
      "cognito-idp:UntagResource",
      "cognito-idp:UpdateUserPool",
      "cognito-idp:UpdateUserPoolClient",
    ]
    resources = [local.cognito_pool_arn]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "UserPoolDiscovery"
    actions   = ["cognito-idp:ListUserPools"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "backend_data" {
  name        = "${local.backend_name_prefix}-terraform-data"
  description = "Project-scoped Cognito, DynamoDB, SQS, and private S3 provisioning"
  policy      = data.aws_iam_policy_document.backend_data.json

  tags = local.tags
}

data "aws_iam_policy_document" "backend_identity_bedrock" {
  statement {
    sid       = "CreateBoundedRuntimeRoles"
    actions   = ["iam:CreateRole", "iam:TagRole"]
    resources = local.runtime_role_arns

    condition {
      test     = "ArnEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.runtime_boundary_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid = "ManageBoundedRuntimeRoles"
    actions = [
      "iam:DeleteRole",
      "iam:DeleteRolePolicy",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
      "iam:PutRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
    ]
    resources = local.runtime_role_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "SetApprovedRuntimeBoundary"
    actions   = ["iam:PutRolePermissionsBoundary"]
    resources = local.runtime_role_arns

    condition {
      test     = "ArnEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.runtime_boundary_arn]
    }
  }

  statement {
    sid = "CreateRuntimePolicies"
    actions = [
      "iam:CreatePolicy",
      "iam:TagPolicy",
    ]
    resources = local.runtime_policy_arns

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid = "ManageRuntimePolicies"
    actions = [
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListEntitiesForPolicy",
      "iam:ListPolicyTags",
      "iam:ListPolicyVersions",
      "iam:SetDefaultPolicyVersion",
      "iam:UntagPolicy",
    ]
    resources = local.runtime_policy_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }
  }

  statement {
    sid       = "ReadRuntimeBoundary"
    actions   = ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"]
    resources = [local.runtime_boundary_arn]
  }

  statement {
    sid       = "AttachApprovedRuntimePolicies"
    actions   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
    resources = local.runtime_role_arns

    condition {
      test     = "ArnEquals"
      variable = "iam:PolicyARN"
      values   = local.runtime_policy_arns
    }
  }

  statement {
    sid       = "PassRuntimeRolesToLambda"
    actions   = ["iam:PassRole"]
    resources = local.runtime_role_arns

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid = "BedrockProjectResourceCreation"
    actions = [
      "bedrock:CreateGuardrail",
      "bedrock:CreatePrompt",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/Repository"
      values   = [var.github_repository]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = var.approved_bedrock_regions
    }
  }

  statement {
    sid = "BedrockProjectResourceManagement"
    actions = [
      "bedrock:CreateGuardrailVersion",
      "bedrock:CreatePromptVersion",
      "bedrock:DeleteGuardrail",
      "bedrock:DeleteInferenceProfile",
      "bedrock:DeletePrompt",
      "bedrock:GetGuardrail",
      "bedrock:GetInferenceProfile",
      "bedrock:GetPrompt",
      "bedrock:ListTagsForResource",
      "bedrock:TagResource",
      "bedrock:UntagResource",
      "bedrock:UpdateGuardrail",
      "bedrock:UpdatePrompt",
    ]
    resources = local.bedrock_resource_arns

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Repository"
      values   = [var.github_repository]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = var.approved_bedrock_regions
    }
  }

  statement {
    sid = "BedrockMetadataDiscovery"
    actions = [
      "bedrock:GetFoundationModel",
      "bedrock:ListFoundationModels",
      "bedrock:ListGuardrails",
      "bedrock:ListInferenceProfiles",
      "bedrock:ListPrompts",
    ]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "aws:RequestedRegion"
      values   = var.approved_bedrock_regions
    }
  }
}

resource "aws_iam_policy" "backend_identity_bedrock" {
  name        = "${local.backend_name_prefix}-terraform-identity-bedrock"
  description = "Bounded runtime IAM and project-scoped Bedrock control-plane provisioning"
  policy      = data.aws_iam_policy_document.backend_identity_bedrock.json

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "terraform_backend" {
  for_each = {
    compute          = aws_iam_policy.backend_compute.arn
    data             = aws_iam_policy.backend_data.arn
    identity_bedrock = aws_iam_policy.backend_identity_bedrock.arn
  }

  role       = aws_iam_role.terraform.name
  policy_arn = each.value
}
