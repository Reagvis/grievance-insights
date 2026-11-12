data "aws_caller_identity" "current" {}

locals {
  account_id                 = data.aws_caller_identity.current.account_id
  state_bucket_name          = "grievance-insights-pilot-${local.account_id}-tfstate"
  state_bucket_arn           = "arn:aws:s3:::${local.state_bucket_name}"
  bootstrap_state_key        = "grievance-insights/pilot/bootstrap/terraform.tfstate"
  bootstrap_state_object_arn = "${local.state_bucket_arn}/${local.bootstrap_state_key}"
  bootstrap_lock_object_arn  = "${local.bootstrap_state_object_arn}.tflock"
  oidc_provider_arn          = "arn:aws:iam::${local.account_id}:oidc-provider/token.actions.githubusercontent.com"
  bootstrap_role_name        = "grievance-insights-pilot-bootstrap"
  bootstrap_boundary_name    = "grievance-insights-pilot-bootstrap-boundary"

  managed_role_arns = [
    "arn:aws:iam::${local.account_id}:role/grievance-insights-pilot-terraform",
    "arn:aws:iam::${local.account_id}:role/grievance-insights-pilot-frontend",
  ]

  managed_policy_arns = [
    "arn:aws:iam::${local.account_id}:policy/grievance-insights-pilot-terraform-compute",
    "arn:aws:iam::${local.account_id}:policy/grievance-insights-pilot-terraform-data",
    "arn:aws:iam::${local.account_id}:policy/grievance-insights-pilot-terraform-identity-bedrock",
    "arn:aws:iam::${local.account_id}:policy/grievance-insights-pilot-runtime-boundary",
  ]

  attached_infrastructure_policy_arns = slice(local.managed_policy_arns, 0, 3)

  tags = {
    Application = "grievance-insights"
    Environment = "pilot"
    ManagedBy   = "terraform-access-seed"
    Production  = "false"
    Repository  = "Reagvis/grievance-insights"
  }
}

data "aws_iam_policy_document" "bootstrap_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:Reagvis@212125805/grievance-insights@1446187135:environment:pilot-bootstrap"]
    }
  }
}

data "aws_iam_policy_document" "bootstrap_permissions" {
  statement {
    sid       = "BootstrapStateBucketList"
    actions   = ["s3:ListBucket"]
    resources = [local.state_bucket_arn]

    condition {
      test     = "StringEquals"
      variable = "s3:prefix"
      values   = [local.bootstrap_state_key]
    }
  }

  statement {
    sid       = "BootstrapStateReadWrite"
    actions   = ["s3:GetObject", "s3:PutObject"]
    resources = [local.bootstrap_state_object_arn]
  }

  statement {
    sid       = "BootstrapLockReadWriteDelete"
    actions   = ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"]
    resources = [local.bootstrap_lock_object_arn]
  }

  statement {
    sid = "StateBucketConfiguration"
    actions = [
      "s3:CreateBucket",
      "s3:DeleteBucket",
      "s3:DeleteBucket*",
      "s3:GetBucket*",
      "s3:GetEncryptionConfiguration",
      "s3:GetLifecycleConfiguration",
      "s3:PutBucket*",
      "s3:PutEncryptionConfiguration",
      "s3:PutLifecycleConfiguration",
    ]
    resources = [local.state_bucket_arn]
  }

  statement {
    sid = "ManageProjectDeploymentRoles"
    actions = [
      "iam:CreateRole",
      "iam:DeleteRole",
      "iam:DeleteRolePermissionsBoundary",
      "iam:GetRole",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
      "iam:PutRolePermissionsBoundary",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
    ]
    resources = local.managed_role_arns
  }

  statement {
    sid = "ManageProjectDeploymentRolePolicies"
    actions = [
      "iam:DeleteRolePolicy",
      "iam:GetRolePolicy",
      "iam:PutRolePolicy",
    ]
    resources = local.managed_role_arns
  }

  statement {
    sid = "ManageProjectPoliciesAndRuntimeBoundary"
    actions = [
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListEntitiesForPolicy",
      "iam:ListPolicyTags",
      "iam:ListPolicyVersions",
      "iam:SetDefaultPolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
    ]
    resources = local.managed_policy_arns
  }

  statement {
    sid       = "AttachProjectPoliciesToInfrastructureRole"
    actions   = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
    resources = ["arn:aws:iam::${local.account_id}:role/grievance-insights-pilot-terraform"]

    condition {
      test     = "ArnEquals"
      variable = "iam:PolicyARN"
      values   = local.attached_infrastructure_policy_arns
    }
  }
}

resource "aws_iam_policy" "bootstrap_boundary" {
  name        = local.bootstrap_boundary_name
  description = "Maximum permissions for GitHub management of Grievance Insights bootstrap resources"
  policy      = data.aws_iam_policy_document.bootstrap_permissions.json
}

resource "aws_iam_role" "bootstrap" {
  name                 = local.bootstrap_role_name
  assume_role_policy   = data.aws_iam_policy_document.bootstrap_trust.json
  permissions_boundary = aws_iam_policy.bootstrap_boundary.arn
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "bootstrap" {
  name   = local.bootstrap_role_name
  role   = aws_iam_role.bootstrap.id
  policy = data.aws_iam_policy_document.bootstrap_permissions.json
}
